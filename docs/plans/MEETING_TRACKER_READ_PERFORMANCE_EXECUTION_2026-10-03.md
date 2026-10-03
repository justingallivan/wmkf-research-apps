---
title: Meeting Tracker Read Performance Execution Record
domain: meeting-tracker
kind: report
status: complete
summary: "Narrow source change for the Meeting Tracker schedule projection: omit unused reviewer progress and batch Site Visit summaries while preserving the full legacy route contract."
canonical: false
owner: product-engineering
related:
  - docs/API_ROUTE_SECURITY_MATRIX.md
  - docs/atlas/dataverse-wmkf-sitevisit.md
---

# Meeting Tracker Read Performance Execution

This record covers two targeted Meeting Tracker changes: remove unused
reviewer-rollup reads from the schedule projection, and replace per-visit
detail reads with a paginated batch summary. Request context, caching, router
behavior, and unrelated refactors are out of scope. Source and tests are on
`codex/tracker-read-performance` from
`fb5d39fc907f80d294a55157f81726c6671f0204`. **This is not deployed.** No live
Dataverse, Postgres, Vercel, Blob, or browser state was read or changed.

## Behavior and compatibility

The dashboard API keeps the existing absent/default response, including its
reviewer rollup and Site Visit detail hydration. Explicit `projection=full` and
`projection=legacy` use that same path. The Meeting Tracker cycle list and
Session Editor opt into `projection=schedule`; unknown or repeated projection
values return 400 after app authorization and before service reads. With no
cycle, the schedule projection keeps the existing cycle-picker body and adds
only `projection: schedule`.

The schedule selector shares the Workbench's existing email-resolved PD,
program-scope, triage, set-aside, test-request, and ordering rules. It returns
only the row metadata the Tracker consumes and does not call
`fetchReviewerRollup`. The existing Request hydration remains for titles,
current document pointers, and unresolved-request notices. Materials read
fail-open behavior and deliberation reads are unchanged.

The additive Site Visit reader chunks case-insensitively deduplicated request
IDs at 25, uses `queryAllRecords` to follow pages, requests no ActivityParty
expand, and selects format/location only when their schema readiness flag is
on. It returns completion metadata. A capped batch, including the exact 5,000
row limit, yields a typed 503 in schedule mode. The legacy reader and
`findActiveByRequests` consumer used by the Pre-Site Visit cycle view are
unchanged. The schedule projection selects the earliest-ending duplicate from
the complete summary set, retains its reconciliation notice, and makes no
per-visit `getById` calls. Its visit-completeness guarantee is limited to the
selected request IDs; this change does not alter the Workbench proposal
selection's existing capped-result behavior. The batched data is read at
dashboard time and replaces the later per-visit detail re-read; it does not
provide a transaction-wide snapshot guarantee. Mutating actions continue to
re-read current authority and eligibility before writing.

## Call evidence

The composed service test seeds reviewer rows and proves the legacy path calls
`fetchReviewerRollup` once for one request and returns its populated rollup;
the schedule path over the same selected request calls it zero times, omits the
rollup, and retains the displayed row fields. With one selected visit, legacy
service behavior makes one `getById` call; schedule behavior makes zero. The
adapter test calls the real `queryAllRecords` implementation through a mocked
HTTP transport, follows two pages, and proves an earlier-ending visit on the
later page wins. Adapter chunk tests assert one, two, and three Dataverse
summary calls for 25, 26, and 51 unique request IDs. These are deterministic
service/transport counts, not browser latency measurements or production
speedup evidence.

## Verification

Baseline on the source commit before implementation: six focused suites passed
(58 tests). After implementation, the affected run passed 12 suites (126
tests), covering the actual Workbench-to-Tracker composition, legacy/full
parity, Tracker route validation and caller opt-in, paged summary reads,
schema-gated fields, duplicate selection, unresolved-request notices,
materials degradation, the exact cap, and the unchanged Pre-Site Visit reader.

Full Jest completed with 1,207 suites passing, 8 skipped, and 7 failing. The
same seven suites and nine failing tests were reproduced against the clean
`fb5d39fc907f80d294a55157f81726c6671f0204` archive, so they are baseline
failures: Graph boundary inventory, clean-environment cron auth fixtures,
request visibility and scheduled-job inventories, transcription fixture
projection, and two workflow ESM/Jest parse failures. Full-run log:
`/private/tmp/wmkf-tracker-full-jest.log`; baseline log:
`/private/tmp/wmkf-tracker-baseline-jest.log`.

