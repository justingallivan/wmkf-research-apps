---
title: Reviewer Lifecycle Stage 3 — named server commands (pilot and first expansion)
kind: plan
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-05
summary: Move closeout, terminal transition, status/response correction, expire and post-send bookkeeping into lib/services/reviewer-engagement/ behind wrappers.
---

# Stage 3 — named server commands

**Architect:** Claude (S489, owner autonomy grant 2026-09-05). **Builder:** Sonnet, one slice per
branch. **Reviewer:** Opus per slice. **Adversarial:** Codex ≤2 rounds per slice, on the build.
**Tier:** 1 per slice (file moves behind wrappers; contracts unchanged). **Source of scope:**
refactor report §Stage 3 "Move order" 1–5; the writer-assignment table rows 6–12 are Stage 3
expansion and are planned separately after slice 3A's review (report: "add a caller-boundary
census test before migrating the second command").

## Slices

### 3A — closeout pilot [VERIFIED via source on main `874bac0c`]

Move the implementation of `lib/services/review-manager/close-review-service.js` (`closeReview`
`:101`, `_closeReviewInternals` `:221`, its error class) to
`lib/services/reviewer-engagement/close-review.js`. The old module becomes a compatibility
re-export: `export { closeReview, _closeReviewInternals, <ErrorClass> } from '../reviewer-engagement/close-review';`
so error identity (`instanceof`) and test-visible exports are preserved. Route
`pages/api/review-manager/close-review.js` keeps its import path (the pilot does not touch the
route); it already binds auth/request (`authorizeReviewerRequestMutation` → `closeReview({...,
authorizedRequestId})`, `:49–60`). Callers today: the route and four test files (grep
`close-review-service`).

**Entry tests already present:** `tests/unit/reviewer-closeout-service.test.js`,
`tests/unit/reviewer-closeout-route.test.js`, `tests/integration/reviewer-engagement-contract.test.js`
(composed version/repeat/correction/invalid-input cases at `:226`),
`tests/integration/reviewer-engagement-races.test.js`. **New:** `tests/unit/reviewer-engagement-close-review-paths.test.js`
proving both import paths resolve to the same function object (`toBe`) and that a thrown error from
the new path `instanceof` the class exported by the old path. Add a **caller-boundary census
test** (`tests/unit/reviewer-engagement-census.test.js`) that greps `lib/`, `pages/`, `scripts/`
for imports of `review-manager/close-review-service` and asserts the set equals the recorded list
(the route alone — the wrapper imports the NEW path), so a new direct caller must be recorded
deliberately. Extend it per slice.

