/**
 * The wizard, mounted for real against a partial bridge.
 *
 * The block that matters most is **"the confirmation cannot be got around"**. Everything else in this
 * file is the ordinary wizard-shaped risk — the probe branch, the option matrix, the progress stream —
 * but restore is the one workflow in Joinery that destroys data, and the Angular dialog it replaces had
 * no confirmation at all. So the assertions there are written as attempts to reach `restore.start`
 * without confirming, rather than as descriptions of the confirmation's markup: a click, a keystroke,
 * an implicit form submit, a name that only looks new, and a database list that never loaded.
 *
 * A recording notifier is installed in every `beforeEach`, so a stray toast is capturable anywhere, and
 * asserted empty at each of the outcomes the Angular dialog reported through one (J-42).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  BackupFileInfo,
  BackupHistoryEntry,
  CliDepsResult,
  ConnectionProfile,
  DatabaseEngine,
  DatabaseInfo,
  RestoreProgress,
  ServerDefaultPaths,
} from '@joinery/shared';

import {
  installJoineryMock,
  recordSubscription,
  removeJoineryMock,
  type RecordedSubscription,
} from '../../test/joinery-mock';
import { dispatchCommand } from '../../commands';
import { IpcQueryProvider } from '../../ipc';
import { TooltipProvider } from '../../ui';
import { capabilitiesStore } from '../../state/capabilities';
import { connectionStore } from '../../state/connection';
import {
  dbOperationKey,
  dbOperationsStore,
  resetDbOperationsForTests,
} from '../../state/db-operations';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { RestoreDialog } from './restore-dialog';
import { RestoreDialogs } from './restore-dialogs';

// ── the shared file browser's viewport ───────────────────────────────────────────────────────
//
// jsdom has no layout engine, so `ServerFileBrowser`'s virtualized entry list measures zero and renders
// no rows. Scoped to that one element by testid and restored afterwards, exactly as `ui/tree.spec.tsx`,
// `sidebar.spec.tsx` and `server-file-browser.spec.tsx` do — this dialog hosts the same component.

const LIST_TESTID = 'backup-file-browser-list';
const VIEWPORT_HEIGHT = 480;

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

const CONNECTION_ID = 'conn-1';
/** The databases the bridge double reports. `sales` is the one that already exists. */
const EXISTING = ['postgres', 'sales'];

const TOOLS_PRESENT: CliDepsResult = {
  engine: 'postgresql',
  platform: 'darwin',
  tools: [
    { tool: 'pg_dump', available: true, version: 'pg_dump (PostgreSQL) 16.1' },
    { tool: 'pg_restore', available: true, version: 'pg_restore (PostgreSQL) 16.1' },
  ],
  allAvailable: true,
};

const TOOLS_MISSING: CliDepsResult = {
  engine: 'postgresql',
  platform: 'darwin',
  tools: [
    { tool: 'pg_dump', available: false },
    { tool: 'pg_restore', available: false },
  ],
  allAvailable: false,
  installInstructions: {
    engine: 'postgresql',
    platform: 'darwin',
    title: 'Install PostgreSQL client tools',
    steps: [{ description: 'Install them with Homebrew.', command: 'brew install postgresql@16' }],
    notes: [],
  },
};

const DEFAULT_PATHS: ServerDefaultPaths = {
  dataPath: 'C:\\Data',
  logPath: 'C:\\Logs',
  backupPath: 'C:\\Backups',
};

const BACKUP_INFO: BackupFileInfo = {
  databaseName: 'sales',
  backupType: 'Full',
  backupDate: '2026-08-15T02:04:00.000Z',
  backupFinishDate: '2026-08-15T02:04:00.000Z',
  backupSizeBytes: 5 * 1024 * 1024,
  files: [
    { logicalName: 'sales', physicalName: 'C:\\Data\\sales.mdf', type: 'D', fileType: 'D' },
    { logicalName: 'sales_log', physicalName: 'C:\\Logs\\sales_log.ldf', type: 'L', fileType: 'L' },
  ],
};

const HISTORY: BackupHistoryEntry[] = [
  {
    databaseName: 'sales',
    backupType: 'Full',
    backupStartDate: '2026-08-15T02:00:00.000Z',
    backupFinishDate: '2026-08-15T02:04:00.000Z',
    backupSizeBytes: 5 * 1024 * 1024,
    physicalDeviceName: 'C:\\Backups\\sales_full.bak',
    serverName: 'SQL01',
    recoveryModel: 'FULL',
    userName: 'sa',
  },
];

