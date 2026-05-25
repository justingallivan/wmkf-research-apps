# Session 187 Prompt: Phase A + Phase B closeout, pilot prep

## Session 186 Summary

S186 was the backend battle-readiness audit. It uncovered three live P0 issues that S183-S185's source-side gates couldn't see: **migration 011 and 013 had never been applied to prod Postgres** (drain has been silently erroring every 2 min since deploy; intake portal endpoints 500 on first call), and the **daily maintenance cron's `cleanupExpiredCache` had been failing daily but the cron was masking it as `status='completed'`**.

Phase 0 closed all three plus the structural cause (no migration tracker existed). Six rounds of Codex review iterated the execution plan before any code ran; Codex GREENLIT at v6 and found 4 in-place fixes post-execution.

### What was completed

1. **Audit + plan + 6-round Codex iteration**
   - `docs/READINESS_AUDIT_2026-05-25.md` — 8-bucket audit, 30+ findings, P0/P1/P2 tiered
   - `docs/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md` — self-contained second-pass briefing
   - `docs/READINESS_AUDIT_PHASE0_PLAN.md` — execution plan, v1→v6 (Codex GREENLIT)

2. **DB executed against prod** (via ad-hoc scripts, then deleted)
   - `schema_migrations` tracker created + probe-backfilled with 11 rows (002-010, 012, 014)
   - Migration 011 applied: `submission_jobs.{locked_until, lease_token, akoya_requestnum}` + status check expansion + partial-unique index swap. `LOCK TABLE ACCESS EXCLUSIVE` inside the apply transaction. **Drain stops erroring at the next 2-min tick.**
   - Migration 013 applied: `intake_drafts.pending_attachments JSONB`. **S184 three-call attach dance is now functional in prod.**

3. **Tracker infrastructure committed** (`ffe1dec`)
   - `scripts/apply-migrations.js` — canonical forward apply path. Trusts tracker (007 isn't re-runnable). Strips line-anchored `^BEGIN;`/`^COMMIT;` only (verified preserves 007's PL/pgSQL DO-block `BEGIN`s).
   - `scripts/build-migrations-manifest.js` + `scripts/check-migrations-manifest.js` + committed `lib/db/migrations-manifest.json` (deterministic, no timestamp).
   - `lib/utils/migration-drift.js` — cold-start hook reads manifest + tracker; bidirectional drift detection; distinct `migration_tracker_missing` alert for SQLSTATE 42P01; auto-resolves stale alerts on clean state.
   - `instrumentation.js` — wires `detectMigrationDrift` after `auth-bypass-monitor`.
   - `package.json` — `prebuild`, `apply:migrations`, `check:migrations-manifest`.
   - `.github/workflows/test.yml` — `check:migrations-manifest` + `npm run build` + `git diff --exit-code lib/db/migrations-manifest.json` gate.

4. **Maintenance correctness** (`ffe1dec`)
   - `lib/services/maintenance-service.js:13` — `{ DatabaseService }` destructure fix (was importing whole module object). Root cause of daily `cleanupExpiredCache` failure.
   - `pages/api/cron/maintenance.js` — `isFailedSubtaskResult` covers `error` field, numeric `errors` count, array-shaped `errors`, and nested `blobDelErrors`/`removePendingErrors` (per Codex post-execution review). Records `status='failed'` + severity `error` on any subtask failure.
   - `pages/api/cron/{pricing-canary,spend-check,sweep-stale-invites}.js` — `MaintenanceService.startRun/completeRun` placed AFTER auth guards. `pricing-canary.recordsProcessed` uses `totalChecked` (distinct models), not the bad-outcome `unknownCount`.

5. **Phase 0 closeout adjacent items** (`c35a4f2`)
   - `jose@^4.15.9` declared as direct dep (was only transitively via `next-auth`); production external-reviewer + DVX-result-token paths depend on it.
   - `CLAUDE.md` §"Database Schema" rewritten — now points at `setup-database.js` (fresh install) + migrations + manifest + tracker + `apply-migrations.js`. Prior text claimed `schema.sql + migrations/` was authoritative but `schema.sql` is a 5-table legacy subset.
   - Env-var verification via `vercel env ls production`: `INTAKE_BLOB_RW_TOKEN` ✅, `DVX_BLOB_RW_TOKEN` ✅, model overrides probe = 0 entries (no stale retired model IDs), `VRP_ALLOWED_PROVIDERS` missing but moot (only `CLAUDE_API_KEY` set in prod; VRP needs ≥2 providers and is admin-assigned anyway).

### Commits

- `ffe1dec` — S186 Phase 0: apply mig 011/013, schema_migrations tracker, maintenance fixes
- `c35a4f2` — Phase 0 closeout: declare jose direct dep + correct CLAUDE.md schema source

## Open user-action items from S186 (no code involved)

**Virus scan posture: ENABLE CLOUDMERSIVE** (user-chosen at S186 closeout). The integration is already wired fail-closed. Operator-side enablement:

```bash
# After getting a Cloudmersive API key:
vercel env add CLOUDMERSIVE_API_KEY production   # paste key
vercel env add VIRUS_SCAN_ENABLED production     # value: true
# Redeploy (push or trigger)
```

Free tier is 800 scans/month; audit projects ~350/cycle across reviewer + intake combined. Failure mode is fail-closed (upload rejected on scanner outage). Monitor free-tier usage.

## Potential next steps for S187

