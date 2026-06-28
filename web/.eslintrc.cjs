/* Frontend lint config — mirrors server/.eslintrc.json conventions, adapted
   for React + the Vite toolchain. Kept as .cjs because the package is ESM
   ("type": "module") and ESLint loads its rc as CommonJS. */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react-hooks', 'react-refresh'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  ignorePatterns: ['dist', 'node_modules', 'playwright-report', 'test-results'],
  rules: {
    // Warn (not error) for the frontend: the existing app code predates any
    // lint config and uses `any` in places; establishing the baseline here
    // without rewriting working app logic. New test code disables it outright.
    '@typescript-eslint/no-explicit-any': 'warn',
    // Same rationale as no-explicit-any: warn, don't fail, on pre-existing app code.
    'prefer-const': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      // Tests and Playwright specs use loose typing and node globals.
      files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/test/**', 'e2e/**'],
      env: { node: true },
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
  ],
};
