/**
 * Thin bindings from one bridge operation to one TanStack Query hook.
 *
 * Without them every call site states the operation twice and its arguments twice:
 *
 *   useQuery({
 *     queryKey: ipcKeys.explorer.key('getChildren', connectionId, database, path),
 *     queryFn: () => ipc().explorer.getChildren(connectionId, database, path),
 *   })
 *
 * which is four chances to disagree with itself, and the disagreement is invisible — a key
 * that omits an argument silently serves one node's children for another node.
 *
 * The split of what is inferred and what is not is the whole design:
 *
 * - **The CALL is fully inferred.** `args` is that member's `Parameters<…>`, so arity,
 *   order and types are checked against preload. This is where total inference is correct.
 * - **The KEY is never inferred.** `keyArgs` is supplied separately and is REQUIRED for any
 *   operation that takes parameters. Call arguments are never spread into the key.
 *
 * That second rule is a security property, not a style choice. `connection.test` and
 * `connection.save` take three consecutive optional passwords (PLAN.md §7.1), and
 * `ai.setApiKey`/`validateApiKey` take an API key. Auto-deriving keys from call arguments
 * would put those secrets in the query cache — readable from any component holding the
 * QueryClient, and printed by every cache devtool and error report. Because a machine cannot
 * tell which of an operation's parameters are secret, the default is to include none of them
 * and make the caller name what identifies the result. `keyArgs` is also the right place for
 * the narrower-than-the-call case: keying an explorer node on `connectionId` alone so one
 * reconnect invalidates every database beneath it.
 */

import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { JoineryAPI } from '@joinery/preload';
import { ipc } from './api';
import { ipcKeys, type IpcQueryKey } from './keys';
import type { IpcNamespace, IpcOperation } from './surface';

/**
 * The declared member. `IpcOperation<N>` has already excluded the `on*` subscriptions, so
 * every `O` reaching here is invoke-backed; `& keyof JoineryAPI[N]` only re-states for the
 * compiler what `IpcOperation` derived from it.
 */
type IpcMember<N extends IpcNamespace, O extends IpcOperation<N>> = JoineryAPI[N][O &
  keyof JoineryAPI[N]];

/** The parameter list of one operation, straight from the preload declaration. */
export type IpcArgs<N extends IpcNamespace, O extends IpcOperation<N>> =
  IpcMember<N, O> extends (...args: infer TArgs) => unknown ? TArgs : never;

/** What one operation resolves to, unwrapped from its Promise. */
export type IpcResult<N extends IpcNamespace, O extends IpcOperation<N>> =
  IpcMember<N, O> extends (...args: never[]) => PromiseLike<infer TResult> ? TResult : never;

/**
 * `keyArgs` is optional only for operations that take no parameters at all — there is
 * nothing to leak and nothing to distinguish. Everything else must state its key.
 */
type IpcCallShape<N extends IpcNamespace, O extends IpcOperation<N>> = [IpcArgs<N, O>] extends [
  readonly [],
]
  ? { readonly args?: readonly []; readonly keyArgs?: IpcQueryKey }
  : { readonly args: IpcArgs<N, O>; readonly keyArgs: IpcQueryKey };

/** Everything TanStack accepts except the two fields this hook derives. */
type PassThroughQueryOptions<N extends IpcNamespace, O extends IpcOperation<N>> = Omit<
  UseQueryOptions<IpcResult<N, O>, Error, IpcResult<N, O>, IpcQueryKey>,
  'queryKey' | 'queryFn'
>;

export type UseIpcQueryOptions<N extends IpcNamespace, O extends IpcOperation<N>> = {
  readonly namespace: N;
  readonly operation: O;
} & IpcCallShape<N, O> &
  PassThroughQueryOptions<N, O>;

/**
 * Performs the dynamic dispatch, and is the only place that does.
 *
 * The cast is the same unavoidable one `useIpcEvent` carries: `IpcOperation` has proved the
 * member exists and is invoke-backed, but a generically indexed access cannot be called as
 * written. The `typeof` check turns a wrong derivation into a named error at the call
 * instead of `undefined is not a function` several frames away.
 */
function callIpc(
  namespace: IpcNamespace,
  operation: string,
  args: readonly unknown[]
): Promise<unknown> {
  const bridge = ipc()[namespace] as unknown as Record<string, unknown>;
  const member = bridge[operation];

  if (typeof member !== 'function') {
    throw new TypeError(`window.joinery.${namespace}.${operation} is not a function`);
  }

  return (member as (...callArgs: readonly unknown[]) => Promise<unknown>)(...args);
}

/**
 * One bridge operation as a cached query.
 *
 * `queryKey` is `[namespace, operation, ...keyArgs]` — never `...args`. See the module
 * comment for why that asymmetry is deliberate.
 */
export function useIpcQuery<N extends IpcNamespace, O extends IpcOperation<N>>(
  options: UseIpcQueryOptions<N, O>
): UseQueryResult<IpcResult<N, O>, Error> {
  const { namespace, operation, args, keyArgs, ...queryOptions } = options;

  return useQuery({
    ...queryOptions,
    queryKey: ipcKeys[namespace].key(operation, ...(keyArgs ?? [])),
    queryFn: () => callIpc(namespace, operation, args ?? []) as Promise<IpcResult<N, O>>,
  });
}

export type UseIpcMutationOptions<N extends IpcNamespace, O extends IpcOperation<N>> = {
  readonly namespace: N;
  readonly operation: O;
} & Omit<UseMutationOptions<IpcResult<N, O>, Error, IpcArgs<N, O>>, 'mutationFn'>;

/**
 * One bridge operation as a mutation. `mutate(args)` takes the operation's own parameter
 * list, so `connection.save(profile, password)` is `mutate([profile, password])`.
 *
 * There is no key here at all, which is the structural answer to the secret-in-cache
 * problem for the write path: a mutation's variables are held for the duration of the call
 * and are never written to the query cache. Invalidate afterwards with `ipcKeys`.
 */
export function useIpcMutation<N extends IpcNamespace, O extends IpcOperation<N>>(
  options: UseIpcMutationOptions<N, O>
): UseMutationResult<IpcResult<N, O>, Error, IpcArgs<N, O>> {
  const { namespace, operation, ...mutationOptions } = options;

  return useMutation({
    ...mutationOptions,
    mutationFn: (args: IpcArgs<N, O>) =>
      callIpc(namespace, operation, args) as Promise<IpcResult<N, O>>,
  });
}
