/**
 * Shared form-dialog scaffolding. Import from `../forms`, never from a file inside it — the same
 * discoverability rule `src/ui/index.ts` states, for the same reason.
 *
 * This is the layer between `src/ui/` (element primitives, no form library) and a feature's own
 * dialog. See `form-dialog.tsx`'s header for why these four do not live in `ui/`.
 */

export {
  FormAnswerBand,
  FormHint,
  FormNote,
  FormSection,
  type FormAnswerBandProps,
  type FormSectionProps,
} from './form-dialog';
export { useFormValues } from './use-form-values';