interface Bridge {
  readonly checkTools: ReturnType<typeof vi.fn>;
  readonly recheckTools: ReturnType<typeof vi.fn>;
  readonly start: ReturnType<typeof vi.fn>;
  readonly createDatabase: ReturnType<typeof vi.fn>;
  readonly listDatabases: ReturnType<typeof vi.fn>;
  readonly getBackupInfo: ReturnType<typeof vi.fn>;
  readonly getHistory: ReturnType<typeof vi.fn>;
  readonly getDefaultPaths: ReturnType<typeof vi.fn>;
  readonly showOpenDialog: ReturnType<typeof vi.fn>;
  readonly openExternal: ReturnType<typeof vi.fn>;
  readonly progress: RecordedSubscription<RestoreProgress>;
}

const teardowns: (() => void)[] = [];
let bridge: Bridge;
/** Every notification raised during a test. Asserted empty — see the header. */
let notifications: string[] = [];

function installBridge(tools: CliDepsResult = TOOLS_PRESENT): Bridge {
  const progress = recordSubscription<RestoreProgress>();
  const installed: Bridge = {
    checkTools: vi.fn(() => Promise.resolve(tools)),
    recheckTools: vi.fn(() => Promise.resolve(TOOLS_PRESENT)),
    start: vi.fn(() => Promise.resolve()),
    createDatabase: vi.fn(() => Promise.resolve({ success: true, tsql: 'CREATE DATABASE x' })),
    listDatabases: vi.fn(() =>
      Promise.resolve(EXISTING.map(name => ({ name }) as unknown as DatabaseInfo))
    ),
    getBackupInfo: vi.fn(() => Promise.resolve(BACKUP_INFO)),
    getHistory: vi.fn(() => Promise.resolve(HISTORY)),
    getDefaultPaths: vi.fn(() => Promise.resolve(DEFAULT_PATHS)),
    showOpenDialog: vi.fn(() =>
      Promise.resolve({ canceled: false, filePaths: ['/tmp/chosen.dump'] })
    ),
    openExternal: vi.fn(() => Promise.resolve()),
    progress,
  };

  teardowns.push(
    installJoineryMock({
      backup: {
        checkTools: installed.checkTools,
        recheckTools: installed.recheckTools,
        getHistory: installed.getHistory,
        onProgress: () => () => undefined,
      },
      restore: {
        start: installed.start,
        getBackupInfo: installed.getBackupInfo,
        onProgress: progress.subscribe,
      },
      database: { list: installed.listDatabases, create: installed.createDatabase },
      serverFs: {
        getDefaultPaths: installed.getDefaultPaths,
        getDrives: () => Promise.resolve([{ drive: 'C:', freeSpaceMB: 51_200 }]),
        listDirectory: () =>
          Promise.resolve([
            {
              name: 'sales_full.bak',
              path: 'C:\\Backups\\sales_full.bak',
              isDirectory: false,
              depth: 1,
            },
          ]),
      },
      app: { showOpenDialog: installed.showOpenDialog, openExternal: installed.openExternal },
      connection: { list: () => Promise.resolve([]) },
    })
  );
  return installed;
}

function mountDialog(
  engine: DatabaseEngine,
  overrides: {
    readonly databaseName?: string | null;
    readonly databases?: readonly string[] | null;
    readonly canCreateDatabases?: boolean;
    readonly onDismiss?: () => void;
    readonly onRestored?: (name: string) => void;
  } = {}
) {
  return render(
    <IpcQueryProvider>
      <TooltipProvider>
        <RestoreDialog
          connectionId={CONNECTION_ID}
          engine={engine}
          databaseName={overrides.databaseName ?? null}
          databases={overrides.databases === undefined ? EXISTING : overrides.databases}
          canCreateDatabases={overrides.canCreateDatabases ?? true}
          onRestored={overrides.onRestored ?? (() => undefined)}
          onDismiss={overrides.onDismiss ?? (() => undefined)}
        />
      </TooltipProvider>
    </IpcQueryProvider>
  );
}

/** Mounts and waits for the form, past the PG/MySQL host-tool probe. */
async function mountOnForm(
  engine: DatabaseEngine,
  overrides: Parameters<typeof mountDialog>[1] = {}
) {
  const rendered = mountDialog(engine, overrides);
  await screen.findByTestId('restore-path');
  return rendered;
}

async function setField(
  user: ReturnType<typeof userEvent.setup>,
  testId: string,
  value: string
): Promise<void> {
  const field = screen.getByTestId(testId);
  await user.clear(field);
  await user.type(field, value);
}

/**
 * Pick a row in the target `Select`.
 *
 * Radix renders both its own listbox and a hidden native `<select>` for form compatibility, so the
 * label matches twice; the one a user clicks is the `role="option"`.
 */
