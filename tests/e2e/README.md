# End-to-end tests (Playwright)

Browser E2E for the **external reviewer portal** (`pages/external/review/[token].js`
+ `shared/components/external/*`). These complement the jest/jsdom unit tests by
driving the real page in a real browser — scroll-gated policy modals, accept-button
gating, opt-out card hiding, and client/server error rendering.

## Run

```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # interactive UI mode
```

First time on a machine, install the browser once:

```bash
npx playwright install chromium
```

The config (`playwright.config.js`) starts the app itself (`webServer`), so you do
**not** need a dev server running. To iterate fast, start one manually and Playwright
will reuse it:

```bash
npx next build --webpack && npx next start -p 3100
```

## How it works (and why)

- **Data layer is mocked at the browser** (`tests/e2e/helpers/reviewer-portal.js`):
  `/context` and `/respond` are route-mocked, so the real page + components render
  and behave exactly as in prod but **no request reaches the server or Dataverse**.
  This is deliberate — a real accept creates a honorarium `akoya_request` and fires
  production automation (a live Bill.com payment flow, a Business-Central sync, etc.;
  see the `project-reviewer-accept-prod-automation` memory). The server-side `422`
  guard itself is covered by the jest unit test `tests/unit/respond-required-address.test.js`.

## Environment gotchas (why the config looks the way it does)

- **Production server, not `next dev`.** Under `next dev --webpack`, `instrumentation.js`'s
  node-only import chain (→ `dynamics-service` → `crypto`) fails to resolve in the edge
  compile; `next build` compiles it fine, so the config uses `next build --webpack && next start`.
- **`--webpack` everywhere.** `next dev`/`next build` default to Turbopack in Next 16,
  which rejects a cross-root `node_modules` symlink (used by the `WMKF_onboarding`
  worktree). In a normal checkout with a real `node_modules`, plain `next dev` also works.
- **Readiness check hits the token-public portal route**, because `/` redirects to the
  auth-gated signin page (which 500s without a session).
- `tests/e2e/` is excluded from jest (`jest.config.js` `testPathIgnorePatterns`); jest
  and Playwright never pick up each other's specs.

## CI

`.github/workflows/e2e.yml` runs this suite on PRs that touch the reviewer/external
flow or the harness (path-filtered to avoid running on docs-only PRs). The HTML report
is uploaded as a build artifact on every run.
