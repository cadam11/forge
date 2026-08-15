/**
 * Dev-only. Proves the availability guard by rendering both of its outcomes: `pnpm dev`
 * inside Electron shows the bridge and a version, a plain browser tab at :4200 shows
 * "browser mode" instead of a blank page or a thrown error.
 */

import { isIpcAvailable, useIpcQuery } from '../ipc';

export function IpcProbe() {
  const available = isIpcAvailable();
  // Also the first real consumer of useIpcQuery: `app.getVersion` takes no arguments, which
  // is the one case where `keyArgs` may be omitted.
  const version = useIpcQuery({ namespace: 'app', operation: 'getVersion', enabled: available });

  return (
    <dl data-testid="ipc-probe" className="font-mono text-xs text-fg">
      <div className="flex gap-2 border-b border-rule py-1.5">
        <dt className="w-40 text-fg-subtle">window.joinery</dt>
        <dd data-testid="ipc-probe-available">{available ? 'exposed' : 'browser mode'}</dd>
      </div>
      <div className="flex gap-2 py-1.5">
        <dt className="w-40 text-fg-subtle">app.getVersion()</dt>
        <dd data-testid="ipc-probe-version">
          {version.error ? version.error.message : (version.data ?? 'not called')}
        </dd>
      </div>
    </dl>
  );
}