async function chooseTarget(
  user: ReturnType<typeof userEvent.setup>,
  label: string
): Promise<void> {
  await user.click(screen.getByTestId('restore-target'));
  await user.click(await targetOption(label));
}

async function targetOption(label: string): Promise<HTMLElement> {
  const matches = await screen.findAllByText(label);
  for (const match of matches) {
    const option = match.closest('[role="option"]');
    if (option !== null) return option as HTMLElement;
  }
  throw new Error(`no listbox option labelled ${label}`);
}

/** Fill in a valid PG restore into a brand-new database. Leaves the form ready to submit. */
async function fillNewTarget(
  user: ReturnType<typeof userEvent.setup>,
  target = 'sales_copy'
): Promise<void> {
  await setField(user, 'restore-path', '/tmp/sales.dump');
  await setField(user, 'restore-target-name', target);
}

function profile(engine: DatabaseEngine): ConnectionProfile {
  return {
    id: CONNECTION_ID,
    name: 'Test PG',
    engine,
    server: '127.0.0.1',
    port: 15432,
    authenticationType: 'sql',
    username: 'joinery',
    database: 'postgres',
    encrypt: false,
    trustServerCertificate: true,
    connectionTimeout: 15,
  } as ConnectionProfile;
}

beforeEach(() => {
  notifications = [];
  teardowns.push(setDiagnosticsSink({ error: () => undefined, warn: () => undefined }));
  teardowns.push(
    setNotifier({
      success: message => notifications.push(`success: ${message}`),
      info: message => notifications.push(`info: ${message}`),
      warning: message => notifications.push(`warning: ${message}`),
      error: message => notifications.push(`error: ${message}`),
    })
  );
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  removeJoineryMock();
  resetDbOperationsForTests();
  capabilitiesStore.setState({ byConnection: new Map() });
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
    selectedDatabaseByConnection: new Map(),
  });
});

// ── The one that matters ────────────────────────────────────────────────────────────────────

