---
title: Reviewer Lifecycle Stage 1A — Fresh-context Review
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Stage 1A independent fresh-context review

Verdict: **PASS — no required source or test changes found.**

- Review context: `/root/stage1a_fresh_review`, independently initialized for this substage.
- Repository: `/Users/gallivan/Code/WMKF_Apps`.
- Frozen runtime HEAD: `721f4f3d98f9115c5c7382998e014e1e265cf50f`.
- Reviewed diff: `a18f219b..721f4f3d` on `codex/reviewer-lifecycle-stage1a`.
- Scope: stale-invitation expiry only; one runtime service and four test/helper files. Parent-managed uncommitted handoff/receipt edits were inspected as claims, not treated as implementation evidence.
- Read-only review: no repository files changed, live writers invoked, deployments performed, or paid review products used. Independent test artifacts and in-memory mutation tooling were written only under `/tmp`.

## Findings

1. **PASS — fresh pending eligibility and the exact write version are coupled.** [VERIFIED via source and independent tests] `lib/services/reviewer-suggestion-sweep.js:30` selects every field used by the fresh predicate; `:38` requires selection, invitation evidence, false/null response booleans, no response/status/receipt/completion/withdrawal evidence, and no applicant exclusion. `:126` rereads the row; `:127` skips ineligible state, changed Request binding, and unusable versions before writing. `:150` sends only the two existing expiry fields with the fresh ETag. Real annotation processing preserves `@odata.etag` as `_etag` (`lib/services/dynamics/annotations.js:25`), the adapter forwards options unchanged (`lib/dataverse/adapters/reviewer-suggestion.js:1355`, `:1367`), and the actual PATCH header is set at `lib/services/dynamics/write-core.js:175`. No service retry follows a 412.

2. **PASS — missing records remain distinct from operational failures.** [VERIFIED via source and independent tests] `lib/dataverse/core/errors.js:42` requires Dataverse service identity, numeric 404, and the exact ObjectDoesNotExist code. `lib/utils/service-error.js:37` preserves those fields. Sweep `:155` counts that class and numeric 412 as skips; all other failures retain an identifier and bounded message, then permit subsequent rows to run. The fixture change at `tests/helpers/reviewer-engagement-transport.js:249` adds this code only to missing GET-by-id rows on known tables. Unknown tables and malformed paths still throw; the independent helper test at `tests/unit/reviewer-engagement-transport.test.js:64` verifies the distinction.

3. **PASS — parent binding and meeting-date limits are explicit and exercised.** [VERIFIED via source and independent tests] Sweep `:129` binds the fresh row to the discovered Request; `:139` separately rereads that parent's date and requires it to remain strictly before the original cutoff. Missing, malformed, rescheduled, and deleted parents skip. Tests at `tests/integration/reviewer-engagement-races.test.js:255` seed both old and new parents with expired dates, so their no-write assertion actually tests binding. The test at `:297` deliberately demonstrates that a parent-only edit after the final read can still permit expiry. This is a documented limit, not a multi-record lock claim.

4. **PASS — bounded work and the existing consumer contract remain intact.** [VERIFIED via source and independent tests] Sweep `:112` fixes the attempted slice before processing; skips do not pull later candidates into the batch. `:113` preserves `{scanned, eligible, swept, skipped, errors, dryRun}`; `:122` preserves discovery-only dry-run. Invalid discovery dates now safely remain ineligible instead of throwing. The unchanged cron authenticates before its maintenance record, establishes DAL context before the service call, records the complete result, and marks nonempty errors as failed (`pages/api/cron/sweep-stale-invites.js:26`, `:33`, `:36`, `:43`). Its existing `ok: true` JSON means the run returned a result; consumers also receive `errors`. The cron's maintenance writes still occur in dry-run.

5. **PASS — no unrelated lifecycle semantics were changed.** [VERIFIED via frozen diff, source, and independent tests] The persisted output remains `no_response` plus its existing response timestamp. `RESPONSE_TYPE_BY_VALUE` is derived from the write map (`lib/dataverse/adapters/reviewer-suggestion.js:53`); finder DTO `lib/services/reviewer-finder/my-candidates-service.js:291`, reviewer DTO `lib/services/review-manager/reviewers-service.js:303`, and readiness logic `lib/services/review-synthesis-readiness.js:24`, `:85` retain the existing value meaning. No schema, enum, adapter contract, route, transport retry policy, email workflow, or receipt producer changed. The receipt/closeout suite remains green, and F3/F4/F5 characterizations remain explicitly known defects.

## Invariant and complement audit

