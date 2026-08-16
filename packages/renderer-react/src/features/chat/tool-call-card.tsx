/**
 * One tool call inside an assistant message: the confirmation a dangerous tool waits on, and the
 * collapsible record of one that has run.
 *
 * ── Two things the Angular version got wrong, and how ─────────────────────────────────────
 *
 * 1. **The confirmation did not say what the tool does.** It rendered `Execute run_query?` plus the
 *    arguments, and nothing else — the panel store fetched the tool catalogue at startup
 *    (`chat.state.ts`) and then never read it, so `ToolDefinition.description` reached no user. A
 *    confirmation whose whole job is informed consent has to state what it is asking for, so the
 *    description is here and `createChatTabStore` now loads the catalogue too (see `state/chat.ts`).
 * 2. **A successful tool wore chartreuse.** HOUSE-RULES §5 caps chartreuse at two visible at once
 *    and reserves it for verification; a transcript with ten successful tool calls in it had ten
 *    green ticks. Success is the expected case and reads as muted here; only a FAILURE takes colour.
 *
 * ── The one filled affordance ──────────────────────────────────────────────────────────────
 *
 * HOUSE-RULES §5 allows at most one filled oxide affordance per visible surface. The composer's Send
 * is the surface's filled affordance at rest — but a pending confirmation only exists while the
 * stream is still open, and the composer shows **Stop** (outline) then, never Send. So "Run it" is
 * the one filled control on screen exactly when it is on screen, and the two can never compete.
 *
 * Expansion is LOCAL state, not a `Set` in the surface (`expandedTools` in Angular). A shared set
 * changes identity on every toggle, which re-renders every message in the transcript to open one
 * card — the R3 memo boundary (`chat-message.tsx`) would have been undone by its own sibling.
 */

import { memo, useState } from 'react';
import { Check, ChevronRight, CircleX, Loader, TriangleAlert, Zap } from 'lucide-react';
import type { ToolCallResult, ToolDefinition } from '@joinery/shared';

import { Button, Icon, cn } from '../../ui';
import { formatToolArgs, formatToolJson, readTableResult, toolCellText } from './tool-result';

export interface ToolCallCardProps {
  readonly toolCall: ToolCallResult;
  /** The catalogue entry, when the store loaded one. Supplies the description a confirmation needs. */
  readonly definition?: ToolDefinition;
  readonly onConfirm: (toolCallId: string, confirmed: boolean) => void;
}