describe('the confirmation cannot be got around', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('never lets the options screen reach restore.start when the target already exists', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');

    await setField(user, 'restore-path', '/tmp/sales.dump');
    await setField(user, 'restore-target-name', 'sales');

    // The primary button is not even called Start any more.
    expect(screen.getByTestId('restore-submit').textContent).toContain('Review the restore');
    await user.click(screen.getByTestId('restore-submit'));

    // It landed on the confirmation and nothing has been asked of the main process.
    await screen.findByTestId('restore-confirm');
    expect(bridge.start).not.toHaveBeenCalled();
    expect(bridge.createDatabase).not.toHaveBeenCalled();
  });

  it('keeps the confirm button refused until the exact name is typed', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await setField(user, 'restore-path', '/tmp/sales.dump');
    await setField(user, 'restore-target-name', 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-confirm');

    const confirm = screen.getByTestId('restore-confirm-start') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.type(screen.getByTestId('restore-confirm-input'), 'sal');
    expect((screen.getByTestId('restore-confirm-start') as HTMLButtonElement).disabled).toBe(true);
    await user.click(confirm);
    expect(bridge.start).not.toHaveBeenCalled();

    // Wrong case is wrong, because database names can be case-sensitive.
    await setField(user, 'restore-confirm-input', 'SALES');
    expect((screen.getByTestId('restore-confirm-start') as HTMLButtonElement).disabled).toBe(true);

    await setField(user, 'restore-confirm-input', 'sales');
    expect((screen.getByTestId('restore-confirm-start') as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByTestId('restore-confirm-start'));
    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
  });

  it('will not submit on Enter in the confirmation box while the name is wrong', async () => {
    // The keyboard path and the pointer path go through the same predicate; this is the assertion
    // that keeps them from drifting apart.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await setField(user, 'restore-path', '/tmp/sales.dump');
    await setField(user, 'restore-target-name', 'sales');
    await user.click(screen.getByTestId('restore-submit'));

    const box = await screen.findByTestId('restore-confirm-input');
    await user.type(box, 'nope{Enter}');
    expect(bridge.start).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, 'sales{Enter}');
    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
  });

  it('asks anyway when the target was typed as a "new" database but is not one', async () => {
    // The hole a mode toggle would leave open: destructiveness comes from the NAME.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales');

    expect(screen.getByTestId('restore-target-note').textContent).toContain('already exists');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-confirm');
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('asks anyway when the database list could not be read', async () => {
    // Fail-safe: Joinery cannot prove the target is new, so it does not assume it is.
    const user = userEvent.setup();
    await mountOnForm('postgresql', { databases: null });
    await fillNewTarget(user, 'definitely_fresh');

    expect(screen.getByTestId('restore-target-note').textContent).toContain('could not read');
    await user.click(screen.getByTestId('restore-submit'));
    const confirm = await screen.findByTestId('restore-confirm');
    expect(confirm.textContent).toContain('cannot tell whether');
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('goes straight to the restore for a database the server has never heard of', async () => {
    // The other half: extra ceremony for a safe action is how people learn to click through the
    // dangerous one.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');

    expect(screen.getByTestId('restore-submit').textContent).toContain('Start restore');
    await user.click(screen.getByTestId('restore-submit'));

    await screen.findByTestId('restore-progress');
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
  });

  it('states what will be lost, in the engine’s own terms', async () => {
    const user = userEvent.setup();
    await mountOnForm('mysql');
    await setField(user, 'restore-path', '/tmp/sales.sql');
    await setField(user, 'restore-target-name', 'sales');
    await user.click(screen.getByTestId('restore-submit'));

    const confirm = await screen.findByTestId('restore-confirm');
    expect(confirm.textContent).toContain('sales already exists');
    expect(confirm.textContent).toContain('no undo');
  });

  it('goes back to an untouched form, with the typed confirmation cleared', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await setField(user, 'restore-path', '/tmp/sales.dump');
    await setField(user, 'restore-target-name', 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await user.type(await screen.findByTestId('restore-confirm-input'), 'sales');

    await user.click(screen.getByTestId('restore-confirm-back'));

    // Back on the form, with what was typed still there…
    expect(((await screen.findByTestId('restore-path')) as HTMLInputElement).value).toBe(
      '/tmp/sales.dump'
    );
    // …and the confirmation NOT still satisfied, or Review→confirm would be a single click.
    await user.click(screen.getByTestId('restore-submit'));
    expect((screen.getByTestId('restore-confirm-start') as HTMLButtonElement).disabled).toBe(true);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('says all of it inline — no toast reaches a modal (J-42)', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await user.type(await screen.findByTestId('restore-confirm-input'), 'sales');
    await user.click(screen.getByTestId('restore-confirm-start'));
    await screen.findByTestId('restore-progress');

    expect(notifications).toEqual([]);
  });
});

// ── The rest of the wizard ──────────────────────────────────────────────────────────────────

describe('the host-tool probe', () => {
  it('shows a spinner for PG until the probe answers, and probes exactly once', async () => {
    bridge = installBridge();
    mountDialog('postgresql');

    expect(screen.getByTestId('restore-tools-checking')).toBeTruthy();
    await screen.findByTestId('restore-path');
    expect(bridge.checkTools).toHaveBeenCalledOnce();
    expect(bridge.checkTools).toHaveBeenCalledWith('postgresql');
  });

  it('never probes for MSSQL, whose server does the work', async () => {
    bridge = installBridge();
    mountDialog('mssql');

    await screen.findByTestId('restore-path');
    expect(bridge.checkTools).not.toHaveBeenCalled();
  });

  it('replaces the form with the remediation view, and recovers from it', async () => {
    const user = userEvent.setup();
    bridge = installBridge(TOOLS_MISSING);
    mountDialog('postgresql');

    await screen.findByTestId('missing-cli-tools');
    expect(screen.queryByTestId('restore-path')).toBeNull();
    expect(screen.getByTestId('tool-status-pg_restore')).toBeTruthy();

    await user.click(screen.getByTestId('missing-cli-tools-recheck'));
    await screen.findByTestId('restore-path');
    // …and it said so in place rather than in a toast.
    expect(notifications).toEqual([]);
  });
});

describe('the options, per engine', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('gives MSSQL the recovery state, the statement and the history', async () => {
    await mountOnForm('mssql');
    expect(screen.getByTestId('restore-norecovery')).toBeTruthy();
    expect(screen.getByTestId('restore-tsql')).toBeTruthy();
    await screen.findByTestId('restore-history');
  });

  it('gives PG none of them, and states the format instead', async () => {
    await mountOnForm('postgresql');
    expect(screen.queryByTestId('restore-norecovery')).toBeNull();
    expect(screen.queryByTestId('restore-tsql')).toBeNull();
    expect(screen.queryByTestId('restore-history')).toBeNull();
    expect(screen.getByTestId('restore-format-note').textContent).toContain('pg_restore');
  });

  it('renders no answer band at all when there is nothing to say', async () => {
    // An empty band is a rule and 12px of padding above the action row, which is visible and means
    // nothing — the failure Task 12's gate photographed.
    await mountOnForm('postgresql');
    expect(screen.queryByTestId('restore-answer-band')).toBeNull();
  });

  it('shows the statement the server will run, STATS included', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await setField(user, 'restore-path', 'C:\\Backups\\sales.bak');

    const sql = screen.getByTestId('restore-tsql').textContent ?? '';
    expect(sql).toContain('RESTORE DATABASE');
    expect(sql).toContain('STATS = 5');
    expect(sql).not.toContain('STATS = 10');
  });

  it('aims the MSSQL file moves at the server’s directories once the header is read', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await setField(user, 'restore-path', 'C:\\Backups\\sales.bak');
    await user.click(screen.getByTestId('restore-read-header'));

    await screen.findByTestId('restore-relocations');
    const inputs = screen.getAllByTestId('restore-relocation') as HTMLInputElement[];
    // The header names `sales`, which the untouched target field adopts.
    expect(inputs[0]?.value).toBe('C:\\Data\\sales_sales.mdf');
    expect(inputs[1]?.value).toBe('C:\\Logs\\sales_sales_log.ldf');
    expect(screen.getByTestId('restore-tsql').textContent).toContain('MOVE');
  });

  it('re-aims the untouched moves when the target database changes', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await setField(user, 'restore-path', 'C:\\Backups\\sales.bak');
    await user.click(screen.getByTestId('restore-read-header'));
    await screen.findByTestId('restore-relocations');

    // The picker's "not one of these" row. Its label is what a user reads, so that is what is used.
    await chooseTarget(user, 'A database that does not exist yet…');
    await setField(user, 'restore-target-name', 'sales_copy');

    const inputs = screen.getAllByTestId('restore-relocation') as HTMLInputElement[];
    expect(inputs[0]?.value).toBe('C:\\Data\\sales_copy_sales.mdf');
  });
});

