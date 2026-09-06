# Reviewer Follow-up UI Polish — Codex Brief (2026-09-06)

## Where you are

You are in `/Users/gallivan/Code/WMKF_Apps-codex` on branch `codex/reviewer-follow-up-polish`,
a git worktree branched from `origin/main` at `8f8c59d0`. Run `/start` first. **Stay on this
branch and in this directory.** Claude is working in the main checkout (`/Users/gallivan/Code/WMKF_Apps`)
on `claude/final-writeups-cycle-scoping`; do not check out other branches, touch that directory,
or push to `main`. Push your branch itself (`git push -u origin codex/reviewer-follow-up-polish`)
after each meaningful commit; pushing a feature branch does not deploy.

## Goal

Polish the **Reviewer follow-up** page so it reads as a quiet, operational triage surface in the
"Clear Workbench" direction. The owner is reviewing this page first. Three polish types are in
scope, in this priority order:

1. **Consistency and hierarchy** — spacing, typography, alignment, control sizing, and the
   layering of header / navigation / toolbar / metrics / search / cards. The 2026-09-05 critique
   in `docs/plans/UI_FEATURES_CODEX_HANDOFF_2026-09-05.md` scored this page 22/40 on design
   health and named five findings; treat those findings as the starting checklist.
2. **Loading, empty, and error states** — the "Loading reviewer activity…" card, the three
   empty-copy branches, the degraded-with-last-results error banner, and the two Retry buttons
   (cycles vs proposals). Keep every existing behavior; improve legibility, placement, and
   affordance.
3. **UX copy** — labels, helper text, empty-state copy, and error copy.

Accessibility and responsive behavior are not a separate workstream, but nothing you change may
regress them: keep 44px interaction targets (`min-h-11`), visible focus rings, `aria-pressed` on
the segmented toggles, `role="alert"` / `role="status"` on banners, and the narrow-width toolbar
wrapping.

## Owned file surface (the safety boundary)

You may edit:

- `pages/workbench/reviewer-follow-up.js` — the whole page, including the local `ReviewerGroup`
  card component and the scoped `<style jsx>` block.
- `tests/unit/reviewer-follow-up.test.js` — extend or re-pin; every existing test must stay
  meaningful (see "Tests" below).
- A **new** page-local component file under `shared/components/workbench/` only if extracting a
  block out of the page makes the page legible (for example a `ReviewerFollowUpToolbar.js`). New
  file, page-only import, its own focused test.

You may **not** edit (shared primitives or Claude-owned surfaces):

- `shared/components/Layout.js`, `shared/components/workbench/WorkbenchViewsNav.js` (shared with
  the Final writeups dashboard Claude is changing), `shared/components/RequireAppAccess.js`.
- Anything under `shared/components/reviewers/` — `ReviewerManagePanel.js`,
  `ReviewerCloseoutModal.js`, `EmailTemplatesModal.js`, `ReviewersTab.js`, and siblings. The page
  embeds `ReviewerManagePanel` inside each expanded card; you may change how the card frames it
  (padding, disclosure, heading) but not the panel itself. The existing `<style jsx>` override that
  restyles the panel's `Manage` buttons is the accepted pattern if you need to quiet something
  inside it.
- Any `pages/api/**` route, any `lib/**` service or adapter, any Atlas or security-matrix doc.
  This page introduces no new API seam and must not start doing so.
- `pages/workbench/final-writeups/**`, `shared/components/final-writeups/**`.

If the polish you want genuinely needs one of those, stop and write the ask into
"Open questions" in this file instead of editing it.

## Contracts that must hold

- **Read contract unchanged.** The page reads `/api/workbench/dashboard` (cycle list, then
  `?cycleCode=&scope=&includeSetAside=1`) and `/api/review-manager/reviewers?cycleCode=&scope=`.
  Do not add parameters, change request shapes, or invent fields. Every value you render must
  come from those two responses as the page already consumes them; do not fabricate identifiers
  or field names (this repo hard-fails on fabricated literals).
