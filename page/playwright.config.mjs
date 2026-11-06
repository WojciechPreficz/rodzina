import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.pw.mjs',
  outputDir: '../test-results/page',
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: '../test-results/page-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4178', headless: true, serviceWorkers: 'block' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: 'node page/server.mjs',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { PAGE_PORT: '4178' },
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
    timeout: 15000,
  },
});