Lint passed with zero errors (128 warnings); type checking passed; the
canonical production build passed. All 69 `check:*` scripts/self-tests passed.
The first full check run reported only the missing Claude-project `memory`
symlink into this worktree's `.claude-memory` directory; after local setup, `check:agent-invariants` passed
with the other 68 checks already green. The drain-table gate and its self-test
passed after the one narrow Atlas-link ignore marker was added to
`docs/atlas/postgres-transcription-pilot.md`. Check log:
`/private/tmp/wmkf-tracker-checks.log`; final invariant rerun:
`/private/tmp/wmkf-tracker-agent-invariants-final.log`; type, lint, and build
logs: `/private/tmp/wmkf-tracker-types.log`,
`/private/tmp/wmkf-tracker-lint.log`, and `/private/tmp/wmkf-tracker-build.log`.

No Meeting Tracker browser E2E fixture exists in `tests/e2e`, and no live
browser/session or external service was used. The verification proves reduced
service calls for the tested compositions; it does not establish user-visible
latency or production performance improvement.

## Review and release handoff

Luna implemented the change. Fresh-context Sol review resolved the full-response
alias, later-page winner coverage, and mixed-case GUID fixture; its final verdict
was READY with no unresolved correctness finding. Root independently traced the
final route, shared selection, pagination, projection and UI consumers and found
no additional runtime blocker. Claude Fable 5.1 then performed the requested
adversarial review through the existing Claude Code subscription OAuth session,
with API-key environment variables removed and read-only tools. It approved
without requesting runtime changes. After reading both failing-test logs, its
bounded final confirmation was **APPROVE TARGETED CHANGE** for a feature-branch
commit, preserving the baseline failures as a release limitation. Full verbatim
Fable verdicts and fingerprints are in the linked review receipt below.

Root additionally hashed all 4,467 tracked blobs in the baseline test archive
against the starting Git tree: zero differences. This verifies the archived
source revision rather than relying only on the directory name.

The seven baseline-red suites are:

- `tests/unit/graph-service-boundary.test.js`
- `tests/unit/maintenance-cron-handler.test.js`
- `tests/unit/test-request-visibility-census.test.js`
- `tests/unit/test-request-scheduled-job-census.test.js`
- `tests/unit/meeting-transcription-rehearsal-fixture-operator.test.js`
- `tests/unit/legacy-host-redirect.test.js`
- `tests/unit/security-headers.test.js`

The source change is complete and reviewed; **the whole Jest suite is not green,
and production promotion is not approved**. Resolve the baseline failures or
obtain an explicit owner disposition before promotion, then perform normal staff
rehearsal and deployment verification. No deployment, migration or live operation
was performed during implementation. The original transcription checkout and its
uncommitted test changes remain untouched.

Rollback: revert the targeted feature commit before promotion, or restore the
prior deployed application if a later approved release needs rollback. No data
migration or repair is involved. Legacy API behavior remains available by omitting
`projection=schedule`; both UI call sites must revert together to use it.

Focused command, executed from the isolated worktree without environment files:

```sh
env -i PATH="$PATH" npm test -- --runInBand --silent \
  tests/unit/workbench-dashboard-service.test.js \
  tests/unit/meeting-tracker-dashboard-service.test.js \
  tests/unit/meeting-tracker-read-performance.test.js \
  tests/unit/meeting-tracker-read-routes.test.js \
  tests/unit/site-visit-adapter.test.js \
  tests/unit/site-visit-summary-batch.test.js \
  tests/unit/dynamics-read-ops-query-all-expand.test.js \
  tests/unit/deliberation-briefing-site-visit-selection.test.js \
  tests/unit/pre-site-visit-cycle-list-service.test.js \
  tests/unit/meeting-tracker-materials-status-integration.test.js \
  tests/unit/meeting-tracker-materials-filters.test.js \
  tests/unit/meeting-tracker-pages.test.js
```

Full suite used the same clean environment with no test-path filter. Each package
script beginning `check:` ran sequentially, including its self-test where present.
The test environment used Node v26.6.0, Next 16.3.5 and React 18.3.1 installed by
`npm ci --ignore-scripts`; no dependency versions were changed.

Review receipt: [Sol, root and Fable evidence](../audits/MEETING_TRACKER_READ_PERFORMANCE_REVIEW_2026-10-03.md).

