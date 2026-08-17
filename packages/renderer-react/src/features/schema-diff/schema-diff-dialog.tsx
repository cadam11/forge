/**
 * Pick two databases and a set of object families; get a comparison query in a new tab.
 *
 * Replaces `shared/components/schema-diff-dialog/schema-diff-dialog.component.ts` (391). The SQL is
 * `diff-query.ts`; this file is the picker and the honesty.
 *
 * ── What the copy had to change ─────────────────────────────────────────────────────────────
 *
 * The Angular dialog was titled "Schema Diff" with a `compare_arrows` icon and a description saying it
 * "generates a T-SQL comparison query in a new tab" — the description was accurate and the title was
 * not, and users read titles. It also hardcoded T-SQL in a dialog that opened on any engine. So: the
 * title says what happens ("Compare schemas"), the primary action says what it produces ("Generate
 * comparison query"), and an engine that cannot be asked at all is refused BEFORE the picker rather
 * than after it.
 */

import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { DatabaseEngine } from '@joinery/shared';

import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Icon,
  Select,
  SelectItem,
} from '../../ui';
import {
  ALL_SECTIONS,
  POSTGRES_REFUSAL,
  SECTION_LABELS,
  buildDiffQuery,
  canCompareDatabases,
  type DiffSections,
} from './diff-query';

export interface SchemaDiffDialogProps {
  /** The server's name, for the copy — the comparison is always within one server. */
  readonly serverName: string;
  readonly engine: DatabaseEngine;
  /** Every database on the server, in the order the picker shows them. */
  readonly databases: readonly string[];
  /** Pre-selected source: the focused database, or the sidebar node that asked. */
  readonly initialSource: string | null;
  /** Hand the generated SQL to a new query tab. The host owns the tab. */
  readonly onGenerate: (input: { readonly source: string; readonly sql: string }) => void;
  readonly onDismiss: () => void;
}

export function SchemaDiffDialog({
  serverName,
  engine,
  databases,
  initialSource,
  onGenerate,
  onDismiss,
}: SchemaDiffDialogProps) {
  const [source, setSource] = useState(initialSource ?? '');
  const [target, setTarget] = useState('');
  const [sections, setSections] = useState<DiffSections>(ALL_SECTIONS);

  const supported = canCompareDatabases(engine);
  const built = supported ? buildDiffQuery({ engine, source, target, sections }) : null;
  // Shown next to the action rather than raised as a toast: nothing has been submitted, and the reason
  // is about the form's current state. A disabled button with no explanation is the J-44 defect the
  // audit found in four places.
  const problem = built !== null && !built.ok ? built.reason : null;

  return (
    <Dialog open onOpenChange={next => (next ? undefined : onDismiss())}>
      <DialogContent size="md" data-testid="schema-diff-dialog">
        <DialogHeader>
          <DialogTitle>Compare schemas</DialogTitle>
          <DialogDescription>
            {supported
              ? `Writes a query into a new tab that reports what one database on ${serverName} has and the other does not. Joinery does not compare them itself — the server does, when you run it.`
              : `Comparing two databases on ${serverName} is not something this engine can be asked to do.`}
          </DialogDescription>
        </DialogHeader>

        {!supported ? (
          <DialogBody>
            {/* Prose in a left rule, not a centred `EmptyState`: this is a paragraph explaining a
                database engine's limits, and an empty state's 256px measure turns it into eight ragged
                lines. Amber because nothing is broken and nothing was lost — HOUSE-RULES §5's caution
                case — and a rule rather than a filled banner, per PROPOSAL §2.1. */}
            <div
              data-testid="schema-diff-unsupported"
              className="flex flex-col gap-1 border-l-2 border-warning bg-surface px-3 py-2"
            >
              <p className="text-md text-fg">Not available on PostgreSQL</p>
              <p className="text-md text-fg-muted text-pretty">{POSTGRES_REFUSAL}</p>
            </div>
          </DialogBody>
        ) : (
          <DialogBody className="flex flex-col gap-4">
            <div className="flex items-end gap-2">
              <Select
                name="schema-diff-source"
                label="Source"
                data-testid="schema-diff-source"
                fieldClassName="grow"
                value={source}
                onValueChange={setSource}
              >
                {databases.map(database => (
                  <SelectItem key={database} value={database}>
                    {database}
                  </SelectItem>
                ))}
              </Select>
              <Icon icon={ArrowRight} size="sm" className="mb-2 stroke-fg-subtle" />
              <Select
                name="schema-diff-target"
                label="Target"
                data-testid="schema-diff-target"
                fieldClassName="grow"
                value={target}
                onValueChange={setTarget}
              >
                {databases.map(database => (
                  <SelectItem key={database} value={database}>
                    {database}
                  </SelectItem>
                ))}
              </Select>
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="font-mono text-2xs tracking-eyebrow uppercase text-fg-subtle">
                Compare
              </legend>
              {SECTION_LABELS.map(section => (
                <Checkbox
                  key={section.key}
                  name={`schema-diff-${section.key}`}
                  label={section.label}
                  data-testid={`schema-diff-${section.key}`}
                  checked={sections[section.key]}
                  onChange={event =>
                    setSections(current => ({ ...current, [section.key]: event.target.checked }))
                  }
                />
              ))}
            </fieldset>
          </DialogBody>
        )}

        <DialogActions>
          {problem === null ? null : (
            // The reason sits in the action row, beside the button it explains.
            <p
              data-testid="schema-diff-problem"
              className="mr-auto text-sm text-fg-muted text-pretty"
            >
              {problem}
            </p>
          )}
          <DialogClose asChild>
            <Button variant="outline" data-testid="schema-diff-cancel">
              Cancel
            </Button>
          </DialogClose>
          {!supported ? null : (
            /* The one filled oxide affordance in this dialog — HOUSE-RULES §5. */
            <Button
              variant="primary"
              data-testid="schema-diff-generate"
              disabled={built === null || !built.ok}
              onClick={() => {
                if (built === null || !built.ok) return;
                onGenerate({ source, sql: built.sql });
              }}
            >
              Generate comparison query
            </Button>
          )}
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}