S187 should pick the next chunk based on what feels most urgent — Phase A (pre-pilot smoke) and Phase B (drain hardening + intake portal protection) are the two main directions. The four Phase B items pair well; the two Phase A dry-runs can run alongside.

### Phase A — pre-pilot smoke tests (separate exercise per item)

1. **DR1 — Intake submission e2e against preview env.** Submit a fixture draft via curl → upload-token → PUT to Blob → attach → submit → watch drain advance through `queued → scanning → request_created → files_moved → dynamics_patched`. Validates the full path now that migrations are live. Creates a real (test) `akoya_request` + SharePoint folder in preview's connected tenant.
2. **DR8 — External Entra ID OTP round-trip on preview.** Send a magic-link OTP to a fixture applicant email, complete sign-in, confirm session `userType='applicant'` + `contactOid` + non-crossing enforcement against staff surfaces. Validates S129 provider config hasn't drifted.

### Phase B — drain hardening + intake portal protection

3. **#4 — Intake portal rate limiting.** Build `lib/intake/rate-limit.js` mirroring `lib/external/rate-limit.js`. Keyed on `(contactOid, route)` for endpoint-specific abuse + a coarser `applicant:{contactOid}:all` for aggregate. Fail-open with degraded-state alerting. Apply to `/api/intake/draft/{upload-token,attach}` and `/api/intake/submit`. **Effort M.**
4. **#5 + #6 + #30 — Drain backoff + classifier `maxAttempts`.** Replace `Math.pow(2, 0)` with `Math.pow(2, job.attempts)` in `recordFailure`; consume `cls.maxAttempts` from `drain-error-classifier.js` (transient 10, scan 3) instead of dropping it; terminal-fail on cap with a `system_alerts` row. **Effort S, small contained patch.**
5. **#7 — Intake private Blob GC.** Drain `handleFilesMoved` doesn't delete source bytes after SharePoint upload; `cleanupBlobs` only scans the shared store. Extend daily maintenance with a private-store sweep keyed on `INTAKE_BLOB_RW_TOKEN` that reaps blobs not in any active draft's `attachments[]` or `pending_attachments[]`. **Effort M.**

### Other P1 follow-ups

6. **#10 — Dynamics feedback review surface.** `dynamics_feedback` and `dynamics_query_log` are written by the Dynamics Explorer thumbs UI but no admin page reads them. Either small `/admin/dynamics-feedback` page or remove the thumbs-down UI. **Effort M.**
7. **#11 — `intake_audit` retention policy.** No retention configured today; will grow forever once intake goes live. Add `retention:intake_audit_days` (e.g. 730) + a `cleanupIntakeAudit` method + a daily-maintenance call. **Effort S.**

### After Phase A+B lands, the intake portal UI itself (S185 carryover)

The applicant intake form (HTML) — the original S185 build that S186 deliberately gated on this readiness pass. With migrations live, virus scanning enabled, rate limiting + Blob GC done, the UI build is unblocked.

## Carryover items to verify, not act on

- **W6 reviewer Postgres DROP** — fires ≥ 2026-07-01 per `project-w6-table-drop-pending.md`. Today is 2026-05-25; not yet.
- **Archive intake meeting agenda** — fires ≥ 2026-05-27 (day after tomorrow). `git mv docs/INTAKE_PORTAL_MEETING_AGENDA_2026-05-13.md docs/archive/`.
- **Field Set D doc collision** — still blocked on Connor; not for S187.

## Key files reference

| File | Purpose |
|------|---------|
| `docs/READINESS_AUDIT_2026-05-25.md` | Full audit findings + dry-run results |
| `docs/READINESS_AUDIT_2026-05-25_CODEX_REPORT.md` | Codex-discussion briefing |
| `docs/READINESS_AUDIT_PHASE0_PLAN.md` | Execution plan v6 (GREENLIT, executed) |
| `scripts/apply-migrations.js` | Canonical forward apply path |
| `scripts/build-migrations-manifest.js` + `scripts/check-migrations-manifest.js` | Manifest pipeline |
| `lib/db/migrations-manifest.json` | Committed deterministic file list |
| `lib/utils/migration-drift.js` | Cold-start drift detection |
| `pages/api/cron/maintenance.js` | Subtask-failure detection lives here |
| `pages/api/cron/{pricing-canary,spend-check,sweep-stale-invites}.js` | Now write `maintenance_runs` heartbeats |

## Testing

```bash
# Phase 0 verification gates
npm run check:atlas                       # 30 PG / 32 DV ✓
npm run check:api-routes                  # 93 ✓
npm run check:migrations-manifest         # 13 files ✓
npm run apply:migrations                  # idempotent — all 13 skipped on second run ✓

# Confirm DB state matches expectations
node -e "/* connect; SELECT name FROM schema_migrations ORDER BY name; */"
# expect 13 rows: 002-014 inclusive

# Tomorrow morning, confirm Phase 0's behavior changes landed:
# - Daily maintenance cron at 03:00 UTC should record status='completed' (no
#   cleanupExpiredCache or intakePending errors); future failures will record
#   status='failed' + severity='error'.
# - Drain cron at every 2 min should exit cleanly (0-row claims) instead of
#   the silent column-doesn't-exist errors.
# - pricing-canary / spend-check / sweep-stale-invites should write fresh
#   maintenance_runs rows at their schedules. If still missing → Vercel-side
#   cron config issue, not handler.
```
