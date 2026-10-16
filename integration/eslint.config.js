import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@phalanx-engine/*', '@phalanx-engine/*/**'],
              message:
                'Only adapters/, facade/, and suites/packageSmoke.ts may import @phalanx-engine/*.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/adapters/**/*.ts',
      'src/facade/**/*.ts',
      'src/suites/packageSmoke.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
    },
  }
);
