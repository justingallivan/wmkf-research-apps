# Review of J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md

Reviewer: Claude Fable 5.1 for Justin Gallivan, 2026-11-08. Mode A (`/contract-reconcile`). Source baseline: this worktree at `53066edc1` (`origin/main`); Workbench facts from `codex/j27-workbench-reports` at `97f696faf`. Untracked; not a commit.

## Step 0, surface

Change surface: a sandbox-only Factory step that provisions J27 Research test requests and writes readiness, Phase I/II status, and the rationale memo to land at eight Initial Assessment states. Entry: new CLI. Persistence: sandbox Dataverse `akoya_request` and `wmkf_appreviewersuggestion`; sandbox Factory ledger (`TEST_REQUEST_SANDBOX_LEDGER_URL`). Consumers: redesigned Workbench discovery and read model, Factory inspection, Factory tests, runbook, Atlas. Prior findings verified: Codex's Part 1 blocker report (upheld, §10 of the plan).

## Findings

1. **CONFIRMED, safety design is sound.** Guard chain order, sandbox classification before any read, interlock and DAL preconditions, ledger-before-dispatch with CAS, true-only readiness fence reuse, no triage or request-status writes, stop-on-ambiguity. Evidence: plan §3 against `status-change-runner.js:112-121`, `production-write-fence.js:364-376`, `interlock.js:56,77`, `context.js:46`. Residual risk: none on safety.

2. **CONFIRMED, scope has grown past Decision 9.** The owner approved one sandbox-only, test-request-only step. The plan adds four modules, edits six shared Factory contracts (`policy.js`, `basic-clone-steps.js`, `sandbox-clone.js`, `status-change-runner.js`, `status-transitions.js`, `run-ledger.js`), two Postgres tables with a migration whose fingerprint reaches the production ledger (plan §5, `ledger-schema.js:41-45`), integration tests, and three doc pages. The owner's Factory principle (memory `feedback-factory-safe-not-full-fidelity`): safety findings at full weight, fidelity findings accepted as limits. Several items below are fidelity.

3. **CONFIRMED, no migration is needed.** Checked:
   - `test_request_readiness_finalizations` (migration 094) has no environment constraint; production-only is the JS `WHERE ... destination_environment='production'` at `readiness-journal.js:17,38`. Parameterizing the environment is a JS change.
   - `test_request_status_changes` (migration 054, line ~380) keys on `run_id` only; production-only is `status-change-runner.js:96` and `:332`. Sandbox runs can journal every numeric Phase I/II write there unchanged.
   - A memo write can be journaled as a `test_request_run_resources` row of the existing kind `dataverse_request_patch` (`run-ledger.js:367-375`) with receipt keys `requestId`, `eTagBefore`, `contentHash` (`run-ledger.js:128-150`, `test_request_receipt_ok` in 054). That satisfies Part 2's "prior value, new value" as digests. Part 2's wording is relaxed accordingly (Q2: yes).
   - Null-clearing Phase I and readiness-false writes, the two remaining drivers for new columns, are dropped (finding 5).
   Required change: delete plan §5's two tables and the migration; replace with the three reuse points above. The `ledger:apply` stop disappears.

