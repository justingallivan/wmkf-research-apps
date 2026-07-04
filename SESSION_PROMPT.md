# Session 328 Prompt: Review-synthesis follow-up shipped; staged live rehearsal remains

## Session 327 Summary

Session 327 completed the adversarial review of the Session 326 Reviews-tab
handoff, fixed the two concrete Phase 4 synthesis defects found by that review,
and left a durable follow-up report in `docs/`. The companion-LLM evaluation
item from Session 327 is DONE, not an open carryover.

No `CLAUDE.md` or `DEVELOPMENT_LOG.md` change was needed: this session did not
add a new app, schema, script, convention, or milestone beyond the already logged
Session 326 Reviews-tab consumption milestone.

### What Was Completed

1. **Adversarial review of Session 326 handoff**
   - Reviewed `outputs/SESSION_326_REVIEW_HANDOFF.md` (local-only; `outputs/`
     is gitignored) against live source and focused tests.
   - Found two P1 synthesis issues and two P2 manual-reminder issues.
   - Verified the original Phase 4 route/prompt mismatch before editing.

2. **Phase 4 synthesis hardening**
   - `pages/api/review-manager/synthesize-reviews.js` now carries
     `wmkf_questionkey`, `wmkf_questiontype`, and `wmkf_answervalue` into the
     plain-text `reviews_digest` sent to `review-synthesis.generate`.
   - `wmkf_answerhtml` remains excluded from the LLM payload.
   - The route now fails closed when the Executor generated output but did not
     persist the `synthesis` output: `concurrent_edit` -> HTTP 409; other
     writeback failures -> HTTP 502.

3. **Regression tests + durable report**
   - `tests/unit/synthesize-reviews.test.js` now asserts question metadata,
     answer values, no HTML leakage, and failed-writeback status behavior.
   - Added `docs/SESSION_326_REVIEW_FOLLOWUP_REPORT_2026-07-04.md`.
   - Regenerated `docs/DOCS_CATALOG.md`.

4. **Stop-handoff repo hygiene**
   - Added `.codegraph/` to root `.gitignore` so the local CodeGraph database
     and WAL files do not dirty stop/start handoffs.

### Commits

- `f7b5a7fc` - fix(workbench): harden review synthesis handoff findings
- `bc8bc8de` - chore: ignore local CodeGraph index

## Next Items

### Verified Open

1. **Run a staged/manual review-submission rehearsal with owner-approved test data.**
   Evidence: `docs/SESSION_326_REVIEW_FOLLOWUP_REPORT_2026-07-04.md` records
   this as the remaining full-flow verification; Session 326 had zero real portal
   submissions, so populated Compare/Export/Synthesis paths remain unit-proven
   but not browser-proven against real Dataverse answer rows.
   Description: choose a safe test request + reviewer identity, mint a review
   link without sending email, submit the live form, then verify Reviews tab
   Compare, Export, and Synthesis from browser -> API -> Dataverse -> UI. This
   creates live state and should not be improvised without the owner's chosen
   test target.

2. **Monitor the first real reviewer accept through the S325 drain queue.**
   Evidence: read-only stop probe on 2026-07-04 returned
   `{ "totals": [], "recent": [] }` from `reviewer_acceptance_jobs`; the drain
   route was previously verified live/fail-closed in Session 326.
   Description: after the next real accept, inspect `reviewer_acceptance_jobs`
   for a completed row or retryable failure before declaring the S325 carryover
   closed.

### Owner Decision Needed

1. **Decide whether to harden the manual review-due reminder P2 findings now.**
   Evidence: `lib/services/reviewer-manual-reminder.js:106-107` maps claim
   failures to `conflict` and passes send failure `errors`; `pages/api/review-manager/send-review-reminder.js:63-65`
   echoes `result.errors`; `lib/services/reviewer-reminder-sweep.js:301-305`
   records low-level error messages.
   Decision needed: fix immediately, or defer until the Outstanding/manual nudge
   surface is next touched. Recommended fix shape: do not echo low-level send
   messages to the client, and distinguish claim-update failures from true user
   conflicts.

2. **Decide whether synthesis output quality needs a replay fixture before the staged rehearsal.**
   Evidence: `docs/SESSION_326_REVIEW_FOLLOWUP_REPORT_2026-07-04.md` remaining
   step #3. The payload now includes rating metadata, but the prompt has not
   been replayed against a representative populated review fixture.
   Decision needed: add a non-live replay fixture now, or let the staged/manual
   review submission be the next proof point.

### Parked

1. **Spec-audit docs recovery on the work computer** (~2026-07-08).
   Evidence: `.claude-memory/project-spec-audit-docs-recovery-parked.md`.
   Re-open trigger: only on the work computer, find/push the unpushed
   `codex/spec-audit` branch or dangling commit. Do not reconstruct the docs
   from scratch here.

2. **Institution-COI ledger calibration.**
   Evidence: `scripts/probe-institution-coi-breakdown.mjs` and prior Session 325
   carryover. Re-open trigger: enough accumulated `coi_dropped` rows exist to
   make the threshold measurement meaningful.

### Verify Before Acting

