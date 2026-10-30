import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run dev -- --hostname localhost',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      SESSION_SECRET: 'playwright-test-session-secret-with-at-least-32-bytes',
      RP_NAME: 'Todo App Tests',
      RP_ID: 'localhost',
      RP_ORIGIN: 'http://localhost:3000',
      TRUSTED_PROXY: 'true',
      DATABASE_PATH: join(tmpdir(), `todo-app-e2e-${process.pid}.db`),
    },
  },
});