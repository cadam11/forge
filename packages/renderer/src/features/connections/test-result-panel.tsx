/**
 * The inline failure panel for a connection **Test**: the error headline plus every guidance line
 * the main process returned.
 *
 * Ported from `shared/components/test-result-panel/test-result-panel.component.ts`. Renders nothing
 * for `null` or for a success, so a host can bind its result state directly — successes toast (the
 * connection store does it), failures render here, and nothing announces the same error twice.
 *
 * The guidance list is height-capped and scrolls, so a long list can never push the dialog's action
 * row off-screen. That cap is the reason this is a component rather than three lines inline: the
 * `AUTH_FAILED` category returns five guidance lines plus the password-hygiene diagnostic, which is
 * what `test-connection-feedback.spec.ts` asserts against a real MSSQL container.
 *
 * The guidance strings come from `packages/main`'s error categorisation and may name the password's
 * *length* but never its contents (`packages/shared/src/validators/password-hygiene.ts` header).
 * This component adds no text of its own.
 */

import { CircleAlert } from 'lucide-react';
import type { TestConnectionResult } from '@joinery/shared';

import { Icon, cn } from '../../ui';

export interface TestResultPanelProps {
  readonly result: TestConnectionResult | null;
  readonly className?: string;
}

export function TestResultPanel({ result, className }: TestResultPanelProps) {
  if (result === null || result.success) return null;

  return (
    <div
      // `role="alert"` here, unlike the hygiene banner's `status`: the user pressed Test and is
      // waiting for exactly this answer.
      role="alert"
      data-testid="connection-test-result"
      className={cn(
        'flex max-h-48 gap-2 overflow-y-auto rounded-sm border-l-2 border-danger bg-surface p-2 text-sm',
        className
      )}
    >
      <Icon icon={CircleAlert} size="sm" className="mt-px stroke-danger" />
      <div className="flex min-w-0 flex-col gap-1">
        <p data-testid="connection-test-error" className="text-fg text-pretty">
          {result.error === undefined || result.error === '' ? 'Connection failed' : result.error}
        </p>
        {result.guidance === undefined || result.guidance.length === 0 ? null : (
          <ul
            data-testid="connection-test-guidance"
            className="flex list-disc flex-col gap-1 pl-4 text-fg-muted"
          >
            {result.guidance.map(line => (
              <li key={line} className="text-pretty">
                {line}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