describe('choosing a source', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('opens the server file browser for MSSQL, in the same dialog', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await user.click(screen.getByTestId('restore-browse'));

    await screen.findByTestId('backup-file-browser');
    // One dialog, one scrim, one focus trap — the browser is a body swap, not a second modal.
    expect(screen.getAllByTestId('restore-dialog')).toHaveLength(1);
    expect(screen.queryByTestId('restore-path')).toBeNull();
  });

  it('comes back with the picked path and reads its header', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    // A typed path is what tells the browser where to open — otherwise it starts on the drive list.
    await setField(user, 'restore-path', 'C:\\Backups\\seed.bak');
    await user.click(screen.getByTestId('restore-browse'));
    await screen.findByTestId('backup-file-browser');

    await user.click((await screen.findAllByTestId('backup-file-browser-entry'))[0] as HTMLElement);
    await user.click(screen.getByTestId('backup-file-browser-confirm'));

    const path = (await screen.findByTestId('restore-path')) as HTMLInputElement;
    expect(path.value).toBe('C:\\Backups\\sales_full.bak');
    await waitFor(() =>
      expect(bridge.getBackupInfo).toHaveBeenCalledWith(
        CONNECTION_ID,
        'C:\\Backups\\sales_full.bak'
      )
    );
  });

  it('opens the native file dialog for PG, whose archive is local', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await user.click(screen.getByTestId('restore-browse'));

    await waitFor(() => expect(bridge.showOpenDialog).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect((screen.getByTestId('restore-path') as HTMLInputElement).value).toBe(
        '/tmp/chosen.dump'
      )
    );
    // …and it suggested a target from the archive's own name rather than leaving it empty.
    expect((screen.getByTestId('restore-target-name') as HTMLInputElement).value).toBe('chosen');
  });

  it('fills the source from the backup history', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await screen.findByTestId('restore-history');

    await user.click(screen.getAllByTestId('restore-history-entry')[0] as HTMLElement);
    expect((screen.getByTestId('restore-path') as HTMLInputElement).value).toBe(
      'C:\\Backups\\sales_full.bak'
    );
  });
});

