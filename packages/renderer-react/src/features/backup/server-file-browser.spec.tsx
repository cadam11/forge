/**
 * The server file browser, mounted for real.
 *
 * What is worth asserting, and why:
 *
 *  - **Navigation, both ways.** Drive list → drive → folder → back up, and the drive-root boundary,
 *    which is the case the Angular original's `lastSlash <= 2` handled by accident. `server-path.spec.ts`
 *    pins the arithmetic; this pins that the component walks it.
 *  - **One request per location, and only the one being shown.** Exactly one of the two queries is
 *    enabled at a time, and a revisit is served from the cache — the Angular version re-fetched on every
 *    navigation.
 *  - **The two modes mean different things.** `save` needs a directory and a typed name; `open` needs an
 *    existing file, and a selected *folder* is not an answer.
 *  - **Errors are recoverable in place.** `serverFs.*` throws for a non-MSSQL profile by design
 *    (`server-fs.ipc.ts:assertServerFileBrowsing`), so a stated error with a retry is the ordinary path,
 *    not an exception.
 *
 * jsdom has no layout engine, so the virtualizer is fed a viewport the way `ui/tree.spec.tsx` and
 * `sidebar.spec.tsx` do — see LAYOUT_FAKES.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ServerDrive, ServerFileEntry } from '@joinery/shared';

import { installJoineryMock, removeJoineryMock } from '../../test/joinery-mock';
import { IpcQueryProvider } from '../../ipc';
import { Dialog, DialogContent, DialogTitle, TooltipProvider } from '../../ui';
import { setDiagnosticsSink } from '../../state/diagnostics';
import { ServerFileBrowser, type ServerFilePick } from './server-file-browser';

// ── the virtualizer's viewport ───────────────────────────────────────────────────────────────

const LIST_TESTID = 'backup-file-browser-list';
const VIEWPORT_HEIGHT = 480;

/** Scoped to the entry list, restored afterwards. See `ui/tree.spec.tsx` for the full reasoning. */
const LAYOUT_FAKES = [
  { owner: HTMLElement.prototype, name: 'offsetHeight', value: VIEWPORT_HEIGHT },
  { owner: Element.prototype, name: 'clientHeight', value: VIEWPORT_HEIGHT },
] as const;

const ORIGINAL_LAYOUT = LAYOUT_FAKES.map(fake =>
  Object.getOwnPropertyDescriptor(fake.owner, fake.name)
);

beforeAll(() => {
  for (const fake of LAYOUT_FAKES) {
    Object.defineProperty(fake.owner, fake.name, {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute('data-testid') === LIST_TESTID ? fake.value : 0;
      },
    });
  }
});

afterAll(() => {
  for (const [index, fake] of LAYOUT_FAKES.entries()) {
    const descriptor = ORIGINAL_LAYOUT[index];
    if (descriptor === undefined) throw new Error(`${fake.name} had no descriptor to restore`);
    Object.defineProperty(fake.owner, fake.name, descriptor);
  }
});

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────

const CONNECTION_ID = 'conn-1';

const DRIVES: ServerDrive[] = [
  { drive: 'C:', freeSpaceMB: 51_200 },
  { drive: 'D:', freeSpaceMB: 1024 },
];

function entry(directory: string, name: string, isDirectory: boolean): ServerFileEntry {
  return {
    name,
    path: `${directory}${directory.endsWith('\\') ? '' : '\\'}${name}`,
    isDirectory,
    depth: 1,
  };
}

/** `C:\` holds one folder and one file; `C:\Backups` holds two backups and an unrelated data file. */
const LISTINGS: Record<string, ServerFileEntry[]> = {
  'C:\\': [entry('C:\\', 'Backups', true), entry('C:\\', 'stray.bak', false)],
  'C:\\Backups': [
    entry('C:\\Backups', 'sales.bak', false),
    entry('C:\\Backups', 'orders.bak', false),
    entry('C:\\Backups', 'sales.mdf', false),
  ],
};

const teardowns: (() => void)[] = [];
let getDrives: ReturnType<typeof vi.fn>;
let listDirectory: ReturnType<typeof vi.fn>;

function installBridge(): void {
  getDrives = vi.fn(() => Promise.resolve(DRIVES));
  listDirectory = vi.fn((_id: string, path: string) => Promise.resolve(LISTINGS[path] ?? []));
  teardowns.push(installJoineryMock({ serverFs: { getDrives, listDirectory } }));
}

