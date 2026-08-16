/**
 * The sidebar's frame. Task 8 fills it.
 *
 * This task owns the sidebar as a *pane* — resizable, collapsible, persisted, and correctly ruled —
 * because that is shell geometry and the audit's findings about it are shell findings. What goes
 * inside (the connection list, the database picker, the lazy virtualized object tree, the
 * capability-gated folders, the seven dialog entry points, and the inline brand mark) is the largest
 * single surface in the app at 1,926 LOC and is Task 8's whole job.
 *
 * So this renders the header and an empty state that says what it is waiting for. It draws no
 * border on its right edge: the divider owns that hairline (`resize-handle.tsx`).
 */

import { Database } from 'lucide-react';

import { EmptyState } from '../ui';

export function SidebarPanel() {
  return (
    <aside
      aria-label="Connections"
      data-testid="sidebar"
      className="flex h-full min-h-0 min-w-0 flex-col bg-chrome"
    >
      <div className="flex h-8 shrink-0 items-center border-b border-rule px-3">
        <h2 className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">Connections</h2>
      </div>

      <div className="flex min-h-0 grow items-center justify-center p-4">
        <EmptyState
          size="sm"
          icon={Database}
          title="No connections yet"
          description="The connection tree and the database explorer land in Task 8."
        />
      </div>
    </aside>
  );
}
