---
title: Reviewer Engagement Lifecycle — Read-only Investigation and Staged Refactor Plan
domain: reviewer-workbench
kind: audit
status: proposed
canonical: false
owner: product-engineering
last_verified: 2026-09-04
---

# Reviewer engagement lifecycle: make business transitions consistent across entry points

Repository: `/private/tmp/wmkf-session474-main`  
Branch: `codex/reviewer-closeout-eligibility-app`  
Evidence baseline: `097b7f173ceb0bf2a9db72af428697380038dd45`  
Investigation date: 2026-09-04 America/Los_Angeles

This is a proposed implementation guide, **not authorization to execute it**. The investigation made no source changes, commits, deployments, or database writes. This requested report is the sole repository file created by this investigation. Paths and line numbers below refer to the baseline above; future executors must relocate symbols after each stage. “Documents folder” is interpreted as the repository's `docs/` directory; the report is under its existing `audits/` folder.

> **Final worktree observation:** HEAD remained `097b7f17`, but another writer modified tracked files during final review: the closeout brief; `review-upload.js`; `mark-received-no-file-service.js`; their three receipt tests; `reviewer-closeout-modal.test.js`; and later the receipt-passthrough comment in `lib/dataverse/adapters/reviewer-suggestion.js:1347-1353`. This investigation did not modify them. The concurrent source diff adds `REVIEW_STATUS_MAP.review_received` to both receipt payloads (current `lib/services/review-upload.js:269` and `lib/services/review-manager/mark-received-no-file-service.js:90`). **F1 therefore describes the committed baseline, with a prospective fix now present but unverified in the working tree.** Stage 1C must review/adopt that work, not duplicate or overwrite it. The 63-test result predates these changes. A stable final working-tree build/test receipt is unavailable; rerun Stage 0 after coordination. All other baseline citations remain pinned to the commit, not a claim that the checkout stayed unchanged.

Labels: **[VERIFIED]** means inspected source or a command actually run; **[PLANNED]** means proposed work; **[DOCUMENTED]** means an existing intended contract or historical claim; **[UNRESOLVED]** means evidence or an owner decision is still needed. Source verification does not establish deployed behavior or production incidence.

## 1. Executive conclusion

**[PLANNED recommendation] The highest-value large refactor identified is a reviewer-engagement command boundary:** consolidate the rules for invitation, response, receipt, withdrawal, closeout, and bookkeeping while preserving separate workflows and storage ownership. Give each operation a narrow input, an explicit eligible source state, the version of the row on which that decision was made, and an honest outcome. Keep routes, public DTOs, authentication, and existing Dataverse/Postgres responsibilities stable during extraction.

**[VERIFIED] This is not a proposal to repeat the DAL migration.** The existing DAL plan labels its migration historical and complete (`docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md:21-34`); the route/service plan records completed extraction and explicitly preserved caller-specific behavior (`docs/ROUTE_SERVICE_CONSOLIDATION_PLAN.md:19-35,59-89`). The current adapter still exposes both guarded lifecycle updates and arbitrary-field passthroughs (`lib/dataverse/adapters/reviewer-suggestion.js:1355-1367,1780-1920`). Passing import-boundary checks therefore does not prove equivalent business rules.

**[VERIFIED] The candidate has substantial breadth:** the suggestion adapter is 2,254 lines, ManagePanel 2,171, send-emails service 1,455, and save-candidates service 1,753 at this checkout (line-count inventory command). Size only supports scope; the decisive evidence is the inconsistent behavior in findings F1–F6 below. The search UI is even larger, but size alone is not sufficient reason to rewrite it.

**[UNRESOLVED] “Largest” and “nobody has planned it” cannot be proved objectively from a bounded audit.** Existing plans cover many individual pieces. This report scopes the largest coherent remaining improvement supported by the traced reviewer flows, rather than claiming an exhaustive ranking of every subsystem or knowledge of contributors' available time. A generic ORM replacement, framework migration, new workflow engine, and moving operational Postgres tables to Dataverse would not directly address these findings.

**Recommended order:** establish composed tests; fix demonstrated defects in place; pilot a narrow command with closeout; migrate related callers one operation at a time; only then split adapter internals where that makes ownership clearer. Preserve compatibility wrappers until the final caller audit. Do not combine semantic fixes with file moves.

## 2. End-to-end behavior trace

### A. Staff closeout: the reference operation to preserve

1. **UI/client state [VERIFIED].** `shared/components/reviewers/ReviewersTab.js:139-161` loads reviewers with both request-id and generation checks on success, failure, and loading completion. `ReviewerManagePanel.js:259-260` exposes closeout only for `review_received` or `complete`; `:2137-2145` hosts the modal and refresh callback. `ReviewerCloseoutModal.js:65-99` sends `{suggestionId, disposition, notes}`, prevents duplicate submits, checks HTTP and payload success, and suppresses results after unmount. Its option rules at `:20-38` are presentation logic, not authorization.
2. **API/auth [VERIFIED].** `pages/api/review-manager/close-review.js:20-62` enforces app access, method, GUID, exact disposition and bounded notes, derives actor identity from the session, establishes DAL context, and authorizes ownership. `lib/services/reviewer-request-authorization.js:53-87,97-133` resolves suggestion-to-request ownership and requires the lead PD or superuser. `close-review.js:62` passes the authorized request id forward.
3. **Business rules [VERIFIED].** `lib/services/review-manager/close-review-service.js:25-67,123-141` rereads selected/accepted/nonexcluded/received state and ETag, checks request binding, and validates opt-out/honorarium link. `:147-186` handles repeat as no-write success and correction without restamping. `:189-207` requires raw Review Received and writes one conditional closeout.
4. **Adapter/mapping [VERIFIED].** `shared/config/reviewerLifecycle.js:19-26,39-43` maps Review Received to `100000003`, Complete to `100000004`, and eligibility to `100000000..100000002`. `lib/dataverse/adapters/reviewer-suggestion.js:1782-1832` maps API fields to raw columns; `:1862-1919` enforces exclusion/closed-status rules and forwards If-Match. `lib/services/dynamics/write-core.js:168-175` attaches If-Match to the actual update. The existing actor/context transport remains authoritative.
5. **Consumers [VERIFIED].** `reviewers-service.js:292-342` returns status, receipt, completion and eligibility separately, including `unknown` for an unrecognized stored disposition. History counts receipts rather than PD closeout (`reviewer-suggestion.js:398-428`). `shared/components/reviewers/reviewer-modes.js:19-34` includes Complete in Track. A source search of `lib`, `pages`, and `shared` found the remit flag only in explanatory schema/config text; no runtime writer was found.
6. **Meaning [DOCUMENTED].** Complete is human review closeout, thank-you is independent, and Operations retains final remit authority (`docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md:28-44,109-126`). That document labels deployment pending at `:48-56,311-317`. No production claim was independently re-probed here.

