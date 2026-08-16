/**
 * The inline diff between two snapshots, rendered inside the history panel.
 *
 * The standalone `result-diff-viewer` component (624 lines) is NOT the source: PLAN.md §1.3 marks it
 * DROP — dead, never mounted anywhere — and the surface that shipped is the history panel's own
 * comparison view (`result-history-panel.component.ts:176-296`). That view drew four count tiles and
 * a schema-change list and stopped there: `ResultDiff.rowDiffs` carries every changed row with its
 * cell-level before/after (`shared/.../query-results.types.ts:179-199`) and the Angular panel threw
 * all of it away, so "3 modified" was the end of the answer. The counts are kept; the rows are drawn.
 *
 * Ordering, capping and the added/removed/modified shapes are `result-diff.ts`'s job, and its spec is
 * where the correctness cases live. This file is the paint.
 */

import { ArrowRight, Minus, PenLine, Plus, X } from 'lucide-react';
import type { ResultDiff } from '@joinery/shared';

import { Button, cn } from '../../ui';
import { buildDiffView, type DiffRowKind, type DiffRowView } from './result-diff';
import { formatSnapshotTime } from './snapshots';

export interface ResultDiffViewProps {
  readonly diff: ResultDiff;
  readonly onClose: () => void;
}

/**
 * Per-kind treatment. Chartreuse for added and danger for removed is the app's success/failure pair
 * used as a gain/loss pair, which is what a diff means by them; amber for modified is HOUSE-RULES
 * §5's "non-destructive caution". None of the three is a fill: they are a left rule and a glyph, so
 * two hundred rows of diff do not become two hundred coloured blocks.
 */
const KIND_STYLE: Record<
  DiffRowKind,
  { readonly rule: string; readonly text: string; readonly stroke: string; readonly word: string }
> = {
  // Every class is a literal: Tailwind reads source text, so a class assembled from an interpolation
  // is a class that does not exist in the stylesheet.
  added: { rule: 'border-success', text: 'text-success', stroke: 'stroke-success', word: 'added' },
  removed: { rule: 'border-danger', text: 'text-danger', stroke: 'stroke-danger', word: 'removed' },
  modified: {
    rule: 'border-warning',
    text: 'text-warning',
    stroke: 'stroke-warning',
    word: 'changed',
  },
};

const KIND_ICON = { added: Plus, removed: Minus, modified: PenLine } as const;

