---
title: Reviewer Lifecycle Stage 6B2 — Reminder and Closeout Component Lifetimes
kind: audit
domain: reviewer-workbench
status: complete
canonical: false
owner: product-engineering
last_verified: 2026-09-05
related:
  - docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md
  - docs/audits/REVIEWER_LIFECYCLE_STAGE6B1_RECEIPT_2026-09-05.md
  - docs/audits/REVIEWER_LIFECYCLE_APPROVED_DECISIONS_2026-09-04.md
---

# Stage 6B2 implementation receipt

Branch: `codex/reviewer-lifecycle-stage6b`. Base for this slice: `dcd58b32` (the
Session 486 handoff commit; 6B1 complete). Runtime is frozen at `b08c16f6`; the review-driven correction is `d3ec406a`, the slice's final commit.
Orchestrated by Claude (Fable) with a Sonnet builder owning the `ReviewReminderAction`
component and closeout render site in `ReviewerManagePanel.js`, `ReviewerCloseoutModal.js`
and the two test files, and an Opus fresh-context reviewer.
Reviewer context: native Claude Code subagent, model Opus, label "Independent review of
Stage 6B2", 2026-09-05, reviewing frozen `b08c16f6` and then `d3ec406a`.

## Surface and preimplementation invariants (contract-reconcile Mode B)

Change: client-side feedback, callback and form-state ownership for the existing
review-due reminder button (`ReviewReminderAction`) and the reviewer closeout modal
(`ReviewerCloseoutModal`). Entry: the reminder button in the follow-up column and the
closeout form. Persistence: none new; routes
`pages/api/review-manager/send-review-reminder.js` and
`pages/api/review-manager/close-review.js` are unchanged. Consumers: inline feedback
span, inline error, `onSent`/`onSaved`/`onClose`, hosts
`shared/components/reviewers/ReviewersTab.js` and `pages/workbench/reviewer-follow-up.js`, tests.

| Invariant | Files touched | Verification |
|---|---|---|
| A departed context (request/reviewer identity/read-only/permission/open-close/unmount) never regains feedback or a callback by returning | both components' committed-context ref + no-deps layout effect; panel passes narrow context to the modal | deferred fetch/JSON × each change and A→B→A: no feedback text, no callback |
| Send/save lock persists until its attempt settles and is released by that attempt only, even when its feedback is invalidated | both components' `finally` | after a stale settle the current identity's button is enabled again; a second click before settle still sends once |
| Same-context churn (new row object, new callback identity) stays valid and calls the latest callback once | both components | new callback identity called once, old never |
| Confirmed mutation ≠ refresh failure; a callback throw or rejection never shows request-failure copy and never re-requests | both components | sync throw / rejected promise / never-resolving promise cases |
| An `onSaved` that unmounts or switches the session must not then close the replacement | modal | `onClose` count 0 |
| A new modal session reinitializes disposition/notes from the current row and clears prior error; same-row refresh preserves unsaved text | modal | rerender to another reviewer resets; same id new object keeps typed notes |
| Eligibility messages, payloads, success predicates and copy unchanged; no new disabled control or eligibility rule | both | existing tests green; diff review |
| 6B1 registry, status mutex and `TokenActionsMenu` untouched; no server file | panel diff | hunks confined to `:126–260` and the closeout render site |

### Lifecycle and provenance trace (orchestrator, pre-build)

Line citations refer to the `dcd58b32` baseline.

Axis 1 — lifecycle. `ReviewReminderAction` (`:126–225`) held `sending`/`feedback` state and
`mountedRef`/`generationRef`/`sendingRef`; its only effect (`:147–154`) invalidated on
unmount, so a mounted change of `requestId`, `reviewer.suggestionId` or `previewReadOnly`
was unobserved; `onSent` was the click-time closure (`:186`), so the follow-up host's
per-render arrow (`reviewer-follow-up.js:397`) meant same-context churn called the old
callback; a sync throw from `onSent` fell into the request catch (`:189`) and relabeled a
confirmed send as failed. Lock hazard identified pre-build: if the generation were bumped on
a mounted identity change, `finally` (`:192`) would never release `sendingRef` and the new
identity's button would stay disabled. `ReviewerCloseoutModal` (`:41–100`) initialized
`disposition`/`notes` once at mount, invalidated only on unmount (`:51–57`), rendered outside
the panel's `canManage` gate (`ReviewerManagePanel.js:2465`) without `canManage`,
`previewReadOnly` or `requestId`, called click-time `onSaved`/`onClose` (`:88–89`) with no
recheck between them, and had the same stuck-lock hazard (`:95`). The panel's `onSaved`
wrapper returned void, so a refresh rejection was unobservable. Rows are keyed by
`suggestionId` (`:2329`) and hosts remount on request change, so mounted identity changes
are rare in production; the plan requires the component contract regardless.

