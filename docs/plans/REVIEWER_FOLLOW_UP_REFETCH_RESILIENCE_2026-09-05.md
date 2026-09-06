---
title: Reviewer Follow-up — refetch-error resilience
kind: plan
domain: reviewer-workbench
status: active
canonical: false
owner: product-engineering
last_verified: 2026-09-05
---

# Reviewer Follow-up — refetch-error resilience

**Architect:** Claude (Session 489). **Builder:** Sonnet subagent. **Reviewer:** Opus
subagent. **Adversarial:** Codex, at most two rounds. **Tier:** 1 (contained UI fix on
a stable contract) per `docs/CAMPAIGN_RELEASE_AND_DATAVERSE_TEST_STRATEGY.md` §Tier 1 —
branch `claude/reviewer-follow-up-refetch-resilience`, PR, owner merge.

## Problem [VERIFIED via source on main `e3071fdd`]

`pages/workbench/reviewer-follow-up.js` `loadProposals` (lines 199–232) clears the whole
proposal list on any refetch failure:

```js
} catch (loadError) {
  if (requestIdRef.current !== requestId) return;
  setError(loadError.message);
  setProposals([]);          // <- discards last-known-good
}
```

and the render (line ~414) hides the list whenever `error` is set:

```js
) : !error ? ( <list of ReviewerGroup/> ) : null}
```

So a PD who sends a reminder from this page and hits a transient error on the
follow-up refetch (`onRefresh` → `loadProposals`) watches every request vanish and the
summary metrics drop to zero. The per-request Reviewers tab already solved the same
class in Stage 6B3d/6B3e (`shared/components/reviewers/ReviewersTab.js:154–167`): keep
the last committed data, show an error banner with Retry, and run the panel in
`degraded` mode so mutating actions are disabled until a refresh succeeds
(`ReviewerManagePanel` `degraded` prop, `tests/unit/reviewer-manage-degraded.test.js`).

## Change (one file + one test file)

### `pages/workbench/reviewer-follow-up.js`

1. **Keep last-known-good.** In the `loadProposals` catch, remove `setProposals([])`.
   Set `error` only. First-load failures still leave `proposals` as `[]`.
2. **Render the list when data exists, regardless of `error`.** Replace the
   `!error ? (list) : null` branch so the list renders whenever `visibleProposals.length > 0`.
   The empty-state `Card` (line ~396) must render only when `!error && visibleProposals.length === 0`
   (unchanged). When `error && proposals.length === 0` render the banner alone.
3. **Degrade the mounted panels.** Add a `degraded` prop to `ReviewerGroup`
   (`function ReviewerGroup({ proposal, previewReadOnly, onRefresh, degraded })`) and pass
   `degraded={degraded}` to `ReviewerManagePanel` (line ~102). At the call site (line ~416)
   pass `degraded={Boolean(error)}`. Do not touch `ReviewerManagePanel.js`.
4. **Banner copy depends on whether a prior list exists.** Keep the existing banner and
   "Try again" button; change the headline/body:
   - `proposals.length === 0`: keep "Reviewer follow-up could not be loaded" + message.
   - `proposals.length > 0`: headline "Reviewer follow-up could not be refreshed"; body
     "Showing the last loaded results. Retry before making changes." followed by the
     error message. Keep the same `role="alert"` container and the "Try again" button.
   Do not change any other copy on the page.

Non-goals: no change to fetch URLs, request/scope/view state, `mergeReviewerFollowUpProposals`,
summary math, preview-read-only gating, ReviewerManagePanel, WorkbenchViewsNav, or styling
beyond the banner text. No new dependencies.

### `tests/unit/reviewer-follow-up.test.js`

Extend the existing `MockReviewerManagePanel` (line 26) to expose `degraded`, e.g. render
`data-degraded={degraded ? 'true' : 'false'}` on its root element, keeping the existing
`canManage` behavior the preview-safety tests rely on. Add a `describe('reviewer follow-up
refetch resilience')` block with three tests using the same `global.fetch = jest.fn(...)`
pattern as the request-scope tests (lines 162–195):