1. **Campaign-settings UX revisit is owner-reported but not source-verified.**
   Evidence: `.claude-memory/project-campaign-settings-ux-revisit.md`.
   Required preflight: trace `CampaignConfigModal`, `/api/review-manager/campaign-config`,
   `send-emails.js`, `ReviewerManagePanel`, and related invite/reminder flows to
   confirm which flows actually re-ask or fail to reuse saved config before
   scoping a UI-only vs persistence/default-store fix.

2. **AwardeeTab stale-response carryover is narrow, not tab-wide.**
   Evidence: `shared/components/workbench/AwardeeTab.js:137-172` already guards
   recipients/abstract loads with `currentRequestIdRef`; `copyWebsiteHtml()` at
   `shared/components/workbench/AwardeeTab.js:302-318` still updates state after
   a request-keyed fetch without a post-fetch request check.
   Required preflight: if touching `AwardeeTab`, add or verify the same stale
   response guard around the website-HTML copy path.

3. **Do not apply old S322 cleanup suggestions without fresh caller checks.**
   Evidence: `docs/DEAD_CODE_DELETION_MANIFEST.md` correction history.
   Required preflight: grep live callers and read likely load-bearing paths
   before any delete/drop/archive action.

4. **Acceptance confirmation email remains at-most-once by design.**
   Evidence: `lib/services/reviewer-acceptance-drain.js` pre-send `claimedAt`
   guard from S325.
   Required preflight: get product/ops approval before changing to
   retry-on-failure semantics.

5. **Synthesis concurrent-generate race remains accepted unless owner changes the contract.**
   Evidence: Session 326 handoff accepted two concurrent staff Generate clicks
   as possible token duplication with last-write-wins; Session 327 only fixed
   writeback failure reporting and digest metadata.
   Required preflight: do not add locking/rate-limiting without an owner ask.

### Do Not Reopen Without New Decision

1. **Companion-LLM evaluation triage is done.**
   Evidence: `f7b5a7fc` and
   `docs/SESSION_326_REVIEW_FOLLOWUP_REPORT_2026-07-04.md`.

2. **Do not re-add CodeQL as a required private-repo gate.**
   Evidence: `180e9046`, `198fbd97`.

3. **Do not delete `lib/services/anthropic-admin.js` as dead code.**
   Evidence: pricing-refresh cron imports it.

4. **Two advisory hooks remain retired by owner approval**
   (`doc-edit-reconcile-reminder.js`, `memory-placement-reminder.js`).
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md`.

5. **`pre-commit-self-review.js` deliberately kept.**
   Evidence: `docs/HARNESS_INSTRUCTION_AUDIT_S322.md`.

6. **Client-side export remains the decision until a Power Automate flow exists.**
   Evidence: `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` decision 4; pure
   `shared/utils/review-report.js` composition remains the seam.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/SESSION_326_REVIEW_FOLLOWUP_REPORT_2026-07-04.md` | Durable report of Session 327 fixes, verification, and remaining next steps. |
| `pages/api/review-manager/synthesize-reviews.js` | Phase 4 synthesis route; digest metadata + fail-closed writeback behavior live in this file. |
| `tests/unit/synthesize-reviews.test.js` | Focused regression coverage for digest shape and writeback failure status handling. |
| `shared/config/prompts/review-synthesis.js` | Prompt contract that consumes `reviews_digest` and requires `ratingSummaries`. |
| `docs/WORKBENCH_REVIEWS_TAB_BUILDOUT_PLAN.md` | Session 326 Reviews-tab buildout plan and verification boundary. |
| `shared/components/workbench/ReviewsTab.js` | Staff Reviews tab: Outstanding, Compare, Export, Synthesis. |
| `lib/services/reviewer-manual-reminder.js` | Manual nudge service; residual P2 hardening item. |
| `lib/services/reviewer-reminder-sweep.js` | Shared cron/manual reminder send helper; source of claim/send error semantics. |
| `pages/api/review-manager/send-review-reminder.js` | Manual reminder API route; currently echoes `result.errors` on failure. |
| `shared/components/workbench/AwardeeTab.js` | Narrow verify-first stale-response item for website HTML copy action. |
| `.gitignore` | Now ignores `.codegraph/` local index files. |

## Testing

```bash
npm test -- tests/unit/synthesize-reviews.test.js tests/unit/review-synthesis-prompt-config.test.js
npm run check:api-routes
npm run check:api-routes:self-test
npm run check:prompt-injection-tagging
npm run check:prompt-injection-tagging:self-test
npm run check:trust-boundary-guid
npm run check:trust-boundary-guid:self-test
npm run generate:docs-catalog
npm run check:docs-catalog
npm run check:doc-symbol-refs
npm run check:doc-symbol-refs:self-test
npm run check:doc-currency
npm run check:doc-currency:self-test
npm run check:fact-consistency
npm run check:fact-consistency:self-test
npm run check:build-claim-freshness
npm run check:build-claim-freshness:self-test
git diff --check
```

Notes:
- `npm run check:docs-catalog:self-test` is not a package script in this repo.
- Full `npm run build` was not rerun in Session 327; Session 327 touched one API
  route, one focused unit test, one report, the generated docs catalog, and
  `.gitignore`.
- Read-only stop probe: `reviewer_acceptance_jobs` totals/recent rows were empty
  on 2026-07-04.