### B. Four receipt producers: related, but not interchangeable

| Producer | Verified path and preserved distinction |
|---|---|
| External full authoring | `pages/api/external/review/[token]/submit.js:59-76` derives identity/capability from the verified token. `lib/services/external-review/submit-service.js:101-191` checks finality/material availability, validates full submission and commits parent plus answer children. Legacy missing setVersion is accepted at `:137-138`. Draft cleanup failure after commit is nonfatal at `:224-233`. |
| Staff full manual entry | `lib/services/review-manager/manual-review-entry-service.js:127-206` requires matching setVersion at `:141`, adds staff attribution at `:162`, and commits an atomic changeset at `:180`. Cleanup at `:201` is nonfatal. Do not weaken its version requirement to match the external legacy path. |
| Staff/external file upload | `lib/services/review-upload.js:134-230` validates, scans, enforces the external materials gate and allocates an attempt-specific folder. `:263-300` persists pointers, receipt and structured snapshots. `:303-339` handles 412 without deleting potentially valuable/winning files; token shortening at `:342-351` is postcommit and nonfatal. |
| Staff partial/no-file receipt | `lib/services/review-manager/mark-received-no-file-service.js:75-148` allows partial data. Zero snapshot rows use a parent-only conditional PATCH; nonzero rows use one parent-plus-children changeset. This is not a full narrative submission. |

**[VERIFIED] Shared receipt authorization already exists.** `lib/services/review-receipt-guard.js:32-44` rejects terminal/received/ineligible/missing-ETag rows. All four producer families call it. Preserve the version used for eligibility; external submit's fallback reread also reauthorizes the new row (`submit-service.js:173-182`). Do not add a second receipt policy under a new name.

**[VERIFIED] Persistence is not always the suggestion adapter's update method.** Full/structured writes construct changeset descriptors and use `lib/dataverse/core/changeset.js:91-118,121-145`, with answer rows and parent in one atomic unit. The parent precondition must veto the entire batch. `lib/external/build-review-submission.js:171-180` writes both receipt timestamp and Review Received status; upload/no-file patches differ (F1).

### C. Acceptance, withdrawal, email, and background consumers

- **[VERIFIED] Acceptance spans two stores.** `lib/services/external-review/respond-service.js:388-434` stages an acceptance job before the Dataverse accept, cancels on 412, and treats queued-marker failure as nonfatal. `reviewer-acceptance-job-service.js:117-139` deduplicates by `(suggestion_id, accepted_at)` and can reopen failed/cancelled jobs. Keep this protocol intact; do not call it “one transaction.”
- **[VERIFIED] Withdrawal and release differ.** `review-manager/terminal-transition-service.js:95-143` uses an atomic withdrawal/honorarium-delete operation for withdrew, but a status-plus-token-revocation update for released. Acceptance-job cancellation is after commit and may produce a warning. The acceptance worker rechecks state and compensates late honorarium creation (`reviewer-acceptance-drain.js:477-521,638-662`). Never attach these effects to a generic status setter.
- **[VERIFIED] Receipt does not synchronously enqueue synthesis.** `review-synthesis-drain.js:33-53` scans and enqueues; `:75-104` rechecks before generation. `review-synthesis-readiness.js:56-89,155-179` uses raw state, receipt and selected/nonexcluded population. Its Postgres jobs are operational state, not the submitted answer source. The Atlas distinguishes these stores (`docs/APPLICATION_STATE_ATLAS.md:109-113,185-186`).
- **[VERIFIED] Thank-you is a claim protocol.** `reviewer-thankyou-sweep.js:58-123` builds the attachment, requires ETag, claims `wmkf_thankyousentat`, then sends. Post-claim send failure retains the marker. Eligibility is receipt-based (`:137-139`). Manual send bookkeeping instead stamps after transport (`review-manager/send-emails-service.js:915-949`). Neither is a Complete transition.
- **[VERIFIED] Filing a DOCX is not receiving another review.** `review-documents/individual-file-service.js:652-695` conditionally writes folder/filename pointers after receipt. It currently calls the misleadingly named `patchReviewReceipt`, as does thank-you claim. This is an essential extraction trap.
- **[VERIFIED] Cron dry-run is not necessarily read-only.** `pages/api/cron/sweep-stale-invites.js:26-47` writes a maintenance run around the service even with dryRun enabled. This investigation did not invoke it or any live probe.

## 3. Findings ordered by severity

Severity denotes implementation priority and impact, not a claim of exploitation or production incident. Race findings below are source-supported interleavings; they have not been reproduced against a live database.

### F1 — High: receipt entry points disagree with the closeout prerequisite

