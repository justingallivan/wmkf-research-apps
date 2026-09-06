---
title: Reviewer Lifecycle Stage 6B1 — Token, Removal and Terminal Action Lifetimes
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
related:
  - docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B_PLAN_REVIEW_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md
---

# Stage 6B1 implementation receipt

Branch: `codex/reviewer-lifecycle-stage6b`. Base: `71ff2321` (main, clean).
Runtime is frozen at `9258115a`; the review-driven test-only correction is `06725d6c`, the slice's final commit. Orchestrated by Claude (Fable) with a
Sonnet builder owning `ReviewerManagePanel.js` and an Opus fresh-context reviewer.
Reviewer context: native Claude Code subagent, model Opus, label "Independent review of
Stage 6B1", 2026-09-05, reviewing frozen `9258115a` and then `06725d6c`.

## Surface and preimplementation invariants (contract-reconcile Mode B)

Change: client-side feedback ownership for the existing regenerate-token,
revoke-token, remove-reviewer and terminal-transition actions in
`shared/components/reviewers/ReviewerManagePanel.js`. Entry: the real
`TokenActionsMenu` items. Persistence: none new; existing routes
`pages/api/review-manager/{regenerate-token,revoke-token,terminal-transition}.js`
and the DELETE branch of `pages/api/reviewer-finder/my-candidates.js` are
unchanged. Consumers: alerts/prompt, clipboard, parent `onRefresh`, hosts
`ReviewersTab.js` and `pages/workbench/reviewer-follow-up.js`, tests.
Prior findings verified: the 6B plan's 6B1 gap list (plan review §"Independent source checks").

| Invariant | Files likely touched | Verification |
|---|---|---|
| A departed context (request/mode/permission/row/unmount) never regains feedback by returning | ManagePanel attempts registry + both layout effects | Deferred fetch/JSON/clipboard/refresh × seven context changes: no alert, prompt, clipboard start or callback |
| Confirm-then-stale never dispatches | revoke/remove/terminal handlers | confirm mock invalidates synchronously; fetch count 0 |
| Stale regenerate never copies or shows the URL; started copy is not "cancelled" | handleRegenerateToken | writeText not called when stale before clipboard; no alert/prompt/refresh when stale after |
| Same-context churn stays valid and uses the latest callback | context ref read at settle | new row objects + new onRefresh identity: new callback once, old never |
| Newer same-action invocation owns feedback; no cancel, no replay | per-action/row generation | two clicks → two fetches, older settles silently |
| Terminal variants share one generation with captured choice; payload uses captured requestId | transitionTerminal | payload requestId equals click-time request |
| Confirmed mutation ≠ failed refresh; onRefresh throw/rejection never relabeled network error | all four handlers | sync throw / rejection → refresh-failure alert while current only |
| Status mutex, 6A outcome parsing, pending tokens, materials selection untouched | updateStatus region unchanged | existing characterization suite green; diff excludes :1831–1958 |
| Route payloads and success predicates unchanged; no server file in diff | routes read-only | git diff --stat shows only panel + new test |

### Lifecycle and provenance trace (orchestrator, pre-build)

Line citations in this subsection refer to the `71ff2321` baseline panel (identical
to `d614de5c` for this file); the handlers moved roughly sixty lines lower in the diff.

### Axis 1 — lifecycle of stateful things

statusContextRef (ReviewerManagePanel.js:1652) {mounted, epoch, requestId, mode, canManage, previewReadOnly, reviewers Map, onRefresh}
- Arrives: mount layout effect :1655-1666 sets mounted=true. Committed-props layout effect :1669-1687 runs every render: epoch += 1 only when requestId/mode/canManage/previewReadOnly change; reviewers Map rebuilt from filtered `reviewers`; onRefresh replaced with the latest prop.
- Transitions out: unmount cleanup :1660-1664 sets mounted=false, epoch+=1, and marks every status operation invalid. There is no reset of epoch downward; monotonic by design (A→B→A yields a new epoch, so a return never revives). StrictMode double-invoke: mount→cleanup→mount increments epoch once before any attempt exists — harmless.
- Stale-on-identity: object/callback churn does NOT bump epoch (deliberate); row absence is detected via `context.reviewers.has(id)` in the loop :1683-1686 which marks *status* operations invalid. 6B1 attempts are NOT in that loop at baseline — so row absent→return would be missed for 6B1 unless the new registry is added to that loop. This is the reason the builder must extend both effects.

