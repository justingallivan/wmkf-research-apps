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

[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) runs this suite on PRs
that touch the reviewer/external flow or the harness (path-filtered to avoid running on
docs-only PRs). The HTML report is uploaded as a build artifact on every run.

## Applicant materials scan UX

[`materials-scan-rejection.spec.js`](materials-scan-rejection.spec.js) exercises the
real contributor page in Chromium with all API traffic intercepted before navigation.
Unknown APIs and third-party requests are aborted. The single-part and multipart Blob
SDK requests are intercepted, including a generated file larger than 60 MiB to exercise
multipart create, part, and completion calls without writing to a Blob store. Browser
interception shows the single-part initial progress state but does not expose byte
movement; the unit tests cover intermediate progress callback updates.

Run the spec against the local production build with the regular config:

```bash
npx playwright test tests/e2e/materials-scan-rejection.spec.js --project=chromium
```

For a specific immutable Preview deployment, pass its URL to the separate config:

```bash
MATERIALS_PREVIEW_URL=https://wmkfresearchapps-<deployment-id>-justin-gallivans-projects.vercel.app \
  npx playwright test --config=playwright.materials-preview.config.js tests/e2e/materials-scan-rejection.spec.js --project=chromium
```

The Preview config has no local web server and rejects stable Production/Preview aliases
and the `git-main` alias. Verify the selected immutable deployment is a Preview for the
current branch before running it. Deployment protection must be handled by the operator;
the test itself does not store or configure a bypass credential.