/**
 * The browser inside a real `Dialog`, because it renders a `DialogBody` and a `DialogActions` — it is
 * the body of its host's dialog rather than a dialog of its own (see the component's header).
 */
function mountBrowser(props: Partial<Parameters<typeof ServerFileBrowser>[0]> = {}) {
  const onPick = vi.fn<(pick: ServerFilePick) => void>();
  const onCancel = vi.fn();
  const rendered = render(
    <IpcQueryProvider>
      <TooltipProvider>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Choose a backup location</DialogTitle>
            <ServerFileBrowser
              connectionId={CONNECTION_ID}
              mode="save"
              onCancel={onCancel}
              onPick={onPick}
              {...props}
            />
          </DialogContent>
        </Dialog>
      </TooltipProvider>
    </IpcQueryProvider>
  );
  return { ...rendered, onPick, onCancel };
}

function entryNames(): string[] {
  return screen
    .getAllByTestId('backup-file-browser-entry')
    .map(element => element.textContent ?? '');
}

beforeEach(() => {
  installBridge();
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  vi.clearAllMocks();
});

describe('opening', () => {
  it('starts on the drive list, and asks for nothing else', async () => {
    mountBrowser();

    await screen.findByTestId('backup-file-browser-drives');
    expect(screen.getAllByTestId('backup-file-browser-drive')).toHaveLength(2);
    // Only the query that is being shown is enabled — the directory listing has not been asked for.
    expect(listDirectory).not.toHaveBeenCalled();
    expect(getDrives).toHaveBeenCalledExactlyOnceWith(CONNECTION_ID);
  });

  it('shows each drive’s free space in bytes the user recognises', async () => {
    mountBrowser();
    const drives = await screen.findAllByTestId('backup-file-browser-drive');
    expect(drives[0]?.textContent).toContain('50 GB free');
    expect(drives[1]?.textContent).toContain('1 GB free');
  });

  it('starts in the directory of a path it was given', async () => {
    mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });

    await screen.findByTestId(LIST_TESTID);
    expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\Backups', true);
    expect(getDrives).not.toHaveBeenCalled();
  });

  it('takes the file name from the path it was given', async () => {
    mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });
    const name = (await screen.findByTestId('backup-file-browser-filename')) as HTMLInputElement;
    expect(name.value).toBe('sales.bak');
  });

  it('prefers an explicit default name over the one in the path', async () => {
    mountBrowser({ initialPath: 'C:\\Backups\\old.bak', defaultFileName: 'fresh.bak' });
    const name = (await screen.findByTestId('backup-file-browser-filename')) as HTMLInputElement;
    expect(name.value).toBe('fresh.bak');
  });
});

