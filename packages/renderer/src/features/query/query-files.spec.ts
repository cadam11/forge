/**
 * Saving and opening `.sql` files — including the three things the Angular version got wrong.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { adoptOpenedFile, openQueryFile, rememberedFilePath, saveQueryToFile } from './query-files';

const teardowns: (() => void)[] = [];
const notifications: string[] = [];
const errors: string[] = [];

beforeEach(() => {
  notifications.length = 0;
  errors.length = 0;
  teardowns.push(
    setDiagnosticsSink({ error: context => errors.push(context), warn: () => undefined }),
    setNotifier({
      success: message => notifications.push(`success:${message}`),
      error: message => notifications.push(`error:${message}`),
      info: message => notifications.push(`info:${message}`),
      warning: message => notifications.push(`warning:${message}`),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  tabStore.setState({ tabs: [], activeTabId: '' });
});

/** A dirty query tab, which is the state a save is normally reached from. */
function dirtyTab(): string {
  const tabId = tabStore.getState().openQueryTab('conn-1', 'shop', 'select 1', false);
  tabStore.getState().setTabContent(tabId, 'select 2');
  expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);
  return tabId;
}

describe('rememberedFilePath', () => {
  it('reads a path off tab metadata and rejects anything else', () => {
    expect(rememberedFilePath({ filePath: '/tmp/a.sql' })).toBe('/tmp/a.sql');
    expect(rememberedFilePath({ filePath: '' })).toBeNull();
    expect(rememberedFilePath({ filePath: 7 })).toBeNull();
    expect(rememberedFilePath(undefined)).toBeNull();
  });
});

describe('saveQueryToFile', () => {
  it('prompts, writes, remembers the path and marks the tab clean', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/report.sql' }));
    const writeFile = vi.fn(async () => undefined);
    teardowns.push(installJoineryMock({ app: { showSaveDialog }, workspace: { writeFile } }));
    const tabId = dirtyTab();

    await saveQueryToFile({ tabId, sql: 'select 2', promptForPath: true, rememberedPath: null });

    expect(writeFile).toHaveBeenCalledWith('/tmp/report.sql', 'select 2');
    expect(notifications).toEqual(['success:Query saved']);
    // Fix 1: the Angular version left the tab dirty forever, so the unsaved-work guard kept warning
    // about work that was on disk.
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(false);
    expect(
      rememberedFilePath(tabStore.getState().tabs.find(tab => tab.id === tabId)?.metadata)
    ).toBe('/tmp/report.sql');
  });

  it('reuses the remembered path without prompting — that is what ⌘S means', async () => {
    const showSaveDialog = vi.fn();
    const writeFile = vi.fn(async () => undefined);
    teardowns.push(installJoineryMock({ app: { showSaveDialog }, workspace: { writeFile } }));
    const tabId = dirtyTab();

    await saveQueryToFile({
      tabId,
      sql: 'select 2',
      promptForPath: false,
      rememberedPath: '/tmp/report.sql',
    });

    // Fix 2: Angular bound Save and Save As to the same function, so every ⌘S opened a dialog.
    expect(showSaveDialog).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledWith('/tmp/report.sql', 'select 2');
  });

  it('still prompts for Save As even with a remembered path, seeded with it', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/copy.sql' }));
    teardowns.push(
      installJoineryMock({
        app: { showSaveDialog },
        workspace: { writeFile: async () => undefined },
      })
    );
    const tabId = dirtyTab();

    await saveQueryToFile({
      tabId,
      sql: 'select 2',
      promptForPath: true,
      rememberedPath: '/tmp/report.sql',
    });

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: '/tmp/report.sql', title: 'Save Query' })
    );
  });

  it('prompts when ⌘S has no remembered path yet, defaulting the name', async () => {
    const showSaveDialog = vi.fn(async () => ({ canceled: false, filePath: '/tmp/query.sql' }));
    teardowns.push(
      installJoineryMock({
        app: { showSaveDialog },
        workspace: { writeFile: async () => undefined },
      })
    );

    await saveQueryToFile({
      tabId: 'tab-x',
      sql: 'select 2',
      promptForPath: false,
      rememberedPath: null,
    });

    expect(showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'query.sql' })
    );
  });

  it('is silent when the dialog is dismissed, and writes nothing', async () => {
    const writeFile = vi.fn();
    teardowns.push(
      installJoineryMock({
        app: { showSaveDialog: async () => ({ canceled: true }) },
        workspace: { writeFile },
      })
    );
    const tabId = dirtyTab();

    await saveQueryToFile({ tabId, sql: 'select 2', promptForPath: true, rememberedPath: null });

    // Fix 3: `canceled` is checked before `filePath`, so dismissing the sheet is not an error.
    expect(writeFile).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);
  });

  it('refuses to save an empty buffer', async () => {
    const showSaveDialog = vi.fn();
    teardowns.push(installJoineryMock({ app: { showSaveDialog } }));

    await saveQueryToFile({
      tabId: 'tab-x',
      sql: '   ',
      promptForPath: true,
      rememberedPath: null,
    });

    expect(notifications).toEqual(['warning:No query to save']);
    expect(showSaveDialog).not.toHaveBeenCalled();
  });

  it('reports a failed write and leaves the tab dirty', async () => {
    teardowns.push(
      installJoineryMock({
        app: { showSaveDialog: async () => ({ canceled: false, filePath: '/root/nope.sql' }) },
        workspace: { writeFile: () => Promise.reject(new Error('EACCES')) },
      })
    );
    const tabId = dirtyTab();

    await saveQueryToFile({ tabId, sql: 'select 2', promptForPath: true, rememberedPath: null });

    expect(notifications).toEqual(['error:Failed to save query']);
    expect(errors).toEqual(['failed to save query to file']);
    expect(tabStore.getState().tabs.find(tab => tab.id === tabId)?.isDirty).toBe(true);
  });

  it('does nothing without a bridge', async () => {
    await saveQueryToFile({
      tabId: 'tab-x',
      sql: 'select 1',
      promptForPath: true,
      rememberedPath: null,
    });
    expect(notifications).toEqual([]);
  });
});

