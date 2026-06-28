# Backend Battle-Readiness Audit — Codex Discussion Report

**Session:** 186
**Date:** 2026-05-25
**Reviewer:** Claude (Opus 4.7), single-session pass
**Branch:** main (clean, c8dc122)
**Companion doc:** [`docs/archive/READINESS_AUDIT_2026-05-25.md`](READINESS_AUDIT_2026-05-25.md) (full bucket-by-bucket findings + dry-run details)

---

## 1. Scope and posture

S186 was commissioned because the user had been doing behind-the-scenes work for many sessions and had not exercised the backend directly. The threat model was deliberately not "tests pass" but rather **"a real user hits this flow tomorrow morning."**

The audit covered eight buckets:

1. Stale-but-shipped backend surfaces (S184 attach dance, drain cron, external reviewer flow, Reviewer Finder Dataverse-native, Review Manager email, Phase I Dynamics writeback, VRP)
2. Database health beyond reconcile (undeclared state, migration ordering / idempotency, undocumented DV entities, schema-source drift, backup posture)
3. Production environment integrity (secrets, env vars, kill switches, per-app model overrides)
4. Observability (alert read paths, cron-driven audit trails, feedback loops)
5. Auth integrity (proxy.js coverage, dual-provider non-crossing, disabled-user blocking, external OTP)
6. Stale memory / docs spot-check
7. Code smells / dead code (legacy services, dispatcher dead branches, `docs/archive/`, unused deps, rotted tests)
8. Operational dry-runs (gated on user approval per-item)

Modes used:

- **Investigation first.** No code was edited in this session.
- **Static review** for the source code of each surface (~9 files read end-to-end).
- **Read-only live probes** for the prod Postgres state and npm dep graph (DR6 + DR7).
- **Write-y dry-runs (DR1, DR3, DR5, DR8) NOT executed** — would require preview env / real OTP delivery / writes to prod Dataverse + SharePoint.

The output of the session is two artifacts:

- [`READINESS_AUDIT_2026-05-25.md`](READINESS_AUDIT_2026-05-25.md) — full bucket-by-bucket findings, severity tags, recommended fix order. 23 numbered findings + 5 dry-run-derived findings.
- This Codex report — synthesizes the load-bearing findings, names the structural pattern behind them, frames the open questions for a second pass.

---

## 2. The headline finding (what would have bitten a real user tomorrow)

Live Postgres probing surfaced something the static review alone could not:

**Migration 011 and 013 have never been applied to production Postgres.**

- **Migration 011** (`submission_jobs_states.sql`, dated 2026-05-19-ish): adds `locked_until`, `lease_token`, `akoya_requestnum` to `submission_jobs` plus the rekeyed partial-unique index. The drain cron at `pages/api/cron/drain-submissions.js` runs every 2 minutes and references all three columns in `claimBatch`. **Verified by direct query:** `SELECT locked_until FROM submission_jobs LIMIT 1` returns `column "locked_until" does not exist`. The drain has been silently erroring every 2 minutes since deployment (no `MaintenanceService.startRun` call means no `maintenance_runs` row to surface the failure).
- **Migration 013** (`intake_drafts_pending_attachments.sql`, S184 chunk-4): adds the `pending_attachments` JSONB column that the entire three-call attach dance depends on. Today's daily-maintenance cron (alert id 151, 2026-05-25 10:00 UTC) logged: `intakePending: ERROR - column d.pending_attachments does not exist`. **The S184 three-call attach work (chunks 4-6, 13 commits, multiple Codex pre+post-impl review rounds, ~200 unit tests) is non-functional in prod.** Any call to `/api/intake/draft/upload-token`, `/api/intake/draft/attach`, `/api/intake/submit`'s A1 guard, or `MaintenanceService.sweepIntakePending` 500s on the missing column.

A third, related issue surfaces in the same maintenance alerts: **`MaintenanceService.cleanupExpiredCache` fails daily** with `n.cleanupExpiredCache is not a function` (where `n` is the minified bundler reference to `DatabaseService`). The function _is_ defined at `lib/services/database-service.js:167`; this looks like a runtime require/export interop bug, not a missing-code bug.

And the structural cause of all three: **there is no migration tracker table.** No `schema_migrations` / `migrations` row records what's been applied. The `setup-database.js` flow is fresh-install only (per its own loud-failure comments at line 593-603), and incremental migrations 002-014 are applied manually by an operator with no record-keeping.

These are the load-bearing findings of the session. Everything below is meaningful, but if Codex looks at nothing else, **start here**.

