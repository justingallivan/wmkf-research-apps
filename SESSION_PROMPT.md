# Session 487 Prompt: Build Reviewer Lifecycle Stage 6B2

## Session 486 Summary

Stage 6B1 of the reviewer lifecycle work was built, exit-tested, independently
reviewed and documented on branch `codex/reviewer-lifecycle-stage6b`.
Claude (Fable) orchestrated; a Sonnet subagent held sole ownership of
`ReviewerManagePanel.js`; an Opus fresh-context subagent reviewed.
**Nothing from this session is merged to `main` or deployed.** Promotion is a
separate, deliberate action under the release strategy.

### What Was Completed

1. **Stage 6B1 runtime (`9258115a`)** — regenerate-token, revoke-token,
   remove-reviewer and terminal-transition feedback in
   `shared/components/reviewers/ReviewerManagePanel.js` is bound to the UI context
   that started it. A per-action/row attempt registry (`actionAttemptsRef`) is
   invalidated by the existing unmount and committed-props layout effects, so
   stale alerts, prompts, clipboard writes and `onRefresh` calls are suppressed
   after request/mode/permission change, row absence or unmount and never revive.
   Confirm dialogs revalidate before dispatch; the terminal payload uses the
   captured requestId; the latest committed `onRefresh` is awaited and a refresh
   failure after a confirmed mutation is reported separately. Payloads, success
   predicates, existing alert text, the status mutex and 6A parsing are unchanged;
   no server file changed. New `tests/unit/reviewer-action-lifetimes.test.js`
   drives the real menu.
2. **Independent review PASS with test-only corrections (`06725d6c`)** — the
   reviewer refuted one builder disconfirmation figure and found two guards with
   no test teeth; 70 discriminating cases were added (refresh-failure across seven
   context changes; permission/read-only revalidation inside confirm; a mid-confirm
   request switch that makes the captured requestId observable). Narrow re-review
   PASS. No runtime change was required.
3. **Exit battery at the final tree** — full suite 771 suites / 11,216 tests,
   `check:types`, lint (0 errors), webpack build with no generated changes,
   `git diff --check`, and the seven named gate pairs serially, all green.
4. **Documentation (`cc6e05ef`, `01b9a316`, `b0faa956`)** — Stage 6B1 receipt
   with the contract-reconcile invariant table, lifecycle/provenance trace,
   corrected disconfirmation figures and both review verdicts; plan, approved
   decisions, readiness audit and the workbench-lifecycle wiki topic now route
   to 6B2. Doc gates and docs catalog green.

### Commits (branch `codex/reviewer-lifecycle-stage6b`, base `71ff2321`)
- `9258115a` - Bind reviewer token, removal and terminal action feedback to current context (Stage 6B1)
- `06725d6c` - Add discriminating lifetime tests for Stage 6B1 review findings
- `cc6e05ef` - Record Stage 6B1 receipt and route Stage 6B plan to 6B2
- `01b9a316` - Note Stage 6B1 completion in the remaining readiness audit
- `b0faa956` - Fold the orchestrator trace and reviewer context into the Stage 6B1 receipt
- Session handoff commit: obtain from `git log`.

## Next Items

### Verified Open

1. **Build Stage 6B2** (reminder action and closeout modal lifetimes) per
   `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` §6B2.
   Evidence: plan status section now routes to 6B2; the Stage 6B1 receipt records
   PASS; `ReviewReminderAction` (`ReviewerManagePanel.js`, unchanged region before
   line 1651) and `ReviewerCloseoutModal.js` are untouched by 6B1.
   Preflight: `/start` on this branch (do not pull main into it); confirm HEAD is
   the handoff commit and the tree is clean; reread the plan's 6B2 section, the
   6B1 receipt and approved decisions lines 130–175; reopen current source via
   CodeGraph since 6B1 moved the handlers about sixty lines. Orchestration split
   that worked: Fable orchestrates, one Sonnet builder owns the runtime file(s),
   Opus reviews fresh-context; the reviewer must actually run tests and reproduce
   guard removals. Give the builder the lifecycle/provenance trace up front.
2. **After 6B2 PASS: Stage 6B3** (materials-release modal session identity and
   asynchronous scratch state). Planned, not started.
