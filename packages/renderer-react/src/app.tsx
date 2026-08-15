/**
 * Root. Renders the dev shell, which is the Task 2 token preview plus the Task 6 primitives
 * gallery — the entire renderer until the real shell lands in Task 7.
 *
 * `IpcQueryProvider` is mounted here rather than deeper because TanStack Query's cache is
 * app-wide: hoisting it later would discard every cached result at the seam.
 */

import { DevRoot } from './dev/dev-root';
import { IpcQueryProvider } from './ipc';

export function App() {
  return (
    <IpcQueryProvider>
      <DevRoot />
    </IpcQueryProvider>
  );
}