statusOperationsRef (:1651) Map<suggestionId, operation>: set at :1847 before first await; deleted in finally :1944-1946 only if token matches; invalidated (valid=false) by both layout effects. Must remain untouched.

pendingStatusTokens state (:1653): set :1848; cleared in finally :1949-1956 only when mounted and token matches. Untouched by 6B1.

6B1 handlers at baseline hold NO state. Provenance hazards:
- `onRefresh` closed over from the click-time render (:1762,:1781,:1824,:1983) — not the latest committed callback. Same-context churn will call the OLD callback.
- `transitionTerminal` reads live `proposal.proposalId` at :1973 — captured at dispatch time (confirm is synchronous, so render-time), fine at baseline, but must be moved to captured requestId so the payload provably matches the click-time request.
- No checkpoint after any await: fetch (:1745,:1770,:1810,:1969), json (:1750,:1775,:1815,:1978), clipboard (:1757), onRefresh — all continue into alert/prompt/refresh regardless of context.
- A sync throw from onRefresh at :1762/:1781/:1824/:1983 falls into the outer catch and alerts "Network error…" — a confirmed mutation mislabeled as failure.

Planned registry (actionAttemptsRef) lifecycle the builder must prove: entry created before first await (arrives); out via (a) own finally deletes only if token matches, (b) valid=false from both layout effects on epoch mismatch / row absence / unmount, (c) superseded when a newer attempt of same action+row takes the generation. Entries must be removed on settle even when invalid (no leak); an older finally must not remove a newer entry (token check). No component state is written for 6B1, so unmount-setState is not a risk unless the builder adds state — it must not.

### Axis 2 — provenance & value-semantics of cross-layer contracts (routes reopened, unchanged)

regenerate-token (pages/api/review-manager/regenerate-token.js): POST {suggestionId}. Success 200 {ok:true,url,expiresAt,jti} from service :52. Failures: 405/400/404/409/500 all {ok:false, reason} (service :53-54, route :38,:48,:53,:70) except ServiceHttpError path :67 which may return `{error}` without `ok` — client predicate `resp.ok && data.ok` correctly treats missing ok as failure; `data.reason || resp.status` degrades to status. mintAndStore runs before the URL is returned (:88) → a URL returned to a stale client means a NEW token already exists server-side; the client must simply not show/copy it (no rollback, no re-mint).
revoke-token: POST {suggestionId}. 200 {ok:true} :85; 404 {ok:false,reason:'not_found'} :59; 400/405/500 {ok:false,reason}. Client `resp.ok && data.ok`. Note revoke also deletes review drafts :80 — a completed revoke whose feedback is suppressed still deleted drafts; correct, nothing to undo.
my-candidates DELETE (handleDelete :157): body {suggestionId}. Success 200 with service result body (client ignores body, uses resp.ok only). Failures {error[,details]} via ServiceHttpError body or 400/500. Client reads JSON only on failure: `data.error || data.message || data.details || resp.status`. Removal revokes any live token first, then soft-deletes (:931-934 in my-candidates-service).
terminal-transition: POST {requestId, suggestionIds:[id], terminalStatus}. Service returns {ok:true, transitioned, results:[{suggestionId,status,...}]} :155; route returns 200 if transitioned>0 else 409 :62. 400s return {error}. Client predicate `response.ok && data.transitioned === 1`; failure reason `data.results?.[0]?.status || data.error || response.status`. Value semantics: 409 + results[0].status in {not_found, wrong_request, <rejected>, changed_skipped, write_failed, read_failed} — 'write_failed' may have partially committed (postcommit effects :95-153 differ between withdrew/released); client must never replay. 200 + transitioned===1 is the only confirmed success.

