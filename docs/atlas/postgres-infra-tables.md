# Atlas: Postgres infrastructure tables (compact)

**Last verified (schema sources):** 2026-08-23. **Row counts re-probed:** 2026-05-25 via `scripts/audit-postgres-state.js`. Operational/log tables drift continuously; treat counts as "last observed" snapshots, not invariants.

Compact summary for the Postgres tables outside the reviewer-finder domain. Promote any of these to its own page on next significant touch.

## Identity / authn / app access

### `user_profiles` (9 rows)
**Source of truth:** Postgres.
**Schema:** identity bridge (`azure_id`, `azure_email`, `dynamics_systemuser_id`, `is_active`, role).
**Read paths:** NextAuth callbacks, `requireAuth*` helpers, the admin dashboard,
identity reconciliation, and authenticated application services. The exact
caller count is intentionally not frozen in this mutable catalogue.
**Write paths:** NextAuth signin upsert, admin grant/revoke, and identity
reconciliation.
**Cross-system:** `dynamics_systemuser_id` joins to Dataverse `systemusers.systemuserid`. See `lib/services/dataverse-identity-map.js`.
**Migration:** Wave 1 dispatch flag `WAVE1_BACKEND_*` exists but identity stays Postgres for now.

### `user_app_access` — RETIRED 2026-05-12 (was Postgres / now Dataverse-only)
**Source of truth:** **Dataverse `wmkf_appuserappaccesses`**. Postgres table dropped via migration `007_drop_wave1_tables.sql` on 2026-05-12 after 9 days of empirically zero prod writes since the 2026-05-03 flag flip.
**Live adapter:** `lib/services/dataverse-app-access-service.js`.
`lib/services/app-access-service.js` routes unconditionally to Dataverse; the
former Postgres branch is removed and `WAVE1_BACKEND_APP_ACCESS=postgres` fails
loud at module load.
**Schema:** `(user_profile_id, app_key)` unique grant rows.
**Recovery:** Neon PITR window 7 days; restore prod branch to ~2026-05-12T01:25Z if needed.

### `user_preferences` — RETIRED 2026-05-12 (was Postgres / now Dataverse-only)
**Source of truth:** **Dataverse `wmkf_appuserpreferences`**. Postgres table dropped via migration `007_drop_wave1_tables.sql` on 2026-05-12.
**Live adapter:** `lib/services/dataverse-prefs-service.js`.
`lib/services/database-service.js` routes preference methods unconditionally
to Dataverse; the former Postgres preference branch is removed and
`WAVE1_BACKEND_PREFS=postgres` fails loud at module load.
**Encryption:** values AES-256-GCM when `is_encrypted = true`.

### `system_settings` — RETIRED 2026-05-12 (was Postgres / now Dataverse-only)
**Source of truth:** **Dataverse `wmkf_appsystemsettings`**. Postgres table dropped via migration `007_drop_wave1_tables.sql` on 2026-05-12. Final reconciliation on 2026-05-11 synced 10 tier-keyed `model_override:*` rows from S145 dev writes (PG→DV); counts matched (45/45) before the drop.
**Live adapter:** `lib/services/dataverse-settings-service.js`.
`lib/services/settings-service.js` routes unconditionally to Dataverse; the
former Postgres branch is removed and `WAVE1_BACKEND_SETTINGS=postgres` fails
loud at module load.
**Schema:** generic key-value (model overrides, feature flags, etc.).

## Dynamics Explorer state

### `dynamics_query_log` (1,417 rows)
**Source of truth:** Postgres-only.
Per-tool-execution/denial log (NL → tool plan → result). Migration 033 added
nullable `request_id` and one-based `request_round` without changing that unit
of meaning or historical rows. The Explorer chat writer falls back to the
legacy insert if code arrives before the additive migration. **[VERIFIED
2026-08-21 via source/tests, Production migration/schema readback, and one
correlated smoke tool row.]**

