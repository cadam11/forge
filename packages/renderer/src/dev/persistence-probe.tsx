/**
 * Dev-only. Runs the real startup hydration and renders what it found.
 *
 * It exists for Task 5's gate, which asks for an end-to-end proof in the dev Electron app rather
 * than only in jsdom: seed the Angular localStorage keys, boot, and read off that the data reached
 * main-process `AppState`; boot again and read off that the migration did not run a second time.
 *
 * The `hydrations` row is the whole proof, and it reads `migrated → already-migrated` on the first
 * boot for a reason worth knowing: StrictMode invokes the effect twice, so two `hydrateRendererState()`
 * calls race, and they collapse into ONE migration inside the writer's critical section. Every later
 * boot reads `already-migrated → already-migrated`. So one row shows both the cross-boot marker and
 * the within-boot race, which is exactly what "idempotent" has to mean here.
 *
 * Task 7 replaces this call site with the shell's real startup effect. The hydration itself is not
 * dev-only — only this probe is.
 */

import { useEffect, useState } from 'react';
import { hydrateRendererState, type HydratedRendererState } from '../persistence';

export function PersistenceProbe() {
  const [runs, setRuns] = useState<readonly HydratedRendererState[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Deliberately not guarded against StrictMode's double invocation: hydration is idempotent,
    // and every run is recorded so the collapse is visible rather than hidden. If a second run
    // could double-migrate, this probe is where it would show up.
    hydrateRendererState()
      .then(result => setRuns(previous => [...previous, result]))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  const latest = runs.at(-1);
  // The keys are read only by the run that actually migrated; a later run short-circuits on the
  // marker before touching localStorage, and would report "none" misleadingly.
  const reading = runs.find(run => run.migration.keysPresent.length > 0)?.migration;

  const rows: readonly [string, string][] = latest
    ? [
        ['hydrations', runs.map(run => run.migration.outcome).join(' → ')],
        ['keys migrated', reading?.keysPresent.join(', ') || 'none'],
        ['keys rejected', reading?.keysRejected.join(', ') || 'none'],
        ['keys partial', reading?.keysPartial.join(', ') || 'none'],
        ['keys removed', reading?.keysCleared.join(', ') || 'none'],
        ['theme', latest.settings.theme],
        ['editor.fontSize', String(latest.settings.editor.fontSize)],
        ['grid.copyFormat', latest.settings.grid.copyFormat],
        ['welcomeDismissed', String(latest.welcomeDismissed)],
        ['snippets', String(latest.snippets.length)],
        ['completedTours', latest.completedTours.join(', ') || 'none'],
        ['ctrl-E confirmed', String(latest.confirmedCtrlEExecute)],
        ['placeholders', String(Object.keys(latest.flywayPlaceholderValues).length)],
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
