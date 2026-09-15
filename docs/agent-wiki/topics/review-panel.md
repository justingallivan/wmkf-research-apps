---
agent_wiki: topic
status: active
last_verified: 2026-09-15
stale_after_days: 60
owner: product-engineering
source_files:
  - lib/services/review-panel-service.js
  - lib/services/review-panel-store.js
  - lib/services/review-panel-worker.js
  - lib/services/review-panel-generation.js
  - lib/services/review-panel-questions.js
  - lib/services/review-panel-input.js
  - lib/services/review-panel-rollout.js
  - lib/services/review-panel-storage.js
  - lib/services/review-panel-documents.js
  - shared/config/reviewPanelSeats.js
  - pages/api/review-panel/index.js
  - pages/api/review-panel/download.js
  - pages/api/cron/drain-review-panels.js
  - pages/review-panel.js
  - shared/components/review-panel/review-panel-ui.js
  - shared/components/workbench/ReviewPanelTab.js
canonical_docs:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/plans/REVIEW_PANEL_WORKBENCH_TAB_PLAN_2026-09-13.md
  - docs/atlas/postgres-review-panel.md
  - docs/VIRTUAL_REVIEW_PANEL.md
watch_paths:
  - lib/services/review-panel-*.js
  - pages/api/review-panel/**
  - pages/api/cron/drain-review-panels.js
  - pages/review-panel.js
  - shared/components/review-panel/**
  - shared/components/workbench/ReviewPanelTab.js
update_triggers:
  - Review Panel migration/schema, lease-fence, or worker-drain changes
  - Review Panel route, service, or rollout-gate changes
  - D11 Blob store provisioning status changes
---

# Review Panel (Phase A foundation)

**Do not confuse with `docs/VIRTUAL_REVIEW_PANEL.md`'s app** (`virtual-review-panel` key, `MultiLLMService`-based, still live — D5 says unchanged, no retirement work in Phase A). This is a **separate, source-built successor** (app key `review-panel`) on the governed Executor.

## Files

- Service layer: `review-panel-service.js` (routes stay thin — roster, launch, status projection, operator stop, retry), `review-panel-store.js` (persistence + the two lease fences), `review-panel-worker.js` (single global run lease drain, entry materialization, report-edition persistence, run-status finalization), `review-panel-generation.js` (`snapshotConfiguration`, `runSeat`/`runChair`), `review-panel-questions.js` (D7's fixed not-assessable line + question projection), `review-panel-input.js` (narrative-only DTO, D2), `review-panel-rollout.js` (enable/mode/allowlist/roster-filter gates), `review-panel-storage.js` + `review-panel-documents.js` (D11 dedicated Blob + DOCX/PDF report editions).
- Routes: `/api/review-panel` (GET status, POST launch/retry/stop/operator-stop), `/api/review-panel/download` (entryId+format), `/api/cron/drain-review-panels` (worker cron).
- Page: `/review-panel` (`pages/review-panel.js`) — the multi-request launcher and operator-stop surface: Requests/Progress tabs, Include/Exclude all, inline Launch error mirroring server preconditions, retry-failed selection, reservation shown as a BOUND only (D6). Kept (T4).
- Workbench tab (S511): `shared/components/workbench/ReviewPanelTab.js`, mounted by `pages/workbench/[requestId].js` between Reviews and Staff Deliberations ONLY when `useAppAccess().hasAccess('review-panel')` (the `gate` field on the TABS entry; a deep link without the grant falls back to Overview). Reads GET `/api/review-panel?requestId=` (`getReviewPanelForRequest`): every launcher's runs for the request (T3), `owner.isMine`, and a server-computed `launchable {ok, reason}` the tab renders verbatim. Stop/Retry/Re-render appear only on the viewer's own runs (server keeps those owner-scoped). Shared pills/timeline/entry row live in `shared/components/review-panel/review-panel-ui.js` (page re-exports its tested names).
- Config: `shared/config/reviewPanelSeats.js` (fixed vendor per seat — Claude + OpenAI reviewer seats, Claude chair; an admin model override may change the model within a seat's vendor, never the vendor itself).

## Gates this surface must keep green

`check:api-routes`, `check:route-lifecycle-auth`, `check:atlas`, `check:fact-consistency`, `check:canonical-pointers`, `check:model-override-warming` (every route touching a review-panel model-resolving module needs its own awaited `loadModelOverrides()`), `check:route-service-boundary`, `check:trust-boundary-guid`, `check:status-enum-parity`, `check:prompt-injection-tagging`, `check:secret-scan`, `check:types`.

## Hazards

- **Actor gate is split; keep Dataverse out of Postgres transactions (S511, T1).** `assertReviewPanelActor` = active profile only (Postgres) and is what `mutateReviewPanelRun`, retry, re-render, and cancel call inside `FOR UPDATE` transactions. `assertReviewPanelAccess` = actor AND (superuser OR `review-panel` grant via `listAppKeysForUser`) and is called ONLY outside transactions: the four service entry points and the worker's claim-time / pre-paid-dispatch checks (inside the cron's DAL context). A grant-lookup failure is a 503 marked `interrupted` (worker pauses the pass; route returns retry copy) — never a 403 revocation and never a pass.
- **Rollout mode `access` (T2)** ignores the allowlist (`assertReviewPanelCohortConfigured` returns null; `assertReviewPanelRequestAllowed` admits every roster request). `smoke`/`pilot` unchanged; unknown modes still 503. The one-request-in-flight guard (`assertNoActiveRunForRequests`, 409) runs AFTER the idempotent replay check so a replayed key still returns its own running run.
- **Two lease fences, not one.** Run-state changes (creating an entry/attempt, dispatch, reap, winner selection, entry materialization, run-status finalization) require the run's CURRENT worker lease. Attempt finalization is a separate CAS on the attempt's own `dispatch_token` + `dispatch_expires_at`, decided on `clock_timestamp()` — see `docs/atlas/postgres-review-panel.md`.
- **A route never holds a lease.** `launchReviewPanel` cannot create `review_panel_entries` rows directly (`createReviewPanelEntry` requires the lease) — it parks resolved input DTOs in `run.data.pendingEntries` for the worker's `materializePendingEntries` to consume. Likewise, an operator retry request only sets `retry_requested_at`; the worker's `drainReviewPanels` does the actual `retryFailedEntries` call and clears the marker.
- **Cost suppression is load-bearing.** Any surface reading `review_panel_seat_attempts` (reports, spend-check cron, admin stats) must withhold the total (never show a number) when any attempt in scope is `unknown`-state — never silently treat it as $0.
- **D11 store provisioned 2026-09-13** (`wmkf-review-panel-private`, `store_cwVLLxRMR3A8NFA2`, `REVIEW_PANEL_BLOB` prefix, Production + Preview). `review-panel-storage.js` 503s with plain copy when `REVIEW_PANEL_BLOB_READ_WRITE_TOKEN` is unset; the worker fails the entry (preserving the chair result) rather than completing silently with no saved report.
- **The panel never writes `api_usage_log`.** Its own `review_panel_seat_attempts` ledger is the only source for both `pages/api/cron/spend-check.js`'s daily sum and `pages/api/admin/stats.js`'s `reviewPanel` block.
- **D7 teamCapacity.** Seats must never emit free text for `teamCapacity`; the report always prints the fixed line from `REVIEW_PANEL_NOT_ASSESSABLE_REPORT_LINE` (`review-panel-questions.js`) — never retype it elsewhere.
