import js from '@eslint/js';
import globals from 'globals';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Flat config, and therefore ESLint 9 pinned to this package rather than the
// repo-root ESLint 8 + .eslintrc.json. The root config stays authoritative for
// every other package until the Angular renderer is deleted at cutover.
export default tseslint.config(
  { ignores: ['dist/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  // `configs.flat.*` — the top-level `configs['recommended*']` keys are still the
  // legacy eslintrc shape and blow up under flat config.
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.recommended,
  {
    languageOptions: {
      // No `globals.node`: the bundle runs sandboxed with nodeIntegration: false.
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': 'warn',
      'object-shorthand': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['vite.config.ts', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  // `dangerouslySetInnerHTML` is banned outside src/markdown/. The Angular renderer bound
  // unsanitized strings to `[innerHTML]` in several places; CLAUDE.md's AI rules answer that
  // with exactly one sanctioned path — a single component that parses with `marked` and
  // sanitizes with DOMPurify. src/markdown/ (Task 6) is that component's home and the only
  // place the escape hatch is allowed; the ban lands now so nothing can grow a second one
  // before it exists.
  //
  // Two selectors because the property reaches JSX through two different AST node types:
  // `JSXIdentifier` for `<div dangerouslySetInnerHTML={…}>`, and `Identifier` for every
  // other route — an object literal handed to `createElement`, a spread prop, a variable
  // built up and passed along.
  {
    ignores: ['src/markdown/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXIdentifier[name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML is banned outside src/markdown/. Render untrusted or ' +
            'AI-generated content through the markdown component, which sanitizes with DOMPurify.',
        },
        {
          selector: 'Identifier[name="dangerouslySetInnerHTML"]',
          message:
            'dangerouslySetInnerHTML is banned outside src/markdown/. Render untrusted or ' +
            'AI-generated content through the markdown component, which sanitizes with DOMPurify.',
        },
      ],
    },
  },
  // Last: turns off everything Prettier already owns.
  prettier
);
