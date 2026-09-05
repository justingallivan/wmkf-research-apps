---
title: Reviewer Lifecycle Stage 0 — Regression Harness and Current Baseline
kind: audit
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Reviewer lifecycle Stage 0 receipt

Branch: `codex/reviewer-lifecycle-stage0`
Implementation base: `ffc932b7` (runtime inherited from `90053d11`)
Owner: Codex orchestrator with separate receipt-harness, race-harness, and writer-inventory agents.
Status: implementation verified locally; fresh-context review pending.

This is the execution receipt for Stage 0 of
`REVIEWER_LIFECYCLE_REFACTOR_REPORT_2026-09-04.md`. That report remains a historical
investigation pinned to `097b7f17`; its line numbers and findings are not current
implementation evidence. The user authorized autonomous Stage 0 investigation
and builds with subagents. No production behavior, schema, deployment, external
records, or email delivery is changed by this stage.

## Contract-reconcile scope and invariants

Change surface: test transport, composed receipt/race/UI tests, synthesis-test
isolation, and this evidence record. Entry points: receipt services, reviewer DTO
and closeout services, stale-invitation sweep, email bookkeeping, generic staff
correction, and the rendered status action. Persistence: test-owned in-memory
Dataverse suggestion/answer/request rows; existing production ownership is
unchanged. Consumers: actual DTO/closeout code, test assertions, and future stage
implementers. Prior findings being reverified: F1–F6.

| Invariant | Surface | Verification obligation |
|---|---|---|
| Stage 0 preserves runtime semantics, routes, schema, and authorization | Tests and this receipt | No production-source diff |
| The eligibility version reaches the actual write | HTTP fake and composed tests | Exact If-Match plus final stored-row assertions |
| A failed changeset commits neither parent nor children | HTTP fake and composed tests | Stale parent and failure after an earlier operation |
| Four receipt families feed the real DTO and closeout | Contract suite | Persisted receipt/status, projection, completion, repeat |
| Full/partial receipt, document pointers, and courtesy claims remain distinct | Contract suite and existing suites | No invented answers; postreceipt mutation stays possible |
| Known defects are explicit green characterizations | Race/UI suites | Controlled competing writes and final row/UI outcomes |
| Unexpected SQL or unsupported fixture calls cannot be swallowed into a pass | Test boundaries | Explicit mocks and no-call/error assertions |
| The census follows aliases and separates writes from reads | Writer matrix | Reproducible searches and caller/source inspection |

## Current findings

- **F1 — [VERIFIED via six composed receipt variants] refuted for current
  successful receipt writes.** `b318ede0` already corrected the old payloads.
  All four families now reach the real DTO and closeout with Review Received.
  Historical receipt rows with old/null/unknown status remain submitted in the
  DTO but cannot close out; this is separately characterized, not backfilled.
- **F2 — [VERIFIED via current source] still present.**
  `lib/services/reviewer-suggestion-sweep.js:93` sends an unconditional patch
  after discovery and parent reads. `patchFields` is an alias of
  `patchReviewReceipt` at `lib/dataverse/adapters/reviewer-suggestion.js:1367`.
- **F3 — [VERIFIED via current source] still present.** Response-only fields from
  `lib/services/reviewer-finder/my-candidates-service.js:639` bypass the
  status-changing closed-row check at
  `lib/dataverse/adapters/reviewer-suggestion.js:1868`. The allowed scope of
  historical staff correction remains an owner decision.
- **F4 — [VERIFIED via current source] still present.**
  `lib/services/review-manager/send-emails-service.js:918` derives status/count
  from the pre-send snapshot, while the adapter may borrow a newer version at
  `lib/dataverse/adapters/reviewer-suggestion.js:1915`.
- **F5 — [VERIFIED via current source] still present.** Generic batch updates
  retain sequential partial-commit/throw behavior; the rendered status action
  at `shared/components/reviewers/ReviewerManagePanel.js:1788` ignores HTTP and
  payload failures and retains the captured refresh callback.
- **F6 — [VERIFIED via before/after focused tests] synthesis dependency gap
  corrected in its unit suite.** Before the edit, the four entry suites passed
  64 tests while seven DTO tests logged actual missing Postgres connection
  initialization. The edited reviewers-service suite passes 23 tests, explicitly
  mocks job state, separately asserts unavailable-state fallback and logging,
  and fails if SQL or fetch is called. No whole-repo isolation claim follows.

