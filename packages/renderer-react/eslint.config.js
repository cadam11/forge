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
  // Last: turns off everything Prettier already owns.
  prettier
);
