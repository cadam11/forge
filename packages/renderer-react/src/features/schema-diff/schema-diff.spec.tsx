/**
 * The schema-comparison surface: the two command takeovers, the refusals that happen before the dialog
 * and the one that happens inside it, and what lands in the query tab.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionProfile, DatabaseEngine, DatabaseInfo } from '@joinery/shared';

import { dispatchCommand } from '../../commands';
import { connectionStore } from '../../state/connection';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { tabStore } from '../../state/tab';
import { TooltipProvider } from '../../ui';
import { SchemaDiffHost } from './schema-diff-host';

const teardowns: (() => void)[] = [];
const noop = (): void => undefined;

let warnings: string[] = [];
let openQueryTab: ReturnType<typeof vi.fn>;

function profile(engine: DatabaseEngine): ConnectionProfile {
  return {
    id: 'c1',
    name: 'Reporting',
    engine,
    server: 'localhost',
    authenticationType: 'sql',
  } as ConnectionProfile;
}

function databases(...names: string[]): DatabaseInfo[] {
  return names.map(name => ({ name }) as DatabaseInfo);
}

function seed(engine: DatabaseEngine, names: string[] = ['prod', 'staging', 'archive']) {
  connectionStore.setState({
    profiles: [profile(engine)],
    connectedProfileIds: new Set(['c1']),
    databasesByConnection: new Map([['c1', databases(...names)]]),
  });
}

beforeEach(() => {
  warnings = [];
  teardowns.push(
    setNotifier({
      success: noop,
      error: message => warnings.push(`error:${message}`),
      info: noop,
      warning: message => warnings.push(message),
    })
  );
  teardowns.push(setDiagnosticsSink({ error: noop, warn: noop }));
  openQueryTab = vi.fn(() => 'tab-1');
  tabStore.setState({ openQueryTab } as never);
  seed('mssql');
});

afterEach(() => {
  for (const teardown of teardowns.splice(0)) teardown();
  connectionStore.setState({
    profiles: [],
    connectedProfileIds: new Set(),
    databasesByConnection: new Map(),
  });
});

function mount() {
  return render(
    <TooltipProvider>
      <SchemaDiffHost />
    </TooltipProvider>
  );
}

describe('SchemaDiffHost — the refusals before the dialog', () => {
  it('refuses with a reason when nothing is connected', async () => {
    connectionStore.setState({ profiles: [], connectedProfileIds: new Set() });
    mount();
    dispatchCommand('open-schema-diff');

    await waitFor(() =>
      expect(warnings).toContain('Connect to a server before comparing schemas.')
    );
    expect(screen.queryByTestId('schema-diff-dialog')).toBeNull();
  });

  it('refuses a server with only one database, and names it', async () => {
    seed('mssql', ['solo']);
    mount();
    dispatchCommand('open-schema-diff');

    await waitFor(() =>
      expect(warnings.some(message => message.includes('Reporting has only one database'))).toBe(
        true
      )
    );
    expect(screen.queryByTestId('schema-diff-dialog')).toBeNull();
  });

  it('OPENS on PostgreSQL rather than refusing silently, and explains inside', async () => {
    // The engine refusal is deliberately not a toast: a sentence about dblink is worth reading, and a
    // toast that vanishes in four seconds is not where it belongs.
    seed('postgresql');
    mount();
    dispatchCommand('open-schema-diff');

    await waitFor(() => expect(screen.queryByTestId('schema-diff-dialog')).not.toBeNull());
    expect(screen.queryByTestId('schema-diff-unsupported')).not.toBeNull();
    // And no generate button at all, rather than one that produces T-SQL for a PostgreSQL tab.
    expect(screen.queryByTestId('schema-diff-generate')).toBeNull();
    expect(screen.queryByTestId('schema-diff-source')).toBeNull();
  });
});

describe('SchemaDiffHost — the two takeovers', () => {
  it('handles the palette’s payload-free command', async () => {
    mount();
    dispatchCommand('open-schema-diff');
    await waitFor(() => expect(screen.queryByTestId('schema-diff-dialog')).not.toBeNull());
  });

  it('pre-selects the sidebar’s database as the source', async () => {
    mount();
    dispatchCommand('compare-database-schemas', { connectionId: 'c1', databaseName: 'archive' });

    await waitFor(() => expect(screen.queryByTestId('schema-diff-dialog')).not.toBeNull());
    // Radix's select trigger renders the chosen value as its text.
    expect(screen.getByTestId('schema-diff-source').textContent).toContain('archive');
  });
});

describe('SchemaDiffHost — generating', () => {
  async function openAndPick() {
    mount();
    dispatchCommand('compare-database-schemas', { connectionId: 'c1', databaseName: 'prod' });
    await waitFor(() => expect(screen.queryByTestId('schema-diff-dialog')).not.toBeNull());
  }

  it('will not generate until both sides are chosen, and says why', async () => {
    await openAndPick();
    const generate = screen.getByTestId('schema-diff-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    // A disabled button with no explanation is the J-44 defect; the reason is on screen.
    expect(screen.getByTestId('schema-diff-problem').textContent).toContain('source and a target');
  });

  it('opens a query tab on the SOURCE database, without running it', async () => {
    await openAndPick();

    await userEvent.click(screen.getByTestId('schema-diff-target'));
    await userEvent.click(await screen.findByRole('option', { name: 'staging' }));
    await userEvent.click(screen.getByTestId('schema-diff-generate'));

    await waitFor(() => expect(openQueryTab).toHaveBeenCalledTimes(1));
    const [connectionId, database, sql, autoExecute] = openQueryTab.mock.calls[0] as [
      string,
      string,
      string,
      boolean,
    ];
    expect(connectionId).toBe('c1');
    expect(database).toBe('prod');
    expect(sql).toContain('Schema comparison: prod vs staging');
    // The Angular dialog passed `true` here, so a four-section comparison of two large catalogues
    // started running before anybody had read the statement.
    expect(autoExecute).toBe(false);
    expect(screen.queryByTestId('schema-diff-dialog')).toBeNull();
  });

  it('emits only the sections still ticked', async () => {
    await openAndPick();
    await userEvent.click(screen.getByTestId('schema-diff-target'));
    await userEvent.click(await screen.findByRole('option', { name: 'staging' }));

    await userEvent.click(screen.getByTestId('schema-diff-indexes'));
    await userEvent.click(screen.getByTestId('schema-diff-views'));
    await userEvent.click(screen.getByTestId('schema-diff-routines'));
    await userEvent.click(screen.getByTestId('schema-diff-generate'));

    await waitFor(() => expect(openQueryTab).toHaveBeenCalledTimes(1));
    const sql = (openQueryTab.mock.calls[0] as [string, string, string])[2];
    expect(sql).toContain('TABLES AND COLUMNS');
    expect(sql).not.toContain('INDEXES');
    expect(sql).not.toContain('VIEWS');
  });

  it('refuses when every section is unticked, instead of writing a header into a tab', async () => {
    await openAndPick();
    await userEvent.click(screen.getByTestId('schema-diff-target'));
    await userEvent.click(await screen.findByRole('option', { name: 'staging' }));

    for (const key of ['tables', 'views', 'routines', 'indexes']) {
      await userEvent.click(screen.getByTestId(`schema-diff-${key}`));
    }

    expect((screen.getByTestId('schema-diff-generate') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('schema-diff-problem').textContent).toContain(
      'at least one thing to compare'
    );
    expect(openQueryTab).not.toHaveBeenCalled();
  });
});
