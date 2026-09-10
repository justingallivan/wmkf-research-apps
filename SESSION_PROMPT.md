# Session 502 Prompt: Review Codex's release-reason branch; brief Codex on tracker slices 1–2; check the new rail in production

> Session 501 ran on the office Mac (2026-09-09, daytime) after the short owner-side
> Session 500 on the home Mac that morning. Everything below is on `main` at `14b2ba2e`
> or later. Start with `/start`; the Codex branch review is the first real task.

## Session 501 Summary (Claude Fable orchestrating; Sonnet built, Opus reviewed; Codex on its own brief)

Owner-present throughout. The office checkout began 921 commits behind (last pulled
2026-08-20) and was fast-forwarded first; nothing from the stale Session 451 prompt was
carried forward.

### What Was Completed

1. **Housekeeping and the orphaned worktrees.** Five local worktrees were merged or
   superseded and removed; one (`codex/sharepoint-retention-policy`, three Claude commits
   from 2026-08-13) held S425 SharePoint durability findings never on `main`. Ported into
   `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` and `project-sharepoint-integration` memory
   (`07f2aaea`): IT's Edit-level attestation and the four-flag observation, the 93-day
   recovery window facts, the owner's ruling that Purview is not a compliance question,
   Diligent as the Board system of record (context only; copy-the-bytes stands), the
   inheritance traps, and a requirement-by-requirement status line. Branch deleted.
2. **Workbench fixes from the owner's click-throughs.** J27-037 register excerpt
   (`7b974a2a`); Request list metrics say "N have sufficient review coverage", not
   "complete", because Done means three completed reviews, not every accepted reviewer
   (`ccc3dcce`, helper `describeStageCounts` with a test); program/cycle controls
   top-aligned (`79ff4903`).
3. **Staff deliberations cycle view; Initial assessments re-hidden.** PR #213 briefly
   unhid Initial assessments for D26 (wrong artifact — it lists pilot rows). PR #214
   (`2ebc7a71`) added the `staff-deliberations` view (Pre Site Visit drafts, cycle-wide;
   route `GET /api/workbench/staff-deliberations`; service
   `lib/services/pre-site-visit/cycle-list-service.js`) between Reviewer follow-up and
   Final writeups and re-hid Initial assessments for D26. Lesson recorded in
   `project-j27-doc-capture-evolution`.
4. **Every advancing D26 request now has an AI pre-site draft.** Owner decision: "AI draft
   ready" is the starting state for all 23. Owner-run scripts (PR #215, `a3bda092`):
   `probe-pre-site-draft-census.mjs`, `probe-pre-site-generation-preflight.mjs` (uses the
   producer's own input loader), `generate-pre-site-drafts-cycle.mjs` (same producer as the
   Workbench button, sequential, unattributed, idempotent). Result
   `outputs/pre-site-drafts-D26.json`: 21 generated, 2 reused, 0 errors, 32 min, ~90 s each.
   1002788 is the test request and was excluded.
5. **Registry version defect fixed at source and in data.** `GraphService.uploadFile`
   returned a content tag (`"c:{GUID},N"`) as the version whenever the upload response
   lacked a publication facet (always). Now reads the item back by stable id (PR #215).
   `backfill-request-document-versions.mjs` repaired 5 rows (witness: publication version
   still `1.0`; the eTag was NOT a valid witness — Graph bumps it for metadata touches);
   3 edited July/August test rows left as reported (`e7c0eb27`).
6. **Synthesis blockers named; unanswered invitations visible.** Request 1002959 had four
   reviews in but one invited-never-accepted reviewer blocked synthesis and was visible
   only on Invite Reviewers. PR #216 (`1ddc870c`): `reviewSynthesisState.blockers` (name,
   reason, invitation date) rendered on the Reviews tab; Track Reviewers shows a trailing
   "invited, awaiting response" group with a jump to Invite, counted in the badge. The
   owner resolved 1002959 with **Release invitee** (recorded `withdrawn_sufficient`),
   which led to item 7.