describe('running a restore', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('refuses an empty source inline, and does not call the bridge', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');

    await user.click(screen.getByTestId('restore-submit'));

    expect(screen.getByTestId('restore-hint').textContent).toMatch(/backup file/i);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('creates the PostgreSQL target first, because pg_restore will not', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));

    await waitFor(() =>
      expect(bridge.createDatabase).toHaveBeenCalledWith(CONNECTION_ID, { name: 'sales_copy' })
    );
    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
    expect(bridge.start.mock.calls[0]?.[0]).toMatchObject({
      connectionId: CONNECTION_ID,
      backupPath: '/tmp/sales.dump',
      targetDatabase: 'sales_copy',
      withReplace: false,
    });
    // `withNoRecovery` is MSSQL's; it must not ride along in a PG request.
    expect(bridge.start.mock.calls[0]?.[0]).not.toHaveProperty('withNoRecovery');
  });

  it('does not create a target that already exists', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await user.type(await screen.findByTestId('restore-confirm-input'), 'sales');
    await user.click(screen.getByTestId('restore-confirm-start'));

    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
    expect(bridge.createDatabase).not.toHaveBeenCalled();
  });

  it('stops at the creation failure rather than running a restore with nowhere to go', async () => {
    const user = userEvent.setup();
    bridge.createDatabase.mockResolvedValueOnce({
      success: false,
      tsql: 'CREATE DATABASE x',
      error: 'permission denied to create database',
    });
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));

    const failure = await screen.findByTestId('restore-error');
    expect(failure.textContent).toContain('permission denied');
    expect(bridge.start).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('sends the MSSQL options that do reach the T-SQL', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql');
    await setField(user, 'restore-path', 'C:\\Backups\\sales.bak');
    await user.click(screen.getByTestId('restore-read-header'));
    await screen.findByTestId('restore-relocations');
    await user.click(screen.getByTestId('restore-overwrite'));
    await user.click(screen.getByTestId('restore-norecovery'));

    await user.click(screen.getByTestId('restore-submit'));
    await user.type(await screen.findByTestId('restore-confirm-input'), 'sales');
    await user.click(screen.getByTestId('restore-confirm-start'));

    await waitFor(() => expect(bridge.start).toHaveBeenCalledOnce());
    const request = bridge.start.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(request).toMatchObject({ withReplace: true, withNoRecovery: true });
    expect(request['fileRelocations']).toEqual([
      { logicalName: 'sales', physicalName: 'C:\\Data\\sales_sales.mdf' },
      { logicalName: 'sales_log', physicalName: 'C:\\Logs\\sales_sales_log.ldf' },
    ]);
  });

  it('streams progress inline and locks the form while it runs', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));

    await screen.findByTestId('restore-progress');
    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'running',
        percentComplete: -1,
        currentPhase: 'pg_restore: creating TABLE "public.products"',
      } as unknown as RestoreProgress);
    });

    expect(screen.getByTestId('restore-progress').textContent).toContain('creating TABLE');
    // Indeterminate, because pg_restore reports no percentage. The bar has to say "unknown", not 0.
    expect(screen.getByTestId('restore-progress-bar').getAttribute('aria-valuenow')).toBeNull();
    expect((screen.getByTestId('restore-path') as HTMLInputElement).disabled).toBe(true);
  });

  it('lands on an inline success naming the database — and raises no toast', async () => {
    const user = userEvent.setup();
    const restored: string[] = [];
    await mountOnForm('postgresql', { onRestored: name => restored.push(name) });
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'completed',
        percentComplete: 100,
        elapsedMs: 4200,
      } as unknown as RestoreProgress);
    });

    const success = await screen.findByTestId('restore-success');
    expect(success.textContent).toContain('Restore complete');
    expect(screen.getByTestId('restore-success-target').textContent).toBe('sales_copy');
    expect(notifications).toEqual([]);
    // The sidebar has to learn about the new database, exactly once.
    expect(restored).toEqual(['sales_copy']);
  });

  it('recognises a completion on an engine that never sends restoreId', async () => {
    // pg_restore and the mysql client send `backupId`/`operationId` on the RESTORE channel. A dialog
    // that compared `progress.restoreId` would sit on the spinner through a finished restore.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'running',
        percentComplete: -1,
      } as unknown as RestoreProgress);
    });
    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'completed',
        percentComplete: 100,
      } as unknown as RestoreProgress);
    });

    await screen.findByTestId('restore-success');
  });

  it('states a failure inline, and offers the form back', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'failed',
        percentComplete: 0,
        error: 'pg_restore: error: could not open input file',
      } as unknown as RestoreProgress);
    });

    const failure = await screen.findByTestId('restore-error');
    expect(failure.textContent).toContain('could not open input file');
    expect(notifications).toEqual([]);

    await user.click(screen.getByTestId('restore-retry'));
    expect((screen.getByTestId('restore-path') as HTMLInputElement).disabled).toBe(false);
  });

  it('names the empty database it left behind when the restore into it failed', async () => {
    // Joinery creates the PG target before pg_restore runs, so a failure leaves a database on the
    // server that the user only asked for as part of asking for a restore. Undisclosed, it also turns
    // `Try again` into an overwrite — the wizard would demand the typed-name confirmation for a
    // database Joinery itself had just made.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await waitFor(() => expect(bridge.createDatabase).toHaveBeenCalledOnce());
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'failed',
        percentComplete: 0,
        error: 'pg_restore: error: did not find magic string in file header',
      } as unknown as RestoreProgress);
    });

    const leftover = await screen.findByTestId('restore-error-leftover');
    expect(leftover.textContent).toContain('sales_copy');
    expect(leftover.textContent).toContain(
      'was created before the restore failed and is still there, empty'
    );
    expect(notifications).toEqual([]);
  });

  it('discloses no leftover when the target was already there to restore into', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await user.type(await screen.findByTestId('restore-confirm-input'), 'sales');
    await user.click(screen.getByTestId('restore-confirm-start'));
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'failed',
        percentComplete: 0,
        error: 'pg_restore: error: connection to server failed',
      } as unknown as RestoreProgress);
    });

    await screen.findByTestId('restore-error');
    expect(bridge.createDatabase).not.toHaveBeenCalled();
    expect(screen.queryByTestId('restore-error-leftover')).toBeNull();
  });

  it('states a failure when the operation never started at all', async () => {
    const user = userEvent.setup();
    bridge.start.mockRejectedValueOnce(new Error('Connection profile not found'));
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));

    const failure = await screen.findByTestId('restore-error');
    expect(failure.textContent).toContain('Connection profile not found');
  });

  it('ignores a progress event for somebody else’s bound operation', async () => {
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');

    act(() => {
      bridge.progress.emit({
        backupId: 'ours',
        operationId: 'ours',
        status: 'running',
        percentComplete: -1,
      } as unknown as RestoreProgress);
    });
    act(() => {
      bridge.progress.emit({
        backupId: 'theirs',
        operationId: 'theirs',
        status: 'completed',
        percentComplete: 100,
      } as unknown as RestoreProgress);
    });

    expect(screen.queryByTestId('restore-success')).toBeNull();
    expect(screen.getByTestId('restore-progress')).toBeTruthy();
  });

  it('leaves exactly one live progress subscription', async () => {
    const { unmount } = await mountOnForm('postgresql');
    expect(bridge.progress.liveCount()).toBe(1);
    unmount();
    expect(bridge.progress.liveCount()).toBe(0);
  });
});

