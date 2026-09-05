---
title: Reviewer Lifecycle Stage 1E — Independent Review and Closure
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Stage 1E independent review

Final disposition: **PASS at `77720b5a`**. The runtime remains identical to
`bab3adea`; the sole required correction was a persisted mutex regression.
The closure below supersedes the explicitly historical initial verdict.

# Stage 1E correction re-review

Date: 2026-09-05. Reviewer context: `/root/stage1e_fresh_review` (narrow follow-up to the independent runtime review, not a new fresh context).
Frozen HEAD: `77720b5ac564bcfa82c6ae46f5d3dbba7e3cec53`, parent `bab3adea0c320fb77008de1748c3168ad6cb4ca2`.
Branch: `codex/reviewer-lifecycle-approved-policies`.

**PASS — the sole prior review blocker is closed. No further required corrections identified in the scoped test-only change.**

[VERIFIED via `git show`, `git diff --name-only bab3adea..77720b5a`, source SHA-256] The correction adds only 19 lines to `tests/unit/reviewer-status-mutation-characterization.test.js`. The runtime file is unchanged, with SHA-256 `4e67ceab8a8defaba4fa8c3a08709d81eefb8b05267bb854c839afca3070728c`, identical to the prior reviewed runtime.

[VERIFIED via tests/unit/reviewer-status-mutation-characterization.test.js:256] The persisted test reenters the actual status select from the first fetch mock, before the first event can commit its menu-close/pending state. It explicitly asserts that the original select remains connected and enabled (lines 261–262), dispatches the second status change on that live select (line 263), requires only one PATCH (line 270), then settles the request and requires one argument-free refresh callback (line 272). It runs in the existing normal and StrictMode matrix. This directly protects the ref mutex rather than relying on a detached select or disabled UI.

Independent checks actually run at the frozen correction:

- `node node_modules/jest/bin/jest.js --runInBand --no-cache --runTestsByPath tests/unit/reviewer-status-mutation-characterization.test.js`: **200 tests PASS**. Log: `/tmp/reviewer-stage1e-rereview-status.log`.
- The same persisted suite, with only the handler's synchronous `statusOperationsRef.current.has(suggestionId)` entry check removed in memory using `/tmp/reviewer-stage1e-fresh-transform.cjs`: **2 tests FAIL / 198 PASS**, both newly persisted normal/StrictMode reentrant tests. Each observes two PATCHes instead of one. Temporary extra-test augmentation was disabled; the 200-test count confirms only the persisted suite supplied the proof. Log: `/tmp/reviewer-stage1e-rereview-mutex.log`.
- `git diff --check bab3adea..77720b5a`: PASS. HEAD remained `77720b5ac564bcfa82c6ae46f5d3dbba7e3cec53` after the checks.

The original runtime/contract review and its unchanged limits remain in `/tmp/reviewer-stage1e-fresh-review.md`. This addendum closes that report's missing persisted regression finding; it does not independently rerun or certify full-suite/build/gates. Those are root-owned. Two root-owned untracked draft receipts were present; this review made no checkout edits, git mutations, live I/O or global test/gate/build calls. No later Stage 6A or general Stage 6B approval is implied.


---

# Historical initial review at bab3adea

The following is the frozen pre-correction review, retained as evidence of the
test gap and experiments. Its blocker was closed by the re-review above; it is
not an outstanding action or current roadmap.

# Stage 1E fresh-context read-only runtime review

Date: 2026-09-05. Reviewer context: `/root/stage1e_fresh_review`.
Reviewed branch: `codex/reviewer-lifecycle-approved-policies`.
Frozen HEAD: `bab3adea0c320fb77008de1748c3168ad6cb4ca2`; parent `f4ec249e`.
Review scope: exact two-file runtime/test diff, existing callers and persistence/response consumers. The root agent owns full tests, build, gates and durable-document reconciliation. No later-stage approval is given.

**Verdict: BLOCK for one missing persisted regression proof. Runtime inspection and independent probes otherwise PASS.** This is a test-strength finding, not evidence that the implemented mutex is broken. Add the small reentrant DOM-event test described below, verify it catches mutex removal, and review the frozen correction before closing Stage 1E.

## Surface and evidence boundary

Change surface: the existing single-reviewer status handler and its existing menu selector's pending display. Entry: Correct recorded status in `ReviewerManagePanel` / `TokenActionsMenu`. Persistence: existing Dataverse reviewer-suggestion status update; unchanged by this stage. Consumers: parent refresh callbacks, rendered status/pending state, alert feedback, and tests. Prior finding: F5's unchecked UI result. The status-only async protection is necessary for this handler and does not complete general Stage 6B.

