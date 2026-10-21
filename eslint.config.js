// ESLint flat config.
//
// House style, derived from the code that was already here: modern ES
// (const/let, arrow functions, template literals, async/await), never `var`,
// no deprecated globals. Run with: npm run lint.
//
// This file is CommonJS because package.json has no "type": "module" field
// and the rest of the repo uses require()/module.exports.

const { defineConfig, globalIgnores } = require('eslint/config');
const js = require('@eslint/js');
const globals = require('globals');

const modernEs = {
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-template': 'error',
  'object-shorthand': ['error', 'properties'],
  'arrow-body-style': ['error', 'as-needed'],
  'prefer-arrow-callback': 'error',
  'no-useless-concat': 'error',
  'no-return-await': 'error',
  // Flags async functions that never await, and promise executors that
  // resolve - both are usually mistakes.
  'require-await': 'error',
  'no-async-promise-executor': 'error',
};

const correctness = {
  eqeqeq: ['error', 'smart'],
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  'no-implicit-globals': 'error',
  'no-console': 'off',
};

module.exports = defineConfig([
  globalIgnores(['public/**', 'node_modules/**']),
  {
    name: 'repo/recommended',
    files: ['**/*.js'],
    plugins: { js },
    extends: ['js/recommended'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: { ...modernEs, ...correctness },
  },
  {
    name: 'repo/browser',
    // The manage page script: an ES module running in the browser.
    files: ['assets/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
    },
    rules: { ...modernEs, ...correctness },
  },
]);
