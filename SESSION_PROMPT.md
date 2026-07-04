# Session 326 Prompt: Reviewer acceptance drain deploy follow-through

## Session 325 Summary

Session 325 combined repo housekeeping, CI repair, reviewer E2E re-baselining,
and the reviewer acceptance fast-response build. The major product change is that
external reviewer accept clicks no longer wait on the slow honorarium/email/contact
tail: the route stages a durable Postgres job, commits the Dataverse accept, and a
cron drain retries the follow-up work.

### What Was Completed

1. **Private-repo CI posture repaired.**
   - Dropped CodeQL after confirming private-repo visibility/branch-protection
     constraints; broadened Semgrep instead.
   - Split Semgrep into blocking and advisory coverage, then fixed the no-op
     workflow so the broadened rules actually run.

2. **Reviewer E2E suite re-baselined to the landed accept flow.**
   - Fixed a strict-mode locator issue on the invite modal title.
   - Re-baselined the reviewer suite to the current one-accept flow; 23/23 passed.
   - Parked the E2E re-baseline context in memory for later retrieval.

3. **Reviewer acceptance fast-response drain shipped.**
   - Added `reviewer_acceptance_jobs` via migration `024_reviewer_acceptance_jobs.sql`.
   - Refactored `/api/external/review/[token]/respond` so fresh accept stages the
     durable job, commits `wmkf_appreviewersuggestion`, then returns quickly.
   - Added `/api/cron/drain-reviewer-acceptances`, scheduled every 2 minutes, to
     re-read Dataverse and run honorarium/contact capture, ORCID, board identity,
     name/title sync, mismatch alerts, acceptance confirmation email, and quota
     notification.
   - Dataverse remains authoritative for accepted/declined state; Postgres is a
     retry ledger for post-accept side effects only.

4. **Second-eyes findings fixed.**
   - Claude reviewed `a3103b3c`; Codex fixed stale sibling-job dedupe and made
     honorarium/address-capture failures retryable.
   - Claude reviewed `1be33e0b`; Codex verified live Dataverse timestamp precision
     and added tests for same-second truncation and queued sibling cancellation.

5. **Migration 024 applied and verified.**
   - `npm run apply:migrations` applied `024_reviewer_acceptance_jobs.sql` against
     the configured Postgres database.
   - Verified `schema_migrations` has `024_reviewer_acceptance_jobs.sql` and
     `public.reviewer_acceptance_jobs` exists with expected columns/indexes.

### Commits

- `180e9046` ci: drop CodeQL (private-repo blocked), broaden Semgrep to full SAST
- `198fbd97` ci: actually run broadened Semgrep rules (fix no-op), split blocking vs advisory
- `a3103b3c` Add reviewer acceptance fast-response drain
- `d0f02b58` test(e2e): fix strict-mode locator on invite modal title; park reviewer E2E re-baseline
- `07d8c216` chore(memory): record private-repo CI decision and parked E2E re-baseline
- `4ca4c6b3` test(e2e): re-baseline reviewer suite to landed accept flow - 23/23 green
- `18dd4840` fix(ci): green the Tests job - memory-router frontmatter + stale country-count assertion
- `1be33e0b` Harden reviewer acceptance drain retries
- `efe386ae` Cover reviewer acceptance timestamp precision

## Next Items

### Verified Open

1. **Verify the deployment for the pushed reviewer acceptance drain.**
   Evidence: local `main` was ahead of `origin/main` by 2 before `/stop`; migration
   `024` is already applied and verified locally via `schema_migrations` +
   `to_regclass('public.reviewer_acceptance_jobs')`.
   After push/deploy, confirm Vercel built the current `main` head and that
   `/api/cron/drain-reviewer-acceptances` is present in the route list/logs.

2. **Monitor first live reviewer accept through the new queue.**
   Evidence: `lib/services/reviewer-acceptance-drain.js` now owns the slow tail,
   and `docs/API_ROUTE_SECURITY_MATRIX.md`/`docs/atlas/postgres-infra-tables.md`
   document the route/table contract.
   After the next real reviewer accept, inspect `reviewer_acceptance_jobs` for a
   completed row or a retryable failure before assuming the tail is healthy.

### Measure Later

1. **Institution-COI ledger calibration.**
   Evidence: `scripts/probe-institution-coi-breakdown.mjs` exists and documents
   the read-only `coi_dropped` ledger measurement path.
   Run `scripts/probe-institution-coi-breakdown.mjs 120` once enough
   `coi_dropped` ledger rows have accumulated to validate Phase C thresholds.

### Owner Decision Needed

None at stop.

### Parked