3. **Promotion of the branch** is a separate decision once the owner wants 6B
   (or a completed subset) in production. Tier 1 runtime work: PR, CI, deliberate
   merge; follow `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md`.

### Owner Decision Needed

None blocking 6B2. A server-contract change, broader lock, automatic retry or
resend, or reopening the excluded policies below remains outside the plan; stop
and explain if one becomes necessary.

### Parked

- Progress-pill alignment/chronology, Ops eligibility view, automatic reviewer
  reminders (gate-protected hold), one-click PDF conversion. Not re-probed.
- Stage 2 shared policy, Stage 3 closeout-command pilot, Stage 5 pointer/thank-you
  operations, Stage 4 decomposition, Stage 6C extraction (after 6B), Stage 7.
  See `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md`.

### Verify Before Acting

1. Orchestration hazard: never run a test suite or build while a reviewer or
   builder holds the working tree for temporary guard-removal mutations. This
   session had to abort one background full-suite run for that reason; no residue.
2. Two stashes (`stash@{0}`, `stash@{1}`, both July 2026, both
   `docs/RECONCILIATION_REPORT.json`) predate this work and were left alone.
3. Reviewer-named reachability limits, to remember when 6B2/6B3 introduce a
   rejecting callback or a non-blocking dialog: the refresh-failure alert path is
   unreachable today because both hosts swallow refresh errors; the
   permission-during-confirm revalidation is unreachable while `window.confirm`
   blocks the event loop. Both guards and their tests stay.
4. The plan's 6B1 line citations refer to the `d614de5c` baseline; post-6B1 the
   status handler starts near line 1969 and the four handlers near 1804–2155.

### Do Not Reopen Without New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding. No new schema, live
lifecycle mutation, email send, cron invocation or backfill is authorized.

## Preserve These Contracts

- Shipped status ownership: synchronous per-reviewer mutex within one mounted
  panel, permanent invalidation, matching-token cleanup, 6A outcome parsing.
  6B1 added separate feedback-ownership paths; it added no mutex and no disabled controls.
- Stage 6A canonical batch partitions, sequential stop-at-first-failure, no replay.
- A confirmed mutation followed by refresh or clipboard failure is still confirmed.
  A regenerate URL returned to a stale context already exists server-side;
  suppress display only. Terminal 409 `write_failed` may have partially committed.
- Receipt, correction, reminder-hold, ETag and payload contracts as in Session 485's prompt.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` | Execution contract; status routes to 6B2 |
| `docs/audits/REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md` | 6B1 invariants, trace, evidence, review verdicts, limits |
| `docs/audits/REVIEWER_LIFECYCLE_STAGE6B_PLAN_REVIEW_2026-09-05.md` | Planning review (historical) |
| `docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md` | Settled policies and current routing |
| `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` | Remaining-stage matrix with 6B1 status note |
| `shared/components/reviewers/ReviewerManagePanel.js` | 6B1 registry/helpers ~1664–1751; handlers ~1804–2155; status ~1969 |
| `tests/unit/reviewer-action-lifetimes.test.js` | 366 rendered 6B1 lifetime cases |
| `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` | Wiki topic with 6B1 paragraph |

## Testing

```sh
# Retained UI selection plus 6B1 (all must stay green through 6B2/6B3)
npm test -- --runInBand --watch=false --runTestsByPath tests/unit/reviewer-action-lifetimes.test.js tests/unit/reviewer-status-mutation-characterization.test.js tests/unit/reviewer-manage-actions-menu.test.js tests/unit/reviewer-closeout-modal.test.js tests/unit/manage-panel-preview-error-retry.test.js tests/unit/reviewer-manage-proposal-attachment.test.js tests/unit/reviewers-tab-stale-request.test.js tests/unit/reviewers-tab-post-send-refresh.test.js tests/unit/reviewer-follow-up.test.js
# Slice exit
npm test -- --runInBand --watch=false && npm run check:types && npm run lint && npm run build -- --webpack && git diff --check
```

## Handoff and Milestone Determination

No production capability shipped; the branch is unmerged. **No DEVELOPMENT_LOG.md
entry is required.** No CLAUDE.md, schema, API, environment or memory convention
changed. The claim-evidence pilot report recorded no eligible plan/design edit
for this session; no observation row was added.
