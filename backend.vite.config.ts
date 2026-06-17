import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    target: 'node22',
    ssr: resolve(__dirname, 'src/backend/worker.ts'),
    outDir: 'dist/backend',
    emptyOutDir: true,
    rollupOptions: {
      external: ['electron', 'onnxruntime-node', 'sharp', 'exifr'],
      output: {
        format: 'cjs',
        entryFileNames: 'worker.js',
      },
    },
  },
});