1. **Spec-audit docs recovery on the work computer.**
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Re-open around 2026-07-08 on the work computer. Do not re-search local/origin
   first, and do not reconstruct the docs from scratch here. The recovery target
   is the unpushed `codex/spec-audit` work containing
   `REVIEWER_ACCEPT_FAST_RESPONSE_DESIGN.md` and
   `REVIEWER_QUOTA_PD_EMAIL_PLAN.md`.

### Verify Before Acting

1. **Do not apply old S322 cleanup suggestions without fresh caller checks.**
   Evidence: `docs/DEAD_CODE_DELETION_MANIFEST.md` was already corrected once
   after `lib/services/anthropic-admin.js` proved live via the pricing-refresh
   cron. Re-run source/caller checks before any delete/retire work inherited from
   S322 audit docs.

2. **Reviewer acceptance confirmation email remains at-most-once by design.**
   Evidence: Claude flagged retry-on-send-failure as a tradeoff; Codex left the
   pre-send `claimedAt` guard in `lib/services/reviewer-acceptance-drain.js` to
   avoid duplicate reviewer-facing emails after uncertain send failures.
   Do not change to retry-on-failure without an explicit product/ops decision.

### Do Not Reopen Without New Decision

1. **Do not re-add CodeQL as a required private-repo gate.**
   Evidence: commits `180e9046` and `198fbd97` record the private-repo constraint
   and Semgrep replacement/split. Revisit only if GitHub plan/visibility changes.

2. **Do not delete `lib/services/anthropic-admin.js` as dead code.**
   Evidence: `pages/api/cron/pricing-refresh.js` imports it, the Vercel build
   failed without it, and `docs/DEAD_CODE_DELETION_MANIFEST.md` records the
   false-positive cleanup correction.

3. **Two advisory hooks remain retired by owner approval.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` and
   `docs/agent-wiki/topics/dev-environment.md`.
   Do not resurrect `doc-edit-reconcile-reminder.js` or
   `memory-placement-reminder.js` without evidence of recurrence.

4. **`pre-commit-self-review.js` deliberately kept.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md` risk note and the S323
   staging-gap fix commits.
   Do not remove it as duplicate hook hygiene without a new decision.

## Key Files Reference

| File | Purpose |
|------|---------|
| `SESSION_PROMPT.md` | Current handoff and verified carryovers. |
| `pages/api/external/review/[token]/respond.js` | Token-scoped accept/decline route; fresh accept stages the PG job and commits Dataverse. |
| `lib/services/reviewer-acceptance-job-service.js` | Postgres job enqueue/claim/failure/complete service for reviewer accept follow-up. |
| `lib/services/reviewer-acceptance-drain.js` | Cron worker logic for post-accept side effects and retry/cancel rules. |
| `lib/services/reviewer-acceptance-email.js` | Acceptance confirmation email rendering/sending helper. |
| `pages/api/cron/drain-reviewer-acceptances.js` | Cron route for draining reviewer acceptance jobs. |
| `lib/db/migrations/024_reviewer_acceptance_jobs.sql` | Existing-DB migration for the job ledger. |
| `tests/unit/reviewer-acceptance-drain.test.js` | Retry/dedupe/timestamp precision coverage for the drain. |
| `tests/integration/external-review-routes.test.js` | Route contract tests for staging, accept commit, conflict, and ambiguous failure paths. |
| `.github/workflows/semgrep.yml` | Broad advisory Semgrep workflow from the private-repo CI change. |
| `.github/workflows/semgrep-blocking.yml` | Blocking Semgrep workflow replacing unavailable CodeQL coverage. |

## Testing

```bash
npm test -- tests/integration/external-review-routes.test.js tests/unit/reviewer-acceptance-drain.test.js tests/unit/reviewer-acceptance-job-service.test.js tests/unit/email-token-resolvers.test.js
npm test -- tests/unit/reviewer-acceptance-drain.test.js tests/unit/reviewer-acceptance-job-service.test.js tests/integration/external-review-routes.test.js
npm run check:migrations-manifest
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:atlas
npm run check:atlas:self-test
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:agent-wiki
npm run check:agent-wiki:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:route-lifecycle-auth
npm run check:route-lifecycle-auth:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
npm run build
npm run apply:migrations
```

Live/read-only probes run during the session:
- Dataverse `wmkf_responsereceivedat` precision probe showed second precision
  values such as `2026-07-02T17:56:44Z`, supporting the drain's ±1000ms
  same-second tolerance.
- Postgres verification after `npm run apply:migrations` confirmed
  `schema_migrations.name = '024_reviewer_acceptance_jobs.sql'` and
  `to_regclass('public.reviewer_acceptance_jobs') = 'reviewer_acceptance_jobs'`.
