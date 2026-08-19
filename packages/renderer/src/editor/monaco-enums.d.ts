/**
 * Types for the one Monaco module `sql-intellisense.spec.ts` imports at RUNTIME.
 *
 * `monaco-editor/editor/common/standalone/standaloneEnums.js` is the generated leaf module that holds
 * every `monaco.languages.*` enum, and `standaloneLanguages.js:595` re-exports it — so it is the same
 * object the editor uses at runtime. It has **zero imports of its own**: no DOM, no workers, nothing
 * jsdom has to fake, which is what makes it safe to import in a unit test where `editor.api.js` is not.
 *
 * Monaco ships `.d.ts` files only for its public entry points, so the specifier is untyped and a plain
 * import is a `noImplicitAny` error. This declares it — and declares it in terms of the public API's
 * own types, so the spec's assertions are held against `languages.CompletionItemKind` as Monaco
 * publishes it. If a Monaco upgrade removed a member, this file would fail to compile before the spec
 * got the chance to fail at runtime.
 *
 * Only the two enums the spec reads are declared. Adding a third is one line; declaring forty that
 * nothing imports is the 1:1 re-declaration this package avoids everywhere else.
 */
declare module 'monaco-editor/editor/common/standalone/standaloneEnums.js' {
  type MonacoLanguages = typeof import('monaco-editor/editor/editor.api.js').languages;

  export const CompletionItemKind: MonacoLanguages['CompletionItemKind'];
  export const CompletionItemInsertTextRule: MonacoLanguages['CompletionItemInsertTextRule'];
}
