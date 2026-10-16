import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // @phalanx-engine/* 0.2.3 ships extensionless relative imports.
    // Inlining them lets Vite resolve those specifiers. The playground
    // stays pinned to npm 0.2.3 until it moves onto the workspace packages.
    server: {
      deps: {
        inline: [/@phalanx-engine\//],
      },
    },
  },
});