describe('the target picker', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('starts on the database the context menu named', async () => {
    await mountOnForm('postgresql', { databaseName: 'sales' });
    expect(screen.queryByTestId('restore-target-name')).toBeNull();
    expect(screen.getByTestId('restore-target-note').textContent).toContain('already exists');
  });

  it('refuses "a new database" on a connection that cannot create one', async () => {
    await mountOnForm('postgresql', { canCreateDatabases: false, databaseName: 'sales' });
    await userEvent.setup().click(screen.getByTestId('restore-target'));

    const option = await targetOption('A database that does not exist yet…');
    expect(option.hasAttribute('data-disabled')).toBe(true);
    expect(option.getAttribute('aria-disabled')).toBe('true');
  });

  it('refuses a MySQL name the main process would throw on', async () => {
    const user = userEvent.setup();
    await mountOnForm('mysql');
    await setField(user, 'restore-path', '/tmp/sales.sql');
    await setField(user, 'restore-target-name', 'sales-copy');
    await user.click(screen.getByTestId('restore-submit'));

    expect(screen.getByTestId('restore-hint').textContent).toMatch(/letters, digits/);
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it('refuses an MSSQL overwrite with Overwrite off, before the confirmation', async () => {
    const user = userEvent.setup();
    await mountOnForm('mssql', { databaseName: 'sales' });
    await setField(user, 'restore-path', 'C:\\Backups\\sales.bak');
    await user.click(screen.getByTestId('restore-submit'));

    expect(screen.getByTestId('restore-hint').textContent).toMatch(/Overwrite/);
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
  });
});

// ── The commands, and the shared in-flight record ───────────────────────────────────────────

describe('the two restore commands', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  function mountConsumer() {
    return render(
      <IpcQueryProvider>
        <TooltipProvider>
          <RestoreDialogs />
        </TooltipProvider>
      </IpcQueryProvider>
    );
  }

  it('renders nothing until a command arrives', () => {
    mountConsumer();
    expect(screen.queryByTestId('restore-dialog')).toBeNull();
  });

  it('opens on the sidebar’s server-level command, with no database named', async () => {
    connectionStore.setState({
      profiles: [profile('postgresql')],
      connectedProfileIds: new Set([CONNECTION_ID]),
    });
    mountConsumer();

    act(() => {
      dispatchCommand('restore-database', { connectionId: CONNECTION_ID });
    });

    await screen.findByTestId('restore-path');
    // A restore creates its target, so no database is required to open it — the picker starts on the
    // "not one of these" row.
    expect(screen.getByTestId('restore-target-name')).toBeTruthy();
    expect(notifications).toEqual([]);
  });

  it('resolves the menu’s payload-free command through mostRecentConnectionId', async () => {
    connectionStore.setState({
      profiles: [profile('postgresql')],
      connectedProfileIds: new Set([CONNECTION_ID]),
    });
    mountConsumer();

    act(() => {
      dispatchCommand('open-restore-dialog');
    });

    await screen.findByTestId('restore-path');
  });

  it('says why rather than opening an empty dialog when nothing is connected', () => {
    mountConsumer();
    act(() => {
      dispatchCommand('open-restore-dialog');
    });

    expect(notifications).toEqual(['warning: Connect to a server before restoring a database.']);
    expect(screen.queryByTestId('restore-dialog')).toBeNull();
  });

  it('reports a stale context menu instead of opening on a deleted profile', () => {
    mountConsumer();
    act(() => {
      dispatchCommand('restore-database', { connectionId: 'gone' });
    });

    expect(notifications).toEqual(['error: That connection no longer exists.']);
    expect(screen.queryByTestId('restore-dialog')).toBeNull();
  });
});