## Verification record

- [VERIFIED via command] Startup: all 61 package check/self-test commands passed,
  serially. Memory, skills, and tracked instruction symlinks passed.
- [VERIFIED via command] Entry: `npm test -- --runInBand --watch=false
  --runTestsByPath tests/unit/reviewer-closeout-service.test.js
  tests/unit/reviewer-closeout-route.test.js
  tests/unit/reviewer-closeout-modal.test.js tests/unit/reviewers-service.test.js`
  — 4 suites / 64 tests passed; the synthesis initialization errors above were
  recorded before the isolation edit.
- [VERIFIED via command] Existing sweep/send/correction/action/reminder baseline
  — 5 suites / 167 tests passed (race agent receipt).
- [VERIFIED via command] Initial full suite: `npm test -- --runInBand
  --watch=false` — 764 suites passed, 1 failed; 9,738 tests passed, 5 failed.
  All failures were `tests/unit/awardees-page.test.js`, with an undefined
  component rendered by AwardeesList. The same suite failed independently.
  Source investigation found a stale Layout mock missing PageHeader; the real
  component is exported. A minimal test-only mock repair preserves all existing
  assertions and passes all five tests. No Awardees runtime file changed.
  This initial result is historical; the final full-suite result is below.
- [VERIFIED via command] `npm run build -- --webpack` passed, with existing
  dynamic-dependency warnings and a Node localStorage experimental warning.
  Prebuild did not change the migration manifest.
- Existing full-suite tests also emit swallowed `missing_connection_string`
  diagnostics outside the new harness (including intake, acceptance-drain,
  and workbench-coalescing tests). These are retained as baseline isolation
  debt. The new focused harness must have explicit external boundaries.

## Limits and next-stage decisions

The fake models the exercised HTTP/OData subset; it is not a live Dataverse
server, a proof of server atomicity, or a concurrency lock on a separate parent
Request row. Existing write-core/changeset protocol tests remain necessary.
Browser sessions, live schema/data, external automation writers, and production
incidence are outside this isolated test stage.

No semantic fixes are included. Stage 1A/1B/1E remain separate reviewed changes.
Stage 1C still needs the owner interpretation of partial/no-file receipt before
changing semantics, Stage 1D needs the allowed historical-correction policy, and
Stage 6A needs the additive batch response decision. No backfill is authorized.

## Durable-restatement reconciliation

Sweep mode A: establish and record Stage 0 implementation state only. Search
roots: docs, memory, session/root instructions, relevant skills, and test/source
symbols. The old audit is HISTORICAL (explicit commit baseline). SESSION_PROMPT
is the live handoff and will be rewritten after review. Other Stage 0 matches
refer to unrelated discovery, contact-enrichment, DAL, or assessment projects
and are UNRELATED. Production deployment and old closeout-memory assertions
are excluded because this stage makes no deployment claim or change.

## Writer census and preserved boundaries

The complete alias-aware matrix is in
[the writer inventory](REVIEWER_LIFECYCLE_WRITER_INVENTORY_2026-09-04.md), with
`node scripts/inventory-reviewer-lifecycle-writers.js` as the read-only
reproduction tool. The baseline covers 1,281 tracked source/script files and
173 resolved imported calls: 55 suggestion writer-export calls, 99 reader/pure
calls, 14 changeset calls, and 5 parent/children builders. Adapter-internal,
raw REST/script writes, and changeset callback references are accounted for
separately. The scanner's own addition increases scanned files by one without
adding lifecycle calls. Zero unresolved calls applies only to recognized static
bindings; scope/shadowing, cross-file reexports, unknown DI and reflection are
not solved by this inventory.

The census distinguishes command, receipt, document-pointer, email-claim,
projection, token, candidate/reset/merge, and administrative roles. In particular,
first-access context reads write a stamp, honorarium onboarding writes a lookup
through a destructured dependency alias, and identity reconciliation repoints
without the ETag used by merge. These live differences must survive later moves.
No compatibility wrapper, live script, or persistence operation is removed.

## Composed coverage and complement audit