Checked whether any 200 response can carry a failure the client would mis-read as success: regenerate/revoke 200 always {ok:true}; terminal 200 requires transitioned>0 and the client further requires ===1 for its single ID; remove 200 = success by contract. None found.

## Implemented contract
[VERIFIED via `git show 9258115a`] Only `shared/components/reviewers/ReviewerManagePanel.js`
(+203/−37) and the new `tests/unit/reviewer-action-lifetimes.test.js` (529 lines)
changed. No server, route, host or other component file is in the diff.

- `actionAttemptsRef` (`ReviewerManagePanel.js:1664`) holds the latest attempt per
  `${kind}:${suggestionId}`. Kinds: `regenerate`, `revoke`, `remove`, `terminal`
  (both terminal choices share one generation). A newer attempt replaces the map
  entry; the older attempt's already-dispatched request is neither cancelled nor
  repeated, it simply loses feedback ownership through token mismatch.
- The existing unmount layout effect (`:1666–1676`) and committed-props layout
  effect (`:1678–1704`) now also flip `attempt.valid = false` on unmount, epoch
  mismatch and observed row absence. This is why row absent→return is permanent:
  the live `reviewers.has` check would pass again once the row returns.
- `beginAttempt` (`:1712`) captures requestId/suggestionId/kind/epoch/token before
  the first await and returns null when the committed context is unmounted, lacks
  management, is read-only or lacks the row. Called after `confirm()` for revoke,
  remove and terminal, it is the confirm-then-stale revalidation. The actions
  column only renders under `canManage` (`:1776`) and the follow-up host derives
  `canManage` false whenever `previewReadOnly` is set
  (`pages/workbench/reviewer-follow-up.js:40`), so no reachable control is newly disabled.
- `isAttemptCurrent` (`:1733`) mirrors the status handler's currentness test:
  mounted, valid, same epoch and requestId, management, not read-only, row present,
  registry token identity. Same-context object/callback churn stays valid.
- `finishAttempt` (`:1742`) deletes only its own token's entry.
- The four handlers check currentness after fetch, after JSON (including the
  `.catch(() => ({}))` fallback), before and after clipboard (regenerate only),
  before invoking the latest committed `onRefresh` from `statusContextRef`, and
  after an awaited refresh failure. `transitionTerminal` sends the captured
  `attempt.requestId`. A refresh throw or rejection after a confirmed mutation
  produces a distinct "…but the reviewer list could not be refreshed" alert while
  current, never the network-error alert. All payload shapes, success predicates,
  confirm/warning text and existing failure alert text are unchanged.
- `updateStatus`, its mutex, pending tokens and 6A outcome parsing are untouched.


## Red-before-code evidence
Builder ordering note: the builder implemented before capturing baseline evidence
and recovered it retroactively with `git stash`, restoring the implementation
byte-for-byte. The evidence below is therefore true-baseline but was gathered out
of the planned order; the orchestrator records this rather than restating it as planned.

- Baseline UI selection at `71ff2321` before edits: 8 suites / 528 tests passed.
- New `reviewer-action-lifetimes.test.js` against unchanged runtime: 236 of 288
  cases failed at an earlier test revision; the 52 current-context success/failure
  cases passed, as expected. On the committed file the reviewer measured 244 of 296
  failing against the baseline panel, and 316 of 366 after the review corrections.
- Deliberate guard removals in a disposable copy, each restored and diffed empty:
  1. Builder reported: combined epoch+requestId binding in `isAttemptCurrent`
     removed → 136 assertion failures. **Refuted by the independent reviewer**
     (REQUIRED-1): removing that binding alone yields 0 failures; 136 appears only
     when the epoch comparison is also removed from the props layout effect's
     attempts loop (`:1700`). The live check and the effect-loop `valid` flip are
     redundant by construction because the props layout effect has no dependency
     array and runs on every commit, so no committed context change can reach a
     settlement before the loop has run. The same structure exists in shipped
     `updateStatus`. The reviewer also measured the symmetric half: removing the epoch
     comparison from the props-effect attempts loop alone yields 0 failures, so the
     redundancy is verified in both directions. Both halves are retained as defense in depth.
  2. Post-JSON checkpoint in `handleRevokeToken` removed → 6 assertion failures.
  3. `finishAttempt` token guard removed → 2 assertion failures (older finally wiped a newer terminal entry).
  4. Pre-clipboard currentness in `handleRegenerateToken` removed → 6 assertion failures.
  All were assertion failures, not crashes.


