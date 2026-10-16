import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => ({
  build: { outDir: mode === 'android' ? 'dist-android' : 'dist' },
  plugins: [
    react(),
    ...(mode === 'android'
      ? []
      : [
          VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            injectRegister: false,
            manifest: {
              name: 'Rodzina',
              short_name: 'Rodzina',
              lang: 'pl',
              display: 'standalone',
              start_url: '/',
              theme_color: '#426b53',
              background_color: '#f6f7f2',
              icons: [
                { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                {
                  src: '/icons/icon-maskable-512.png',
                  sizes: '512x512',
                  type: 'image/png',
                  purpose: 'maskable',
                },
              ],
            },
          }),
        ]),
  ],
  server: {
    port: 5173,
    proxy: {
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