describe('openQueryFile', () => {
  it('returns the path and the contents', async () => {
    teardowns.push(
      installJoineryMock({
        app: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/a.sql'] }) },
        workspace: { readFile: async () => 'select 1' },
      })
    );

    expect(await openQueryFile()).toEqual({ path: '/tmp/a.sql', content: 'select 1' });
  });

  it('asks for one file, filtered to .sql', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    teardowns.push(installJoineryMock({ app: { showOpenDialog } }));

    await openQueryFile();

    expect(showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: ['openFile'],
        filters: [
          { name: 'SQL Files', extensions: ['sql'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
    );
  });

  it('is null and silent when dismissed', async () => {
    teardowns.push(
      installJoineryMock({
        app: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
      })
    );
    expect(await openQueryFile()).toBeNull();
    expect(notifications).toEqual([]);
  });

  it('reports a failed read', async () => {
    teardowns.push(
      installJoineryMock({
        app: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/tmp/a.sql'] }) },
        workspace: { readFile: () => Promise.reject(new Error('ENOENT')) },
      })
    );

    expect(await openQueryFile()).toBeNull();
    // The Angular version swallowed this into a bare `console.error`.
    expect(notifications).toEqual(['error:Failed to open query file']);
    expect(errors).toEqual(['failed to open a query file']);
  });
});

describe('adoptOpenedFile', () => {
  it('leaves the tab CLEAN, holding the file’s text, remembering its path', () => {
    // Reached from a tab the user HAS edited, which is the case that made the bug visible: the clean
    // baseline is `select 1` and the content is `select 2`, so opening a file over it used to compare
    // the file's text against `select 1` and come up dirty.
    const tabId = dirtyTab();

    adoptOpenedFile({ tabId, path: '/tmp/from-disk.sql', content: 'SELECT 42' });

    const tab = tabStore.getState().tabs.find(candidate => candidate.id === tabId);
    expect(tabStore.getState().getTabContent(tabId)).toBe('SELECT 42');
    expect(tab?.isDirty).toBe(false);
    expect(rememberedFilePath(tab?.metadata)).toBe('/tmp/from-disk.sql');
    // The baseline moved with it, so a ⌘S guard measures against the file rather than against nothing.
    expect(tabStore.getState().getCleanBaseline(tabId)).toBe('SELECT 42');
  });

  it('goes dirty again on the first edit after the open', () => {
    const tabId = dirtyTab();
    adoptOpenedFile({ tabId, path: '/tmp/from-disk.sql', content: 'SELECT 42' });

    tabStore.getState().setTabContent(tabId, 'SELECT 43');

    // The other half of "clean": a baseline that swallowed every subsequent edit would be just as wrong
    // as one that never moved.
    expect(tabStore.getState().tabs.find(candidate => candidate.id === tabId)?.isDirty).toBe(true);
  });

  it('keeps the tab’s other metadata', () => {
    const tabId = dirtyTab();
    tabStore.getState().updateTab(tabId, { metadata: { scrollTop: 120 } });

    adoptOpenedFile({ tabId, path: '/tmp/from-disk.sql', content: 'SELECT 42' });

    expect(
      tabStore.getState().tabs.find(candidate => candidate.id === tabId)?.metadata
    ).toMatchObject({ scrollTop: 120, filePath: '/tmp/from-disk.sql' });
  });
});
