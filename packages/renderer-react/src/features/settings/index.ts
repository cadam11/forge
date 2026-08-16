/**
 * The settings feature's public surface. Import from `../settings`, never from a file inside it — the
 * same discoverability rule `src/ui/index.ts` and the other feature barrels state.
 *
 * `SettingsDialog` is what the shell mounts, and the only thing the app reaches: the panel is opened
 * through the `open-settings` command, never by a prop.
 *
 * The rest is exported for the spec and for the status bar, which shares `THEME_CHOICES` so the two
 * theme controls in the app cannot end up calling the same theme by two different names.
 */

export { SettingsDialog } from './settings-dialog';
export {
  AppearanceGroup,
  EditorGroup,
  GridGroup,
  QueryGroup,
  ResetToDefaults,
  THEME_CHOICES,
} from './settings-groups';
export {
  NumberSetting,
  SettingRow,
  SettingsGroup,
  type NumberSettingProps,
} from './setting-controls';
