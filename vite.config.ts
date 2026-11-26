import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 判读计算全部在 Web Worker 内完成；Vite 会自动打包 new Worker(new URL(...))
export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    port: 5180,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
});
