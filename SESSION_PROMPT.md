# Session 500 Prompt: Workbench top-matter PRs #210 and #211 merged; owner brief first, then the Site Visit plan review

> **Read `docs/plans/OWNER_BRIEF_2026-09-09.md` first.** It holds the owner's production
> click-throughs, the five decisions waiting on the owner, and today's agent task. This prompt
> is the agent-side record.

## Session 499 Summary (Claude, 2026-09-08)

Owner-present for the first two thirds (cycle provenance, Workbench shell, Codex planning
handoff), then an overnight autonomous run under the owner's plan: Fable orchestrated, Sonnet
built, Opus reviewed, Codex ran the adversarial pass (`gpt-5.6-sol`), two fix rounds per PR at
most. Merges are the owner's. `main` is at the docs commit `a184506f` plus this handoff.

### What Was Completed

1. **Cycle provenance shipped to production** (PRs #203–#209, all owner-merged, post-merge
   `main` runs green). The dashboard default-cycle helper (`resolveWorkingCycle`, #203
   `715601d8`); the Request Workbench shell owning program and cycle in the URL with every
   view as a panel: Request list (#204 `dedaa5ac`), Reviewer follow-up (#205 `cccd5759`),
   Final writeups (#206 `495a1501`), Awardees and Initial assessments (#207 `888ac5cf`);
   read-side stragglers, Expertise Finder and request search filter by meeting date, no
   fiscal-year fallback (#208 `d01ecac0`); write-side straggler, suggestion rows stamped from
   the request's meeting date server-side, the client-supplied `grantCycleCode` removed, an
   off-month meeting date shows no cycle (#209 `e9ecf1d7`).
2. **Codex Site Visit Materials planning handoff absorbed** (planning only, no PR). Memory
   `.claude-memory/project-site-visit-materials-planning-handoff.md`; plan and eight-slide deck
   live on `origin/codex/applicant-additional-materials` (tip `e0166296`). Queue entry and
   to-do recorded (`04142042`…`a184506f`).
3. **Workbench top matter reconciled** from Codex's recommendation
   (`docs/plans/CODEX_WORKBENCH_TOP_MATTER_RECOMMENDATION_2026-09-08.md`, owner-chosen over
   Claude's, with amendments: Initial assessments untouched until J27; Program select on Final
   writeups and Awardees is context with a note, not a filter).
   - **PR #210** (`claude/workbench-top-matter`, Slices A+B, all checks green): no counts in
     the cycle dropdown (the "June 2026 (1)" vs two awardees bug), new subtitle, view heading
     and purpose under the strip, shared Scope control "Assigned to me / All in program"
     ("All program directors" on Awardees) preserved across its three views, shared live filter
     with visible label, Clear, and "Showing X of Y", Final writeups queue counts stable while
     typing and the lead sentence following the active queue, real pluralization ("1 writeup",
     "2 awardees"). Commits `d8d9e0c9`, `330094a1`, `f83303aa`.
   - **PR #211** (`claude/workbench-locator-disclosure`, Slice C, stacked on #210): the
     "Find a request" card becomes a closed-by-default "Find and open a request" disclosure on
     every view, body mounted only when open and once the program resolved, Program seeded from
     the shell and remounted on program change, Program/Cycle/Status behind "Search options",
     results titled "Request search results · {program}". Fixed a pre-existing race the on-demand
     mount made routine (query edits invalidated the options load). Commits `55e8f074`,
     `4ac542e3`, `5a73c603`.
   - Review trail: Opus READY WITH NAMED CHANGES on both; Codex three findings on #210 and two
     on #211, all applied. The one deviation from the owner's amendment: both reviewers found
     that disabling the Program select also froze the cycle list (the shell loads cycles per
     program), so the select stays live with the note. Recorded as an owner decision in the
     #210 body.
4. **Process:** the Codex worktree was parked prematurely mid-session and restored; standing
   instruction recorded below. Two handoff-memory pushes went to `main` with doc-symbol-refs
   red before the ignore markers landed (`098c2a19`); gate before commit, never chain a commit
   after a failing gate loop.

### Commits (Claude)

Merged to `main`: PRs #203–#209 (hashes above); docs `04142042`, `38586849`, `098c2a19`,
`72c20898`, `a184506f`. Owner-merged 2026-09-09: PR #210 (`0fb2e47b`), PR #211 (`7c647b52`,
retargeted to `main` first). Session-close docs on `main`: `dbae65fe`, `a7fdac38`, `c69295ce`
(harness-framing wording fix; the two post-merge `Tests` runs were red on that wording only),
`5f9d08cd` (memory: run `check:harness-framing` before handoff commits), `b38fc0e0` (owner
brief `docs/plans/OWNER_BRIEF_2026-09-09.md`).

Milestone determination: `DEVELOPMENT_LOG.md` entry added ("Grant cycle derives from the
meeting date everywhere; the Request Workbench becomes one shell").

## Next Items

### Verified Open

1. **Review the Site Visit Materials plan (to-do 2026-09-09), read-only.** Evidence: queue
   entry (`docs/CURRENT_WORK_QUEUE.md`, Site Visit item) and memory
   `project-site-visit-materials-planning-handoff.md`. Read with
   `git show origin/codex/applicant-additional-materials:docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`
   (tip `e0166296`; deck under `docs/plans/site-visit-materials/` on that branch). Eight
   open items in its §12; §2 is the decided owner contract. Produce an assessment; no implementation, no PR.
2. **DONE 2026-09-09: #210 (`0fb2e47b`) and #211 (`7c647b52`) merged by the owner; post-merge `main` green at `5f9d08cd`.** Remaining from the original item (the repo does not delete branches on
   merge, so after #210 confirm `gh pr view 211 --json baseRefName -q .baseRefName` prints
   `main`, else `gh pr edit 211 --base main` before merging):** watch the post-merge `main` runs
   (`gh run list --branch main`), then carry the #210 open items: whether the Program select on
   Final writeups/Awardees should be truly read-only (needs its own cycle source per view), and
   whether the locator disclosure should default open on Request list.
3. **Surface interlock and Dataverse write failures in the closeout route instead of a generic
   500.** Evidence: `pages/api/review-manager/close-review.js:64-71` maps only
   `ServiceHttpError`. Unchanged from Session 498; small, Tier 0.
4. **Reconcile Codex's three reviewer UI commits (`b5f353de`, `ab426be6`, `7f1ee13d`) from
   `codex/UI-audit`.** Evidence: Session 498 prompt; PR #192 CLOSED unmerged. Inspect the diff
   first; cherry-pick only the three.
5. **Cycle Dossier reconciliation.** Evidence: worktree `.claude/worktrees/agent-abe4c30babd201d76`
   now at `2e202725` on `claude/cycle-dossier-reconcile` (moved since Session 498's `81675ccd`;
   re-inspect before use); PR #179 still OPEN from `codex/cycle-dossier-pilot-build`. Blocked on
   the roster-scope decision.

### Owner Decision Needed

1. **Program select on Final writeups / Awardees** (PR #210 body, open item 1): live with a
   note (shipped in the PR) versus truly read-only with a per-view cycle source.
2. **Historic suggestion rows with a stale `wmkf_grantcyclecode`.** Evidence: PR #209 removed
   the client-supplied code and the stored-value preference in My Candidates; rows written
   before #209 keep whatever code the client sent. Reads now derive from the meeting date, so
   this is a data-hygiene question (backfill or leave), not a runtime one.
3. **Dossier roster scope** (`lib/services/cycle-dossier-service.js:24-41`): Research-only,
   cross-program, or a read-only rollout check first. Unchanged from Session 498.
4. **Codex branches to abandon or keep:** `codex/UI-audit`, `codex/reviewer-ui-surfacing`,
   `codex/c0-4-action-policy-foundation`, `codex/ror-api-production-shadow`.
5. **Site Visit plan open items** (eight, §12 of the plan) after item 1 above.
6. **Combined dossier retention policy**; **PD front-end flip to `Phase II Pending`** (J27 Q8);
   filed-not-urgent register items (Session 498 list).

### Owner's own checks (recorded so they are not forgotten)

- Production check for #209: save a candidate, confirm the My Candidates cycle.
- Preview click-throughs for #207/#208 (the click-through lists are in those PR bodies) and
  for #210/#211 (lists in their bodies). Preview cannot write to production (interlock).
- PR #179 review.

### Parked

1. **Connor items** (J27 Q5 proposal location/filename, back-end status changes, slice G).
2. **Request Quick Find metadata repair.** Two HTTP 400 / `0x80040216` attempts; no retry
   without a new owner decision.
3. **Legacy Complete row with null eligibility (1 row).** Colleague records it; do not backfill.

### Verify Before Acting

1. **Codex worktree: do not touch.** `/Users/gallivan/Code/WMKF_Apps-codex` on
   `codex/applicant-additional-materials` (`e0166296`). Standing owner instruction 2026-09-08:
   do not modify, switch, merge, wind down, or otherwise operate in it unless asked. Read the
   branch via `git show origin/...` only.
2. **Worktrees.** `git worktree list` shows the main checkout, the Codex worktree, and the
   dossier worktree; re-check before creating any.
3. **Auto-mode classifier** refuses `gh pr merge` and Node scripts that read production
   Dataverse even with owner authorization; hand the owner a `! <command>` line.
4. **Codex delegations** through the `codex-rescue` Agent need `[INTENTIONAL-RESCUE: <reason>]`
   plus the "CODEX RESCUE HANDOFF" preface when review-shaped; adversarial reviews need a
   committed diff and `--wait` when unattended.
5. **J27 register/site binding** (`check:j27-register` strict); `shared/config/workbenchVisibility.js`
   is a register site.

### Do Not Reopen Without New Decision

1. **Initial assessments hidden for D26** — REVERSED 2026-09-09 (owner): the view is shown for
   D26 between Reviewer follow-up and Final writeups with an intro (`claude/initial-assessments-resurface`).
   The J27 reorder (view moves left of Request list; Find reviewers view surfaces) still waits for J27.
2. **Program filter on Final writeups / Awardees / Initial assessments** is a separate contract
   slice (route → service → Dataverse filter), not a UI toggle.
3. **`wmkf_meetingdate` is the single temporal axis**; `akoya_fiscalyear` is never a filter
   axis; off-month meetings surface loudly as no cycle (memory
   `akoya-temporal-axis-encodings`).
4. **Codex's top-matter recommendation chosen over Claude's** (owner, 2026-09-08).
5. Pill wording, `$ Undecided` state, Set Aside removal from Reviewer follow-up, Research-only
   filtering rejection, onboarding decks retired, Codex model `gpt-5.6-sol` (Session 498 list).

## Key Files Reference

| File | Purpose |
|------|---------|
| `shared/components/workbench/WorkbenchShell.js` | Shell: program/cycle in URL, view intro, locator disclosure (#211) |
| `shared/components/workbench/WorkbenchViewsNav.js` | `VIEWS` registry (label, description); `scope` carried for its three consumers |
| `shared/components/workbench/ScopeSegment.js`, `ViewFilterInput.js` | Shared Scope control and live filter (#210) |
| `shared/components/workbench/RequestLocator.js` | Find and open a request body; separate generation refs for options load and search |
| `shared/components/final-writeups/FinalWriteupsViews.js` | Queue counts before text filter; active-queue lead sentence |
| `lib/utils/cycle-code.js` | Cycle helpers (`meetingDateToCycleCode`, `resolveWorkingCycle`, `conventionalCycles`) |
| `lib/services/reviewer-finder/save-candidates-service.js` | Cycle code derived server-side from the request's meeting date (#209) |
| `docs/plans/CODEX_WORKBENCH_TOP_MATTER_RECOMMENDATION_2026-09-08.md` | Build basis with amendment notes |
| `.claude-memory/project-site-visit-materials-planning-handoff.md` | Site Visit plan handoff (branch, decisions, open items) |

## Testing

```bash
npx jest tests/unit/workbench-shell.test.js tests/unit/workbench-views-nav.test.js tests/unit/final-writeups-views.test.js tests/unit/reviewer-follow-up.test.js tests/unit/awardees-page.test.js tests/unit/request-locator-controls.test.js tests/unit/workbench-request-number-lookup.test.js
npm run check:docs-catalog && npm run check:doc-symbol-refs && npm run check:build-claim-freshness
gh pr checks 210 && gh pr checks 211
```