Axis 2 — routes reopened, unchanged. send-review-reminder: POST `{requestId, suggestionId}`;
client predicate `response.ok && data.ok`; failure copy keyed by `data.reason`.
close-review: POST `{suggestionId, disposition, notes}`; predicate `response.ok &&
data.success`; error copy `data.error || default`. No 200 body carries a failure the client
misreads.

## Implemented contract
[VERIFIED via `git show b08c16f6` and `git show d3ec406a`] Four files changed (+700/−25 at `b08c16f6`, +129/−22 at `d3ec406a`): `ReviewerManagePanel.js`
(+78/−… in `ReviewReminderAction` and the closeout render site only),
`ReviewerCloseoutModal.js`, `tests/unit/reviewer-manage-actions-menu.test.js`,
`tests/unit/reviewer-closeout-modal.test.js`. No server, route or host file is in the diff.

- Both components keep `generationRef` as the per-attempt supersession token (bumped only by
  a new send/save and by unmount) and add a committed-context ref with a monotonic `epoch`
  reconciled by a `useLayoutEffect` with no dependency array, placed above each component's
  early return so hooks order is stable. The reminder's epoch bumps on `requestId`,
  `reviewer.suggestionId` or `previewReadOnly` change (the panel already folds `!canManage`
  into `previewReadOnly` at the render site). The modal's session identity is `isOpen`,
  `reviewer.suggestionId`, `requestId`, `canManage`, `previewReadOnly`; on change it bumps
  the epoch, reinitializes `disposition`/`notes` from the current row and clears `error`.
  Same-row object/callback replacement only updates the latest-callback references.
- A checkpoint is mounted ∧ generation match ∧ epoch match, taken after fetch+JSON and before
  each externally visible continuation. In `finally`, the lock is released on generation
  match alone, regardless of epoch, and `setSending/setSaving(false)` only while mounted, so
  a stale attempt can never leave the current identity locked.
- Callbacks are invoked through the latest committed reference inside their own `try`. A sync
  throw is swallowed; a returned thenable receives a no-op rejection observer and is NOT
  awaited. The reminder's "Reminder sent." feedback stays; the modal rechecks currentness
  after `onSaved` (a sync callback may unmount or switch the session) and then calls the
  latest `onClose`. Request-failure copy is never shown for a callback failure; no resend.
- The panel passes `requestId={proposal?.proposalId}`, `canManage`, `previewReadOnly` to the
  modal and returns `onRefresh()`'s result from the `onSaved` wrapper (arguments and call
  count unchanged). The reminder render site is unchanged.
- Payload shapes, success predicates, eligibility messages, aria labels, disabled
  conditions and copy are unchanged. No new disabled control, eligibility rule or exported hook.
- The reminder clears `feedback` and the modal clears `error` when the committed session
  changes, so a departed context's copy never renders for the new owner (review REQUIRED-1).
  The modal's form reinit is narrower than its epoch bump: `isOpen`, reviewer identity and
  `requestId` reinitialize `disposition`/`notes`; a `canManage`/`previewReadOnly` flip bumps
  the epoch and clears `error` but preserves typed notes (review ADVISORY-3).
- One `eslint-disable-next-line react-hooks/exhaustive-deps` sits on each no-deps session
  effect; the rule otherwise demands a dependency list that would re-fire on same-row object
  churn and erase drafts. Both verified necessary and minimal by the reviewer (removing either
  adds exactly one warning; `--report-unused-disable-directives` reports none).

