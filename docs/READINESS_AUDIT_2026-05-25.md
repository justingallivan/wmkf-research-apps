# Backend Battle-Readiness Audit — 2026-05-25 (S186)

> **Senior-engineer perspective. Threat model: "a real user hits this flow tomorrow morning."** Not "the test suite passes."
>
> This audit was commissioned because the user has been doing behind-the-scenes work for many sessions and has not exercised the backend directly. The S185 audit restored doc/memory/atlas ground truth. This audit goes one layer deeper: operational / code / database ground truth.
>
> **Mode:** investigation first; numbered findings with severity tags; user picks the fix order.

## Severity tag legend

- **CONFIRMED** — verified against source or live state. Issue exists.
- **SUSPECTED** — pattern in source strongly implies the issue; no live probe yet.
- **WORTH PROBING** — surface hasn't been exercised recently; probe needed before "CLEAR" can be stated.
- **CLEAR** — explicit "checked and OK" verdict. Silence is not success.

## Effort legend

- **S** — under 30 min
- **M** — 30 min to 2 hr
- **L** — half-day or more

---

## Bucket 1: Stale-but-shipped backend surfaces

### B1-F1 — Intake portal endpoints have NO rate limiting. **(CONFIRMED, M)**

`/api/intake/draft/upload-token`, `/api/intake/draft/attach`, `/api/intake/submit` are applicant-session-protected but lack a per-applicant rate limiter. The external-reviewer routes got rate limiting in A6 (`lib/external/rate-limit.js`, commit `e0bc12b`) but the symmetric intake-portal counterparts didn't.

Concrete attack: an authenticated applicant repeatedly hits `/upload-token` — each call writes an `intake_audit` row, mints a Blob token, and appends a `pending_attachments` entry. With `field.maxFiles=Infinity` (only a `field_max_files_exceeded` 422 stops the loop when a cap exists), the JSONB column can grow until the row is unrecoverable, with only the 2h sweep cleaning up. Same applicant could also hammer `/attach` to pile virus-scan calls onto Cloudmersive's free-tier 800/mo quota.

Fix: build `lib/intake/rate-limit.js` keyed on `(contactOid, route)` mirroring the external-reviewer module's bucket+counter pattern + degraded-state alerting + invalid-attempt spike detection.

### B1-F2 — Drain backoff is a v1 placeholder, attempts unused. **(CONFIRMED, S)**

`pages/api/cron/drain-submissions.js:234-236`:

```js
const backoffSeconds = terminal ? 0 : Math.min(60 * Math.pow(2, 0), 3600);
// Note: real exponential backoff key off attempts; we read it back below.
```

`60 * 2^0 = 60` is a constant; `attempts` is never read in the calculation. A transient Dataverse 429 retries every 60s instead of backing off. With cron every 2 min and lease TTL 10 min, a perma-flaky job hammers Dataverse 30 times an hour with no growth in spacing.

Fix: `Math.min(60 * Math.pow(2, job.attempts), 3600)` — same site, replace `0` with `job.attempts`.

### B1-F3 — `DRAIN_MAX_ATTEMPTS_DEFAULT` declared but never enforced. **(CONFIRMED, S)**

`pages/api/cron/drain-submissions.js:74` declares `DRAIN_MAX_ATTEMPTS_DEFAULT` (default 10, env-overridable). The constant is never read anywhere in the file. A retryable error will retry forever until manual cancel or terminal classification.

Fix: in `recordFailure` after incrementing `attempts`, terminal-fail when `attempts >= DRAIN_MAX_ATTEMPTS`. Pair with B1-F2.

### B1-F4 — Intake private Blob store has no GC for completed submissions. **(SUSPECTED, M)**

Drain `handleFilesMoved` copies bytes from `INTAKE_BLOB_RW_TOKEN` store → SharePoint but does not delete the source Blob. `MaintenanceService.cleanupBlobs` lists with `list({ cursor, limit: 100 })` — defaults to the shared public store via `BLOB_READ_WRITE_TOKEN`; the intake private store isn't scanned. `sweepIntakePending` reaps only stale `pending_attachments`, not promoted `attachments[]` after a successful submit.

Net effect: every successfully-submitted draft's attachments live forever in the intake private store. Slow burn for pilot scope (mid-June, low volume); becomes a cost + retention concern as volume grows.

Fix options: (a) delete source bytes in `files_moved` after the per-file SharePoint upload confirms; (b) extend daily maintenance cron with a `cleanupIntakeBlobs` that scans with the intake token and reaps blobs whose `pathname` isn't in any active draft's `attachments[]` or `pending_attachments[]`. (a) is simpler; (b) gives belt-and-suspenders if (a) ever silently skips a file.

### B1-F5 — `handleScanning` creates a near-empty `akoya_request`. **(WORTH PROBING, M)**

`pages/api/cron/drain-submissions.js:350-357` — the Create body is just `akoya_requestid`, `akoya_Account@odata.bind`, and `...draftJson.dataverseFields`. `wmkf_formkey` is commented out (Connor Q1). The submit endpoint freezes the full draft JSON in `payload.draft_json` but only the `dataverseFields` subset reaches Dataverse; the rest sits in Postgres until the parent-aggregate PATCH ships.

If pilot form data has any fields not in `draft_json.dataverseFields`, those drop on the floor through the drain. Need a real test submit + DV inspection to map what actually populates vs what stays Postgres-side until the deferred handlers ship. Until then, anyone reading the request in Dataverse sees an effectively empty row pointing only to an institution.

This is intentional per Connor Q1/Q2 deferral, but the operational implication ("a real submission tomorrow morning lands as a near-empty row") deserves explicit acknowledgement in the runbook.

### B1-C1 — CLEAR: External reviewer flow.

Token mint/verify/extend, hash-only storage, revocation flag, expiry, per-token + per-IP rate limiting, deduped alerting on invalid-token spike + limiter-DB degraded state, multipart upload via shared `writeReviewFiles` core. Mature.

### B1-C2 — CLEAR: S184 three-call attach dance.

Heavy Codex pre+post-impl review across chunks 4-6, SQL-level cardinality gate (`promoteToClean` cap argument), removePending-first race-safe sweep ordering, body field allow-list + forbidden-field guard. Real-environment smoke still warranted (bucket 8), but code is defensively built.

### B1-C3 — CLEAR: Drain state machine to `dynamics_patched`.

Pre-gen GUIDs for child-row idempotency, duplicate_pk recovery in `recoverRequestCreated`, lease+token concurrency, transactional state-advance + audit (Codex round-6 §4), `BUILD_PENDING_STATES` parks rather than drops. Cron registered (`*/2 * * * *` in `vercel.json`). `dynamics_patched` and `status_flipped` park as designed per Connor Q1/Q2 deferral.

### B1-C4 — CLEAR: Reviewer Finder + Review Manager Dataverse-native paths.