**[VERIFIED source; end-to-end runtime test still required].** No-file receipt explicitly writes timestamp/staff flag without status (`mark-received-no-file-service.js:86-90`); upload does the same with file pointers (`review-upload.js:263-269`). Full submission writes Review Received (`build-review-submission.js:171-180`). The DTO trusts raw status and defaults missing status to accepted (`reviewers-service.js:255-257`); the closeout action requires received/complete (`ReviewerManagePanel.js:259-260`) and the service requires raw received (`close-review-service.js:189-193`). Thus receipt from an earlier accepted/materials status can be submitted and visible as a receipt while remaining ineligible for direct closeout until separately corrected. No-file without structuredData is particularly unambiguous: validator returns empty parent fields (`lib/external/review-form-schema.js:260-261`). The upload tail only shortens token expiry (`lib/services/review-upload.js:342-350`); no-file returns immediately after persistence (`lib/services/review-manager/mark-received-no-file-service.js:148`). An independent source review found no automatic normalizer in these paths.

**Required next proof:** compose each producer → real DTO → closeout using a transport fake. Proposed correction: future successful receipt writes atomically advance Review Received in all four paths. Confirm partial/no-file receipt's eligibility meaning before changing it. No historical backfill and no inference from thank-you. Do not silently include this behavior change in extraction.

### F2 — High: stale-invite cleanup can overwrite a newer response

**[VERIFIED mechanism].** `reviewer-suggestion-sweep.js:48-67` discovers pending suggestions then awaits request reads; `:93-96` sends an unconditional no-response/timestamp patch. `reviewer-suggestion.js:1355-1367` simply forwards it; transport only adds If-Match when supplied (`dynamics/write-core.js:168-175`). An acceptance between discovery and patch can leave accepted=true and responseType=no_response. Synthesis treats no_response as a resolved non-review outcome when no receipt exists (`review-synthesis-readiness.js:24-28,85-86`). This can prematurely resolve a participant, subject to other readiness conditions.

Fix the operation, not its name: eligibility reread plus same-version If-Match, no blind retry after 412, and classified skipped results. Recheck parent meeting-date assumptions separately; a suggestion ETag does not lock its parent request. Existing sweep tests explicitly expect options without If-Match (`tests/unit/reviewer-suggestion-sweep.test.js:21-45`).

### F3 — High: authorized staff correction can bypass closed-engagement semantics

**[VERIFIED mechanism; intended staff-correction scope unresolved].** `my-candidates-service.js:638-660` forwards independent accepted/declined/response fields. `reviewer-suggestion.js:1868-1875` blocks a closed row only when reviewStatus changes. Response-only edits bypass that guard and receive no default version at `:1914-1915`. They also do not perform dedicated withdrawal's effects (`terminal-transition-service.js:97-137`). This is an authorized-staff semantic bypass, not an unauthenticated route vulnerability; the route is guarded (`pages/api/reviewer-finder/my-candidates.js:56-65` and its handlePatch authorization).

Before redesigning corrections, decide which historical corrections remain supported. Recommended invariant: closed engagement's response/receipt evidence cannot be rewritten through the generic route; notes/eligibility corrections continue through their dedicated contract. Explicitly inventory compatibility callers rather than deleting this live route.

### F4 — High: post-send status changes combine stale decisions with a newer ETag

**[VERIFIED mechanism].** `send-emails-service.js:917-935` computes transitions/reminder count from the earlier recipient snapshot and calls updateLifecycle without its version. The adapter rereads at `:1862` but only blocks transitions out of closed statuses; it uses that newer ETag at `:1915`. A receipt committed during send can then be regressed to materials_sent or under_review. Its receipt timestamp remains, so readers disagree. Two reminder sends can also compute the same increment.

A safe bookkeeping operation freshly evaluates allowable status advancement against the version it writes. On a conflict, re-read and re-evaluate bookkeeping only; never resend the email as a retry strategy. Keep an explicit sent-but-not-recorded outcome and recovery path. Invitation already exposes such a distinction (`send-emails-service.js:815-838`); preserve it.

### F5 — Medium: partial mutation and UI success handling are inconsistent

**[VERIFIED].** Generic batch correction writes sequentially and throws after earlier writes (`reviewers-service.js:491-499`); route maps generic error to 500 without successful ids (`pages/api/review-manager/reviewers.js:147-156`). The test pins this behavior (`tests/unit/reviewers-service.test.js:88-97`). Single status correction ignores HTTP status and refreshes even on 4xx/5xx (`ReviewerManagePanel.js:1794-1804`). Terminal transitions already return per-id outcomes (`terminal-transition-service.js:64-155`).

Preserve old batch behavior during moves; improve it in a separate additive contract stage with successful/failed/unattempted identifiers and a client that reconciles actual successes. Do not parallelize or turn `ok:true` into “every item succeeded.” UI error checking can be fixed independently.

### F6 — Medium: tests and gates can stay green while the business boundary is broken

**[VERIFIED].** The reviewed service tests often replace the entire adapter (`reviewer-closeout-service.test.js:6-19`; `reviewers-service.test.js:15-26`). External submit integration tests mock trusted-context enforcement and batch transport (`tests/integration/external-review-submit-route.test.js:17-44`). These are useful unit/composition tests at their stated boundary, but cannot establish actual authorization or transport atomicity. `jest.config.js:29-42` omits `lib/` from default collected coverage and disables thresholds. No general coverage percentage should be treated as evidence for this refactor.

**[VERIFIED command].** Four focused suites passed, 63 tests total, but `reviewers-service.test.js` allowed the synthesis-job read to reach Postgres initialization; it failed for missing connection string and was swallowed at `reviewers-service.js:407-412`. This is a concrete test-isolation gap. No live connection was established. Mock this dependency explicitly and test the unavailable branch separately; do not just silence console.error.

**[VERIFIED extraction hazard].** `tests/unit/reviewer-activity-history.test.js:309-326` parses reset fields from the adapter's source. It includes a useful nonempty assertion. Moving the constant without updating this test breaks the suite; copying a stale fixture instead would remove its protection. Preserve its link to the actual reset set.

### F7 — Low: documentation has conflicting or stale statements

