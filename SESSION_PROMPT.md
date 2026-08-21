# Session 451 Prompt: Reviewer Card Action Simplified in Production; Explorer Phase A Remains Open

## Session 450 Summary

Session 450 shipped the missing operational loop for reviewer repair alerts.
The current feature branch then replaced that routine Admin round trip with a
direct staff-owned stored/found email choice while retaining legacy alert
compatibility. It also incorporated Claude's Dynamics Explorer campaign
documents and reconciled the production Log Drain's activation state.

### What Was Completed

1. **Routine reviewer email conflicts became Production-live staff self-service.**
   - Reader compatibility landed in `f59dcff`; runtime/UI/tests landed in
     `e8c90f5` on `codex/reviewer-email-conflict-self-service`.
   - An email-only conflict shows **Review email choice**. A combined identity
     and email conflict shows one primary **Review and confirm** action rather
     than separate email and identity controls. Both paths require an explicit
     **Keep stored** or **Replace with found** selection against a fresh
     server-read tuple, record
     `staff_address_choice` with a non-null ETag-guarded resolution, and makes
     that exact choice invite-ready without a second acknowledgement.
   - Duplicate-owner, inactive-person, and Contact-linkage states identify the
     AkoyaGO record and expose a working **Retry record check** action. Find no
     longer links staff to Admin.
   - Canonical success best-effort auto-resolves server-correlated legacy alerts
     using their persisted keys. A read-only Postgres probe found one active and
     three resolved rows, all with request/candidate correlation and stored
     keys, so compatibility readers were retained and no rows were mutated.
   - The card no longer renders the internal open-alert state as **Repair
     request pending**. A signed-in Production smoke on Neville Sanjana verified
     one explanation, **Review and confirm**, and **Not a fit**; the separate
     **Review email choice**, **Confirm identity**, and pending-repair controls
     were absent. The action was not clicked and no Dataverse write was made.
   - [VERIFIED via source, 1,778 reviewer tests, typecheck, Vercel Turbopack
     build, read-only Postgres probe, and signed-in Production UI smoke on
     2026-08-20. Production deployment `dpl_BeAjDb82UZnK32y4muoSKcH1zQzn` is
     Ready; card simplification commit `5c9c399d`.]

2. **Reviewer repair alerts had previously become actionable from Admin.**
   - PR #128 (`e74d1124`) added a bounded, server-re-read repair context,
     current address/conflict evidence, an explicit closeout sequence, and
     deep links back to the exact Find or Invite surface.
   - PR #129 (`8b61be8d`) aligned that Admin guidance with the actions the
     destination card actually exposes.

3. **Open repair requests remain internal compatibility state.**
   - PR #132 (`be21c450`) historically established the Production baseline
     **Repair request pending · View in Admin**. The current feature branch
     retains the alert projection for deduplication but renders no pending-alert
     control on the card. It shows **Review email choice** for email-only cases,
     or one **Review and confirm** action for combined identity/email cases.
   - Identity-only cases retain **Confirm identity**. A resolved alert no longer
     suppresses a later request if the underlying block persists.
   - Alert-status lookup is fail-soft for roster availability but fail-closed
     for duplicate creation. Creation is transactionally deduplicated under a
     request/candidate-scoped advisory lock, including concurrent calls with
     different reason codes.
   - PR #132 passed all eight required CI/review/security/deployment checks and
     was production-deployed. The public Production auth boundary returned the
     expected sign-in redirect and successful sign-in page response.

4. **Dynamics Explorer behavior campaign docs landed from Claude's isolated worktree.**
   - PR #130 (`7805b27f`) added the campaign plan, read-only analysis/probe
     tooling, and durable SoCal field findings.
   - PR #131 (`8d29e8b1`) recorded Session 449 and created the prior Session
     450 prompt. The Claude worktree was stopped and removed before the
     reviewer branch was promoted.

5. **Production Log Drain activation was reconciled.**
   - [VERIFIED via read-only `operational_events` aggregate, 2026-08-20]
     Production contains 45 `vercel-drain` rows, first seen
     `2026-08-19T21:21:58.177Z` and last seen
     `2026-08-20T20:33:58.144Z`; all rows in the 72-hour aggregate were
     resolved. The canonical runbook was corrected from “not activated” to
     LIVE.
   - This proves signed drain ingestion, not the original Track A
     whole-stream volume/malformed/truncation criteria. Track A therefore
     remains a bounded verification item rather than being declared closed.

### Commits

- `997de04d` - feat(admin): guide reviewer repair alert resolution
- `e74d1124` - Merge PR #128
- `707a719b` - fix(admin): align reviewer repair guidance with card actions
- `8b61be8d` - Merge PR #129
- `1876b2fc` - Draft Dynamics Explorer behavior campaign plan
- `7805b27f` - Merge PR #130
- `558740d4` - Document Session 449 and create Session 450 prompt
- `8d29e8b1` - Merge PR #131
- `9fbc4e1e` - fix(reviewers): show pending repair requests
- `be21c450` - Merge PR #132
- `f59dcff` - feat(reviewers): read staff email choices safely
- `e8c90f5` - feat(reviewers): resolve email conflicts in workbench
- `1c3545f` - docs(reviewers): reconcile email self-service contract
- `0e9b25f` - chore(vercel): exclude local codegraph state
- `ba5a22f` - fix(reviewers): expose combined email choice

