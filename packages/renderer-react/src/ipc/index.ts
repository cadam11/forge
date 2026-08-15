/**
 * The IPC client layer. `src/ipc/` is the only part of the renderer that may read
 * `window.joinery`; everything else imports from here.
 */

export { findJoineryApi, ipc, IpcUnavailableError, isIpcAvailable } from './api';
export { ipcKeys, type IpcKeyFactory, type IpcQueryKey } from './keys';
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
