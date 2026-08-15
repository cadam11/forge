/**
 * The single boundary at which this renderer touches `window.joinery`.
 *
 * Every other module in the app reaches the bridge through `ipc()` or `findJoineryApi()`,
 * so the "are we actually inside Electron?" question is answered in exactly one place.
 * The Angular renderer instead cached an `isAvailable` flag and then re-checked it at
 * individual call sites (`ipc.service.ts:426-444,784-799`), which is why four of its
 * hundred-odd methods degrade gracefully in a plain browser and the rest throw.
 */

import type { JoineryAPI } from '@joinery/preload';

/**
 * Thrown by `ipc()` when the bridge is missing. A named class rather than a bare `Error`
 * so a caller — or a TanStack Query error boundary — can tell "this build is not running
 * in Electron" apart from "the main process rejected the call", which need different UI.
 */
export class IpcUnavailableError extends Error {
  constructor() {
    super(
      'window.joinery is not exposed. This renderer is running outside Electron, so the ' +
        'preload bridge never installed itself.'
    );
    this.name = 'IpcUnavailableError';
  }
}

/**
 * The bridge if it is there, `undefined` if it is not.
 *
 * The cast through `unknown` is deliberate and is the only one in this layer. Importing
 * `JoineryAPI` also pulls in the preload package's `declare global { interface Window {
 * joinery: JoineryAPI } }`, which types the property as always present. That is true in
 * the packaged app and a lie when `pnpm --filter @joinery/renderer-react start` is opened
 * in a normal browser tab — the case this function exists to report. So the declaration is
 * widened back to the truth here, once, instead of being trusted everywhere.
 */
export function findJoineryApi(): JoineryAPI | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const exposed: unknown = window.joinery;
  return exposed as JoineryAPI | undefined;
}

/** Non-throwing probe, for UI that renders a "browser mode" state instead of failing. */
export function isIpcAvailable(): boolean {
  return findJoineryApi() !== undefined;
}

/**
 * The bridge, or a thrown `IpcUnavailableError`.
 *
 * This is what query and mutation functions call. Throwing is correct there: TanStack
 * Query turns it into an `isError` state with the error attached, which is a rendered,
 * inspectable failure rather than a silent empty result.
 */
export function ipc(): JoineryAPI {
  const api = findJoineryApi();
  if (api === undefined) {
    throw new IpcUnavailableError();
  }
  return api;
}