## Next Items

### Verified Open

1. **Explorer campaign Phase A: Sonnet 5 posture fix.**
   Evidence: `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` Phase A and
   Session 449 query-log measurements.
   Change `maxTokens` from 2,048 to 16,000, add
   `output_config: { effort: 'low' }` in
   `pages/api/dynamics-explorer/chat.js`, verify the shared LLM client passes
   `output_config`, and log `stop_reason`. This does not depend on the SoCal
   question set.

2. **Observe Stage II Production outcomes through 2026-09-02.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md` exact-on
   Production state and organic-observation window. Do not manufacture shared
   roster rows.

3. **Finish Track A passive-safety closeout against the active drain.**
   Evidence: `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` and
   `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md`.
   The durable sink intentionally retains selected failures, so its 45 rows do
   not establish total event volume, malformed-event count, throttling, or
   truncation. Use complete platform/drain-health evidence for those original
   criteria, then reconcile the two observability docs and close or explicitly
   narrow Track A.

### Blocked on External Input

1. **Explorer campaign Phases C-D (eval seeds and vernacular rubric).**
   Evidence: campaign plan Section 4. Blocked on 10-20 real SoCal questions
   and answers about population-served and `_socal` program-area usage. Phase B
   telemetry is not blocked and is most valuable before behavior changes.

### Owner Decision Needed

1. **Choose an approved request for the Site Visit handoff smoke.**
   Evidence: `docs/WORKBENCH_WRITEUP_LIFECYCLE_PLAN.md`. The action records a
   durable Draft-to-Review milestone; do not click without explicit approval.

2. **After 2026-09-02, retain or remove the Stage II rollout flag.**
   Evidence: `docs/INSTITUTION_PAIR_CONSISTENCY_RESOLUTION_PLAN.md`. Re-probe
   live environment and replacement deployment state before changing it.

### Parked

1. `NEXTAUTH_SECRET` rotation and Vercel Sensitive conversion — reopen only
   with a coordinated session-invalidation window.
2. Reviewer multipart direct-upload conversion — complete consumer discovery
   and obtain an owner decision first.
3. Stage III institution identity authority — blocked until the
   execution-point contract exists.
4. Site Visit dossier/logistics and Final copy transaction.

### Verify Before Acting

1. Production Dataverse reads are owner-run. Never set
   `DATAVERSE_ALLOW_PROD_READS` yourself.
2. `dynamics_query_log.record_count` rows before 2026-08-08 have broken
   semantics; never trend across that boundary.
3. `compactMessages` clearing earlier `tool_use.input` while thinking blocks
   remain is [ASSUMED] safe and untested with a thinking model; pin it in the
   Phase C harness before relying on it.
4. Active/acknowledged repair alerts suppress duplicate creation; resolved
   alerts do not. Re-read live state before changing an alert status.
5. Track A's durable `vercel-drain` rows are a selected failure subset, not a
   complete dependency-event export.

### Do Not Reopen Without New Decision

1. Asker-profile-based program biasing in the Explorer — the owner chose a
   program-neutral rubric on 2026-08-20.
2. Round-exhaustion changes such as raising `MAX_TOOL_ROUNDS` without new
   post-telemetry evidence.
3. Multipart fallback, Stage III activation on the 25-case benchmark, a
   separate Site Visit memo, Vercel CLI reminders, direct-upload smoke, and
   Phase II display smoke.

## Key Files Reference

| File | Purpose |
|---|---|
| `shared/components/reviewers/ReviewerSearchSection.js` | One primary card action, direct email choice, structural retry, and internal pending-alert compatibility |
| `shared/components/reviewers/CandidateEditModal.js` | Explicit Keep stored / Replace with found dialog |
| `pages/api/workbench/reviewer-roster.js` | Roster projection of open repair alerts |
| `lib/services/reviewer-address-trust-service.js` | Fresh pair validation, ETag resolution, structural retry, and alert closeout |
| `lib/services/alert-service.js` | Transactional open-alert deduplication |
| `docs/REVIEWER_EMAIL_CONFLICT_SELF_SERVICE_PLAN.md` | Implemented source contract and sweep evidence |
| `docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md` | Reviewer address trust and retained alert compatibility |
| `docs/OPERATIONAL_EVENTS_AND_LOG_DRAIN.md` | Live drain/runbook and durable-event selection contract |
| `docs/WORKBENCH_OBSERVABILITY_AND_READ_COALESCING_PLAN.md` | Track A criteria |
| `docs/DYNAMICS_EXPLORER_BEHAVIOR_CAMPAIGN_PLAN.md` | Explorer campaign; Phase A is buildable now |
| `.claude-memory/project-dynamics-explorer-socal-campaign.md` | Owner decisions and field-probe findings |

## Testing

The self-service implementation passes 128 reviewer suites / 1,778 tests,
typecheck, and a Vercel Turbopack production build. Deployment
`dpl_BeAjDb82UZnK32y4muoSKcH1zQzn` is Ready and owns the Production aliases.
The signed-in Production smoke verified Neville's simplified card without
clicking its action; it did not select an address, mutate Dataverse, or prove
the live write path. The earlier deployment's dialog smoke through neutral
Cancel remains the evidence for the rendered exact-choice modal.

The Session 450 claim-evidence pilot report was unavailable because its local
observation state could not be read. No observation row was added.
