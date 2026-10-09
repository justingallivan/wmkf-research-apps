# Atlas: Postgres infrastructure tables (compact)

**Last verified (schema sources and Production probes):** 2026-10-05. Migration 060 and the `materials_upload_jobs` table plus `portal_upload_staging.background_job_id` were verified in Production; see the dated section below. Migration 067 schema and one prepared-receipt readback are recorded below. **Row counts re-probed:** 2026-05-25 via `scripts/audit-postgres-state.js`, except the distribution ledger, Staff Deliberations receipt, and explicitly dated migration readbacks below. Operational/log tables drift continuously; treat counts as "last observed" snapshots, not invariants.

Compact summary for the Postgres tables outside the reviewer-finder domain. Promote any of these to its own page on next significant touch.

## Staff Deliberations preparation — Production deployed; automation disabled

### `staff_deliberations_preparations`
**Source of truth:** Operational receipt in Postgres; Dataverse Request Document lineage and SharePoint bytes remain authoritative for the working writeup.
**Schema:** Migration 067; unique request/Site Visit/scheduled-end/correction-epoch identity, pending/running/prepared/blocked state, bounded lease and retry schedule, exact document ID, service provenance, and bounded error fields.
**Read/write paths:** `lib/services/pre-site-visit/preparation-store.js` and `preparation-worker.js`; authenticated retry route under `/api/workbench/pre-site-visit/retry-preparation`; cron route `/api/cron/staff-deliberations-preparation` (scheduled every 15 minutes in `vercel.json` since 2026-10-06; it does work only while `STAFF_DELIBERATIONS_AUTO_PREPARE=on` and the allowlists pass); owner-run exact-Factory one-shot `scripts/run-staff-deliberations-factory-test.mjs`.
**Readiness:** [PRODUCTION-LIVE via PR #432 (`d8c658b2e`), deployed 2026-10-05 as Ready deployment `dpl_1392m7UkCfPGuSqMDGBfHeq35rzH`; migration 067 applied at `2026-10-05T21:15:31.072Z` and schema-verified: 22 columns, four indexes, seven constraints; no migrations pending.] The real worker prepared one receipt for marked TEST Request `1003313`; its idempotent rerun produced no duplicate. Production’s observed Site Visit state/status map is configured, but automatic-enablement flags and worker allowlists remain unset; no deployment schedule is registered. The worker is therefore not active in normal production traffic. The bounded one-shot and manual workflow acceptance are recorded in the Staff Deliberations plan; they do not prove scheduled delivery or latency.

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

### `expertise_roster` (39 rows), `expertise_matches` (344 rows)
**Source of truth:** Postgres.
Internal staff/consultant/board roster + per-proposal match history. Production
consumers are `pages/api/expertise-finder/{match,batch-match,roster,history}.js`;
production prompt rules live in
`shared/config/prompts/expertise-finder.js`. The isolated
`modules/expertise_matching` reference/demo has no production caller.
Migration 035 added nullable normalized `preferred_email`. Migration 050 is
**[PRODUCTION-LIVE 2026-09-14; applied and read back]** and adds nullable
`dataverse_contact_id UUID` plus a partial unique index permitting only one
active roster row per Contact. For an unlinked Board/Consultant row, the Site
Visit recipient directory continues to use `preferred_email`. For a linked row,
it resolves the active Contact's current `emailaddress1`; a missing, inactive,
or email-less Contact yields no email and never falls back to the manual copy.
The Expertise Finder editor is the interactive link writer, and
`scripts/link-roster-contacts.js` is a dry-run-first owner-operated backfill.
The immutable roster row ID remains the external recipient identity; names and
email addresses are never join keys. **[HISTORICAL LIVE SNAPSHOT 2026-08-24:
migration-035 column exact; zero preferred-email values before staff population.]**
**[PRODUCTION SNAPSHOT 2026-09-14 local / 2026-09-15 UTC:]** 39 roster rows;
9 active Board (4 linked), 26 active Consultants (6 linked), and 4 active
Research Program Staff. Five Board rows are owner-deferred as a non-blocking
future-cycle reconciliation; see the roster Contact-link plan F5.

## Integrity Screener

### `integrity_screenings` (41 rows), `screening_dismissals` (0 rows)
**Source of truth:** Postgres.
Per-applicant screening history. `retractions` (68,248 rows) is the Retraction Watch dataset (org-wide).
**Request linkage/history:** Migration 056 adds nullable `request_id UUID` plus
the `idx_integrity_screenings_request_latest` partial index for newest-first
lookup. The Workbench integrity service reads the request's PI/Co-PI identities
from Dataverse and saves completed runs with this request ID. GET returns the
latest linked run plus newest-first history pages of 20, with an optional
request-scoped `beforeRunId` cursor. Each history row includes append-only PD
review decisions from `integrity_screening_reviews`. **[LIVE since 2026-09-30: PR #366 merged as `fdaec0b1f` and deployed to Production; migrations 056–057 applied and schema-verified the same day; production read-only smoke passed (S552)]**
Existing standalone/manual runs remain
request-unlinked. The standalone screener's history, detail, status-update and
dismiss paths (`lib/services/integrity-service.js`) filter to
`request_id IS NULL`, so Workbench runs are reviewed only through
`integrity_screening_reviews`. These filters make migration 056 a prerequisite
for the standalone screener as well as the Workbench routes. The fresh-install
schema includes both migrations.

**Blocking release order for PR #366:** before this branch is deployed,
migrations 056 and 057 must be applied in order to the shared Postgres database
with `node scripts/apply-migrations.js`, then verified with a read-only schema
probe. The probe must confirm both `schema_migrations` tracker rows and the
physical schema: nullable UUID `integrity_screenings.request_id`,
`idx_integrity_screenings_request_latest`, the
`integrity_screening_reviews` table with its foreign keys and decision/notes
constraints, and both review-history indexes. Do not deploy on tracker rows
alone, and do not add runtime column detection or a legacy-query fallback; the
schema probe is the release gate. **Gate passed 2026-09-30 (S552):** 056 and 057
were applied by the owner (`applied_by` `owner-s552-pr366`), and a read-only
probe confirmed both tracker rows, the nullable UUID column, all three indexes,
and the review table's primary key, both foreign keys and three CHECK
constraints. `tests/integration/integrity-screening-reviews.pg.test.js` proves
the same constraints in a scratch schema.

### `integrity_screening_reviews` — LIVE (migration 057 applied 2026-09-30; 0 rows at apply)
**Source of truth:** Postgres append-only review history, keyed to one
`integrity_screenings` run and its Dataverse request GUID. Migration 057 stores
server-resolved reviewer profile and Dynamics user identity, decision
(`approved` or `hold`), notes (maximum 2,000 characters; hold requires a
non-empty note), and creation time. The request ID is stored for request-scoped
history; the service verifies request ownership before appending and reading
decisions. Indexes support newest-first request and screening reads.

**Write/read paths:** `pages/api/workbench/integrity/[requestId]/review` appends
through `lib/services/workbench/integrity-service.js`; only the request's lead
Program Director or a fresh-role superuser can submit. The GET context returns
the latest review summary and per-screen historical decisions. Only the latest
screen is actionable. Approval requires the latest screened roster to match
the live request roster and source coverage version 1 with all sources searched
and no errors. A recorded approval means the integrity review is complete; it
does not authorize funding or gate later workflow progression. **[LIVE since 2026-09-30: PR #366 merged as `fdaec0b1f` and deployed; migration 057 applied and schema-verified (S552)]**

### `retractions` (68,248 rows)
**Source of truth:** Postgres (manually refreshed via script — no live cron).
**Read paths (verified 2026-05-07):** `lib/services/integrity-service.js` — searches `retractions.authors_normalized` for overlap with screened applicants, falls back to text match.
**Write paths:** `scripts/import-retraction-watch.js` — DELETE all + INSERT bulk from Retraction Watch CSV. **No `/api/cron/refresh-retractions` route exists** (Atlas v1 mis-cited this).

## Virtual Review Panel (legacy, retired 2026-10-04)

### `panel_reviews` (35 rows), `panel_review_items` (278 rows)
**Source of truth:** Postgres. Migration `003_virtual_review_panel.sql`.
Legacy multi-LLM review history. The app and its only writer (`panel-review-service.js`) were archived to `_archived/` in S573; rows are retained as history with no live reader or writer. `panel_review_items` holds per-LLM responses.

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

### `pre_site_distribution_attempts` — LIVE; CALENDAR/MATERIAL PRODUCTION-PROVED

**Source of truth:** Postgres exact-preview and cross-system recovery ledger.
Migrations `034_pre_site_distribution_attempts.sql` and
`035_site_visit_logistics.sql`; mirrored in the fresh-install setup.
**[VERIFIED LIVE 2026-08-25 via canonical migrations, schema/tracker readback,
and approved base plus calendar/material sends]** migration 034 was applied at
`2026-08-23T23:39:34.686Z`; migration 035 was applied at
`2026-08-24T20:23:13.965Z`. The table has 66 columns, including the 11 additive
calendar/Site Visit/material-link fields, sent base and calendar/material proof
rows, and no pending manifest migration. The migration-035
calendar/hash/material constraints and columns read back exact.
SharePoint plus `wmkf_requestdocument` remain retained-file authority, and
Dynamics remains email-activity/transport authority.

**[VERIFIED LIVE 2026-09-16 — migration 052 applied to the shared Production/Preview database by the owner via `node scripts/apply-migrations.js` (tracker `applied_at` 2026-09-17T03:59:31Z); readback exact: five nullable columns, both CHECK constraints, 14 pre-existing attempt rows all satisfy the constraints]** Migration
`052_pre_site_distribution_brief_inputs.sql` (Pre-RP Brief plan §3.4b, slice 4)
adds five nullable audit columns — `input_fingerprint_generated CHAR(64)`,
`input_fingerprint_live CHAR(64)`, `stale_inputs_delta JSONB`,
`stale_inputs_acknowledged_at TIMESTAMPTZ`, `stale_inputs_acknowledged_by UUID` —
and two CHECK constraints, `pre_site_distribution_brief_fingerprint_shape` and
`pre_site_distribution_brief_inputs_coherence` (legacy all-NULL rows satisfy both;
an acknowledged-drift row requires both fingerprints, a differing pair, an object
delta, and both acknowledgement fields). Mirrored byte-for-byte in
`scripts/setup-database.js`; the parity test compares the real CHECK bodies.
Written by `distribution/prepare.js` (entered through the `distribution-service.js` compatibility facade) when staff acknowledge drift; read
by `briefing-page-service.js` as the timestamp-only `staffAcknowledgedNewerInputs`.

**[VERIFIED LIVE 2026-09-17 — migration 053 applied to the shared Production/Preview database by the owner-authorized `node scripts/apply-migrations.js` run (tracker `applied_at` 2026-09-17T13:57:15Z); readback exact: ten nullable columns, both CHECK constraints, 17 pre-existing attempt rows all satisfy the constraints]**
Migration `053_pre_site_distribution_review_bundle.sql` (plan §11, Step C1)
adds ten nullable columns retaining the "every review" PDF bundle assembled at
Share (prepare) time — `review_bundle_document_id TEXT`,
`review_bundle_drive_id TEXT`, `review_bundle_item_id TEXT`,
`review_bundle_version_id TEXT`, `review_bundle_filename TEXT`,
`review_bundle_size INTEGER`, `review_bundle_byte_hash CHAR(64)`,
`review_bundle_set_fingerprint CHAR(64)`, `review_bundle_review_count INTEGER`,
`review_bundle_rebuilt_at TIMESTAMPTZ` — and two CHECK constraints,
`pre_site_distribution_review_bundle_shape` (both hashes NULL or lowercase
hex64) and `pre_site_distribution_review_bundle_coherence` (legacy all-NULL
rows satisfy it; a prepared review-bundle attempt requires the document/drive/
item/filename/byte-hash/set-fingerprint identity plus `review_count >= 1`;
`version_id` and `size` are metadata, not part of the coherence check).
Mirrored byte-for-byte in `scripts/setup-database.js` (`v54Statements`); the
parity test compares the real CHECK bodies. The bundle sits beside the brief
PDF snapshot as a governed `wmkf_requestdocument` row
(producer `request-workbench-distribution-review-bundle`), created through
`ensureSnapshot` and retained via
`lib/services/pre-site-visit/review-bundle-service.js` / `distribution/retained-snapshot.js` `retainReviewBundle`
(also exported by the `distribution-service.js` compatibility facade). The nine identity columns are written by
`distribution/prepare.js` (`recordDistributionPrepared`, entered through the facade) at Share
time; `review_bundle_rebuilt_at` stays NULL there. **[SOURCE-BUILT
2026-09-16 on `claude/pre-rp-brief-review-bundle`; deployment pending; plan
§11, Step C2]** The same nine columns plus `review_bundle_rebuilt_at` are
rewritten by `recordReviewBundleRebuilt` (`distribution-store.js`, guarded
`WHERE state = 'sent'`), called from `briefing-page-service.js`
`resolveBriefingMember`'s `review-bundle` member on read, only when a
fingerprint over the live received review set no longer matches
`review_bundle_set_fingerprint` [VERIFIED via
lib/services/deliberation-briefing/briefing-page-service.js and
lib/services/pre-site-visit/distribution-store.js `recordReviewBundleRebuilt`].

One client operation UUID binds one Request, exact editable source Word
identity/version/governed hash/raw byte hash, attachment mode (`none` for every
attempt prepared since 2026-09-10, migration 039, the email carrying the
briefing page link instead; `docx`, `pdf`, or `both` remain on earlier rows),
exact retained Word/PDF identities and byte hashes (pinned on every prepared row
regardless of mode because the briefing page serves them), the deliberation-session
snapshot the email states (`session_snapshot`, migration 040; null = not yet scheduled;
rechecked live at send), normalized To/Cc,
subject/body/template/sender/actor, preview hash, Dynamics activity/status, and
bounded error evidence. Attachment bytes are never stored. States are
`preparing`, `prepared`, `activity_created`, `attachments_added`,
`send_requested`, and `sent` (a `none` row skips `attachments_added`); per-kind
attachment timestamps plus a lease fence
allow recovery between Word and PDF or after an ambiguous SendEmail response.
The Dynamics activity ID becomes durable before exact activity assertions, and
the same fenced lease is renewed immediately before transport; a lost renewal
cannot call `SendEmail`. Send also rejects when the current Pre-Site pointer or
native source version no longer matches the prepared attempt.
Migration 035 additionally binds optional governed material-link snapshots and
one informational calendar attachment to the same exact preview: Site Visit
ID/ETag/snapshot, deterministic ICS filename/type/hash/size, material-link
JSON, and a separate calendar attachment receipt. Calendar-enabled attempts
cannot advance past attachment recovery without that receipt. The calendar is
rebuilt from the stored bounded snapshot and byte-hash checked before send;
selected links and the live Site Visit ETag are re-resolved under the lease.
`sent_at` means Dynamics accepted or status readback proved the transport
request, not inbox delivery. Read/write paths (**Stages 1–8 owner paths deployed via PR #315 `8d3ad3a7670220f09ebd7828bfd7ea14d2ac3942`, deployment `6535352663`; persistence authority and migration facts below are unchanged**):
`lib/services/pre-site-visit/distribution-store.js`,
`distribution/prepare.js`, `send.js`, `history.js`, and `email-recovery.js`
(entered through the `distribution-service.js` compatibility facade).
Migration 038 **[PLANNED, not applied]** adds nullable `briefing_link_id`
(the `deliberation_briefing_links.id` an exact preview carried; send refuses
when that link is no longer live). The column is only named by a separate
UPDATE that runs when `DELIBERATION_BRIEFING_SCHEMA_READY=on`, so an
environment without the migration behaves exactly as before.

**[PRODUCTION-PROVED 2026-08-24.]** Request `1002379`, PDF-only operation
`85f52fc5-fb48-4ceb-84d6-0f246af0b6fb`, moved through `prepared` to `sent` in
one attempt. It references retained Ready/Board Ready DOCX and PDF rows; the
selected PDF is 133,265 bytes with SHA-256
`574ac7b833801866c370a8056b7197933addfe3ea5dd535dcf4d29803c18f0c9`.
Dynamics activity `33ce6346-d89f-f111-b8db-6045bd07a06d` read back Sent with
sender/To `jgallivan@wmkeck.org`, `createdBy` matching the authenticated actor,
and exactly one matching attachment. Workbench history showed the transport
receipt and a bounded Production error-log scan was clean. Dynamics appended
its CRM tracking token to the final stored subject after transport acceptance;
inbox delivery is not independently verified.

**[PRODUCTION-PROVED 2026-08-25.]** Request `1002379` operation
`f497643a-2e9e-4032-a323-1e40874d16f1` reached `sent` with
`calendar_enabled=true`, `material_count=1`, saved Site Visit
`11b41d73-02a0-f111-b8dc-6045bd018a07`, no final error, and
`sent_at=2026-08-25T15:51:00.440Z`. Earlier `prepared` attempts with
`distribution_material_stale` remain diagnostic evidence of the JSONB
object-key-order defect fixed in commit `f5b7efc2`; they are not additional
sends. This receipt proves Dynamics transport acceptance, not independent
inbox/calendar-client delivery.

### `final_writeup_handoff_emails` — PRODUCTION-LIVE; MIGRATION 072 APPLIED

**[PRODUCTION-LIVE: PR #456, merge `8bc5b466b`, 2026-10-07; migration 072 applied; copy seeded; Production list = Research `c247b11a-a7cb-ee11-9078-000d3a341e8f` only; first real send not yet observed. Production schema read back 2026-10-07: 19 columns, 4 indexes, 5 checks, 0 rows.]**
**Source of truth:** Postgres send ledger for the group-review handoff email
(Final Writeup group-review handoff Stage 4). Dataverse owns the documents and
request; Dynamics owns the email activity and transport. Migration
`072_final_writeup_handoff_emails.sql`; fresh installs run it as a numbered
migration (no setup-database fixture). One row per handed-off draft (primary
key `source_document_id`, the Site Visit / Pre-Site source document);
`final_document_id` is bound once the transition is confirmed (unique when
set). `POST /api/workbench/final-writeup` stages the row BEFORE the transition
runs, only for the lead PD or a superuser, only when the submitted draft is the
request's current draft (`_wmkf_currentpresitevisit_value`), only when the
request has no current Final, and only when its Grant Program is listed in
`FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS`, so writeups already in group review
before deployment never get a row. If the insert fails for a request that
should email, or the request cannot be read while any program is listed, the
route returns 503 `final_writeup_handoff_email_unavailable` before the
transition starts. With no program listed, staging reads nothing. Delivery sends only when the
request's current Final has this draft as its source and is in group review;
until then the row stays `pending` without an error (`awaiting_transition`),
so a commit whose response was lost is still sent by a retry POST or by
recovery. States: `pending` → `sent`, or terminal `skipped` with a
`skip_reason` (`program_not_enabled`, `final_from_other_draft`,
`no_longer_in_group_review`, `final_withdrawn`, `transition_not_committed`
after 14 days (each new staging of the same draft restarts that wait, and a
later staging or a committed start for the draft reopens only this kind of skip),
`program_not_configured`, `staffing_not_configured`, `no_recipients`). A five-minute lease (`lease_token` + `locked_until`)
lets one call send; every write requires the current token, and the lease is
renewed as a fence before creating an activity and before `SendEmail`, so a
worker whose lease expired and was taken over stops (fifth Codex review); the Dynamics activity id and frozen `to_recipients` are stored before
`SendEmail`, and correlation key `wmkf-final-writeup-handoff:<sourceDocumentId>`
recovers an activity created before the id was stored. An activity already
accepted by Dynamics is recorded as sent without further checks; one that is
not yet sent is re-checked against the current Final and group-review state
before `SendEmail`, so a stale invitation is never sent. Eligibility, audience and lead
exclusion use the request's current Grant Program and lead PD. Any existing
unsent activity (a recorded draft whose send failed, or an orphan found by correlation key
and never recorded) is sent only if its To list matches exactly the recipients the request
would get now, re-resolved from the current audience, persona, role, account state and
address; otherwise it is abandoned unsent and a fresh activity is built for the current
recipients under the next `recipient_generation` (part of the correlation key), so the email
still goes out. A failed lookup keeps the row pending. The program and lead used to build a
draft are saved with its activity id. An owed email that cannot be delivered
(`program_not_configured`, `staffing_not_configured`, `no_recipients`, or a third failed
attempt) raises an `error` ops alert (`final_writeup_handoff_email_undelivered`). Store SQL is proven by
`tests/integration/final-writeup-handoff-email.pg.test.js` in the CI Postgres job. Recipient lookups that
fail for any reason other than 404 keep the whole send pending. Recipients are internal staff
only (owner, 2026-10-07): an address whose domain is not exactly `wmkeck.org`
(`FOUNDATION_EMAIL_DOMAIN`) is never emailed, and refusing one raises an
`final_writeup_handoff_email_outside_domain` ops alert. Failures keep
`pending` with `last_error_code` and are retried automatically every 15 minutes by
`/api/cron/final-writeup-handoff-emails` (25 rows per pass), by the next POST for that draft,
or by owner-run `scripts/recover-final-writeup-handoff-emails.mjs`; recovery takes the least
recently attempted rows first so repeated failures rotate to the back. Read/write paths:
`lib/services/final-writeup/handoff-email-store.js` and
`lib/services/final-writeup/handoff-email-service.js`. Trade-off: while
Postgres is unavailable, an enabled program's handoff cannot start; the lead PD
retries. No cleanup is scheduled; rows remain audit history.

### `final_writeup_leadership_digests` — PRODUCTION-LIVE; MIGRATION 073 APPLIED

**[PRODUCTION-LIVE: PR #461, merge `ddeb1b401`, 2026-10-07 PT; migration 073 applied; copy seeded; first digest not yet observed.]**
**Source of truth:** Postgres send ledger for the leadership daily digest
(Final Writeup group-review handoff Stage 5). Dataverse owns the requests and
documents; Dynamics owns the email activity and transport. Migration
`073_final_writeup_leadership_digests.sql`; fresh installs run it as a numbered
migration (no setup-database fixture). One row per (`recipient_systemuser_id`,
`digest_day`); the digest day is the UTC day before the run, so the 07:00 UTC
cron (`/api/cron/final-writeup-leadership-digest`) keys the Pacific day that is
ending, and consecutive daily runs get consecutive keys across daylight-saving
changes. Writeups: requests in Grant Programs listed in
`FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS` (owner 2026-10-07: Research only;
unset means no digest) with a current Final in lifecycle FINAL whose leadership
checkpoint is complete (`leadership-checkpoint.js`) and started within the last
7 days; test requests are excluded in the request query. Recipients: the
Leadership persona in the published Final Writeup staffing setting, pruned to the
current reviewer roster; addresses outside exactly `wmkeck.org` are never
emailed. Sender: `NOTIFICATION_EMAIL_FROM`. `membership` (JSONB array of item
snapshots: final document id, request id and number, title, institution, lead PD,
leadership start time) is frozen at insert and never rewritten, so retries render
the same email; only an accepted row's membership counts as already told
(10-day window), so writeups listed by a digest that never went out appear the
next day. A ten-minute lease (`lease_token` + `locked_until`) admits one claimant;
every write requires the current token and the lease is renewed as a fence before
creating the activity and before `SendEmail`. The activity id is stored before
transport, and correlation key
`wmkf-final-writeup-leadership-digest:<recipient>:<digestDay>` recovers an activity
created before its id was stored. `accepted_at` is terminal. No row is created when
nothing is new. Failures keep the row unaccepted with `last_error_code` and raise an
`error` ops alert (`final_writeup_leadership_digest_undelivered`), as do a blank
subject or message (`email.final_writeup_leadership_digest.subject` / `.body`), an
unusable recipient address, writeups waiting with no Leadership persona, and a run-wide
fault (writeup scan, staffing read or missing sender/base URL), which also fails the cron. A
same-day retry reclaims the row with its own stored membership. Known
direction: a digest whose transport was accepted but whose acceptance was never
recorded lists its writeups again the next day (duplicate, never a drop). Read/write
paths: `lib/services/final-writeup/leadership-digest-store.js` and
`lib/services/final-writeup/leadership-digest-service.js`. Store SQL is proven by
`tests/integration/final-writeup-leadership-digest.pg.test.js` in the CI Postgres job.
No cleanup: one small row per Leadership recipient per day with new writeups.

### `deliberation_agenda_sends` — DEPLOYED; MIGRATION 041 APPLIED

**Source of truth:** Postgres exact-email and cross-system recovery ledger for
Meeting Tracker session agendas; Dynamics remains email-activity/transport
authority and Dataverse remains session/slot authority. Migration
`041_deliberation_agenda_sends.sql` is mirrored in fresh-install v46.
One operation UUID freezes the session start/end/zone/HTTPS meeting link,
location, ordered proposal identities/details/minutes/computed windows/HTTPS
briefing links, normalized To/Cc, subject, exact text/HTML, sender, and
session-derived Dynamics actor. States are `prepared`, `activity_created`,
`send_requested`, `sent`, and terminal `failed`. A lease fence,
correlation-key recovery, durable
activity ID, and durable send intent prevent a retry from creating a second
activity. A retry reconciles Dynamics first: status 3/6/7 records transport
acceptance, confirmed Draft resumes SendEmail on the same activity, and an
unknown or unreadable status remains unresolved and does not send. Known closed
status 2/4/5/8 records `failed` and permits a new preview without reusing that
activity. GET reads the latest sent row for
the receipt/drift note and separately returns the latest unresolved
`send_requested` row; prepare refuses a different operation until that pending
send is resolved. Send has the same guard, and unique partial index
`uq_deliberation_agenda_one_unresolved` enforces at most one `send_requested`
row per session under concurrency. Drift compares the live start as an instant plus ordered
request/minutes tuples with the frozen sent snapshot. Read/write
paths are `lib/services/meeting-tracker/agenda-store.js` and
`lib/services/meeting-tracker/agenda-service.js`; the guarded API is
`/api/meeting-tracker/sessions/[id]/agenda`. No cleanup is scheduled; rows
remain audit history until a retention policy is explicitly approved.
**[VERIFIED 2026-09-10 via migration/fresh-install parity and focused service,
route, and panel tests; tracker state reverified 2026-09-15.]** Migration 041 is
applied/tracked and the Meeting Tracker readiness flag is exact-on. The agenda
transport itself has not been independently production-smoked, so no live-send
claim is made.

### `scheduled_email_messages` — MIGRATION 036 APPLIED 2026-08-26; LIVE IN PRODUCTION

**Source of truth:** Postgres coordination and audit ledger for personalized
scheduled email; Dataverse remains workflow authority and Dynamics remains
email-activity/transport authority. Migration
`036_scheduled_email_messages.sql` is mirrored in the fresh-install setup.
**[VERIFIED IN SOURCE + FOCUSED TESTS; LIVE-PROBED 2026-08-26: migration 036 applied to the shared Neon database (tracker row + table exist per read-only information_schema probe); the writer code merged to `main` the same day (`4a743d63a`). A read-only Production read on 2026-10-01 (S560) found the table's only row, created by the 10/01 08:00 UTC `grantee-deliverable-reminders` run and then stopped by the owner; no row has reached a real send yet.]**

The first allowlisted workflow is `grantee_abstract_reminder`. One source
deliverable can own one row, created on the cron's first sight of an Invited
deliverable. The row freezes the exact server-derived PD, recipients,
recipient contact GUIDs, subject/body/signature, established day-12 send
time, and `approval_required` (computed at creation from the PD's
review-all override plus VIP flags; re-checked at send time by Part B,
tightening only). It records optimistic versions and PD
edit/approve/stop attribution; the digest FYI receipt (`digest_fyi_at`);
recipient Dynamics activity identity, send intent, acceptance receipt, retry
lease/error; and the final Dataverse repair timestamp. Preview uses a visibly
non-live placeholder; the grantee token is minted only for a real send.
**[VERIFIED 2026-08-26 via migration 036, scheduled-email-store.js, and the
scheduled-email suites on branch `codex/scheduled-email-review-p0`.]**

Read/write paths: `lib/services/scheduled-email-store.js`,
`lib/services/scheduled-email-service.js`,
`lib/services/cron/grantee-deliverable-reminders-service.js`, and the
profile-owned `/api/scheduled-emails` routes. Recipients/sender/source/schedule
are never client-editable; PATCH actions can edit bounded subject/body (which
clears any prior approval), approve, stop, or send now under exact PD
ownership and a version fence. The store's due-send claim refuses an
`approval_required` row without `approved_at`; the PD's version-fenced
send-now is the only bypass. A due send freshly rechecks that the deliverable
is still Invited, persists/reconciles one correlation-keyed Dynamics
activity, records transport acceptance, and only then finalizes
`wmkf_granteedeliverable`. A separate pass repairs sent but unfinalized rows
without re-sending. The per-PD daily digest is the only notification surface;
its concurrency claim and FYI membership live in
`scheduled_email_digest_runs` (below). PD handoff: when the request's lead PD
no longer matches an unsent row, the cron rebuilds the row in place under the
current PD (mailbox, name, signature, recipients, and the current PD's own
review posture); the former PD's edits/approval are deliberately cleared, and
the SQL guard (`reassignScheduledEmail`) fires only for unsent, unleased rows
owned by a different PD. [RECHECKED after lib/services/scheduled-email-store.js change: reassignScheduledEmail + claimDigestRun added 2026-08-26]
[RECHECKED after lib/services/scheduled-email-service.js change: sendScheduledEmailDigest rewritten onto the run ledger 2026-08-26]
[RECHECKED after lib/services/cron/grantee-deliverable-reminders-service.js change: drift rebuild + reassigned counter added 2026-08-26]

**Part A engine hardening (PR #373, merged 2026-09-30, S553) [VERIFIED: migration
059 applied to shared Production (tracker `claude-part-a-2026-09-30`, read-only
query 2026-09-30)]:** migration
`059_scheduled_email_recipient_generation.sql` (fresh-install block V58) adds
`recipient_generation INTEGER NOT NULL DEFAULT 0`, the only new column. Per
`docs/plans/SCHEDULED_EMAIL_READDRESS_PLAN_2026-09-29.md` A1–A7:
`send_requested_at IS NOT NULL` is the durable no-resend predicate — the
ordinary claim and due query refuse such rows in SQL, any failure after send
intent stamps `last_error_code = 'scheduled_email_send_unconfirmed'` at once
(status `failed`, lease released), and a separate 25-row reconciliation query
(`listScheduledEmailReconciliationCandidates`, `updated_at ASC`) plus
`claimScheduledEmailReconciliation` only read the stored activity back
(accepted → `sent` + finalized; otherwise released with the marker kept). A
stored activity read is classified: 404 →
`scheduled_email_activity_missing` (excluded from automatic delivery and
reconciliation; manual recovery), 403 → `scheduled_email_activity_forbidden`
(excluded from the due query, retried read-only through the same lane via
`claimScheduledEmailActivityRead`/`clearScheduledEmailActivityCode`), other
errors → transient failure; absence is never inferred from a failed read.
Edit/approve additionally require `dynamics_email_id IS NULL AND
send_requested_at IS NULL`. `reassignScheduledEmail` is one version-fenced
atomic reset (also accepts `sending` with an expired lease) that returns the
row to `scheduled`, clears the lease and increments `recipient_generation`;
the recipient correlation key is `wmkf-scheduled-recipient:<id>` at generation
0 and `…:<id>:g<n>` after. `cancelScheduledEmailForSource` is lease-fenced
inside a delivery attempt. Stopped rows with send intent are read back for 7
days (`listStoppedScheduledEmailsWithSendIntent`,
`recordStoppedScheduledEmailSent`): stopped wins unless Dynamics proves the
send. The digest query is a per-PD `ROW_NUMBER()` window (100 rows per PD,
`pd_total` for cap warnings) with a **Needs attention** section decided by
`shared/utils/scheduled-email-attention.js`, the single display/guard helper
also used by the action route and `pages/scheduled-emails.js`. Proof:
`tests/integration/scheduled-email-engine.pg.test.js` (CI ledger job).

**Part B send-time recipient and posture re-check (PR #384, merged 2026-10-01,
`3b5002d95`; no migration) [VERIFIED: live-Postgres suite, plus a browser
rehearsal against a Neon branch of the app database]:** per plan B1–B5,
`deliverScheduledEmail` re-reads a transport-pristine row's current Liaison
(`resolveRequestLiaison` + contact) and review posture (review-all + VIP flags
for `[PI, Liaison?]`) after the claim and before any activity lookup. Any read
failure is a retryable `scheduled_email_recipient_read_failed`.
`reconcileScheduledEmailRecipients` is the single transition, fenced on
`lease_token`, `version`, `status = 'sending'` and both transport fields null:
- **Recipient drift** (Liaison contact id or normalized email, including a
  Liaison gained or dropped) rewrites `cc_recipients` and the ordered
  `recipient_contact_ids` and increments `recipient_generation`.
- **Posture-only tightening** sets `approval_required = true`.
- **Every transition** clears `approved_at` and increments `version`.
- **When approval is required** (always for recipient drift on a forced
  send-now) the row returns to `scheduled` with the lease released and
  `last_error_code` `scheduled_email_recipients_changed` or
  `scheduled_email_approval_now_required`. Those codes are not attention
  codes, so the row sits under approval-pending. Otherwise delivery continues
  under the same lease with the returned row.

Relaxation changes nothing. A saved activity without send intent is sent as
created and only counted (`savedActivityNotReaddressed`; owner decision B-2).

**Retention:** daily maintenance defaults to 365 days and deletes only rows
that are both `sent` and Dataverse-finalized, or explicitly `stopped`. Pending,
failed, sending, and sent-but-unfinalized rows are ineligible so cleanup cannot
erase recoverable work. The Dataverse setting
`retention:scheduled_email_messages_days` may supply a positive override.

**Decision layer:** the 2026-08-26 owner design
(`docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md`) is now the built shape on this
branch: automatic-by-default sends, per-(PD, contact) VIP review flags, digest
as single interface, and PD onboarding as a rollout precondition (no
unconfigured runtime state; the legacy direct claim-before-send path is
deleted).

### `scheduled_email_vip_flags` — MIGRATION 036 APPLIED 2026-08-26; CODE DEPLOYED

**Source of truth:** Postgres. Per-(PD, contact) VIP review flags
(`pd_systemuser_id`, `contact_id`, `created_at`; primary key on the pair).
Deliberately per-PD, never global — the flag does not transfer on request
handoff. Written/read via `lib/services/scheduled-email-store.js` from the
profile-owned `/api/scheduled-emails/vip-flags` route (toggles render on the
Workbench Awardee tab and the `/scheduled-emails` inbox) and read by the
reminders cron to set `approval_required` at ledger-row creation (re-checked at
send time by Part B, tightening only); any flagged recipient contact (PI or
liaison) requires approval. **[VERIFIED
2026-08-26 via migration 036 and scheduled-email-store.js on branch
`codex/scheduled-email-review-p0`; LIVE-PROBED 2026-08-26: table exists in the shared Neon database, empty at probe time; the code deployed the same day (`4a743d63a`).]**

### `scheduled_email_digest_runs` — MIGRATION 036 APPLIED 2026-08-26; CODE DEPLOYED

**Source of truth:** Postgres. Per-(PD, UTC day) digest run ledger added
2026-08-26 after the branch adversarial review. The primary key
(`pd_systemuser_id`, `digest_day`) plus a `locked_until` lease is the
one-digest-per-PD/day concurrency claim; `fyi_message_ids` freezes the exact
sent-FYI membership rendered into that digest at first claim (never rewritten
on re-claim); `activity_id` is persisted before transport; `accepted_at` and
`fyi_stamped_at` are idempotent receipts. Recovery stamps `digest_fyi_at` on
exactly the frozen membership, so a message sent after the digest stays
unreceipted and appears in the next day's digest — a duplicate FYI is
possible after a mid-run crash, a dropped FYI is not. Written/read only by
`lib/services/scheduled-email-store.js` (claim/record/mark helpers) and
consumed by `sendScheduledEmailDigest`. **Retention:** deliberately
unbounded — ≤6 PDs × ≤366 rows/PD/year; revisit only if PD count grows
materially. **[VERIFIED 2026-08-26 via migration 036,
scheduled-email-store.js, and the digest tests in
tests/unit/scheduled-email-service.test.js; LIVE-PROBED 2026-08-26: table exists in the shared Neon database, empty at probe time; the code deployed the same day (`4a743d63a`).]**

### `scheduled_email_reviewer_vip_flags` — MIGRATION 037 APPLIED 2026-08-26; CODE DEPLOYED

**Source of truth:** Postgres. Per-(lead PD, reviewer person) VIP flags for
reviewer invitation sends, added by migration `037_reviewer_vip_flags.sql`
(mirrored in fresh-install v42). **Keyed on `wmkf_potentialreviewersid`, not
contact** — reviewer candidates deliberately have no CRM contact until an
identity-bearing acceptance (S389), so the person row is the only stable
pre-invitation key. Written/read via `lib/services/scheduled-email-store.js`
reviewer-flag helpers from `/api/review-manager/reviewer-vip-flags` (any
review-manager/reviewers staff may curate on the lead PD's behalf; the PD
resolves server-side from the request row). Consumed synchronously by the
Invite Reviewers send flow — a flagged person's invitation drafts render as
full editable preview cards in `InviteEmailModal`, others collapse to a
batch summary. **No ledger workflow reads these flags and no send path is
gated by them.** **Retention:** deliberately unbounded (≤6 PDs × curated
handfuls of people). **[VERIFIED 2026-08-26 via migration 037,
scheduled-email-store.js, and the reviewer-vip-flags route/panel/modal
suites; APPLIED to the shared Neon database 2026-08-26 (owner-run
apply-migrations); LIVE-PROBED same day: tracker row present, three
expected columns, 0 rows at probe time; the code merged to `main` 2026-08-27 (`dc46fa183`).]**

## Portal upload staging

### `portal_upload_staging` (migrations 031, 043, 049, 055, 060)

**[PRODUCTION-VERIFIED 2026-10-02 via owner-run read-only probe: migration 060 applied at `2026-10-02T17:08:20.197Z`; `background_job_id` is present in `public`; no migrations pending.]**
**Source of truth:** Postgres coordination ledger; published abstract/caption/image
authority remains Dataverse + SharePoint.

One row authorizes one private Blob pathname for one server-derived actor,
scope, and request. Statuses are `pending`, `finalizing`, `consumed`, `rejected`,
and `expired`; a five-minute lease serializes finalization. Verified Blob ETag,
SHA-256, and actual bytes are recorded before domain processing. If SharePoint
upload succeeds, `candidate_result` records the scope-specific exact candidate
before the Dataverse write: image flows store the drive/item/image reference;
applicant materials store the intended predecessor artifact id plus the Graph
drive/item/version/filename. This lets an expired-lease retry recognize a
committed response drop, retire only the recorded predecessor, or delete only
an exact unreferenced candidate where that scope supports candidate cleanup.
`result_payload` makes consumed retries idempotent. **[SOURCE-BUILT, NOT DEPLOYED:]
For `site_visit_material` only, a terminal `scan_infected` rejection can also store
the strict public `{ok:false, reason:'scan_infected', scanRejection:{category,flags}}`
payload. Rejected-staging replay returns its safe diagnostic; an attention hold
keeps staging pending and does not write that rejection payload. Other scopes
retain their existing replay contract.**

For `post_presentation_transcript` (migration 055), the candidate binds the
request/generation identity and exact Graph drive/item/name/version/ETag.
**[PRODUCTION-LIVE via PRs #375 and #379 on 2026-09-30; DOCX/VTT accepted via owner report on request 1002903:]**
DOCX finalization attests the stored package against the staged source using
`attestDocxPackageAgainstSource`, accepting only its characterized SharePoint
metadata changes. Candidate `sourceSha256`/`sourceSize` identify the original
staged input; `sha256`/`size` identify the actual stored package for exact-byte
cleanup. `registrySize` retains the size fenced immediately before a registry
create so later metadata-only repacks can replay that row. Legacy receipts are
upgraded using the original staged bytes. A stable DOCX that fails attestation
also retains its exact stored-byte receipt under the staging lease before
permanent rejection on fresh/conflict uploads, so the existing zero-row/exact-byte
expiry cleanup can identify the orphan. Rejected recorded retries keep the
prior receipt instead of authorizing deletion of edited bytes. Receipt persistence failure retains staging; successful
attestation remains required before registry publication. PDF/TXT/VTT retain
exact raw-byte checks. No columns or status values change. See
`docs/plans/evidence/post-presentation/docx-transcript-fix-2026-09-30.md` for
initial characterization and failure handling, and
`docs/plans/evidence/post-presentation/transcript-package-and-blob-read-2026-09-30.md`
for the completed release and owner acceptance. The shared private loader now
reads bounded decoded bytes when wire length is absent or compressed, while
known uncompressed length, source cap, actual hash and lease fences remain
enforced. Only exact newly promoted DOCX custom-properties OPC links are
tolerated; source content and existing relationships remain protected.

Write/read paths: `lib/services/portal-upload-staging.js`; external grantee mint
and submit routes; staff replacement mint and finalize routes; external
applicant materials mint and finalize routes (scope `site_visit_material`,
migration 043, S503; document content types, cap from the admin setting
`site_visit_materials.upload_max_mb`); staff Consultant Feedback attachment
mint and finalize routes (scope `consultant_feedback`, migration 049,
Consultant Feedback slice 2 — `docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md`
§4; PDF/DOCX only, `lib/services/consultant-feedback-attachment-service.js`).
Raw external
tokens are never stored (SHA-256 binding only), and clients never choose or echo
an authoritative pathname. Daily maintenance deletes exact table-selected Blob
pathnames after expiry and prunes terminal ledger rows after seven days; since
the Consultant Feedback prerequisite (same plan §4 "Slice 2 prerequisite"),
that sweep also reconciles any `candidate_result` recorded after a Graph
upload against a per-scope binding proof before expiring the row —
`consultant_feedback` and `site_visit_material` scopes have a proof wired
(fail-closed: an unbound Ready registry row is superseded before its Graph
item is discarded); `grantee_image`/`staff_grantee_image` and any
unrecognised candidate shape are always retained, never discarded, until a
proof is wired for them too.

Private-store prerequisite is covered by
`scripts/probe-private-blob-client-access.mjs`: public-mode PUT must fail, private
PUT must succeed, and anonymous HEAD must return 403.

Migration 060 adds the nullable `background_job_id` ownership marker used only
by applicant materials background uploads. While present, staging cleanup and
ordinary finalize claims must respect the exact job owner; the job ledger is
coordination state and does not replace the staged pathname, Blob hash, or
domain receipt. **[PRODUCTION-VERIFIED 2026-10-02: migration 060 is applied and
the column exists; background admission remained off at the recorded probe.]**

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
**[SOURCE-BUILT, NOT DEPLOYED:]** Applicant materials `scan_infected`
rejections also write a best-effort warning `site_visit_material_scan_rejected`
at `virus_scan`, deduplicated by staging id. Entity references contain the
request, collection, staging, and slot; metadata contains only the allowlisted
`scanRejection` category and flags. The event does not send email.
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
Append-only history written by `/api/cron/pricing-refresh` (monthly, 1st of month).
**[SOURCE-BUILT 2026-10-02 on `codex/admin-alert-remediation`; not deployed.]**
The corrected writer joins Anthropic `/v1/organizations/cost_report` and
`/v1/organizations/usage_report/messages` for the same 30-day window and exact
UTC day, model, workspace, service tier, context window, and inference geography.
`token_count` is the matched provider count, not app-local `api_usage_log` usage;
5-minute and 1-hour cache creation remain separate. Each matched aggregate
stores cost in cents, provider tokens, derived/local cents per million tokens,
and delta. Unknown local pricing or >5% drift flags a row. Only a nonempty,
complete comparison without flags resolves the standing `pricing:drift` alert;
skipped or uncomparable billable rows preserve it. Report pagination errors
abort before comparisons; inserts are awaited individually, so a failed write
can leave partial audit history but cannot resolve the alert. The schema is
unchanged and older audit rows retain their original app-local denominator.
The cron alerts; humans review billing modifiers and edit
`lib/utils/model-pricing.js`; no auto-overwrite. Requires `ANTHROPIC_ADMIN_API_KEY`.
Corrected live provider reports have not been run for this branch.

### `external_rate_limit` (0 rows)
**Source of truth:** Postgres-only. V031 migration / `010_external_rate_limit.sql` (S173, 2026-05-21, security audit A6).
Fixed-window (60s) rate-limit counters for the public external-reviewer token routes `/api/external/review/[token]/*`. Two bucket scopes share the table, discriminated by the `bucket_key` prefix: `tok:<sha256(jwt)>` (per-token) and `ip:<addr>` (per-IP). `invalid_count` tracks per-IP token-verification failures and feeds an invalid-token-spike `system_alerts` entry. Written + read by `lib/external/rate-limit.js` (`checkRateLimit`, `recordTokenOutcome`); expired windows pruned opportunistically on write. Postgres-backed (not in-memory) because Vercel Fluid Compute spreads requests across instances. Fail-open: a DB error allows the request rather than locking out a reviewer; a sustained run of limiter DB failures raises a deduplicated degraded-limiter `system_alerts` entry so the silently-disabled state is visible.

### `bill_webhook_events` (0 rows)
**Source of truth:** Postgres-only. `015_bill_webhook_events.sql` (S188, 2026-05-25).
Dedup gate for BILL.com webhook deliveries at `/api/webhooks/bill`. Compound `UNIQUE (subscription_id, event_id)` constraint backs an atomic `INSERT ... ON CONFLICT DO NOTHING RETURNING id` check-and-insert — a returned id means first delivery, no row means BILL is retrying. Compound key is defensive against BILL's `eventId` uniqueness scope not being formally documented across subscriptions. Daily maintenance deletes rows where `received_at < NOW() - INTERVAL '7 days'` (TTL comfortably exceeds any plausible BILL retry horizon). See `docs/BILL_LIB_DESIGN.md` v3.

### `bill_onboarding_state` (0 rows — pre-launch)
**Source of truth:** Postgres-only. `017_bill_onboarding_state.sql` (S199, 2026-05-29). Design: `docs/BILL_CHUNK_4_DESIGN.md` Thread 3.
Durable state for the BILL honorarium onboarding flow (`lib/bill/onboard-reviewer-service.js`), one row per honorarium `akoya_request` (PK `honorarium_request_id`). Closes the three S198 P1s (`docs/REVIEWER_BILL_HARDENING_FINDINGS.md`): the row is RESERVED (`INSERT ... ON CONFLICT DO NOTHING RETURNING`) **before** `createBillVendor` so a concurrent second caller loses the PK race and never reaches BILL; `vendor_id` is written the instant the vendor is created, **before** the contact `wmkf_billcomid` PATCH, so a failed contact PATCH can't lose it (→ no duplicate vendor on retry); `dynamics_pending` is the torn-state marker (BILL side done, `akoya_request` writeback still owed) that the daily `MaintenanceService.sweepBillOnboarding` resumes idempotently (`pending_match` true → write PNI + "Yes"; false → "No"; **NULL → sweep fails closed, never defaults to "No"**). Written/read by `lib/bill/onboarding-state.js`. TTL: completed (`dynamics_pending = false`) rows pruned after 30 days by `MaintenanceService.cleanupBillOnboardingState`.

### `deliberation_briefing_links` — SOURCE-BUILT (branch `feature/deliberation-briefing-page`); MIGRATION 038 NOT YET APPLIED

**Source of truth:** Postgres. One expiring, revocable link per request to the
read-only deliberation briefing page (`docs/DELIBERATION_BRIEFING_PAGE_PLAN.md`,
owner decisions D13–D16, 2026-09-09), added by migration
`038_deliberation_briefing_links.sql` (mirrored in fresh-install v43), which also
adds `pre_site_distribution_attempts.briefing_link_id`. **[PLANNED — the
migration exists in source; the owner applies it and sets
`DELIBERATION_BRIEFING_SCHEMA_READY=on`; nothing reads or writes the table until
that flag is literal `on`.]**

Columns: `id`, `request_id`, `jti`, `token_digest` (SHA-256 of the JWT, unique;
verified on every external request), `token_ciphertext` (the JWT sealed with
`lib/utils/encryption.js` so Share can carry the same link again and staff can
copy it — the raw token is never stored), `expires_at`, `created_by`,
`created_at`, `revoked_at`, `revoked_by`, `superseded_by`. Partial unique index
on `request_id WHERE revoked_at IS NULL` holds at most one live row per request.
Written by `lib/services/deliberation-briefing/briefing-link-store.js` through
`briefing-link-service.js` (`ensureLiveBriefingLink` from the Share prepare path
and `/api/workbench/pre-site-visit/briefing-link`; `reissueBriefingLink`
revokes-and-replaces in one transaction). Read by
`lib/external/verify-briefing-token.js` for `/api/external/briefing/[token]/*`.
The row holds identity, expiry, and revocation only: the writeup the page serves
is pinned by the latest `sent` `pre_site_distribution_attempts` row,
reviews resolve live from `wmkf_appreviewersuggestion`, and the proposal
narrative resolves by governed path. Cleanup: none scheduled; revoked and expired
rows stay as audit history (bounded by one live row per request).

### Post-presentation material ledgers — SHARED-SCHEMA LIVE; BOUNDED BRANCH PREVIEW ACCEPTED AND CLOSED

**[VERIFIED via source, canonical migration runner, and shared-Neon readback 2026-09-26 on
`codex/feature-request`.]** Migration
`055_post_presentation_materials.sql`, mirrored by fresh-install V56, defines
three additive tables for the post-research-presentation feature. Under explicit owner
authorization, the canonical runner applied 055 to the shared Preview/Production Neon database
at 2026-09-26T06:54:20Z. Exact readback found all three tables, all four named indexes, the
expected constraints, and zero rows; a second runner invocation was an idempotent no-op. Only
`codex/feature-request` Preview configuration is schema-ready and limited to approved sandbox
Request `4236c2b3-b053-f111-bec7-6045bd015cb0`; corrected registered-alias deployment
`dpl_BZbtW5D2UHhrQpcQhMio2kT19tXr` is Ready and passed signed-in Chrome readiness/link issuance.
Exact readback found one live link row for the approved Request and zero upload/lease rows.
After Safari acceptance, exact cleanup restored the registered Preview alias to prior Factory
deployment `dpl_8hUghEjVqCG1CHK7AjRJH8NXPvjr` and reset this branch's presentation access to
literal `off`; the link row, retained recording, and schema were not deleted. Production runtime
configuration remains unchanged and destructive cleanup remains off. Slice 3's
transcript producer, Slice 4's browser-direct MP4 intent/status/finalize routes, and Slice 5's
independent 60-day link lifecycle plus token-verified materials-only consumer are source-built
and offline-tested only on `codex/feature-request`.

- `presentation_material_links` stores one non-revoked materials-only link per
  Request: UUID/JTI, unique SHA-256 token digest, sealed token ciphertext,
  expiry, creator/time, and revocation/supersession evidence. Raw tokens are
  absent from the schema. `presentation-link-service.js` reuses one readable
  live row, atomically replaces expired/unreadable state, and compare-and-swap
  reissues only the inspected presentation row. `verify-presentation-token.js`
  rechecks the distinct `presentation-materials` audience, request rollout,
  digest, revocation, and expiry before every external context/media action.
- `presentation_material_uploads` stores one actor/request/active-Site-Visit
  bound browser-direct Graph intent before any preauthenticated URL is returned.
  It records the bounded file fingerprint, code-owned path/generation identity,
  lifecycle/lease/review-after state, the upload URL only as ciphertext, exact
  Graph candidate facts, and the finalized Request Document identity. Stored
  Graph expiry is advisory; independently authorized resume refreshes it from
  live Graph state and it is not deletion authority. Daily maintenance claims
  eligible rows and, unless both general access and the separate destructive
  cleanup permission are literal `on`, remains inspect/refresh/record/bind/alert-only
  (binding a verified registered item is non-destructive on the step-0 branch).
  Staff Cancel and terminal-session Retry share the intent lease with finalize and
  cleanup. Cancel abandons only after confirmed session termination and an absent
  exact path; Retry retains the same intent/path/generation and starts a newly
  confirmed terminal session from byte zero. A candidate rejected by MP4 signature
  or Graph malware validation remains a terminal `failed` intent and is omitted
  from staff's unfinished-upload actions; status and finalize refuse replay.
  Its exact item remains for the existing lease-fenced cleanup review, which
  deletes an unbound item only under the separate general-access and
  destructive-cleanup gates. If an exact Request Document was already created
  before a later validation rejection, cleanup retains and alerts instead of
  relabeling the rejected intent as finalized.
  **[SOURCE-BUILT on branch `claude/zoom-copy-step0`, not merged; migration 076
  NOT applied.]** Migration 076 adds `origin` (`browser` default, or `zoom_copy`
  for the planned Stage 3b server copy; CHECK
  `presentation_material_uploads_origin_check`). Step 0 adds `origin = 'browser'`
  to the actor-keyed reads, claims and unleased writers, so a `zoom_copy` intent
  is invisible to the browser Upload, Resume, Cancel, Retry and Finalize paths;
  token-keyed and cleanup functions stay origin-agnostic. Cleanup now binds a
  verified registered item in every access mode (a Postgres write only);
  deletion and abandonment stay behind the destructive-cleanup gates, and a
  rejected candidate is still retained. No row has `zoom_copy` origin yet; see
  [postgres-zoom-video-copies.md](postgres-zoom-video-copies.md).
- `presentation_material_slot_leases` is keyed by Request + Recording,
  Transcript, or Transcript Summary artifact type and stores a paired
  token/expiry plus a positive fence capped at 2,147,483,647.

The same migration and every fresh-install definition enumerate the complete
five-scope `portal_upload_staging` allowlist, adding
`post_presentation_transcript` without removing the four live scopes. Exact shared-database
readback confirmed that constraint. Slice 3's source-built cleanup reconciler recognizes the
transcript candidate shape, but disabled destructive-cleanup controls provide no new deletion
authority. The local acceptance finalized intent
`e7236795-42d8-4018-8ee8-cdc66b953e9b` and retained its registry-bound SharePoint item; that
disposable database/container is test evidence, not a deployed state store.

### `consultant_feedback` — PRODUCTION-LIVE Consultant Feedback slices 1–3 (migrations 048-049 applied; fresh-install v50-v51; 2026-09-14)

**Source of truth:** Postgres. Staff-recorded informal feedback from retained
consultants on a proposal (`docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md`).
Home is the Request Workbench Reviews tab, as its own "Consultant feedback"
section below formal reviews (CF1); shared on the external deliberation
briefing page by default (`shared` boolean, default `true`, CF2); staff may
edit and delete with no audit trail (CF5). PR #300 made its append-only Graph
uploads use closed `rename` conflict behavior, preserving both artifacts when
two entries derive the same filename. A signed-in production smoke on request
1003222 proved create, upload/finalize, staff open, and delete.

Columns: `id`, `request_id` (Dataverse `akoya_request` GUID, GUID-validated at
the route boundary), `consultant_roster_id` (FK `expertise_roster.id`,
nullable; joined **live and unfiltered by `is_active`** for display, so a
deactivated consultant's past feedback keeps its author name),
`one_off_name`/`one_off_affiliation` (used only when `consultant_roster_id` is
null — a one-off consultant name stored on the entry itself; CF6: one-offs are
never written to `expertise_roster` and never appear in recipient pickers),
`body_html` (sanitized HTML, same `sanitizeReviewHtml` pipeline as reviews,
re-sanitized on every read; required unless `requestdocument_id` is set —
an attachment-only entry may carry a null body), `received_on` (date),
`requestdocument_id` (nullable, unique; slice 2: the bound attachment's
`wmkf_requestdocumentid`, written either at create via `writeFeedbackEntry`
or bound onto an existing row via `updateFeedbackEntry`'s `patch.requestdocumentId`,
409 `attachment_conflict` if already set), `shared`, `mutation_id`
(client-generated UUID; `UNIQUE (request_id, mutation_id)` backs a replay-safe
create: `INSERT … ON CONFLICT (request_id, mutation_id) DO NOTHING` followed
by a select on that mutation id, so a retry after a lost response returns the
original row instead of duplicating it), `status` (`active` or `deleting`;
an unattached row's delete still goes straight from `active` to gone — an
attached row's delete sets `deleting` first (plan §3.6 three-step: mark
`deleting` → supersede the registry row → PG delete), invisible to every
`status = 'active'` reader from the first step; `listConsultantFeedback` runs
a bounded recovery sweep over this request's `deleting` rows before every
list, so a crash or lost response between steps completes on the next staff
visit with no background job), `created_by`/`updated_by`/`created_at`/`updated_at`.

Constraints: `consultant_feedback_has_content` (`body_html IS NOT NULL OR
requestdocument_id IS NOT NULL`); `consultant_feedback_one_author` (exactly
one of `consultant_roster_id` / `one_off_name`). Server-side eligibility
(`is_active = true AND role_type = 'Consultant'` against `expertise_roster`)
is enforced in the service on create and on any author change — the FK alone
would accept a Board member or an inactive roster row.

Written and read exclusively by `lib/services/consultant-feedback-service.js`
(`listConsultantFeedback`, `listEligibleConsultants`, `writeFeedbackEntry` —
inserts, `updateFeedbackEntry` — author/body/date/share/attachment-bind
changes; both run in their own same-client transaction through the shared
`assertConsultantEligible`/`validateAuthorInput` guards, eligibility only
re-checked when the submitted author differs by value from the stored row,
`deleteFeedbackEntry` — the plan §3.6 three-step for an attached row,
`isSharedActiveFeedbackAttachment` — half of the briefing page's `feedback:`
member proof, `loadSharedConsultantFeedbackForBriefing`, and slice 3's
`downloadConsultantFeedbackAttachment` — reads one active request-owned entry,
then independently requires its exact same-request Ready/non-Superseded
Consultant Feedback registry row before a staff-only Graph download), called
from `/api/workbench/consultant-feedback`, `/consultants`, and `/attachment`,
`lib/services/consultant-feedback-attachment-service.js` (slice 2 attachment
lifecycle — see the `wmkf_requestdocuments` entry below), and
`lib/services/deliberation-briefing/briefing-page-service.js`'s
`buildBriefingContext`/`resolveBriefingMember` (`consultantFeedback: { status:
'ok' | 'unavailable', items }` — a read failure on this table alone degrades to
`unavailable` with a structured log rather than failing the whole briefing
context or looking like "no feedback"; each shared item's
`attachment.member = 'feedback:<requestdocumentid>'` only when the registry
row is Ready and not Superseded). No `expertise_roster` write happens anywhere
in this feature.
Cleanup: none (CF5 — a deleted row is simply gone).

### `site_visit_material_collections` (migrations 042, 044; S503)

Owner: applicant materials collection (`lib/services/site-visit-materials/collection-service.js`
+ `collection-store.js`; docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md §16). One row per collection
the PC starts from a request's active `wmkf_sitevisit`: request and Activity ids, `status`
(`open | ready | closed`), `due_at` (saved at creation using the configured business-day offset before the visit in its zone) and
`closes_at` (visit end + 7 days), the checklist template with per-item waivers, the PI/liaison
contacts snapshot, the sealed contributor link (`jti`, `token_digest`, `token_ciphertext`; raw
token never stored), invitation and reminder receipts (Dynamics email ids, counts, timestamps),
and the PC's ready confirmation. One non-closed row per request (partial unique index). Files are
never here: accepted uploads are SharePoint items registered in `wmkf_requestdocument`, which the
service reads back by artifact type and canonical filename. Migration 044 adds `slot_leases JSONB
NOT NULL DEFAULT '{}'::jsonb`: one server-owned token/expiry object per canonical checklist slot.
**[BRANCH-BUILT 2026-10-05; due-date setting not deployed.]** New collections read
`site_visit_materials.due_business_days` from Dataverse settings: integer 1–30, absent default 2,
weekends skipped and holidays not excluded. Invalid stored values or read failures return 503;
a changed deadline between preview and creation requires a new preview. The Admin setting does
not rewrite existing `due_at` values, and existing invitations, reminders, and applicant displays
continue consuming the saved deadline. No schema change is required.
**[PRODUCTION-LIVE 2026-09-24 via PR #335 / `407ca908d`:]** manual email previews
read the current Project Leader and liaison emails without writing this row. The liaison is the
Liaison of record (`lib/services/contacts/request-liaison.js`): for Research the applicant
Account's Primary Contact only; other programs keep the Request Primary Contact, falling back to
the Account's when blank. `contacts` also records `liaisonStatus`: `'none'` (a successful read found
no Liaison) sends to the PI only; `'found'` without an email refuses (409); a legacy snapshot
without a status still requires both roles. Send revalidates the reviewed To/Cc recipients and
refreshes `contacts`: an existing invitation uses a conditional contact update before transport;
a manual reminder updates contacts in the same conditional UPDATE that claims the reminder. The
automatic sweep re-resolves contacts before preparing, and `claimAutomaticReminder` compares the
snapshot it read and saves the refreshed one in its claim UPDATE (a changed snapshot loses the
claim; nothing is sent). A corrected contact therefore takes effect on the next preview, Send or
automatic reminder, without a migration.
`collection-store.js` acquires an absent or expired entry with one conditional UPDATE before the
finalize re-read and removes only the matching token afterward; the five-minute expiry recovers a
crashed holder while live contention returns `slot_busy`. Readiness flag
`SITE_VISIT_MATERIALS_SCHEMA_READY` (literal `on`). PR 3 (S506): the daily maintenance cron's
auto-close step (`MaintenanceService.closeExpiredSiteVisitMaterialCollections` →
`closeExpiredCollections`) sets `status = 'closed'` on every `open` or `ready` row past
`closes_at` (reads already projected a past `closes_at` as closed; the sweep makes it durable and
frees the partial unique index). The automatic reminder sweep (`reminder-sweep.js`, cron route
`/api/cron/site-visit-materials-reminders`, built but deliberately unscheduled: the owner retired the
automatic cron 2026-09-17 in favour of manual monitoring) claims by stamping
`last_reminder_at` and incrementing `reminder_count` with `last_reminder_email_id = NULL` before the
send, then attaches the email id; every other precondition (missing items, recipients, sender,
readable link, the optional site-visit read) resolves before the claim. A reminder row with a null
email id after a claim is therefore either a send that failed after the claim (`sendFailed`) or a
delivered email whose id could not be attached (`receiptFailed`; the run log and `maintenance_runs`
details carry the id for repair); neither is retried automatically. Staff list surfaces (Staff Deliberations tab and cycle
view, tracker list row) read a counts-only summary through `summary-reader.js`
(`listLatestCollectionsForRequests`, `DISTINCT ON (request_id)`); the contributor link and contacts
never leave the tracker grant. The legacy batch reader remains a fail-open summary map for sibling
consumers. Its additive Meeting Tracker reader also returns per-request availability, allowing that
dashboard to distinguish a successful read with no collection from readiness-off, Postgres,
registry, malformed-result, or thrown dependency failures and render those rows as unavailable.
**Production-live via PR #320 / merge `834b83d8382` (2026-09-20):** the first invitation preview is read-only;
the collection row and sealed contributor link are created only on explicit Send. A user's
invitation/reminder subject and body defaults live in Dataverse `wmkf_appuserpreferences`, not in
this Postgres row. One-off edits are not saved as defaults.

### `materials_upload_jobs` (migration 060; Production admission live; first job completed 2026-10-02)

Owner: durable background processing for applicant Site Visit materials uploads.
The ledger binds one `portal_upload_staging` row to a collection, request, fixed
checklist slot, actor binding, and token digest. It records queued/processing and
terminal status, bounded attempt count, retry time, worker lease, processing
deadline, clean malware-scan checkpoint, sanitized error code, and the exact
finalize receipt needed for replay. An active required-slot job is unique across
collections for the request; optional `other` uploads may have multiple active
jobs. A replacement is written under a unique `portal-${stagingId}` SharePoint
subfolder so prior bytes remain preserved until the new receipt is committed.
SharePoint remains the byte store and `wmkf_requestdocument` the published
receipt; this table owns neither.

**[PRODUCTION-LIVE via PR #407/#410, 2026-10-02:]** An infected verdict persists the sanitized
`{ok:false, scanRejection:{category,flags}}` in existing job `result_payload`,
including an infected `needs_attention` hold. The terminal failed path also
rejects staging and persists its replay payload; a hold leaves staging pending.
Applicant `jobs` expose this diagnostic only for failed infected jobs; staff
`uploadJobs` expose it for failed or attention-held infected jobs. Legacy or
invalid diagnostics fall back to an unspecified reason. No table or migration
changes are needed.

The worker at `/api/cron/drain-materials-uploads` claims at most one job per
invocation, checks the existing virus scanner, fences writes with a fixed
360-second lease (the worker does not renew it), resumes from a hash-bound scan
checkpoint, and calls the existing applicant materials finalizer. Transient failures use bounded exponential retry; terminal
failures that have a clean scan or SharePoint candidate become
`needs_attention` for coordinator review. The cron is source-configured every
minute with a five-minute function maximum. Public contributor context exposes
sanitized `jobs`; staff projections expose sanitized `uploadJobs` and counts.
Request-wide active jobs remain visible when a newer collection exists, so
Ready and manual/automatic reminders account for work admitted by an older
collection. Runtime read failures are rendered unavailable, never as confirmed
zero jobs. Five generic internal recursive document readers also opt into
pruning `portal-<UUID>` children beneath canonical Site Visit materials folders.
The original four-reader regression run passed five suites (79 tests, one
snapshot); the added Grant Reporting caller passed two suites (18 tests).

Admission is gated by `SITE_VISIT_MATERIALS_BACKGROUND_SCHEMA_READY=on`,
`SITE_VISIT_MATERIALS_BACKGROUND_ADMISSION_ENABLED=on`, and
`VIRUS_SCAN_ENABLED` enabled. The schema gate must follow a successful
migration-060 apply and physical readiness check; admission also requires the
schema gate. If admission is off, the existing synchronous finalize path is
used. **Production verified 2026-10-02:** schema readiness and admission are `on`, and virus scanning is `true`. PRs #404,
#407, and #410 are merged with all CI passing. Ready deployment
`dpl_2AacXcc5YQX9dNvJ4gMn4PpGtWWN` serves commit
`8fb8a6d83684a9d49b8450b26ef5bbef382f9a32` and the registered alias
`applications.wmkeck.org`. The first real job
`33630e07-4311-41b3-8aef-737a2962ce03` completed successfully on attempt 1,
with a clean scan checkpoint and consumed staging receipt; later worker runs
were healthy with an empty queue. See
`docs/plans/MATERIALS_BACKGROUND_PROCESSING_PLAN_2026-10-01.md` for exact times,
the read-only operator probe, and remaining verification bounds.

Terminal jobs expire after 30 days; rejected staging/blob cleanup uses the
existing exact-path cleanup with a seven-day retention. `scripts/materials-upload-job.js`
supports exact-job inspection and guarded retry/cancel on loopback Postgres. Its Production mode uses the fixed local-shell `MATERIALS_UPLOAD_PRODUCTION_DATABASE_URL`, explicit target/host/database, verified TLS, and exact job/action confirmations; inspection is read-only and connected database/schema assertions run inside the transaction. Retry can reset an exhausted attempt count and start a fresh two-hour budget only for an unleased `needs_attention` job with a matching unleased, unconsumed staging owner and a non-infected failure. **[PRODUCTION SOURCE AND READ-ONLY PATH VERIFIED 2026-10-02.]** PR #404 is merged. The owner-authorized agent probe passed Production target/TLS checks and returned expected `job_not_found` for the deliberately nonexistent UUID `00000000-0000-4000-8000-000000000000`; no recovery mutation was performed.
