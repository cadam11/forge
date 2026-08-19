/**
 * The snippet library, mounted for real over a persistence double.
 *
 * Three properties, in order of how much they matter:
 *
 * 1. **CRUD round-trips through the persistence layer** — create, edit and delete each end up in what
 *    the store asked to write, and `localStorage` is never touched (that last one is enforced
 *    package-wide by `persistence/no-local-storage-writes.spec.ts`, so what is checked here is that the
 *    write went to `rendererStatePersistence` instead);
 * 2. **insert goes through the bus**, and a row whose insert cannot land is disabled WITH A REASON
 *    rather than firing a command that reaches nobody;
 * 3. the search is the shared matcher over name, tags and SQL.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { handlerCount, subscribeCommand } from '../../commands';
import { COMMAND_IDS } from '../../commands/registry';
import {
  rendererStatePersistence,
  type ReactRendererState,
  type ReactRendererStateMutator,
} from '../../persistence/renderer-state';
import { setDiagnosticsSink, setNotifier } from '../../state/diagnostics';
import { snippetsStore, type SqlSnippet } from '../../state/snippets';
import { tabStore } from '../../state/tab';
import { TooltipProvider } from '../../ui';
import { SnippetLibrary } from './snippet-library';

const EXISTING: SqlSnippet[] = [
  {
    id: 'snip-1',
    name: 'Recent customers',
    sql: 'SELECT * FROM customers ORDER BY created_at DESC',
    tags: ['reporting', 'customers'],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'snip-2',
    name: 'Order totals',
    sql: 'SELECT order_id, SUM(amount) FROM order_lines GROUP BY order_id',
    tags: ['finance'],
    createdAt: '2020-01-01T00:00:00.000Z',
  },
];

const teardowns: (() => void)[] = [];
const notifications: string[] = [];
type UpdateFn = (mutate: ReactRendererStateMutator) => Promise<'written'>;

let update: ReturnType<typeof vi.fn<UpdateFn>>;
let mutators: ReactRendererStateMutator[];

/**
 * The app's real snippet store, with the persistence layer it writes through replaced by a recorder.
 *
 * A spy on the singleton rather than a store built on a double, because the component reaches for the
 * module singleton (`snippetsStore`) and testing a *different* store would prove nothing about the one
 * the shell mounts. The store looks the method up on the object at call time, so replacing the method
 * is enough — and it keeps `update`'s read-modify-write contract visible: the recorder captures the
 * MUTATOR, and the tests run it against a persisted value of their choosing.
 */
function installPersistenceRecorder(): void {
  mutators = [];
  update = vi.fn<UpdateFn>((mutate: ReactRendererStateMutator) => {
    mutators.push(mutate);
    return Promise.resolve('written' as const);
  });
  const spy = vi.spyOn(rendererStatePersistence, 'update').mockImplementation(update);
  teardowns.push(() => spy.mockRestore());
}

/** What the last recorded mutator produces against a given persisted value. */
function lastWrite(current: ReactRendererState = {}): ReactRendererState | undefined {
  return mutators[mutators.length - 1]?.(current);
}

beforeEach(() => {
  notifications.length = 0;
  teardowns.push(
    setDiagnosticsSink({ error: () => undefined, warn: () => undefined }),
    setNotifier({
      success: message => notifications.push(message),
      error: message => notifications.push(message),
      info: message => notifications.push(message),
      warning: message => notifications.push(message),
    })
  );
  installPersistenceRecorder();
  snippetsStore.getState().hydrate(EXISTING);
});

afterEach(() => {
  while (teardowns.length > 0) teardowns.pop()?.();
  tabStore.getState().closeAllTabs();
  for (const id of COMMAND_IDS) expect(handlerCount(id)).toBe(0);
});

function mount() {
  const rendered = render(
    <TooltipProvider>
      <SnippetLibrary />
    </TooltipProvider>
  );
  teardowns.push(rendered.unmount);
  return rendered;
}

