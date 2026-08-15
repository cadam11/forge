/**
 * Dev-only. Runs the real startup hydration once and renders what it found.
 *
 * It exists for Task 5's gate, which asks for an end-to-end proof in the dev Electron app rather
 * than only in jsdom: seed the Angular localStorage keys, boot, and read off that the data reached
 * main-process `AppState`; boot again and read off that the migration did not run a second time.
 * `outcome` is the whole proof — `migrated` on the first boot, `already-migrated` on every one
 * after, with the snippet count showing the data is still there.
 *
 * Task 7 replaces this call site with the shell's real startup effect. The hydration itself is not
 * dev-only — only this probe is.
 */

import { useEffect, useState } from 'react';
import { hydrateRendererState, type HydratedRendererState } from '../persistence';

export function PersistenceProbe() {
  const [state, setState] = useState<HydratedRendererState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Not guarded against a StrictMode double-run on purpose: hydration is idempotent, and the
    // migration collapses concurrent callers inside one serialized read-modify-write. If a second
    // run could double-migrate, this probe would be the place it showed up.
    let cancelled = false;
    hydrateRendererState()
      .then(result => {
        if (!cancelled) setState(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows: readonly [string, string][] = state
    ? [
        ['migration outcome', state.migration.outcome],
        ['keys present', state.migration.keysPresent.join(', ') || 'none'],
        ['keys rejected', state.migration.keysRejected.join(', ') || 'none'],
        ['theme', state.settings.theme],
        ['editor.fontSize', String(state.settings.editor.fontSize)],
        ['welcomeDismissed', String(state.welcomeDismissed)],
        ['snippets', String(state.snippets.length)],
        ['completedTours', state.completedTours.join(', ') || 'none'],
        ['⌃E confirmed', String(state.confirmedCtrlEExecute)],
        ['placeholders', String(Object.keys(state.flywayPlaceholderValues).length)],
      ]
    : [['status', error ?? 'hydrating…']];

  return (
    <dl data-testid="persistence-probe" className="font-mono text-xs text-fg">
      {rows.map(([label, value], index) => (
        <div
          key={label}
          className={`flex gap-2 py-1.5${index === rows.length - 1 ? '' : ' border-b border-rule'}`}
        >
          <dt className="w-40 text-fg-subtle">{label}</dt>
          <dd data-testid={`persistence-probe-${label.replace(/[^a-z]+/gi, '-')}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
