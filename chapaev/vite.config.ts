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
    build: {
      rollupOptions: {
        external: ['@capacitor/app'],
        output: {
          manualChunks(id: string) {
            if (id.includes('@telegram-apps')) return 'platform-telegram';
            if (id.includes('platform/YandexAdapter')) return 'platform-yandex';
          },
        },
      },
    },
  };
});

