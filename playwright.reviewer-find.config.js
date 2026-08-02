// Dedicated, credential-free Playwright configuration for Reviewer Find warm
// browser contracts. The server command creates a tracked-files-only temporary
// root and starts Webpack there; it never reuses a developer's local server.

const { defineConfig, devices } = require('@playwright/test');

const PORT = Number(process.env.REVIEWER_FIND_E2E_PORT || 3217);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
  throw new Error(`REVIEWER_FIND_E2E_PORT must be a local TCP port; received ${process.env.REVIEWER_FIND_E2E_PORT}.`);
}
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/reviewer-find-warm.spec.js',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['line'], ['html', { outputFolder: 'playwright-report/reviewer-find', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report/reviewer-find', open: 'never' }]],
  outputDir: 'test-results/reviewer-find',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    actionTimeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node scripts/reviewer-find-e2e-server.mjs --port ${PORT}`,
    url: `${BASE_URL}/external/review/e2e-readyz`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