---

## 3. Findings catalogue

Buckets B1-B7 capture findings derived from static review; the **DR6c** findings (above) come from live Postgres probing. Each finding carries a severity tag:

- **CONFIRMED** — verified against source or live state
- **SUSPECTED** — pattern in source strongly implies it; no live probe yet
- **WORTH PROBING** — surface untouched recently; bucket 8 dry-run candidate
- **CLEAR** — explicit "checked, OK" verdict (silence is not success)

### 3.1 P0 — would bite a real user tomorrow

| ID | Finding | Severity | Effort |
|---|---|---|---|
| **0a** | Migration 013 not applied to prod — intake portal non-functional | CONFIRMED | S (apply migration) |
| **0b** | Migration 011 not applied to prod — drain has been silently erroring every 2 min since deploy | CONFIRMED | S (apply migration) |
| **0c** | Daily `cleanupExpiredCache` fails (`n.cleanupExpiredCache is not a function`); minified-bundler interop | CONFIRMED | S |
| **0d** | No migration tracker table — structural cause of 0a / 0b | CONFIRMED | M |
| **0e** | `pricing-canary`, `spend-check`, `sweep-stale-invites` have ZERO observable side effects in prod | CONFIRMED | S (verify deployed-config) |
| 1 | INTAKE_BLOB_RW_TOKEN unverified in prod | CONFIRMED | S |
| 2 | Virus scanning OFF in prod (intake + reviewer both default to `scanner='skipped'`) | CONFIRMED | M |
| 3 | VRP_ALLOWED_PROVIDERS + per-app model overrides unverified in prod | WORTH PROBING | S |

### 3.2 P1 — correctness / latent operational

| ID | Finding | Severity | Effort |
|---|---|---|---|
| 4 | No rate limiting on `/api/intake/draft/{upload-token,attach}` + `/submit` (parallel to A6 external-reviewer rate limiter) | CONFIRMED | M |
| 5 | Drain `recordFailure` backoff is constant 60s; `attempts` unused | CONFIRMED | S |
| 6 | `DRAIN_MAX_ATTEMPTS_DEFAULT` declared but never enforced | CONFIRMED | S |
| 7 | Intake private Blob store has no GC for completed submissions | SUSPECTED | M |
| 8 | `secret-check` cron tracks 5 secrets; 7+ load-bearing production secrets missing from the list | CONFIRMED | S |
| 9 | `DYNAMICS_IMPERSONATION_ENABLED` still off in prod | SUSPECTED | S |
| 10 | `dynamics_feedback` / `dynamics_query_log` no admin review surface | CONFIRMED | M |
| 11 | `intake_audit` has no retention policy | CONFIRMED | S |

### 3.3 P2 — hygiene / docs / forward-looking

| ID | Finding | Severity | Effort |
|---|---|---|---|
| 12 | CLAUDE.md L251 misstates Postgres schema source-of-truth | CONFIRMED | S |
| 13 | `lib/db/schema-v2.sql` orphaned (delete) | CONFIRMED | S |
| 14 | Backup / restore posture undocumented | CONFIRMED | S |
| 15 | Idle-timeout `lastActivity && ...` guard is fail-open if absent | CONFIRMED minor | S |
| 16 | Drain `handleScanning` creates near-empty `akoya_request` (intentional pending Connor Q1/Q2) | INFORMATIONAL | M |
| 17 | `model_pricing_audit` at 0 rows — see 0e (the canary appears not to be running) | CONFIRMED via 0e | S |
| 18 | EXECUTOR_CONTRACT.md draft spec vs shipped `execute-prompt.js` drift | WORTH PROBING | M |
| 19 | Wave 1 dispatcher dead Postgres branches: simplify to startup throw | CONFIRMED | S |
| 20 | `docs/archive/` cleanup (49 files; many >8 weeks) | CONFIRMED | S |
| 21 | One skipped test in `apiKeyManager.test.js:59` | CONFIRMED | S |
| 22 | Migration idempotency not mechanically verified | WORTH PROBING | M |
| 23 | Periodic DV entity sweep cadence undocumented | WORTH PROBING | M |
| 24 | Researcher h-index column unpopulated (user-deferred: discovery-pipeline never captured it) | KNOWN GAP | M, deferred |
| 25 | `scripts/audit-dataverse-state.js` schema probe broken (`startswith` 501) | CONFIRMED | S |
| 26 | 5 potentially orphaned npm deps (`cors`, `formidable`, `helmet`, `multer`, `lucide-react`) | CONFIRMED via depcheck | S |
| 27 | 3 missing direct deps (`@jest/globals`, `jose`, `@babel/parser`) — transitive-resolved | CONFIRMED via depcheck | S |

