/**
 * The ERD tab. Replaces the `ErdPanel` placeholder in `shell/workspace/tab-panels.tsx`.
 *
 * Ported from `features/erd/erd.component.ts` (654 LOC, of which ~310 were CSS this file does not
 * need). Reads `params.tabId` and nothing else from the dock, which is the contract every Phase B
 * surface consumes.
 *
 * Two behaviours from the original are worth naming because they look like omissions:
 *
 *  - **it reads the TAB's connection and database, not the app's.** The Angular comment
 *    (`erd.component.ts:496-498`) is right and is kept: with two ERD tabs open against two
 *    connections, the actions have to follow the tab they are in, and `activeTab()` is not that.
 *    Here it is stronger — the panel is given its tab id, so it never consults the active one at all.
 *  - **the focus table starts selected.** `loadERD` did `selectedNodeId.set(schema.table)` after a
 *    focused build, so the rail opens on the table you asked about. `selectedNodeId` below is that
 *    line, plus the thing it forgot: re-selecting when the tab's table changes.
 */

import { useCallback, useMemo, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import {
  Maximize2,
  Network,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import { dispatchCommand } from '../../commands';
import {
  Button,
  EmptyState,
  Spinner,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
} from '../../ui';
import { tabStore, useTabStore, type Tab } from '../../state/tab';
import { ErdCanvas } from './erd-canvas';
import { ErdDetails } from './erd-details';
import { layoutErd, EMPTY_LAYOUT } from './erd-layout';
import type { ErdNode } from './erd-model';
import type { ErdRequest } from './erd-adapter';
import { useErdSchema } from './use-erd-schema';
import { useErdViewport } from './use-erd-viewport';

/** The schema a tab means when its metadata does not say. `dbo` is what `openErdTab` defaults to. */
const FALLBACK_SCHEMA = 'dbo';

export function ErdPanel(props: IDockviewPanelProps) {
  const tabId = typeof props.params['tabId'] === 'string' ? props.params['tabId'] : props.api.id;
  const tab = useTabStore(state => state.tabs.find(candidate => candidate.id === tabId));

  return <ErdSurface tab={tab} />;
}

/**
 * The panel without the dock around it, which is what the spec mounts.
 *
 * Exported because a `IDockviewPanelProps` is 20 fields of dock machinery and a spec that builds one
 * is testing dockview, not the ERD.
 */
export function ErdSurface({ tab }: { readonly tab: Tab | undefined }) {
  const connectionId = tab?.connectionId;
  const databaseName = tab?.databaseName;
  const tableName = readString(tab, 'tableName');
  const schema = readString(tab, 'schema') ?? FALLBACK_SCHEMA;
  const depth = readNumber(tab, 'focusDepth') ?? 2;

  /** Stable by construction: `useErdSchema` depends on this object identity. */
  const request = useMemo<ErdRequest | null>(() => {
    if (connectionId === undefined || databaseName === undefined) return null;
    return tableName === undefined
      ? { connectionId, databaseName }
      : { connectionId, databaseName, tableName, schema, depth };
  }, [connectionId, databaseName, depth, schema, tableName]);

  const { state, reload } = useErdSchema(request);
  const nodes = state.status === 'ready' ? state.nodes : undefined;

  const layout = useMemo(() => (nodes === undefined ? EMPTY_LAYOUT : layoutErd(nodes)), [nodes]);
  const viewport = useErdViewport(layout);
  // Named once, for the reason `erd-canvas.tsx` states: `react-hooks/refs` rejects `viewport.x`
  // inside a render body, because the object carries the diagram's two refs.
  const { transform, zoomIn, zoomOut, fit, reset, centreOn } = viewport;

  /**
   * The selection, and **which focus table it was made against**.
   *
   * `loadERD` set `selectedNodeId` to the focus table after a focused build, so the rail opens on the
   * table you asked about. Carrying the focus in the state is what re-applies that when the tab is
   * repointed at another table, without the `useEffect(() => setSelected(focus), [focus])` that
   * `react-hooks/set-state-in-effect` rejects — correctly, since it is derivable. Same shape as
   * `features/query/row-detail-panel.tsx` carrying the row an interaction belongs to.
   */
  const focusNodeId = tableName === undefined ? null : `${schema}.${tableName}`;
  const [chosen, setChosen] = useState<{
    readonly focus: string | null;
    readonly id: string | null;
  } | null>(null);
  const selectedNodeId = chosen !== null && chosen.focus === focusNodeId ? chosen.id : focusNodeId;

  const presentNodeIds = useMemo(() => new Set((nodes ?? []).map(node => node.id)), [nodes]);
  const selected = (nodes ?? []).find(node => node.id === selectedNodeId);

  const select = useCallback(
    (id: string | null) => setChosen({ focus: focusNodeId, id }),
    [focusNodeId]
  );
  const onSelect = useCallback((node: ErdNode | null) => select(node?.id ?? null), [select]);

  /** Double-click, and the rail's first action. Both open the object's own tab (Task 19's surface). */
  const onOpenObject = useCallback(
    (node: ErdNode) => {
      if (connectionId === undefined || databaseName === undefined) return;
      tabStore
        .getState()
        .openObjectTab(connectionId, databaseName, node.name, 'table', node.schemaName);
    },
    [connectionId, databaseName]
  );

  /**
   * The rail's second action, on the existing reveal wire.
   *
   * Deliberately NOT on selection. `reveal-explorer-node` expands four levels of a lazily-loaded tree,
   * which is up to four IPC round trips — acceptable when a user asks for it, wasteful on every click
   * in a diagram they are reading. The brief's "where cheap" is this line.
   */
  const onReveal = useCallback(
    (node: ErdNode) => {
      if (connectionId === undefined || databaseName === undefined) return;
      dispatchCommand('reveal-explorer-node', {
        connectionId,
        databaseName,
        schema: node.schemaName,
        objectName: node.name,
        objectType: 'table',
      });
    },
    [connectionId, databaseName]
  );

  /** The rail's relationship rows: select the target and bring it into view. */
  const onNavigate = useCallback(
    (nodeId: string) => {
      select(nodeId);
      const placed = layout.nodes.find(candidate => candidate.node.id === nodeId);
      if (placed !== undefined) centreOn(placed);
    },
    [centreOn, layout.nodes, select]
  );

  const title =
    tableName !== undefined
      ? `Relationships: ${tableName}`
      : `Database ERD: ${databaseName ?? 'no database'}`;

  return (
    <div data-testid="panel-erd" className="flex h-full min-h-0 flex-col bg-canvas">
      <Toolbar data-testid="erd-toolbar" aria-label="Diagram controls">
        <span className="min-w-0 truncate text-base text-fg">{title}</span>
        <ToolbarSpacer />
        <span
          data-testid="erd-zoom-level"
          className="shrink-0 font-mono text-2xs tabular-nums text-fg-muted"
        >
          {`${Math.round(transform.k * 100)}%`}
        </span>
        <ToolbarSeparator />
        <ToolbarButton
          data-testid="erd-zoom-out"
          iconOnly
          leadingIcon={ZoomOut}
          aria-label="Zoom out"
          onClick={zoomOut}
        />
        <ToolbarButton
          data-testid="erd-zoom-in"
          iconOnly
          leadingIcon={ZoomIn}
          aria-label="Zoom in"
          onClick={zoomIn}
        />
        <ToolbarButton
          data-testid="erd-zoom-fit"
          iconOnly
          leadingIcon={Maximize2}
          aria-label="Fit to view"
          onClick={fit}
        />
        <ToolbarButton
          data-testid="erd-zoom-reset"
          iconOnly
          leadingIcon={RotateCcw}
          aria-label="Reset zoom"
          onClick={reset}
        />
        <ToolbarSeparator />
        <ToolbarButton
          data-testid="erd-refresh"
          iconOnly
          leadingIcon={RefreshCw}
          aria-label="Refresh diagram"
          onClick={reload}
        />
      </Toolbar>

      {state.status === 'ready' && state.truncated && (
        <p
          data-testid="erd-truncated"
          className="flex items-center gap-1.5 border-b border-rule bg-warning/12 px-3 py-1.5 text-sm text-fg"
        >
          <TriangleAlert aria-hidden className="size-3.5 shrink-0 stroke-warning" />
          This database has more tables than one diagram can show. Showing the first{' '}
          {state.nodes.length}.
        </p>
      )}

      <div className="flex min-h-0 min-w-0 flex-1">
        <ErdBody
          state={state.status}
          message={state.status === 'error' ? state.message : undefined}
          nodeCount={nodes?.length ?? 0}
          onRetry={reload}
        >
          <ErdCanvas
            layout={layout}
            viewport={viewport}
            selectedNodeId={selectedNodeId}
            onSelect={onSelect}
            onOpen={onOpenObject}
          />
        </ErdBody>

        {selected !== undefined && (
          <ErdDetails
            node={selected}
            presentNodeIds={presentNodeIds}
            onClose={() => select(null)}
            onOpenObject={onOpenObject}
            onReveal={onReveal}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}

/** The four things that can be in the body. The canvas is the fourth. */
function ErdBody({
  state,
  message,
  nodeCount,
  onRetry,
  children,
}: {
  readonly state: 'idle' | 'loading' | 'ready' | 'error';
  readonly message: string | undefined;
  readonly nodeCount: number;
  readonly onRetry: () => void;
  readonly children: React.ReactNode;
}) {
  if (state === 'idle') {
    return (
      <Centred testId="erd-idle">
        <EmptyState
          icon={Network}
          title="No database"
          description="Open an ERD from a table's Show Relationships menu, or connect to a database first."
        />
      </Centred>
    );
  }

  if (state === 'loading') {
    return (
      <Centred testId="erd-loading">
        <Spinner size="lg" label="Reading the schema…" />
      </Centred>
    );
  }

  if (state === 'error') {
    return (
      <Centred testId="erd-error">
        <EmptyState
          icon={TriangleAlert}
          title="Could not draw the diagram"
          description={message ?? 'The schema could not be read.'}
          action={
            <Button data-testid="erd-retry" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      </Centred>
    );
  }

  if (nodeCount === 0) {
    return (
      <Centred testId="erd-empty">
        <EmptyState
          icon={Network}
          title="Nothing to draw"
          description="This database has no tables, or the one you opened has no relationships."
        />
      </Centred>
    );
  }

  return <>{children}</>;
}

function Centred({
  testId,
  children,
}: {
  readonly testId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex min-h-0 flex-1 items-center justify-center">
      {children}
    </div>
  );
}

function readString(tab: Tab | undefined, key: string): string | undefined {
  const value = tab?.metadata?.[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Tab metadata is `Record<string, unknown>` read back off disk, so the type is checked, not trusted. */
function readNumber(tab: Tab | undefined, key: string): number | undefined {
  const value = tab?.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
