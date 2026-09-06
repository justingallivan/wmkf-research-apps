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
(route + wrapper), so a new direct caller must be recorded deliberately. Extend it per slice.

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
