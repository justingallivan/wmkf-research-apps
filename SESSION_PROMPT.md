# Session 685 Prompt: Proposal lists live; prove a PDF and two-level sections on a real test request

## Session 684 Summary — 2026-11-18/19 (Claude)

### What Was Completed

1. **Proposal list pages shipped to Production.** Each Program Chair or Board
   member gets a personal no-login link to a page listing every submitted proposal
   in the cycle (title, institution, PI), grouped under collapsed section headings,
   each title opening the staff-version PDF. Staff create, highlight, and switch off
   lists at `/proposal-lists`. Owner applied migrations 101 and 102 to the Production
   database and set `PROPOSAL_LIST_SCHEMA_READY=on` in Production.
2. **Sections come from the intake keyword.** Connor confirmed the Keywords table
   columns; owner accepted request 1003526 as the guide. The section is the
   discipline branch (for example Life Sciences) and the subsection is the discipline
   group (for example Molecular and Cellular Biology) of the keyword in the request's
   `wmkf_programareaserved` lookup. Requests without a discipline keyword fall under
   "Unassigned", sorted last.
3. **First Production run, driven in the owner's Chrome on a J27 test list**
   (one proposal, test request 1003518). Verified: staff page loads; list creation
   (including the keyword read); recipient page loads without cookies; a highlight
   moves the proposal to the top; switch-off disables the link immediately. Three
   defects found and fixed in the same session: raw JSON shown when a staff version
   is missing (now a readable "Proposal not available" page), an empty "All other
   proposals" heading, and a missing staff page title. The test list is switched off;
   J27 has no lists.
4. **Recipients confirmed by the owner.** Program Chairs are Edward M. Stolper and
   James S. Economou; Andrea M. Ghez and Kelsey C. Martin are Board members. All four
   are selectable on the staff page, so the planned roster "chair marker" is not
   needed to send.
5. **Historical roster location at stop.** The roster was then the Postgres table
   `expertise_roster`, visible on the Roster tab of `/expertise-finder`. At that stop it had not
   moved to Dataverse. November 19 execution has since completed the production Dataverse migration
   and Admin editor cutover (see below).

### Commits (all on `main`)

- `ec077d3fa`: merge slice 1 (pages, migration 101, flag off).
- `d05e73fb5`, `8adaef02e`, `c6f3e4caa`, `dceef11e4`: keyword probes and keyword
  sections (migration 102).
- `213559d95`, `cbee390fa`: first-run fixes.
- `91dd0ebaa`, `50b17ec7d`, `83f6545f9`: plan and Atlas updates.

### Verification

- 72 scoped gates and self-tests passed before each merge; unit suites for the
  snapshot, store, link, page, route and view passed.
- Vercel deployments for each push succeeded. The E2E (Playwright) workflow failed
  on each of the last 14 `main` runs, back to `1037d2dbd` on 2026-11-16, before
  this work (`distribution-defaults-navigation.spec.js`,
  `workbench-responsiveness.spec.js` seen); not investigated.

## Next Items

### Expertise Finder retirement in progress

Owner subsequently authorized standalone retirement and confirmed matching history
need not be retained. Work is on `codex/expertise-finder-retirement-2026-11-19`.
See `docs/plans/EXPERTISE_FINDER_RETIREMENT_2026-11-19.md` for release/cleanup status.
Admin roster and shared consumers remain; Connor backend automation is separate.

### Verified Open

1. **Prove a staff-version PDF opens and the two-level sections render, live.**
   Evidence: `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md` (first
   Production run). Request 1003518 has no staff version and no J27 test request has
   a keyword, so only "Unassigned" has been seen in Production. Needs a J27 test
   request carrying both, from Connor's intake flow or by marking 1003526 as a J27
   test request. Owner-supplied; do not create a list for a real Board member to
   test this.

### Owner Decision Needed

