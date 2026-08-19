/**
 * The editor seam's public surface. `src/editor/` is the only directory that may import Monaco
 * (`eslint.config.js`), so everything the rest of the app needs from it is re-exported here.
 *
 * `monaco.ts` itself is deliberately NOT re-exported: a consumer holding the Monaco namespace could
 * create an editor of its own, and then there would be two owners of the theme, the providers and the
 * worker environment.
 */

export { SqlEditor, type SqlEditorHandle, type SqlEditorProps } from './sql-editor';
export { sqlIntellisense } from './intellisense';
export type { IntellisenseTarget } from './sql-intellisense';
export {
  formatSql,
  formatterLanguageFor,
  monacoLanguageFor,
  type SqlLanguageId,
} from './sql-dialect';
export { statementAtCursor, textToExecute, type ExecutionSource } from './statements';