**[STALE/CONFLICT].** The closeout brief accepts the Ops interface as later follow-up at `:53-56` and repeats that at `:315-317`, but its operations section says an absent consumer prevents end-to-end completion at `:271-276`. Treat the dated owner decision as the recorded decision and clarify the older rollout prose before implementation promotion; do not create an extra blocker or write the payment flag.

`jest.setup.js:39-44` says DAL enforcement is “OFF only in prod,” while runtime is configurable and literal on enables it (`dynamics-context.js:124-128`). This comment is stale/misleading as a blanket deployment statement; actual environment was not inspected. By contrast, the closeout brief's pre-build baseline is explicitly marked superseded (`:58`): its old behaviors are historical, not a second current implementation. Do not flag them as live code merely because search finds them.

## 4. Evidence and recommendation table

All paths are repository-relative to the absolute root at the top. Line ranges identify the precise logical regions; the first line is a stable starting locator at the pinned commit.

| ID | Material evidence | What it proves / limit |
|---|---|---|
| E01 | `lib/dataverse/adapters/reviewer-suggestion.js:1355-1367` | Raw patch aliases exist; not a universal semantic guard. |
| E02 | `lib/dataverse/adapters/reviewer-suggestion.js:1862-1919` | Guard/read/precondition behavior, including response-only gap. |
| E03 | `shared/config/reviewerLifecycle.js:11-50` | Canonical maps already exist; reuse rather than replace. |
| E04 | `pages/api/review-manager/close-review.js:20-70` | Session identity, auth, input and error envelope. |
| E05 | `lib/services/reviewer-request-authorization.js:53-133` | Server ownership and batch preauthorization; not a database-wide ownership lock. |
| E06 | `lib/services/review-manager/close-review-service.js:123-207` | Fresh request binding, duplicate no-write, correction, conditional closeout. |
| E07 | `lib/services/reviewer-suggestion-sweep.js:48-96` | Discovery-to-write race; sequential rerun filtering is not concurrent idempotence. |
| E08 | `lib/services/review-manager/send-emails-service.js:915-949` | Stale bookkeeping decisions and already-sent error posture. |
| E09 | `lib/services/reviewer-finder/my-candidates-service.js:638-667` | Generic response mutation plus token side effect. |
| E10 | `lib/services/review-manager/mark-received-no-file-service.js:75-148`; `lib/services/review-upload.js:263-300`; `lib/external/build-review-submission.js:171-180` | Different receipt parent patches. |
| E11 | `lib/services/review-receipt-guard.js:13-55` | Existing shared finality and same-row-version guard. |
| E12 | `lib/dataverse/core/changeset.js:91-145` | Descriptor mapping, trusted context, children+parent composition. Live atomicity not exercised here. |
| E13 | `lib/services/review-manager/reviewers-service.js:255-260,292-373` | Raw status versus receipt DTO, child snapshot read path. |
| E14 | `shared/components/reviewers/ReviewersTab.js:139-161`; `shared/components/reviewers/ReviewerManagePanel.js:1794-1804` | Guarded loader versus unchecked mutation response. |
| E15 | `lib/services/review-synthesis-drain.js:33-104`; `lib/services/review-synthesis-readiness.js:56-118` | Independent scan and revalidation; avoid inventing receipt-time enqueue. |
| E16 | `lib/services/reviewer-thankyou-sweep.js:58-139`; `lib/services/review-documents/individual-file-service.js:652-695` | Postreceipt consumers that would break under a blanket receipt guard. |
| E17 | `lib/services/review-manager/terminal-transition-service.js:95-155`; `lib/services/reviewer-acceptance-job-service.js:117-139,185-198` | Cross-store partial success, dedup and leased-job cancellation limits. |
| E18 | `tests/unit/reviewers-service.test.js:15-48,88-97`; `jest.config.js:29-42` | Mock boundary and intentionally pinned partial failure; limited coverage claims. |
| E19 | `tests/unit/review-upload.test.js:395-508`; `tests/unit/manual-review-entry-service.test.js:106-136,185-205` | Useful existing race/cleanup evidence to preserve, not an absent-test claim. |
| E20 | `docs/REVIEWER_COMPLETION_AND_HONORARIUM_DECISION_BRIEF.md:28-56,132-145,258-276,311-317` | Owner contract, pending deployment and conflicting operations prose. |

| Recommendation | Current prerequisite | Evidence tested in this investigation | Disconfirming check | Status |
|---|---|---|---|---|
| Introduce narrow commands | Existing guarded closeout and shared maps, E03/E06 | Read source; closeout unit/route/UI tests passed | Run real adapter underneath command; mutate row between decision and write | PLANNED; pilot required |
| Conditional expire/bookkeeping | Existing transport accepts If-Match, E02/E07/E08 | Source trace, independent review | Controlled competing acceptance/receipt wins without being overwritten | PLANNED; race tests required |
| Unify future receipt status | Different producer payloads and strict closeout, E06/E10/E13 | Source trace | Demonstrate existing normalizer for all four producers, or receipt-to-closeout test succeeds without correction | PLANNED; semantic approval/proof required |
| Split adapter selectively | Live facade consumers and source-parsing test | Source and caller search | A split causes cycles or makes tests bypass moved implementation | OPTIONAL after pilot |
| Keep stores and recovery protocols | Existing acceptance/synthesis jobs, E15/E17 | Source only | A proposed move changes job dedup, claim or receipt ordering | REQUIRED invariant |

## 5. Test gaps, uncertainties, and verification performed

### Verification actually performed