### `dynamics_explorer_requests` (Production-live; one release-smoke row observed 2026-08-21)
**Source of truth:** Postgres-only.
One mutable lifecycle row per authenticated, body-valid Explorer chat request.
Outcomes are `running`, `completed`, `truncated`, `max_rounds`, `refused`,
`error`, and `client_disconnected`; a `running` row older than ten minutes is
reported as derived `abandoned` and is not rewritten. The table stores bounded
operational metadata only—no prompt, answer, tool output, query text, or raw
error. Start and terminal compare-and-set writes are awaited but fail-soft
toward the answer. Daily maintenance retains rows for the query-log window
(default 365 days). **[VERIFIED 2026-08-21 via migration 033, fresh-install
schema, service/route tests, Production tracker/schema readback, and completed
request `84aee86d-9c89-4434-9642-47ee6ccb4141`.]**

### `dynamics_feedback` (5 rows; targeted re-probe 2026-08-08)
**Source of truth:** Postgres-only.
Thumbs up/down + auto-detected failures. The first successful admin Review or
Resolve action stamps `reviewed_at` as the canonical acknowledgement time
without restarting it on later status changes. Daily maintenance deletes acknowledged
rows 20 days after that timestamp; rows with no acknowledgement are ineligible
regardless of status or creation age. The 2026-08-08 aggregate-only production
probe found five rows, all resolved, acknowledged, and older than 20 days from
acknowledgement, so all five are eligible on the next cron run.
Migration 033 adds nullable `request_id` with `ON DELETE SET NULL`. The POST
path accepts a client request ID only as correlation evidence: it persists the
link only when the row belongs to the authenticated profile and both request
and feedback carry the same non-null session ID; lookup failure or mismatch
still saves uncorrelated feedback. **[VERIFIED 2026-08-21 via source/tests and
Production migration/schema readback; release smoke intentionally created no
feedback.]**

### `dynamics_user_roles` (6 rows), `dynamics_restrictions` (0 rows)
**Source of truth:** Postgres-only.
RBAC scaffolding for the explorer write tools. Restrictions table is empty; a 27-script `setRestrictions`/`bypassRestrictions` migration is "deliberately deferred" per S136.

## Expertise Finder

### `expertise_roster` (38 rows), `expertise_matches` (344 rows)
**Source of truth:** Postgres.
Internal staff/consultant/board roster + per-proposal match history. Production
consumers are `pages/api/expertise-finder/{match,batch-match,roster,history}.js`;
production prompt rules live in
`shared/config/prompts/expertise-finder.js`. The isolated
`modules/expertise_matching` reference/demo has no production caller.

## Integrity Screener

### `integrity_screenings` (41 rows), `screening_dismissals` (0 rows)
**Source of truth:** Postgres.
Per-applicant screening history. `retractions` (68,248 rows) is the Retraction Watch dataset (org-wide).

### `retractions` (68,248 rows)
**Source of truth:** Postgres (manually refreshed via script — no live cron).
**Read paths (verified 2026-05-07):** `lib/services/integrity-service.js` — searches `retractions.authors_normalized` for overlap with screened applicants, falls back to text match.
**Write paths:** `scripts/import-retraction-watch.js` — DELETE all + INSERT bulk from Retraction Watch CSV. **No `/api/cron/refresh-retractions` route exists** (Atlas v1 mis-cited this).

## Virtual Review Panel

### `panel_reviews` (35 rows), `panel_review_items` (278 rows)
**Source of truth:** Postgres. V24 migration.
Multi-LLM review history. `panel_review_items` holds per-LLM responses.

## Intake Portal (pre-pilot)