describe('navigating', () => {
  it('walks down into a drive and then a folder', async () => {
    const user = userEvent.setup();
    mountBrowser();
    await screen.findByTestId('backup-file-browser-drives');

    await user.click(screen.getAllByTestId('backup-file-browser-drive')[0] as HTMLElement);
    await screen.findByTestId(LIST_TESTID);
    expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\', true);

    // A double-click opens a folder; a single click only selects it.
    await user.dblClick(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);
    await waitFor(() =>
      expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\Backups', true)
    );
  });

  it('sorts directories above files, then by name', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);

    // `orders.bak` comes back from the server after `sales.bak`.
    expect(entryNames()).toEqual(['orders.bak', 'sales.bak', 'sales.mdf']);
    await user.click(screen.getByTestId('backup-file-browser-up'));
    await waitFor(() => expect(entryNames()).toEqual(['Backups', 'stray.bak']));
  });

  it('goes up from a folder to the drive’s browsable root', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.click(screen.getByTestId('backup-file-browser-up'));

    // `C:\`, not `C:` — the latter is not a path the listing call can read.
    await waitFor(() => expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\', true));
  });

  it('goes up from a drive root to the drive list', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\stray.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.click(screen.getByTestId('backup-file-browser-up'));

    await screen.findByTestId('backup-file-browser-drives');
    expect(getDrives).toHaveBeenCalledOnce();
    // And there is nowhere further up.
    expect((screen.getByTestId('backup-file-browser-up') as HTMLButtonElement).disabled).toBe(true);
  });

  it('serves a revisited folder from the cache instead of asking again', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });
    await screen.findByTestId(LIST_TESTID);
    expect(listDirectory).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId('backup-file-browser-up'));
    await waitFor(() => expect(entryNames()).toEqual(['Backups', 'stray.bak']));
    await user.dblClick(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);
    await waitFor(() => expect(entryNames()).toEqual(['orders.bak', 'sales.bak', 'sales.mdf']));

    // Two locations, two requests — the second visit to `C:\Backups` is the cached one.
    expect(listDirectory).toHaveBeenCalledTimes(2);
  });

  it('navigates to a typed path on Enter, without submitting anything', async () => {
    const user = userEvent.setup();
    mountBrowser();
    await screen.findByTestId('backup-file-browser-drives');

    await user.type(screen.getByTestId('backup-file-browser-path'), 'C:\\Backups{Enter}');

    await waitFor(() =>
      expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\Backups', true)
    );
  });

  it('navigates to a typed path from the Go button', async () => {
    const user = userEvent.setup();
    mountBrowser();
    await screen.findByTestId('backup-file-browser-drives');

    await user.type(screen.getByTestId('backup-file-browser-path'), '  C:\\Backups  ');
    await user.click(screen.getByTestId('backup-file-browser-go'));

    // Trimmed — a pasted path routinely carries whitespace.
    await waitFor(() =>
      expect(listDirectory).toHaveBeenCalledWith(CONNECTION_ID, 'C:\\Backups', true)
    );
  });

  it('shows the empty state for a folder with nothing in it', async () => {
    mountBrowser({ initialPath: 'C:\\Empty\\x.bak' });
    const empty = await screen.findByTestId('backup-file-browser-empty');
    expect(empty.textContent).toContain('This folder is empty');
  });
});

describe('the extension filter', () => {
  it('narrows an OPEN, hiding non-matching files and keeping folders', async () => {
    mountBrowser({ mode: 'open', initialPath: 'C:\\Backups\\sales.bak', extension: 'bak' });
    await screen.findByTestId(LIST_TESTID);

    expect(entryNames()).toEqual(['orders.bak', 'sales.bak']);
    expect(screen.getByTestId('backup-file-browser-filter').textContent).toContain('.bak');
  });

  it('does NOT narrow a save, and says nothing about a filter it is not applying', async () => {
    // A save browser is choosing a location: what is already in the folder is context, and hiding it
    // also compounds `server-filesystem.ts:112`'s BIT-as-boolean bug — with every entry misreported as
    // a file, a filtered save browser renders "This folder is empty" and cannot be navigated at all.
    // The Task 12 browser gate hit exactly that against the live container.
    mountBrowser({ mode: 'save', initialPath: 'C:\\Backups\\sales.bak', extension: 'bak' });
    await screen.findByTestId(LIST_TESTID);

    expect(entryNames()).toEqual(['orders.bak', 'sales.bak', 'sales.mdf']);
    expect(screen.queryByTestId('backup-file-browser-filter')).toBeNull();
  });
});