### Orchestrator correction before freeze
The builder's first pass awaited the callback's returned promise before closing the modal
and releasing the reminder lock. On the follow-up host the callback returns the whole
`loadProposals` reload, so the dialog would have stayed open showing "Saving…" through a
two-fetch reload and would have missed `onClose` if the reload unmounted it. Returned for
correction: observe rejection without awaiting. Two discriminating tests (never-resolving
`onSent`/`onSaved`) fail against the awaiting version and pass at `b08c16f6`.

## Red-before-code evidence
- Baseline nine-suite UI selection at `dcd58b32`: 9 suites / 894 tests passed (builder-run this session; the Session 486 receipt recorded the same figure at the identical test tree).
- New cases against unchanged runtime: reminder suite 12 of 33 failing, closeout suite 20 of
  32 failing (reviewer-measured; the builder reported totals one lower per suite with identical failure counts); every current-context case passed and every lifetime/callback case
  failed. The unmount cases and the same-row draft-preservation case already passed at
  baseline and are retained regression evidence, not discriminating cases.
- Builder guard removals in the working tree, each reverted and diffed back:
  (a) epoch comparison removed from the reminder's `isCurrent` → 9 assertion failures;
  (b) post-`onSaved`/pre-`onClose` recheck removed from the modal → 2;
  (c) generation-match guard removed from the reminder's `finally` → 0, redundant by
  construction: the lock is synchronous so no newer attempt can exist while an older
  `finally` runs, and unmount is the only other generation bump; retained as defense in depth;
  (d) the three new props removed at the closeout render site → 2 (both panel-level wiring tests).
  All assertion failures, no crashes.

## Verification
[VERIFIED via orchestrator-run commands at frozen `d3ec406a`; the earlier full run at `b08c16f6` was 771 suites / 11,255 tests]