| Invariant | Complement and actual behavior | Evidence |
|---|---|---|
| Pending invitation required | Accepted/declined, removed, excluded while still selected, missing invitation, malformed booleans, all mapped and unknown response/review statuses, and each sibling terminal timestamp skip | Sweep `:38`; sweep unit `:84`; races `:160`, `:223` |
| Concrete exact ETag required | Missing/null/empty/wildcard/malformed/control-character tags skip; concrete weak and strong tags pass unchanged; a later suggestion edit returns 412 and is not retried | Sweep `:130`, `:153`, `:156`; unit `:108`, `:116`, `:167`; races `:200` |
| Request binding preserved | Missing/reparented suggestions skip before the write; reparenting after authorization loses the conditional PATCH | Sweep `:128`; races `:255`, `:270` |
| Fresh date still expired | Missing/different/deleted parent, invalid/missing/future date, and equality with cutoff skip; a later parent-only edit remains outside this lock | Sweep `:52`, `:139`; unit `:146`; races `:283`, `:297` |
| Fail-soft partial results | Successful rows increment swept, safe no-writes increment skipped, operational failures retain per-row IDs; errors do not prevent later rows | Sweep `:124`; unit `:174`, `:197`, `:204` |
| Repeat does not restamp | Persisted no_response removes the row from next discovery; the second run makes no write | Sweep `:86`; races `:312` |
| No accidental broader policy | Applicant disposition retains the existing excluded-value predicate; this stage does not add a new disposition allowlist. Runtime helpers remain local and narrow | Sweep `:49`; adapter `:97`, `:102`; frozen diff |

Whole-flow, partial-success, async/stale-state, helper fidelity, and consumer fan-out audits pass within this scope. UI state changes, new route security entries, new durable stores/migrations, and shared production-helper extraction are N/A. The helper change preserves the existing transaction/precondition model; its own protocol tests and the composed suites both execute. Durable-doc reconciliation remains parent-owned: the current receipt and SESSION_PROMPT distinguish branch implementation from production and explicitly retain the parent-only limit. Their pending validation/review markers must be replaced with the completed receipts during the final documentation commit; no broader documentation rewrite is requested.

## Verification actually performed

1. Reopened the complete historical refactor report, including Stage 1A, common exit checks G, and the fresh-review interval; read CLAUDE and the contract-reconcile skill. Read the complete Stage 1A receipt and current SESSION_PROMPT, treating their claims as unverified until checked.
2. Used CodeGraph before source lookup, then inspected frozen diff, real route/service/adapter/annotation/error/write transport, relevant DTO/readiness consumers, the complete changed tests/helper, and the unchanged receipt/closeout composition suite. Fresh searches included `sweepStaleInvites|reviewer-suggestion-sweep` across `lib pages shared scripts`, and raw lifecycle fields plus `RESPONSE_TYPE_BY_VALUE` in the relevant source/consumer surfaces. The sole runtime service caller found was the cron route.
3. Ran independently:

   `./node_modules/.bin/jest --runInBand --no-cache --watch=false --runTestsByPath tests/unit/reviewer-suggestion-sweep.test.js tests/integration/reviewer-engagement-races.test.js tests/unit/reviewer-engagement-transport.test.js tests/integration/reviewer-engagement-contract.test.js --json --outputFile=/tmp/reviewer-stage1a-independent-focused.json`

   **4 suites / 159 tests passed; zero failures or skips.** Log: `/tmp/reviewer-stage1a-independent-focused.log`. The composed harness intercepts HTTP, mocks external boundaries, and asserts no unexpected SQL/unsupported transport requests. Its production-host interlock telemetry is an in-memory fixture, not a live probe.
4. Independently tested negative-test nonvacuity with a temporary Jest transformer that changes only source text in memory, leaving repository bytes intact. Each target replacement was asserted to occur exactly once, and each run selected one already-passing composed test:

   - Remove fresh eligibility: the acceptance-after-discovery test fails at races `:175`, receiving `swept: 1` instead of `0`.
   - Remove If-Match forwarding: the acceptance-after-fresh-read test fails at `:215`, receiving `swept: 1` instead of `0`.
   - Remove Request binding: the reparenting test with two expired parents fails at `:265`, receiving `swept: 1` instead of `0`.

   These are intended mutation failures, each 1 failed/35 name-filtered tests, with no compile/setup failure. Logs/JSON: `/tmp/reviewer-stage1a-mutation-{eligibility,ifmatch,binding}.{log,json}`. Tools: `/tmp/reviewer-stage1a-mutation-transformer.cjs` and `/tmp/reviewer-stage1a-mutation.config.cjs`.
5. Ran `git diff --check a18f219b..721f4f3d` successfully, verified exact HEAD, and confirmed subsequent working-tree changes are parent-owned docs rather than runtime source.

## Supplied evidence inspected, not independently rerun

- `/tmp/reviewer-stage1a-full.json`: success true, **770 suites / 9,913 tests passed**, no failed or pending tests/suites.
- `/tmp/reviewer-stage1a-gates.json`: **59 distinct check/self-test commands, all exit 0**. Parent reports serial execution; this review did not run global fixture gates concurrently.
- `/tmp/reviewer-stage1a-build.log`: successful compilation/static generation and completed route output for `npm run build -- --webpack`; parent reports exit 0 and no generated tracked-file diff. Existing configuration/dynamic-dependency/Node localStorage warnings remain.
- The builders' pre-fix red runs were not independently rerun against the base commit. The three independent mutation failures above provide direct nonvacuity evidence for the central guards.

## Remaining limits and final verdict

**PASS for the frozen Stage 1A implementation. Required source/test changes: none. Recommendation Evidence: N/A.**

This establishes source and isolated-test behavior, not deployed Dataverse behavior. Live optimistic-concurrency metadata/server behavior, production population/incidence, actual cron duration under the additional reads, and deployment state were not probed. Parent-only date changes after revalidation remain possible. Existing F3/F4/F5 behavior and historical contradictory rows remain outside Stage 1A. No later stage, merge, live backfill, or production promotion is authorized by this review.
