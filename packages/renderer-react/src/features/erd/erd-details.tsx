/**
 * The rail that opens beside the diagram when a table is selected: its columns, its relationships,
 * and the two things you can do with it.
 *
 * Ported from the slide-in panel inside `erd.component.ts` (lines 67-153 of its template). Three
 * differences:
 *
 *  - **No slide animation.** The Angular version set `panelInfo` and then flipped an `.open` class in
 *    a `requestAnimationFrame`, with a 250ms `setTimeout` on the way out to clear the content after
 *    the transition — a two-timer dance to animate a panel that is 340px of text. It is rendered or it
 *    is not.
 *  - **The two actions changed.** Angular offered "Table Properties" (a Task 19 surface) and
 *    "SELECT TOP 1000", whose SQL was `SELECT TOP 1000 * FROM [schema].[table]` — T-SQL, emitted
 *    against PostgreSQL and MySQL too, where it is a syntax error. Task 16's `sql-text.ts` is where
 *    per-engine SQL lives now, and the honest actions from a diagram are: open the object's own tab,
 *    and show me where this is in the explorer.
 *  - **`allowsNull === false` was marked with a red `*`.** `--color-danger` for "this column is
 *    required" is a misuse of the danger role, so it is a `NOT NULL` badge in the muted foreground.
 */

import { ExternalLink, Crosshair, X } from 'lucide-react';

import { Button, Icon, cn } from '../../ui';
import { truncateLabel } from './erd-layout';
import type { ErdField, ErdNode } from './erd-model';

export interface ErdDetailsProps {
  readonly node: ErdNode;
  readonly onClose: () => void;
  readonly onOpenObject: (node: ErdNode) => void;
  readonly onReveal: (node: ErdNode) => void;
  /** Jump the selection to a related table. `undefined` when that table is not in the diagram. */
  readonly onNavigate: (nodeId: string) => void;
  /** Which related ids the diagram actually holds — the rest are not clickable. */
  readonly presentNodeIds: ReadonlySet<string>;
}

export function ErdDetails({
  node,
  onClose,
  onOpenObject,
  onReveal,
  onNavigate,
  presentNodeIds,
}: ErdDetailsProps) {
  const relationships = node.fields.filter(field => field.relatedNodeId !== undefined);
  const qualified = node.schemaName === '' ? node.name : `${node.schemaName}.${node.name}`;

  return (
    <aside
      data-testid="erd-details"
      aria-label={`${qualified} details`}
      className="flex w-80 min-w-0 shrink-0 flex-col overflow-y-auto border-l border-rule bg-surface"
    >
      <header className="flex items-start justify-between gap-2 border-b border-rule p-3">
        <div className="min-w-0">
          <h3 className="truncate text-md text-fg">{node.name}</h3>
          <p className="truncate font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
            {qualified}
          </p>
        </div>
        <Button
          data-testid="erd-details-close"
          variant="ghost"
          size="sm"
          iconOnly
          leadingIcon={X}
          aria-label="Close details"
          onClick={onClose}
        />
      </header>

      <div className="flex flex-col gap-1.5 border-b border-rule p-3">
        <Button
          data-testid="erd-details-open-object"
          variant="outline"
          size="sm"
          leadingIcon={ExternalLink}
          className="justify-start"
          onClick={() => onOpenObject(node)}
        >
          Open object tab
        </Button>
        <Button
          data-testid="erd-details-reveal"
          variant="outline"
          size="sm"
          leadingIcon={Crosshair}
          className="justify-start"
          onClick={() => onReveal(node)}
        >
          Reveal in explorer
        </Button>
      </div>

      <section className="border-b border-rule p-3">
        <h4 className="mb-2 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
          Columns ({node.fields.length})
        </h4>
        <ul className="flex flex-col gap-0.5">
          {node.fields.map(field => (
            <li
              key={field.id}
              data-testid="erd-column-row"
              className="flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-sm"
            >
              <KeyBadges field={field} />
              <span className="min-w-0 flex-1 truncate text-fg">{field.name}</span>
              <span className="shrink-0 font-mono text-2xs text-fg-muted">
                {truncateLabel(field.type, 14)}
              </span>
              {!field.allowsNull && (
                <span
                  className="shrink-0 font-mono text-2xs text-fg-subtle"
                  title="This column is NOT NULL"
                >
                  NN
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {relationships.length > 0 && (
        <section className="p-3">
          <h4 className="mb-2 font-mono text-2xs tracking-eyebrow text-fg-muted uppercase">
            Relationships ({relationships.length})
          </h4>
          <ul className="flex flex-col gap-0.5">
            {relationships.map(field => (
              <li key={field.id}>
                <RelationshipRow
                  field={field}
                  present={presentNodeIds.has(field.relatedNodeId ?? '')}
                  onNavigate={onNavigate}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </aside>
  );
}

function KeyBadges({ field }: { readonly field: ErdField }) {
  return (
    <span className="flex w-9 shrink-0 gap-0.5">
      {field.isPrimaryKey && (
        <span
          className="rounded-xs bg-warning/12 px-1 font-mono text-2xs text-warning"
          title="Primary key"
        >
          PK
        </span>
      )}
      {field.relatedNodeId !== undefined && (
        <span
          className="rounded-xs bg-accent/12 px-1 font-mono text-2xs text-accent"
          title={`Foreign key → ${field.relatedNodeName ?? field.relatedNodeId}`}
        >
          FK
        </span>
      )}
    </span>
  );
}

/**
 * One outgoing relationship. A button when the target is in the diagram and plain text when it is
 * not — a focused ERD at depth 1 shows FKs whose parent was never fetched, and a control that looks
 * live and does nothing is worse than a label.
 */
function RelationshipRow({
  field,
  present,
  onNavigate,
}: {
  readonly field: ErdField;
  readonly present: boolean;
  readonly onNavigate: (nodeId: string) => void;
}) {
  const target = field.relatedNodeId ?? '';
  const content = (
    <>
      <span className="min-w-0 truncate text-fg-muted">{field.name}</span>
      <span aria-hidden className="shrink-0 text-fg-subtle">
        →
      </span>
      <span className={cn('min-w-0 truncate', present ? 'text-accent' : 'text-fg-subtle')}>
        {field.relatedNodeName ?? target}
      </span>
    </>
  );

  const shared = 'flex w-full min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-left text-sm';

  if (!present) {
    return (
      <span
        data-testid="erd-relationship-row"
        data-erd-present="false"
        className={shared}
        title="This table is not in the current diagram"
      >
        <Icon icon={Crosshair} size="sm" className="invisible" />
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid="erd-relationship-row"
      data-erd-present="true"
      data-erd-target={target}
      className={cn(
        shared,
        'cursor-pointer hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus'
      )}
      onClick={() => onNavigate(target)}
    >
      <Icon icon={Crosshair} size="sm" className="stroke-fg-subtle" />
      {content}
    </button>
  );
}
