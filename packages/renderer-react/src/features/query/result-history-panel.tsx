/**
 * Result history: every snapshot this tab has produced, pinnable, labellable, and comparable two at
 * a time. Lives as a tab in the results pane, which is where the Angular panel lived too
 * (`query.component.ts:510-520`, the `history` case of its result-tab strip).
 *
 * Replaces `result-history-panel.component.ts` (1,059 lines). What changed, and why:
 *
 *  - **Labelling works.** Angular labelled a snapshot with `window.prompt` (`:962`) and purged with
 *    another one (`:1019`) — and **Chromium in Electron does not implement `prompt`**: it returns
 *    `null` without showing anything, so "Add Label" and "Purge Old Results" have never done
 *    anything in the packaged app. Labelling is an inline field on the row; purge is not rebuilt here
 *    (see the gaps in the Task 14 report).
 *  - **No `confirm` either.** `deleteSnapshot`/`deleteSelected` used `window.confirm`, which does
 *    work, but a destructive action inside a panel needs the app's own dialog language rather than a
 *    Chromium sheet. Delete is deliberately not in this panel: the store implements it, Task 19's
 *    query-history dialog is where the management surface belongs, and shipping a delete with no
 *    confirmation to save 40 lines would be the wrong trade.
 *  - **The panel does not own a collapsed state.** Angular's had `expanded`, a 40px header and a
 *    300px max-height because it was crammed under the grid. As a result tab it gets the whole pane.
 *
 * ── Who writes the snapshots ──────────────────────────────────────────────────────────────────
 *
 * The main process, on every execute (`query.ipc.ts:59-78`). So this panel READS, and the one write
 * it offers is `captureResultSnapshot` — a pinned baseline of the result on screen, which is what a
 * diff needs to survive the retention sweep. See `snapshots.ts`'s header.
 *
 * That write is also why the list refreshes on demand rather than watching: main's snapshot write is
 * a `setImmediate` AFTER the reply reaches the renderer, so "reload when a result lands" is a race
 * with a store on the other side of an IPC boundary. The panel reloads when it mounts, when the tab's
 * result changes, and when the user asks — and `Refresh` is a visible affordance rather than a
 * workaround, because a second Joinery window can write snapshots for the same tab.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownUp,
  Bookmark,
  Check,
  GitCompareArrows,
  History,
  Pin,
  PinOff,
  RefreshCw,
  Tag,
} from 'lucide-react';
import type { QueryResult, QueryResultSnapshot } from '@joinery/shared';

import { notify } from '../../state/diagnostics';
import {
  queryResultsStore,
  selectCanCompare,
  useQueryResultsStore,
} from '../../state/query-results';
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Spinner,
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  Tooltip,
  cn,
} from '../../ui';
import { ResultDiffView } from './result-diff-view';
import {
  captureResultSnapshot,
  DEFAULT_SNAPSHOT_SORT,
  formatSnapshotStats,
  formatSnapshotTime,
  nextSort,
  snapshotLabel,
  snapshotSqlPreview,
  sortSnapshots,
  type SnapshotSortField,
} from './snapshots';

const SORT_LABELS: Record<SnapshotSortField, string> = {
  executedAt: 'Time',
  totalRowCount: 'Rows',
  executionTimeMs: 'Duration',
};

export interface ResultHistoryPanelProps {
  readonly tabId: string;
  /** The result on screen, for Capture. `null` when the tab has not run anything. */
  readonly result: QueryResult | null;
  /** The connection and database a capture is filed under, from the tab. */
  readonly connectionId: string | null;
  readonly database: string | null;
  /** The SQL that produced `result`, recorded by the execution store. */
  readonly sql: string | null;
  /** Replaces the tab's displayed result with this snapshot's rows. */
  readonly onView: (snapshot: QueryResultSnapshot) => void;
}

