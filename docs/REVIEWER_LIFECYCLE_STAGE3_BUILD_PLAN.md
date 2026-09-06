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
