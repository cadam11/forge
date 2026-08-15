/**
 * Root. Renders the Task 2 token preview, which is the entire renderer until the shell
 * lands in Task 7 — the primitives arrive in Task 6.
 *
 * `IpcQueryProvider` is mounted here rather than deeper because TanStack Query's cache is
 * app-wide: hoisting it later would discard every cached result at the seam.
 */

import { TokenPreview } from './dev/token-preview';
import { IpcQueryProvider } from './ipc';

export function App() {
  return (
    <IpcQueryProvider>
      <TokenPreview />
    </IpcQueryProvider>
  );
}