W3-W6 cutover surfaces (`my-candidates`, `send-emails`) handle alt-key duplicate translation (412 → 409 with structured conflict id), lifecycle dispatcher per `templateType`, contact-promotion failure-tolerant, SSE event shape consistent. `ensureToken` auto-mints on accept-flip (idempotent).

### B1-C5 — CLEAR: Phase I Dynamics summarize-v2 + VRP.

Phase I: slim Executor reference call site, conflict 409 shape preserved, pre-flight overwrite guard. VRP: `claude` provider enforced in allowlist (synthesis + intelligence-pass unconditionally call Claude), proposal text bounded at route boundary via `wrapUntrustedContent`. Both mature.

## Bucket 2: Database health beyond reconcile

### B2-F1 — CLAUDE.md misstates the authoritative Postgres schema source. **(CONFIRMED, S)**

CLAUDE.md L251:
> Vercel Postgres. Authoritative source: `lib/db/schema.sql` + `lib/db/migrations/*.sql`.

That's wrong. `lib/db/schema.sql` is the legacy v1 schema (5 reviewer tables — `search_cache`, `researchers`, `publications`, `researcher_keywords`, `reviewer_suggestions`). Live state has ~30 tables. The actual authoritative source is `scripts/setup-database.js` — 1635 lines, 30+ `CREATE TABLE IF NOT EXISTS` statements, and the file that's *literally run* to set up a fresh DB. Migrations 002-014 patch on top of `setup-database.js`'s fresh-install state.

S185's reconcile work already made the source-of-truth set `schema.sql ∪ migrations ∪ setup-database.js`, but the CLAUDE.md text never got updated. Anyone reading CLAUDE.md as the entry point gets steered to the wrong file.

Fix: rewrite the §"Database Schema" line to: "Authoritative source: `scripts/setup-database.js` (fresh-install schema, 30 tables) + `lib/db/migrations/*.sql` (incremental migrations applied on top)." Decide separately whether `schema.sql` stays as a historical pointer or gets deleted.

### B2-F2 — `lib/db/schema-v2.sql` is orphaned. **(CONFIRMED, S)**

`lib/db/schema-v2.sql` (249 lines, "Expert Reviewer Finder v2 - Database Schema", documents itself as a "backwards-compatible" v2 add-on). Not referenced from any executable code — `grep schema-v2` finds only 2 atlas-doc historical pointers and 1 remediation-plan mention.

Fix: delete the file. Atlas mentions can stay as historical context or be cleaned up in the same commit.

### B2-F3 — Migration ordering: no `001_*.sql`. **(CONFIRMED / EXPECTED — informational)**

Migrations are 002-014. There is no 001. Per `docs/CLAUDE_REMEDIATION_PLAN.md` and the directory layout, pre-002 schema work was inline in `schema.sql` + ad-hoc scripts; `002_contact_enrichment.sql` was the first "proper" migration. Not a bug — but worth noting in CLAUDE.md so future auditors don't go looking for a missing file.

### B2-F4 — Migration idempotency: claimed in inline comments, not verified. **(WORTH PROBING, M)**

Sample read of `002_contact_enrichment.sql` shows `ADD COLUMN IF NOT EXISTS`. `setup-database.js`'s `submission_jobs` block explicitly warns that running it on a pre-011 shape will fail on index-create (loud-failure design — good). But there's no mechanical proof that re-running migrations 003-014 on top of themselves is no-op-safe. The Vercel deploy flow doesn't re-run them, so this only matters for: ops emergencies (operator runs `setup-database.js` against a partially-migrated DB), local-dev refresh, or future preview-env spin-ups.

Probe: stage a snapshot DB, apply migrations sequentially, then apply 003-014 a second time and assert zero diffs. Out of scope for this session unless prioritized; would catch any migration that drops the IF NOT EXISTS guard.

### B2-F5 — Backup / restore posture is undocumented. **(CONFIRMED, S)**

`docs/CREDENTIALS_RUNBOOK.md` and `docs/SECURITY_OPERATING_PLAN.md` don't mention Postgres backup cadence, retention, or restore-test cadence. Vercel Postgres (now Neon) has automated PITR snapshots, but there's no documented procedure for "what happens when we lose a table at 9am Monday."

Fix: add a §"Postgres backup / restore" section to `docs/SECURITY_OPERATING_PLAN.md` capturing Neon's snapshot retention window, the steps to spin up a branch-restore for a point-in-time recovery, and a recommended quarterly restore-test cadence. No code change.

### B2-F6 — Undocumented Dataverse entities: known mitigation, periodic re-sweep recommended. **(RE-SWEPT + DOC-RECONCILED — closed S188)**

S185 caught `wmkf_appproposalsearchs` (deployed, unconventional plural). `wmkf_app_request_person` / `wmkf_apprequestpersons` was a stale-row-count drift behind a capped probe (since reclassified). Both fixed. But the underlying risk — Connor deploys an entity under WMKF schema-deploy delegate privileges, atlas page never gets written — remains structural.

**S188 re-sweep:** ran `scripts/audit-dataverse-state.js`. Two artifacts surfaced that needed reconciliation:
- The audit script itself was hitting 404 on `wmkf_appproposalsearches` because of the unconventional pluralization (entity-set is `wmkf_appproposalsearchs` — no `e` before `s`). Fixed the script to use the live entity-set name and added an inline comment explaining the trap.
- `docs/POSTGRES_TO_DATAVERSE_MIGRATION.md:16`, `docs/APPLICATION_STATE_ATLAS.md:45,159`, and `docs/atlas/postgres-other-reviewer-tables.md:29` all still said `wmkf_appproposalsearch` was NOT DEPLOYED. The deep atlas page at `docs/atlas/dataverse-wmkf-apppublication-and-appgrantcycle.md` was correct (DEPLOYED + correct entity-set name). Reconciled all three stale references to match.
- `wmkf_app_z_publication_authors` 404 is the expected state (per `docs/REVIEWER_POSTGRES_TO_DATAVERSE_PLAN.md:113` — intentionally not deployed). Added a clarifying comment in the audit script so the 404 reads as "presence-confirmation guard hitting expected state" rather than a real miss.

Underlying structural risk still applies — re-run `scripts/audit-dataverse-state.js` quarterly or before any data-layer commits per CLAUDE.md guidance.

Fix: extend `scripts/audit-dataverse-state.js` (already exists) to emit "entity exists in DV, no matching atlas page" warnings as a CI gate input, similar to the Postgres side. Until that ships, schedule a manual DV entity sweep at the start of each major build cycle (or quarterly).

### B2-C1 — CLEAR: Schema-as-code completeness gate.

`check:atlas` runs `setup-database.js ∪ migrations ∪ schema.sql` as the source-of-truth set per S185 commit `f33711e`. The bucket "table in source-as-code but not live, or live but not in source-as-code" is currently at 0 entries.

### B2-C2 — CLEAR: `submission_jobs` fresh-install-only loud failure.