/** Opens the library the way ⌥⌘S does. */
async function open(): Promise<void> {
  await userEvent.keyboard('{Meta>}{Alt>}s{/Alt}{/Meta}');
  await screen.findByTestId('snippets-overlay');
}

function rowNames(): string[] {
  return screen
    .queryAllByTestId('snippets-row')
    .map(row => within(row).getByTestId('snippets-row-name').textContent ?? '');
}

function rowFor(name: string): HTMLElement {
  const found = screen
    .getAllByTestId('snippets-row')
    .find(row => within(row).getByTestId('snippets-row-name').textContent === name);
  if (found === undefined) throw new Error(`no snippet row for ${name}`);
  return found;
}

/** A query tab in front, with a live `insert-snippet` handler — the state an insert needs. */
function withQueryEditor(): { inserted: string[] } {
  const inserted: string[] = [];
  teardowns.push(
    subscribeCommand('insert-snippet', payload => {
      inserted.push(payload.sql);
    })
  );
  tabStore.getState().openQueryTab('conn-1', 'sales', 'SELECT 1', false, false);
  return { inserted };
}

describe('the snippet library', () => {
  it('opens on ⌥⌘S and lists the hydrated snippets with their tags and SQL', async () => {
    mount();
    await open();

    expect(rowNames()).toEqual(['Recent customers', 'Order totals']);
    const row = rowFor('Recent customers');
    expect(
      within(row)
        .getAllByTestId('snippets-row-tag')
        .map(tag => tag.textContent)
    ).toEqual(['reporting', 'customers']);
    expect(within(row).getByTestId('snippets-row-sql').textContent).toContain('FROM customers');
    expect(screen.getByTestId('snippets-count').textContent).toBe('2 of 2');
  });

  it('searches name, tag and SQL', async () => {
    mount();
    await open();
    const input = screen.getByTestId('snippets-input');

    await userEvent.type(input, 'finance');
    await waitFor(() => expect(rowNames()).toEqual(['Order totals']));

    await userEvent.clear(input);
    await userEvent.type(input, 'order_lines');
    await waitFor(() => expect(rowNames()).toEqual(['Order totals']));

    await userEvent.clear(input);
    await userEvent.type(input, 'zzqqxv');
    await waitFor(() => expect(rowNames()).toEqual([]));
    expect(screen.getByTestId('snippets-empty').textContent).toContain('zzqqxv');
  });

  it('inserts into the editor through the command bus, then closes', async () => {
    const { inserted } = withQueryEditor();
    mount();
    await open();

    await userEvent.click(rowFor('Order totals'));

    expect(inserted).toEqual(['SELECT order_id, SUM(amount) FROM order_lines GROUP BY order_id']);
    await waitFor(() => expect(screen.queryByTestId('snippets-overlay')).toBeNull());
  });

  it('disables insert with a reason when no editor can receive it', async () => {
    // Nothing is subscribed to `insert-snippet` — no query tab has mounted. The row must say so rather
    // than dispatching into silence, which is the exact failure this task exists to remove.
    mount();
    await open();

    const row = rowFor('Order totals');
    expect(row.getAttribute('data-disabled')).toBe('true');
    expect(within(row).getByTestId('snippets-row-blocked').textContent).toContain(
      'Open a query tab'
    );
    expect(screen.getByTestId('snippets-footer').textContent).toContain('Open a query tab');
  });

  it('creates a snippet from the active tab’s SQL and persists it', async () => {
    withQueryEditor();
    tabStore.getState().setTabContent(tabStore.getState().tabs[0]?.id ?? '', 'SELECT 42');
    mount();
    await open();

    await userEvent.click(screen.getByTestId('snippets-new'));
    // Seeded with what is in the editor — the Angular "Save Current" behaviour, and the reason the form
    // is reachable from here at all.
    expect((screen.getByTestId('snippets-form-sql') as HTMLTextAreaElement).value).toBe(
      'SELECT 42'
    );

    await userEvent.type(screen.getByTestId('snippets-form-name'), 'Answer');
    await userEvent.type(screen.getByTestId('snippets-form-tags'), 'demo, demo, ');
    await userEvent.click(screen.getByTestId('snippets-form-save'));

    await waitFor(() => expect(snippetsStore.getState().snippets).toHaveLength(3));
    const created = snippetsStore.getState().snippets[2];
    expect(created?.name).toBe('Answer');
    expect(created?.sql).toBe('SELECT 42');
    expect(created?.tags).toEqual(['demo']);

    // And it went to main-process persistence, not to browser storage.
    expect(update).toHaveBeenCalled();
    expect(lastWrite({ welcomeDismissed: true })?.snippets).toHaveLength(3);
    expect(lastWrite({ welcomeDismissed: true })?.welcomeDismissed).toBe(true);
    expect(notifications.some(message => message.includes('Answer'))).toBe(true);
  });

  it('refuses to save a snippet with no name', async () => {
    withQueryEditor();
    mount();
    await open();

    await userEvent.click(screen.getByTestId('snippets-new'));
    expect((screen.getByTestId('snippets-form-save') as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByTestId('snippets-form-save'));
    expect(snippetsStore.getState().snippets).toHaveLength(2);
  });

  it('edits an existing snippet in place', async () => {
    mount();
    await open();

    await userEvent.click(within(rowFor('Order totals')).getByTestId('snippets-edit'));
    const name = screen.getByTestId('snippets-form-name');
    expect((name as HTMLInputElement).value).toBe('Order totals');
    expect((screen.getByTestId('snippets-form-tags') as HTMLInputElement).value).toBe('finance');

    await userEvent.clear(name);
    await userEvent.type(name, 'Totals by order');
    await userEvent.click(screen.getByTestId('snippets-form-save'));

    await waitFor(() =>
      expect(snippetsStore.getState().snippets.map(snippet => snippet.name)).toEqual([
        'Recent customers',
        'Totals by order',
      ])
    );
    // Same id — an edit is not a delete and a create.
    expect(snippetsStore.getState().snippets[1]?.id).toBe('snip-2');
    expect(lastWrite()?.snippets?.[1]?.name).toBe('Totals by order');
  });

  it('deletes a snippet, and the delete survives a disabled row', async () => {
    mount();
    await open();

    // The row is disabled for INSERTING (no editor), and deleting must still work: the two have nothing
    // to do with each other.
    await userEvent.click(within(rowFor('Order totals')).getByTestId('snippets-delete'));

    await waitFor(() => expect(snippetsStore.getState().snippets).toHaveLength(1));
    expect(snippetsStore.getState().snippets[0]?.id).toBe('snip-1');
    expect(lastWrite()?.snippets).toHaveLength(1);
  });

  it('creates from an empty library with no editor open', async () => {
    snippetsStore.getState().hydrate([]);
    mount();
    await open();

    expect(screen.getByTestId('snippets-empty').textContent).toContain('No snippets yet');

    await userEvent.click(screen.getByTestId('snippets-new'));
    await userEvent.type(screen.getByTestId('snippets-form-name'), 'From scratch');
    await userEvent.type(screen.getByTestId('snippets-form-sql'), 'SELECT now()');
    await userEvent.click(screen.getByTestId('snippets-form-save'));

    await waitFor(() => expect(snippetsStore.getState().snippets).toHaveLength(1));
    expect(snippetsStore.getState().snippets[0]?.sql).toBe('SELECT now()');
  });

  it('cancels the form without writing anything', async () => {
    mount();
    await open();

    await userEvent.click(screen.getByTestId('snippets-new'));
    await userEvent.type(screen.getByTestId('snippets-form-name'), 'Discarded');
    await userEvent.click(screen.getByTestId('snippets-form-cancel'));

    expect(screen.queryByTestId('snippets-form')).toBeNull();
    expect(snippetsStore.getState().snippets).toHaveLength(2);
    expect(update).not.toHaveBeenCalled();
  });
});
