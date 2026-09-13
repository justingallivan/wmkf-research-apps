---
title: Postgres Review Panel
domain: review-panel
kind: source-of-truth
status: live
summary: "Source-built Virtual Review Panel Phase A foundation state: five Postgres tables hold the run/entry/attempt ledger and a durable operator stop; per-entry DOCX/PDF editions use a dedicated private Blob store not yet provisioned."
canonical: true
cataloged: 2026-09-12
owner: product-engineering
last_verified: 2026-09-13
related:
  - docs/plans/VIRTUAL_REVIEW_PANEL_PHASE_A_BUILD_PLAN_2026-09-12.md
  - docs/VIRTUAL_REVIEW_PANEL.md
  - lib/db/migrations/047_review_panel.sql
  - lib/services/review-panel-store.js
  - lib/services/review-panel-storage.js
---

# Postgres Review Panel

**[VERIFIED 2026-09-13 via `scripts/apply-migrations.js` output (owner-run: `047_review_panel.sql` apply ok, 45 skipped) and `vercel env ls`]** These five tables exist in the production database since 2026-09-13; the code landed on `main` via PR #281 (merge bbef47ac). The feature is enabled in Production in smoke mode with a four-request allowlist; the drain cron runs per minute (fb6a911a). No launch, generation, or edition had run against live data as of the cron deploy.

| Table | Owner / scope | Stored state | Retention and write contract |
|---|---|---|---|
| `review_panels` | `owner_profile_id`, one panel per owner | Current private selection (`selection` JSONB) | Upserted for the owner via `createReviewPanel`/`saveReviewPanelSelection`; private app state, no cycle scope (D5) |
| `review_panel_runs` | `owner_profile_id`, linked panel | One global worker lease (`lease_token`/`locked_until`) per active run; `data` JSONB holds the pinned config snapshot (`snapshotConfiguration`), `pendingEntries` (input DTOs awaiting worker materialization), `failures` (requests that could not be prepared at launch), `reservation` (a bound only, D6), and `error` | `status` enum: `queued → running → completed \| partial \| failed`, plus operator `cancelled` and a reserved `paused` value not yet used by this foundation slice; `requestReviewPanelRetry`/`requestReviewPanelCancel` require the run to be SETTLED (no `lease_token` AND status not in `queued`/`running`) before mutating it from the route — mirrors `cycle_dossier_runs`' `mutateDossierRun` settle check |
| `review_panel_entries` | Shared request entry, `created_by` attribution | Per-request-revision JSONB `data` (`input`: the frozen narrative DTO — see deviation note below — plus `chairResult`/`files`/`error` once settled; on a report-save failure `reportError: { name, message (≤300 chars), at }` also carries the raw throw for diagnosis, alongside the generic user-facing `error` copy); `winners_json` maps `{ seatKey: attemptId }`; `retry_requested_at` is the route→worker retry hand-off marker | `status` enum: `pending → running → completed \| failed`; unique `(request_id, request_revision)`; `retry_requested_at` is set only by `requestReviewPanelRetry` (route, no lease) and cleared only by `mutateReviewPanelEntry` (worker, under lease) in the SAME update that changes status — see hand-off note below |
| `review_panel_seat_attempts` | `entry_id`, one paid call per `(entry_id, seat_key, attempt_no)` | Per-seat/chair ledger row: `dispatch_token` (immutable once set), `lease_token`, `dispatched_at`/`dispatch_expires_at`, `provider`/`model`, `prompt_snapshot_json`, `result_json`/`late_result_json`, `usage_json`/`late_usage_json`, `cost_cents`/`cost_state`, `error_text` | `state` enum: `pending → dispatched → completed \| failed \| unknown_outcome`; exactly five writers (see fence note below); `cost_state` enum `known`/`unknown`, CHECK-enforced that `known` never has a NULL `cost_cents` |
| `review_panel_control` | Singleton operator control row | Durable global stop signal, reason, operator, and update time | Created with `stop_requested=false`; the superuser operator action (`setReviewPanelOperatorStop`) sets the stop; `assertReviewPanelWorkerOpen` re-reads it before every paid call |

## Two lease fences (§5 A.5)