- **Stale-response guards stay.** `activeCyclesLoadRef` and `requestIdRef` fence every
  post-await state write; the cycles Retry and the proposals Retry are independent by design
  (a failed cycles load leaves `cycleCode` empty so the proposals effect never runs). Do not
  merge the two retries or remove either token check. Any refactor must keep the existing test
  that pins the cycles-retry behavior green for the same reason it exists.
- **Degraded mode stays visible.** On a proposals error with prior results, the page shows the
  last loaded results with the banner "Showing the last loaded results. Retry before making
  changes." and passes `degraded={Boolean(error)}` into the panel. Keep both.
- **Preview read-only stays.** `previewReadOnly` (from `classifyTarget`) hides the Email
  templates button and disables follow-up controls with the blue status banner. Keep it.
- **Metrics are navigation, not compliance.** The four `<dl>` counts (requests, active reviewers,
  overdue, reviews received) are neutral counts. Do not add denominators, percentages, progress
  scores, or "N of M complete" framing. The critique's finding that a repeated number is ambiguous
  should be solved by labeling or removing a count, not by adding more.
- **Terminology.** "Overdue" / "late", "received", "waiting" are the existing reviewer states from
  the aggregate DTO; keep the words the data uses. Do not introduce Science and Engineering /
  Medical Research grouping.

## User-facing copy rules

- Transient or system failures blame the system in plain language and offer an action ladder.
  The owner-set voice: "I'm having trouble accessing the server. This is usually a temporary
  blip. Please press retry and if the problem doesn't resolve, contact an administrator." Never
  imply the user's access or permissions are in question; never use "application" to mean this
  app (it collides with grant applications). See
  `.claude-memory/feedback-user-facing-error-copy-voice.md`.
- Empty states say what is true and what to do next, in one or two short sentences.
- Labels are nouns; buttons are verbs. Keep "Try again" / "Retrying…" or improve them consistently
  in both retry places.

## Hierarchy decisions that are the owner's, not yours

The 2026-09-05 critique left these open. Polish within the current information architecture,
and record a recommendation for each in "Open questions" rather than deciding:

- Whether "Needs attention" should be the primary view with "All reviewers" secondary (today they
  are an equal-weight toggle).
- Whether attention cards should render collapsed with a one-line summary and a single "Review"
  action instead of expanding into the full panel.
- Which of the four counts survive.
- Whether the Workbench-wide navigation strip should be quieter on this page (that would be a
  shared-component change; do not make it).

## Method

1. `/start`, then read `pages/workbench/reviewer-follow-up.js` in full and
   `docs/plans/UI_FEATURES_CODEX_HANDOFF_2026-09-05.md`.
2. Run the existing test file before changing anything so you know the baseline:
   `npm test -- --runInBand --watch=false --testPathPattern reviewer-follow-up`.
3. Work in small commits, one polish concern each (hierarchy pass, states pass, copy pass).
   Descriptive commit messages; push the branch after each.
4. Verify at desktop and a narrow width (~375px): toolbar wrapping, search placement, card
   disclosure, loading / error / empty / degraded / preview-read-only states.
5. Before calling it done: `npm run lint` (0 errors), `npm run check:types`,
   `npm run build -- --webpack`, the test file above, and `git diff --check`. If you added a
   file under `shared/components/workbench/`, also run `npm run check:api-routes` to prove you
   added no route.
6. Do not merge to `main`, do not deploy, do not run `/stop` against `SESSION_PROMPT.md` (Claude
   owns that file this session). Record your handoff at the bottom of this brief instead.

## Tests

Existing `tests/unit/reviewer-follow-up.test.js` pins the read contract, the independent cycles
retry, degraded mode, and preview read-only behavior. Rules:

- Every existing test stays green or is re-pinned with a one-line reason in the commit message.
  Re-pin means the assertion still discriminates; a test that would pass with the guard deleted
  is decorative and must not be the replacement.
- Add a test for each new state or control you introduce, constructed so the excluded case is
  present in the fixture (for example, when asserting the empty state for "attention" view,
  include a proposal that is not in attention so the filter is actually exercised).

## Handoff (fill in at the end)

- Commits on `codex/reviewer-follow-up-polish`: 
- Files changed: 
- Verification run and results: 
- Open questions / recommendations for the owner: 
- Anything you wanted to change but could not within the owned surface: 