`setup-database.js:593-603` documents that running fresh-install on a pre-011 DB will fail on index-create. This is intentional loud-failure design ("loud failure better than silent divergence"). Good.

### B2-C3 — CLEAR: `playing_with_neon` retired.

Migration 014 dropped it 2026-05-19 (S185). Reconcile bucket clean. No new undeclared tables surfaced in this session's static scan.

## Bucket 3: Production environment integrity

### B3-F1 — `secret-check` cron tracking list is stale and incomplete. **(CONFIRMED, S)**

`pages/api/cron/secret-check.js:26-32` tracks 5 secrets: Azure AD client, Dynamics client, NextAuth, USER_PREFS_ENCRYPTION_KEY, CRON_SECRET. Missing from production-required list (per CLAUDE.md):

- `EXTERNAL_LINK_SECRET` (HMAC for external-reviewer JWTs)
- `IRS_VERIFY_SECRET` (shared secret for PowerAutomate IRS lookup caller)
- `BLOB_READ_WRITE_TOKEN` (shared blob store)
- `DVX_BLOB_RW_TOKEN` (Dataverse Export private store)
- `INTAKE_BLOB_RW_TOKEN` (intake portal private store)
- `CLOUDMERSIVE_API_KEY` (when `VIRUS_SCAN_ENABLED=true`)
- `EXTERNAL_AZURE_AD_CLIENT_SECRET` (applicant intake provider)

HMAC secrets don't have a vendor-side expiration, but the cron also reads `secret_rotation:*` keys and could enforce a recommended rotation cadence (90 / 180 days). Today, an operator has no automated reminder to rotate any of these.

`USER_PREFS_ENCRYPTION_KEY` is still load-bearing: `lib/services/dataverse-prefs-service.js:18` + `lib/services/database-service.js:30` import `encrypt/decrypt` for the API-key storage path. Keep tracked.

Fix: extend `TRACKED_SECRETS` with the 7 missing entries; pair each with a `secret_rotation:*` setting in Dataverse so the cron alerts at 14/7/0-day thresholds for rotation cadence (use a synthetic expiration = last_rotation + recommended_lifetime).

### B3-F2 — `INTAKE_BLOB_RW_TOKEN` not yet verified in prod. **(WORTH PROBING, S)**

Per S185 carryover. `/api/intake/draft/upload-token`, `/api/intake/draft/attach`, `MaintenanceService.sweepIntakePending`, and the drain's `handleFilesMoved` all fail loudly if the token is missing — so a real test submit would surface it. Verify before any first real intake submission: `vercel env ls production | grep INTAKE_BLOB_RW_TOKEN`.

### B3-F3 — Virus scanning is currently disabled in prod. **(CONFIRMED behavior, M to enable)**

Per CLAUDE.md and the memory carryover: `VIRUS_SCAN_ENABLED=false` (default) in prod, `CLOUDMERSIVE_API_KEY` not set, DFT email never sent. The reviewer-upload path (`lib/services/review-upload.js`) and intake-portal attach (`pages/api/intake/draft/attach.js:375-413`) both default to `scanner='skipped'` and write `scan_result='clean'` when the flag is off.

Net effect: a real reviewer-self-upload or intake-applicant attach in production today is **not** virus-scanned. The piping is built, the wire is unplugged. Acceptable for pilot scope (low volume, known reviewers, locked-down intake) but explicit operational state.

Fix when ready: file the Cloudmersive account, set `CLOUDMERSIVE_API_KEY` + `VIRUS_SCAN_ENABLED=true` in prod env, confirm DFT email goes out, monitor the free-tier 800/mo quota.

### B3-F4 — `DYNAMICS_IMPERSONATION_ENABLED` is still off in prod. **(SUSPECTED, S to flip)**

Per CLAUDE.md and memory `project-dynamics-identity-reconciliation`: delegate role granted 2026-05-06, S129 smoke PASS, but the env flag is still off "for safe rollout." Net effect: every Dynamics write today (reviewer-suggestion update, contact promotion, email send, AI summary writeback) shows the service-principal user as the actor in Dataverse audit logs, not the actual signed-in staff user.

The bridge + adapter chain is in place; the actor attribution just stays untrusted until the flag flips. Worth deciding before mid-June intake pilot whether the additional accountability layer should be on.

Fix: `vercel env add DYNAMICS_IMPERSONATION_ENABLED true` (prod), redeploy, watch `system_alerts` + audit-log spot-check for a week before declaring stable.

### B3-F5 — `VRP_ALLOWED_PROVIDERS` and per-app model overrides need a prod-state probe. **(WORTH PROBING, S)**

VRP fails closed if `VRP_ALLOWED_PROVIDERS` is missing OR `claude` isn't in it. The handler enforces both. Just needs `vercel env ls | grep VRP_ALLOWED_PROVIDERS` to confirm value.

Per-app model overrides live in Dataverse `wmkf_appsystemsettings`. CLAUDE.md notes admin-configurable; nobody's audited the live values recently. A retired model ID (e.g., a Sonnet 3.x string) would silently fail at call time, surface as an opaque 500. Run `scripts/audit-system-prompt-sizes.js` or write a quick query of `wmkf_appsystemsettings` filtered to `model_override:*` keys (the live prefix per `lib/services/model-override-loader.js:44` — the earlier text in this audit said `model_for_app:` which is wrong). S188 probe: 43 entries, all 4.x family, no retired 3.x strings; two older versions (`claude-opus-4-6`, `claude-opus-4-5-20251101`) worth review.

### B3-C1 — CLEAR: `EMERGENCY_AUTH_BYPASS` monitoring.

Cold-start hook in `instrumentation.js` raises a CRITICAL alert when set; daily `auth-bypass-check` cron at 07:30 UTC keeps the alert fresh on long-lived instances. Shared logic in `lib/utils/auth-bypass-monitor.js` so the two paths can't drift. Production fails closed via `lib/utils/auth-policy.js` if the lever isn't true.

### B3-C2 — CLEAR: `EXTERNAL_LINK_SECRET_PREVIOUS` rotation pattern.

`verifyToken` accepts both current and previous secrets during a rotation window; `mintToken` only signs with current. Documented in CREDENTIALS_RUNBOOK. Operationally clean.

## Bucket 4: Observability — is anyone reading the signals?

### B4-F1 — `dynamics_feedback` and `dynamics_query_log` have no review surface. **(PARTIALLY STALE — closed S188)**

The `dynamics_feedback` half of this finding was already shipped at audit time: `DynamicsFeedbackSection` exists at `pages/admin.js:1646` (rendered at line 2282), backed by `/api/dynamics-explorer/feedback` (GET/PATCH on `dynamics_feedback` rows, superuser-only). Negative-feedback rows from thumbs-down votes AND auto-detected failures (`autoDetected: true` rows the explorer service writes when it hits known failure patterns) BOTH land here for staff triage.