---

## 4. What is genuinely working (explicit CLEAR verdicts)

S185's pre-work paid off. The following surfaces were reviewed and found mature; silence in the findings list is not success — these were explicitly checked:

- **External reviewer flow**: token mint/verify/extend, hash-only storage, revocation, expiry, per-token + per-IP rate limiting, deduped alerting on invalid-token spike + DB-degraded mode, shared `writeReviewFiles` upload core.
- **S184 three-call attach dance code itself** (independent of prod-DB state): heavy Codex pre+post-impl review, SQL-level cardinality gate, removePending-first race-safe sweep ordering, body field allow-list + forbidden-field guard, dependent on migration 013 (which has not landed in prod — see 0a).
- **Drain state machine code** (independent of prod-DB state): pre-gen GUIDs for child idempotency, `recoverRequestCreated` for duplicate-PK recovery, lease+token concurrency, transactional state-advance+audit, BUILD_PENDING parking, dependent on migration 011 (which has not landed in prod — see 0b).
- **Reviewer Finder + Review Manager Dataverse-native paths**: alt-key duplicate translation (412 → 409), lifecycle dispatcher, contact promotion failure-tolerant, SSE consistent.
- **Phase I Dynamics summarize-v2 + Virtual Review Panel**: Executor reference call site, conflict 409 shape, `claude` provider hard-required for VRP, payload-boundary applied at route boundary. **Verified producing live output** — prod `akoya_request` 1002787 has `wmkf_ai_summary`, `wmkf_ai_compliancecheck`, `wmkf_ai_complianceissues`, `wmkf_ai_dataextract`, `wmkf_ai_fitassessment`, `wmkf_ai_fitrationale` all populated.
- **proxy.js cross-provider non-crossing**: applicant tokens explicitly rejected on staff surface and vice-versa.
- **`system_alerts` read path**: `/admin` dashboard + `NotificationService` emails on ≥error severity via category-routed recipients (S181 work).
- **`health_check_history`**, **`maintenance_runs`**, **`api_usage_log`** all actively populated and surfaced.
- **Schema-as-code completeness gate** (`check:atlas`) and **API route security matrix gate** (`check:api-routes`) green at session start.

---

## 5. Open questions for Codex review

Areas where I want an independent second opinion before recommending action:

### Q1 — Are migrations 011 and 013 _really_ not applied?

My probe is consistent with this (column-does-not-exist on multiple referenced columns, daily maintenance alert explicitly logs it), but there is no migration tracker to consult. **Want Codex to either confirm or refute by independent query against the same env.** Possibilities I haven't fully ruled out: (a) prod Postgres connection string in `.env.local` points at an old / preview branch, (b) Neon has migration history I'm not querying. Codex's read should be against the canonical prod env.

### Q2 — Why have several crons never produced observable side effects?

`pricing-canary`, `spend-check`, `sweep-stale-invites` write to `system_alerts` on findings. All three: zero alerts ever in 149 rows. Meanwhile `health-check`, `log-analysis`, `secret-check`, `auth-bypass-check`, `daily-maintenance` are visibly running.

