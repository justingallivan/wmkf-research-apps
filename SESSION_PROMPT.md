# Session 384 Prompt: Release review-synthesis lifecycle safely

## Session 383 Summary

Session 383 closed the auth-status divergence and routine dependency update,
reconciled the post-synthesis operational evidence, then implemented the
owner-approved review-synthesis lifecycle on a deliberate Tier feature branch.
The lifecycle implementation is committed and fully tested. Draft PR #96 is
open with all checks green, migration 028 is applied to production Postgres,
and the code remains undeployed with automation disabled.

### What Was Completed

1. **Auth-status policy and routine dependency releases**
   - `/api/auth/status` now delegates to the same fail-closed auth policy used
     by the proxy and server guards. PR #95 merged to `main` as `12981732`.
   - Routine Dependabot PR #94 passed review/checks and merged to `main` as
     `e9e20db2`.
   - The retired-table annotation was corrected in `39dc08d7`.

2. **Review-synthesis lifecycle implementation**
   - Added one fail-closed readiness state machine for selected,
     invited/accepted, non-applicant-excluded participants. Receipts resolve
     with content; explicit terminal outcomes and current revoked/expired
     tokens resolve without content; live invitations and unknown/malformed
     state block.
   - Added an exact input fingerprint over the shared answer digest plus every
     participant's lifecycle classification. Token expiry crossing changes the
     classification/hash even though Dataverse fields do not change.
   - Added explicit early-run confirmation for manual staff generation.
     Manual invocations create leased ledger rows before the Executor call.
   - Added migration `028_review_synthesis_jobs.sql`: queue/currentness,
     deduplication, lease, retry, error, timing, and AI-run metadata only. It
     stores no reviewer text; the Dataverse request memo remains the content
     source of truth.
   - Added `/api/cron/drain-review-syntheses`, scheduled every five minutes but
     inert unless `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` is exactly `true`.
     Claims are small and leased, capped scans fail closed, readiness/hash are
     revalidated before generation, retryable failures stop after three
     attempts, and terminal fingerprints are not silently reopened.
   - `ReviewsTab` now keeps stored output visible at zero accepted/submitted
     rows, shows Current/Stale plus queued/running/failed/readiness state, and
     refreshes the stored memo after an explicit partial tracking failure.
   - `GET /api/review-manager/reviewers` preserves the proposal at zero accepted
     rows and projects `reviewSynthesisState`. Job-state lookup is fail-soft
     without hiding stored synthesis or submitted reviews.
   - Contract reconciliation closed per-request pagination/truncation,
     automatic job-to-fresh-fingerprint binding, stale accepted flags on
     receipt-bearing rows, partial Dataverse-write/ledger-finalization behavior,
     and caller → persistence → consumer currentness.

3. **Durable truth and verification**
   - Reconciled the Atlas, route security matrix, credentials runbook, work
     queue, build plans, reviewer lifecycle wiki, canonical counts, and docs
     catalog.
   - Added
     `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md`.
   - The release preflight proved the local connection string exactly matched
     Vercel Production, then `node scripts/apply-migrations.js` applied
     `028_review_synthesis_jobs.sql` at `2026-07-28T19:25:49.479Z`.
     Post-apply verification found the empty table with the expected 18
     columns, eight constraints, and seven indexes. The production automation
     flag remains absent.
   - Full Jest: 532 suites / 6,317 tests passed. TypeScript and the Next.js
     production build passed. ESLint passed with zero errors and 51 existing
     warnings.
   - Migration manifest, API-route matrix, Atlas, route-lifecycle auth, docs
     catalog, canonical facts, doc-symbol references, doc currency, and all
     required self-tests passed.

### Commits

