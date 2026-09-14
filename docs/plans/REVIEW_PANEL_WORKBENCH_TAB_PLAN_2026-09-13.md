---
title: Review Panel Workbench Tab Plan (2026-09-13)
domain: virtual-review-panel
kind: plan
status: in-progress
summary: "Move the Review Panel beyond smoke by mounting it as a per-request Request Workbench tab (between Reviews and Staff Deliberations) gated by the admin-panel `review-panel` app grant. Records the owner's 2026-09-13 decisions: app-access actor gate, a fail-closed `access` rollout mode replacing the env allowlist, shared per-request visibility, and the standalone page kept."
cataloged: 2026-09-13
owner: product-engineering
last_verified: 2026-09-13
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/plans/REVIEW_PANEL_OVERNIGHT_BRIEF_2026-09-13.md
  - docs/atlas/postgres-review-panel.md
  - docs/agent-wiki/topics/review-panel.md
---

# Review Panel Workbench Tab Plan (2026-09-13)

## 1. Owner decisions (2026-09-13, Session 511)

| # | Decision | Consequence |
|---|---|---|
| T1 | **Access gate = admin-panel app grant only.** | `assertReviewPanelActor` relaxes from "active superuser" to "active profile that is a superuser OR holds the `review-panel` grant". The tab is visible iff `hasAccess('review-panel')`, so UI and server gates mirror each other. |
| T2 | **App access replaces the env allowlist.** | New fail-closed rollout mode `access`: any request in the server-scoped roster is launchable; `REVIEW_PANEL_REQUEST_ALLOWLIST` is ignored in that mode. `pilot` and `smoke` keep today's semantics; unknown modes still 503. |
| T3 | **Shared visibility per request.** | The tab lists every panel entry for the request regardless of launcher. Retry, re-render, and stop stay owner-scoped (the launcher's). |
| T4 | **Keep `/review-panel`.** | The standalone page remains the multi-request launcher and the operator-stop surface. Shared UI is lifted into one module so page and tab do not fork. |

Standing decisions D1–D11 (Phase A plan §1) and the brief §4 delegated decisions are unchanged. D6 still forbids a "typical cost" figure; the tab shows the reservation bound only.

## 2. Build slices (one feature branch, one PR — Tier 2 runtime work)

1. **Rollout gate** (`lib/services/review-panel-rollout.js`): accept `access`; `assertReviewPanelCohortConfigured` returns `null` in `access` mode without reading the allowlist; `assertReviewPanelRequestAllowed` passes in `access` mode. Tests in `tests/unit/review-panel-rollout.test.js`.
2. **Actor gate** (`lib/services/review-panel-store.js`): split in two, per the contract-reconcile pass. `assertReviewPanelActor` becomes the Postgres-only "active profile" check and stays inside the store's `FOR UPDATE` transactions (`mutateReviewPanelRun`, retry, re-render, cancel), which must never hold a row lock across a Dataverse call. New `assertReviewPanelAccess(profileId)` = active profile AND (superuser role OR `listAppKeysForUser(profileId, { throwOnError: true })` includes `review-panel`), failing closed on a lookup error; called at the four service entry points and at the worker's claim-time and pre-paid-dispatch checks (`review-panel-worker.js:51`, `:702`), which run inside the cron's `withDalContext` so the Dataverse read is permitted. Worker `OWNER_LOST_MESSAGE` copy updated with its two test regexes. Tests in `review-panel-store.test.js`, `review-panel-service.test.js`, and `review-panel-worker.test.js`.
3. **Store read**: `listReviewPanelEntriesForRequest(requestId)` — entries joined to their run (status, created_at, owner_profile_id, owner display name), newest first, bounded.
4. **Service**: `getReviewPanelForRequest(owner, requestId)` — GUID-validate, actor + enabled, configuration block (shared with `getReviewPanelPage`), roster membership, `launchable: { ok, reason }` computed by calling the server's own preconditions, entries projected with the existing seat/timeline helpers plus `run.isMine`.
5. **Route**: `/api/review-panel` GET with `?requestId=<guid>` dispatches to the request-scoped read; POST actions unchanged (launch sends `[requestId]`). Matrix row updated. `check:trust-boundary-guid` covers the new selector.
6. **Shared UI lift**: `shared/components/review-panel/review-panel-ui.js` holds the pills, timeline, entry row, launch-state and polling helpers. `pages/review-panel.js` re-exports the names its tests import.
7. **Shell**: `pages/workbench/[requestId].js` adds `{ key: 'review-panel', label: 'Review Panel', gate: 'review-panel' }` after `reviews`; visible tabs derive from `hasAccess`; a deep link to a hidden tab falls back to `overview`. Shell visibility test added.
8. **Tab**: `shared/components/workbench/ReviewPanelTab.js` — one surface combining the old Requests and Progress views for the single request: header with latest status and Launch, configuration/bound line, active-run progress with seat pills, edition history with Word/PDF links, retry/re-render for the viewer's own entries. `impeccable` pass once the payload shape is fixed.
9. **Docs**: matrix, runbook (`access` mode), Atlas page (shared read path), wiki topics (review-panel, reviewer-workbench-lifecycle), Phase A plan pointer, SESSION_PROMPT at stop.

## 3. Gates

`check:api-routes`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, `check:model-override-warming`, `check:route-service-boundary`, `check:status-enum-parity`, `check:atlas`, `check:fact-consistency`, `check:doc-symbol-refs`, `check:agent-wiki`, `check:types`, and the review-panel and workbench unit suites.

## 4. Rollout

After merge the owner sets `REVIEW_PANEL_ROLLOUT_MODE=access` (and may leave the allowlist in place; it is ignored) and grants `review-panel` in the admin panel to the pilot users. No migration.
