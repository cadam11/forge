/**
 * Everything this layer knows about the shape of `window.joinery` is *derived* from the
 * one authoritative declaration — `JoineryAPI` in `packages/preload/src/index.ts`.
 *
 * That is the whole point of this module. The Angular renderer's `ipc.service.ts` was
 * 1,023 lines of hand-written 1:1 re-declaration of that interface (PLAN.md finding 0.3),
 * so every preload change had to be mirrored by hand and drifted silently when it wasn't.
 * Here, adding a namespace or an event to the preload interface either flows through
 * automatically or fails to compile. Nothing in `src/ipc/` may restate a preload method
 * name, argument list or payload shape.
 *
 * The import is type-only and stays that way: `packages/preload/src/index.ts` calls
 * `contextBridge.exposeInMainWorld` at module scope and imports `electron`, neither of
 * which can exist in the renderer bundle. `verbatimModuleSyntax` guarantees the statement
 * is erased rather than emitted.
 *
 * ONE KNOWN HOLE, for whoever builds the file-dialog surface. Three `app` members are typed
 * with Electron's global namespace — `showOpenDialog(options: Electron.OpenDialogOptions)`,
 * `showSaveDialog`, and both of their return types (`preload/src/index.ts:353-358`). This
 * package's tsconfig sets `"types": ["vite/client"]` on purpose, so Electron's global
 * declarations are never loaded, and `skipLibCheck` swallows the resulting unresolved
 * reference inside preload's `.d.ts`. The effect is that those parameter and return types
 * silently degrade to error types, which behave like `any`: measured, not assumed —
 * `const s: string = {} as Parameters<JoineryAPI['app']['showOpenDialog']>[0]` compiles.
 * So those three signatures give you NO argument checking. `app.saveToFile` is unaffected,
 * because preload declares its options inline rather than borrowing Electron's. Type the
 * dialog options locally at that call site, or add the electron types to this tsconfig
 * (which contradicts the sandbox rationale in the comment there) — but do not assume the
 * compiler is checking them today.
 */

import type { JoineryAPI } from '@joinery/preload';

/** Top-level groups on the bridge: `connection`, `explorer`, `query`, `menu`, … */
export type IpcNamespace = keyof JoineryAPI;

/** Every member of a namespace, request/response and event subscription alike. */
export type IpcMember<N extends IpcNamespace> = keyof JoineryAPI[N] & string;

/** The unsubscribe function every `on*` member hands back. */
export type IpcUnsubscribe = () => void;

/** The shape of every `on*` member: hand it a callback, get a teardown back. */
export type IpcSubscribe<TPayload> = (callback: (payload: TPayload) => void) => IpcUnsubscribe;

/**
 * True for `on*` event members, false for `invoke`-backed ones.
 *
 * `callback: never` rather than `callback: (payload: unknown) => void` is load-bearing.
 * Parameters are contravariant, so a `never` parameter is assignable to *any* callback
 * signature — which is what lets one predicate match both arities the bridge actually
 * uses: `(callback: (chunk: ChatStreamChunk) => void) => () => void` (payload events) and
 * `(callback: () => void) => () => void` (the 31 `menu.on*` commands). A `unknown`
 * payload matches the first and rejects the second. Request/response members are excluded
 * because `Promise<T>` is not assignable to `() => void`.
 */
type IsIpcSubscription<TMember> = TMember extends (callback: never) => () => void ? true : false;

/** The `on*` members of one namespace. `never` for namespaces that carry no events. */
export type IpcEventName<N extends IpcNamespace> = {
  [K in keyof JoineryAPI[N]]-?: IsIpcSubscription<JoineryAPI[N][K]> extends true ? K : never;
}[keyof JoineryAPI[N]] &
  string;

/** The request/response members of one namespace — everything `IpcEventName` excludes. */
export type IpcOperation<N extends IpcNamespace> = Exclude<IpcMember<N>, IpcEventName<N>>;

/**
 * Namespaces that carry at least one event. Narrowing `useIpcEvent`'s first argument to
 * this — rather than to all of `IpcNamespace` — is what makes `useIpcEvent('connection', …)`
 * a compile error instead of a runtime `undefined is not a function`.
 */
export type IpcEventNamespace = {
  [N in IpcNamespace]: [IpcEventName<N>] extends [never] ? never : N;
}[IpcNamespace];

/**
 * What the handler for one event receives.
 *
 * The `void` fallback is for the zero-argument `menu.on*` commands: a source callback of
 * `() => void` is not assignable to a target of `(payload: infer P) => void` (a target may
 * declare *fewer* parameters than the source, never more), so inference fails and the
 * false branch is taken. `IpcEventName` has already established that `E` is a
 * subscription, so the only member that can reach the fallback is a payload-less one, and
 * `void` describes it exactly.
 */
export type IpcEventPayload<
  N extends IpcEventNamespace,
  E extends IpcEventName<N>,
> = JoineryAPI[N][E] extends (callback: (payload: infer TPayload) => void) => () => void
  ? TPayload
  : void;
