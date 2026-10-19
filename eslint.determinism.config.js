import tseslint from 'typescript-eslint';

const BANNED_GLOBALS = [
  'Date',
  'performance',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'clearTimeout',
  'clearInterval',
  'clearImmediate',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'document',
  'window',
  'globalThis',
  'self',
  'navigator',
  'process',
];

export default [
  {
    files: [
      'phalanx-math/src/**/*.ts',
      'phalanx-ecs/src/**/*.ts',
      'phalanx-physics/src/**/*.ts',
      'phalanx-abilities/src/**/*.ts',
    ],
    ignores: ['**/*.test.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // Existing disable comments name this rule. It stays off here; the
      // config only enforces the determinism bans.
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-globals': ['error', ...BANNED_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
        },
      ],
    },
  },
];