4. **NEW, must-have the plan under-states: Research program and PD binding.** `compileBody` adds `wmkf_grantprogram` and `wmkf_programdirector` only inside the production block (`basic-clone-steps.js:653-663`, `policy.js:286-309`) and the sandbox path refuses both (`basic-clone-steps.js:703-706`). Under Decision 1 a row without the Research program GUID (`c247b11a-a7cb-ee11-9078-000d3a341e8f`, verified by probe on the three fixtures) is never discovered, and without the PD the "My proposals" scope is empty (`program-scope-service.js:48`). Required change: the sandbox manifest carries `grantProgramId` and `programDirectorId` (the Workbench caller's sandbox systemuser, resolved by email as `program-director-resolver` does); `sandbox-clone.js` readback verifies both; cast contacts stay refused on sandbox. This replaces the vague `policy.js` line in §2 and is the one provisioning change that is not fidelity.

5. **NEW, fidelity items to cut (owner principle).**
   - Per-row synthetic PI contacts and the "Factory sandbox test institution" label (§6). Sandbox manifests never bind cast (`basic-clone-steps.js:902-904`); the `TEST:` title carries the scenario name and is enough for a legible row.
   - Null-clearing Phase I for scenarios 1, 2, 8 (§6 "Normalize Phase I to null"). Part 1 already allowed whatever the clone leaves; keep it and document the observed value.
   - Writing readiness `false` for scenario 8. `CREATE_FIELDS` omits `wmkf_readyforreview` (`basic-clone-steps.js:123-138`), so a fresh clone is already unready; no write, `fenceReadinessClient` stays true-only, and the "sandbox fence that can write false" in §3.9 is not needed.
   - The separate `j27-sandbox-journal.js` and `status-transitions.js` "scenario-target validator": with finding 3, the status runner's existing option resolution and transition table cover scenarios 3 to 7 (`status-transitions.js:28-31,63-71`).

6. **NEW, Q6 answer is wrong as recommended.** `reviewer-rollup.js:79-90` counts a suggestion as a candidate only when `wmkf_selected === true`; `buildCastSuggestionBody` writes `wmkf_selected = false` (`cast-binding-runner.js:70-80`). Two applicant-recommended unselected rows would read as "No reviewer candidates yet" in the Workbench, which defeats the owner's "slate ready" scenario. Required change: scenario 7's two suggestions are created with `wmkf_selected = true` through the sandbox suggestion dependency (`reviews-sandbox-deps.js:295-310`), not invited, no token, no email; `bindingMismatch` gets a sandbox variant that expects selected true. Verify the Workbench row reads `invite` as work remaining.

7. **NEW, Q3 answered from sandbox automation (read-only probe, 2026-11-08).** Active and auto-triggered on `wmkf_phaseistatus` in sandbox: `WMKF_Rsrch Advance to Proposal Phase` (background) and `WMKF_Phase II Not Invited Draft Email`. `WMKF_Research Phase II Invite` is on-demand only in sandbox. `WMKF Phase I Set Request Status` and `WMKF_Set Phase II Request Status` are active real-time business rules. So scenario 5 may create a draft email and scenario 7 a GoApply tracking row; scenario 7's `Phase II Pending` derivation is plausible but stays `[ASSUMED]` with the plan's stop condition. The production setter already tolerates drafts ("draft emails at most", `status-transitions.js:19-22`). Answer: platform-created drafts are tolerated and censused as today; the census must assert every created email is in Draft state and stop if any is Pending Send; the preview names the scenarios that will produce drafts. "Zero email activities including drafts" would block scenarios 5 and 7 for no safety gain.

8. **CONFIRMED, remaining open questions.** Q1 moot (finding 3). Q4 yes: provisioning through the existing sandbox clone is in scope; the allowlist constrains the finalizer. Q5: reuse the sandbox foundation test organization as the clone does today; no contacts. Q7: the sandbox dependency pattern (`reviews-sandbox-deps.js:96`, `assertSandboxHost`) already pins the origin; use that pattern for request writes rather than the shared `grant-request` adapter, which avoids the adapter-target proof problem the plan raises.

9. **CONFIRMED, citations spot-checked.** `interlock.js:56` `classifyTarget`, `:77` `resolveInterlockMode`; `context.js:46` `withDalContext`; `grant-request.js:247` `updateById`; `reviews-sandbox-deps.js:96` `assertSandboxHost`; `status-change-runner.js:94,112,249`; `prepared-fixture-contract.js:14`; `readiness-finalizer.js:16`; `status-transitions.js:28,47,63`; `basic-clone-steps.js:705`; `cast-binding-runner.js:70`; `reviews-sandbox-deps.js:295`; `ledger-schema.js:41`; `run-ledger.js:393`. All match.

## Recommendation evidence

| Recommendation | Current prerequisite | Available at execution point | Evidence tested | Disconfirming check | Status |
|---|---|---|---|---|---|
| No migration; reuse three ledger surfaces | JS-only env predicates; receipt keys | yes, `readiness-journal.js:17`, `status-change-runner.js:96`, `run-ledger.js:128-150,367` | read | SQL CHECK on environment in 054/094: none found | VERIFIED |
| Program + PD on sandbox manifest | production-only block in `policy.js:286` | needs a sandbox variant | read | fixtures carry program and PD today (probe) | VERIFIED |
| Scenario 7 suggestions selected true | rollup counts selected only | `reviewer-rollup.js:79-90` | read | unselected rows counted elsewhere: `candidates` only increments under `selected` | VERIFIED |
| Tolerate platform drafts | sandbox workflow list | probe 2026-11-08 | GET | an auto workflow that sends: none active with a send step observed; census must still assert Draft | VERIFIED (list), ASSUMED (send behavior) |

## Final verdict

**NEEDS REWORK** (scope), safety design approved as written.

Required named changes for the revised plan:
1. Remove §5 tables and migration; journal through the three existing surfaces (finding 3).
2. Add the Research program and PD binding to the sandbox manifest and readback (finding 4).
3. Cut the fidelity items in finding 5; keep `fenceReadinessClient` true-only; no null-clearing.
4. Scenario 7 suggestions `wmkf_selected = true` (finding 6).
5. Adopt the Q3 answer (finding 7) and the Q4, Q5, Q7 answers (finding 8).
6. Reduce the file list to: new CLI, one new service module, `readiness-journal.js` and `status-change-runner.js` environment parameterization, `policy.js` and `basic-clone-steps.js` sandbox program/PD binding, `sandbox-clone.js` readback, one new unit test file, runbook section, Atlas notes. No shared UI config change.
7. Keep the preview/confirm digest, per-scenario partial-success reporting, and stop conditions.

With these changes there is no owner stop before build other than the owner's build approval itself.

## Addendum: revision 2 verdict (2026-11-08)

All seven required changes are applied. Codex's corrections to this review's citations are accepted: Invited edge at `status-transitions.js:57-59`, Phase I effects at `:41-43`, sandbox refusal at `basic-clone-steps.js:701-704` (verified). Its new qualification is confirmed: `journalPlannedResource` and the dispatch UPDATE require a lease fence (`run-ledger.js:1047-1091`) and `claimLease` admits only prepared, creating, or needs_attention runs (`:877-890`), so ready-run resource journaling needs new narrow transactional operations.

Build-time preference, not a blocker: put those ready-run resource operations inside `run-ledger.js` beside the existing ones so the ledger module stays the only SQL owner, rather than raw SQL in the new service. Otherwise revision 2's file list stands.

Verdict: **READY TO IMPLEMENT** on owner build approval. Remaining stops are runtime (memo field absent, request-status derivation, unsafe email state, unexpected readiness), each already a stop in the plan. Sandbox preview reported before confirm; confirm is a separate authorization.