The `dynamics_query_log` half is left intentionally without a dedicated admin widget: the high-signal subset (failed queries) auto-promotes into `dynamics_feedback` via `FeedbackService.recordAutoFailure`, and the raw log is ad-hoc-diagnostic-only — not high-value enough to justify a constant widget. Closed without further action.

(Original audit framing was correct that no readers existed in `pages/api/admin/*` — but the admin surface for feedback is wired via `/api/dynamics-explorer/feedback`, not under `/admin/`, which is why the grep missed it. Path-narrow grep failure, not a real gap.)

Fix: small `/admin/dynamics-feedback` page reading the last N thumbs-down rows. Or remove the thumbs-down UI from Dynamics Explorer if no one's reviewing.

### B4-F2 — `model_pricing_audit` at 0 rows: ambiguous between healthy and silent. **(WORTH PROBING, S)**

Per memory + session prompt, `model_pricing_audit` has 0 rows since deployment. The monthly `pricing-refresh` cron writes here on `flagged=true`. 0 rows could mean (a) pricing is genuinely stable across runs (good) or (b) the monthly cron is mis-scheduled / failing silently (bad). The weekly `pricing-canary` cron writes alerts to `system_alerts`, not this table, so it doesn't help distinguish.

Probe: read `maintenance_runs` for recent `pricing-refresh` entries; if there are none, the monthly cron hasn't been firing. If there are entries but no audit rows, the canary genuinely sees stable prices.

### B4-F3 — `intake_audit` retention not defined. **(CONFIRMED, S)**

`intake_audit` is sha256-hashed append-only. Per CLAUDE.md, "will start accumulating once intake goes live." No retention policy is set; `MaintenanceService` has cleanup for `api_usage_log`, `dynamics_query_log`, `health_check_history` but not `intake_audit`. Pilot scale (low volume) makes this low priority, but the table will grow forever until someone decides on a policy.

Fix: add a retention setting `retention:intake_audit_days` (e.g. 730 / 2 years per common audit-log practice) + a `cleanupIntakeAudit(retentionDays)` method + a daily-maintenance call. Hash-only design means there's no PII to retain indefinitely.

### B4-C1 — CLEAR: `system_alerts` is read on /admin and emails on error/critical.

`pages/api/admin/alerts.js` reads. `NotificationService.notify` writes the row AND emails recipients resolved via `alertRecipientsByCategory` setting (Dataverse `wmkf_appsystemsettings`) with fallback to active superusers. ≥`error` severity always emails; `info`/`warning` only when `emailAdmins: true` is passed. Wired end-to-end.

### B4-C2 — CLEAR: `health_check_history` is alert-wired.

`pages/api/cron/health-check.js` runs every 15 min; failures route through `NotificationService.notify` (category=`ops`). 30-day retention cleanup runs in daily maintenance.

### B4-C3 — CLEAR: `maintenance_runs` audit trail.

Every cron uses `MaintenanceService.startRun`/`completeRun`. `getLastRuns()` surfaces the last entry per `job_name` for the maintenance dashboard. Failure rows have `status='failed'` + `error_message`; visible.

### B4-C4 — CLEAR: `api_usage_log` burn-down.

`MaintenanceService.cleanupUsageLog(90)` runs daily; spend monitored via `/api/cron/spend-check` hourly with NotificationService alerts.

## Bucket 5: Auth integrity

### B5-F1 — External Entra ID OTP flow not exercised recently. **(EXERCISED — closed S188)**

Per S129 memory + carryover, the dual-provider NextAuth is wired and the round-trip was verified at deployment. No exercise since. Provider config can drift (tenant client-secret expiry, callback URL mismatch on a redeploy). Worth a real round-trip before any first applicant lands. Bucket 8 covers this as a dry-run candidate.

**S187 exercised this end-to-end.** Smoke-testing of preview DR8 surfaced that production AND preview were both missing the `entra-external` provider because the three `EXTERNAL_AZURE_AD_*` env vars had never been deployed. Operator (Justin) provisioned the env vars in Vercel production with a fresh client secret; production then returned both `azure-ad` AND `entra-external` from `/api/auth/providers`. Justin completed a real OTP round-trip end-to-end: signed in as `nick_sludge.78@icloud.com` (OID `3bba39e3-2712-4c06-ae2a-9646afd3d6ce`), `/apply` welcome page rendered correctly with claims populated. Two UI bugs surfaced during the round-trip — sign-out silently re-authenticates, and Entra sign-up flow collects irrelevant City/State/DisplayName — both held for a dedicated UI session (memory `project-intake-portal-ui-todo`).

### B5-F2 — Idle-timeout depends on `token.lastActivity` being set. **(CONFIRMED minor, S)**

`proxy.js:100-102` only fires the 2h idle bounce if `token?.lastActivity && ...`. `pages/api/auth/[...nextauth].js` sets lastActivity at lines 217 (sign-in), 226 (token refresh / bridge update), 232 (post-idle reset). Three set-sites cover every JWT callback path, so in practice every issued token carries it.

However: the guard is "fail-open if absent" — a future code path that issued a token without going through the lastActivity-set lines would silently exempt that session from idle timeout. Better: invert to `if (!token?.lastActivity || Date.now() - lastActivity > IDLE)`, treating missing as expired. Minor — defensive hardening, not a bug.

### B5-C1 — CLEAR: dual-provider non-crossing enforced at proxy layer.

`proxy.js:104-116` — `/apply` and `/api/apply` reject anything other than `userType==='applicant' && contactOid`. Staff surface (everything else) rejects `userType==='applicant'` explicitly before checking azureId. Symmetric, fails closed.

### B5-C2 — CLEAR: external-token routes correctly allowlisted.

`/external/*` and `/api/external/*` bypass NextAuth at proxy.js:93 but stay inside the proxy function (CSP headers still applied). Each external endpoint runs `verifySuggestionToken` + `checkRateLimit` at handler entry. Bypass + handler-level check is correct.

### B5-C3 — CLEAR: `/api/cron/*` + `/api/irs/*` matcher exclusion.

proxy.js:137 matcher correctly excludes both. Cron routes verify `CRON_SECRET`; IRS verify-EIN endpoint verifies `IRS_VERIFY_SECRET`. Each route handles its own shared-secret auth.

### B5-C4 — CLEAR: disabled-user blocking is defense-in-depth.

`is_active=false` is checked in `lib/utils/auth.js`'s `requireAppAccess`/`requireAuth` (with 2-min cache TTL). Proxy lets through any valid JWT (page shell loads); every API call returns 401. Disabled-before-superuser-bypass order preserved per CLAUDE.md.

### B5-C5 — CLEAR: route coverage gated by `check:api-routes`.

CI gate `npm run check:api-routes` blocks PRs that add a route to `pages/api/**` without an `API_ROUTE_SECURITY_MATRIX.md` entry — and the matrix entry must declare auth posture. 93 routes covered, green at session start.

## Bucket 6: Stale memory / docs spot-check

