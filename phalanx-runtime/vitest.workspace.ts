import { defineWorkspace } from 'vitest/config';

/**
 * Worker sim tests share one fork and a longer timeout. The rest of the
 * suite keeps Vitest's defaults so a hang is not hidden for 30s.
 */
export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'server',
      include: ['tests/server/**/*.test.ts'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      pool: 'forks',
      poolOptions: {
        forks: {
          singleFork: true,
        },
      },
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit',
      include: ['tests/**/*.test.ts'],
      exclude: ['tests/server/**', '**/node_modules/**', '**/dist/**'],
    },
  },
]);
