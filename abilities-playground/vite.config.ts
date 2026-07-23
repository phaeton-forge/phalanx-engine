import { defineConfig, loadEnv } from 'vite';

const PRODUCTION_SERVER_URL = 'https://abilities-playground-backend.onrender.com';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverUrl =
    env.VITE_SERVER_URL || (mode === 'production' ? PRODUCTION_SERVER_URL : '');

  return {
    base: './',
    define: {
      'import.meta.env.VITE_SERVER_URL': JSON.stringify(serverUrl),
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
