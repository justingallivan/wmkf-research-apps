---
name: project-e2e-playwright-harness
description: Playwright browser-E2E harness for the external reviewer portal lives in tests/e2e/ (run `npm run test:e2e`). Mocks the Dataverse data layer at the browser; runs against `next build --webpack && next start` (NOT next dev). CI-gated via .github/workflows/e2e.yml (path-filtered to the reviewer flow). Shipped 2026-06-11.
metadata:
  type: project
  status: active
  scope: testing
  last_verified: 2026-06-11 — harness + CI added (7 specs green locally)
---

## Recall Rule

Read this when: adding/running browser E2E for the reviewer Stage-2a accept flow or the external portal, or touching `pages/external/**`, `shared/components/external/**`, or the portal API routes and wanting an end-to-end check.

Do:
- Run `npm run test:e2e` (headless) or `npm run test:e2e:ui`. First time on a machine: `npx playwright install chromium`.
- MOCK the Dataverse data layer at the browser (route-mock `/context` + `/respond` via `tests/e2e/helpers/reviewer-portal.js`). Do NOT drive a real accept in a test — it creates a honorarium `akoya_request` and fires prod automation ([[project-reviewer-accept-prod-automation]]).
- Cover the browser/UX layer jsdom can't (scroll-gated policy modals, accept-button gating, opt-out card hiding, inline 422 render). The server-side 422 guard itself is unit-tested (`tests/unit/respond-required-address.test.js`).

Do not:
- Use `next dev` for the webServer. Under `next dev --webpack`, `instrumentation.js`'s node-only chain (→ dynamics-service → `crypto`) fails the edge compile; the config runs `next build --webpack && next start` instead, which compiles cleanly.
- Drop the `--webpack` flag: `next dev`/`next build` default to Turbopack in Next 16, which rejects the `WMKF_onboarding` worktree's cross-root `node_modules` symlink. (In a real-node_modules checkout, plain `next dev` would also work — webpack is just the portable choice.)

Ground truth: `playwright.config.js`, `tests/e2e/` (+ `tests/e2e/README.md`), `.github/workflows/e2e.yml`. Related: [[project-reviewer-accept-prod-automation]], [[project-bill-honorarium-integration]].

**Why:** the reviewer accept flow has real browser behavior (scroll-to-acknowledge gate, accept disabled until acked, opt-out hides the address card, the 422 inline render) that jsdom component tests can't fully exercise. The harness is the first Playwright setup in the repo; CI (`e2e.yml`) is path-filtered to the reviewer/external flow so it doesn't add ~3-4 min to the many docs/memory-only PRs.
