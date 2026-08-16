/**
 * Advisory banner for copy/paste artifacts in a secret field — leading/trailing whitespace, an
 * accidental line break, smart quotes, invisible Unicode spaces, dash look-alikes.
 *
 * Ported from `shared/components/password-hygiene-warning/password-hygiene-warning.component.ts`.
 * Non-blocking by design: the value is never mutated or rejected, because a password can
 * legitimately contain any of these characters. The banner just surfaces what
 * `describePasswordHygiene` sees so the user can decide.
 *
 * Two properties carried over deliberately:
 *
 *  - **`'non-ascii'` is omitted.** A typed international password (`passwörd`) must not be branded a
 *    paste artifact. The post-login-failure diagnostic in the main process keeps that bucket, which
 *    is why the omission lives at this call site rather than in the analyzer.
 *  - **The messages never echo the password.** That is the shared analyzer's contract
 *    (`packages/shared/src/validators/password-hygiene.ts` header), and this component adds no text
 *    derived from the value — not even its length.
 *
 * Amber, per HOUSE-RULES §5: this is non-destructive caution, and password hygiene is the example
 * that rule names.
 */

import { TriangleAlert } from 'lucide-react';
import { describePasswordHygiene } from '@joinery/shared';

import { Icon, cn } from '../../ui';

export interface PasswordHygieneWarningProps {
  /** The secret to analyze. Empty or clean values render nothing at all. */
  readonly value: string;
  readonly className?: string;
  readonly 'data-testid'?: string;
}

export function PasswordHygieneWarning({
  value,
  className,
  'data-testid': testId = 'password-hygiene-warning',
}: PasswordHygieneWarningProps) {
  const warnings = describePasswordHygiene(value, { omit: ['non-ascii'] });
  if (warnings.length === 0) return null;

  return (
    <div
      // `role="status"` rather than `alert`: this is advisory and must not interrupt a screen-reader
      // user mid-field.
      role="status"
      data-testid={testId}
      className={cn(
        // A well with a caution rule down its edge, per `surfaces.md`'s order of preference —
        // `bg-surface` is a step *under* the dialog's `bg-elevated` in both themes, so no new
        // wash token is needed to make it read as inset.
        'flex gap-2 rounded-sm border-l-2 border-warning bg-surface p-2 text-sm text-fg',
        className
      )}
    >
      <Icon icon={TriangleAlert} size="sm" className="mt-px stroke-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-fg">This password may contain copy/paste artifacts.</p>
        <ul className="flex list-disc flex-col gap-1 pl-4 text-fg-muted">
          {warnings.map(warning => (
            <li key={warning} className="text-pretty">
              {warning}
            </li>
          ))}
        </ul>
        <p className="text-fg-muted text-pretty">
          Special characters are fine — but invisible or look-alike characters cause “Login failed”.
          If you didn’t intend these, retype the password instead of pasting.
        </p>
      </div>
    </div>
  );
}