1. Whether the app should send the email, and from whom (`DYNAMICS_IMPERSONATION_ENABLED`
   and "send as" in Production undetermined). Pasting the link into the owner's own
   email works today. Send with preview is not built.
2. Where a menu link to `/proposal-lists` belongs (none exists; reached by URL).
3. Whether to drop the roster chair marker (recommended: not needed).
4. Whether the staff page should remember the list-type picker across reloads.
5. Confirm the staff-version contents on a real J27 proposal after December 7.

### Parked

1. **Pre-filling Board-expert highlights from expertise matching.** Depends on the
   parked expertise integration; ticking highlights by hand works today.
2. **Staff view of which proposals lack a staff version.** Not built; no owner ask yet.
3. **Staff note on a list.** Tabled by the owner 2026-11-18.
4. **Expertise backend automation.** Separate later step after the production-only
   roster migration and Admin editor. Owner requested the revised migration plan and
   Claude Opus 5.5 OAuth adversarial review on November 19; see
   `docs/plans/EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md`.
   Opus 5.5 OAuth review returned READY WITH CHANGES; required corrections are
   incorporated, with verbatim review/disposition saved beside the plan. Build is committed on `codex/expertise-roster-admin-2026-11-19` (`40588fca3`);
   Opus implementation review and correction verification completed. Production import, migrations 103/104 and the Dataverse-backed Admin editor are complete. Amy ID 40 remains active and lead-PD eligible with her existing profile and future email preserved; no app access was granted and nothing was sent. See `docs/plans/EXPERTISE_ROSTER_PRODUCTION_EXECUTION_2026-11-19.md`.
   See `docs/plans/EXPERTISE_ROSTER_BUILD_2026-11-19.md`.
5. **Earlier roster implementation reference.** Preserve
   `origin/codex/expertise-roster-import-2026-11-10` (tip `754acf09a`). Current owner authorized the revised build and production migration/deployment. The older branch remains a reference; use the completed November 19 execution report, not that branch.
6. **Backend prompt adoption/scheduling** (`codex/executive-summary-generation-2026-11-16`).

### Owner Decisions Preserved — Not Resolved This Session

- Recommendation to Chairs Production stages and paid automatic Integrity Screen:
  each needs its own owner go; do not enable `AUTOMATIC_INTEGRITY_SCREENING`.
- Intake prompt choices in the J27 workbook field map; Connor notification about v2
  prompts and missing-PI handling not confirmed sent.
- Feb 24 Grants Manager Phase II Status versus Request Status decision (D39).
- minimatch alert #144 / dependency-upgrade decision and optional Node-version pin:
  recheck current alerts before planning.

### Verify Before Acting

- Merged branches `claude/proposal-list-pages`, `claude/proposal-list-keyword-sections`
  and `claude/proposal-list-first-run-fixes`, and the worktree
  `/Users/gallivan/Code/WMKF_Apps-claude-2026-11-18`, still exist. Deleting them
  needs the owner's go and the preservation preflight in
  `docs/PARALLEL_AGENT_WORKTREE_RUNBOOK.md`.
- E2E (Playwright) is red on `main` from before this session. Confirm the cause
  before attributing it to any stream.
