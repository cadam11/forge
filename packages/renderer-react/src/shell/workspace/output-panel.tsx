/**
 * The Output / Console panel: the unified main + renderer log timeline, an errors-only filter,
 * per-entry detail, copy, and a link that reveals the log file on disk.
 *
 * Ported from `packages/renderer/src/app/layout/output-panel/output-panel.component.ts` (321), with
 * two structural changes:
 *
 *  - **It is a Dockview panel, not a strip.** The Angular version was `height: 220px` in the
 *    shell's stylesheet (`shell.component.ts:181-186`) — not resizable, not movable, and the audit
 *    flagged it next to a sidebar that was both. Here it is a panel in a group below the tabs, so
 *    it resizes, docks anywhere, and its position is part of the persisted layout.
 *  - **Its header is Dockview's tab**, so the panel body carries only the filter and the actions.
 *    The Angular header re-implemented a tab strip inside a panel that was already inside a tab
 *    manager.
 *
 * The "scroll to the entry an error toast pointed at" behaviour is kept: `focusedEntryId` is set by
 * `logStore.open(id)` and cleared once honoured, which is the same one-shot the Angular
 * `ngAfterViewChecked` implemented with a `lastFocusHandled` field.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Copy, FolderOpen, Trash2 } from 'lucide-react';
import type { LogEntry } from '@joinery/shared';

import { EmptyState, Icon, Tooltip, cn } from '../../ui';
import { logStore, useLogStore, selectErrorCount } from '../../state/logs';

type LevelFilter = 'all' | 'errors';

/** `HH:mm:ss.SSS`, the format the Angular template's `date` pipe produced. */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

const LEVEL_CLASSES: Record<string, string> = {
  error: 'text-danger',
  warn: 'text-warning',
  // PROPOSAL §2.2: info is NOT blue. It is the muted foreground, and `text-info` resolves to it.
  info: 'text-info',
  debug: 'text-fg-subtle',
};

const ACTION_CLASSES = cn(
  'flex size-5 items-center justify-center rounded-xs border-0 bg-transparent text-fg-muted',
  'hover:bg-hover hover:text-fg',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus'
);

const FILTER_CLASSES = cn(
  'flex h-5 items-center gap-1.5 rounded-xs border-0 bg-transparent px-2 text-xs text-fg-muted',
  'hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
  'aria-pressed:bg-active aria-pressed:text-fg'
);

function LogRow({
  entry,
  expanded,
  focused,
  onToggle,
}: {
  readonly entry: LogEntry;
  readonly expanded: boolean;
  readonly focused: boolean;
  readonly onToggle: () => void;
}) {
  const hasDetail = typeof entry.detail === 'string' && entry.detail.length > 0;

  return (
    <div
      data-testid="output-row"
      data-entry-id={entry.id}
      data-level={entry.level}
      className={cn(
        'group border-b border-rule last:border-b-0',
        focused && 'outline-2 -outline-offset-2 outline-focus'
      )}
    >
      {/* A row is a button only when it has detail to disclose; a plain row is not interactive,
          so it gets no hover affordance either (interactivity.md). */}
      {hasDetail ? (
        <button
          type="button"
          aria-expanded={expanded}
          data-testid="output-row-toggle"
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-1.5 border-0 bg-transparent px-2 py-0.5 text-left',
            'hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus'
          )}
        >
          <Icon
            icon={ChevronRight}
            size="sm"
            className={cn('stroke-fg-subtle transition-transform', expanded && 'rotate-90')}
          />
          <LogRowBody entry={entry} />
        </button>
      ) : (
        <div className="flex w-full items-center gap-1.5 px-2 py-0.5">
          <span aria-hidden="true" className="size-3.5 shrink-0" />
          <LogRowBody entry={entry} />
        </div>
      )}

      {hasDetail && expanded ? (
        <pre
          data-testid="output-row-detail"
          className="overflow-x-auto bg-surface px-2 py-1.5 pl-9 text-xs text-fg-muted"
        >
          {entry.detail}
        </pre>
      ) : null}
    </div>
  );
}

