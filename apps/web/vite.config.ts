import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

export default defineConfig(({ mode }) => ({
  build: { outDir: mode === 'android' ? 'dist-android' : 'dist' },
  plugins: [
    react(),
    ...(mode === 'android'
      ? []
      : [
          {
            name: 'retire-legacy-pwa',
            generateBundle() {
              // Keep the old URL available for browsers updating an existing worker.
              this.emitFile({
                type: 'asset',
                fileName: 'sw.js',
                source: readFileSync(new URL('./legacy-sw.js', import.meta.url), 'utf8'),
              });
            },
          } satisfies Plugin,
        ]),
  ],
  server: {
    port: 5173,
    proxy: {
      '/downloads': { target: 'http://localhost:3000', changeOrigin: false },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
      },
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      '**/dist/**',
      'e2e/**',
      '**/dist-android/**',
      'android/**',
      '.android-tools/**',
    ],
    maxWorkers: 4,
    environment: 'jsdom',
    setupFiles: [],
  },
}));