7. **Codex brief: release reason** (`75922955`,
   `docs/plans/REVIEWER_RELEASE_REASON_CODEX_BRIEF_2026-09-09.md`). Release records why —
   `no_longer_needed` (today) or `no_response` — using the two existing response types;
   finding: the portal locks only on `withdrawn_sufficient` and the token chokepoint never
   reads the response type, so a PD-recorded `no_response` must revoke the token in the
   same ETag-guarded write. Codex built it on `codex/reviewer-release-reason` (see Next
   Items 1). Also added `probe-review-synthesis-blockers.mjs`.
8. **PC Meeting Tracker planned** (`docs/PC_MEETING_TRACKER_PLAN.md`, `c5f04ecb`,
   `f74ec40c`, queue row 9). Two meetings per proposal — a weekly internal deliberation
   session (staff + select Board, ~15 min per proposal, linked document/reviews/proposal)
   and the PC-scheduled site visit. Owner decisions D1–D9: own app (grant means edit,
   org-open posture); site visits stay on the `wmkf_sitevisit` Activity with the tracker
   as its editor; deliberation sessions are a new table with ordered slots, no uniqueness
   on request, rail reads the latest slot; "Shared" = locked; labels admin-editable behind
   stable keys; visited is date-derived, no confirmation, no Word signal; every advancing
   D26 request is visited (J27 will allow reviewed-but-not-visited behind `visitExpected`).
   Supersedes in part the 2026-08-28 removal of scheduling from the Workbench and the
   Codex materials plan's scheduling exclusion.