Exit: retained suites + the four listed + full suite, types, lint, build, `check:route-service-boundary`
(routes still import a `lib/services/<domain>/` module — both `review-manager/` and
`reviewer-engagement/` satisfy the gate's shape; verify with the gate run), `check:dataverse-access-layer`.

### 3B — terminal transition

Move `lib/services/review-manager/terminal-transition-service.js` (`TerminalTransitionError` `:27`,
`transitionReviewersTerminal` `:54`, `_terminalTransitionInternals` `:158`) to
`lib/services/reviewer-engagement/terminal-transition.js` with the same wrapper pattern. Preserve
withdrawal's atomic delete and the post-commit cancellation warning verbatim. Callers: route
`pages/api/review-manager/terminal-transition.js` + four tests. Census test gains the entry.

### 3C — status correction

Extract only `patchReviewers` and `ReviewerStatusMutationError` from
`lib/services/review-manager/reviewers-service.js` (`:469`, `:499`) to
`lib/services/reviewer-engagement/correct-status.js`; `reviewers-service.js` re-exports both and
keeps `getReviewers` and its projections. Preserve the shipped 6A result arrays and sequential
stop-on-first-failure. Caller: `pages/api/review-manager/reviewers.js:47,127,151`.

### 3D — response correction

Extract the approved response-only correction path from `patchMyCandidates`
(`lib/services/reviewer-finder/my-candidates-service.js:499`, the lifecycle branch at ~`:690–740`)
to `lib/services/reviewer-engagement/correct-response.js`, called from the old service. Preserve
the order: lifecycle write (`updateLifecycle` at ~`:708`) → nonfatal `accepted === true` token
follow-up (`ensureToken` ~`:735`) → person edits (~`:743`), and the partial-success behavior. Person
edits, restore and manual-invite handling stay in the old service. Stage 2's shared policy module
is a prerequisite (this slice consumes its predicates).

### 3E — expire and post-send bookkeeping

Move the fixed conditional expire operation (`lib/services/reviewer-suggestion-sweep.js:~124`) to
`lib/services/reviewer-engagement/expire-invitation.js` and `recordDeliveredEmail`
(`lib/services/review-manager/send-emails-service.js:127`) to
`lib/services/reviewer-engagement/record-email-outcome.js`; scan orchestration, transport,
streaming and correlation stay where they are. **Sequencing note:** 3E touches
`send-emails-service.js`, as does Stage 6D. Land 6D first or rebase 3E onto it; do not run both
builders on that file concurrently.

## 3A build and review record

- **Build (Sonnet, 2026-09-05):** `16bacd6b` → corrections `aec5f54f`, `401f1161` on
  `claude/reviewer-lifecycle-stage3a` (rebased as `29879919`/`44f2cffe`/`401f1161`); PR #154. The
  moved module is byte-identical to main's `close-review-service.js`; the wrapper re-exports exactly
  `closeReview` and `_closeReviewInternals`. Six-suite selection 6 / 288; full suite 775 / 11,336
  (pre-correction head); types, lint 0 errors, `check:route-service-boundary` exit 0,
  `check:dataverse-access-layer`, build, `git diff --check` green. Mutations: wrapper-not-identity →
  paths test red; scratch importer → census red; broken regex → non-vacuity red.
- **Opus review (`16bacd6b`): PASS WITH ADVISORIES**, two required — drop the `ServiceHttpError`
  re-export (the plan's `<ErrorClass>` placeholder meant a dedicated class; there is none, errors are
  plain `ServiceHttpError` via `closeoutError`), and match literal dynamic `import(`. Both applied.
  Advisory accepted: this plan's wording "route + wrapper" was imprecise — the census records
  importers of the OLD path, which is the route alone; the wrapper imports the new path.
- **Codex adversarial round 1:** same two items plus scanning all production extensions and
  export-from; applied. **Round 2 (final):** round-1 resolution confirmed; one further evasion (a
  comment between the import keyword and the specifier) — fixed in `401f1161` with three more
  fixtures. Cap reached; no round 3. Recorded limit: a non-literal specifier (`require(variable)`)
  is not detectable by the regex scanner; an AST scan is the later-slice upgrade if a real caller
  ever needs it. Census helper: `tests/helpers/import-census.js`.

## 3B build and review record

- **Build (Sonnet, 2026-09-05): `0169fb05`** on `claude/reviewer-lifecycle-stage3b` (cut from main
  `b7a04cd6`). Moved module byte-identical to main's `terminal-transition-service.js`; wrapper
  re-exports exactly `TerminalTransitionError`, `transitionReviewersTerminal`,
  `_terminalTransitionInternals`; census row added (route is the sole legacy importer). Seven-suite
  selection 278 tests; full suite 777 / 11,352; types, lint 0 errors, `check:route-service-boundary`,
  `check:dataverse-access-layer`, build, `git diff --check` green. Mutations: wrapped export → paths
  test red; scratch importer → census red.
- **Codex adversarial round 1 (`0169fb05`): approve**, no material findings (cross-registry class
  identity under Jest isolation noted as inherent, not a regression).
- **Opus review (`0169fb05`): PASS WITH ADVISORIES, zero required.** Byte-identical confirmed;
  wrapper exports exactly the three prior symbols; imports resolve with no `review-manager/`
  dependency; withdrawal atomic delete (`:97–104`) and cancellation warning (`:126–142`) located
  verbatim; census grep matches; mutations bite. Advisory: catalog entry for
  `review-manager/terminal-transition-service.js` still describes the implementation — fixed in the
  post-merge docs pass. PR opened after rebase.

## 3C build and review record

- **Build (Sonnet, 2026-09-06 UTC): `07d46542` + `bcb9bbb1`** on `claude/reviewer-lifecycle-stage3c`.
  `ReviewerStatusMutationError` and `patchReviewers` (main `reviewers-service.js:462–538` incl.
  docblocks) moved byte-identically to `reviewer-engagement/correct-status.js`; the moved body uses
  no local helper of the old file (all its symbols come from canonical modules); `reviewers-service.js`
  keeps `getReviewers` and re-exports both. Census row added with a `(?<!-)reviewers-service`
  lookbehind (bare pattern also matched `workbench/applicant-reviewers-service`); expected importers
  = the route and `export-reviews-service.js` (imports `getReviewers` only). Builder judgment,
  accepted: `tests/unit/export-reviews-service.test.js` hand-mocks the module with `getReviewers`
  only; `correct-status.js` is never loaded in that graph. 13-suite selection 859 tests; full suite
  779 / 11,409; gates green. Mutations: wrapper re-implemented → paths test red (3/3); scratch
  importer → census red.
- **Codex adversarial round 1 (`bcb9bbb1`): needs-attention, two documentation mediums, both
  accepted.** (1) Catalog still said `reviewers-service.js` owns the correction — fixed on main in
  this docs pass (entry for `correct-status.js`; old entry narrowed). (2) The legacy module's header
  still claims "ALL business logic for GET/PATCH" and documents the correction contract as living
  there — the builder's `bcb9bbb1` wording fix was insufficient; header rewritten to "owns
  `getReviewers`; compatibility re-exports only; correction contract lives in `correct-status.js`"
  in the correction commit.
- **Opus review (`bcb9bbb1`): PASS WITH ADVISORIES, zero required.** Byte-identical body confirmed
  (md5 match on main `:462–538` vs `correct-status.js:17–93`); no local helper of the old file is
  used by the moved code; `REVIEW_STATUS_BY_VALUE` stays and the parity gate still reads it there;
  6A contract located verbatim (arrays `:24–33`, sequential loop with throw-on-first-failure
  `:75–85`); re-exports exact; census expected list independently confirmed; 13 suites / 884 tests
  and the auth-routes integration suite green. `bcb9bbb1` changed one line of NEW header prose in
  `correct-status.js` (a wording that briefly conflated 3D scope), within discipline. Advisory:
  legacy header stale (same as Codex) — rewritten in the final commit (`b3e2ee7d`, rebased as
  `c73bf12e`). PR #158 merged `1c24e56f` (2026-09-06, seven checks green). Codex round 2 not spent: both round-1 findings were documentation
  fixes verified directly by the architect (catalog on main, header in the branch).

## 3D build and review record

- **Build (Sonnet, 2026-09-06 UTC): `49080321` + `08617c6a`** on `claude/reviewer-lifecycle-stage3d`
  (cut from main `21cc221b`, fast-forwarded to `e31ae434`). The `if (hasLifecycle)` body (main
  `my-candidates-service.js:674–731`) moved to `reviewer-engagement/correct-response.js:64–121` as
  `correctResponse({ suggestionId, lifecycle, authorizedRequestId, actingUserSystemId })`, verified
  byte-identical by `sed`+`diff` after the 6→2-space dedent; `correctionError` (all 11 call sites
  were inside the block) and `MyCandidatesError` moved with it, the class re-exported from the old
  file. Unused imports removed from the old service. Census rows: importers of the old service =
  the `my-candidates` route only; importers of `correct-response` = the old service only. New
  suites `correct-response.test.js` (23, incl. a deferred-promise write-before-token ordering proof)
  and `reviewer-engagement-correct-response-paths.test.js` (3). Zero existing test edits (Jest
  resolves mocks by absolute path). Full suite 783 / 11,468; types, lint 0 errors,
  `check:route-service-boundary`, `check:dataverse-access-layer`, `check:trust-boundary-guid` (+
  self-tests), build, `git diff --check` green. Mutations: faithful inline reimplementation → paths
  delegation test red; `ensureToken` before `updateLifecycle` → ordering test red; drop `ifMatch` →
  args test red.
- **Codex adversarial round 1 (`08617c6a`): needs-attention, one medium, accepted.** Moving
  `MyCandidatesError` into the command module makes the whole finder service (GET, manual invite,
  restore, person edits) import `correct-response.js` — and through it the adapters and token
  lifecycle — just to obtain its error class, inverting the boundary the earlier slices protected.
  Correction: give the class a neutral leaf owner (`lib/services/reviewer-engagement/errors.js`,
  imports nothing from services) imported by both files; the old file keeps its re-export; the paths
  test pins identity across all three.
- **Opus review (`08617c6a`): PASS WITH ADVISORIES, zero required.** Byte identity confirmed by md5
  on the dedented ranges (`a3e2889c…`); order and partial-success semantics unchanged (the 400 guard,
  `if (hasResearcher)` and the duplicate-email 409 block are outside the diff); every `instanceof
  MyCandidatesError` site is in tests and the route maps only on `ServiceHttpError`; 7/7 imports
  resolve to the same absolute modules and no `reviewer-engagement/ → reviewer-finder/` import
  exists; census reproduced independently over 1,120 files with no over/under-match; the 23 direct
  tests execute the implementation and the deferred-promise ordering test discriminates; 783 /
  11,468 and both boundary gates re-run green. Advisories folded into the correction: A2 dead
  fixture in the paths test (`findById` returned `undefined`, so the armed rejection never ran); A3
  JSDoc misattributes GUID validation to the shell; A6 neutral error owner (same as Codex). Carried
  forward: A1 "zero existing test edits" should read "census test extended additively"; A4 catalog
  entry lands post-merge; A5 the `[my-candidates]` log prefix now emits from `reviewer-engagement/`
  (deferred cosmetic, verbatim rule).
- **Correction `3aee6d0a`** (rebased on `6219c289`; PR #160): `reviewer-engagement/errors.js` is the
  neutral leaf owner of `MyCandidatesError` (imports only `service-http-error`), imported by both
  `correct-response.js` and the old service, which keeps its re-export; identity proved by `toBe`
  on the errors export vs the re-export plus `instanceof` on an error `correctResponse` throws. The
  paths-test fixture now returns a valid row and asserts `correction_conflict` on a 412. JSDoc fixed.
  No census row for `reviewer-engagement/errors`: the bare `./errors` specifier and the generic
  fragment collide with `dataverse/core/errors` consumers (builder judgment, sent to Codex round 2).
  Full suite 788 / 11,525; gates green; no `reviewer-engagement/` file imports from `reviewer-finder/`.
- **Codex adversarial round 2 (final, `3aee6d0a`): approve.** Round-1 ownership item resolved (both
  services import the same neutral-leaf class; delegation enforced by the paths test and census);
  omitting a census row for `errors.js` is acceptable because it is a shared leaf, not an extracted
  command boundary. Cap reached.

## 3E build and review record

- **Build (Sonnet, 2026-09-06 UTC): `41a7b2de`** on `claude/reviewer-lifecycle-stage3e` (cut from
  main `f5e0ec79`, after 6D). `recordDeliveredEmail` + comment (main `send-emails-service.js:136–211`)
  and `POST_SEND_OPEN_REVIEW_STATUSES` (`:129–134`, used only there) moved to
  `reviewer-engagement/record-email-outcome.js`; call site unchanged; not re-exported (only the route
  imports the old module, only `sendEmails`). The sweep's per-row try body (main
  `reviewer-suggestion-sweep.js:124–154`) became `expireInvitation({ suggestion, cutoffIso, nowIso,
  actingUserSystemId })` → `{ outcome }` in `reviewer-engagement/expire-invitation.js`; the sweep's
  catch and counters stay; `EXPIRY_SELECT`/`isPendingInvitation` moved private, `isPastCutoff` moved
  and exported back. Three census rows (sweep → cron route; each new module → its single caller). New
  suites `record-email-outcome.test.js` (30) and `expire-invitation.test.js` (15). No mock seam needed
  (all mocks target canonical adapters). Full suite 788 / 11,544; types, lint 0 errors, boundary and
  parity gates + self-tests, build, `git diff --check` green. Mutations: parent revalidation after the
  patch → red; drop `ifMatch` → 9/30 red; swallow 412 → red.
- **Codex adversarial round 1 (`41a7b2de`): needs-attention, one medium, accepted.** Neither caller
  is pinned to delegate: a faithful inline reimplementation in either old file (keeping the unused
  import for the census) would pass all 45 direct tests. Correction: delegation tests that mock the
  extracted module and assert the sweep calls `expireInvitation` and maps `swept`/`skipped`/thrown
  412/not-found to the counters, and that the send loop calls `recordDeliveredEmail` with the existing
  arguments at the same point relative to the SSE events (the 3D paths-test pattern). Opus pending.

## Rules for every slice

Move verbatim; wrappers re-export the same objects (no re-wrapping that breaks `instanceof`); no
route path changes; no new trusted DAL context minted below the route; each command still delegates
persistence to the adapter; no universal patch command. "Do not progress on wrapper-only passing
tests": each slice adds at least one direct new-path test that executes the implementation.

## Review checkpoints

Per slice: Opus confirms pure move + both-paths identity + census update; Codex round 1 on the
build, round 2 only for a confirmed defect. After 3A, record the pilot review before starting 3B
(report: "after pilot review").

## Docs (after each merge)

Readiness audit rows "3 — closeout command pilot" / "3 — command expansion"; service catalog
entries for the new `reviewer-engagement/` modules (`docs/SERVICE_AND_UTILITY_CATALOG.md`);
`docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` Route→Service note; receipt per slice.
