/**
 * The three pieces of scaffolding the four settings groups share, and nothing else.
 *
 * Deliberately NOT a `<SettingRow label description control>` slot component. The `ui/` form
 * primitives already own their label, hint and `<label for>` association — that is the whole reason
 * `fillField` collapses to `getByLabel` in the Task 20 e2e contract (`ui/field.tsx`) — and a wrapper
 * that took `label` as a prop would either duplicate that association or replace it with an ARIA
 * patch. So a row here is padding and a hairline; the label belongs to the control inside it.
 *
 * `NumberSetting` is the one genuine component, because a number setting cannot be a plain controlled
 * `<Input>`: see its header.
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { Input } from '../../ui';

/**
 * The pending-draft registry, and why a settings dialog needs one.
 *
 * `NumberSetting` commits on blur or Enter (see its header for why not on every keystroke), and React
 * hears a blur through a listener on the root container rather than on the field. Dismissing the dialog
 * with **Escape** removes the focused field from the tree first, so Chromium's `focusout` — which does
 * fire, on the now-detached input — bubbles into nothing and `onBlur` never runs. Measured in the real
 * app: 18 typed into Font size, Escape, reopen, and the panel showed 14 again with no message. The scrim
 * and the ✕ move focus while the field is still mounted, so their blur arrives and they commit.
 *
 * Rather than depend on that ordering, the dialog sweeps every mounted draft in `onOpenChange(false)`,
 * which runs before the store closes and the fields go away. Each field registers the commit function it
 * would have run on blur; the commit is idempotent (it writes only a value that differs from the stored
 * one), so a field the user never touched contributes nothing and the ✕ path commits exactly once.
 */
type CommitDraft = () => void;

const PendingDrafts = createContext<Set<CommitDraft> | null>(null);

/**
 * The registry, and the sweep that flushes it. Held by the surface that owns dismissal — the registry is
 * one `Set` per dialog, so it cannot outlive it or be shared with another.
 */
export function usePendingDrafts(): {
  readonly registry: Set<CommitDraft>;
  readonly commitPendingDrafts: () => void;
} {
  const [registry] = useState(() => new Set<CommitDraft>());

  const commitPendingDrafts = useCallback(() => {
    // A copy: committing re-seeds the field's own draft, and a set being mutated mid-walk is not a
    // shape to rely on. Bounded by the number of mounted number fields, which is at most a group's worth.
    for (const commit of [...registry]) commit();
  }, [registry]);

  return { registry, commitPendingDrafts };
}

/** Puts a `usePendingDrafts` registry in reach of the `NumberSetting`s below it. */
export function PendingDraftsProvider({
  registry,
  children,
}: {
  readonly registry: Set<CommitDraft>;
  readonly children: ReactNode;
}) {
  return <PendingDrafts.Provider value={registry}>{children}</PendingDrafts.Provider>;
}

/**
 * One settings group. A stack separated by hairlines, which is `surfaces.md`'s second rung —
 * whitespace, then a rule, then a well, then a card. A card per setting is the thing HOUSE-RULES §7
 * calls the last resort, and the Angular panel used one per row (`.setting-item` had its own
 * `background-color` and `border-radius`).
 */
export function SettingsGroup({
  testId,
  children,
}: {
  readonly testId: string;
  readonly children: ReactNode;
}) {
  return (
    <div data-testid={testId} className="flex flex-col divide-y divide-rule">
      {children}
    </div>
  );
}

/** One setting inside a group. The hairline between rows is the group's `divide-y`. */
export function SettingRow({ children }: { readonly children: ReactNode }) {
  return <div className="py-3 first:pt-0 last:pb-0">{children}</div>;
}

export interface NumberSettingProps {
  readonly testId: string;
  readonly label: string;
  readonly hint: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled?: boolean;
  /** Called with a value already clamped into `[min, max]`, and only when it actually changed. */
  readonly onCommit: (value: number) => void;
}

/**
 * A bounded integer setting.
 *
 * **Why this is not `<Input type="number" value={setting} onChange={commit} />`.** Every keystroke in
 * a number field is a candidate value, and most of the intermediate ones are wrong: clearing "13" to
 * type "18" passes through the empty string, and typing "1" first would commit a font size of 1 —
 * which, since these settings are live, resizes every open editor mid-edit and then clamps the user's
 * next keystroke against a value they never chose. So the field holds a draft and commits on blur or
 * Enter, which is also what the Angular panel's `(change)` binding did (`(change)` fires on commit,
 * not on input) — the one thing about those controls that was right.
 *
 * The draft is re-seeded when the stored value changes underneath — Reset to defaults, or a second
 * settings surface — and that is done **during render, not in an effect**. React documents this as the
 * way to adjust state when a prop changes, and the alternative both fail: an effect is a second render
 * pass after a committed frame showing the old number (and `react-hooks/set-state-in-effect` rejects
 * it), while remounting on a `key` of the value would tear the field down on the user's own commit and
 * take the caret with it. Bounded: the branch cannot repeat, because it stores the value it reacted to.
 *
 * Out-of-range and unparseable input is CLAMPED rather than rejected, and the field is rewritten to
 * what was actually stored, so there is no state in which the box shows a number the app is not using.
 */
export function NumberSetting({
  testId,
  label,
  hint,
  value,
  min,
  max,
  disabled = false,
  onCommit,
}: NumberSettingProps) {
  const [draft, setDraft] = useState(() => String(value));
  const [seededFrom, setSeededFrom] = useState(value);

  if (seededFrom !== value) {
    setSeededFrom(value);
    setDraft(String(value));
  }

  const commit = useCallback((): void => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  }, [draft, value, min, max, onCommit]);

  // The dismissal sweep: this field's blur-time commit, reachable by the dialog that is about to unmount
  // it. Re-registered whenever `commit` changes identity — which is every render, since the caller's
  // `onCommit` is a fresh arrow — so the registry never holds a commit that would write a stale draft.
  const registry = useContext(PendingDrafts);
  useEffect(() => {
    if (registry === null) return undefined;
    registry.add(commit);
    return () => {
      registry.delete(commit);
    };
  }, [registry, commit]);

  return (
    <SettingRow>
      <Input
        name={testId}
        data-testid={testId}
        type="number"
        inputMode="numeric"
        label={label}
        hint={hint}
        min={min}
        max={max}
        disabled={disabled}
        value={draft}
        // The width belongs to the CONTROL, not to the field wrapper: `fieldClassName` would narrow the
        // hint with it, and a 288px column wraps a one-line sentence into two for no reason.
        className="max-w-24 tabular-nums"
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') commit();
        }}
      />
    </SettingRow>
  );
}