function LogRowBody({ entry }: { readonly entry: LogEntry }) {
  return (
    <>
      <span className="shrink-0 font-mono text-xs tabular-nums text-fg-subtle">
        {formatTime(entry.timestamp)}
      </span>
      <span
        className={cn(
          'w-10 shrink-0 font-mono text-2xs tracking-eyebrow uppercase',
          LEVEL_CLASSES[entry.level] ?? 'text-fg-muted'
        )}
      >
        {entry.level}
      </span>
      <span className="shrink-0 font-mono text-xs text-fg-muted">{entry.tag}</span>
      <span className="min-w-0 grow truncate font-mono text-xs text-fg">{entry.message}</span>
    </>
  );
}

export function OutputPanel() {
  const entries = useLogStore(state => state.entries);
  const errorCount = useLogStore(selectErrorCount);
  const focusedEntryId = useLogStore(state => state.focusedEntryId);
  const [filter, setFilter] = useState<LevelFilter>('all');
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set());
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(
    () => (filter === 'errors' ? entries.filter(e => e.level === 'error') : entries),
    [entries, filter]
  );

  // Honour "scroll to this entry" once per id, then clear it — the store's flag is a request, not
  // state the panel should keep re-satisfying on every render.
  useEffect(() => {
    if (focusedEntryId === null) return;
    const row = scrollRef.current?.querySelector(`[data-entry-id="${focusedEntryId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    setExpandedIds(current => new Set(current).add(focusedEntryId));
    logStore.getState().clearFocus();
  }, [focusedEntryId, visible]);

  const toggle = (id: string): void =>
    setExpandedIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copy = (entry: LogEntry): void => {
    const text = `[${entry.level.toUpperCase()}] [${entry.tag}] ${entry.message}${
      entry.detail === undefined ? '' : `\n${entry.detail}`
    }`;
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-testid="output-panel">
      <div className="flex shrink-0 items-center gap-1 border-b border-rule px-2 py-1">
        <div role="group" aria-label="Log level" className="flex items-center gap-0.5">
          <button
            type="button"
            aria-pressed={filter === 'all'}
            data-testid="output-filter-all"
            onClick={() => setFilter('all')}
            className={FILTER_CLASSES}
          >
            Log <span className="tabular-nums text-fg-subtle">{entries.length}</span>
          </button>
          <button
            type="button"
            aria-pressed={filter === 'errors'}
            data-testid="output-filter-errors"
            onClick={() => setFilter('errors')}
            className={FILTER_CLASSES}
          >
            Errors{' '}
            <span className={cn('tabular-nums', errorCount > 0 ? 'text-danger' : 'text-fg-subtle')}>
              {errorCount}
            </span>
          </button>
        </div>

        <span className="grow" />

        <Tooltip content="Reveal the log file">
          <button
            type="button"
            aria-label="Reveal the log file"
            data-testid="output-reveal-file"
            onClick={() => logStore.getState().revealFile()}
            className={ACTION_CLASSES}
          >
            <Icon icon={FolderOpen} size="sm" />
          </button>
        </Tooltip>
        <Tooltip content="Clear the panel">
          <button
            type="button"
            aria-label="Clear the panel"
            data-testid="output-clear"
            onClick={() => logStore.getState().clear()}
            className={ACTION_CLASSES}
          >
            <Icon icon={Trash2} size="sm" />
          </button>
        </Tooltip>
      </div>

      <div ref={scrollRef} className="min-h-0 grow overflow-auto" data-testid="output-body">
        {visible.length === 0 ? (
          <div className="p-4">
            <EmptyState
              size="sm"
              title={filter === 'errors' ? 'No errors' : 'No log entries yet'}
              description={
                filter === 'errors'
                  ? 'Errors from the app and from this window will appear here.'
                  : 'The timeline shows entries from the main process and this window.'
              }
            />
          </div>
        ) : (
          visible.map(entry => (
            <div key={entry.id} className="group relative">
              <LogRow
                entry={entry}
                expanded={expandedIds.has(entry.id)}
                focused={entry.id === focusedEntryId}
                onToggle={() => toggle(entry.id)}
              />
              <button
                type="button"
                aria-label={`Copy ${entry.message}`}
                data-testid="output-row-copy"
                onClick={() => copy(entry)}
                className={cn(
                  ACTION_CLASSES,
                  'absolute top-0.5 right-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                )}
              >
                <Icon icon={Copy} size="sm" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
