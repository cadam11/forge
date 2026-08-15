/**
 * The React half of the bridge's push side: the `on*` members, which are subscriptions
 * rather than requests and therefore have nothing to do with TanStack Query (PLAN.md §2 —
 * "event channels stay imperative subscriptions").
 *
 * The bridge exposes 39 of them, all with the same `(callback) => unsubscribe` contract:
 * six carry payloads — `backup.onProgress`, `restore.onProgress`, `chat.onStreamChunk`,
 * `logs.onEntry`, `workspace.onFileChanged`, `theme.onChanged` — and 33 are payload-less
 * `menu.on*` commands. One hook covers all 39 because the shapes are derived, not listed.
 */

import { useEffect, useRef } from 'react';
import { findJoineryApi } from './api';
import type {
  IpcEventName,
  IpcEventNamespace,
  IpcEventPayload,
  IpcSubscribe,
  IpcUnsubscribe,
} from './surface';

/**
 * Subscribe to one bridge event for the lifetime of the component.
 *
 * The event is addressed by namespace and name rather than by passing
 * `ipc().backup.onProgress` in directly, for two reasons. It keeps the availability guard
 * where it belongs — a caller cannot evaluate `ipc().backup` during render and crash the
 * tree in browser mode. And it keeps the effect's dependencies two stable strings, so the
 * subscription survives every re-render; a function argument would be a fresh identity each
 * time and would tear down and rebuild the listener on every render.
 *
 * `handler` may change identity freely — it is read through a ref, so a new closure updates
 * what the listener does without resubscribing.
 */
export function useIpcEvent<N extends IpcEventNamespace, E extends IpcEventName<N>>(
  namespace: N,
  event: E,
  handler: (payload: IpcEventPayload<N, E>) => void
): void {
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // The non-throwing accessor on purpose. In a plain browser this hook is inert; an
    // effect that threw would surface as an unhandled error and take the tree down, which
    // is a worse answer than "no events arrive because there is no main process".
    const api = findJoineryApi();
    if (api === undefined) {
      return;
    }

    // The one cast in this hook, and it is unavoidable: `IpcEventName` has proved that this
    // member is a subscription, but `JoineryAPI[N][E]` is still an unresolved indexed
    // access whose callback parameter TypeScript sees as `never`, so it cannot be invoked
    // as written. The cast restores the payload type the mapped type already established.
    const subscribe = api[namespace][event] as IpcSubscribe<IpcEventPayload<N, E>>;

    const unsubscribe: IpcUnsubscribe = subscribe(payload => {
      handlerRef.current(payload);
    });

    // Wrapped rather than returned directly: the preload teardown is
    // `() => ipcRenderer.removeListener(…)`, whose expression body returns the
    // `IpcRenderer`. React only ever calls a destructor, but a destructor typed `void` is
    // one less thing to reason about.
    //
    // This return is also what makes the hook safe under StrictMode, where every effect is
    // mounted, torn down and mounted again. Each `subscribe` call closes over a freshly
    // created listener (`preload/src/index.ts:445-449`), and `removeListener` is given that
    // exact function, so the discarded first subscription is removed rather than being
    // left behind as a duplicate that fires the handler twice.
    return () => {
      unsubscribe();
    };
  }, [namespace, event]);
}