## Verification
[VERIFIED via orchestrator-run commands on the frozen tree, then committed as `9258115a`]

| Command | Result |
|---|---|
| `npm test -- --runInBand --watch=false` | 771 suites / 11,146 tests passed |
| `npm run check:types` | pass |
| `npm run lint` | 0 errors, 76 warnings (repo-wide, pre-existing set; builder verified no new warnings in changed files) |
| `npm run build -- --webpack` | pass; no generated file changes in `git status` |
| `git diff --check` | clean |
| Gate pairs, serial, gate then self-test: dataverse-access-layer, route-service-boundary, dynamics-context-boundary, api-routes, route-lifecycle-auth, trust-boundary-guid, status-enum-parity | all 14 pass |

Focused at `9258115a`: new file 296/296; retained UI selection plus new file 9 suites / 824.
Focused at `06725d6c` (orchestrator-run): nine-suite selection 9 suites / 894 tests pass; `npx eslint` on the test file clean; `check:types` pass. Full suite at `06725d6c`: 771 suites / 11,216 tests pass (orchestrator-run); `git status --short` clean.


## Independent review
Reviewer: fresh-context Opus subagent (native, subscription path; no metered product),
read-only against frozen `9258115a`, contract-reconcile Mode A. It verified the clean
tree at start and end, read the plan, original report and approved decisions excerpts,
both hosts, the four routes and two services, the orchestrator trace, and the whole
changed region and test file.

Commands actually run by the reviewer: the three-suite selection (3 suites / 772 tests
pass); the new file alone (296/296); the plan's eight-suite selection plus the new file
(9 suites / 824 pass); the new file against the baseline `71ff2321` panel
(244 failed / 52 passed, the 52 being exactly the current-context preservation cases);
and sixteen guard-removal mutations, each reverted and the tree re-verified clean.

Reviewer guard-removal matrix (assertion failures, no crashes):

| Mutation | Failures |
|---|---|
| `isAttemptCurrent` epoch or requestId check, or both, alone | 0 (redundant with props-effect loop) |
| Both plus epoch dropped from the props-effect attempts loop | 136 |
| Props-effect attempts loop removed, unmount loop kept | 36 (all row absent→return / clipboard-context-lost cases) |
| Revoke post-JSON checkpoint | 6 |
| `finishAttempt` token guard | 2 |
| Regenerate post-JSON + pre-clipboard pair | 6 (pre-clipboard alone 0: no await between them) |
| `remove` post-fetch check | 18 (its success branch never reads JSON) |
| Token-supersession check in `isAttemptCurrent` | 10 |
| Refresh-failure `isCurrent()` wrappers, all four handlers | 0 before correction (REQUIRED-2) |
| `beginAttempt` permission gate | 0 before correction (REQUIRED-3) |
| Terminal payload reverted to live `proposal.proposalId` | 0 before correction (ADVISORY-4) |

Findings and disposition:
- REQUIRED-1 (receipt accuracy): recorded above; no code change.
- REQUIRED-2 (test teeth): refresh-failure currentness guards at `:1852,:1894,:1959,:2146`
  were untested, whereas the identical guard in `updateStatus` (`:2073`) fails 28 status
  tests when removed. Runtime risk today is nil because both hosts swallow refresh
  errors (`ReviewersTab.js:246–265`, `reviewer-follow-up.js:172–205`). Corrected in `06725d6c`: a per-action `onRefresh rejection after <change>` matrix (56 cases) now asserts zero alerts of any kind and no second request; removing the four wrappers fails exactly those 56.