### B6-F1 — CLAUDE.md §"Database Schema" misstates source-of-truth. **(CONFIRMED — see B2-F1)**

Cross-reference: same finding as B2-F1. The §"Database Schema" line points at `lib/db/schema.sql + lib/db/migrations/*.sql` as authoritative; actually `scripts/setup-database.js` is. Fix in CLAUDE.md edit.

### B6-F2 — `EXECUTOR_CONTRACT.md` is dated "May 1 2026 cycle target" — drift potential. **(WORTH PROBING, M)**

Doc front-matter says **Status: Draft spec, May 1 2026 cycle target / Created: 2026-04-24**. `lib/services/execute-prompt.js` has continued evolving since (e.g. commit `95c0f4e` "Executor output-schema validation"). Drift between draft spec and shipped behavior is a real risk before prompt work resumes (Phase I-Dynamics is the active surface).

Fix: diff the contract spec against `execute-prompt.js` Phase 0 reality, update or freeze the spec accordingly. Defer until prompt-tuning work picks back up unless the user wants it now.

### B6-C1 — CLEAR: Atlas pages all verified within 30 days.

Every `Last verified` line in `docs/atlas/*.md` is dated 2026-05-07 → 2026-05-25. Most reviewer/Postgres tables re-verified 2026-05-19 (S167 drain audit). `wmkf_portalmembership` deployed 2026-05-22 (S178). Operational tables re-probed 2026-05-25.

### B6-C2 — CLEAR: `INTAKE_PORTAL_DRAIN_PLAN.md` aligns with shipped drain.

Spot-check of BUILD_PENDING_STATES, status_flipped deferral, next_attempt_at backoff plan all map 1:1 to `pages/api/cron/drain-submissions.js`. Plan §"Phase B deploy handoff" matches the unpark-SQL mentioned in source comments.

### B6-C3 — CLEAR: S185 audit closed the bulk of memory drift.

The 2 ground-truth audit docs (`AUDIT_DOCS_GROUND_TRUTH_2026-05-25-{A,B}.md` in `docs/archive/`) cover the heavy reconcile pass. Per `MEMORY.md`, all dated entries either reference current state or have an `as-of` annotation. No new drift surfaced in this session's static survey.

## Bucket 7: Code smells / dead code

### B7-F1 — Wave 1 dispatcher Postgres branches: dead code, retained as kill-switch. **(VERIFIED INTENTIONAL — closed S188)**

`lib/services/settings-service.js`, `app-access-service.js`, and `dataverse-prefs-service.js` each carry a `useDataverse() → bool` branch that defaults to Dataverse but falls through to raw Postgres SQL if `WAVE1_BACKEND_*=postgres` is set. The underlying tables were dropped 2026-05-12. The branches remain "as an explicit opt-out signal" — running the Postgres path would 500 with `relation does not exist`.

**S188 disposition:** keep as-is. The existing inline comment at each dispatcher (`app-access-service.js:34` and parallel sites) already labels intent — "Default Dataverse; explicit 'postgres' fails loudly (table dropped 2026-05-12)". The loud-failure mode is genuinely diagnostic (an operator who flips the env var as a panic measure discovers immediately that Postgres is gone, not silently corrupted). Replacing with a startup throw would lose the diagnostic surface for marginal LOC savings. The cleaner-throw variant proposed below is documented but not adopted.

This works as intended but carries ~30 lines of dead SQL per service. Cleaner: replace the dispatch helper with a startup throw when the env var is `postgres`:

```js
if (process.env.WAVE1_BACKEND_SETTINGS === 'postgres') {
  throw new Error('Wave 1 Postgres path retired 2026-05-12 — unset WAVE1_BACKEND_SETTINGS');
}
```

Then delete the inline Postgres branches. Same loud-failure semantic, less code to maintain. Tail item from the Wave 1 closeout memory.

### B7-F2 — `prompt-resolver.js` is "legacy" but still load-bearing. **(CONFIRMED, INFORMATIONAL)**

3 scripts still depend on it: `scripts/audit-system-prompt-sizes.js`, `scripts/compare-phase-i-v1-v2.js`, `scripts/ab-phase-i-prompts.js`. Live API routes have all migrated to the Executor. Per memory and CLAUDE.md, this is documented; don't retire `prompt-resolver.js` until those 3 scripts are either retired or migrated to the Executor.

### B7-F3 — `docs/archive/` is accumulating. **(DEFERRED — S188 triage)**

S188 re-survey: 50 files / 532 KB. Not a disk-or-grep problem at this size. Per-file delete-vs-keep is user-judgment work (which 2026-03 code-review threads still hold architectural context? which IT-correspondence threads are referenced by current docs? etc.) and not autonomous-fixable. Aging policy proposal (apply when archive grows another ~25 files or hits 1 MB): default-delete files whose mtime is >6 months old AND whose contents are point-in-time correspondence/reviews superseded by current docs; default-keep architectural-decision records regardless of age. Out of scope this slice.

### B7-F4 — One skipped test in `tests/unit/utils/apiKeyManager.test.js:59`. **(CONFIRMED, S)**

```js
test.skip('handles encryption errors gracefully', () => { ... });
```

No skip-reason comment. Either fix the test or delete it.

### B7-W1 — `npm ls` / `depcheck` not run. **(WORTH PROBING, S)**

Out of scope for static review. Bucket 8 candidate.

### B7-C1 — CLEAR: No silent describe.skip / test.skip blocks at scale.

Single skip found across `tests/unit/**`. No broken test suites silently disabled.

## Bucket 8: Operational dry-runs

_Listed only — gated on user approval per-item. Each is a candidate exercise to convert "WORTH PROBING" findings above into CONFIRMED state._

### B8-DR1 — End-to-end intake submission smoke (preview env).

Submit a fixture intake draft via authenticated curl → confirm `/api/intake/draft/upload-token` → PUT to Blob → `/api/intake/draft/attach` → `/submit` → watch `submission_jobs` and `intake_audit` row transitions through `queued → scanning → request_created → files_moved → dynamics_patched` (parks here per BUILD_PENDING). Confirms B1-F4/F5 ambiguities + B3-F2 INTAKE_BLOB_RW_TOKEN + B4-F3 audit retention scope.

**Risk:** writes a real `akoya_request` and SharePoint folder in the connected Dataverse + SP tenant. Run against preview env, not prod, unless cleanup is planned.

### B8-DR2 — Manual `sweepIntakePending` invocation.

Force a stale `pending_attachments` entry (timestamp older than 2h cutoff), run the daily maintenance cron with a forced trigger. Confirms the race-safe removePending-first ordering in real Postgres + Blob.

### B8-DR3 — External reviewer token full round-trip.

Mint a token for a sandbox suggestion row, walk through `/external/review/[token]` landing page, accept, download a fake reviewer-materials file, submit a review with a fake PDF, confirm `wmkf_reviewreceivedat` populates + token expires 7d post-submit. Confirms B5-F1 if run in preview against External ID tenant.