9. **Tracker slice 0** (PR #217, `7e06e4a1`): `saveSiteVisitLogistics` gates writes on an
   advancing request in a cycle with a meeting date (`isVisibleRequestRow`, the Request
   list's predicate, row-level) instead of the draft being in Review; reads are not gated.
   Sonnet built, Opus reviewed (5 required + 3 recommended applied).
10. **Tracker slice 3** (PR #218, `14b2ba2e`): `shared/utils/deliberation-stage.js` derives
    `draft | shared | visit | final` (+ explicit `beyond`); labels from four editable-text
    entries (`stage.deliberations.*`) read once per 60 s via
    `lib/services/deliberation-stage-labels.js`, delivered on the two existing GETs;
    `DeliberationStageRail` shared by the tab (header now "Staff Deliberations", site visit
    loaded for every request, "Continue in Final Writeup →" link, no second write path) and
    the cycle view (visit dates joined via `site-visit.js::findActiveByRequests`, sent state
    via `distribution-store.js::sentSourceDocumentIds`, `scope=my|all`, grouped by stage with
    a lead line). Sonnet built, Opus reviewed (8 required + 4 optional applied). Full suite
    11,403 tests green.

### Commits (all on `main`)

`d0b81a26` plugin · `07f2aaea` SharePoint port · `7b974a2a` J27-037 · `ccc3dcce` coverage
wording · `79ff4903` control alignment · `5fe867f6` PR #213 · `2ebc7a71` PR #214 ·
`a3bda092` PR #215 · `1ddc870c` PR #216 · `75922955` Codex brief · `e7c0eb27` backfill rule ·
`c5f04ecb`/`f74ec40c`/`936b6a55` tracker plan and decisions · `7e06e4a1` PR #217 ·
`14b2ba2e` PR #218.

Milestone determination: `DEVELOPMENT_LOG.md` entry added ("Every D26 proposal starts at
AI draft ready; the Staff Deliberations rail is keyed and admin-labeled; PC Meeting Tracker
planned").

## Next Items

### Verified Open

1. **Review Codex's `codex/reviewer-release-reason` branch, then the owner merges.**
   Evidence: `origin/codex/reviewer-release-reason` at `f69f2070`+ (≈31 commits, pushed,
   worktree clean, handoff filled in the brief on that branch); no PR. It is based on
   `a3bda092` and does NOT contain today's `main` — merge `main` in before a PR. It went
   outside the brief's owned surface into `regenerate-token-service.js` + route,
   `reviewer-suggestion.js` adapter, `reviewers-service.js`, `ReviewerManagePanel.js`,
   `ReviewersTab.js`, `TokenActionsMenu.js` for a "terminal token-regeneration guard"
   (regenerating a link for a released/no-response row would have reactivated it). Real
   gap, deliberately out of surface — review it on its merits, do not rubber-stamp. Run the
   review (Opus or Fable) against the diff from the merge-base; the owner merges.
2. **Post-merge production check of PR #218.** Evidence: PR body click-through. Any D26
   request → Staff Deliberations header and four-stop rail; 1002379 (only recorded visit)
   shows its date; Workbench → Staff deliberations shows Scope, lead line, grouped cards;
   Admin → email defaults has four "Deliberations stage label" entries and a rename shows
   in both surfaces within a minute.
3. **Tracker slices 1–2 → Codex brief.** Evidence: plan §5.2, §5.3, §7. Schema wave
   (`wmkf_deliberationsession`, `wmkf_deliberationslot`, `new-entity`), Atlas pages,
   readiness flag, sandbox apply; the app (registry key placeholder `meeting-tracker`),
   list/session/visit pages, site-visit editor via the existing logistics service. Needs
   the three decisions below first. Write the brief in the same shape as the release-reason
   brief; Codex creates its own worktree from `origin/main`.
4. **Site Visit Materials plan review (read-only)** — still open from the 2026-09-09 owner
   brief; not done today. Evidence: `docs/plans/OWNER_BRIEF_2026-09-09.md` §3;
   `git show origin/codex/applicant-additional-materials:docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md`.
   Note the tracker plan now supplies the "already scheduled Site Visit" that plan assumes.
5. **Closeout route generic 500** — unchanged since Session 498. Evidence:
   `pages/api/review-manager/close-review.js:64-71`.
6. **Reconcile Codex's three reviewer UI commits from `codex/UI-audit`** — unchanged.
7. **Cycle Dossier reconciliation** — blocked on the roster-scope decision (PR #179 open).

### Owner Decision Needed

1. **Tracker:** default deliberation-session attendees (fixed staff list + per-session
   Board, or per-session only); session page opens the review bundle directly or links to
   each request's tabs; the app's key and name. Evidence: plan §9.
2. **Release reason:** whether a PD-recorded `no_response` should visibly lower a
   reviewer's standing anywhere (plan says: negative-leaning in the terminal-status plan
   text only; no score, no badge). Evidence: Codex brief "Decisions that are the owner's".
3. **Carried from Session 500:** Program select on Final writeups/Awardees (live with note
   vs read-only); historic suggestion rows with stale cycle codes; dossier roster scope;
   Codex branches to abandon (`codex/UI-audit`, `codex/reviewer-ui-surfacing`,
   `codex/c0-4-action-policy-foundation`, `codex/ror-api-production-shadow`); Site Visit
   plan §12 items; combined dossier retention; PD front-end flip to Phase II Pending.
4. **Distribution email and logistics copy edits** — owner: "noting for later".

### Parked

1. Connor items (J27 Q5, back-end status changes, slice G). 2. Request Quick Find metadata
repair (no retry without a new decision). 3. Legacy Complete row with null eligibility.
4. `NEXTAUTH_SECRET` rotation; multipart direct-upload conversion; Stage III institution
identity authority (from the Session 451-era list, still parked).

### Verify Before Acting

1. **Codex worktree `../WMKF_Apps-codex` on `codex/reviewer-release-reason`: do not
   operate in it** (standing instruction). Read the branch via `git show origin/...`.
2. **Production Dataverse reads and writes are owner-run.** Never set
   `DATAVERSE_ALLOW_PROD_READS` or `DATAVERSE_PROD_WRITE_ACK` yourself; hand over the
   `! <command>` line. Today's batch and backfill followed this.
3. **`visitExpected()` in `shared/utils/deliberation-stage.js` is the single D26
   assumption** (every advancing request is visited). J27 changes it there; add a J27
   register row when it does.
4. **Three merged remote branches still exist** (`claude/pending-invites-visible`,
   `claude/site-visit-schedulable-gate`, `claude/deliberations-stage-rail`); delete with
   `git push origin --delete …` whenever. Nothing depends on them.
5. **The `check:agent-wiki` gate fails inside fresh worktrees** because the per-machine
   `.agents/skills` symlink is absent there; it passes in the primary checkout. Not a
   code failure.
6. **J27 source contract** (`AI Materials/ProposalNarrative_{Request#}.pdf`) and the
   auto-generation trigger may both change — register J27-082. Do not reuse
   `generate-pre-site-drafts-cycle.mjs` for J27 without that decision.

### Do Not Reopen Without New Decision

1. **Initial assessments hidden for D26** (owner 2026-09-05; briefly unhidden and re-hidden
   2026-09-09; for D26 it lists only pilot rows). Pre-site drafts live under Staff
   deliberations. J27 reorder (view moves left of Request list; a Find reviewers view
   surfaces) waits for J27.
2. **Tracker decisions D1–D9** (plan §2): own app; grant means edit; Activity stays;
   sessions squishy; Shared = locked; labels not load-bearing; visited date-derived; every
   D26 request visited; no confirmation.
3. **Copy-the-bytes** Board snapshot stands; Diligent fact is context only.
4. **"Sufficient review coverage"** wording on the Request list (owner 2026-09-09); the
   Done stage still means three completed reviews.
5. Carried: `wmkf_meetingdate` is the single temporal axis; Codex top-matter recommendation
   chosen; Program filter on Final writeups/Awardees is a separate contract slice.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/PC_MEETING_TRACKER_PLAN.md` | Tracker plan, D1–D9, slices; §7 records slices 0 and 3 built |
| `shared/utils/deliberation-stage.js` | Stage derivation, stable keys, `visitExpected` |
| `lib/services/deliberation-stage-labels.js` | Cached admin-editable stage labels |
| `shared/components/workbench/DeliberationStageRail.js` | Rail shared by tab and cycle view |
| `shared/components/workbench/StaffDeliberationsTab.js` / `StaffDeliberationsPanel.js` | Per-request tab; cycle view |
| `lib/services/pre-site-visit/cycle-list-service.js` | Cycle rows with visit, sent state, scope, counts |
| `lib/services/site-visit/logistics-service.js` | Write gate `assertSchedulableRequest`; reads ungated |
| `shared/config/workbenchVisibility.js` | OData filter + row predicate `isVisibleRequestRow` |
| `scripts/generate-pre-site-drafts-cycle.mjs` (+ two probes, backfill) | Owner-run D26 draft batch tooling |
| `docs/plans/REVIEWER_RELEASE_REASON_CODEX_BRIEF_2026-09-09.md` | Codex brief; handoff on the Codex branch |
| `docs/DATAVERSE_SHAREPOINT_FILE_MODEL.md` | S425 durability findings ported |

## Testing

```bash
npx jest tests/unit/deliberation-stage.test.js tests/unit/deliberation-stage-labels.test.js tests/unit/staff-deliberations-tab.test.js tests/unit/pre-site-visit-cycle-list-service.test.js tests/unit/workbench-staff-deliberations-route.test.js tests/unit/site-visit-logistics-service.test.js tests/unit/workbench-visibility-row-predicate.test.js tests/unit/workbench-shell.test.js
npm run check:types && npm run check:api-routes && npm run check:j27-register
# Codex branch review (from main checkout, read-only):
git fetch origin && git diff $(git merge-base origin/main origin/codex/reviewer-release-reason)..origin/codex/reviewer-release-reason --stat
```