export function ResultHistoryPanel({
  tabId,
  result,
  connectionId,
  database,
  sql,
  onView,
}: ResultHistoryPanelProps) {
  const snapshots = useQueryResultsStore(state => state.snapshots);
  const loading = useQueryResultsStore(state => state.loading);
  const selectedIds = useQueryResultsStore(state => state.selectedIds);
  const canCompare = useQueryResultsStore(selectCanCompare);
  const diff = useQueryResultsStore(state => state.currentDiff);

  const [sort, setSort] = useState(DEFAULT_SNAPSHOT_SORT);
  const [labelling, setLabelling] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const reload = useCallback(() => {
    void queryResultsStore.getState().loadSnapshotsForTab(tabId);
  }, [tabId]);

  // On mount, and again whenever this tab's result changes — a new run means a new snapshot main
  // has just written. `result` is the identity from the execution store's map, so this fires once
  // per query rather than once per render.
  useEffect(reload, [reload, result]);

  // The selection is a store-wide list and the comparison is a store-wide slot; both belong to the
  // panel that made them, so leaving takes them with it.
  useEffect(
    () => () => {
      queryResultsStore.getState().clearSelection();
      queryResultsStore.getState().clearDiff();
    },
    [tabId]
  );

  const sorted = sortSnapshots(snapshots, sort.field, sort.order);

  const chooseSort = useCallback((field: SnapshotSortField) => {
    setSort(current => nextSort(current, field));
  }, []);

  const compare = useCallback(() => {
    void queryResultsStore.getState().compareSelected();
  }, []);

  const capture = useCallback(() => {
    if (result === null || connectionId === null || database === null) return;
    setCapturing(true);
    void captureResultSnapshot({
      tabId,
      sql: sql ?? '',
      connectionId,
      database,
      result,
    })
      .then(snapshot => {
        if (snapshot !== null) notify.success('Result captured and pinned');
      })
      .finally(() => setCapturing(false));
  }, [connectionId, database, result, sql, tabId]);

  const canCapture =
    result !== null && result.error === undefined && connectionId !== null && database !== null;

  return (
    <div className="flex min-h-0 grow flex-col" data-testid="history-panel">
      <Toolbar aria-label="Result history" data-testid="history-toolbar" className="gap-2">
        <p className="flex shrink-0 items-baseline gap-3 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          <span className="text-fg">
            <span className="tabular-nums" data-testid="history-count">
              {snapshots.length}
            </span>{' '}
            {snapshots.length === 1 ? 'snapshot' : 'snapshots'}
          </span>
          {selectedIds.length === 0 ? null : (
            <span className="text-accent" data-testid="history-selected-count">
              <span className="tabular-nums">{selectedIds.length}</span> selected
            </span>
          )}
        </p>

        <ToolbarSpacer />

        <Tooltip
          content={
            canCompare ? 'Compare the two selected snapshots' : 'Select two snapshots to compare'
          }
        >
          <ToolbarButton
            iconOnly
            leadingIcon={GitCompareArrows}
            aria-label="Compare the selected snapshots"
            data-testid="history-compare"
            disabled={!canCompare}
            onClick={compare}
          />
        </Tooltip>

        <Tooltip content="Save the result on screen to history, pinned">
          <ToolbarButton
            iconOnly
            leadingIcon={Bookmark}
            aria-label="Capture the current result"
            data-testid="history-capture"
            disabled={!canCapture || capturing}
            onClick={capture}
          />
        </Tooltip>

        <DropdownMenu>
          <Tooltip content={`Sort by ${SORT_LABELS[sort.field].toLowerCase()}`}>
            <DropdownMenuTrigger asChild>
              <ToolbarButton
                iconOnly
                leadingIcon={ArrowDownUp}
                aria-label="Sort the snapshots"
                data-testid="history-sort"
              />
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            {(Object.keys(SORT_LABELS) as SnapshotSortField[]).map(field => (
              <DropdownMenuItem
                key={field}
                data-testid={`history-sort-${field}`}
                onSelect={() => chooseSort(field)}
              >
                {sort.field === field ? (
                  <Check className="size-4 shrink-0 stroke-accent" aria-hidden />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden />
                )}
                {SORT_LABELS[field]}
                {sort.field === field ? (
                  <span className="ml-auto font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
                    {sort.order}
                  </span>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <ToolbarSeparator />

        <Tooltip content="Reload the list">
          <ToolbarButton
            iconOnly
            leadingIcon={RefreshCw}
            aria-label="Reload the snapshot list"
            data-testid="history-refresh"
            onClick={reload}
          />
        </Tooltip>
      </Toolbar>

      {diff === null ? null : (
        <ResultDiffView diff={diff} onClose={() => queryResultsStore.getState().clearDiff()} />
      )}

      {loading && snapshots.length === 0 ? (
        <div className="flex min-h-0 grow items-center justify-center p-6">
          <Spinner label="Loading the history…" />
        </div>
      ) : snapshots.length === 0 ? (
        <div className="flex min-h-0 grow items-center justify-center p-6">
          <EmptyState
            icon={History}
            size="sm"
            title="No saved results yet"
            description="Every query you run in this tab is saved here. Pin the ones you want to keep."
            data-testid="history-empty"
          />
        </div>
      ) : (
        <ul className="min-h-0 grow overflow-y-auto" data-testid="history-list">
          {sorted.map(snapshot => (
            <SnapshotRow
              key={snapshot.id}
              snapshot={snapshot}
              selected={selectedIds.includes(snapshot.id)}
              labelling={labelling === snapshot.id}
              onToggleSelection={() => queryResultsStore.getState().toggleSelection(snapshot.id)}
              onTogglePin={() => void queryResultsStore.getState().togglePin(snapshot.id)}
              onStartLabelling={() => setLabelling(snapshot.id)}
              onLabel={label => {
                setLabelling(null);
                void queryResultsStore.getState().labelSnapshot(snapshot.id, label);
              }}
              onCancelLabelling={() => setLabelling(null)}
              onView={() => onView(snapshot)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface SnapshotRowProps {
  readonly snapshot: QueryResultSnapshot;
  readonly selected: boolean;
  readonly labelling: boolean;
  readonly onToggleSelection: () => void;
  readonly onTogglePin: () => void;
  readonly onStartLabelling: () => void;
  readonly onLabel: (label: string) => void;
  readonly onCancelLabelling: () => void;
  readonly onView: () => void;
}

function SnapshotRow({
  snapshot,
  selected,
  labelling,
  onToggleSelection,
  onTogglePin,
  onStartLabelling,
  onLabel,
  onCancelLabelling,
  onView,
}: SnapshotRowProps) {
  const pinned = snapshot.isPinned === true;

  return (
    <li
      data-testid="history-row"
      data-snapshot-id={snapshot.id}
      data-pinned={pinned ? 'true' : 'false'}
      className={cn(
        'flex items-start gap-2 border-b border-rule px-2 py-1.5',
        // A left rule marks state, per PROPOSAL §2.1 — no filled banners.
        'border-l-2',
        !snapshot.success ? 'border-l-danger' : pinned ? 'border-l-accent' : 'border-l-transparent',
        selected && 'bg-active'
      )}
    >
      <Checkbox
        name={`history-select-${snapshot.id}`}
        aria-label={`Select the snapshot from ${formatSnapshotTime(snapshot.executedAt)}`}
        data-testid="history-select"
        checked={selected}
        onChange={onToggleSelection}
        fieldClassName="pt-0.5"
      />

      <div className="flex min-w-0 grow flex-col gap-0.5">
        {labelling ? (
          <LabelField
            initial={snapshot.label ?? ''}
            onCommit={onLabel}
            onCancel={onCancelLabelling}
          />
        ) : (
          <button
            type="button"
            data-testid="history-view"
            onClick={onView}
            className="min-w-0 truncate text-left text-sm text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            {snapshotLabel(snapshot)}
          </button>
        )}

        <p className="flex min-w-0 items-baseline gap-2 font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
          <span data-testid="history-time" className="shrink-0 tabular-nums">
            {formatSnapshotTime(snapshot.executedAt)}
          </span>
          <span
            data-testid="history-stats"
            className={cn('shrink-0 tabular-nums', snapshot.success ? undefined : 'text-danger')}
          >
            {formatSnapshotStats(snapshot)}
          </span>
        </p>

        {snapshot.label === undefined || snapshot.label === '' ? null : (
          <p
            className="min-w-0 truncate font-mono text-2xs text-fg-subtle"
            data-testid="history-sql"
          >
            {snapshotSqlPreview(snapshot)}
          </p>
        )}
      </div>

      <Tooltip content="Give this snapshot a name">
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          leadingIcon={Tag}
          aria-label="Label this snapshot"
          data-testid="history-label"
          onClick={onStartLabelling}
        />
      </Tooltip>
      <Tooltip content={pinned ? 'Unpin — it can be purged again' : 'Pin — keep it through purges'}>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          leadingIcon={pinned ? PinOff : Pin}
          aria-label={pinned ? 'Unpin this snapshot' : 'Pin this snapshot'}
          aria-pressed={pinned}
          data-testid="history-pin"
          onClick={onTogglePin}
        />
      </Tooltip>
    </li>
  );
}

/**
 * The inline label editor: Enter commits, Escape abandons, blur commits.
 *
 * Blur commits rather than cancelling because the field is opened by a deliberate click on one row's
 * Label button and the next thing a user does is usually click elsewhere; losing the typing there is
 * the more expensive mistake.
 */
function LabelField({
  initial,
  onCommit,
  onCancel,
}: {
  readonly initial: string;
  readonly onCommit: (label: string) => void;
  readonly onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);

  return (
    <Input
      name="history-label-draft"
      aria-label="Snapshot label"
      data-testid="history-label-input"
      // A ref callback rather than `autoFocus`: the field appears only in response to a deliberate
      // click on this row's Label button, so focus belongs in it — but `autoFocus` is banned outright
      // by `jsx-a11y/no-autofocus` (it also fires on hydration, which this never does).
      ref={node => {
        node?.focus();
      }}
      value={draft}
      className="text-sm"
      onChange={event => setDraft(event.target.value)}
      onBlur={() => onCommit(draft.trim())}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(draft.trim());
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    />
  );
}
