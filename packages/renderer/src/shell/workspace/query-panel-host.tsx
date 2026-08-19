/**
 * The lazy boundary in front of the query tab, and the reason Monaco is not in the shell's bundle.
 *
 * Measured, not assumed. Importing `features/query` eagerly takes the entry chunk from **1,285,314 bytes
 * to 5,465,280** — Monaco's editor core, its ~80 language registrations and the codicon font all land in
 * it — and that is startup cost paid by every user on every launch, including the ones who open the
 * welcome tab and a connection dialog and nothing else. CLAUDE.md's performance rules say to defer
 * non-critical initialization, and 4MB of editor behind a tab nobody has opened is exactly that.
 *
 * With the boundary the entry chunk is **1,293,304 bytes — +7,990 on the pre-task baseline**, and Monaco
 * sits in lazy chunks (`query-panel`, `editor.api`, one per language, one per worker) fetched the first
 * time a query tab mounts. Under `file://` that is a local disk read with no network involved, and the R1
 * spike confirmed dynamic imports resolve from inside the asar — Monaco's own language tokenizers are
 * loaded the same way, which is what made the spike's SQL highlighting work at all. The Suspense fallback
 * is what a user sees for that one read: a spinner in the panel, where the editor is about to be.
 *
 * The boundary lives here rather than inside `features/query` because the dock is what mounts panels, and
 * because a `lazy()` call inside the module being lazily loaded would be a cycle.
 */

import { Suspense, lazy } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';

import { Spinner } from '../../ui';

const QueryPanel = lazy(async () => ({
  default: (await import('../../features/query/query-panel')).QueryPanel,
}));

export function QueryPanelHost(props: IDockviewPanelProps) {
  return (
    <Suspense
      fallback={
        <div
          data-testid="query-panel-loading"
          className="flex h-full items-center justify-center bg-canvas"
        >
          <Spinner label="Loading the editor…" />
        </div>
      }
    >
      <QueryPanel {...props} />
    </Suspense>
  );
}
