// Playwright E2E config — browser tests for the external reviewer portal.
//
// These specs drive the REAL Next pages/components in a browser, with the
// portal's API routes (`/context`, `/respond`) route-mocked at the browser so
// the test is deterministic and touches NO Dataverse (see the memory
// `project-reviewer-accept-prod-automation` for why mocking the data layer is
// the required approach — a real accept creates a honorarium request and fires
// prod automation). The real server-side 422 guard is covered by the jest unit
// test `tests/unit/respond-required-address.test.js`; these specs cover the
// browser/UX layer jsdom can't (scroll-gated policy modals, accept-gating,
// opt-out card hiding, inline error rendering).
//
// Use a real lockfile installation in this checkout. Production CSP coverage
// must exercise Turbopack, the deployed bundler, rather than a webpack build.

const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.E2E_PORT || 3100;
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  // jest owns tests/unit + tests/integration and ignores tests/e2e
  // (jest.config.js testPathIgnorePatterns) — no collision.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // Always emit the HTML report (so the CI upload-artifact step has something to
  // archive) alongside the console reporter. `open: 'never'` keeps it from trying
  // to launch a browser in CI / non-interactive runs.
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
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
    // Production mode is essential: development allows inline scripts and
    // webpack does not emit the same inline startup as deployed Turbopack.
    // Install dependencies in this checkout; cross-root symlinks are unsupported.
    command: `NEXTAUTH_SECRET=e2e-throwaway-nextauth-secret-32-chars NEXTAUTH_URL=${BASE_URL} npx next build && NEXTAUTH_SECRET=e2e-throwaway-nextauth-secret-32-chars NEXTAUTH_URL=${BASE_URL} npx next start -p ${PORT}`,
    // Readiness check hits a PUBLIC route — `/` redirects to the auth-gated
    // signin page; the external review portal is token-public (allowlisted in
    // proxy), so it returns 200.
    url: `${BASE_URL}/external/review/e2e-readyz`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