- `git status --short`, `git branch --show-current`, `git rev-parse HEAD`: clean requested branch at the pinned commit before report creation.
- `.codegraph/` absent; AGENTS.md is a symlink to CLAUDE.md. Used `rg`, directory inventories and line-numbered source reads.
- Ran `./node_modules/.bin/jest --runInBand --no-cache --watch=false --runTestsByPath tests/unit/reviewer-closeout-service.test.js tests/unit/reviewer-closeout-route.test.js tests/unit/reviewer-closeout-modal.test.js tests/unit/reviewers-service.test.js`: **4 suites, 63 tests passed**, with the unmocked Postgres initialization warning described in F6.
- Scope and receipt reviews began in separate fresh read-only contexts; sequencing and receipt follow-ups continued in those reviewer contexts. A separate final fresh-context audit reviews the complete staged document. Reviewer evidence is source-only; reviewers did not run tests or query external state.
- **Not run:** build/prebuild, all gate self-tests, browser smoke, live schema probes, cron endpoints or production operations. `package.json:7` runs a manifest-generation prebuild, and self-tests may write fixtures. The user's read-only constraint takes precedence over startup instructions to pull or generate fixtures. No claim of a currently green full build is made.

### Tests that must be added or strengthened before their dependent stages

Use a stateful in-memory transport fake beneath the **real service and adapter**. It must implement row ETags, atomic batch all-or-none behavior, and controlled pause points. Mock external networking/Graph/SQL at the boundary, not the operation being proved. Transport protocol tests must separately verify If-Match and batch formatting; the fake cannot prove Dataverse's server behavior.

1. Four receipt producers → GET projection → closeout; include partial/no-file, received timestamp with old status, and unknown status. Verify no synthesized answers or completion timestamp.
2. Acceptance after sweep discovery; receipt/terminal transition during send; missing ETag; two reminder increments. Assert final stored rows and exact preconditions, not only call count.
3. Generic correction on Complete/withdrew/released, allowed note/eligibility correction, unauthorized PD, suggestion reparenting, and request ownership changed during processing. The last case may require an explicit authority policy: suggestion ETag does not lock a separate request row.
4. Mixed batch first/middle/last failure with successful/failed/unattempted identities and UI reconciliation. Existing old-contract test remains until that contract deliberately changes.
5. Completed review can still receive a DOCX pointer and thank-you claim while a second receipt fails. Existing thank-you suite mocks the adapter (`tests/unit/reviewer-thankyou-sweep.test.js:37-44`); add composed coverage.
6. Submit versus manual submission and receipt versus withdrawal, using the real descriptor builder plus fake atomic commit. Preserve existing upload same-filename/winner tests rather than replacing them with a mocked 412.
7. UI request/reviewer switch while action pending, success and error, close/reopen and unmount. Preserve existing guarded ReviewersTab behavior and server-confirmed invitation overlays (`ReviewersTab.js:139-180`).
8. Failure after acceptance-job staging, after DV accept but before queued marker, after withdrawal before cancellation, and after courtesy claim before send. Never assert exactly-once cross-system delivery.
9. Unknown numeric enums, null versus false, no honorarium versus opt-out, valid symmetric mappings, resets/merge/select-list parity. Do not promote unknown raw status to accepted as a new policy merely because the current DTO defaults that way.

**Unresolved owner/deployment questions:** precise allowed generic staff corrections; whether no-file receipt always qualifies for the received-status transition; desired additive batch outcome contract; acceptable post-send conflict repair behavior; request-ownership changes across multi-record operations; current deployment/schema/permissions/PA writers. Live population sizes, existing contradictory rows and real incident frequency remain unknown. None justifies a backfill or destructive action in this plan.

## 6. Staged migration plan and next steps

### Execution contract for a cheaper model

**[PLANNED] Work on one numbered stage/substage at a time.** Before editing, read this report, current AGENTS/CLAUDE, applicable rules, and the precise listed source/test regions. Recheck branch/HEAD/dirty files. If HEAD differs, revalidate assumptions rather than using old line numbers blindly. Preserve unrelated changes. Future implementation requires separate user authorization; production promotion is a separate deliberate step.

Each stage ends only after its tests, relevant gates, full build, diff review, and fresh-context review pass. A failing stage remains unfinished; do not weaken a gate or change an expectation merely to obtain green. Newly discovered behavior decisions stop only the dependent substage. “No new schema” is a constraint: changes requiring storage migration must return for a separate design.

**Common exit checks for every implementation stage (G):**