/** The table a `run_query`-shaped result carries. `tables.md`: row rules only, no outer border. */
function ResultTable({ result }: { readonly result: unknown }) {
  const table = readTableResult(result);
  if (table === null) {
    const { text, cut } = formatToolJson(result);
    return (
      <>
        <pre
          data-testid="chat-tool-json"
          className="overflow-x-auto font-mono text-sm text-fg-muted"
        >
          {text}
        </pre>
        {cut ? <p className="text-sm text-fg-muted">Showing the first 4,000 characters.</p> : null}
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="max-h-64 min-w-0 overflow-auto">
        <table data-testid="chat-tool-table" className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-rule">
              {table.columns.map(column => (
                <th
                  key={column}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1 font-medium text-fg-muted"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {table.rows.map((row, index) => (
              // The index is the key because a tool result has no identity column to trust — the
              // rows are read-only and never reordered, so position IS their identity here.
              <tr key={index} data-testid="chat-tool-row">
                {table.columns.map(column => (
                  <td key={column} className="px-2 py-1 align-top font-mono text-fg">
                    {toolCellText(row[column])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.truncated ? (
        <p data-testid="chat-tool-truncated" className="text-sm text-fg-muted tabular-nums">
          Showing the first {table.rows.length} of {table.totalRows} rows.
        </p>
      ) : null}
    </div>
  );
}

/** The confirmation. Renders the description, the arguments, and two ways out. */
function ConfirmCard({ toolCall, definition, onConfirm }: ToolCallCardProps) {
  return (
    <div
      data-testid="chat-tool-confirm"
      className="flex min-w-0 flex-col gap-2 rounded-sm border border-rule-strong border-l-2 border-l-warning bg-surface p-2"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-base text-fg">
        <Icon icon={TriangleAlert} size="sm" className="shrink-0 stroke-warning" />
        <span>
          Run <span className="font-mono">{toolCall.toolName}</span>?
        </span>
      </p>
      {definition?.description === undefined ? null : (
        <p data-testid="chat-tool-description" className="text-sm text-fg-muted text-pretty">
          {definition.description}
        </p>
      )}
      <pre
        data-testid="chat-tool-args"
        className="max-h-40 min-w-0 overflow-auto rounded-xs bg-canvas p-2 font-mono text-sm text-fg"
      >
        {formatToolArgs(toolCall.args)}
      </pre>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          data-testid="chat-tool-approve"
          onClick={() => onConfirm(toolCall.id, true)}
        >
          Run it
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="chat-tool-decline"
          onClick={() => onConfirm(toolCall.id, false)}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Ran, failed, or still running — the glyph and the colour say which. */
function StatusGlyph({ toolCall }: { readonly toolCall: ToolCallResult }) {
  if (toolCall.error !== undefined) {
    return (
      <Icon
        icon={CircleX}
        size="sm"
        label="Failed"
        data-testid="chat-tool-status-error"
        className="shrink-0 stroke-danger"
      />
    );
  }
  if (toolCall.success) {
    // Muted, not chartreuse. See the header.
    return (
      <Icon
        icon={Check}
        size="sm"
        label="Done"
        data-testid="chat-tool-status-done"
        className="shrink-0 stroke-fg-muted"
      />
    );
  }
  return (
    <Icon
      icon={Loader}
      size="sm"
      label="Running"
      data-testid="chat-tool-status-running"
      className="shrink-0 animate-spin stroke-fg-muted"
    />
  );
}

export const ToolCallCard = memo(function ToolCallCard(props: ToolCallCardProps) {
  const { toolCall } = props;
  const [expanded, setExpanded] = useState(false);

  if (toolCall.pendingConfirmation === true) {
    return <ConfirmCard {...props} />;
  }

  const hasBody = toolCall.error !== undefined || toolCall.result !== undefined;

  return (
    <div data-testid="chat-tool-card" className="min-w-0 rounded-sm border border-rule bg-surface">
      <button
        type="button"
        data-testid="chat-tool-toggle"
        aria-expanded={expanded}
        disabled={!hasBody}
        onClick={() => setExpanded(open => !open)}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 rounded-sm px-2 py-1 text-left',
          'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus',
          hasBody ? 'hover:bg-hover' : 'cursor-default'
        )}
      >
        <Icon icon={Zap} size="sm" className="shrink-0 stroke-fg-muted" />
        <span className="min-w-0 truncate font-mono text-sm text-fg">{toolCall.toolName}</span>
        {toolCall.durationMs === undefined ? null : (
          <span className="shrink-0 font-mono text-2xs tabular-nums text-fg-subtle">
            {toolCall.durationMs}ms
          </span>
        )}
        <span className="grow" />
        <StatusGlyph toolCall={toolCall} />
        {hasBody ? (
          <Icon
            icon={ChevronRight}
            size="sm"
            className={cn('shrink-0 stroke-fg-muted', expanded && 'rotate-90')}
          />
        ) : null}
      </button>

      {expanded && hasBody ? (
        <div
          data-testid="chat-tool-body"
          className="flex min-w-0 flex-col gap-1 border-t border-rule p-2"
        >
          {toolCall.error === undefined ? (
            <ResultTable result={toolCall.result} />
          ) : (
            <p
              data-testid="chat-tool-error"
              role="alert"
              className="text-sm text-danger text-pretty"
            >
              {toolCall.error}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
});
