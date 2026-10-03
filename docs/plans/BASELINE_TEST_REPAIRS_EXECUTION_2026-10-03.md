---
title: Pre-existing Test Failures Repair Execution Record
domain: repository-verification
kind: report
status: complete
summary: "Repairs the seven pre-existing failing Jest suites found during Meeting Tracker read-performance work, with the original contracts retained and targeted negative coverage added."
canonical: false
owner: product-engineering
related:
  - docs/plans/MEETING_TRACKER_READ_PERFORMANCE_EXECUTION_2026-10-03.md
  - docs/audits/MEETING_TRACKER_READ_PERFORMANCE_REVIEW_2026-10-03.md
  - docs/audits/BASELINE_TEST_REPAIRS_REVIEW_2026-10-03.md
  - docs/CI_GATES_REFERENCE.md
  - docs/atlas/postgres-meeting-transcript-publications.md # <!-- drain-table:ignore reason=meeting-transcript-atlas-not-retired-reviewer-publications -->
---

# Pre-existing Test Failures Repair Execution

This record covers the seven Jest suites reproduced against base commit
`fb5d39fc9` while working on `codex/tracker-read-performance`. The repair
worktree started at `4b95863de903ca064173581236eaac2842e51bc7`; the repairs
are source changes only. No application provider call, live data operation, or deployment was made. Development review used subscription-authenticated agent sessions; no project/provider API key was used.

## Diagnoses and changes

| Failing suite | Verified cause | Repair |
|---|---|---|
| `graph-service-boundary.test.js` | The bounded readiness probe directly imports `graph/constants.js` and `graph/http.js` for permission metadata calls. The boundary census correctly reported those edges as unrecorded. | Record only that file, those exact import strings, and their resolved modules. Negative cases reject a sibling script, a different Graph internal, and another specifier resolving to an exempt module. |
| `maintenance-cron-handler.test.js` | The handler gained publication reconciliation after its original test mock setup. The tests did not model that subtask. | Mock and assert the reconciliation call. A separate rejection case proves its failure remains visible in `failedSubtasks` and marks the maintenance run failed. |
| `test-request-visibility-census.test.js` | The new evaluation export route was absent from the route inventory. Its owner-job store query admits only rows whose `request_id` is empty, excluding request-bound rows. | Record the route as not applicable to request visibility, require the route’s `listOwnerJobs` call, and execute the actual store method against a captured query to pin the owner and blank-request predicate. |
| `test-request-scheduled-job-census.test.js` | The transcription drain route and its recovery schedule were absent from the cron inventory. | Record the route as existing staff-launched transcription work, classified alongside review panels, and preserve both exact scheduled paths, including `?recovery=1`, in the schedule census. The census pins the current 24 cron handler files and 23 exact schedule entries covering 22 cron endpoints; the design record retains 23 cron handlers / 21 scheduled paths as its 2026-09-23 historical snapshot. |
| `meeting-transcription-rehearsal-fixture-operator.test.js` | The rehearsal operator still expected the earlier owner projection, which now includes `contentDeletionObserved` and `lateUploadWatchPending`. | Include both flags in the exact projection contract and verify each is false for the synthetic ready row. The insert now returns all four cleanup-state columns and requires each to be exactly `null`; tests reject each missing or populated column with `preflight_projection_failed` and prove rollback without commit. |
| `legacy-host-redirect.test.js`, `security-headers.test.js` | Requiring `next.config.js` in Jest parsed the external ESM `workflow/next` build wrapper. | Mock only `withWorkflow` at the test boundary as an identity wrapper; tests continue to inspect the actual Next config object. The production wrapper and canonical build remain unchanged. |

## Verification

The final focused seven-suite run passed: 7 suites and 122 tests. Log:
`/private/tmp/wmkf-baseline-repairs-focused7-final.log`.

The final full Jest run passed: 1,214 suites passed, 8 skipped; 18,769 tests passed, 72 skipped; 1 snapshot passed. Log: `/private/tmp/wmkf-baseline-repairs-full-jest-final.log`.

Lint exited 0 with 128 warnings and no errors; none of the changed files were
reported. Type checking (`npm run check:types`) exited 0. The canonical
production build (`npm run build`) exited 0. Logs:
`/private/tmp/wmkf-baseline-repairs-lint.log`,
`/private/tmp/wmkf-baseline-repairs-types.log`, and
`/private/tmp/wmkf-baseline-repairs-build.log`.

All 69 package scripts named `check:*` passed in sequence before the final documentation reconciliation. The final documentation gates passed: `check:docs-catalog` (302 files), `check:doc-currency` and its 13/13 self-test, `check:fact-consistency` and its independent self-test, and `check:build-claim-freshness` with its self-test (1,661 references). The catalog was regenerated with `npm run generate:docs-catalog` before checking. The 51 primary
checks passed on the first run. Eighteen self-test commands initially stopped
before assertions because the sandbox denied creation of their temporary
fixture directories inside the worktree; those same self-tests passed when
retried with scoped worktree execution. Per-script logs are under
`/private/tmp/wmkf-baseline-repairs-check-*.log`.

Commands used `env -i` with `PATH` set to the installed Node runtime. No
environment file was copied into the worktree. Node was `v26.6.0`; installed
Next and React versions were `16.3.5` and `18.3.1`. Dependencies were not
changed.

The repair code and checks remain on the feature branch. The related
performance execution and review records now identify the original failures
as historical and link here for current verification. Production promotion
and staff rehearsal remain separate; nothing was pushed or deployed.
No production milestone entry is required for this local verification repair.
