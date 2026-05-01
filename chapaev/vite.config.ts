import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const debugConsoleBuildEnabled =
    command === 'serve' && (mode === 'development' || env.VITE_ENABLE_DEBUG_CONSOLE === 'true');

  return {
    base: './',
    define: {
      __DEBUG_CONSOLE_BUILD_ENABLED__: JSON.stringify(debugConsoleBuildEnabled),
    },
    server: {
      host: true,
      port: 5174,
    },
  };
});

