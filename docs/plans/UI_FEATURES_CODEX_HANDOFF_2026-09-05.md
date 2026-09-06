# UI Features Codex Handoff — 2026-09-05

## Goal

Evaluate the Reviewer follow-up page as a read-only UI critique, preserve the
findings for a fresh session, and prepare a safe implementation path in the
isolated `codex/ui-features` worktree. The page under review is:

- `pages/workbench/reviewer-follow-up.js`
- Live route: `https://applications.wmkeck.org/workbench/reviewer-follow-up?cycleCode=D26#`

## Work completed

- Loaded the Impeccable product and design context. The surface is an internal
  Operate workflow using the “Clear Workbench” design direction.
- Reviewed the supplied screenshot and the route source in read-only mode.
- Ran the deterministic Impeccable detector against the route source; it
  returned zero findings.
- Produced a single-context critique because the current Codex session did not
  expose the independent sub-agent tool required by the critique skill.
- Browser accessibility/screenshot inspection timed out; no live overlay was
  claimed. The critique therefore relied on the supplied screenshot and source.
- The critique identified a 22/40 design-health score and high cognitive load.

## Decisions made

- No UI code was changed.
- No Claude-owned files were touched. In particular, do not edit:
  `shared/components/reviewers/ReviewerManagePanel.js`,
  `shared/components/reviewers/ReviewerCloseoutModal.js`, or their tests while
  Claude owns Stage 6B.
- Work remains isolated to `/Users/gallivan/Code/WMKF_Apps-codex` on
  `codex/ui-features`.
- The first design direction is to reduce hierarchy and make the attention
  queue the primary surface, rather than adding more functionality.

## Critique findings to preserve

1. The first viewport has too many hierarchy layers: page header, Workbench
   navigation, filters, metrics, search, and an expanded request card.
2. The number `7` is repeated in different contexts, creating ambiguity between
   attention items and received reviews.
3. Request cards open into a second application via the full
   `ReviewerManagePanel`, with three similarly weighted actions.
4. Controls and spacing are oversized for an operational triage surface.
5. Search is detached from the request list and does not show result context.

## Files intended to touch

Start with the smallest surface possible:

- `pages/workbench/reviewer-follow-up.js` — page hierarchy, toolbar, summary,
  search placement, and request-card disclosure behavior.
- A narrowly scoped shared Workbench navigation or style file only if source
  inspection proves it is necessary; do not change global navigation merely to
  make this page quieter.
- A focused test file for the route/component behavior if an existing test
  harness covers this surface.

Do not touch the Claude-owned Stage 6B reviewer management or closeout files.

## Open questions

- Should the primary view be a compact queue of requests needing attention, with
  “All reviewers” as a secondary view?
- Should request cards remain expanded for attention items, or should they show a
  compact summary with one “Review” action that opens the detailed panel?
- Which counts are semantically distinct enough to keep visible: attention,
  overdue, active, received, or another set?
- Should the Workbench-wide navigation remain full-width, or become a quieter
  compact strip on this task-specific page?
- The Impeccable critique snapshot could not be persisted because the existing
  `.impeccable/critique` directory in this worktree was not writable. The report
  itself is preserved here.

## Exact next steps

1. Reconfirm Claude’s current ownership before editing and inspect the current
   route source again for concurrent changes.
2. Choose the information architecture with the product owner: attention queue
   first, compact filters, and collapsed/summary request cards.
3. Create a small UI direction or shape pass before implementation; preserve
   existing data/API contracts and reviewer action behavior.
4. Implement only the page-level changes in `pages/workbench/reviewer-follow-up.js`
   and any directly necessary tests.
5. Verify at desktop and narrow widths, especially toolbar wrapping, search,
   card disclosure, loading/error/empty states, and preview-read-only behavior.
6. Run the relevant UI tests and gates, review the diff, and commit to
   `codex/ui-features`. Do not push to `main` or deploy.
7. Re-run the Impeccable critique after the UI pass if the browser inspection
   path is available.

## Session state

- Branch: `codex/ui-features`
- Worktree: `/Users/gallivan/Code/WMKF_Apps-codex`
- Code changes: none
- Pre-existing stashes: two unrelated reconciliation-report stashes were
  observed and intentionally left untouched.
