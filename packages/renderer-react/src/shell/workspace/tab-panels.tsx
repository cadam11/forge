/**
 * The five placeholder panels the dock mounts, one per tab type. Phase B replaces each one with
 * the real surface (welcome → Task 19, query → Task 10, object → Task 19, erd → Task 18,
 * chat → Task 17), and this file goes with the last of them.
 *
 * They are deliberately not empty divs. A placeholder's job here is to prove the seams the shell
 * owns actually work end to end, and there are three:
 *
 *  - the panel knows **which tab it is** and can read that tab's connection and database, which is
 *    the contract every Phase B surface consumes (`params.tabId`, never a prop drilled from the
 *    shell);
 *  - the query placeholder writes through `setTabContent`, so the **dirty dot, the content map and
 *    `saveTabs`** are exercised by the only surface that can exercise them before Monaco exists.
 *    Without it, "the shell tracks unsaved work" would be a claim with no way to check it — the
 *    gate screenshot of a dirty tab is taken by typing here;
 *  - every panel states what replaces it, so a placeholder cannot be mistaken for a finished
 *    surface in a screenshot or a demo.
 */

import type { IDockviewPanelProps } from 'dockview-react';
import { House, Network, Sparkles, Table2, type LucideIcon } from 'lucide-react';

import { EmptyState, cn } from '../../ui';
import { useTabStore, tabStore, type Tab } from '../../state/tab';

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

/**
 * The query placeholder, and the only one with behaviour.
 *
 * The textarea is bound to the tab store's content map exactly as Monaco will be in Task 10:
 * `getTabContent` for the initial value, `setTabContent` per change. That makes the dirty dot, the
 * clean baseline and the debounced `saveTabs` live in this build — and it is what the gate types
 * into to produce a dirty tab. It is a textarea and not a pretend editor on purpose; nothing about
 * it should look finished.
 */
export function QueryPanel(props: IDockviewPanelProps) {
  const tab = useTabFromParams(props);
  const tabId = tab?.id;
  const isDirty = tab?.isDirty === true;

  return (
    <div className={cn(PANEL_CLASSES, 'gap-2 p-3')} data-testid="panel-query">
      <div className="flex items-center justify-between gap-2">
        <TabContext tab={tab} />
        <p className="font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          {isDirty ? 'unsaved' : 'saved'}
        </p>
      </div>
      <textarea
        aria-label="SQL (placeholder editor)"
        data-testid="panel-query-editor"
        spellCheck={false}
        defaultValue={tabId === undefined ? '' : tabStore.getState().getTabContent(tabId)}
        onChange={event => {
          if (tabId !== undefined) tabStore.getState().setTabContent(tabId, event.target.value);
        }}
        className={cn(
          'min-h-0 grow resize-none rounded-sm border border-rule bg-surface p-2',
          'font-mono text-sm text-fg placeholder:text-fg-subtle',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
        )}
        placeholder="-- Monaco arrives in Task 10. Typing here exercises the dirty-tab wiring."
      />
    </div>
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

export function ErdPanel(props: IDockviewPanelProps) {
  const tab = useTabFromParams(props);
  return (
    <Placeholder
      testId="panel-erd"
      icon={Network}
      title="Entity diagram"
      description="The ERD canvas lands in Task 18."
      tab={tab}
    />
  );
}

export function ChatPanel(props: IDockviewPanelProps) {
  const tab = useTabFromParams(props);
  return (
    <Placeholder
      testId="panel-chat"
      icon={Sparkles}
      title="AI chat"
      description="Streaming chat and tool confirmation land in Task 17."
      tab={tab}
    />
  );
}