- Initial Assessment (Session 683, PRs #644–#646) is Production-live but an
  authenticated save rehearsal was not run.
- Request 1003528's status in older handoffs is stale; do not infer it or reset it.
- Owner explicitly requested discarding untracked `commit-times-exact.txt` during November 19 startup; discarded. No preservation action remains.
- Older carryover (Chairs Stage 1, trial batch-2 expiry, real-proposal prompt
  review, Dependabot/branch hygiene) is at `git show 8f5c23fc8:SESSION_PROMPT.md`.

### Do Not Reopen Without New Decision

- Proposal lists, owner decisions of 2026-11-18: one link per person; everyone can
  open every proposal; sections collapsed with no per-chair personalization;
  highlights only at the top; own institution flagged; links last until the Board
  meeting; the list is a frozen snapshot; staff version only.
- Do not replace Connor's proposal-processing flow or add a second Claude matching
  call; do not migrate all Postgres data as a consequence of that discussion.
- Preserve the owner's simplified roster cutover decision if that stream resumes.
- Factory auto-prepare target remains Invited plus Phase II Pending Committee Review.

## Concurrent Workstreams and Preservation

The Session 683 (Codex) handoff is retrievable with
`git show 108cba441:SESSION_PROMPT.md`. Historical paths and observations are not
current permission or live-state evidence.

| Stream | Owning reference | Latest recorded boundary |
|---|---|---|
| Proposal lists | `docs/plans/J27_PROPOSAL_LIST_EMAILS_PLAN_2026-11-18.md`; `docs/atlas/postgres-proposal-list-links.md` | Production-live; PDF open and two-level sections unproven live; email send not built |
| Initial Assessment | PRs #644–#646; `assessment-service.js`, `AssessmentForm.js` | Production-live; authenticated save acceptance unverified |
| Roster migration and Admin editor | `docs/plans/EXPERTISE_ROSTER_PRODUCTION_MIGRATION_PLAN_2026-11-19.md` | Production-only plan saved; Opus 5.5 reviewed, corrections incorporated; Admin editor and migration implemented/tested on the new November 19 branch; Opus correction verification returned code ready; backend automation and retirement separate; production cutover complete: migrations 103/104, backend dataverse, 39 imported profiles and 10 exact Contact links; Amy active/lead eligible, no app access or sends; test profile retained inactive; Connor connection/effective-rights follow-up separate |
| Older roster cutover | `origin/codex/expertise-roster-import-2026-11-10:SESSION_PROMPT.md` | Preserve branch/private inputs; reconcile direction before resuming |
| Chairs Production stages | `docs/plans/J27_CHAIRS_RECOMMENDATION_PRODUCTION_PLAN_2026-11-18.md` | Not changed here; owner approval per stage |
| Intake prompt delivery | `docs/plans/PA_PROMPT_DELIVERY_HANDOFF_2026-11-16.md` | Owner-run flow/prompt work; backend adoption parked |

Production access requires explicit owner authorization. The November 19 roster go-ahead authorizes scoped production reads/writes with the interlock and dated ACK; it does not authorize unrelated work. Never read main `.env.local`.
Prior private roster inputs remain in owner-managed storage; do not commit them.
Local containers use Colima, not Docker Desktop. Migration numbers 097 and 100 are
claimed off `main`.

## Key Files Reference

| File | Purpose |
|---|---|
| `lib/services/proposal-lists/list-snapshot-service.js` | Cycle snapshot; section and subsection from the keyword |
| `lib/services/proposal-lists/list-link-service.js` | Create, highlight, switch off; who may receive a list |
| `lib/services/proposal-lists/list-page-service.js` | Recipient page model (sections, groups, highlights) |
| `pages/external/proposal-list/[token].js` | Recipient page |
| `pages/api/external/proposal-list/[token]/document.js` | Staff-version PDF; readable refusal page |
| `shared/components/proposal-lists/ProposalLists.js` | Staff page at `/proposal-lists` |
| `scripts/probe-proposal-list-schema.mjs` | Read-only check that migrations 101/102 are in place |
| `scripts/probe-keyword-taxonomy.cjs`, `scripts/probe-request-keywords.cjs` | Owner-run Production keyword probes |

## Testing and Session Close

```bash
npx jest --runInBand --silent --testPathPatterns='tests/unit/proposal-list'
node scripts/probe-proposal-list-schema.mjs
```

Milestone determination: **entry required and added** to DEVELOPMENT_LOG.md,
"Proposal list pages for Chairs and Board members" (Session 684).
CLAUDE.md needs no change. Claim-evidence pilot report ran with `--current`: no
eligible edit recorded, so no observation row was added. No memory router edits.
