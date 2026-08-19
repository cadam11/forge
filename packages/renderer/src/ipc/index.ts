/**
 * The IPC client layer. `src/ipc/` is the only part of the renderer that may read
 * `window.joinery`; everything else imports from here.
 */

export { findJoineryApi, ipc, IpcUnavailableError, isIpcAvailable } from './api';
export { dropMainMetadataCaches } from './main-metadata-cache';
/**
 * `ipcKeys` itself is deliberately NOT re-exported, and `eslint.config.js` bans naming it outside
 * this directory. Invalidate through `useInvalidateIpc` instead; read through `useIpcQuery`, which
 * builds its own key. See `use-invalidate-ipc.ts` for the reasoning.
 */
export { type IpcKeyFactory, type IpcQueryKey } from './keys';
export { useInvalidateIpc, type IpcInvalidator } from './use-invalidate-ipc';
export { createIpcQueryClient, IpcQueryProvider } from './query-provider';
export type {
  IpcEventName,
  IpcEventNamespace,
  IpcEventPayload,
  IpcMember,
  IpcNamespace,
  IpcOperation,
  IpcSubscribe,
  IpcUnsubscribe,
} from './surface';
export {
  useIpcMutation,
  useIpcQuery,
  type IpcArgs,
  type IpcResult,
  type UseIpcMutationOptions,
  type UseIpcQueryOptions,
} from './use-ipc-call';
export { useIpcEvent } from './use-ipc-event';
