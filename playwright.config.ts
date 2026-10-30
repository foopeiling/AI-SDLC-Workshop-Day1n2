import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const e2eRunId = process.env.PLAYWRIGHT_E2E_RUN_ID ?? 'manual';
const e2ePort = Number(process.env.PLAYWRIGHT_E2E_PORT ?? 3100);
const e2eOrigin = `http://localhost:${e2ePort}`;
const e2eDatabasePath = process.env.DATABASE_PATH ?? join(tmpdir(), `todo-app-e2e-${e2eRunId}.db`);
const e2eDistDir = process.env.NEXT_DIST_DIR ?? `.next-playwright-${e2eRunId}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: e2eOrigin,
    timezoneId: 'Asia/Singapore',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: `npm run seed:holidays && npm run dev -- --hostname localhost --port ${e2ePort}`,
    url: `${e2eOrigin}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SESSION_SECRET: 'playwright-test-session-secret-with-at-least-32-bytes',
      RP_NAME: 'Todo App Tests',
      RP_ID: 'localhost',
      RP_ORIGIN: e2eOrigin,
      TRUSTED_PROXY: 'true',
      PLAYWRIGHT_E2E: 'true',
      NEXT_DIST_DIR: e2eDistDir,
      DATABASE_PATH: e2eDatabasePath,
    },
  },
});