- Run focused suites with external dependencies isolated, then the full test suite using the repository's current scripts. Fail on unexpected real network/SQL calls.
- Run `check:types`, `check:dataverse-access-layer`, `check:route-service-boundary`, `check:dynamics-context-boundary`, `check:api-routes`, `check:route-lifecycle-auth`, `check:trust-boundary-guid`, and `check:status-enum-parity` where affected. Read current package.json/CI_GATES_REFERENCE for changed names and additional applicable gates.
- Run a gate and its self-test **sequentially**, never concurrently. For docs/projection/persistence surfaces run Atlas, doc-currency, fact-consistency, doc-symbol and catalog checks as applicable. Do not rewrite canonical counters from this report's inventory.
- Run `npm run build -- --webpack` (the branch handoff's build form; confirm current package support first). This is a future write-authorized operation. Inspect any prebuild-generated diff. Baseline failures must be resolved or explicitly classified before migration can claim green.
- Review raw field fan-out in `lib`, `pages`, `shared`, `scripts`, tests and docs. Compare imports, public exports, DTOs, error envelopes, operation ordering and actor/ETag forwarding.
- Record exact HEAD, commands/results and reviewer corrections. Revert only the current stage if necessary; retain prior proven fixes. Git rollback does not unsend email, restore a deleted honorarium or undo a receipt. No automated data rollback.

### Stage 0 — Establish a trustworthy baseline and regression harness

**Entry tests:** existing four focused suites above must pass; first fix their test isolation (not production code). Inventory existing receipt, sweep, send, terminal, merge, reset, token and UI tests before relying on their names.

**Changes in order:** (1) add a test helper under `tests/helpers/reviewer-engagement-transport.js`; (2) add `tests/integration/reviewer-engagement-contract.test.js`; (3) add `tests/integration/reviewer-engagement-races.test.js`; (4) explicitly mock synthesis job state in the existing reviewers-service suite; (5) document caller inventory in the implementation stage receipt.

Inventory every `updateLifecycle`, `patchFields`, `patchReviewReceipt`, `runChangeset`, suggestion entity literal and raw lifecycle column use. Include aliases, namespace imports, token setters, merge/reselection/reset and scripts. Categorize each as command, document-pointer mutation, email claim, projection, or administrative tooling. A grep list is a lower bound; follow aliases and imported helpers.

Characterization tests for known bugs should initially describe the observed behavior, clearly named as defects; introduce red/green regression assertions within the later fixing change, not as permanently skipped tests. Baseline stage must stay green. No production files move.

**Exit:** G, baseline matrix with all entry points, and fresh reviewer challenges whether the fake enforces the real preconditions. If the existing build is red, do not begin extraction.

### Stage 1 — Correct demonstrated inconsistencies in place

**Entry tests:** Stage 0 harness; failing reproductions for the specific substage ready before modifying its implementation. Each substage is separately tested and green before the next dependent substage.

1. **1A expire:** change only `lib/services/reviewer-suggestion-sweep.js` and the minimum adapter operation needed. Use a fresh eligible suggestion and its ETag; classify changed/missing-version rows without overwrite. Preserve bounded batches and dry-run. Test acceptance, exclusion/removal, missing parent, missing ETag and 412. Do not treat the parent meeting date as protected by suggestion ETag.
2. **1B email bookkeeping:** change only post-send bookkeeping in `lib/services/review-manager/send-emails-service.js` plus narrow adapter support. Re-read and re-evaluate status/count on the version written. No automatic transport resend. Tests cover receipt/terminal race and concurrent increments, successful send with failed stamp and SSE terminal events. Keep invitation inline-stamp ordering and separate manual thank-you behavior.
3. **1C receipt status:** after approving partial/no-file semantics, change future receipt payloads in `lib/services/review-upload.js` then `lib/services/review-manager/mark-received-no-file-service.js` to include mapped Review Received atomically. Full submission remains unchanged. Require four-producer receipt→GET→closeout tests, including existing received/terminal rejection. Do not backfill old records or alter answers.
4. **1D corrections:** after the owner defines allowed staff corrections, enforce them in `lib/services/reviewer-finder/my-candidates-service.js` with adapter defense. Preserve the route and authorized compatible callers. Do not conflate decline, withdrawal and release. Closed-response rewrite must be a negative composed test.
5. **1E UI errors:** fix `ReviewerManagePanel.js:updateStatus` in place to check HTTP/payload outcomes and report failure; test it before extracting UI.

**Exit:** G per substage, review F1–F5 against fresh source. 1A/1B/1E need not wait for the unresolved 1C/1D product decisions. No file moves yet. Update old characterization assertions deliberately with the invariant and reason.

### Stage 2 — Consolidate pure policy only where it is duplicated

**Entry tests:** table-driven raw-row versus DTO inputs, all enum values and unknown/null complements; receipt/terminal/closeout tests; reset/source-parity test.

**Changes in order:** reuse `shared/config/reviewerLifecycle.js` and `reviewerStatus.js`; introduce `shared/utils/reviewer-engagement-policy.js` for narrowly shared predicates only; keep distinct input functions for raw rows and DTOs. Move proven duplicated eligibility logic into those functions, one caller at a time. Preserve old public exports. Do not move server imports into browser-safe shared code.

Keep `lib/services/review-receipt-guard.js` as the receipt authorization contract. Do not collapse its errors into generic false. No generic state-machine framework and no universal “done” predicate: Complete, withdrew/released, receipt and invitation expiry answer different questions.

**Exit:** G and comparison matrix proving semantic differences preserved; no new network calls or new map values. Fresh reviewer verifies the policy's invalid/complement inputs.

### Stage 3 — Pilot and expand named server commands

**Entry tests:** real-service/real-adapter closeout composition; request binding, missing ETag, no-write repeat, correction without restamp, note validation, 412, unknown eligibility, and a linked honorarium fixture proving no request update.

**Move order:**

1. Move `lib/services/review-manager/close-review-service.js` implementation to `lib/services/reviewer-engagement/close-review.js`; leave its original module as a compatibility re-export/wrapper preserving error identity and test-visible exports. Keep the route path/import stable for this pilot.
2. After pilot review, move `review-manager/terminal-transition-service.js` to `reviewer-engagement/terminal-transition.js` with a compatibility wrapper. Keep withdrawal's atomic delete and postcommit cancellation warning intact.
3. Extract only `patchReviewers` from `review-manager/reviewers-service.js` to `reviewer-engagement/correct-status.js`; leave getReviewers and its projections in place. Preserve batch behavior until Stage 6.
4. Extract the approved response-only correction from `reviewer-finder/my-candidates-service.js` to `reviewer-engagement/correct-response.js`; leave person edits and restore at the old service. Preserve lifecycle-write → nonfatal accepted=true token follow-up → person-edit order (`my-candidates-service.js:660-677`) and its partial-success behavior; do not drop the token follow-up during extraction. Manual-invite handling is assigned below.
5. Extract the fixed conditional expire operation to `reviewer-engagement/expire-invitation.js` and fixed post-send bookkeeping to `reviewer-engagement/record-email-outcome.js`. Keep scan orchestration, email transport, streaming and correlation at their original sites.

**Remaining writer assignments (required before Stage 7):** after the five moves above, migrate these in table order, testing each separately. All new service targets below live under `lib/services/reviewer-engagement/`; old orchestration files remain wrappers/callers. These are distinct operation contracts, not mode flags on an arbitrary patch API.

| Order / current live caller | Destination and behavior to preserve | Tests required before migration |
|---|---|---|
| 6. `review-manager/send-emails-service.js:827`; `reviewer-finder/my-candidates-service.js:616`; `reviewer-finder/generate-emails-service.js:501`; generic invite fields at `my-candidates-service.js:638-660` | `record-invitation.js` with separate delivered-invitation, secure-link manual-record and legacy mark-as-sent functions. Generic historical correction belongs to the approved correction contract, not delivered evidence. Preserve inline post-send stamps versus manual verified-link stamps. Draft generation does not establish actual delivery; preserve legacy mark-as-sent behavior until separately approved. | Per-path timestamp/token handling, stale manual link, transport success/stamp failure, generation-only behavior, duplicate capture and mixed person edits. |
| 7. `reviewer-reminder-sweep.js:395-419` | `claim-reminder.js` for pre-send conditional claim. Keep respond-token mint+claim coupling and review-due count claim distinct; never route through post-send record-email-outcome. | Same-version claim, 412 means no send, token/marker atomicity, send failure after claim, review-due token remains unchanged. |
| 8. `reviewer-due-extension.js:298-315` | `change-review-deadline.js`, retaining existing eligibility, exact date validation, fresh ETag and persistence-before-notification. Old service handles notification envelope. | Date complements, stale version, closed/received row, persisted deadline with failed notification. |
| 9. `review-manager/withdraw-sufficient-service.js:255-276` | `withdraw-pending-invitation.js`, preserving conditional pending-response transition before courtesy send. Do not use accepted-reviewer withdrawal/delete or release semantics. | Acceptance racing withdrawal, 412 no courtesy send, per-id results, successful transition with send failure. |
| 10. `external-review/respond-service.js:255-272` | Narrow adapter operation `deselectLegacyDeclinedSuggestion`, called inside existing external authenticated context; preserve verified-row precondition and response envelope. | Already-declined+selected repair, changed version, already deselected, missing version policy made explicit before tightening. |
| 11. `reviewer-finder/my-candidates-service.js:508-534`; `reviewer-suggestion.js:2245-2251` | Keep adapter-owned bulk metadata operation limited to grantCycleCode/programArea; replace its dependence on a broad lifecycle setter only after preserving sequential failure behavior. | Field whitelist, normalization, empty updates, middle-row failure, no response/status field accepted. |
| 12. Existing acceptance/decline, token, candidate reset/merge, honorarium compensation and removal operations | Keep existing named adapter/core operations; inventory and test their fields/preconditions. These are legitimate specialized boundaries, not reasons to keep unrestricted raw patches globally available. | Acceptance/decline atomic effects, token row binding, reset real-field parity, merged closed engagement rejection, compensation races. |

**Gate rule:** a lifecycle writer may call its reviewed named adapter operation; it need not be forced through a universal command. Stage 7 blocks *unassigned arbitrary mutation* and newly introduced bypasses. Do not prohibit legitimate existing specialized persistence merely to achieve a single entry point. The Stage 0 alias-aware census must identify any additional caller before declaring this table exhaustive.

Commands take explicit arguments including the authorized request binding where relevant. Routes continue establishing auth/DAL context; moving a service must not mint trusted context before auth. Each command still delegates persistence to the adapter. No universal arbitrary patch command. Add a caller-boundary census test before migrating the second command, so new generic bypasses cannot grow unnoticed.

**Exit:** G after each move, fresh command review, original-path tests plus direct new-path tests execute the same implementation. Do not progress on wrapper-only passing tests.

### Stage 4 — Optional targeted adapter decomposition

**Entry decision:** only proceed if Stage 3 demonstrates a clarity/testability benefit. A smaller facade alone is not an acceptance criterion. Skipping this stage is valid and must be recorded.

**Entry tests:** facade export parity, real transport preconditions, reset/merge/token behavior, source-inspection dependencies identified. Update tests to follow actual reset definitions without copying a stale list.

**Move order, one leaf at a time:** (1) shared adapter constants/projections → `lib/dataverse/adapters/reviewer-suggestion/constants.js`; (2) pure query implementations → `.../queries.js`; (3) token transport → `.../tokens.js`; (4) conditional lifecycle persistence → `.../lifecycle.js`; (5) receipt/pointer/claim transport → `.../receipt.js`; (6) candidate/reselection/reset/merge implementations → `.../candidates.js` only if separately proven worthwhile. Keep `lib/dataverse/adapters/reviewer-suggestion.js` as public facade throughout.

Raw Dynamics imports remain within the adapter boundary. Leaves import leaves, never their facade. Rewire internal dependencies explicitly: selectIfUnengaged currently calls findById, bulkUpdateByRequest calls updateLifecycle. Preserve public `patchFields === patchReviewReceipt` until the deliberate narrowing stage. Transport-level invariant guards remain present while semantic rules live in commands; do not weaken defense in depth to make a diagram cleaner.

**Exit:** G per leaf; no cycle, no changed payload/projection/actor/error. Preserve gate coverage for nested adapter paths. Revert a leaf move independently if it adds complexity.

### Stage 5 — Migrate receipt and postreceipt operations without changing their contracts

**Entry tests:** all four producer families plus completed-review pointer and thank-you tests; child+parent atomicity; same-version finality; full versus partial data; version requirements; postcommit failure outcomes. Stage 1C must be resolved before claiming all receipts are closeout-compatible.

**Change order:** (1) introduce distinct narrow adapter operations for attaching a review document and claiming thank-you; migrate `review-documents/individual-file-service.js` then `reviewer-thankyou-sweep.js`; (2) decide whether repeated receipt persistence warrants `lib/services/reviewer-engagement/persist-receipt.js`; if yes, migrate external submit, staff manual entry, upload, then no-file independently. Keep original service modules and HTTP envelopes.

The optional helper cannot accept arbitrary entity sets, caller-selected lifecycle fields, or unbounded operation descriptors. It reuses existing builders and `atomicParentWithChildren`/`runChangeset`. It accepts already validated snapshots plus an explicit receipt-kind and authorized version; it does not perform token auth, infer missing answers, or send email. It delegates atomic persistence without splitting parent and children. Leave `lib/external/verify-suggestion-token.js`, form/schema/snapshot builders, Graph upload, draft service, PG jobs and DAL transport in their current files. Never put “no existing receipt” on document attachment or courtesy claim.

**Exit:** G, rerun cross-family races and postreceipt cases. Fresh reviewer must disprove any accidental full/partial normalization. Keep synthesis scan scheduling and acceptance compensation unchanged.

### Stage 6 — Improve outcomes and extract UI independently

**Entry tests:** HTTP failure/pending actions and host-loader generation tests; mixed batch result tests designed against the approved additive response contract; existing invite overlays and material release tests.

**6A outcome change:** deliberately revise generic correction's old sequential-error contract to return successful, failed and unattempted ids, preserving stop-on-first-failure unless separately approved. Authorization remains all-or-none before writes. Update route, service and every consumer together; characterize all-failed versus partial success. Do not claim this is behavior-preserving.

**6B async fix in place:** bind mutation results to request/reviewer/action generation and mounted state on success and failure. Preserve parent ReviewersTab guards. Cover modal prop changes while mounted, not just unmount. Do not remove server-confirmed invitation overlays.

**6C mechanical extraction:** after 6A/6B pass, move `TokenActionsMenu` rendering from `ReviewerManagePanel.js` to `shared/components/reviewers/ReviewerActionsMenu.js`, preserving the original named export for callers/tests; move its action state/handlers to `shared/components/reviewers/useReviewerActions.js`; move ReleaseMaterialsModal last to `shared/components/reviewers/ReleaseMaterialsModal.js`. Leave the existing closeout modal in place. Preserve serialized render queue, abort/timeout handling, SSE completion and focus/keyboard behavior. Do not split the unrelated search UI.

**Exit:** G per substage; focused browser/UI tests with transport mocks; original parent remains the refresh owner. Fresh reviewer checks every post-await state/alert/callback, not only fetch completion.

### Stage 7 — Close bypasses and reconcile the durable contract

**Entry tests:** direct and aliased imports, namespace calls, changed raw fields, changeset descriptors, scripts and all postreceipt operations represented in the census. Each rejection rule must have a positive fixture that would otherwise write.

Narrow generic lifecycle/raw-patch access only after its live callers are migrated. Keep compatibility wrappers unless the complete caller scan proves they are unused; never delete live scripts or operational repair hooks merely to get a zero count. Add an alias-aware boundary gate with self-tests for new bypasses, and extend enum/projection checks where needed. Do not maintain an ever-growing exception allowlist as the final solution.

Reconcile service catalog, relevant Atlas pages, route security matrix, closeout brief and lifecycle documentation using the repository's durable-doc rules. Distinguish historical baselines from current claims. Record resolved owner decisions and operational limits. No schema apply, database drop or bulk backfill is part of completion.

**Exit:** G, full fresh-context end-to-end review, and a separate future deployment checklist. Operational validation must use an explicitly authorized environment and safe records; never use Production cron dry-run as a read-only check. The implementation can be build-green before production behavior is proven; report those statuses separately.

### Fresh-context review interval and stop rule

**During this planning investigation:**

- **Checkpoint A, scope:** independent source review confirmed three inconsistent mutation paths and qualified the “largest” claim. It required reviewer-finder correction to be in scope.
- **Checkpoint B, sequencing:** independent reread moved the command pilot before the optional adapter split, recognized existing maps/receipt guard, separated fixes from moves, and identified reset-source tests and wrapper-mock risks. These corrections are incorporated above.
- **Checkpoint C, receipt:** independent trace expanded three assumed producers to four, preserved differing setVersion/partial-data contracts, identified postreceipt alias consumers, and rejected invented immediate synthesis enqueue/cancellation. These corrections are incorporated above.

Checkpoint A and the initial receipt review used fresh contexts; follow-up challenges reused their reviewer context. A final independent context (`fresh_plan_audit`) reopened source and audited Stages 0–7: 0/2/4/5 passed as planning stages; 1/6 retained named decisions/proofs; 3/7 required complete writer assignments and token-follow-up preservation. The writer matrix and receipt-helper restrictions above incorporate those corrections. The audit is baseline-only because concurrent worktree changes appeared during review. These are reviews of this plan, not receipts that future migration stages passed. Do not count follow-up messages as fresh-context reviews in the future stage protocol below.

**[PLANNED mandatory interval]** After every numbered implementation stage and every semantic substage (1A–1E, 6A–6C), and after each planning revision of that stage, use a new context with only the current commit, this report, the stage diff and claimed evidence. Reviewer must reopen source, callers, consumers and tests; do not give it the author's private rationale as fact. Use the authorized subscription agent path; no paid/metered review product substitution.

Reusable review prompt:

> Read AGENTS/CLAUDE and inspect current HEAD. Read-only review of Stage N. Treat its claims as unverified. Trace UI/request/auth/service/adapter/persistence/consumer and inspect every new or moved writer, raw field, selector and post-await outcome. Find a counterexample involving unknown state, stale version, partial commit or changed request. Prove tests exercise the actual implementation and would fail if the guard were removed. Return file:line evidence, pass/block verdict, and exact required corrections. Do not edit, run live writers, deploy, or approve a later stage.

Record: stage, HEAD, reviewer context identifier, inspected paths, fresh search commands, contradictions, tests actually run, unresolved questions, verdict. Any material contradiction blocks that stage. Correct it, rerun affected checks, and get a new-context review before advancing. A successful prior stage does not waive this interval.

### Immediate recommended next step

Authorize **Stage 0 only** first. Its deliverable is the composed baseline/race harness and caller matrix, not a large code shuffle. Then execute independent fixes 1A and 1B, while resolving 1C/1D semantics. The overall verdict is **READY FOR BASELINE INVESTIGATION; broader implementation requires the named decisions and composed proofs above**. No migration was executed by this report.