### B8-DR4 — Trigger `/api/cron/health-check` manually + with a deliberately-broken service.

Hit the endpoint with `Authorization: Bearer $CRON_SECRET`; flip a service flag (e.g. unset `DYNAMICS_CLIENT_SECRET` in preview) and re-run to confirm the failure path raises a NotificationService alert end-to-end (alert row + email).

### B8-DR5 — Send a test `/api/admin/policies` publish.

Verify the `policy_publish_audit` row pair (pending → final) lands + the Dynamics PATCH ordering holds. Low-risk if directed at a sandbox policy slot.

### B8-DR6 — Re-run `scripts/audit-postgres-state.js` + `scripts/audit-dataverse-state.js`.

Both safe (read-only). Refreshes the Atlas verification timestamps + surfaces any new undocumented DV entities (B2-F6). Recommended cadence per CLAUDE.md.

### B8-DR7 — `npm ls --depth=0` + `npx depcheck`.

Both read-only. Surfaces unused deps + version-mismatch warnings.

### B8-DR8 — External Entra ID OTP round-trip (preview).

Send a magic-link OTP to a fixture applicant email; complete sign-in; confirm session payload has `userType='applicant'` + valid `contactOid` + non-crossing enforcement against staff surfaces. Confirms B5-F1.

---

## Codex second-pass recalibrations (2026-05-25)

Codex independently probed `.env.local` Postgres (own queries against `information_schema`) and confirmed 0a/0b plus the absence of any `schema_migrations` / `migrations` tracker table. Three recalibrations changed the original Claude findings:

- **0c root cause is a CommonJS import bug, not minified-bundler interop.** `lib/services/maintenance-service.js:13` does `const DatabaseService = require('./database-service')`, but `lib/services/database-service.js:618` exports `{ DatabaseService }` (named). The whole module object is bound to `DatabaseService`; `.cleanupExpiredCache` is undefined on it. Verified by direct read of both files. **Fix: change to `const { DatabaseService } = require('./database-service');`** (S). Other callers in the codebase destructure correctly.
- **0e silent crons downgraded from P0 to P1/P2.** Codex traced the handlers and confirmed `pricing-canary` and `spend-check` only write `system_alerts` on findings + auto-resolve on healthy paths; `sweep-stale-invites` only logs when work or errors exist. So "zero alerts" doesn't prove the cron never ran. **The real source-side bug is a separate, new P1 finding (below):** these crons lack durable success telemetry (no `MaintenanceService.startRun` call) so "healthy but ran" is indistinguishable from "never invoked" using DB state alone.
- **B3-F3 / Codex-P2: reviewer-upload virus-scan audit wording was wrong.** The original audit said reviewer uploads default to `scanner='skipped'`. Codex verified the actual source: reviewer uploads (`lib/services/review-upload.js:110-120, 176-184`) simply skip `runVirusScans()` when the flag is off and do not persist scanner metadata in the Dataverse patch. Only intake-portal `attach.js` writes `scanner: 'skipped'`. Fix the audit framing accordingly.

### New findings from Codex pass

- **🆕 P1 — `cleanupExpiredCache` daily failure root cause** (recalibrated 0c): the `require` interop bug above. Trivial one-line fix. Verified by direct read.
- **🆕 P1 — `pricing-canary`, `spend-check`, `sweep-stale-invites` lack durable success telemetry.** None call `MaintenanceService.startRun`. Add `startRun`/`completeRun` to each so "healthy but ran" is distinguishable from "never invoked". Then re-run DR6c after a known-trigger to validate whether they're actually being invoked by Vercel.
- **🆕 P1 — Daily maintenance cron masks subtask failures as `completed`.** `pages/api/cron/maintenance.js:39-99, 109-135` swallows each subtask error into `results.*: { error }` then records `status: 'completed'` and sends an `info`-level notification even when a subtask failed. This is why the `cleanupExpiredCache` failure and the `intakePending` failure have been visible in `system_alerts` text but not in `maintenance_runs` status — every daily run is "completed" regardless of subtask outcomes.
- **🆕 P1 — Drain classifier's per-category `maxAttempts` contract is implemented but ignored by the caller.** `lib/utils/drain-error-classifier.js:20-38, 111-117` returns `maxAttempts` per category (transient 10, scan 3, etc.). `pages/api/cron/drain-submissions.js:388-395, 725-732` only consults `cls.retryable` / `cls.terminal`; `cls.maxAttempts` is dropped. Pair this with the B1-F2/F3 backoff+cap fix so the right per-category cap drives terminal-fail.
- **🆕 P1 (severity upgrade) — Missing `jose` direct dep blast radius is production token paths, not just tests.** Original B7-F7 framing implied a tests-only concern; Codex notes `lib/services/external-token.js:30` and `lib/services/dataverse-export/result-token.js:18` import `jose` directly. Currently works via transitive resolution from `next-auth`; a future minor version bump could break external-reviewer auth + DVX result tokens silently.

## Dry-run results (DR6, DR7 — 2026-05-25)

Read-only probes were executed and converted several WORTH PROBING items.

### DR6a — `scripts/audit-postgres-state.js` results

- **`reviewer_suggestions`: 337 rows.** `accepted`/`declined`/`invited` columns show 100% populated; these are boolean defaults at insert, not engagement signals. `response_received_at` 7%, `email_sent_at` 13%, `materials_sent_at` 6% — actual lifecycle activity is sparse (consistent with the recent J26 cycle only).
- **`grant_cycles`: 13 rows; `review_deadline`, `review_template_blob_url`, `additional_attachments` all 0% populated.** Confirms W3 cutover moved active state to Dataverse `wmkf_appgrantcycle`; the Postgres table is drain-only with default-empty columns. ✅
- **`researchers`: 331 rows, 1 with orcid, 1 with scholar, 0 with h-index.** The h-index field on the Reviewer Finder UI surfaces a number from `wmkf_appresearcher.wmkf_hindex` (Dataverse, post-W6) but per the pre-cutover Postgres drain, **h-index has never been populated for any row**. Per user 2026-05-25: the discovery/search pipeline never captured h-index values; deferred to a later session for the search-side fix. **B7-F5 documented but deferred — not in S186 fix scope.**
- **`proposal_searches`: 0 rows.** Confirmed dead writer (W6 retirement).
- **`search_cache`: 0 rows.** Cache disabled / unused.

### DR6b — `scripts/audit-dataverse-state.js` results