- REQUIRED-3 (test teeth): the `!canManage || previewReadOnly` clause in `beginAttempt`
  (`:1715`) was untested; the only confirm-then-stale test used row absence. `confirm()`
  blocks the event loop in real browsers, so no commit can land during it. Corrected in `06725d6c`: confirm-then-stale is parameterised over row absence, `canManage:false` and `previewReadOnly:true` using `flushSync` inside the confirm mock (12 new cases); removing the clause fails exactly those 12. Reachability limit: a native blocking `confirm()` cannot admit a React commit, so the clause is unreachable in production today and becomes load-bearing if the dialog is ever replaced by a non-blocking modal.
- ADVISORY-4: the captured-requestId terminal test passed on baseline and reverting the
  capture failed nothing. Corrected in `06725d6c`: the test now asserts `onRefresh` is not called after a post-dispatch request switch, and a new test switches the request while the confirm dialog is open so the captured requestId is observable; reverting the capture fails those 2 cases. The payload carries the post-confirm committed request; in the production-unreachable mismatch case the server rejects fail-closed with `wrong_request` (`terminal-transition-service.js:85`).
- ADVISORY-5: several checkpoints (pre-clipboard, post-fetch in regenerate/revoke/terminal,
  unmount attempts loop) are redundant by construction with an adjacent check; keep as
  defense in depth, never delete on the strength of a zero.
- N1 (dropped outer catch): accepted as a stated limit. All four routes emit JSON objects
  only (every `ServiceHttpError` path is `error.body ?? { error }`), so `resp.json()` cannot
  resolve to `null` and post-JSON property reads cannot throw; `navigator.clipboard` being
  undefined throws inside the inner try. The network-rejection surface remains guarded and tested.
- N2 confirmed: `canManage && previewReadOnly` is unreachable in both production callers
  (`ReviewersTab.js:100,548`; `reviewer-follow-up.js:40`); the actions column renders only under `canManage`.
- N3 confirmed: five hunks; `updateStatus` byte-identical to baseline (md5 match); everything
  before line 1651 byte-identical; `ReviewerCloseoutModal` untouched; no server file.
- N4: redundancy is true, pre-existing and structural; not a 6B1 finding.

Reviewer traces confirmed A→B→A permanence (monotonic epoch, `valid` only ever written
false), row absent→return permanence (rests on `attempt.valid` alone, proven by the 36-failure
mutation), same-context churn validity with the newest committed callback, and that no handler
reads a prop after dispatch.

Reviewer limits: full suite, types, lint, build and gates were orchestrator-run, not
independently rerun; no browser or live-host execution; per-mounted-panel guarantee only.

**Verdict: PASS for Stage 6B1 runtime; REQUIRED items gated the receipt and 6B2 pickup,
not the code.** 

Narrow re-review of `06725d6c` by the same reviewer (tree clean before and after; scope
confirmed test-only, panel byte-identical): three-suite selection 3 / 842 pass; new file
366/366; nine-suite selection 9 / 894 pass; corrected tests against the baseline panel
316 failed / 50 passed. Mutations reproduced exactly: refresh-failure wrappers 56,
permission clause 12, live `proposal.proposalId` 2, all assertion failures. Decorative-negative
audit: the excluded alerts provably fire when the guard is deleted, so the negatives assert
exclusion, not absence. REQUIRED-1 wording confirmed accurate; the symmetric measurement
(props-effect loop epoch comparison removed alone → 0 failures) is recorded above.
**Verdict: PASS for Stage 6B1 at `06725d6c`. No remaining required change. No approval is
expressed for 6B2 or 6B3.**


## Audit and operational limits
- The registry is local to one mounted panel; other tabs, remounts and server-side generations remain outside this guarantee.
- A regenerate URL returned to a stale context corresponds to a token already minted server-side; the client suppresses display only. No rollback exists.
- Terminal 409 `write_failed` may have partially committed; no replay is added.
- No browser/live probe, deployment or human UAT ran for this slice.
- Promoted to `main` 2026-09-05 as part of PR #150 (`600cc972`); see the Stage 6B3 receipt's Promotion section.