describe('save mode', () => {
  it('refuses to confirm from the drive list, where there is no directory yet', async () => {
    mountBrowser();
    await screen.findByTestId('backup-file-browser-drives');
    expect((screen.getByTestId('backup-file-browser-confirm') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('refuses to confirm with no name', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.clear(screen.getByTestId('backup-file-browser-filename'));

    expect((screen.getByTestId('backup-file-browser-confirm') as HTMLButtonElement).disabled).toBe(
      true
    );
  });

  it('joins the directory and the typed name, trimming the name', async () => {
    const user = userEvent.setup();
    const { onPick } = mountBrowser({ initialPath: 'C:\\Backups\\sales.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.clear(screen.getByTestId('backup-file-browser-filename'));
    await user.type(screen.getByTestId('backup-file-browser-filename'), '  nightly.bak  ');
    await user.click(screen.getByTestId('backup-file-browser-confirm'));

    expect(onPick).toHaveBeenCalledWith({
      path: 'C:\\Backups\\nightly.bak',
      fileName: 'nightly.bak',
    });
  });

  it('writes a clicked file’s name into the box, so overwriting is one click', async () => {
    const user = userEvent.setup();
    mountBrowser({ initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.click(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);

    expect((screen.getByTestId('backup-file-browser-filename') as HTMLInputElement).value).toBe(
      'orders.bak'
    );
  });

  it('does not double the separator at a drive root', async () => {
    const user = userEvent.setup();
    const { onPick } = mountBrowser({ initialPath: 'C:\\stray.bak', defaultFileName: 'db.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.click(screen.getByTestId('backup-file-browser-confirm'));

    expect(onPick).toHaveBeenCalledWith({ path: 'C:\\db.bak', fileName: 'db.bak' });
  });
});

describe('open mode', () => {
  it('has no file-name box at all', async () => {
    mountBrowser({ mode: 'open', initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);
    expect(screen.queryByTestId('backup-file-browser-filename')).toBeNull();
  });

  it('refuses to confirm until an existing file is selected', async () => {
    const user = userEvent.setup();
    mountBrowser({ mode: 'open', initialPath: 'C:\\stray.bak' });
    await screen.findByTestId(LIST_TESTID);
    const confirm = screen.getByTestId('backup-file-browser-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    // A FOLDER is a navigation target, not an answer.
    await user.click(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);
    expect(confirm.disabled).toBe(true);

    await user.click(screen.getAllByTestId('backup-file-browser-entry')[1] as HTMLElement);
    expect(confirm.disabled).toBe(false);
  });

  it('picks the selected file, and marks it selected for a screen reader', async () => {
    const user = userEvent.setup();
    const { onPick } = mountBrowser({ mode: 'open', initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);

    const first = screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement;
    await user.click(first);
    expect(first.getAttribute('aria-current')).toBe('true');

    await user.click(screen.getByTestId('backup-file-browser-confirm'));
    expect(onPick).toHaveBeenCalledWith({
      path: 'C:\\Backups\\orders.bak',
      fileName: 'orders.bak',
    });
  });

  it('picks a file on a double-click', async () => {
    const user = userEvent.setup();
    const { onPick } = mountBrowser({ mode: 'open', initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.dblClick(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);

    expect(onPick).toHaveBeenCalledWith({
      path: 'C:\\Backups\\orders.bak',
      fileName: 'orders.bak',
    });
  });

  it('clears the selection when the folder changes', async () => {
    const user = userEvent.setup();
    mountBrowser({ mode: 'open', initialPath: 'C:\\Backups\\x.bak' });
    await screen.findByTestId(LIST_TESTID);

    await user.click(screen.getAllByTestId('backup-file-browser-entry')[0] as HTMLElement);
    await user.click(screen.getByTestId('backup-file-browser-up'));
    await waitFor(() => expect(entryNames()).toEqual(['Backups', 'stray.bak']));

    // A stale selection would let Select return a path that is no longer on screen.
    expect((screen.getByTestId('backup-file-browser-confirm') as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});

describe('failures', () => {
  it('states the server’s own reason, and retries in place', async () => {
    // What a non-MSSQL profile actually produces: `server-fs.ipc.ts:assertServerFileBrowsing` throws
    // with the dialect's label, which is a sentence worth showing rather than swallowing.
    const message =
      'Server file browsing is not supported for PostgreSQL. Use a local file path instead.';
    getDrives.mockRejectedValueOnce(new Error(message));

    const user = userEvent.setup();
    mountBrowser();

    const error = await screen.findByTestId('backup-file-browser-error');
    expect(error.textContent).toContain(message);

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('backup-file-browser-drives');
    expect(getDrives).toHaveBeenCalledTimes(2);
  });

  it('does not retry a failed listing on its own', async () => {
    listDirectory.mockRejectedValue(new Error('Access is denied.'));
    mountBrowser({ initialPath: 'C:\\Windows\\x.bak' });

    await screen.findByTestId('backup-file-browser-error');
    // `retry: false`: a permission error does not become a success by asking four more times, and each
    // ask is a round trip to a SQL Server.
    expect(listDirectory).toHaveBeenCalledTimes(1);
  });

  it('hands cancellation straight back to the host', async () => {
    const user = userEvent.setup();
    const { onCancel, onPick } = mountBrowser();
    await screen.findByTestId('backup-file-browser-drives');

    await user.click(screen.getByTestId('backup-file-browser-cancel'));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPick).not.toHaveBeenCalled();
  });
});
