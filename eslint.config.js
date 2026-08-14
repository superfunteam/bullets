import reactHooks from 'eslint-plugin-react-hooks';
import tsParser from '@typescript-eslint/parser';

/**
 * Two rules, on purpose.
 *
 * This is not a style linter and must not become one — formatting is not worth
 * a CI step here, and a config that shouts about quote marks is a config people
 * learn to run with --fix and stop reading.
 *
 * It exists for ONE bug class, which has already shipped to production: a hook
 * placed after an early return. `useBullet` is a live query that returns
 * undefined on the first render and the row on the next, so a hook below
 * `if (!bullet) return null` renders a different number of hooks on each pass —
 * React error #310. It typechecks, every test passes, and the component simply
 * refuses to mount. Tapping a card showed nothing.
 *
 * tsc cannot see this and vitest never mounted the component. This can.
 */
export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // A warning, not an error: several effects here deliberately omit deps
      // and say why in a comment. Worth surfacing, not worth blocking on.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
