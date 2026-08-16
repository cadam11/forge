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

import { useState, type ReactNode } from 'react';

import { Input } from '../../ui';

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

  const commit = (): void => {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

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