describe('one operation at a time, across the two features', () => {
  beforeEach(() => {
    bridge = installBridge();
  });

  it('refuses a second restore into a target this window is already restoring', async () => {
    const user = userEvent.setup();
    const first = await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');
    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'running',
        percentComplete: -1,
      } as unknown as RestoreProgress);
    });

    // Close it. The restore keeps going — there is no cancel to offer.
    first.unmount();

    // A second dialog, pointed at the same target.
    await mountOnForm('postgresql');
    await fillNewTarget(user, 'sales_copy');

    const note = await screen.findByTestId('restore-in-flight');
    expect(note.textContent).toContain('A restore into this database is still running');
    const startButton = screen.getByTestId('restore-submit') as HTMLButtonElement;
    expect(startButton.disabled).toBe(true);
    await user.click(startButton);
    expect(bridge.start).toHaveBeenCalledOnce();
    expect(notifications).toEqual([]);
  });

  it('explains the refusal on the confirmation screen rather than doing nothing', async () => {
    // The confirmation is reached while the target is free, and something else can begin against it
    // while it sits open — a dump started from the sidebar, say. `runPlan` refuses in that case, and
    // a refusal with no explanation is a primary button that does nothing on the one screen whose
    // whole job is saying what pressing it will do.
    const user = userEvent.setup();
    await mountOnForm('postgresql');
    await setField(user, 'restore-path', '/tmp/sales.dump');
    await setField(user, 'restore-target-name', 'sales');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-confirm');
    await user.type(screen.getByTestId('restore-confirm-input'), 'sales');
    expect((screen.getByTestId('restore-confirm-start') as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      dbOperationsStore
        .getState()
        .begin(dbOperationKey(CONNECTION_ID, 'sales'), 'backup', '/tmp/sales.dump');
    });

    const note = await screen.findByTestId('restore-in-flight');
    expect(note.textContent).toContain('A backup of this database is still running');

    const confirm = screen.getByTestId('restore-confirm-start') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(confirm);
    await user.type(screen.getByTestId('restore-confirm-input'), '{Enter}');

    expect(bridge.start).not.toHaveBeenCalled();
    expect(notifications).toEqual([]);
  });

  it('lifts the refusal once the first restore reports it is done', async () => {
    const user = userEvent.setup();
    render(
      <IpcQueryProvider>
        <TooltipProvider>
          <RestoreDialogs />
        </TooltipProvider>
      </IpcQueryProvider>
    );
    connectionStore.setState({
      profiles: [profile('postgresql')],
      connectedProfileIds: new Set([CONNECTION_ID]),
    });
    act(() => {
      dispatchCommand('restore-database', { connectionId: CONNECTION_ID });
    });
    await screen.findByTestId('restore-path');
    await fillNewTarget(user, 'sales_copy');
    await user.click(screen.getByTestId('restore-submit'));
    await screen.findByTestId('restore-progress');
    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'running',
        percentComplete: -1,
      } as unknown as RestoreProgress);
    });

    // The host's own subscription retires the run — which is why it is on the always-mounted
    // component rather than on the wizard.
    await user.click(screen.getByTestId('restore-close'));
    act(() => {
      bridge.progress.emit({
        backupId: 'op-1',
        operationId: 'op-1',
        status: 'completed',
        percentComplete: 100,
      } as unknown as RestoreProgress);
    });

    act(() => {
      dispatchCommand('restore-database', { connectionId: CONNECTION_ID });
    });
    await screen.findByTestId('restore-path');
    await fillNewTarget(user, 'sales_copy');

    expect(screen.queryByTestId('restore-in-flight')).toBeNull();
    expect((screen.getByTestId('restore-submit') as HTMLButtonElement).disabled).toBe(false);
  });
});
