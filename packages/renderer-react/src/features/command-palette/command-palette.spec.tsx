/**
 * The palette, mounted for real — and the home of **the zero-dead-commands walk**, which is this
 * task's animating requirement (PLAN.md 0.4: ten palette entries that dispatched into silence).
 *
 * The walk is the test named "every rendered row is live, or visibly disabled with its owner named".
 * It renders the app's real command wiring beside the palette, opens it, and checks every rendered row
 * against the bus: a row the user can activate MUST have a subscribed handler, and a row whose handler
 * is missing MUST be disabled and MUST name the consumer the registry blames. There is no third state,
 * and no row is silently absent — `derives every palette entry from the catalogue` is the other half.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConnectionProfile, DatabaseInfo, QueryHistoryEntry } from '@joinery/shared';

import { handlerCount, subscribeCommand, type CommandId } from '../../commands';
import { COMMAND_CATALOGUE, paletteCommandIds } from '../../commands/catalogue';
import { COMMAND_CONSUMERS, COMMAND_IDS } from '../../commands/registry';
import { BackupDialogs } from '../backup';
import { ConnectionDialogs } from '../connections';
import { QueryCommands } from '../query/query-commands';
import { RestoreDialogs } from '../restore';
import { SettingsDialog } from '../settings';
import { IpcQueryProvider } from '../../ipc';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { settingsStore } from '../../state/settings';
import { tabStore } from '../../state/tab';
import { installJoineryMock } from '../../test/joinery-mock';
import { ShellCommands } from '../../shell/shell-commands';
import { StatusBar } from '../../shell/status-bar';
import { ObjectSearch } from '../object-search';
import { ShortcutsDialog } from '../shortcuts-dialog';
import { SnippetLibrary } from '../snippet-library';
import { TooltipProvider } from '../../ui';
import { CommandPalette } from './command-palette';

const HISTORY: QueryHistoryEntry[] = [
  {
    id: 'hist-1',
    connectionId: 'conn-1',
    connectionName: 'Test PG',
    database: 'joinery_test',
    sql: 'SELECT id,\n  email\nFROM customers ORDER BY id',
    executedAt: '2026-08-15T12:00:00.000Z',
    executionTimeMs: 12,
    success: true,
  },
];

const teardowns: (() => void)[] = [];

beforeEach(() => {
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warning: () => undefined,
    }),
    // The history read is what the palette itself needs. The two progress subscriptions belong to the
    // backup and restore dialogs, which are mounted here only so their command handlers are the real
    // ones — a partial mock has to answer for every namespace the mounted tree touches.
    installJoineryMock({
      query: { getHistory: vi.fn(() => Promise.resolve(HISTORY)) },
      backup: { onProgress: () => () => undefined },
      restore: { onProgress: () => () => undefined },
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  tabStore.getState().closeAllTabs();
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
  });
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

/**
 * The palette plus the app's REAL command wiring — the same set `commands/bus.spec.tsx` mounts, and for
 * the same reason: a walk over palette rows means nothing unless the handlers it is asking about are the
 * ones the app actually registers. `QueryCommands` stands in for a query tab (the panel is a Monaco host
 * and cannot mount in jsdom), which is exactly why it exists as its own component.
 */
