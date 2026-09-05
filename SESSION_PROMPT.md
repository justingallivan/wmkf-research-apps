# Session 486 Prompt: Build Reviewer Lifecycle Stage 6B

## Session 485 Summary

The owner selected Stage 6B for another agent to build in the next session.
Codex coordinated parallel source investigations and prepared a bounded build
plan and remaining-work assessment. **This handoff is planning only: no Stage 6B
runtime implementation, extraction or new application test was added.**
The source baseline for the assessment is main `d614de5c`.

### What Was Completed

- A concrete Stage 6B plan sequences **6B1 token/removal/terminal actions → fresh
  review → 6B2 reminder/closeout → fresh review → 6B3 materials-release modal**.
  It specifies action identity, permanent invalidation, cleanup ownership,
  post-await effects, preserved behavior and discriminating tests.
- A readiness audit distinguishes ready first slices, dependent work and optional
  abstractions across remaining Stages 2–7. The narrow raw-policy comparison
  agreed in 30 cases; the imported generic-call inventory reported 19 calls.
  Neither is a complete writer inventory or a new application-test run.
- Current execution routing now selects 6B1. Frozen implementation reviews,
  the original investigation and the completed release receipt remain historical
  evidence. The planning review receipt records the independent plan assessment.

### Existing Release and Commits

[VERIFIED via the recorded release evidence] Stages 0, 1A–1E and 6A are shipped.
Stage 1C confirmed receipt behavior already present. PR 149 merged as `c19a16d8`;
its production deployment reached READY on 2026-09-05 at 17:40:20.139 UTC.
The later documentation-only `d614de5c` deployment reached READY at
17:52:37.434 UTC with all seven expected production aliases attached.
All five push-main workflows for `d614de5c` were subsequently observed successful.

- `c19a16d8` — Merge PR 149: protect reviewer lifecycle writes and report outcomes.
- `d614de5c` — Document the production release and Session 485 handoff.
- This session's documentation commit contains the next build plan, readiness
  audit, plan-review receipt, decision routing update and this prompt; obtain its
  exact hash from `git log` rather than treating the assessment baseline as HEAD.

Final pre-release CI passed 770 suites / 10,850 tests, build, lint and 25 stock
browser cases. The isolated local browser rehearsal passed 31 cases (25 stock
plus six targeted status cases), with no external requests or sends. These are
**previous release results**, not tests of planned Stage 6B. The release smoke
was read-only, and its bounded log scan does not prove live lifecycle mutations,
delivery, concurrency or every production workflow. See the release receipt.

## Next Items

### Verified Open — Selected and Build Ready

**Start Stage 6B1 using `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md`.**
[VERIFIED via CodeGraph and direct source/caller/test inspection at `d614de5c`]
The existing regenerate-token/clipboard, revoke-token, remove-reviewer and
terminal handlers still lack the shipped status handler's full context guards.
The build plan is the execution contract; the readiness audit is broader routing.

1. Run `/start`; verify branch, HEAD, dirty state and agent ownership. Read the
   plan, its fresh review receipt and approved decisions before editing. Recheck
   the named functions against current source so concurrent work is not rebuilt.
2. Create an isolated `codex/` runtime branch under the existing release strategy.
   The current main checkout contains the completed release and this Tier 0
   documentation handoff. Future runtime work still requires deliberate promotion.
3. Act as orchestrator and use native subagents for bounded investigation,
   implementation and fresh independent review. Give one builder ownership of
   `ReviewerManagePanel.js` at a time; do not run 6B slices or 6C edits in parallel
   against that shared surface. Tests must exercise real rendered behavior.
4. Complete 6B1, run the plan's applicable checks, freeze a working commit and
   obtain a fresh independent review. Fix required findings before proceeding.
   Repeat that checkpoint before 6B2 and 6B3. Preserve earlier slices' tests.
5. Continue autonomously within the reviewed plan. Escalate a genuine new product
   or architecture decision; ordinary implementation choices and already settled
   policies do not require another confirmation. Do not deploy merely because
   local build/review passed.

### Owner Decision Needed

No unresolved product-policy decision blocks the selected 6B1 scope.
A proposed server-contract change, broader lock, automatic retry/resend or
reopening of the excluded policies below is outside this plan. Stop and explain
that concrete scope change if it becomes necessary.