1. **Initial load failure shows the banner only.** Dashboard cycles OK; the proposals
   fetch returns `ok:false` with `{ error: 'boom' }`. Expect the "could not be loaded"
   banner, no `MockReviewerManagePanel`, and none of the empty-state headlines
   ("No requests are assigned to you in this cycle." / "No reviewer follow-up needs
   attention." / "No … requests match this view.").
2. **Refetch failure keeps the list and degrades the panel.** First load succeeds with
   `dashboardProposals`/`reviewerProposals` (existing fixtures) so at least one
   `ReviewerGroup` renders; expand it ("Show reviewer activity") so the mock panel mounts
   with `data-degraded="false"`. Then make the reviewers fetch fail and click "Try again".
   Expect: the same request cards still render, the banner reads "could not be
   refreshed" and "Showing the last loaded results", and the mock panel now has
   `data-degraded="true"`.
3. **Retry success clears the degraded state.** Continue from 2: make fetch succeed
   again, click "Try again", expect the banner gone and `data-degraded="false"`.

Mutation checks the builder must run and report: (a) restore `setProposals([])` in the
catch → test 2 fails; (b) drop `degraded={Boolean(error)}` at the call site → test 2 fails;
(c) revert the render guard to `!error ? … : null` → test 2 fails. Restore the fix after
each check.

## Corrections after the first build (architect + Codex round 1, 2026-09-05)

5. **Last-known-good is bounded by cycle and scope.** A `lastLoadedParamsRef` records
   `${cycle}|${scope}` on the success path of `loadProposals`. The cycle/scope effect compares
   it to the current params. The effect **always** supersedes any in-flight load first
   (`requestIdRef.current += 1`, unconditional — the effect runs only on mount or a param
   change, so a late response from whatever was in flight fails the existing request-id
   checks and can neither repopulate the list, flip `loadingProposals`, nor rewrite the ref);
   only on a params difference does it then clear `proposals` and `error` and set
   `loadingProposals`; then it schedules the new load. Opus round 2 showed the gated form
   leaked when the first load was still in flight (ref null) and on an A→B→A toggle with B
   pending; test 8 pins the first window. Initial mount (ref
   null) and same-params retries leave the list alone. Test 4 covers the scope change; test 5
   resolves the old params' fetch *after* the change but *before* the scheduled new load and
   asserts the old cards never render. [Codex round 1, high — accepted.]
6. **Retry keeps the groups mounted.** The "Loading reviewer activity…" placeholder renders
   only when `proposals.length === 0`. When a prior list exists, the list stays rendered during
   the refetch, each `ReviewerGroup` keeps its `open` state, the panel receives
   `loading={loadingProposals}` (the same prop `ReviewersTab.js:556` passes; the panel shows a
   subtle spinner, `ReviewerManagePanel.js:2663`, documented at `:15`), and the banner's "Try again" button is
   `disabled` with the label "Retrying…" while a load is in flight. Test 6: expand a group,
   click Try again with a slow failing fetch, assert the mock panel stays mounted and open
   throughout and the button is disabled mid-flight. [Codex round 1, medium — accepted.]

7. **Filtered-empty under error shows the filter card.** The empty-state card guard becomes
   `visibleProposals.length === 0 && (!error || proposals.length > 0)`: with a retained list
   and a view/search filter matching nothing, the "No … requests match this view." card renders
   under the "could not be refreshed" banner; a first-load failure still shows the banner alone.
   Test 7. [Opus round 1, advisory — accepted.]
8. **No empty-state flash on parameter change.** The clearing block also sets
   `loadingProposals` true so the empty card and zero metrics do not paint between the clear and
   the deferred load. Test 3's banner-absence assertion moves after the list remount so it cannot
   pass before the retry resolves. [Opus round 1, advisories — accepted.]

Opus round 1 verdict at `8fb1f47f`: BLOCK, one required item (the superseded-load race, same as
Codex's high) and four advisories, all accepted above. Mutation checks (a)–(d) executed by the
reviewer: all discriminating.

Codex adversarial round 2 (final) at `7bf40cee`: **approve**, no material findings; round-1
items confirmed resolved; tests 5 and 8 confirmed to exercise pending fetches rather than timer
cancellation. Codex's sandbox could not run Jest (EPERM on the haste map); the slice-exit test
evidence below is orchestrator-run.

**Merged and smoked:** PR #152 → `e9909e91` (2026-09-05 PT), production deployment success.
Signed-in production smoke (S489): `/workbench/reviewer-follow-up?cycleCode=D26` loaded 10 assigned
requests with no banner; "Show reviewer activity" mounted the panel; toggling to All requests
cleared the list to the loading placeholder (no stale cards) and reloaded 44 cycle requests / 67
active reviewers with no banner. The failure paths are covered by tests only (not provokable on
production).

**Declined (recorded):** Codex round 1 asked for a real-panel test proving mutating controls are
disabled while `degraded`. That contract is already pinned by
`tests/unit/reviewer-manage-degraded.test.js` (6B3e) against the real panel; the host tests here
prove the host passes the prop, the same composition `reviewers-tab-stale-request.test.js` uses
for `ReviewersTab`. Adding a second real-panel test would duplicate 6B3e's teeth.

Mutation checks now number nine: (a)–(c) above; (d) remove the clearing block in the effect →
test 4 red; (e) remove the `requestIdRef` bump → test 5 red; (f) restore the unconditional
loading placeholder → test 6 red; (g) revert the empty-card guard → test 7 red; (h) move the
bump back inside the params-changed `if` → test 8 red; (i) drop the `loading` pass-through →
test 6 red (mock pins `data-loading`).

Opus round 2 verdict at `07249a27`: BLOCK on the gated bump (two reproduced windows); everything
else checked out — `finally` guard, error-clearing paths, loading precedence, the four
empty-card combinations, tests 5–7 genuinely exercise their races. Advisories accepted: pin the
`loading` pass-through (test 9 / mock `data-loading`); the `setLoadingProposals(true)` on clear
remains untested by choice (a flash, not a correctness property). Pre-existing, out of scope: a
cycles-load failure sets `error` with no `cycleCode`, so the banner has no Try again button.

## Verification the builder runs

```sh
npm test -- --runInBand --watch=false --runTestsByPath tests/unit/reviewer-follow-up.test.js tests/unit/reviewer-manage-degraded.test.js tests/unit/reviewers-tab-stale-request.test.js
npm run check:types && npm run lint
git diff --check
```

Then commit on the branch with a descriptive message. Do not push, merge, or touch `main`.

## Review checkpoints

- Opus review: diff + this plan; confirm the three mutation checks were real (ask for the
  red output), confirm no behavior beyond the plan changed, confirm banner copy matches.
- Codex adversarial review (`/codex:adversarial-review`, committed diff on the branch):
  round 1 after Opus; round 2 only if round 1 finds a defect. Stop at two.
- After merge: update `docs/agent-wiki/topics/reviewer-workbench-lifecycle.md` (the 6B3d
  paragraph that says the follow-up host still empties its list) and the 6B3 receipt
  "Open after promotion" line. Architect owns these, not the builder.
