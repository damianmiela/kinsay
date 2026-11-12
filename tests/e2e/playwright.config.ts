// Browser tests: real Chromium pages for the admin, a host's phone and readers. `npm run test:e2e`
// builds first. The server is tests/server.ts: the real app, a throwaway database, a fake speech
// service (no Soniox, no real data).
import { defineConfig } from '@playwright/test';

const port = '3297';
export const PASSWORD = 'e2e-admin-password'; // a test value: this server only ever has test data

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    // a fake microphone (a tone), allowed without asking
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  outputDir: '../../test-results',
  webServer: {
    command: 'npx tsx tests/server.ts',
    cwd: '../..',
    url: `http://127.0.0.1:${port}/health`,
    reuseExistingServer: false,
    env: { E2E_PASSWORD: PASSWORD, E2E_PORT: port },
  },
});
