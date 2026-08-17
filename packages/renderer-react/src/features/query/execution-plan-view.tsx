/**
 * The execution plan, drawn.
 *
 * Replaces the template and the 430-line stylesheet of
 * `shared/components/execution-plan/execution-plan.component.ts`. The parsing is
 * `execution-plan.ts`; this file is one flat list of rows and knows nothing about any engine.
 *
 * ── Flat rows with an indent, not nested elements ────────────────────────────────────────────
 *
 * The Angular version recursed through an `<ng-template>` per node with `[style.margin-left.px]="depth *
 * 28"` on each, so a nine-deep MSSQL plan (which is an ordinary one — see the fixture) nested nine
 * elements and pushed the deepest card 252px to the right, past the edge of any pane narrower than
 * ~600px, where it clipped. `flattenPlan` gives depth as data, the indent is a spacing-ladder step
 * capped at six levels, and every row is a sibling — so the pane scrolls in one direction only.
 *
 * ── What each colour means, and the three that are used ─────────────────────────────────────
 *
 * HOUSE-RULES §5 caps decoration hard, so severity is a **left rule** and a **bar**, never a filled
 * card: `danger` for an operator that is more than half the plan's cost, `warning` for a fifth of it,
 * `success` for the rest, `border-rule` for a node with no cost of its own. The Angular version also
 * tinted the card's background with `color-mix(in srgb, var(--status-error) 5%, …)` and gave MySQL access
 * types four more badge colours, two of which were blue — the palette this renderer closed.
 */

import { memo } from 'react';
import { AlertTriangle, GitMerge, Search, Table2, Timer } from 'lucide-react';

import { Icon, Tooltip, cn } from '../../ui';
import { flattenPlan, planSeverity, type PlanNode, type PlanSummary } from './execution-plan';

export interface ExecutionPlanViewProps {
  readonly root: PlanNode;
  readonly summary: PlanSummary;
  /** `actual` means the statement was run to get this. Rendered, because it is a different claim. */
  readonly kind: 'estimated' | 'actual';
}

/** The left rule and the bar fill, per severity. Layer 2 tokens only. */
const SEVERITY_RULE: Record<ReturnType<typeof planSeverity>, string> = {
  expensive: 'border-l-danger',
  moderate: 'border-l-warning',
  cheap: 'border-l-success',
  neutral: 'border-l-rule',
};

const SEVERITY_BAR: Record<ReturnType<typeof planSeverity>, string> = {
  expensive: 'bg-danger',
  moderate: 'bg-warning',
  cheap: 'bg-success',
  neutral: 'bg-rule',
};

/**
 * Indent per depth, in `--spacing` rungs, capped at 6.
 *
 * The cap is the finding: an MSSQL plan is routinely nine deep and an uncapped indent makes the deepest
 * operator unreadable in a docked pane. Past level 6 the depth is carried by the row's own depth marker
 * instead of by more whitespace.
 */
const MAX_INDENT_STEPS = 6;

/** MySQL's `access_type`, graded. Two tokens, because the app has no `info` colour by design. */
function accessTone(accessType: string): string {
  if (accessType === 'ALL') return 'text-danger';
  if (accessType === 'range' || accessType === 'index') return 'text-warning';
  return 'text-fg-muted';
}

/** One glyph per family of operator. Lucide, matched to its own viewBox size per `icons.md`. */
function glyphFor(node: PlanNode) {
  const type = node.type.toLowerCase();
  if (type.includes('seq scan') || type.includes('full') || node.accessType === 'ALL') {
    return AlertTriangle;
  }
  if (type.includes('sort') || type.includes('filesort')) return Timer;
  if (
    type.includes('join') ||
    type.includes('hash') ||
    type.includes('merge') ||
    type.includes('loop')
  ) {
    return GitMerge;
  }
  if (type.includes('seek') || type.includes('index') || type.includes('scan')) return Search;
  return Table2;
}

