/**
 * The placeholder panels the dock mounts, one per tab type that has no real surface yet — welcome and
 * object, both Task 19. This file goes with the last of them.
 *
 * **Three panels have left.** Task 10 replaced the query panel with `features/query/QueryPanel`,
 * behind the lazy boundary in `query-panel-host.tsx` next door (Monaco is ~4MB of JavaScript, and a
 * user on the welcome tab should not pay for it before they open a query); Task 17 replaced the chat
 * panel with `features/chat/ChatTabPanel`, which needs no lazy boundary — the markdown renderer it
 * depends on is already in the eager chunk for the side panel's sake; Task 18 replaced the ERD panel
 * with `features/erd/ErdPanel`.
 *
 * They are deliberately not empty divs. A placeholder's job here is to prove the seams the shell
 * owns actually work end to end, and there are two:
 *
 *  - the panel knows **which tab it is** and can read that tab's connection and database, which is
 *    the contract every Phase B surface consumes (`params.tabId`, never a prop drilled from the
 *    shell);
 *  - every panel states what replaces it, so a placeholder cannot be mistaken for a finished
 *    surface in a screenshot or a demo.
 */

import type { IDockviewPanelProps, IWatermarkPanelProps } from 'dockview-react';
import { House, LayoutTemplate, Table2, type LucideIcon } from 'lucide-react';

import { Button, EmptyState, cn } from '../../ui';
import { dispatchCommand } from '../../commands';
import { useTabStore, type Tab } from '../../state/tab';

/** Every panel is mounted with `params.tabId`; this is the one place that is read. */
function useTabFromParams(props: IDockviewPanelProps): Tab | undefined {
  const tabId = typeof props.params['tabId'] === 'string' ? props.params['tabId'] : props.api.id;
  return useTabStore(state => state.tabs.find(t => t.id === tabId));
}

const PANEL_CLASSES = 'flex h-full min-h-0 flex-col bg-canvas';

/** The connection / database line every data-bound panel shows. Mono, because they are identifiers. */
function TabContext({ tab }: { readonly tab: Tab | undefined }) {
  if (!tab) return null;
  return (
    <p
      data-testid="panel-tab-context"
      className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase"
    >
      {tab.connectionId ?? 'no connection'} · {tab.databaseName ?? 'no database'}
    </p>
  );
}

function Placeholder({
  testId,
  icon,
  title,
  description,
  tab,
}: {
  readonly testId: string;
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
  readonly tab: Tab | undefined;
}) {
  return (
    <div
      className={cn(PANEL_CLASSES, 'items-center justify-center gap-2 p-6')}
      data-testid={testId}
    >
      <EmptyState icon={icon} title={title} description={description} />
      <TabContext tab={tab} />
    </div>
  );
}

export function WelcomePanel(props: IDockviewPanelProps) {
  const tab = useTabFromParams(props);
  return (
    <Placeholder
      testId="panel-welcome"
      icon={House}
      title="Joinery"
      description="The welcome surface lands in Task 19. The shell, the dock and the status bar are what this build is proving."
      tab={tab}
    />
  );
}

export function ObjectPanel(props: IDockviewPanelProps) {
  const tab = useTabFromParams(props);
  return (
    <Placeholder
      testId="panel-object"
      icon={Table2}
      title="Object details"
      description="The object detail surface lands in Task 19."
      tab={tab}
    />
  );
}

/**
 * What the dock shows with no panels in it.
 *
 * Dockview's own watermark is a `noPanelsOverlay` it renders from vendor CSS, and under this theme
 * it paints nothing at all — the workspace was a blank rectangle with no affordance in it, which is
 * how an app looks broken rather than empty. One `EmptyState` and one way back in: `show-welcome` is
 * a real command with a real handler, so this is the same wire the View menu uses.
 */
export function WorkspaceWatermark(_props: IWatermarkPanelProps) {
  return (
    <div
      data-testid="workspace-empty"
      className="flex h-full items-center justify-center bg-canvas p-6"
    >
      <EmptyState
        icon={LayoutTemplate}
        title="No tabs open"
        description="Open a query with ⌘N, or start from the welcome tab."
        action={
          <Button
            data-testid="workspace-empty-welcome"
            onClick={() => dispatchCommand('show-welcome')}
          >
            Show welcome
          </Button>
        }
      />
    </div>
  );
}
