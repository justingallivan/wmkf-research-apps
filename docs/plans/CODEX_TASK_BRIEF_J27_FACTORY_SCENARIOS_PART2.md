# Part 2: Decision 9 approved. Plan first, no build yet.

From: Claude Fable 5.1 on behalf of Justin Gallivan. Date: 2026-11-08. Follows `CODEX_TASK_BRIEF_J27_FACTORY_SCENARIOS.md` in this directory.

Your blocker report was verified and accepted. The owner has approved **Option 1: a sandbox scenario finalizer**, a new Factory step that may write `wmkf_readyforreview` and the rationale memo on sandbox test-request rows at the Phase I values the scenarios need. The production fence, the prepared-fixture contract, and the existing readiness finalizer stay untouched.

## What to deliver now

A written implementation plan only. **Do not edit source, do not run anything against Dataverse, do not commit.** Write the plan to `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` in this worktree (that file write is the only write you may make) and repeat its full text in your final message. The owner and Claude will review it before any build is authorized.

## Contract to design against

- Target: sandbox only, classified by `lib/dataverse/core/target-registry.js`. The step must refuse any production host before any write, independent of the interlock.
- Rows: only rows with `wmkf_istestrequest = true` whose `wmkf_testcreationrunid` matches a Factory ledger run owned by the same CLI invocation or named explicitly on the command line and re-verified by readback.
- Writes allowed: `wmkf_readyforreview` (true or false), `wmkf_phaseistatus` from the allowlist {unset, Scored 100000004, Not Scored 100000005, Recommended Invite 707510005, Recommended Do Not Invite 707510006, Invited 100000003}, `wmkf_phaseiistatus` and `akoya_requeststatus` only for scenario 7 and only through the existing status setter semantics, `wmkf_initialassessmentrationale` where the field exists in the target. Nothing else. Never `wmkf_triagestatus`.
- Every write journaled in the Factory ledger with the run id, field, prior value, new value, ETag used, actor.
- Dry-run preview that prints every intended write per scenario, then an explicit confirm flag.
- Memo field absent in target: skip the memo write, record the skip in the ledger and the preview, do not fail the scenario.

## Plan contents required

1. Files to add or change, with one line each on what changes. Keep to the owned surface in the Part 1 brief.
2. The guard chain in order, each citing the existing helper it reuses (`assertWritePermitted`, `fenceReadinessClient`, interlock, DAL context) or saying why a new guard is needed.
3. Exactly how scenario 7's Phase II Pending / request status pair is produced, naming the existing setter and its preconditions at `file:line`.
4. Ledger changes: whether a new column, state, or event kind is needed. If yes, the migration shape, and note it is a stop point for owner approval under `ledger:apply` rules.
5. How the eight scenarios map to the step's inputs, and what each row looks like after the run (field by field).
6. Tests: unit tests for the guard chain (including the production refusal, the non-test-row refusal, and the memo-absent path) and for each scenario's end state.
7. Gates you will run, in sequence.
8. Open questions, each with your recommended answer.
9. Anything in the Part 1 brief you believe is wrong or unachievable, stated plainly.

Label every claim about current code `[VERIFIED via file:line]` or `[ASSUMED]`.
