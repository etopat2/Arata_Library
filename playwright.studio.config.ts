import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

const local = dotenv.parse(readFileSync(process.env.ARATA_ENV_FILE ?? '.env.local', 'utf8'));
if (
  !local.TEST_DATABASE_URL ||
  new URL(local.TEST_DATABASE_URL).pathname !== '/arata_techlibrary_test'
)
  throw new Error('Studio browser suite requires isolated test database');

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'studio.spec.ts',
  timeout: 120000,
  use: {
    baseURL: 'http://127.0.0.1:5187',
    browserName: 'chromium',
    ...(process.env.CI ? {} : { channel: 'chrome' }),
  },
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:3110/api/v1/health/live',
      reuseExistingServer: false,
      timeout: 90000,
      env: {
        DATABASE_URL: local.TEST_DATABASE_URL,
        NODE_ENV: 'test',
        WEB_ORIGIN: 'http://127.0.0.1:5187',
        API_PORT: '3110',
      },
    },
    {
      command: 'npm run preview -w @arata/web-pwa -- --port 5187',
      url: 'http://127.0.0.1:5187',
      reuseExistingServer: false,
      timeout: 90000,
      env: { VITE_API_PROXY_TARGET: 'http://127.0.0.1:3110' },
    },
  ],
});
