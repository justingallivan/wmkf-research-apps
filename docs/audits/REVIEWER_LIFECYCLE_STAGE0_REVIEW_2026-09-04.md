---
title: Reviewer Lifecycle Stage 0 — Fresh-context Review
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Stage 0 fresh-context review

- Reviewer context: `/root/stage0_fresh_review`
- Frozen HEAD: `b2da65acce8ea2cc25c3a654e48eb84e42884fdd`
- Reviewed diff: `ffc932b7..b2da65ac`
- Verdict: **PASS for Stage 0 only**. No required code corrections. No later stage is approved.
- Repository remained clean at the frozen HEAD. No repository edits, commits, gate fixture runs, live writer calls, deployments, or paid review products were performed.

## Scope

Change surface: test-only composed lifecycle baseline, transport fake, synthesis test isolation, bounded read-only census, and evidence documents. Entry points: six receipt variants, real reviewer DTO and closeout, sweep, email bookkeeping, correction, terminal transition, rendered status action. Persistence: in-memory Dataverse suggestion/answer/Request rows. Consumers: real DTO/closeout, assertions, later-stage implementers. Prior findings checked: F1–F6. Schema/migration and new-enum audits are N/A: none were changed. Documentation review establishes this stage's evidence boundaries, not deployed facts.

Read CLAUDE/AGENTS, the contract-reconcile skill, the complete dated refactor report, complete Stage 0 receipt and complete writer inventory. The dated report is treated as historical, not evidence that F1 remains present.

## Findings

1. **PASS — no application runtime change.** `git diff --name-only ffc932b7..b2da65ac` has tests, two audit documents, and `scripts/inventory-reviewer-lifecycle-writers.js`. The separate Awardees change only supplies the missing Layout PageHeader mock; existing assertions remain. This passes Stage 0's scope restriction.

2. **PASS — the composed receipt assertions reach the real write and read paths.** `tests/integration/reviewer-engagement-contract.test.js:133` defines external/staff full, external/staff upload, partial no-file, and empty no-file producers. At lines 148–179 each checks actual stored receipt/status, exact initial If-Match, actor header, answer count/content, real DTO, closeout, final DTO, and unchanged linked honorarium. The source chain is `submit-service.js:168–191`, `manual-review-entry-service.js:133–183`, `review-upload.js:263–304`, and `mark-received-no-file-service.js:76–150`, through real `core/changeset.js:91–145`, `dynamics/changeset.js:106–165`, and `write-core.js:168–189`. `reviewers-service.js:255–382` reads status, receipt, eligibility and answer snapshots independently. F1 is correctly refuted for new successful receipt writes; old/null/unknown raw statuses are independently characterized at contract-test lines 272–281.

3. **PASS — tested concurrency checks are substantive.** Fake exact preconditions at `tests/helpers/reviewer-engagement-transport.js:200–201` are checked against stored rows; its transaction clone/commit at lines 235–244 rolls back both existing and newly inserted children. The fake unit test at `tests/unit/reviewer-engagement-transport.test.js:64–75` includes existing children that actually get overwritten before the losing parent precondition. Real external/staff races in contract-test lines 301–317 assert the winning narrative and identical final parent/children; receipt/withdrawal/release races at lines 320–348 cover either winner and distinguish honorarium deletion. The service-authorized older ETag is preserved through the adapter reread in lines 226–238. No assertion depends solely on a mocked write count.

4. **PASS — helper differences and postreceipt actions survive.** Full submissions contain narrative snapshots; the upload fixtures deliberately include narrative input while asserting it is excluded from structured answers. Partial/empty fixtures check exact counts and null ratings. The completed-review fixture at contract-test lines 351–403 runs the real DOCX filer and thank-you caller, verifies pointer-only and thank-you-only patches, unchanged receipt/completion/answers, and second-receipt refusal. The relevant real operations are `individual-file-service.js:652–695` and `reviewer-thankyou-sweep.js:58–123`. Graph byte transport and email delivery remain mocked; this is not a live integration claim.

5. **PASS — known defects are honest characterizations.** Races explicitly name KNOWN DEFECT F2/F3/F4/F5 and pin the observed unconditional sweep, closed-response correction, stale-version email bookkeeping, lost reminder increment, and partial batch commit. Source confirms `reviewer-suggestion-sweep.js:93`, `my-candidates-service.js:639–669`, `reviewer-suggestion.js:1868–1919`, `send-emails-service.js:914–949`, and `reviewers-service.js:491–499`. `reviewer-status-mutation-characterization.test.js:50–123` actually renders ManagePanel and exercises HTTP/payload failure, rejected fetch, request switch and unmount on success/failure. `ReviewerManagePanel.js:1788–1798` explains the observed old-refresh callback; the parent loader's separate generation checks remain at `ReviewersTab.js:139–161`.

