import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@phalanx-engine\/game\/math$/,
        replacement: path.resolve(root, '../phalanx-game/dist/math.js'),
      },
      {
        find: /^@phalanx-engine\/game\/physics$/,
        replacement: path.resolve(root, '../phalanx-game/dist/physics.js'),
      },
      {
        find: /^@phalanx-engine\/game\/abilities$/,
        replacement: path.resolve(root, '../phalanx-game/dist/abilities.js'),
      },
      {
        find: /^@phalanx-engine\/game\/advanced$/,
        replacement: path.resolve(root, '../phalanx-game/dist/advanced.js'),
      },
      {
        find: /^@phalanx-engine\/game$/,
        replacement: path.resolve(root, '../phalanx-game/dist/index.js'),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
