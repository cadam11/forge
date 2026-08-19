/**
 * The loader: its four states, its cache, and the two ways it must not lie.
 *
 * The two are the reason this has its own spec rather than being covered through the panel: a result
 * that arrives after the request changed must not be rendered as the new request's answer, and a
 * failure must be reported rather than left as a spinner. Both are one-line mistakes in an
 * effect-driven fetch, and neither shows up in a happy-path panel test.
 */

import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ColumnInfo, ForeignKeyInfo } from '@joinery/shared';

import { setDiagnosticsSink } from '../../state/diagnostics';
import type { ErdRequest, SchemaReader, TableRef } from './erd-adapter';
import { clearErdCache } from './erd-cache';
import { useErdSchema } from './use-erd-schema';

const COLUMNS: readonly ColumnInfo[] = [
  { name: 'id', dataType: 'integer', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 },
];
const NO_KEYS: readonly ForeignKeyInfo[] = [];

interface Recorder {
  readonly reader: () => SchemaReader;
  readonly builds: () => number;
  /** Resolves the builds started so far and re-arms the gate for the next one. */
  readonly release: () => void;
}

/**
 * A reader whose factory identity is stable — the hook's documented contract — and which counts how
 * many times a diagram was actually built.
 *
 * The gate is re-armed on release rather than resolved once, so a test can hold the SECOND build too.
 * Without that, `userEvent.click` flushes the microtask queue and the second fetch resolves inside the
 * click, which makes "does it show loading in between?" unaskable.
 */
function recorder(options: { readonly defer?: boolean; readonly fail?: Error } = {}): Recorder {
  let builds = 0;
  let unblock = (): void => undefined;
  let gate = Promise.resolve();
  const arm = (): void => {
    gate = new Promise<void>(resolve => {
      unblock = resolve;
    });
  };
  arm();

  const reader: SchemaReader = {
    listTables: async (): Promise<readonly TableRef[]> => {
      builds += 1;
      if (options.defer === true) await gate;
      if (options.fail !== undefined) throw options.fail;
      return [{ schema: 'public', name: 'orders' }];
    },
    columns: async () => COLUMNS,
    foreignKeys: async () => NO_KEYS,
  };

  const factory = (): SchemaReader => reader;
  return {
    reader: factory,
    builds: () => builds,
    release: () => {
      const pending = unblock;
      arm();
      pending();
    },
  };
}

/** Renders the state as text, and lets the test swap the request. */
function Probe({
  requests,
  reader,
}: {
  readonly requests: readonly (ErdRequest | null)[];
  readonly reader: () => SchemaReader;
}) {
  const [index, setIndex] = useState(0);
  const { state, reload } = useErdSchema(requests[index] ?? null, reader);

  return (
    <div>
      <p data-testid="status">{state.status}</p>
      <p data-testid="detail">
        {state.status === 'ready'
          ? state.nodes.map(node => node.id).join(',')
          : state.status === 'error'
            ? state.message
            : ''}
      </p>
      <button type="button" onClick={reload}>
        reload
      </button>
      <button type="button" onClick={() => setIndex(current => current + 1)}>
        next
      </button>
    </div>
  );
}

const status = () => screen.getByTestId('status').textContent;
const detail = () => screen.getByTestId('detail').textContent;

const REQUEST: ErdRequest = { connectionId: 'c1', databaseName: 'joinery_test' };
const OTHER: ErdRequest = { connectionId: 'c1', databaseName: 'other_db' };

let restoreDiagnostics: () => void;
const logged: unknown[] = [];

beforeEach(() => {
  clearErdCache();
  logged.length = 0;
  restoreDiagnostics = setDiagnosticsSink({
    error: (_context, cause) => logged.push(cause),
    warn: () => undefined,
  });
});

afterEach(() => {
  restoreDiagnostics();
});

describe('useErdSchema', () => {
  it('is idle with no request, and never reads anything', async () => {
    const probe = recorder();
    render(<Probe requests={[null]} reader={probe.reader} />);

    expect(status()).toBe('idle');
    expect(probe.builds()).toBe(0);
  });

  it('loads, then reports the built diagram', async () => {
    const probe = recorder({ defer: true });
    render(<Probe requests={[REQUEST]} reader={probe.reader} />);

    expect(status()).toBe('loading');
    probe.release();

    await waitFor(() => expect(status()).toBe('ready'));
    expect(detail()).toBe('public.orders');
  });

  it('reports a failed read as an error carrying its message, and logs the cause', async () => {
    const probe = recorder({ fail: new Error('permission denied for schema public') });
    render(<Probe requests={[REQUEST]} reader={probe.reader} />);

    await waitFor(() => expect(status()).toBe('error'));
    expect(detail()).toBe('permission denied for schema public');
    expect(logged).toHaveLength(1);
  });

  it('serves a second mount of the same request from the cache, without rebuilding', async () => {
    const probe = recorder();
    const first = render(<Probe requests={[REQUEST]} reader={probe.reader} />);
    await waitFor(() => expect(status()).toBe('ready'));
    first.unmount();

    render(<Probe requests={[REQUEST]} reader={probe.reader} />);

    // Ready on the FIRST render — the property that makes a dock tab switch free.
    expect(status()).toBe('ready');
    expect(probe.builds()).toBe(1);
  });

  it('rebuilds on reload', async () => {
    const probe = recorder();
    const user = userEvent.setup();
    render(<Probe requests={[REQUEST]} reader={probe.reader} />);
    await waitFor(() => expect(status()).toBe('ready'));

    await user.click(screen.getByRole('button', { name: 'reload' }));

    await waitFor(() => expect(probe.builds()).toBe(2));
    expect(status()).toBe('ready');
  });

  it('shows loading — not the previous diagram — when the request changes', async () => {
    const probe = recorder({ defer: true });
    const user = userEvent.setup();
    render(<Probe requests={[REQUEST, OTHER]} reader={probe.reader} />);
    probe.release();
    await waitFor(() => expect(status()).toBe('ready'));

    await user.click(screen.getByRole('button', { name: 'next' }));

    // This is the assertion the `key`-carrying result exists for. A hook that stored only the state
    // would show the first database's tables under the second database's name.
    expect(status()).toBe('loading');
  });

  it('does not set state after unmount', async () => {
    const probe = recorder({ defer: true });
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation(message => errors.push(message));

    const view = render(<Probe requests={[REQUEST]} reader={probe.reader} />);
    view.unmount();
    probe.release();
    await Promise.resolve();
    await Promise.resolve();

    expect(errors).toEqual([]);
    spy.mockRestore();
  });
});