### Queued / Optional / Parked

- **Queued within 6B:** 6B2 reminder/closeout and 6B3 materials context safety,
  each after the prior slice's fresh review. They are planned, not implemented.
- **Alternatives, not the next authorized build:** Stage 2 narrow shared policy,
  Stage 3 closeout-command pilot and Stage 5 narrow pointer/thank-you operations
  have source-backed first slices. Stage 3 expansion and Stage 7 depend on the
  relevant migrations and proofs. Stage 6C extraction follows completed 6B and
  an explicit state-ownership contract. See the readiness matrix for details.
- **Optional:** Stage 4 adapter decomposition and a shared receipt-persistence
  helper need demonstrated benefit and, for the helper, a narrow input design.
- Previously parked product items remain parked: progress-pill alignment and
  chronology, Ops eligibility view, automatic reviewer reminders and one-click
  PDF conversion. They were not re-probed as current deployment claims; the
  automatic-reminder hold remains protected by its existing gate.

### Preserve These Contracts

- Shipped status ownership is synchronous and per reviewer within one mounted
  panel, held until settlement. Context loss permanently invalidates feedback;
  returning to the same identity must not revive it. Ordinary same-context
  object/callback churn does not cancel a valid operation. Preserve its mutex,
  outcome parsing and matching-token cleanup while adding the separate 6B paths.
- Stage 6A returns canonical unique batch partitions, executes sequentially and
  stops at first failure. Single submitted IDs retain their formatting. A failed
  adapter operation may have committed or may have rejected before writing;
  complete response loss reveals no partition. Never automatically replay it.
  Historical Stage 3 wording must preserve this shipped contract.
- A confirmed mutation followed by refresh or clipboard failure remains a
  confirmed mutation. A void/self-catching host callback does not prove a fresh
  successful read; UI currentness cannot undo a clipboard write already invoked.
- Receipt declarations enter Review Received and lock normal resubmission;
  closeout and honorarium eligibility remain separate. Generic six-field
  invitation/response corrections reject closed sources and require exact fresh
  ETags. Do not change open-row null/empty status policy during this work.
- Stage 1B post-send retry repairs bookkeeping only. A delivered email is not
  resent; warning feedback does not authorize resend. Preserve reminder holds,
  existing eligibility, server authorization, ETags and action payloads.
- The previous release's explicit exception for separate human UAT and a live
  rollback drill was specific to that release, on an assumed permitting campaign
  window. It is not standing deployment approval or verified campaign timing.

### Do Not Reopen Without a New Decision

Automatic Complete from thank-you; writing the Operations/Finance final remit
flag from this application; BILL API reviewer onboarding. No new schema, live
lifecycle mutation, email send, cron invocation or backfill is authorized by this
planning handoff. Local isolated tests are part of the build scope.

## Key Files

- `docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md` — exact next-build contract,
  scope, tests, review checkpoints and independent-review brief.
- `docs/audits/REVIEWER_LIFECYCLE_STAGE6B_PLAN_REVIEW_2026-09-05.md` — fresh
  independent planning review, assessed revision and verification limits.
- `docs/audits/REVIEWER_LIFECYCLE_REMAINING_READINESS_2026-09-05.md` — remaining
  stage matrix, bounded probes and historical-plan corrections.
- `docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md` — settled
  receipt/correction/batch policies, shipped contracts and current routing.
- `docs/audits/REVIEWER_LIFECYCLE_RELEASE_2026-09-05.md` — completed release,
  exact source/deployment association, CI/browser evidence and accepted limits.
- `docs/audits/REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md` — historical
  investigation; use the current plan and readiness audit for execution status.
- Stage 1D, 1E and 6A receipt/review files in `docs/audits/` — frozen runtime
  and independent-review evidence. Preserve Claude's original separate report
  and its adjacent follow-up receipt unchanged.

## Handoff and Milestone Determination

The next agent begins 6B1; the completed lifecycle release requires no repeat
implementation or release approval. `DEVELOPMENT_LOG.md` already records the
Session 484 production milestone. This session prepared planning documents and
requires **no additional milestone entry**. No CLAUDE.md, schema, API, environment
or memory convention changed. The claim-evidence pilot command remained
unavailable because local state could not be read; no observation row was invented.
