import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'playwright-report/', 'test-results/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser }
  },
  {
    // Node code, and tests that run in Node but drive or mirror the browser.
    files: ['server/**', 'functions/**', 'tests/**', '*.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } }
  }
];
