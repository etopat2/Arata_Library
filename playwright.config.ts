import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: 'studio.spec.ts',
  timeout: 90000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5188',
    browserName: 'chromium',
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3111/api/v1/health/live',
      reuseExistingServer: false,
      timeout: 90000,
      env: { API_PORT: '3111', WEB_ORIGIN: 'http://127.0.0.1:5188' },
    },
    {
      command: 'npm run preview -w @arata/web-pwa -- --port 5188',
      url: 'http://127.0.0.1:5188',
      reuseExistingServer: false,
      timeout: 90000,
      env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:3111' },
    },
  ],
});