[VERIFIED via `git diff f4ec249e..bab3adea --name-only`, `git rev-parse HEAD`, `git status --short`] Only `shared/components/reviewers/ReviewerManagePanel.js` and `tests/unit/reviewer-status-mutation-characterization.test.js` changed in the reviewed commit. The untracked Stage 1E receipt was a root-owned draft and was read as an unverified claim. No checkout edits or git mutations were made by this review.

Reviewed instructions/contracts: `CLAUDE.md`, contract-reconcile skill, original refactor report (including F5, 1E, 6B and G), approved lifecycle decisions, and the draft Stage 1E receipt. CodeGraph was tried first; its broad queries returned unrelated symbols, so targeted `rg` and line-numbered source reads supplied the actual trace.

## Findings

1. **P2 — Persist a regression that reaches the synchronous mutex independently of React's pending display.** [VERIFIED via tests/unit/reviewer-status-mutation-characterization.test.js:234 and `/tmp/reviewer-stage1e-fresh-mutex.log`] The current duplicate test sends its second event to the captured select after the first closes the menu, then checks a reopened disabled select. Deleting only `statusOperationsRef.current.has(suggestionId)` from the real handler leaves all 198 existing status tests green. Thus this test does not protect the explicitly required synchronous ref mutex; the UI disabling/closed menu suffices for its assertions.

   [VERIFIED via `/tmp/reviewer-stage1e-fresh-extra.log` and `/tmp/reviewer-stage1e-fresh-mutex-extra.log`] A temporary test dispatches the second DOM change *inside the first fetch mock*, before the first event commits its menu-close/pending render. It exercises the actual rendered menu and handler, without extracting a helper or accessing React internals. Current runtime passes; mutex deletion issues two PATCHes and fails in both normal and StrictMode runs. Required change: persist the first test in `/tmp/reviewer-stage1e-fresh-extra-tests.txt` within the existing normal/StrictMode `describe.each`. No runtime change is required by this finding.

2. **PASS — Honest single-update response contract.** [VERIFIED via ReviewerManagePanel.js:1862,1874,1878,1883,1884,1898] Payload remains exactly `{ suggestionId, reviewStatus }`; success requires HTTP success and exact boolean `success:true`. Network, JSON, HTTP and payload failures report an unconfirmed outcome with captured reviewer identity and reload-before-retry guidance. No automatic retry or optimistic persisted-status update was introduced. A throwing/rejecting callback after confirmed success gets the separate saved-but-refresh-failed notice at line 1901.

3. **PASS — Currentness and token-owned cleanup.** [VERIFIED via ReviewerManagePanel.js:1654,1668,1830,1845,1848,1904] The synchronous per-reviewer map owns an operation token until settlement. Committed request/mode/permission changes advance an epoch; observed row absence invalidates the operation irreversibly; mount cleanup invalidates outstanding operations. Checks after fetch/JSON and before alerts/refresh reject stale feedback, including A→B→A and row returns. Same-context new objects/callbacks remain valid and the newest callback is used. Cleanup deliberately does not require feedback-currentness, releases only its matching token and updates display only while mounted. Different rows are independent.

4. **PASS — Scope and host contracts retained.** [VERIFIED via ReviewerManagePanel.js:1687,1708,2230 and ReviewersTab.js:139,176,256,541] Only the affected status select is disabled; terminal/link actions, materials selection, materials-modal state and invitation overlay logic remain unchanged. The callback receives no overlay arguments. `ReviewersTab.refreshAll` returns void, starts existing guarded loaders and preserves confirmed-invite overlay behavior. Follow-up's callback returns `loadProposals`, which handles its own read errors (`pages/workbench/reviewer-follow-up.js:172,198,397`). Awaiting either callback does not certify completed data reconciliation; the implementation and draft receipt correctly acknowledge that limit.

## Whole-flow trace

- Real row menu passes the actual row id and chosen status to the existing handler (`ReviewerManagePanel.js:340,2235`). Menu target restrictions remain in the existing `canCorrectStatus` and settable-status logic; no enum/status choice was added.
- Handler sends the existing single PATCH (`ReviewerManagePanel.js:1865`). The API authenticates app access before dispatch, establishes DAL context, validates GUID and supported field, derives actor from session and authorizes ownership before the service (`pages/api/review-manager/reviewers.js:52,56,96,125,140,145`). Authorization resolves suggestion-to-request ownership server-side (`lib/services/reviewer-request-authorization.js:53,78,112`).
- `patchReviewers` still rejects dedicated complete/terminal targets, awaits the existing adapter update, and returns `{success:true,message}` only after fulfillment (`lib/services/review-manager/reviewers-service.js:475,498`). Existing sequential batch semantics remain unchanged; Stage 6A is separate.
- Adapter maps `reviewStatus` to `wmkf_reviewstatus`, reads the current source, rejects closed-source transitions and forwards actor/If-Match to persistence (`lib/dataverse/adapters/reviewer-suggestion.js:1797,1816,1833,1883,1902,1951,1962`). Transport supplies the actual If-Match and rejects non-OK Dataverse responses (`lib/services/dynamics/write-core.js:168,175,183`). These server boundaries are source-traced, not live-probed by this UI review.
- Route returns the existing success body or typed/generic error envelope (`pages/api/review-manager/reviewers.js:145,148,152`). The new handler interprets it as described above. GET projection remains authoritative for displayed status (`reviewers-service.js:255,292,302`); host refresh remains the owner of replacing rows.