Possibilities:
- Vercel plan cron limit (Hobby = 2; we run ≥5, so we're on Pro or have an exemption)
- Crons were added to `vercel.json` but the deployment hasn't picked them up
- Each handler is silently erroring before any side effect
- Genuinely healthy state (e.g. pricing-canary finds zero unknown models) — but that should still write a healthy log entry; it doesn't.

Codex would need Vercel deployment-side visibility (`vercel cron ls`, deployment build logs) to confirm. I can't do this from a code-review seat.

### Q3 — What's the right structural fix for migration tracking?

The cheapest fix (`schema_migrations` table + a script that records each applied migration) is straightforward, but doesn't help recover the "what's actually in prod right now" question for the present incident. Two flavors:

- **Reactive:** add the tracker table, manually annotate it with the migrations that have actually been applied (which we'd need to derive by column-existence probes), apply 011+013 in the correct order, and never have this drift again.
- **Proactive + assertive:** add the tracker, plus a startup-time check (e.g. `instrumentation.js`) that compares the file set in `lib/db/migrations/` against the applied set and surfaces drift via `system_alerts` immediately.

The proactive variant prevents this from recurring. Wanted Codex's take on whether it's worth the small additional surface area.

### Q4 — Virus scanning posture for pilot launch

The current state — `VIRUS_SCAN_ENABLED=false`, `CLOUDMERSIVE_API_KEY` unset — means every reviewer-self-upload and every intake-portal attach is **not actually being scanned** despite the audit row claiming `scanner='skipped'`. The code is built defensively for fail-closed when the flag is on; it's the flag that's currently off.

For the mid-June intake pilot, three postures are available:
- (A) Accept "no scanning during pilot" as documented operational state; clean up the `scanner='skipped'` audit shape so it's loud and obvious, not silently passing.
- (B) Commit to enabling Cloudmersive before pilot. Free-tier quota is 800/mo; pilot projection ~350/cycle across reviewer + intake.
- (C) Bring the scan in-house (ClamAV in a sidecar) to remove the vendor.

I lean B for pilot, but Codex's view on the Cloudmersive free-tier quota risk + the in-house path would help.

### Q5 — Drain `recordFailure` exponential backoff fix

The fix is a one-character change (`Math.pow(2, 0)` → `Math.pow(2, job.attempts)`), but pairing it with `DRAIN_MAX_ATTEMPTS_DEFAULT` enforcement adds risk: a terminal-fail at attempt N+1 is structural data loss for a submission that might have been recoverable on N+2. Want Codex's opinion on the right max-attempts default for a state-machine drain (vs the implicit "retry until manual cancel" today).

### Q6 — Intake portal rate limiting design

The external-reviewer module (`lib/external/rate-limit.js`) is keyed on `(token, IP)`. The intake-portal analog would be keyed on `(contactOid, route)` — the natural per-applicant rate boundary. Bucketing the three endpoints (`/upload-token`, `/attach`, `/submit`) with one shared limit vs separate per-route limits has tradeoffs. Codex's pattern recommendation?

### Q7 — Intake private Blob GC

Two options:
- (A) Delete source bytes in `files_moved` handler after the per-file SharePoint upload confirms. Simpler, but if SharePoint upload silently succeeds but Dataverse PATCH fails, we lose the recovery path.
- (B) Daily-maintenance cron extension: scan the private store with `INTAKE_BLOB_RW_TOKEN`, reap blobs whose pathname isn't in any active draft's `attachments[]` or `pending_attachments[]`. Belt-and-suspenders; recoverable.

(B) parallel to the existing `cleanupBlobs` shape feels cleaner. Codex's take?

---

## 6. Recommended fix order

This is **my proposed** sequencing; the user picks. Suggested phases:

### Phase 0 — Emergency closeout (P0 0a-0e), before _anything_ else

This phase is the gap that turns "S183-S184 intake work shipped" from a wishful claim into a true one.

1. **Apply migration 011 to prod** (`submission_jobs_states.sql`). Verify drain stops erroring at the next 2-min tick. Watch `system_alerts` for drain-related entries that have been latent.
2. **Apply migration 013 to prod** (`intake_drafts_pending_attachments.sql`). Verify daily-maintenance alert at next run no longer contains the intakePending error.
3. **Diagnose and fix `cleanupExpiredCache` runtime interop bug.** Confirm `MaintenanceService.cleanupExpiredCache` calls `DatabaseService.cleanupExpiredCache` correctly — likely a CJS-default-import shape issue under the Next.js bundler. Test in dev first.
4. **Investigate the silent-cron set** (`pricing-canary`, `spend-check`, `sweep-stale-invites`). Either fix deployment OR document why they don't surface anything.
5. **Stand up a `schema_migrations` table** + a script to record what's applied. Backfill with the currently-applied set (derived by column-existence probes).

### Phase A — Pre-pilot battle-readiness (P0 1-3)

6. Verify `INTAKE_BLOB_RW_TOKEN`, `VRP_ALLOWED_PROVIDERS`, model overrides in prod env.
7. Decide on virus scanning posture (Q4).
8. DR1 / DR8 preview-env smoke tests (intake e2e + Entra OTP round-trip).

### Phase B — Drain hardening (P1 4-7)

9. Drain exponential backoff + max-attempts cap (5+6).
10. Intake portal rate limiting (4).
11. Intake private Blob GC (7).

### Phase C — Observability tightening (P1 8-11)

12. Extend `secret-check` `TRACKED_SECRETS`.
13. Decide `DYNAMICS_IMPERSONATION_ENABLED` for pilot.
14. `intake_audit` retention policy + cron call.
15. Dynamics feedback review surface (or remove thumbs-down).

### Phase D — Docs + hygiene catch-up (P2 12-15, 19-21, 25-27)

16. CLAUDE.md schema-source-of-truth correction + delete `schema-v2.sql` + add backup posture section.
17. Simplify Wave 1 dispatcher to startup throw.
18. Invert idle-timeout guard.
19. `docs/archive/` cleanup + unskip test.
20. Fix `audit-dataverse-state.js` metadata probe.
21. Add 3 missing direct deps to package.json; verify/remove the 5 orphaned candidates.

### Deferred (track but don't block)

22. Drain `handleScanning` empty-request behavior (16) — Connor Q1/Q2 dependent.
23. Migration idempotency proof (22).
24. DV entity sweep automation (23).
25. EXECUTOR_CONTRACT.md drift (18) — defer until prompt-tuning resumes.
26. Researcher h-index population (24) — discovery pipeline rework, separate session.

---

## 7. What I did NOT do (and why)

For transparency on the audit's coverage:

- **Did not run DR1 (intake e2e), DR3 (external reviewer round-trip), DR5 (policy publish), DR8 (Entra OTP).** These write to prod Dataverse / SharePoint or require real email delivery. Held for explicit operator go-ahead and/or preview env.
- **Did not run DR4 (manual health-check trigger).** The cron has been running every 15 min and writing visible rows in `health_check_history`; a manual trigger would add a redundant row.
- **Did not verify Vercel deployment cron list.** That requires `vercel cron ls` / dashboard access; out of audit scope. Q2 needs it.
- **Did not exercise migration idempotency by replay** (B2-F4). Out of session scope; defer.
- **Did not deep-diff `EXECUTOR_CONTRACT.md` against `execute-prompt.js`** (B6-F2). Out of session scope; defer until prompt-tuning resumes.
- **Did not run a full Dataverse entity-set sweep** for newly-deployed-but-undocumented entities. The S185 audit caught `wmkf_appproposalsearchs`; periodic re-sweep is recommended.
- **Did not edit any code.** Per session-prompt mode: investigation only.

---

## 8. Audit hygiene meta-note

The fact that S183-S184 shipped 13+ commits of intake-portal code (including a Postgres migration to be applied, an end-to-end test suite, and several Codex review rounds) — and the migration silently never made it to prod — is itself the most important finding of the audit.

The CI gates `check:atlas`, `check:api-routes`, `check:fact-consistency`, etc., all verify _source-vs-source_ consistency (migration declared in source = atlas entry). None of them verify _source-vs-live-state_ consistency. The `reconcile-memory-claims.js` script does some live probing (capped-probe entity counts), but doesn't detect missing column drift.

That's the structural lesson:
- **The S185 audit pass added drift detection in three places** (canonical facts, drain-table mentions, prompt-storage mentions). All source-side.
- **The S186 audit pass surfaces the equivalent live-state drift detection gap.** A `schema_migrations` tracker + a startup-time drift check is the most obviously-shaped fix.

For future sessions: the rubric should expand from "did the source/source check pass" to "did the source actually reach the live system." Migrations are the obvious case; cron config + env-var presence are arguably similar.

---

## 9. References

- Audit doc: [`docs/archive/READINESS_AUDIT_2026-05-25.md`](READINESS_AUDIT_2026-05-25.md)
- Session prompt: `SESSION_PROMPT.md` (the mandate, the 8 buckets, mode rules)
- Drain plan: `docs/INTAKE_PORTAL_DRAIN_PLAN.md`
- S184 attach build scoping: `docs/INTAKE_ATTACH_BUILD_SCOPING.md`
- Migration files: `lib/db/migrations/{011_submission_jobs_states,013_intake_drafts_pending_attachments}.sql`
- Source files reviewed end-to-end:
  - `pages/api/intake/draft/upload-token.js`, `/attach.js`, `/submit.js`
  - `pages/api/cron/drain-submissions.js` (32K)
  - `pages/api/cron/secret-check.js`, `auth-bypass-check.js`
  - `lib/services/maintenance-service.js`
  - `lib/external/{token-lifecycle,verify-suggestion-token,rate-limit}.js`
  - `pages/api/external/review/[token]/{context,upload}.js`
  - `pages/api/reviewer-finder/my-candidates.js`
  - `pages/api/review-manager/send-emails.js`
  - `pages/api/phase-i-dynamics/summarize-v2.js`
  - `pages/api/virtual-review-panel.js`
  - `proxy.js`
  - `scripts/setup-database.js` (partial)
  - `scripts/audit-postgres-state.js`
