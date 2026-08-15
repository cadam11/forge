/**
 * The compile-time half of the command bus contract. Every `@ts-expect-error` below is an
 * assertion: `tsc` fails the build if the line it guards ever starts compiling, which is what makes
 * "an unhandled command id or a wrong payload is a type error" a checked claim rather than a
 * comment. `tsconfig.json` includes `src`, so `pnpm --filter @joinery/renderer-react typecheck`
 * runs this file.
 *
 * The bodies are inside a never-called function: this file is about what compiles, and nothing here
 * should also run. Vitest needs one live test in the file, and that is the last block.
 */

import { describe, expect, it } from 'vitest';
import { dispatchCommand, subscribeCommand, useCommand } from './bus';
import { COMMAND_IDS, type CommandId, type CommandPayload } from './registry';

// Named `use…` so the react-hooks lint rule accepts the `useCommand` probes below: it only
// permits hook calls inside components and custom hooks, and this is the latter in name only.
function useTypeProbes(): void {
  // ── Valid: the six registered commands, spelled correctly ────────────────────────────────
  dispatchCommand('menu-copy');
  dispatchCommand('show-shortcuts');
  dispatchCommand('open-object-search');
  dispatchCommand('open-snippets');
  dispatchCommand('insert-snippet', { sql: 'select 1' });
  dispatchCommand('cursor-position', { line: 1, column: 1 });

  // ── An id that is not in the registry ────────────────────────────────────────────────────
  // @ts-expect-error -- 'open-backup' is one of the audit's dead dispatches; it is not a command.
  dispatchCommand('open-backup');
  // @ts-expect-error -- an arbitrary string is not a command id either.
  dispatchCommand('whatever-i-feel-like');
  // @ts-expect-error -- and neither is a near-miss on a real one.
  dispatchCommand('insert-snippets', { sql: 'select 1' });

  // ── A payload that does not match the id ─────────────────────────────────────────────────
  // @ts-expect-error -- `sql` is a string.
  dispatchCommand('insert-snippet', { sql: 42 });
  // @ts-expect-error -- wrong field name entirely.
  dispatchCommand('insert-snippet', { text: 'select 1' });
  // @ts-expect-error -- `column` is required.
  dispatchCommand('cursor-position', { line: 1 });
  // @ts-expect-error -- the payload is required; a bare dispatch drops it silently otherwise.
  dispatchCommand('insert-snippet');
  // @ts-expect-error -- and a payload-less command takes none.
  dispatchCommand('menu-copy', { sql: 'select 1' });

  // ── Handlers are typed by id, on both the hook and the imperative door ───────────────────
  subscribeCommand('cursor-position', payload => {
    const line: number = payload.line;
    void line;
  });
  useCommand('insert-snippet', payload => {
    const sql: string = payload.sql;
    void sql;
  });
  // A handler may ignore the payload; only `menu-copy` reads the boolean, but returning one is
  // never wrong.
  useCommand('menu-copy', () => true);

  // @ts-expect-error -- the handler's payload is `{ sql: string }`, not a string.
  subscribeCommand('insert-snippet', (payload: string) => void payload);
  // @ts-expect-error -- a payload-less command's handler cannot demand an argument.
  subscribeCommand('menu-copy', (payload: { sql: string }) => void payload);
  // @ts-expect-error -- unknown id, on the subscribe side too.
  subscribeCommand('open-backup', () => undefined);

  // ── The payload type is reachable from the id, for consumers building their own helpers ──
  const cursor: CommandPayload<'cursor-position'> = { line: 1, column: 1 };
  void cursor;
  // @ts-expect-error -- `void` is what a payload-less command carries; an object is not.
  const copy: CommandPayload<'menu-copy'> = { claimed: true };
  void copy;
}

describe('command bus types', () => {
  it('keeps the id union and the consumer table in step', () => {
    // `COMMAND_IDS` is derived from the `Record<CommandId, string>`, so this is really asserting
    // that nothing widened the record's key type — the gate that stops an undocumented command.
    const ids: readonly CommandId[] = COMMAND_IDS;
    expect(new Set(ids).size).toBe(ids.length);
    expect(useTypeProbes).toBeTypeOf('function');
  });
});
