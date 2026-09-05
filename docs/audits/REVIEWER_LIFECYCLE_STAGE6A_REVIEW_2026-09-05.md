---
title: Reviewer Lifecycle Stage 6A — Independent Frozen Review
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Stage 6A independent frozen implementation review

Date: 2026-09-05. Reviewer: `/root/stage6a_fresh_review` (native independent agent context).

**Final verdict: PASS for the frozen local implementation. Required corrections: none.** This does not certify a deployment, live Dataverse behavior, or root-owned full tests, gates, build and final durable-document reconciliation.

## Reviewed surface and authority

[VERIFIED via `git rev-parse HEAD`, `git diff --stat ddf19416..5b9964c8`, the complete `/tmp/reviewer-stage6a-frozen.diff`, and current source] Reviewed SHA `5b9964c80aaddb2ccdfb0a99f96b560c638b9a89` on `codex/reviewer-lifecycle-approved-policies`, against parent `ddf19416`. The diff has seven files, 915 insertions and 152 deletions: the reviewers service, reviewers route, actual ManagePanel, and four corresponding test files. All 1,425 diff lines were inspected. At initial verification the sole dirty file was the root-owned Stage 6A receipt. At final verification the root was also reconciling the service catalogue, lifecycle wiki, and suggestion Atlas page; the seven frozen runtime/test files remained unchanged against HEAD (`git diff --exit-code HEAD -- <seven paths>` exited 0). The root clarified read-only git inspection was permitted. This reviewer made no repository edit or git mutation.

Read CLAUDE.md, the complete contract-reconcile and agent-coordination skills, approved decisions, Stage 6A receipt, and the fresh planning review `/tmp/reviewer-stage6a-plan-review.md`. CodeGraph exploration preceded code location/reads, with raw caller census following where the graph returned unrelated or truncated results. The approved product scope remains the existing single-row UI plus server batch contract, with sequential stop on first failure. No Stage 2–5 moves or general 6B/6C work is approved by this verdict.

- Change: explicit saved/uncertain/unattempted outcomes for existing generic reviewer status PATCH.
- Entry points: `ReviewerManagePanel.updateStatus`, reviewers API, and `patchReviewers`.
- Persistence: existing Dataverse suggestion through the unchanged real `updateLifecycle` adapter and Dynamics transport. No new table, field, enum or route.
- Consumers: actual row action and two host refresh callbacks; tests and source documentation.
- Prior findings verified: F5, the fresh plan's any-key/identity/HTTP parsing requirements, exact attempted-error scope, canonical targets, direct empty-array fallback, uncertainty, and Stage 1E guard preservation.

## Findings and disconfirmation

1. **PASS — authorization and original input policy remain ahead of writes.** [VERIFIED via `pages/api/review-manager/reviewers.js:56-64,101-149`, `lib/services/reviewer-request-authorization.js:42-133`, actual route suites and composed transport tests.] Access is checked before dispatch/trusted context; actor/profile come from the session. The entire raw nonempty array passes required-status and GUID validation before authorization, and the route awaits the complete ownership helper before calling the service. Empty/non-array selectors retain single fallback and nonempty batch priority. Real helper composition rejects an authorized first target followed by foreign/missing ownership, or failed ownership reads, with no lifecycle guard read, no PATCH, and unchanged stored rows. The helper's capped suggestion-read 503 behavior also passes its unit suite. Disconfirmation: narrowing route authorization to only the first target causes the existing composed foreign-target test to return 200 with both saved IDs instead of 403. The mutation is detected.

2. **PASS — canonical sequential outcomes have the exact approved meaning.** [VERIFIED via `lib/services/review-manager/reviewers-service.js:464-531` and 51 service tests.] One nonempty `isBatch` discriminator governs status policy, targets, payload and message. Canonical GUID deduplication preserves first occurrence order. The single lifecycle object and submitted identity remain intact. Dedicated complete/terminal prechecks are outside the attempted-operation catch, including direct `suggestionIds:[]` fallback. Every update is awaited before the next starts. Only a resolved prefix is saved; a caught attempt identifies one uncertain target and the untouched suffix, then throws without continuation or replay. Disconfirmation: independent removal of deduplication, awaiting, stop-on-error, the nonempty discriminator, or exclusion of the active target from saved IDs fails the corresponding focused assertions.

