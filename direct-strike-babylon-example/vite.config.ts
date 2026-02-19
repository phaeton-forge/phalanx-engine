import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true, // Listen on all network interfaces (0.0.0.0)
    port: 5173,
  },
});