6. **PASS — external-boundary failures cannot silently validate the composed harness.** The fake records unsupported requests independently of application error handling at helper lines 280–285. Contract afterEach checks every initialized fake and SQL at contract-test lines 118–129. Race afterEach checks rejected fetch results, unexpected requests, SQL and synthesis dependency calls at race-test lines 116–132. The edited reviewers-service unit suite explicitly mocks normal synthesis state and separately asserts the rejected dependency's logged fallback. Its SQL/fetch assertions retain the original F6 lesson. This does not establish isolation of the whole repository.

7. **PASS — census claims match the bounded scanner.** A fresh invocation reproduces 1,282 tracked files, 62 static imports, 173 calls, zero recognized unresolved computed calls, zero parse diagnostics. Call counts include 16 imported updateLifecycle, two patchFields, four patchReviewReceipt, 14 runChangeset and five builders. Source review checks DI/default aliases for honorarium/withdrawal/merge; first-access stamping; identity repoint without the merge ETag; callback references; and script token/reset/raw-REST writers. `inventory-reviewer-lifecycle-writers.js:50–127` and its six fixtures cover the stated static forms. File-local/no-shadowing/no-reexport/unknown-DI limitations are accurately disclosed; this is not an exhaustive dynamic-call or external-automation proof.

## Removed-guard/non-vacuity challenge

These are source counterfactual checks, not a mutation run; no repository code was modified.

- Removing the real parent If-Match fails the exact header assertions at contract-test line 158 and lets the delayed losing producer overwrite the winner in lines 301–317.
- Committing a failed fake transaction changes existing child content/new-child membership in transport-test lines 64–75 and violates winner comparisons in the real-producer races.
- Borrowing the adapter's latest ETag instead of preserving closeout's authorizing version violates contract-test lines 226–238.
- Removing the closeout repeat guard adds a write and changes the row in contract-test lines 241–251.
- Removing the shared finality/terminal guard permits writes against present receipt/terminal input in the six-producer guard matrix; upstream redundant checks can still protect some external cases, so this matrix is behavioral coverage rather than proof every redundant line is individually mutation-sensitive.
- Adding a universal no-receipt check to the existing passthrough breaks the completed-review filer/thank-you test. Its positive fixture has both receipt and Complete, so this is not a vacuous exclusion test.
- Removing the closed-status adapter guard causes the status-changing correction tests in race-test lines 359–364 to write instead of reject.
- The unsupported method/outer-envelope details are also checked by retained real serializer/protocol tests, not only the fake. The fake is intentionally not a full OData server.

## Unresolved questions / limits

- Request ownership changed after route authorization is not locked by a suggestion ETag. `reviewer-request-authorization.js:97–133` reads owner once; `close-review-service.js:134–139` verifies request identity, not current owner. The new suite checks request binding but does not compose a route-to-owner-change race. The receipt explicitly excludes a multi-record Request-owner lock; this remains a future policy/integration issue, not a Stage 0 safety claim.
- The new UI scope is the status handler. Close/reopen of other modal actions, reviewer switch within other pending actions, and broad action-generation protection are future Stage 6B work.
- Fake response/error/projection support is bounded. It does not model all primary-key upsert, relationship/cascade, query, or server concurrency behavior. Existing protocol tests are necessary and passed.
- The retained review-upload suite emits missing-connection-string diagnostics in virus-alert paths; no connection was established. This is existing test-isolation debt, consistent with the receipt's explicit whole-repo limitation.
- Full-suite/build/gates were inspected as saved author evidence, not independently rerun in this read-only review.

## Verification actually performed

1. `npm test -- --runInBand --watch=false --runTestsByPath` for contract, races, transport, inventory, status characterization, reviewers-service, and Awardees: **7 suites / 119 tests passed**.
2. The same command form for dynamics-service-changeset, dynamics-service-write-core, reviewer-closeout-service, reviewer-closeout-route, reviewer-request-authorization, terminal-transition-service, reviewer-activity-history, review-upload, reviewer-thankyou-sweep: **9 suites / 188 tests passed**.
3. Executed the read-only inventory module and inspected counts.
4. Inspected `/tmp/reviewer-stage0-full-final.json`: success=true, **770/770 suites and 9,834/9,834 tests**, zero failed/pending. Inspected final-gates JSON: 61 status-zero entries, and ordered log. Build log records successful compile/static generation/finalization. These are saved receipts, not my command runs.
5. Fresh searches: CodeGraph queries for receipt/guard/changeset/closeout/DTO/pointer symbols; `git diff --stat/--name-only`; `rg` for updateLifecycle/patchFields/patchReviewReceipt/runChangeset, raw suggestion entity, request/owner/reparent/unknown/missing ETag tests, SQL accessor shapes, protocol If-Match/method/under-count tests, callback references, and raw script writes. Direct adjacent line-numbered reads filled CodeGraph omissions.
6. Final `git status --short` empty; HEAD still `b2da65acce8ea2cc25c3a654e48eb84e42884fdd`.

Recommendation Evidence: N/A — no implementation recommendation beyond preserving the already recorded stage limits. Required named corrections: **none**. Root still needs to record this fresh review and complete its authorized handoff documentation.
