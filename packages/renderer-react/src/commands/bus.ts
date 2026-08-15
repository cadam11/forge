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
    //
    // The identity check makes a second call idempotent, which matters because React calls an
    // effect destructor exactly once but application code is not so disciplined: after the last
    // teardown removed this set from the table, a NEW subscriber installs a fresh set under the
    // same id, and a stale `off()` firing then would delete that one — silently unsubscribing
    // somebody else. Verified by the double-off test in `bus.spec.tsx`.
    if (handlers.get(id) === set && set.size === 0) handlers.delete(id);
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
 *
 * ── Why two overloads instead of one conditional rest tuple ─────────────────────────────────
 *
 * The obvious spelling is a single generic taking `...args: void extends CommandPayload<Id> ? [] :
 * [CommandPayload<Id>]`. It holds for a literal id and silently collapses for a variable one: with
 * `Id = CommandId` the conditional is evaluated once against the whole union, `void extends
 * 'menu-copy' | { sql: string } | …` is false, and the tuple becomes optional-ish enough that
 * `dispatchCommand(someCommandId)` compiled with no payload at all — handing a handler typed
 * `(payload: { sql: string })` an `undefined`. That is not a theoretical shape: it is exactly what
 * Task 16's palette does, `dispatchCommand(entry.commandId)` over a list of entries.
 *
 * Overload resolution has no such hole, because each signature states a concrete arity against a
 * concrete id set. A caller holding a plain `CommandId` now matches neither and must narrow first —
 * `PayloadlessCommandId` is exported for exactly that, and is the type a palette entry that carries
 * no payload should be declared with.
 */

/** The commands that take no payload — the type a dynamic, payload-free dispatcher should hold. */
export type PayloadlessCommandId = {
  [K in CommandId]: void extends CommandPayload<K> ? K : never;
}[CommandId];

/** The commands that require one. `Exclude`, so the two halves cannot drift apart. */
export type PayloadCommandId = Exclude<CommandId, PayloadlessCommandId>;

export function dispatchCommand(id: PayloadlessCommandId): boolean;
export function dispatchCommand<Id extends PayloadCommandId>(
  id: Id,
  payload: CommandPayload<Id>
): boolean;
export function dispatchCommand(id: CommandId, payload?: unknown): boolean {
  const subscribed = handlers.get(id);
  if (!subscribed || subscribed.size === 0) return false;

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