| Command | Result |
|---|---|
| nine-suite UI selection (plan's eight plus `reviewer-action-lifetimes`) | 9 suites / 949 tests pass (933 at `b08c16f6`) |
| `npm test -- --runInBand --watch=false` | 771 suites / 11,271 tests pass |
| `npm run check:types` | pass |
| `npm run lint` | 0 errors, 76 warnings repo-wide (the pre-existing set); the four changed files carry the identical nine pre-existing warnings shifted by the added lines (compared by rule and line against `dcd58b32`) |
| `git diff --check` | clean |
| `npm run build -- --webpack` | pass; no generated file changes in `git status` |
| Gate pairs, serial, gate then self-test: dataverse-access-layer, route-service-boundary, dynamics-context-boundary, api-routes, route-lifecycle-auth, trust-boundary-guid, status-enum-parity | all 14 pass |

## Independent review
Reviewer: fresh-context Opus subagent (native, subscription path; no metered product),
read-only against frozen `b08c16f6`, contract-reconcile Mode A. It verified the clean tree at
start and end, read the plan, approved decisions, the 6B1 receipt, the orchestrator trace,
both hosts, both routes and their services, and the whole diff. It waited for the
orchestrator's full-suite run to finish before any working-tree mutation.

Commands actually run by the reviewer at `b08c16f6`: the two changed suites (65 pass); the
nine-suite selection (9 / 933 pass); the two new suites against the `dcd58b32` runtime
(reminder 12 failed / 33, closeout 20 failed / 32, zero crashes); eslint on both runtime files
at HEAD and baseline (identical nine warnings); disposable StrictMode renders of both
components (3/3, file deleted); and the guard-removal matrix below.

| Mutation | Failures |
|---|---|
| (a) epoch comparison removed from the reminder `isCurrent` | 9 |
| (b) modal post-`onSaved`/pre-`onClose` recheck | 2 |
| (c) reminder `finally` generation match | 0 (structural: synchronous lock; kept as defense in depth) |
| (d) three new props at the closeout render site | 2 |
| (d2) only `requestId` prop at the render site | 0 before correction (NOTE-5) |
| (e) reminder unmount epoch bump | 0 (structural: `isCurrent` short-circuits on mounted) |
| (f) modal form reinit removed, epoch bump kept | 1 |
| (g) `result.catch` observers removed, both | 2 (unhandled rejection) |
| (h) `isCurrent(epoch)` removed from both catch branches | 0 before correction (REQUIRED-2) |
| counterfactual: `await latestOnSaved(data)` restored | never-resolving test hangs to timeout (D1 amendment verified) |

Findings and disposition:
- REQUIRED-1 (runtime): the reminder never cleared `feedback` on a session change, so
  "Reminder sent." or a failure message rendered for the new owner after a reviewer or
  request switch, contradicting the plan matrix's "no old state in the new owner". Corrected in
  `d3ec406a`: `setFeedback(null)` in the epoch-bump branch plus two discriminating tests (2
  failures when removed).
- REQUIRED-2 (test teeth): the `isCurrent(epoch)` guard in both catch branches was load-bearing
  (the generation still matches for an epoch-departed attempt) but untested. Corrected in
  `d3ec406a`: a fetch-rejection stage in both lifetime matrices (reminder 5×3, modal 7×3);
  removing the reminder guard fails 4, the modal guard 6, and the reviewer proved the excluded
  copy really renders when the guard is deleted.
- ADVISORY-3: the modal's five-field session comparison also drove form reinit, so a
  `canManage`/`previewReadOnly` flip wiped typed notes. Orchestrator decision: narrow the reinit
  to `isOpen`/reviewer/request identity while keeping the epoch bump on all five. Corrected in
  `d3ec406a`; merging the conditions back fails 1 test.
- NOTE-4: mutations (c) and (e) are structural zeros; keep as defense in depth (6B1 ADVISORY-5).
- NOTE-5: the `requestId` wire at the closeout render site had no panel-level test; a
  proposal-switch test was added (removing only that prop now fails exactly 1).
- NOTE-6: runtime comments cited baseline line numbers; rewritten by name.
- NOTE-7: the builder's baseline totals were off by one per suite (33 and 32, not 32 and 31);
  failure counts matched exactly.

**Verdict at `b08c16f6`: BLOCK** on REQUIRED-1 and REQUIRED-2.

Narrow re-review of `d3ec406a` by the same reviewer (tree clean before and after; scope
confirmed: four files, one panel hunk inside `ReviewReminderAction`, everything from the 6B1
registry through the closeout render site byte-identical to `b08c16f6`): two suites 81/81;
nine-suite selection 9 / 949; mutations reproduced exactly (feedback clear 2, reminder catch
guard 4, modal catch guard 6, merged reinit 1, `requestId` prop 1, `setError(null)` 1; all
assertion failures, zero crashes); six disposable probes 6/6 including a permission flip during
a pending save (no `onSaved`, no `onClose`, no alert, lock released, draft preserved) and
ordinary same-context refresh not clearing feedback; eslint nine warnings with no unused
disable directive; types clean. The reviewer confirmed that a permission flip clears a
displayed server error while preserving the draft and judged it correct: the error was
produced under a context that no longer exists.
**Verdict: PASS for Stage 6B2 at `d3ec406a`. No remaining required change. No approval is
expressed for 6B3.**

Reviewer limits: full suite, build and gates were orchestrator-run, not independently rerun;
StrictMode coverage is a jsdom proxy; cross-reviewer and cross-request cases are
component-contract-only in production because rows are keyed by `suggestionId` and hosts
remount per request.

## Audit and operational limits
- The guarantee is per mounted component instance; other tabs, remounts and server-side state remain outside it.
- Plan deviation, deliberate: the plan's "report refresh failure only while current" is not
  implemented for these two components. Neither has a post-close reporting surface and both hosts swallow refresh errors (`ReviewersTab.js:139–161,256–265`; `reviewer-follow-up.js:172–205`), so a refresh failure after a confirmed send or closeout is observed but not reported. This is a stated limit, not a defect.
- `closeoutReviewerId` is not cleared by the panel when the closeout row vanishes (the activity drawer's `:1766–1768` does this); a mode away-and-back therefore reopens a fresh modal. Pre-existing, out of 6B2 scope, recorded as an observation.
- A `canManage`/`previewReadOnly` flip while the modal is open bumps the epoch and clears a displayed server error but preserves typed notes; the realistic trigger is the follow-up host recomputing `proposal.workbench?.canManage` on reload (`reviewer-follow-up.js:40`).
- No browser/live probe, deployment or human UAT ran for this slice. Nothing is merged to `main` or deployed; promotion is a separate, deliberate action under the release strategy.