3. **PASS — route classification and error hygiene are preserved.** [VERIFIED via `pages/api/review-manager/reviewers.js:151-170`, `lib/services/service-http-error.js`, `lib/services/dynamics/write-core.js:168-193`, and 66 route tests.] Typed pre-write errors retain exact error-only envelopes. Only an actual `ReviewerStatusMutationError` instance adds outcome arrays to the sanitized 500 body. The original adapter cause is logged and supplies development-only details. An ordinary adapter error with `.status=412` remains 500; an adapter-thrown typed error is still an attempted outcome failure, not a pre-write error. Unknown errors cannot spoof the wrapper merely by name/fields. Disconfirmation: removing cause unwrapping, trusting a matching error name, or allowing adapter-thrown typed errors to escape the operation wrapper causes the selected route tests to fail.

4. **PASS — actual adapter/transport composition demonstrates uncertainty, not assumed rollback.** [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1800-1967`, actual Dynamics read/write/http/annotation paths, `tests/helpers/reviewer-engagement-transport.js:135-292`, and `tests/integration/reviewer-engagement-races.test.js:1059-1283`.] At first/middle/last targets the composed suite exercises applicant exclusion, read failure, real conditional PATCH 412 after a concurrent version change, transport failure before commit, and commit followed by response loss. Tests assert exact result arrays, actor and concrete If-Match headers when the guard supplied a version, no later mutation reads/writes, no resend, and exact persisted rows/versions. The response-loss fixture first lets the fake server commit and then rejects fetch; the failed ID is persisted but deliberately not confirmed in `savedIds`. Authentication entry/role lookups, OAuth token acquisition and non-status external dependencies are stubbed; ownership policy, services, adapter, trusted context and transport wrappers are real. This is a local HTTP transaction model, not a live server claim.

5. **PASS — the actual UI rejects incomplete, contradictory and foreign outcomes.** [VERIFIED via `shared/components/reviewers/ReviewerManagePanel.js:1831-1957`, row binding at `:2273-2281`, and 458 rendered tests.] Any own outcome key selects the full protocol. All three arrays and an exact ordered canonical GUID partition are required. With the actual one-target submission, length/equality rejects empty, foreign, duplicate, cross-category, missing and unsolicited batch identities without inferring saved state. Full success requires HTTP 200/ok/strict true/all saved/no error; structured uncertainty requires 500/non-ok/strict false/exactly one failed ID. No-key legacy success remains a strict object/HTTP-ok/true/no-own-error branch. Failures give unconfirmed/reload guidance; structured results identify the submitted name and ID. Confirmed save is visibly distinguished from host refresh failure. Disconfirmation: any-key→all-keys, removal of identity equality, or weakening exact HTTP status lets malformed/foreign/201/207 responses appear saved; existing real rendered tests fail. No detached parser or fictitious batch screen substitutes for the actual row action.

6. **PASS — Stage 1E ownership/currentness remains in force.** [VERIFIED via ManagePanel `:1648-1686,1831-1888,1928-1957` and normal/StrictMode rendered tests.] The synchronous per-row mutex is acquired before fetch and is independent across rows. Committed context changes and observed row absence permanently invalidate pending feedback; away-and-back cannot revive it. The handler checks currentness after fetch/JSON and around feedback/current callback/refresh completion; cleanup is token-matched. The current same-context callback is used while the operation's reviewer label remains captured. Disconfirmation: removing the mutex yields two PATCH calls in the persisted reentrant live-DOM test; removing post-refresh currentness yields stale success alerts across all seven invalidations; capturing the old callback invokes it after a same-context replacement. All are detected. Structured refresh rejection and uncertain/malformed late responses remain covered by the green full rendered suite.

## Independent commands and results

All commands ran from `/Users/gallivan/Code/WMKF_Apps`, using local mocked/fake I/O. No live SQL/Dataverse/email/cron/schema operation, browser session, model CLI, paid product, publication, global test run, build or gate was invoked.

Core command:

```sh
node node_modules/jest/bin/jest.js --runInBand --silent --no-coverage --cacheDirectory=/tmp/reviewer-stage6a-fresh-jest-cache --runTestsByPath tests/unit/reviewers-service.test.js tests/integration/review-manager-reviewers-patch.test.js tests/integration/reviewer-engagement-races.test.js tests/unit/reviewer-request-authorization.test.js tests/unit/reviewer-status-mutation-characterization.test.js --json --outputFile=/tmp/reviewer-stage6a-fresh-core.json
```

[VERIFIED via `/tmp/reviewer-stage6a-fresh-core.json` and `.log`] **5 suites / 790 tests passed**, zero failures/runtime-error suites: 51 service, 66 route, 206 composed races, 9 real authorization-helper unit, and 458 rendered status cases.

Compatibility command:

```sh
node node_modules/jest/bin/jest.js --runInBand --silent --no-coverage --cacheDirectory=/tmp/reviewer-stage6a-fresh-jest-cache --runTestsByPath tests/unit/reviewer-manage-actions-menu.test.js tests/unit/reviewers-tab-post-send-refresh.test.js tests/unit/reviewer-follow-up.test.js tests/unit/reviewer-manage-proposal-attachment.test.js --json --outputFile=/tmp/reviewer-stage6a-fresh-compatibility.json
```

[VERIFIED via `/tmp/reviewer-stage6a-fresh-compatibility.json` and `.log`] **4 suites / 51 tests passed**, zero failures/runtime-error suites. These verify action/menu/materials and existing host behavior; host tests that stub ManagePanel are not counted as actual status-handler coverage.

Total independent green coverage: **9 suites / 841 tests**.

Mutation commands:

```sh
node /tmp/reviewer-stage6a-fresh-run-mutations.cjs
node /tmp/reviewer-stage6a-fresh-run-extra-mutations.cjs
```

[VERIFIED via `/tmp/reviewer-stage6a-fresh-mutation-results.json`, `-mutation-proof.jsonl`, `-mutation-audit.json`, each mutant's JSON/log, and driver/config/transform source] The drivers invoke Jest with `--no-cache`, exact focused test paths/patterns and a temporary transform delegating to the project's real Next SWC transformer. Each named mutation changes exactly one matching fragment of the actual source passed to Jest, then logs the actual filename plus original/mutated SHA-256. All 15 proof entries match the still-current repository source hash and differ from their mutated hash. No repository source or tests were edited. All failures are assertion failures, with zero runtime-error suites. The unmutated tests passed in the core run.

| Removed/weakened guard | Failing assertions |
|---|---:|
| Canonical deduplication | 2 |
| Saved prefix excludes active attempt | 3 |
| Throw/stop after failure | 3 |
| Typed adapter failure stays inside attempted wrapper | 1 |
| Nonempty batch discriminator | 7 |
| Original cause log/details | 3 |
| Wrapper instance identity | 3 |
| Any own outcome key selects new protocol | 12 |
| Submitted identity equality | 2 |
| Exact HTTP 200 success | 4 |
| Currentness of structured success feedback | 14 |
| Current callback | 2 |
| Synchronous reentrant mutex | 2 |
| Await write before advancing | 1 |
| Whole-batch authorization | 1 |

**15/15 mutations detected, 60 expected assertion failures.** Exact executable argv and failing test names are retained in the results JSON. A compact failure excerpt proving the intended reason is retained for every mutation in the audit JSON.

## Seven audits and remaining boundaries

- Whole flow: row action → captured operation → single PATCH → auth/validation → full ownership authorization → canonical sequential service → real adapter/conditional transport → 200/500 DTO → guarded feedback → current host refresh traced and locally tested.
- Partial success: confirmed prefix, uncertain attempted row and untouched suffix are distinct; no rollback/replay or all-failed success.
- Async/stale state: synchronous mutex, sticky invalidation, every response/callback feedback phase and matching cleanup verified; no general action-framework claim.
- Helper extraction: narrow internal error carrier only; shared ServiceHttpError/global error behavior unchanged. Client GUID helper is dependency-free.
- Durable surface: no new persistence/route/enum/migration. Source contracts and tests changed. Root owns required global gates/build and final receipt/approved-decision reconciliation.
- Doc reconciliation: approved authority/receipt/fresh plan read completely. Their in-progress/planned status during review is not promoted here to global completion. No repository document edits by reviewer; root's `/sweep` and final evidence remain separate.
- Symbol/consumer fan-out: CodeGraph-first and saved endpoint/caller census (`/tmp/reviewer-stage6a-fresh-caller-search.txt`) establish the sole application PATCH in ManagePanel. Materials selection is separate. Host regions read: `ReviewersTab.js:140-265,541-558`, `pages/workbench/reviewer-follow-up.js:107-116,172-205` and callback wiring. No new persisted enum/status semantics are introduced.

Residual boundaries are unchanged and explicit: status-only updates can still lack a concrete guard-read ETag; this is outside Stage 1D's stronger six-field rule and was not “fixed” here. Whole-batch authorization does not lock later Request ownership. Complete response loss reveals no server partition. Failed IDs may have committed. The mutex belongs to one mounted panel and does not create durable cross-tab/remount/backend-generation idempotency. `ReviewersTab.refreshAll` starts loaders and returns void; follow-up loaders handle their own errors, so callback completion does not certify a fresh read. Existing impersonated 403 transport fallback is unchanged, not a new Stage 6A retry mechanism.

Recommendation Evidence: N/A — no code-change recommendation or required correction.

**PASS at `5b9964c80aaddb2ccdfb0a99f96b560c638b9a89`; local frozen implementation only.**