Seven audit disposition: whole-flow and async/stale-state audited above; partial-success is single-item confirmation with ambiguous failures explicitly unconfirmed, existing batch behavior out of scope; helper-extraction N/A (none); new durable surface N/A (none); doc-reconcile delegated to root (draft correctly not complete); status-symbol fan-out N/A as a change surface (no new enum or mapped raw field), existing write/read mapping and UI consumers traced.

## Tests and experiments actually run

1. Independent bounded run of status, menu, proposal attachment, decline-referral, post-send refresh, stale-request, referral-add, proposal-binding and follow-up suites: **9 suites / 269 tests PASS**, log `/tmp/reviewer-stage1e-fresh-focused.log`. Existing materials template-load act warnings remain; this was not a warning-free run.
2. Temporary in-memory test augmentation against unchanged production source: **202 tests PASS** (198 existing plus normal/StrictMode reentrant mutex and SSR/hydration probes), log `/tmp/reviewer-stage1e-fresh-extra.log`. SSR output hydrates with no recoverable errors and accepts a status action afterwards. React 18 emits two expected useLayoutEffect-on-server warnings per SSR render; the probe did not identify a hydration correctness failure. This is a named development warning, not a requirement to introduce a new abstraction.
3. In-memory production-source mutations, with checkout untouched and cache disabled:

| Removed/weakened guard | Existing status-suite result |
|---|---|
| Exact success boolean → truthy success | 4 failures |
| HTTP guard | 2 failures |
| Irreversible row-absence invalidation | 20 failures |
| Context-change epoch increment | 80 failures |
| Currentness guard on refresh rejection | 14 failures |
| Token cleanup wrongly gated by feedback currentness | 44 failures |
| Latest callback → captured callback | 2 failures |
| Synchronous mutex | **198 pass: test gap** |

The augmented suite catches synchronous mutex removal with **2 failures / 200 passes** (two PATCHes instead of one). Mutation details are in `/tmp/reviewer-stage1e-fresh-mutations.json`; individual logs are `/tmp/reviewer-stage1e-fresh-mutation-*.log`, plus the mutex logs named above. Transformer/config/probe sources are `/tmp/reviewer-stage1e-fresh-transform.cjs`, `/tmp/reviewer-stage1e-fresh-jest.config.cjs`, `/tmp/reviewer-stage1e-fresh-extra-tests.txt`.
4. `git diff --check f4ec249e..bab3adea` passed; HEAD remained frozen when checked after probes. Reviewed source SHA-256: runtime `4e67ceab8a8defaba4fa8c3a08709d81eefb8b05267bb854c839afca3070728c`; tests `f1621635aeb25bf0ab87bb50d55b5dd1475972a0f4d4532dd4b2a9656bf6bece`.

## Recommendation evidence

| Recommendation | Prerequisite and execution point | Evidence actually tested | Disconfirming check | Status |
|---|---|---|---|---|
| Persist the reentrant actual-menu regression | Existing mocked fetch can dispatch while the first menu handler is still on the stack; real map acquisition at ReviewerManagePanel.js:1845 precedes it | Temporary normal/StrictMode DOM probe passes current source | Delete only entry map check; probe must observe two PATCHes and fail | VERIFIED; pending persistence |

## Limits and final verdict

No live networking/Dataverse/email/cron/schema operations, broad gates, full suite, build, main merge, public push or deployment were performed by this reviewer. Full validation is root-owned and cannot be inferred from these results. The map only coordinates one mounted panel; remounts, tabs, other action handlers and unobserved backend row generations remain outside the guarantee. A lost response cannot prove whether the write committed. Existing void/self-catching loaders cannot certify successful refresh.

**BLOCK at bab3adea for the single persisted regression gap. Runtime contract: PASS within the named boundaries.** Required correction is the test only; obtain reviewed evidence at the corrected frozen commit before closing Stage 1E. This review does not authorize or approve Stage 6A or general Stage 6B.
