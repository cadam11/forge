/**
 * The connection dialogs. `ConnectionDialogs` is the only export the shell needs — it is the command
 * consumer and it owns which of the two dialogs is on screen. The rest are exported for the specs
 * and for later tasks that open the editor directly (Task 19's Docker panel pre-fills a server and
 * port).
 */

export { ConnectionDialogs } from './connection-dialogs';
export { ConnectionEditor, type ConnectionEditorProps } from './connection-editor';
export { ConnectionManager, type ConnectionManagerProps } from './connection-manager';
export {
  PasswordHygieneWarning,
  type PasswordHygieneWarningProps,
} from './password-hygiene-warning';
export { TestResultPanel, type TestResultPanelProps } from './test-result-panel';
