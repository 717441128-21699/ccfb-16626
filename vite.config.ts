import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
    port: 5188,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2000,
  },
});