| Boundary | Evidence and limits |
|---|---|
| Four receipt families, six variants | 42 contract tests exercise external/staff full authoring, external/staff upload, partial and empty no-file through actual services, adapters, serialized HTTP, DTO and closeout. Full authoring retains narrative snapshots; upload/partial do not invent them. |
| Concurrency and atomicity | Two full producers race with either winner; full receipt races withdrawal/release with either winner. Exact If-Match protects final parent/children, and losing children roll back. Tests distinguish the linked-honorarium delete from release. |
| Closeout prerequisites and complements | Request binding, missing ETag, selected/accepted flags, notes, opt-out/link dispositions, unknown eligibility, no-write repeat and correction without timestamp restamp are asserted against stored rows. |
| Postreceipt operations | Actual DOCX filing and thank-you caller remain valid after Complete; a second receipt is refused. File/render/hash work is real, Graph byte transport and email delivery are mocked. |
| Fake integrity | 14 helper tests cover tag uniqueness (including seeded tags), missing/stale/wildcard preconditions, detached snapshots, select/filter behavior, controlled before/after pauses, success and rollback after earlier child writes, and unsupported URL/query/method handling. |
| F2–F5 race and UI baseline | 21 race tests and 8 rendered UI tests pin known defects explicitly, including first/middle/last batch failures, terminal and 412 complements, request switch and unmount on success and failure. |
| Census and synthesis isolation | 6 scanner fixtures plus 23 reviewers-service tests verify aliases/DI/parser limitations and explicit normal/unavailable synthesis dependency behavior. |

New suites assert unexpected fixture requests and SQL calls instead of merely
throwing errors that a service could swallow. Every initialized transport is
checked, including those replaced inside table-driven guard tests. The filer
preflight requires a production-classified origin; that one fixture takes its
host from the tracked registry, intercepts every fetch, preserves the real
interlock, and restores environment state in `finally`. It performs no live
production authentication or request. Other fixtures use an inert `.invalid`
origin with real trusted-DAL enforcement. No route authentication proof is
inferred from service composition.

The seven contract audits are accounted for: whole-flow service-to-persistence-
to-consumer composition; partial success and atomic rollback; controlled stale
versions/UI callbacks; helper semantic separation and unsupported complements;
durable surfaces (tests/census/docs only, no migrations/routes/schema); this
bounded doc reconciliation; and raw-column writer/read fan-out in the census.
There are no new persisted enum values or columns to migrate.

Existing coverage retained with its actual mocked boundary:

| Contract | Existing suite / scope |
|---|---|
| Route auth and lead-PD ownership | `reviewer-closeout-route.test.js` mocks auth/DAL/authorization/service; `reviewer-request-authorization.test.js` executes authorization with mocked adapters. |
| Token security | `verify-suggestion-token.test.js` runs token crypto/hash/revocation/expiry checks against a mocked row read; external submit route tests mock token verifier, transport, and trusted guard. |
| Acceptance cross-store protocol | `external-review-routes.test.js` covers stage → Dataverse → queued ordering, cancel after 412, queued-marker failure and uncertain-write retention with mocked adapter/job boundaries. |
| Withdrawal postcommit failure | `terminal-transition-service.test.js` covers job-cancellation warning with mocked adapter. |
| Reset parity | `reviewer-activity-history.test.js` parses the actual reset entries and requires a nonempty field set; no copied replacement constant. |
| Upload losing attempt cleanup | `review-upload.test.js` retains same-name/winner identity and cleanup branches with Graph and batch transport mocked. |

These boundaries do not prove a multi-record Request owner lock or exactly-once
cross-system effects. Those remain separate policy/integration questions.

## Final validation and review

- [VERIFIED via final Jest JSON] `npm test -- --runInBand --watch=false --json
  --outputFile=/tmp/reviewer-stage0-full-final.json`: **770 suites / 9,834 tests
  passed**, zero failed, zero skipped. This includes the five repaired Awardees
  assertions and all new suites.
- [VERIFIED via command] ESLint passes for every changed test/helper and the
  read-only inventory script. The initial `.cjs` scanner filename hit the repo's
  ESLint plugin scope; using the standard CommonJS `.js` script extension fixed
  it without any lint configuration change.
- [VERIFIED via read-only census] Once tracked: 1,282 files, 62 static-import
  declarations, 173 resolved calls, zero recognized unresolved computed calls,
  zero parse diagnostics.
- Baseline-fixture repair commit: `79434493` (PageHeader mock only).

[VERIFIED via serial command battery] All **61** package check/self-test
commands passed, including types, DAL/context/route boundaries, Atlas, docs,
secrets, and instruction invariants. Gate and self-test execution was sequential.

The implementation commit, fresh review identifier/verdict, and final handoff
reconciliation are recorded after the frozen review.