function renderPalette(options: { readonly withQueryTab?: boolean } = {}) {
  const noop = () => undefined;
  const rendered = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <ShellCommands />
        <StatusBar />
        <ConnectionDialogs />
        <BackupDialogs />
        <RestoreDialogs />
        <SettingsDialog />
        <ObjectSearch />
        <SnippetLibrary />
        <ShortcutsDialog />
        {options.withQueryTab === false ? null : (
          <QueryCommands
            isActive={() => true}
            onExecute={noop}
            onExecuteSelection={noop}
            onCancel={noop}
            onFormat={noop}
            onFind={noop}
            onReplace={noop}
            onToggleComment={noop}
            onSave={noop}
            onSaveAs={noop}
            onOpenFile={noop}
            onToggleResults={noop}
            onInsertSnippet={noop}
          />
        )}
        <CommandPalette />
      </TooltipProvider>
    </IpcQueryProvider>
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/** Opens the palette the way a user does. */
async function openPalette(): Promise<HTMLElement> {
  await userEvent.keyboard('{Meta>}k{/Meta}');
  const overlay = await screen.findByTestId('palette-overlay');
  return overlay;
}

/** Every rendered row's key, state and visible text. */
function rows(): { key: string; state: string; text: string; disabled: boolean }[] {
  return screen.getAllByTestId('palette-row').map(row => {
    const label = within(row).getByTestId('palette-row-label');
    return {
      key: label.getAttribute('data-palette-key') ?? '',
      state: label.getAttribute('data-palette-state') ?? '',
      text: row.textContent ?? '',
      disabled: row.getAttribute('data-disabled') === 'true',
    };
  });
}

/** A live connection, so the connection-gated entries are actionable. */
function connect(): void {
  const profile: ConnectionProfile = {
    id: 'conn-1',
    name: 'Test PG',
    engine: 'postgresql',
    server: '127.0.0.1',
    port: 15432,
    authenticationType: 'sql',
    username: 'joinery',
    database: 'joinery_test',
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15,
  };
  connectionStore.setState({
    profiles: [profile],
    connectedProfileIds: new Set(['conn-1']),
    databasesByConnection: new Map([
      ['conn-1', [{ name: 'joinery_test', state: 'online' }] as unknown as DatabaseInfo[]],
    ]),
  });
}

describe('the command palette', () => {
  it('opens on ⌘K, closes on Escape, and reopens on ⇧⌘P', async () => {
    renderPalette();

    await openPalette();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('palette-overlay')).toBeNull());

    await userEvent.keyboard('{Meta>}{Shift>}p{/Shift}{/Meta}');
    expect(await screen.findByTestId('palette-overlay')).not.toBeNull();
  });

  /**
   * Two overlays at once, asserted **deliberately** rather than left to drift.
   *
   * ⌘P is the object search's own document listener and it does not ask whether another overlay is
   * open, so pressing it over the palette stacks a second Radix dialog on top of the first. That is
   * the behaviour today, it is survivable (Escape unwinds the stack one layer at a time, topmost
   * first, because Radix's dismissable-layer stack only lets the top layer react), and it is the sort
   * of thing that changes by accident. If a future change makes the second keystroke replace the
   * first overlay instead of stacking on it, this test fails and the change is a decision.
   */
  it('stacks a second overlay when ⌘P is pressed over it, and Escape unwinds one at a time', async () => {
    renderPalette();
    await openPalette();

    await userEvent.keyboard('{Meta>}p{/Meta}');
    expect(await screen.findByTestId('objsearch-overlay')).not.toBeNull();
    // Both mounted. The palette is underneath, inert to the keyboard but still on screen.
    expect(screen.getByTestId('palette-overlay')).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('objsearch-overlay')).toBeNull());
    expect(screen.getByTestId('palette-overlay')).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('palette-overlay')).toBeNull());
  });

  it('reports a command whose handler vanished between build and Enter', async () => {
    // The residual window the model cannot close: entries carry the state they had when the list was
    // built, and a surface can unmount before the user presses Enter. The bus's own warning is
    // DEV-only, so the palette says it out loud — otherwise a packaged build swallows the dispatch.
    const reported: string[] = [];
    teardowns.push(
      setDiagnosticsSink({ error: context => reported.push(context), warn: () => undefined })
    );
    // `open-query-history` is unowned in the app (Task 19), so this subscription is its ONLY handler —
    // which is what makes removing it below a real residual window rather than a no-op.
    const off = subscribeCommand('open-query-history', vi.fn());
    renderPalette();
    await openPalette();

    await userEvent.type(screen.getByTestId('palette-input'), 'query history');
    const row = screen.getAllByTestId('palette-row')[0];
    expect(
      within(row as HTMLElement)
        .getByTestId('palette-row-label')
        .getAttribute('data-palette-key')
    ).toBe('command:open-query-history');
    // The handler goes away AFTER the row was built and rendered as `ready`.
    off();
    await userEvent.click(row as HTMLElement);

    expect(reported.some(context => context.includes('no handler subscribed'))).toBe(true);
  });

  it('derives every palette entry from the catalogue, and nothing else', async () => {
    renderPalette();
    await openPalette();

    const commandRows = rows()
      .filter(row => row.key.startsWith('command:'))
      .map(row => row.key.replace('command:', ''));

    // Exactly the catalogue's `palette.show` set — no extras, none missing. This is the assertion that
    // makes "a command exists but the palette does not list it" impossible, in both directions.
    expect([...commandRows].sort()).toEqual([...paletteCommandIds()].sort());
  });

  /**
   * THE WALK. Every row the palette renders is in one of exactly two states.
   */
  it('renders every row live, or visibly disabled with its owner named', async () => {
    // Connected, so the walk covers the ready path of the connection-gated entries too; the
    // disabled-with-a-reason path is its own test below.
    connect();
    // A query tab as well, so the twelve query-editor commands are on their ready path here rather than
    // on the "open a query tab first" one — which `disables a connection-gated row` covers.
    tabStore.getState().openQueryTab('conn-1', 'joinery_test', 'SELECT 1', false, false);
    renderPalette();
    await openPalette();

    const walked = rows();
    expect(walked.length).toBeGreaterThan(20);

    for (const row of walked) {
      if (!row.key.startsWith('command:')) {
        // Local actions and recent queries hold closures, not ids — `palette-actions.ts` explains why
        // they cannot be dead, and `palette-actions.spec.ts` proves each one does something.
        expect(row.state, `${row.key}`).toBe('ready');
        continue;
      }

      const id = row.key.replace('command:', '') as CommandId;
      const live = handlerCount(id) > 0;

      if (row.state === 'unowned') {
        // Its precondition is satisfied and nothing is subscribed — so the row must be inert AND must
        // say whose job it is. The owner text is derived from `COMMAND_CONSUMERS`, so it cannot drift.
        expect(live, `${id} is disabled as unowned but HAS a handler`).toBe(false);
        expect(row.disabled, `${id} claims to be unowned but is not disabled`).toBe(true);
        expect(row.text).toContain('Not wired yet');
        expect(row.text).toMatch(/Task \d+/);
        expect(COMMAND_CONSUMERS[id]).toContain(
          row.text.split('Not wired yet — ')[1]?.slice(0, 20)
        );
        continue;
      }

      if (row.state === 'unavailable') {
        // Not applicable right now. Nothing is claimed about handlers here: the row is inert, so it
        // dispatches nothing — and the reason is the useful half. That is also why the precondition is
        // asked BEFORE the handler question (`palette-model.ts` explains what the other order said).
        expect(row.disabled, `${id} is unavailable but not disabled`).toBe(true);
        expect(row.text.length).toBeGreaterThan(COMMAND_CATALOGUE[id].label.length);
        continue;
      }

      // THE property: a row the user can act on reaches a live handler. Nothing else is `ready`.
      expect(row.state).toBe('ready');
      expect(row.disabled).toBe(false);
      expect(live, `${id} is actionable in the palette with no handler subscribed`).toBe(true);
    }
  });

  it('names an owner that is really the registry-declared consumer', async () => {
    // The disabled copy is derived, not authored: `open-query-history` has no owner yet, and the row
    // has to name the same task `COMMAND_CONSUMERS` does.
    renderPalette();
    await openPalette();

    const historyRow = rows().find(row => row.key === 'command:open-query-history');
    expect(historyRow?.state).toBe('unowned');
    expect(historyRow?.text).toContain('Task 19');
    expect(COMMAND_CONSUMERS['open-query-history']).toContain('Task 19');
  });

  it('dispatches the command when a live row is chosen, and closes first', async () => {
    const handler = vi.fn();
    teardowns.push(subscribeCommand('show-welcome', handler));
    renderPalette();
    await openPalette();

    await userEvent.type(screen.getByTestId('palette-input'), 'welcome tab');
    const row = screen.getAllByTestId('palette-row')[0];
    expect(row).toBeDefined();
    await userEvent.click(row as HTMLElement);

    expect(handler).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByTestId('palette-overlay')).toBeNull());
  });

  it('runs a local action — the theme entries write the settings store', async () => {
    renderPalette();
    await openPalette();

    await userEvent.type(screen.getByTestId('palette-input'), 'theme ivory');
    await userEvent.click(screen.getAllByTestId('palette-row')[0] as HTMLElement);

    expect(settingsStore.getState().settings.theme).toBe('light');
  });

  it('disables a connection-gated row with a reason until something is connected', async () => {
    renderPalette();
    await openPalette();

    const backupBefore = rows().find(row => row.key === 'command:open-backup-dialog');
    expect(backupBefore?.state).toBe('unavailable');
    expect(backupBefore?.disabled).toBe(true);
    expect(backupBefore?.text).toContain('Connect to a server first');

    // Closing and reopening rebuilds the entries, which is when the requirement is re-evaluated.
    await userEvent.keyboard('{Escape}');
    connect();
    await openPalette();

    const backupAfter = rows().find(row => row.key === 'command:open-backup-dialog');
    expect(backupAfter?.state).toBe('ready');
    expect(backupAfter?.disabled).toBe(false);
  });

  it('refuses to act on a disabled row', async () => {
    const handler = vi.fn();
    teardowns.push(subscribeCommand('open-backup-dialog', handler));
    renderPalette();
    await openPalette();

    const row = screen
      .getAllByTestId('palette-row')
      .find(candidate =>
        within(candidate)
          .getByTestId('palette-row-label')
          .getAttribute('data-palette-key')
          ?.includes('open-backup-dialog')
      );
    await userEvent.click(row as HTMLElement);

    expect(handler).not.toHaveBeenCalled();
    // Still open: a click on an inert row is not a dismissal.
    expect(screen.getByTestId('palette-overlay')).not.toBeNull();
  });

  it('shows the accelerator the catalogue declares, for the commands that have one', async () => {
    renderPalette();
    await openPalette();

    const sidebarRow = screen
      .getAllByTestId('palette-row')
      .find(candidate =>
        within(candidate)
          .getByTestId('palette-row-label')
          .getAttribute('data-palette-key')
          ?.includes('toggle-sidebar')
      );
    expect(sidebarRow).toBeDefined();
    // jsdom is not a Mac, so the non-Mac spelling is what renders.
    expect(within(sidebarRow as HTMLElement).getByTestId('palette-row-keys').textContent).toBe(
      'CmdOrCtrl+\\'
    );
  });

  it('offers recent queries, and opening one does not execute it', async () => {
    connect();
    renderPalette();
    await openPalette();

    const recent = await waitFor(() => {
      const found = rows().find(row => row.key === 'recent:hist-1');
      expect(found).toBeDefined();
      return found;
    });
    // Collapsed to one line, so a three-line query is still a readable row.
    expect(recent?.text).toContain('SELECT id, email FROM customers');

    await userEvent.click(
      screen
        .getAllByTestId('palette-row')
        .find(candidate =>
          within(candidate)
            .getByTestId('palette-row-label')
            .getAttribute('data-palette-key')
            ?.includes('recent:hist-1')
        ) as HTMLElement
    );

    const tabs = tabStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.databaseName).toBe('joinery_test');
    // Ruling 13: only an affordance whose label promises a run may execute on open.
    expect(tabs[0]?.autoExecute ?? false).toBe(false);
    expect(tabStore.getState().getTabContent(tabs[0]?.id ?? '')).toContain('FROM customers');
  });

  it('filters with the shared matcher, and says when nothing matches', async () => {
    renderPalette();
    await openPalette();

    await userEvent.type(screen.getByTestId('palette-input'), 'zzqqxv');
    expect(screen.queryAllByTestId('palette-row')).toHaveLength(0);
    expect(screen.getByTestId('palette-empty')).not.toBeNull();

    await userEvent.clear(screen.getByTestId('palette-input'));
    await userEvent.type(screen.getByTestId('palette-input'), 'format');
    const filtered = rows();
    expect(filtered[0]?.key).toBe('command:format-sql');
    expect(filtered.length).toBeLessThan(10);
  });

  it('counts what it is showing out of what it has', async () => {
    renderPalette();
    await openPalette();

    const total = rows().length;
    expect(screen.getByTestId('palette-count').textContent).toBe(`${total} of ${total}`);
  });
});