function formatCost(value: number): string {
  // Costs span six orders of magnitude between engines (MSSQL's are fractions, PostgreSQL's are
  // thousands), so the precision follows the magnitude rather than being fixed at two places.
  if (value >= 100) return value.toFixed(0);
  if (value >= 1) return value.toFixed(2);
  return value.toPrecision(3);
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function Stat({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="font-mono text-2xs tracking-eyebrow uppercase text-fg-subtle">{label}</span>
      <span className="tabular-nums text-xs text-fg">{value}</span>
    </span>
  );
}

function PlanRow({ node, depth }: { readonly node: PlanNode; readonly depth: number }) {
  const severity = planSeverity(node);
  const steps = Math.min(depth, MAX_INDENT_STEPS);

  return (
    <li
      data-testid="plan-node"
      data-depth={depth}
      data-severity={severity}
      // The indent is padding on the row, not a margin on a nested element: `general.md` prefers
      // `gap-*`/padding to margins, and a flat list cannot accumulate them.
      style={{ paddingInlineStart: `calc(var(--spacing) * ${steps * 4})` }}
    >
      <div
        className={cn(
          'flex flex-col gap-1 border-l-2 bg-surface px-3 py-2',
          SEVERITY_RULE[severity]
        )}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Icon icon={glyphFor(node)} size="sm" className="stroke-fg-muted" />
          <span data-testid="plan-node-type" className="min-w-0 truncate text-base text-fg">
            {node.type}
          </span>
          {node.accessType === undefined ? null : (
            <span
              data-testid="plan-node-access"
              className={cn(
                'font-mono text-2xs tracking-eyebrow uppercase',
                accessTone(node.accessType)
              )}
            >
              {node.accessType}
            </span>
          )}
          {node.object === undefined ? null : (
            <span
              data-testid="plan-node-object"
              className="min-w-0 truncate font-mono text-xs text-fg-muted"
            >
              {node.object}
            </span>
          )}
          {depth > MAX_INDENT_STEPS ? (
            // Past the indent cap the depth still has to be readable, so it is stated.
            <span className="font-mono text-2xs tracking-eyebrow uppercase text-fg-subtle">
              depth {depth}
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {node.cost === undefined || node.cost <= 0 ? null : (
            <Stat
              label="Cost"
              value={
                node.startupCost === undefined
                  ? formatCost(node.cost)
                  : `${formatCost(node.startupCost)}..${formatCost(node.cost)}`
              }
            />
          )}
          {node.rows === undefined ? null : (
            <Stat label="Est. rows" value={formatCount(node.rows)} />
          )}
          {node.actualRows === undefined ? null : (
            <Stat label="Rows" value={formatCount(node.actualRows)} />
          )}
          {node.executions === undefined || node.executions <= 1 ? null : (
            <Stat label="Runs" value={formatCount(node.executions)} />
          )}
          {node.actualTime === undefined ? null : (
            <Stat label="Time" value={`${node.actualTime.toFixed(2)}ms`} />
          )}
          {node.costPercent <= 0 ? null : (
            <span className="flex min-w-24 items-center gap-1.5" data-testid="plan-node-cost-bar">
              <span
                aria-hidden
                className="h-1 w-16 overflow-hidden rounded-full bg-chrome"
                // A width, so it has to be a value — the custom-property route `general.md` prefers.
                style={{ '--plan-share': `${node.costPercent.toFixed(1)}%` } as React.CSSProperties}
              >
                <span className={cn('block h-full w-(--plan-share)', SEVERITY_BAR[severity])} />
              </span>
              <span className="tabular-nums text-2xs text-fg-subtle">
                {node.costPercent.toFixed(1)}%
              </span>
            </span>
          )}
        </div>

        {node.details === undefined ? null : (
          <p
            data-testid="plan-node-details"
            className="break-words font-mono text-xs text-fg-muted text-pretty"
          >
            {node.details}
          </p>
        )}
        {node.extra.map(note => (
          <p key={note} className="font-mono text-xs text-fg-subtle">
            {note}
          </p>
        ))}
      </div>
    </li>
  );
}

export const ExecutionPlanView = memo(function ExecutionPlanView({
  root,
  summary,
  kind,
}: ExecutionPlanViewProps) {
  const rows = flattenPlan(root);

  return (
    <div className="flex min-h-0 grow flex-col overflow-auto" data-testid="execution-plan">
      <div className="flex flex-wrap items-center gap-3 border-b border-rule bg-chrome px-3 py-1.5">
        {/* The claim first, because "estimated" and "actual" are not the same thing and the whole
            pane means something different depending on which it is. */}
        <Tooltip
          content={
            kind === 'actual'
              ? 'SQL Server reports a plan only for a statement it has run, so these are real row counts.'
              : 'The planner’s estimate. The statement was not run.'
          }
        >
          <span
            data-testid="plan-kind"
            className="font-mono text-2xs tracking-eyebrow uppercase text-fg-muted"
          >
            {kind === 'actual' ? 'Actual plan' : 'Estimated plan'}
          </span>
        </Tooltip>
        {summary.totalCost > 0 ? (
          <Stat label="Total cost" value={formatCost(summary.totalCost)} />
        ) : null}
        {summary.planningTime === undefined ? null : (
          <Stat label="Planning" value={`${summary.planningTime.toFixed(2)}ms`} />
        )}
        {summary.executionTime === undefined ? null : (
          <Stat label="Execution" value={`${summary.executionTime.toFixed(2)}ms`} />
        )}
      </div>

      {summary.warnings.length === 0 ? null : (
        <ul data-testid="plan-warnings" className="flex flex-col gap-1 px-3 py-2">
          {summary.warnings.map(warning => (
            // Amber: a plan warning is caution, not failure — nothing is broken and nothing was
            // destroyed. HOUSE-RULES §5's amber case exactly.
            <li
              key={warning}
              className="flex items-start gap-2 border-l-2 border-warning bg-surface px-2 py-1 text-sm text-fg"
            >
              <Icon icon={AlertTriangle} size="sm" className="mt-0.5 stroke-warning" />
              <span className="text-pretty">{warning}</span>
            </li>
          ))}
        </ul>
      )}

      <ul className="flex flex-col gap-0.5 p-3">
        {rows.map((row, index) => (
          // The index is the key on purpose: a plan has no ids, two sibling operators can be identical
          // in every field, and the list is rebuilt wholesale when a plan is replaced — so position IS
          // identity here.
          <PlanRow key={index} node={row.node} depth={row.depth} />
        ))}
      </ul>
    </div>
  );
});
