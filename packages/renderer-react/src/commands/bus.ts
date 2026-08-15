/**
 * The command bus. One dispatch function, one subscribe hook, and a handler table keyed by the
 * registry's id union — so a wrong id or a wrong payload is a compile error rather than a
 * `CustomEvent` nobody listens for (`registry.ts` has the history).
 *
 * A module-level table rather than a React context, for the same reason the Angular original used
 * `window`: the producer and the consumer are usually in unrelated corners of the tree (a native
 * menu click and a grid; a palette and an editor), and a context would force a common ancestor to
 * exist and re-render. Unlike `window`, this table is typed, enumerable, and cannot be reached by
 * anything outside this module.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CommandId, CommandPayload } from './registry';

/**
 * A handler may return `true` to *claim* the command. Only `menu-copy` reads that (see
 * `registry.ts`); every other handler returns void and the return value is ignored.
 */
export type CommandHandler<Id extends CommandId> = (payload: CommandPayload<Id>) => boolean | void;

/**
 * The erased handler shape the table stores. One cast at each boundary — in and out — is the price
 * of a heterogeneous map; the public functions above and below it are fully typed, so no caller
 * ever sees `unknown`.
 */
type ErasedHandler = (payload: unknown) => boolean | void;

const handlers = new Map<CommandId, Set<ErasedHandler>>();

/**
 * The payload argument list for one command: empty for a payload-less command, a single required
 * argument otherwise. This is what makes `dispatchCommand('insert-snippet')` and
 * `dispatchCommand('menu-copy', {})` both compile errors.
 */
type PayloadArgs<Id extends CommandId> =
  void extends CommandPayload<Id> ? [] : [payload: CommandPayload<Id>];

/**
 * Subscribe outside React — the native-menu bridge and the stores. Returns the teardown.
 *
 * Registering the same handler identity twice is idempotent (a `Set`), which matters because the
 * hook below re-runs its effect whenever the command id changes.
 */
export function subscribeCommand<Id extends CommandId>(
  id: Id,
  handler: CommandHandler<Id>
): () => void {
  const existing = handlers.get(id);
  const set = existing ?? new Set<ErasedHandler>();
  if (!existing) handlers.set(id, set);

  const erased = handler as ErasedHandler;
  set.add(erased);

  return () => {
    set.delete(erased);
    // Drop the empty set so `handlerCount` and the dev probe report the truth rather than a
    // graveyard of ids that were once subscribed.
    if (set.size === 0) handlers.delete(id);
  };
}

/**
 * Send a command. Returns true when a handler claimed it (see `menu-copy`), false otherwise —
 * including when nothing is subscribed, which is the answer the menu bridge's fallback needs.
 *
 * Every handler runs even after one claims: the grid's claim must not silently cancel another
 * panel's bookkeeping, and the Angular `CustomEvent` behaved the same way (`preventDefault` does
 * not stop propagation). The iteration is over a snapshot, so a handler that unsubscribes itself —
 * a dialog closing in response to its own command — cannot corrupt the walk, and the loop is
 * bounded by the number of subscribers at dispatch time.
 */
export function dispatchCommand<Id extends CommandId>(id: Id, ...args: PayloadArgs<Id>): boolean {
  const subscribed = handlers.get(id);
  if (!subscribed || subscribed.size === 0) return false;

  // `args` is a conditional tuple, so the compiler will not index it directly; it is `[]` or
  // `[payload]` and nothing else, which makes element 0 the payload or `undefined`.
  const payload = (args as readonly unknown[])[0];

  let claimed = false;
  for (const handler of [...subscribed]) {
    if (handler(payload) === true) claimed = true;
  }
  return claimed;
}

/**
 * Handle a command for the lifetime of the component.
 *
 * `handler` may change identity freely — it is read through a ref, so a new closure updates what
 * the handler does without resubscribing. The ref is refreshed in a *layout* effect for the same
 * reason `useIpcEvent` does it: commands can arrive from a native-menu callback between commit and
 * the passive-effect flush, and a stale closure would read stale state.
 */
export function useCommand<Id extends CommandId>(id: Id, handler: CommandHandler<Id>): void {
  const handlerRef = useRef(handler);

  useLayoutEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(
    () => subscribeCommand(id, payload => handlerRef.current(payload)),
    // Only the id: the handler is reached through the ref, so including it would tear the
    // subscription down and rebuild it on every render.
    [id]
  );
}

/** How many handlers are subscribed to one command. For tests and the Task 16 palette assertion. */
export function handlerCount(id: CommandId): number {
  return handlers.get(id)?.size ?? 0;
}
