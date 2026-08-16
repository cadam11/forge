/**
 * The whole of a `react-hook-form` form as a value, re-rendering the caller on any change.
 *
 * Lifted out of the connection editor because **every** form dialog in this app needs it and one of
 * them needing it is a lint failure away from being written the wrong way. Tasks 12 and 13 (the
 * backup and restore wizards) are the next two.
 *
 * ── Why not `form.watch()` ──────────────────────────────────────────────────────────────────
 *
 * Because it does not compile. The React Compiler lint rule `react-hooks/incompatible-library`
 * refuses to memoize a component that calls `watch()` — `useForm` returns a function whose identity
 * cannot be memoized safely, so the compiler bails on the whole component — and the package lints
 * with `--max-warnings 0`, which makes that a hard error rather than advice. `useWatch` is a real
 * hook and is compiler-safe.
 *
 * ── Why the subscription and the read are split ─────────────────────────────────────────────
 *
 * `useWatch`'s no-name overload is typed `DeepPartialSkipArrayKey<T>` — "every field possibly
 * absent" — which is false for a form whose `defaultValues` are total and which leaves
 * `shouldUnregister` at its default of `false`: every field is always present. Rather than cast that
 * partial back to the truth, `useWatch` is used only for its re-render and the value comes from
 * `getValues()`, which is typed honestly. By the time the re-render commits, `getValues()` already
 * reflects the change that caused it — both read the same internal store.
 *
 * The precondition is therefore real and worth stating: **pass total `defaultValues`**. A form that
 * omits a field will hand back `undefined` for it under a type that says otherwise.
 */

import { useWatch, type FieldValues, type UseFormReturn } from 'react-hook-form';

export function useFormValues<TValues extends FieldValues>(form: UseFormReturn<TValues>): TValues {
  useWatch({ control: form.control });
  return form.getValues();
}