- `12981732` — Align auth status with enforcement policy (#95)
- `e9e20db2` — build(deps): bump the minor-and-patch group with 11 updates (#94)
- `39dc08d7` — Annotate retired reviewer table reference
- `77028ff2` — Record successful review synthesis smoke
- `f3037cc5` — Verify alert mailbox server-side sync
- `e33374cf` — Implement review synthesis lifecycle

## Next Items

### Verified Open

1. **Review and release `codex/review-synthesis-lifecycle` deliberately.**
   Evidence: `e33374cf`;
   `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md`;
   `docs/CURRENT_WORK_QUEUE.md`.
   Required order:
   1. ~~review/push/open the feature PR and obtain green Preview checks;~~
      complete in draft PR #96;
   2. ~~apply migration 028 to the existing database with
      `node scripts/apply-migrations.js`;~~ complete and live-verified;
   3. merge/deploy while `REVIEW_SYNTHESIS_AUTOMATION_ENABLED` remains unset;
   4. perform signed-in manual/read-only Workbench verification and inspect the
      ledger/currentness projection;
   5. enable the exact `true` flag deliberately and redeploy;
   6. run one bounded automatic smoke and inspect the job row, AI-run,
      Dataverse memo, maintenance run, and logs before marking the lifecycle
      live.

2. **Continue the Workbench product sequence after synthesis release.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`;
   `docs/REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md`.
   Calendar and freeze the full contract for Pre Site Visit Writeup, Site
   Visit, Final Writeup, and Initial Writeup before implementing another tab.

### Owner Decision Needed

1. **Public Git current-tree and history disposition.**
   Evidence: `docs/PUBLIC_GIT_HISTORY_REMEDIATION_PLAN.md`;
   `docs/audits/public-repository-pii-history-audit-2026-07-27.md`.
   Decide the retired duplicate's current-tree disposition separately from any
   authorized history rewrite/GitHub cleanup.

2. **Retired-table operational scripts.**
   Evidence: `docs/CURRENT_WORK_QUEUE.md`; `scripts/README.md`.
   Twenty-five non-archive scripts still mention the historical
   `reviewer_suggestions` table. They are blocked from casual use; removal or
   quarantine remains owner-scoped.

### Parked

1. **Q9 app-access Stage 4 ordinary-user smoke until the owner is in the
   office with another person's account.**
   Evidence: `docs/Q9_PREFS_APPACCESS_DAL_MIGRATION_PLAN.md`;
   `.claude-memory/project-app-access-control.md`; owner decision in Session
   383. The other person only needs to sign into Preview and exercise the
   bounded ordinary-user checks while the owner performs/reverses the
   grant/revoke steps. Do not substitute the owner's superuser account.
2. The four placeholder Workbench tabs until calendar and complete workflow
   contracts are approved.
3. Applicant intake while WMKF evaluates the GOApply re-engineering.
4. Automated BILL onboarding; honorarium payment remains offline.
5. Brace-expansion vendor adapter removal until every installed parent accepts
   the official patched API.

### Verify Before Acting

1. **Production now has the empty `review_synthesis_jobs` table, but the branch
   is still undeployed.** Keep the release sequence deliberate and deploy with
   automation unset before any enablement.
2. **Do not enable automation with the first deployment.** Any value other than
   exact `true` is intentionally inert so historical requests are not
   backfilled unexpectedly.
3. Re-read the live governed `review-synthesis.generate` row before any prompt
   publication. Governed v3 was the verified sole-current production baseline
   on 2026-07-28.
4. Re-freeze refs/artifacts before any public-history operation; the prior
   topology is a dated baseline.
5. Do not replace the brace-expansion adapter from a scanner version alone;
   exercise both legacy callable and modern named consumers under Node 20/npm
   10.

### Do Not Reopen Without New Decision

1. The auth-status divergence fixed in PR #95.
2. Routine dependency PR #94 and the completed 49-alert security rollup.
3. The production-proven synthesis terminal-response/native-schema reliability
   fix and governed-v3 smoke; the open work is lifecycle release only.
4. A drafts-folder reviewer-email workflow; edit-before-send remains the
   accepted behavior.

## Key Files Reference

| File | Purpose |
| --- | --- |
| `lib/services/review-synthesis-readiness.js` | Pure participant readiness and exact lifecycle fingerprint |
| `lib/services/review-synthesis-content.js` | Shared digest/hash used by producer and read model |
| `lib/services/review-synthesis-job-service.js` | Postgres enqueue/claim/complete/fail/currentness ledger |
| `lib/services/review-synthesis-drain.js` | Automatic scan, enqueue, revalidation, and drain |
| `pages/api/cron/drain-review-syntheses.js` | Authenticated, feature-gated five-minute cron |
| `lib/db/migrations/028_review_synthesis_jobs.sql` | Existing-database ledger migration |
| `lib/services/review-manager/synthesize-reviews-service.js` | Shared manual/automatic producer |
| `lib/services/review-manager/reviewers-service.js` | Readiness/currentness DTO projection |
| `shared/components/workbench/ReviewsTab.js` | Visibility, early confirmation, and observability UI |
| `docs/audits/AUDIT_REVIEW_SYNTHESIS_LIFECYCLE_2026-07-28.md` | Contract and live-boundary audit |
| `docs/CURRENT_WORK_QUEUE.md` | Canonical product/release sequence |

## Testing

```bash
rtk npm test -- --runInBand
rtk npm run lint
rtk npm run check:types
rtk npm run build
rtk npm run check:migrations-manifest
rtk npm run check:api-routes
rtk npm run check:api-routes:self-test
rtk npm run check:atlas
rtk npm run check:atlas:self-test
rtk npm run check:route-lifecycle-auth
rtk npm run check:route-lifecycle-auth:self-test
rtk npm run check:docs-catalog
rtk npm run check:fact-consistency
rtk npm run check:fact-consistency:self-test
rtk npm run check:doc-symbol-refs
rtk npm run check:doc-symbol-refs:self-test
rtk npm run check:doc-currency
rtk npm run check:doc-currency:self-test
```
