/**
 * Root. Renders the Task 2 token preview, which is the entire renderer until the shell
 * lands in Task 7 — the IPC layer arrives in Task 3 and the primitives in Task 6.
 */

import { TokenPreview } from './dev/token-preview';

export function App() {
  return <TokenPreview />;
}