- `wmkf_appreviewersuggestions` sample row populates correctly with `wmkf_grantcyclecode='J26'`, `wmkf_responsetype=100000002` (no_response), invited/accepted/declined flags consistent.
- **`akoya_requests` sample row 1002787 (Phase I Pending)**: `wmkf_ai_summary`, `wmkf_ai_compliancecheck`, `wmkf_ai_complianceissues`, `wmkf_ai_dataextract`, `wmkf_ai_fitassessment`, `wmkf_ai_fitrationale` all populated. **Executor writeback path is producing data in prod.** ✅
- **Audit script defect — `wmkf_appgrantcycles SCHEMA PROBE` errors with 501 / `0x8006088a`**: `"startswith" function isn't supported for Metadata Entities`. The probe's EntityDefinitions filter uses `startswith`, which Dataverse rejects on the metadata endpoint. **New finding: B2-F7 — `scripts/audit-dataverse-state.js` schema probe is broken for metadata entities.** Doesn't affect the data probes above, but a CI-gated audit script that errors silently in one section is a future blind spot.

### DR6c — Prod Postgres schema probe (read-only, 2026-05-25)

A direct query against the prod Postgres surfaced several state items not visible from source-only review:

- **🚨 P0-A: Migration 013 (`intake_drafts_pending_attachments`) is NOT applied to prod.** `pending_attachments` column does not exist on `intake_drafts`. Today's `daily-maintenance` cron alert (id 151, 2026-05-25 10:00 UTC) explicitly logs `intakePending: ERROR - column d.pending_attachments does not exist`. **The S184 three-call attach dance (chunks 4-6, 13 commits, ~200 unit tests, multiple Codex review passes) is non-functional in prod.** Any call to `/api/intake/draft/upload-token`, `/attach`, `/api/intake/submit`'s A1 guard, or `sweepIntakePending` would 500.
- **🚨 P0-B: Migration 011 (`submission_jobs_states`) is NOT applied to prod.** `locked_until`, `lease_token`, `akoya_requestnum` columns missing from `submission_jobs`. The drain cron `claimBatch` query references all three — verified to fail with `column "locked_until" does not exist`. **`/api/cron/drain-submissions` has been silently erroring every 2 minutes since deployment** (no error surface; the cron doesn't `MaintenanceService.startRun`).
- **🚨 P0-C: `MaintenanceService.cleanupExpiredCache` daily failure.** Today's maintenance alert shows `cache: ERROR - n.cleanupExpiredCache is not a function` (minified `n` = bundled DatabaseService reference). The function IS defined at `lib/services/database-service.js:167` — likely a runtime require/export interop issue, not a code-absence issue. Daily failure since at least 2026-05-23.
- **🚨 P0-D: No migration tracker table exists.** No `schema_migrations` / `migrations` row tracking. Migrations are applied ad hoc with no record of what's applied where. This is the structural cause of P0-A and P0-B drifting past notice.
- **🚨 P1: Multiple crons have ZERO observable side effects.** `pricing-canary` (weekly), `spend-check` (hourly), `sweep-stale-invites` (daily): each is in `vercel.json`'s `crons[]`, each writes to `system_alerts` on findings, but `system_alerts` has zero rows for any of them. By contrast, `health-check`, `log-analysis`, `secret-check`, `auth-bypass-check`, `daily-maintenance` are all running and visible (counts: 1399, 58, 15, 4, 91). Possible causes: Vercel Hobby plan 2-cron limit (no — at least 5 crons are running), older deployment without these handlers, or silent error before any side effect. Needs verification at Vercel-deployment layer.
- **Empty surfaces** (informational): `intake_drafts` 0, `submission_jobs` 0, `intake_audit` 0, `external_rate_limit` 0, `model_pricing_audit` 0, `dynamics_feedback` 2 (most recent 2026-05-14), `dynamics_query_log` 1417, `health_check_history` 2933 (most recent 2026-05-25T23:15Z), `maintenance_runs` 1566, `system_alerts` 149, `irs_exempt_orgs` 1,264,156, `researchers` 331, `reviewer_suggestions` 337, `retractions` 68,248.
- **Non-healthy `health_check_history` rows on 2026-05-22 15:00-16:00 UTC** (multiple consecutive `unhealthy`). Worth a one-time investigation in Bucket 4 follow-up; the system has since returned to healthy.

### DR7 — npm dependency state

- **`@emnapi/runtime` extraneous** — transitive that surfaces as extraneous on macOS arm64. Benign.
- **`depcheck` unused (likely false positives):** `tailwindcss`, `autoprefixer`, `postcss` (config-loaded), `@testing-library/react`, `@testing-library/user-event` (test-runner-loaded), `jsdom` (jest env). All used via config / runner, not import-traced. Ignore.
- **`depcheck` unused (worth verifying):** `cors`, `formidable`, `helmet`, `multer`, `lucide-react`. Each could be genuinely orphaned post-refactor — grep before deleting. **New finding: B7-F6 — 5 npm deps potentially orphaned; verify and remove if confirmed.**
- **`depcheck` missing (CONFIRMED):**
  - `@jest/globals` used by `tests/unit/adapters-caller-id.test.js`
  - `jose` used by `tests/unit/dataverse-export.test.js`
  - `@babel/parser` used by `scripts/lib/canonical-facts.js`
  These are runtime/test imports without declared dependency entries — they currently work because they're transitives of `next-auth` / etc, but a future minor-version bump could remove them and break tests / the canonical-facts script silently. **New finding: B7-F7 — 3 missing direct dependencies depend on transitive resolution.**

## Prioritized findings list

Severity rubric: **P0** blocks "user lands tomorrow morning"; **P1** is correctness with deferred blast radius; **P2** is hygiene / forward-looking. Findings already covered by CLEAR verdicts are excluded.

### P0 — Blocking for the next real submission

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| **0a** | **DR6c P0-A** Migration 013 not applied to prod — **intake portal is non-functional in prod** | CONFIRMED | S (apply mig) |
| **0b** | **DR6c P0-B** Migration 011 not applied to prod — **drain has been silently erroring every 2 min** | CONFIRMED | S (apply mig) |
| **0c** | **DR6c P0-C** Daily `cleanupExpiredCache` failing — **Codex root cause: CommonJS named-export import bug** at `maintenance-service.js:13` | CONFIRMED | S |
| **0d** | **DR6c P0-D** No migration tracker table — structural cause of 0a/0b drift (Codex independently verified absence) | CONFIRMED | M |
| **0e** | **Codex recalibration — DOWNGRADED to P1/P2.** Crons may simply have no healthy-path alerts; real bug is missing `MaintenanceService.startRun` (see new P1 below) | P1 telemetry gap | S |
| 1 | **B3-F2** INTAKE_BLOB_RW_TOKEN not verified in prod | CONFIRMED | S |
| 2 | **B3-F3** Virus scanning disabled in prod (no scan happens today) | CONFIRMED | M |
| 3 | **B3-F5** VRP_ALLOWED_PROVIDERS + per-app model overrides not verified in prod | WORTH PROBING | S |

### P1 — Correctness / latent operational

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 4 | **B1-F1** No rate limiting on `/api/intake/draft/{upload-token,attach}` + `/submit` | CONFIRMED | M |
| 5 | **B1-F2** Drain `recordFailure` backoff is constant 60s; `attempts` unused | CONFIRMED | S |
| 6 | **B1-F3** `DRAIN_MAX_ATTEMPTS_DEFAULT` declared but never enforced | CONFIRMED | S |
| 7 | **B1-F4** No GC for intake private Blob store after successful submission | SUSPECTED | M |
| 8 | **B3-F1** secret-check tracking list missing 7 production-required secrets | CONFIRMED | S |
| 9 | **B3-F4** DYNAMICS_IMPERSONATION_ENABLED still off (every DV write attributed to service principal) | SUSPECTED | S |
| 10 | **B4-F1** dynamics_feedback / dynamics_query_log have no review surface | CONFIRMED | M |
| 11 | **B4-F3** intake_audit has no retention policy | CONFIRMED | S |

### P2 — Hygiene / documentation / forward-looking

| # | Finding | Severity | Effort |
|---|---------|----------|--------|
| 12 | **B2-F1 / B6-F1** CLAUDE.md misstates Postgres schema source-of-truth | CONFIRMED | S |
| 13 | **B2-F2** `lib/db/schema-v2.sql` orphaned (delete) | CONFIRMED | S |
| 14 | **B2-F5** Backup / restore posture undocumented | CONFIRMED | S |
| 15 | **B5-F2** Idle-timeout `lastActivity && ...` guard is fail-open if absent | CONFIRMED minor | S |
| 16 | **B1-F5** Drain `handleScanning` creates near-empty `akoya_request` (intended per Connor Q1/Q2) | WORTH PROBING | M |
| 17 | **B4-F2** `model_pricing_audit` at 0 rows: probe canary actually running | WORTH PROBING | S |
| 18 | **B6-F2** EXECUTOR_CONTRACT.md draft spec vs shipped `execute-prompt.js` drift | WORTH PROBING | M |
| 19 | **B7-F1** Wave 1 dispatcher dead Postgres branches: simplify to startup throw | CONFIRMED | S |
| 20 | **B7-F3** docs/archive/ housekeeping (49 files; many >8 weeks) | CONFIRMED | S |
| 21 | **B7-F4** One skipped test in `apiKeyManager.test.js:59` | CONFIRMED | S |
| 22 | **B2-F4** Migration idempotency not mechanically verified | WORTH PROBING | M |
| 23 | **B2-F6** Periodic DV entity sweep cadence undocumented | WORTH PROBING | M |
| 24 | **B7-F5 (DR6a)** Researcher h-index column unpopulated — UI surfaces vacant value | CONFIRMED | M |
| 25 | **B2-F7 (DR6b)** `audit-dataverse-state.js` schema probe broken (`startswith` 501) | CONFIRMED | S |
| 26 | **B7-F6 (DR7)** 5 potentially orphaned npm deps (`cors`, `formidable`, `helmet`, `multer`, `lucide-react`) | CONFIRMED | S |
| 27 | **B7-F7 (DR7)** 3 missing direct deps (`@jest/globals`, `jose`, `@babel/parser`). **Codex severity upgrade**: `jose` is on production external-reviewer + DVX-result-token auth paths, not just tests | CONFIRMED, **upgraded to P1** for `jose` | S |
| 28 | **Codex new P1** — pricing-canary / spend-check / sweep-stale-invites lack durable success telemetry (`MaintenanceService.startRun`) | CONFIRMED | S |
| 29 | **Codex new P1** — daily maintenance cron records `status='completed'` even when subtasks fail | CONFIRMED | S |
| 30 | **Codex new P1** — drain classifier's per-category `maxAttempts` is implemented but ignored by caller | CONFIRMED | S (pair with #5/#6) |

## Recommended fix order

This is a suggested sequencing — the user picks. Effort uses the legend at the top.

### Phase A — "Make the next real user safe" (~1 session, M total)

Goal: close the P0s so a real submission tomorrow morning works and is observable.

1. **#1 — verify INTAKE_BLOB_RW_TOKEN in prod** (S) — single `vercel env ls`. Likely already set; just confirm.
2. **#3 — verify VRP_ALLOWED_PROVIDERS + spot-check model overrides** (S) — `vercel env ls | grep VRP`, then read `wmkf_appsystemsettings` for `model_override:*` keys.
3. **#2 — decide on virus scanning posture for pilot** (M) — either (a) accept "no scanning during pilot, document explicitly" + clean up the misleading `scanner='skipped'` audit row label, or (b) commit to enabling Cloudmersive before pilot launch.
4. **B8-DR1 / DR8 — preview-env smoke tests** for intake + Entra OTP (M).

### Phase B — "Drain hardening before any real intake volume" (~1 session, M total)

5. **#5 + #6** drain backoff + max-attempts (S+S) — small contained patch to `drain-submissions.js`.
6. **#4 — intake portal rate limiting** (M) — build `lib/intake/rate-limit.js` paralleling external-reviewer's.
7. **#7 — intake private Blob GC** (M) — either delete-after-SharePoint-upload in `handleFilesMoved`, or extend daily maintenance cron with a private-store sweep.

### Phase C — "Audit and observability tightening" (~half a session)

8. **#8 — extend secret-check TRACKED_SECRETS** (S).
9. **#9 — decide on DYNAMICS_IMPERSONATION_ENABLED for pilot** (S) — flip + spot-check or document deferral.
10. **#11 — intake_audit retention** (S).
11. **#10 — Dynamics feedback review surface** (M) — small `/admin/dynamics-feedback` page OR remove the thumbs-down UI.

### Phase D — "Docs + hygiene catch-up" (~half a session)

12. **#12 + #13 + #14** CLAUDE.md schema text + delete schema-v2.sql + add backup docs (S+S+S).
13. **#19** simplify Wave 1 dispatcher (S).
14. **#15** invert idle-timeout guard (S).
15. **#20 + #21** archive review + unskip test (S+S).

### Deferred (track but don't block)

16. **#16** drain handleScanning empty-request behavior — depends on Connor Q1/Q2.
17. **#17** pricing canary live probe — DR6 covers.
18. **#18** EXECUTOR_CONTRACT.md drift — defer until prompt-tuning work resumes.
19. **#22** migration idempotency proof — defer until next migration land or restore-test exercise.
20. **#23** DV entity sweep automation — defer until next major build cycle.

## What "ready for battle" looks like after Phase A+B

- INTAKE_BLOB_RW_TOKEN + VRP_ALLOWED_PROVIDERS confirmed in prod.
- Virus-scan posture is explicit (on with quota monitoring, or off with documentation).
- A real submission lands in Dataverse, copies files to SharePoint, parks at `dynamics_patched` (intended), and an operator can see the parked state in `system_alerts` + `maintenance_runs`.
- Intake portal endpoints rate-limited; an authenticated applicant can't flood `pending_attachments`.
- Drain has exponential backoff + a real max-attempts terminal cap.
- Source-of-truth docs (CLAUDE.md schema text, backup posture) accurate.

The remaining P2s are good cleanup but not pilot-blocking.