export function ResultDiffView({ diff, onClose }: ResultDiffViewProps) {
  const view = buildDiffView(diff);

  return (
    <section
      data-testid="history-diff"
      aria-label="Snapshot comparison"
      className="flex min-h-0 flex-col border-b border-rule bg-surface"
    >
      <header className="flex h-(--panel-header-height) shrink-0 items-center gap-2 border-b border-rule px-2">
        <p className="min-w-0 grow truncate font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          <span data-testid="history-diff-base">{formatSnapshotTime(view.base.executedAt)}</span>
          <ArrowRight
            className="mx-1 inline-block size-3.5 align-text-bottom stroke-fg-subtle"
            aria-hidden
          />
          <span data-testid="history-diff-compare">
            {formatSnapshotTime(view.compare.executedAt)}
          </span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          leadingIcon={X}
          aria-label="Close the comparison"
          data-testid="history-diff-close"
          onClick={onClose}
        />
      </header>

      <div className="flex shrink-0 items-baseline gap-3 border-b border-rule px-2 py-1.5 font-mono text-2xs tracking-eyebrow uppercase">
        <Count
          testId="history-diff-added"
          className="text-success"
          value={view.counts.added}
          word="added"
        />
        <Count
          testId="history-diff-removed"
          className="text-danger"
          value={view.counts.removed}
          word="removed"
        />
        <Count
          testId="history-diff-modified"
          className="text-warning"
          value={view.counts.modified}
          word="changed"
        />
        <Count
          testId="history-diff-unchanged"
          className="text-fg-subtle"
          value={view.counts.unchanged}
          word="same"
        />
      </div>

      {view.schema.changed ? (
        <ul
          data-testid="history-diff-schema"
          className="flex shrink-0 flex-col gap-0.5 border-b border-rule px-2 py-1.5 text-sm text-fg-muted"
        >
          {view.schema.added.map(name => (
            <li key={`+${name}`}>
              <span className="text-success">+</span> column{' '}
              <span className="font-mono">{name}</span>
            </li>
          ))}
          {view.schema.removed.map(name => (
            <li key={`-${name}`}>
              <span className="text-danger">−</span> column{' '}
              <span className="font-mono">{name}</span>
            </li>
          ))}
          {view.schema.modified.map(column => (
            <li key={`~${column.name}`}>
              <span className="text-warning">~</span>{' '}
              <span className="font-mono">{column.name}</span> {column.before} → {column.after}
            </li>
          ))}
          {view.schema.orderChanged ? <li>the column order changed</li> : null}
        </ul>
      ) : null}

      {view.identical ? (
        <p data-testid="history-diff-identical" className="px-2 py-2 text-md text-fg-muted">
          No differences. Rows are matched on their key columns, so the same rows in a different
          order compare equal.
        </p>
      ) : (
        <div className="min-h-0 grow overflow-y-auto" data-testid="history-diff-rows">
          {view.rows.map(row => (
            <DiffRow key={`${row.kind}-${row.rowIndex}-${row.label}`} row={row} />
          ))}
          {view.hiddenRows === 0 ? null : (
            <p
              data-testid="history-diff-capped"
              className="px-2 py-1.5 font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase"
            >
              showing the first <span className="tabular-nums">{view.rows.length}</span> of{' '}
              <span className="tabular-nums">{view.totalChanges.toLocaleString()}</span> changes
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Count({
  testId,
  className,
  value,
  word,
}: {
  readonly testId: string;
  readonly className: string;
  readonly value: number;
  readonly word: string;
}) {
  return (
    <p className={cn('flex items-baseline gap-1', value === 0 ? 'text-fg-subtle' : className)}>
      <span data-testid={testId} className="tabular-nums">
        {value.toLocaleString()}
      </span>
      <span>{word}</span>
    </p>
  );
}

function DiffRow({ row }: { readonly row: DiffRowView }) {
  const style = KIND_STYLE[row.kind];
  const Glyph = KIND_ICON[row.kind];

  return (
    <div
      data-testid="history-diff-row"
      data-kind={row.kind}
      className={cn(
        'flex flex-col gap-0.5 border-b border-l-2 border-b-rule px-2 py-1.5',
        style.rule
      )}
    >
      <p className="flex min-w-0 items-baseline gap-1.5">
        <Glyph className={cn('size-3.5 shrink-0', style.stroke)} aria-hidden />
        <span className="min-w-0 truncate font-mono text-sm text-fg">{row.label}</span>
        <span className={cn('shrink-0 font-mono text-2xs tracking-eyebrow uppercase', style.text)}>
          {style.word}
        </span>
      </p>

      <dl className="flex flex-col">
        {row.cells.map(cell => (
          <div key={cell.column} className="flex min-w-0 items-baseline gap-2">
            <dt className="min-w-0 shrink-0 basis-1/3 truncate font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
              {cell.column}
            </dt>
            <dd className="flex min-w-0 grow items-baseline gap-1 font-mono text-sm">
              {cell.before === null ? null : (
                <span
                  className={cn(
                    'min-w-0 truncate',
                    cell.after === null ? 'text-fg' : 'text-fg-muted line-through'
                  )}
                >
                  {cell.before}
                </span>
              )}
              {cell.before !== null && cell.after !== null ? (
                <ArrowRight className="size-3.5 shrink-0 stroke-fg-subtle" aria-hidden />
              ) : null}
              {cell.after === null ? null : (
                <span className="min-w-0 truncate text-fg">{cell.after}</span>
              )}
            </dd>
          </div>
        ))}
        {row.hiddenCells === 0 ? null : (
          <p className="font-mono text-2xs tracking-eyebrow text-fg-subtle uppercase">
            +<span className="tabular-nums">{row.hiddenCells}</span> more columns
          </p>
        )}
      </dl>
    </div>
  );
}