1. **Run-state changes** (creating an entry or attempt, dispatching, reaping expired attempts, selecting winners, materializing pending entries, finalizing the run's terminal status) require the run's **CURRENT worker lease** — the run row is locked `FOR UPDATE` and its `lease_token`/`locked_until` checked in the same transaction as the write (`assertCurrentLease`, mirrors `cycle-dossier-store.js`'s `mutateDossierRun`).
2. **Attempt finalization** (`finalizeAttempt`) is a single compare-and-set on the attempt's OWN `dispatch_token` plus `dispatch_expires_at`, decided on `clock_timestamp()` (never `now()`, which is transaction-frozen), so a finalizer transaction that begins before expiry but reaches its `UPDATE` after expiry cannot land `completed` — it falls through to the late path, which can only ever set `unknown_outcome`. The reaper (current-lease holder) moves stale `dispatched` attempts to `unknown_outcome`; neither is ever retried automatically.

## `winners_json` deviation from the ledger's own ordering

`review_panel_entries.winners_json` is a JSONB map (`{ seatKey: attemptId }`), not a join table or an array — deliberately, because the cardinality is fixed and small (one row per configured seat plus the chair, from `shared/config/reviewPanelSeats.js`). `selectWinners` is its ONLY writer, chosen under the run's current lease as the single `completed` attempt per seat with the highest `attempt_no`; `mutateReviewPanelEntry` (used for every other entry mutation, including completion and retry-marker clearing) never rewrites this column, so a concurrent `selectWinners` merge can never be clobbered by a stale in-memory copy elsewhere.

## Retry hand-off (route has no lease, worker does)

`createReviewPanelEntry` and `retryFailedEntries` both require the run's current lease, which a route request never holds. Two consequences: (1) `launchReviewPanel` (`lib/services/review-panel-service.js`) cannot create `review_panel_entries` rows itself — it resolves each selected request's narrative DTO once at launch and parks it in `review_panel_runs.data.pendingEntries`; the worker's `materializePendingEntries` (`lib/services/review-panel-worker.js`) creates the real entry rows under its own lease on the next claim, idempotently (an entry is only created for a `requestId` with no existing entry row for that run). (2) an operator "Retry failed entries" request (`requestReviewPanelRetry`) can only mark `review_panel_entries.retry_requested_at` and requeue the run — the worker's `drainReviewPanels` reads `listRetryRequestedEntries` under its lease, calls the existing `retryFailedEntries`, and `mutateReviewPanelEntry` clears the marker in the SAME update that flips the entry back to `running`.

## Cost columns and the daily/admin ledgers

`review_panel_seat_attempts.cost_cents`/`cost_state` are the only cost columns; `sumAttemptCosts` (and the mirrored SQL in `pages/api/cron/spend-check.js` and `pages/api/admin/stats.js`) sums ONLY `cost_state='known'` rows and counts `unknown` rows separately — an `unknown`-state attempt's cost is NEVER folded into a total, and any report/UI surface with `unknownCount > 0` withholds the total entirely rather than showing a number that silently excludes it. The Review Panel never writes `api_usage_log`; its own ledger is the sole source for both the daily spend-check cron and the admin stats `reviewPanel` block.

## Entry input storage vs. Blob (D11)

The entry's narrative input DTO (requestId/requestNumber/narrative text+hash+sourcePath/institution/title — `lib/services/review-panel-input.js`'s exact key allowlist) is stored in Postgres JSONB (`review_panel_entries.data.input`), not Blob — this differs from the Cycle Dossier, which persists its frozen input as a Blob JSON object. Only the per-entry DOCX/PDF report editions (rendered once, at entry completion, by the worker) use the dedicated private Blob store (`REVIEW_PANEL_BLOB_READ_WRITE_TOKEN`/`REVIEW_PANEL_BLOB_STORE_ID`, **not yet provisioned** — `docs/CREDENTIALS_RUNBOOK.md`); their SHA-256/size/path refs are persisted on `review_panel_entries.data.files`. If storage is unconfigured or the write fails, the entry is FAILED rather than silently completed with no saved report (the chair's structured result is preserved on `data.chairResult` for visibility).

## Current lifecycle truth

- **Source-built:** migration 047, the fresh-install v49 block (schema-parity tested), and full service/worker/route/page contracts exist on the current branch.
- **Provisioned 2026-09-13:** the dedicated private Blob store `wmkf-review-panel-private` (`store_cwVLLxRMR3A8NFA2`) is connected under the `REVIEW_PANEL_BLOB` prefix in Production and Preview; `REVIEW_PANEL_ENABLED=true`, `REVIEW_PANEL_ROLLOUT_MODE=smoke`, and a four-request `REVIEW_PANEL_REQUEST_ALLOWLIST` are set in Production.
- **Applied 2026-09-13:** migration 047 is applied to the production database; prompts `review-panel.seat` v1 and `review-panel.chair` v1 are published in Dataverse. First smoke launch pending at the time of writing.