### `intake_drafts` (0 rows), `intake_audit` (0 rows)
**Source of truth:** Postgres. V005 migration (May 2026); V012 rekeyed the requestless partial-unique index to be contact-scoped (S179, drain plan v7 P3); V013 added `pending_attachments JSONB` for the three-call attach dance (S184). Drafts cleared on submit; audit append-only sha256-hashed. `pending_attachments` holds in-flight uploads between `/api/intake/draft/upload-token` and `/api/intake/draft/attach` — server-managed, never overwritten by autosave (autosave's `upsertDraftJson` writes `draft_json` wholesale, preserving only `idempotency_key`). Stale entries swept by the maintenance cron at age >2h (1h Blob token expiry + 1h safety margin per docs/INTAKE_ATTACH_BUILD_SCOPING.md § A6). Built for the next cycle's Phase I intake (the June 2026 Phase II Research pilot is superseded — see `docs/SYSTEM_MODEL.md`).

### `submission_jobs` (0 rows)
**Source of truth:** Postgres. V030 migration / `009_submission_jobs.sql` (S150, 2026-05-14) → `011_submission_jobs_states.sql` (S179, 2026-05-22; drain plan v7 P0).
One row per applicant submit click (idempotency-keyed). `/api/intake/submit` INSERTs (`ON CONFLICT (idempotency_key) DO UPDATE SET attempts = submission_jobs.attempts -- no-op, lets RETURNING fire`) and returns immediately with `{jobId, requestId, status}`; on collision against a `failed`/`cancelled` row the endpoint returns 409 `previous_submission_terminal` instead. `/api/cron/drain-submissions` advances each row through the v7 state machine one step per tick: `queued → scanning → request_created → files_moved → dynamics_patched → status_flipped → completed` (terminal `failed` / `cancelled`). The single-phase pivot inserts `request_created` (drain CREATES a new `akoya_request` with the client-supplied GUID rather than attaching to an existing one); `akoya_requestnum` is captured server-side for the SharePoint folder name. Two-phase claim via `locked_until` (lease deadline) + `lease_token` UUID (stable per-claim identifier, untouched by lease renewal) protects parallel-worker correctness. `payload` is the frozen validated-draft snapshot — drain never re-reads `intake_drafts`. See `docs/INTAKE_PORTAL_DRAIN_PLAN.md` (v7) for the full state machine, error taxonomy, and recovery semantics.

### `reviewer_acceptance_jobs`
**Source of truth:** Postgres-only follow-up ledger. `024_reviewer_acceptance_jobs.sql`.
One row per reviewer acceptance timestamp (`UNIQUE (suggestion_id, accepted_at)`). `/api/external/review/[token]/respond` stages the row before a fresh Dataverse accept PATCH and returns after the PATCH commits; repeat accepts reuse/requeue the same logical job. Payload schema v2 stores the portal token encrypted (never plaintext) so the asynchronous acceptance email can include a secure `?action=decline` withdrawal link. `/api/cron/drain-reviewer-acceptances` claims ready rows with `FOR UPDATE SKIP LOCKED` + `lease_token`, re-reads `wmkf_appreviewersuggestion`, and runs the formerly-inline accept tail: honorarium/contact capture, self-reported ORCID, board identity, contact name/title sync, affiliation→empty-parent Account auto-link, residual mismatch alerts, acceptance confirmation email, and quota notification. The auto-link implementation is **live in production since 2026-08-10 (S412, merge `42abd72a`)** [VERIFIED via `origin/main`: `reviewer-acceptance-drain.js:611`, unconditional, no env/feature gate]. It uses only the accepted self-report, requires exactly one active normalized exact Account name/AKA/legal/DC-AKA target, and preserves every existing parent. Transient operational failures retry without emitting a mismatch warning; a capped/incomplete scan instead abstains without retry, creates one deduplicated operations warning, and continues the reviewer-specific mismatch check. Exact or already-correct links auto-resolve that reviewer's standing mismatch warning. Every lease-guarded step/cancel/complete/failure update must return a row; a stale-token no-op is classified as lease loss rather than completion or retry. On self-withdrawal, unlocked active jobs are cancelled; a leased worker remains retryable, re-checks Dataverse after honorarium creation, and removes any late-created linked honorarium before stopping. Drain telemetry records claimed ids plus per-outcome ids, and deployed-smoke attribution consumes only `completedJobIds`. Dataverse `wmkf_appreviewersuggestion` remains the authoritative accepted/declined state; this table records side-effect progress, retry scheduling, terminal deterministic failures, and completion. Stale `accept_pending` rows are cancelled if the Dataverse accept never landed.

### `review_synthesis_jobs` — LIVE; AUTOMATION ENABLED
**Source of truth:** Postgres generation/currentness ledger. Migration
`028_review_synthesis_jobs.sql` was applied to production at
`2026-07-28T19:25:49.479Z`. A post-apply production probe verified all 18
columns, eight constraints, and seven indexes. Production automation was
deliberately enabled after signed-in verification. The controlled Request
`1002788` smoke left two historical rows: job `1` is the terminal failed
pre-fix fingerprint (three bounded attempts, no AI run), while job `2` completed
in one attempt with AI run `1b882cf6-bf8a-f111-ab0f-7ced8d3d15a6`. Maintenance
run `27723` recorded exactly one eligible/enqueued/claimed/completed job.
Temporary review cleanup returned the live census to zero eligible requests.

One row records one manual generation or one exact automatic input fingerprint.
`input_hash` is a SHA-256 over the exact answer digest plus participating
reviewer lifecycle classifications; reviewer text is never stored. Automatic
rows use `UNIQUE dedupe_key =
automatic:<requestId>:<inputHash>`. Terminal automatic rows are not silently
reopened, preserving the three-attempt retry bound. Manual rows use a unique
generation-scoped key and start under a lease.

`/api/cron/drain-review-syntheses` is inert unless
`REVIEW_SYNTHESIS_AUTOMATION_ENABLED=true`; Production is set to exact `true`.
When enabled, it scans selected,
invited/accepted, non-excluded suggestions, fails closed if the Dataverse query
is capped, enqueues ready fingerprints, and claims a small batch using `FOR
UPDATE SKIP LOCKED`. Before loading review content or calling the shared
synthesis producer it re-reads lifecycle readiness, then revalidates the full
content fingerprint; changed inputs cancel the job. Statuses are
`queued`, `running`, `completed`, `failed`, and `cancelled`; lease, retry,
last-error, timing, and `wmkf_ai_run` id fields make work observable.
`akoya_request.wmkf_reviewsynthesisjson` in Dataverse remains the synthesis
content source of truth. PR #98 corrected the automatic Executor run-source
mapping and PR #99 closed vanished-input cancellation. Final deployment
`dpl_FdUJSjNwhbNWKWVzpyymiB2mpJo1` is Ready; a post-deploy authenticated drain
returned zero eligible/enqueued/claimed/failed.

### `pre_site_distribution_attempts` — LIVE; EMPTY; RUNTIME NOT PRODUCTION-PROVED

**Source of truth:** Postgres exact-preview and cross-system recovery ledger.
Migration `034_pre_site_distribution_attempts.sql`; mirrored in the fresh-install
setup. **[VERIFIED LIVE 2026-08-23 via canonical migration plus schema/tracker
readback]** migration 034 was applied at `2026-08-23T23:39:34.686Z`; the table
has 55 columns, eight named CHECK constraints plus its primary key, four indexes
including the primary-key index, zero rows, and no pending manifest migration.
SharePoint plus `wmkf_requestdocument` remain retained-file authority, and
Dynamics remains email-activity/transport authority.

One client operation UUID binds one Request, exact editable source Word
identity/version/governed hash/raw byte hash, attachment mode (`docx`, `pdf`, or
`both`), exact retained Word/PDF identities and byte hashes, normalized To/Cc,
subject/body/template/sender/actor, preview hash, Dynamics activity/status, and
bounded error evidence. Attachment bytes are never stored. States are
`preparing`, `prepared`, `activity_created`, `attachments_added`,
`send_requested`, and `sent`; per-kind attachment timestamps plus a lease fence
allow recovery between Word and PDF or after an ambiguous SendEmail response.
The Dynamics activity ID becomes durable before exact activity assertions, and
the same fenced lease is renewed immediately before transport; a lost renewal
cannot call `SendEmail`. Send also rejects when the current Pre-Site pointer or
native source version no longer matches the prepared attempt.
`sent_at` means Dynamics accepted or status readback proved the transport
request, not inbox delivery. Read/write paths:
`lib/services/pre-site-visit/distribution-store.js` and
`lib/services/pre-site-visit/distribution-service.js`.

**[VERIFIED IN SOURCE/TESTS AND LIVE SCHEMA 2026-08-23.]** The exact feature
commit is Ready on a branch Preview, but Azure rejects that Preview callback
with `AADSTS50011`, so authenticated feature/UI proof remains open. Production
email metadata and the tenant setting were read-only probed, and a controlled
sandbox raw-`addressused` send/readback plus repeated `SendEmail` check passed
at Dynamics transport-acceptance level. No Production distribution row,
snapshot, activity, or email was created.

## Portal upload staging

### `portal_upload_staging` (migration 031)
**Source of truth:** Postgres coordination ledger; published abstract/caption/image
authority remains Dataverse + SharePoint.

One row authorizes one private Blob pathname for one server-derived actor,
scope, and request. Statuses are `pending`, `finalizing`, `consumed`, `rejected`,
and `expired`; a five-minute lease serializes finalization. Verified Blob ETag,
SHA-256, and actual bytes are recorded before domain processing. If SharePoint
upload succeeds, `candidate_result` records the exact drive/item/image reference
before the Dataverse write, allowing an expired-lease retry to recognize a
committed response drop or delete only the exact unreferenced candidate.
`result_payload` makes consumed retries idempotent.

Write/read paths: `lib/services/portal-upload-staging.js`; external grantee mint
and submit routes; staff replacement mint and finalize routes. Raw external
tokens are never stored (SHA-256 binding only), and clients never choose or echo
an authoritative pathname. Daily maintenance deletes exact table-selected Blob
pathnames after expiry and prunes terminal ledger rows after seven days.

Private-store prerequisite is covered by
`scripts/probe-private-blob-client-access.mjs`: public-mode PUT must fail, private
PUT must succeed, and anonymous HEAD must return 403.

## Monitoring / observability

### `health_check_history` (2,964 rows), `system_alerts` (150 rows), `maintenance_runs` (1,498 rows)
**Source of truth:** Postgres-only.
Cron-driven health checks (7 services), alert log, cron audit trail. `maintenance-service.js` writes; admin dashboard reads.

### `operational_events` (0 rows at creation — migration 030 applied to production 2026-08-19)
**Source of truth:** Postgres-only.
**Schema:** durable structured operational events: `source` ('app' | 'vercel-drain'),
`environment`, `event_type`, `subsystem`, `severity`, `status`
('open'/'recovered'/'resolved'/'superseded'/'info'), redacted `summary`, `stage`,
`transient`, `request_number`, `entity_refs JSONB`, `correlation_id`,
`recovery_key`, unique-when-present `dedupe_key`, allowlisted `metadata JSONB`,
`occurrence_count`, first/last occurrence timestamps, resolution fields.
**Write paths:** `lib/services/operational-event-service.js` `recordEvent`
(best-effort, never throws) — called by the `NotificationService.notify()`
mirror (auto at error/critical, opt-in via `operationalEvent` at any severity)
and drain ingestion `lib/services/vercel-log-drain-ingest.js` via
`/api/webhooks/vercel-log-drain` (HMAC-verified, `vercel:<log id>` dedup).
Recovery: `markRecovered`/`markSuperseded` (reviewer-acceptance drain
completion/withdrawal edges; `AlertService.autoResolve` propagation).
**Read paths:** `/api/admin/operational-events` → `OperationalEventsSection`
in `pages/admin.js`.
**Privacy boundary:** summaries pass `lib/utils/log-redactor.js`; metadata is
depth/size/key-capped with a sensitive-key denylist; drain metadata is an
explicit allowlist (never clientIp/userAgent/referer/JA3/JA4/headers/bodies).
**Retention:** daily maintenance cron `cleanupOperationalEvents` — settled rows
past `retention:operational_events_days` (default 90), open rows past 2x,
hard 200k row cap.
See `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` for the full design and
activation runbook.

### `api_usage_log` (1,724 rows)
**Source of truth:** Postgres-only.
Per-Claude-call ledger (model, tokens, cost, latency, status, and nullable
provider stop reason). Migration 033 added nullable `request_id` and one-based
`request_round` for Explorer calls while all other callers and historical rows
remain null. Written by `lib/services/llm-client.js` via
`lib/utils/usage-logger.js` (`logUsage`). Not routed through `DatabaseService`.
Migration `032_api_usage_stop_reason.sql` added `stop_reason` to Production at
`2026-08-21T16:43:26.023Z`; exact readback verified a nullable
`character varying(50)` column and the migration tracker row. Historical and
failed rows may remain null. A signed-in two-round Production Explorer smoke
then created usage rows 5354/5355 with non-null `tool_use`/`end_turn` stop
reasons, proving the deployed writer-to-column path. Cost is computed locally
from `lib/utils/model-pricing.js`; rows
with an unknown model id land with `estimated_cost_cents = NULL` and are
surfaced by the weekly `pricing-canary` cron. That same cron writes a
`maintenance_runs` heartbeat and, when `CLAUDE_API_KEY` is available, compares
Anthropic `/v1/models` against the reviewed capability/pricing registries to
raise advisory `ops` alerts for newer Claude ids before runtime use.
The correlated writer has a legacy-column fallback for deployment-before-
migration ordering. **[VERIFIED 2026-08-21 via source/tests, Production
migration/schema readback, and two correlated smoke usage rows across rounds
1–2.]**

### `model_pricing_audit` (S181, V032)
**Source of truth:** Postgres-only.
Append-only history written by `/api/cron/pricing-refresh` (monthly, 1st of month). One row per (model, token_type) probed: stores Anthropic's authoritative cost from `/v1/organizations/cost_report`, our summed `api_usage_log` token count for the same window, the derived per-MTok price, the local table's price, and the delta. `flagged = true` rows are >5% out of tolerance and have triggered an `ops` alert. Backstop for the manually-maintained `lib/utils/model-pricing.js` table — the cron alerts; humans edit the table; no auto-overwrite. Requires `ANTHROPIC_ADMIN_API_KEY`.

### `external_rate_limit` (0 rows)
**Source of truth:** Postgres-only. V031 migration / `010_external_rate_limit.sql` (S173, 2026-05-21, security audit A6).
Fixed-window (60s) rate-limit counters for the public external-reviewer token routes `/api/external/review/[token]/*`. Two bucket scopes share the table, discriminated by the `bucket_key` prefix: `tok:<sha256(jwt)>` (per-token) and `ip:<addr>` (per-IP). `invalid_count` tracks per-IP token-verification failures and feeds an invalid-token-spike `system_alerts` entry. Written + read by `lib/external/rate-limit.js` (`checkRateLimit`, `recordTokenOutcome`); expired windows pruned opportunistically on write. Postgres-backed (not in-memory) because Vercel Fluid Compute spreads requests across instances. Fail-open: a DB error allows the request rather than locking out a reviewer; a sustained run of limiter DB failures raises a deduplicated degraded-limiter `system_alerts` entry so the silently-disabled state is visible.

### `bill_webhook_events` (0 rows)
**Source of truth:** Postgres-only. `015_bill_webhook_events.sql` (S188, 2026-05-25).
Dedup gate for BILL.com webhook deliveries at `/api/webhooks/bill`. Compound `UNIQUE (subscription_id, event_id)` constraint backs an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING id` check-and-insert — a returned id means first delivery, no row means BILL is retrying. Compound key is defensive against BILL's `eventId` uniqueness scope not being formally documented across subscriptions. Daily maintenance deletes rows where `received_at < NOW() - INTERVAL '7 days'` (TTL comfortably exceeds any plausible BILL retry horizon). See `docs/BILL_LIB_DESIGN.md` v3.

### `bill_onboarding_state` (0 rows — pre-launch)
**Source of truth:** Postgres-only. `017_bill_onboarding_state.sql` (S199, 2026-05-29). Design: `docs/BILL_CHUNK_4_DESIGN.md` Thread 3.
Durable state for the BILL honorarium onboarding flow (`lib/bill/onboard-reviewer-service.js`), one row per honorarium `akoya_request` (PK `honorarium_request_id`). Closes the three S198 P1s (`docs/REVIEWER_BILL_HARDENING_FINDINGS.md`): the row is RESERVED (`INSERT ... ON CONFLICT DO NOTHING RETURNING`) **before** `createBillVendor` so a concurrent second caller loses the PK race and never reaches BILL; `vendor_id` is written the instant the vendor is created, **before** the contact `wmkf_billcomid` PATCH, so a failed contact PATCH can't lose it (→ no duplicate vendor on retry); `dynamics_pending` is the torn-state marker (BILL side done, `akoya_request` writeback still owed) that the daily `MaintenanceService.sweepBillOnboarding` resumes idempotently (`pending_match` true → write PNI + "Yes"; false → "No"; **NULL → sweep fails closed, never defaults to "No"**). Written/read by `lib/bill/onboarding-state.js`. TTL: completed (`dynamics_pending = false`) rows pruned after 30 days by `MaintenanceService.cleanupBillOnboardingState`.
