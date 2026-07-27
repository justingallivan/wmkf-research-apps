# Atlas: Postgres infrastructure tables (compact)

**Last verified (schema):** 2026-05-07. **Row counts re-probed:** 2026-05-25 via `scripts/audit-postgres-state.js`. Operational/log tables drift continuously; treat counts as "last observed" snapshots, not invariants.

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
Per-query log (NL → tool plan → result). Used by feedback flow.

### `dynamics_feedback` (2 rows)
**Source of truth:** Postgres-only.
Thumbs up/down + auto-detected failures.

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
One row per reviewer acceptance timestamp (`UNIQUE (suggestion_id, accepted_at)`). `/api/external/review/[token]/respond` stages the row before a fresh Dataverse accept PATCH and returns after the PATCH commits; repeat accepts reuse/requeue the same logical job. Payload schema v2 stores the portal token encrypted (never plaintext) so the asynchronous acceptance email can include a secure `?action=decline` withdrawal link. `/api/cron/drain-reviewer-acceptances` claims ready rows with `FOR UPDATE SKIP LOCKED` + `lease_token`, re-reads `wmkf_appreviewersuggestion`, and runs the formerly-inline accept tail: honorarium/contact capture, self-reported ORCID, board identity, contact name/title sync, mismatch alerts, acceptance confirmation email, and quota notification. Every lease-guarded step/cancel/complete/failure update must return a row; a stale-token no-op is classified as lease loss rather than completion or retry. On self-withdrawal, unlocked active jobs are cancelled; a leased worker remains retryable, re-checks Dataverse after honorarium creation, and removes any late-created linked honorarium before stopping. Drain telemetry records claimed ids plus per-outcome ids, and deployed-smoke attribution consumes only `completedJobIds`. Dataverse `wmkf_appreviewersuggestion` remains the authoritative accepted/declined state; this table records side-effect progress, retry scheduling, terminal deterministic failures, and completion. Stale `accept_pending` rows are cancelled if the Dataverse accept never landed.

## Monitoring / observability

### `health_check_history` (2,964 rows), `system_alerts` (150 rows), `maintenance_runs` (1,498 rows)
**Source of truth:** Postgres-only.
Cron-driven health checks (7 services), alert log, cron audit trail. `maintenance-service.js` writes; admin dashboard reads.

### `api_usage_log` (1,724 rows)
**Source of truth:** Postgres-only.
Per-Claude-call ledger (model, tokens, cost, latency). Written by `lib/services/llm-client.js` via `lib/utils/usage-logger.js` (`logUsage`). Not routed through `DatabaseService`. Cost is computed locally from `lib/utils/model-pricing.js`; rows with an unknown model id land with `estimated_cost_cents = NULL` and are surfaced by the weekly `pricing-canary` cron. That same cron writes a `maintenance_runs` heartbeat and, when `CLAUDE_API_KEY` is available, compares Anthropic `/v1/models` against the reviewed capability/pricing registries to raise advisory `ops` alerts for newer Claude ids before runtime use.

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
