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
// NB: this worktree's node_modules is a cross-root symlink to WMKF_Apps, which
// Turbopack rejects — so the dev server runs with `--webpack`. In the WMKF_Apps
// checkout (real node_modules) plain `next dev` also works.

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
    // Use the PRODUCTION server, not `next dev`. Under `next dev --webpack`,
    // instrumentation.js's node-only import chain (→ dynamics-service → crypto)
    // fails to resolve in the edge compile; `next build` compiles it correctly,
    // so `next start` serves a clean app. (`next build`/`next dev` default to
    // Turbopack in Next 16, which rejects this worktree's cross-root node_modules
    // symlink — hence the explicit `--webpack`.) For fast local iteration, start
    // the server once manually (`next build --webpack && next start -p 3100`) and
    // Playwright reuses it.
    command: `npx next build --webpack && npx next start -p ${PORT}`,
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
