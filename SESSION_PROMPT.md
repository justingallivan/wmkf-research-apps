# Session 673 Prompt: Three open streams — J27 cycle page, expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked again on 2026-11-10
(Session 672); Streams B and C were not touched that day and are carried as
their authors wrote them on 2026-11-09. **Find out which stream the owner wants
before doing anything; if he does not say, ask.** Then read that stream's
section and the document it names. The other two streams are not yours to
change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 cycle page and request page** | Claude, Session 672 (2026-11-10) | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, checked out on `claude/j27-cycle-page` at `0bfca223d`, pushed. `claude/j27-read-model` (the sandbox Preview branch) is at `393da5dde`, two documentation commits behind | Stream A below; alignment log D53 to D61 on the branch | Give the sandbox test requests J27-shaped files (Stream A, Verified Open 1) |
| **B. Expertise roster** | Codex, Session 670 | `codex/expertise-roster-foundation-2026-11-09` at `1aedcb25d`, pushed (unverified work in progress; last verified foundation `d2b467e84`). Recorded worktree `/private/tmp/wmkf-codex-isolated-start-2026-11-09` | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`, which is the authoritative resume boundary | Review and test the work in progress before extending it |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed and verified. Recorded worktree `/private/tmp/wmkf-request-narratives` | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |

All four branch tips were confirmed on the remote at the close of Session 672
`[VERIFIED via git ls-remote, 2026-11-10]`. Everything else in Streams B and C
is copied from Codex's own handoffs and was not re-checked.

**Session numbers.** Sessions 669 (Request narratives), 670 (roster) and 671
(J27 cycle page) overlapped on 2026-11-09. Session 672 was Stream A on
2026-11-10. The next session is 673 whichever stream it takes. Earlier
handoffs: `git show b2c271344:SESSION_PROMPT.md` (the three-stream prompt as
Session 671 left it), `git show 7b7e483b0:SESSION_PROMPT.md` (Request
narratives), `git show 5782bad43:SESSION_PROMPT.md` (roster),
`git show f03936e3e:SESSION_PROMPT.md` (Session 668).

**Where the streams meet.** Stream C's Overview card must be reviewed against
Stream A's J27 line before any runtime promotion (Stream C, Verified Open 2).
Streams A and C both carry the same inherited J27 owner decisions; Stream A's
list is the current wording. Stream A changed the Expertise Finder batch match
(a file name only); Stream B's roster work should be checked against it when
either is merged. The Test Request Factory (a Codex branch) still names its
J27 scenarios with the retired terms and writes last cycle's file layout
(Stream A, Verified Open 1 and Verify Before Acting 6).

## Rules for every stream

1. **Nothing is promoted.** All three streams' runtime work is on feature
   branches. `main` deploys to Production on push; only documentation lands
   there without the owner's explicit go.
2. **Worktrees under `/private/tmp` are volatile.** If one is gone, the pushed
   branch is the source; do not recreate another agent's local-only data.
3. **Local runs read Production.** `.env.local` in the main checkout (linked
   from the J27 worktree) points at production Dataverse and the Production
   Postgres database. Do not start the app locally to check something "against
   the sandbox". Production reads are owner-run: hand him the command.
4. **Sandbox Preview.** Only `claude/j27-read-model` has the branch-scoped
   sandbox `DYNAMICS_URL`, and since 2026-11-10 its own Postgres database (a
   Neon branch; Stream A, What Was Completed 6). Staff sign-in works only
   through `wmkfresearchapps-preview.vercel.app`, the owner signs in himself
   and repoints that alias himself, and it pointed at
   `wmkfresearchapps-ksb8kwki6-justin-gallivans-projects.vercel.app` when
   Session 672 closed. Check with `vercel inspect` before assuming.
5. **Preserve:** sandbox fixtures 1000368 to 1000387; the untracked
   `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` in the main
   checkout; the uncommitted `package-lock.json` in the J27 worktree; every
   other stream's branches, worktrees and settings.

## Stream A — J27 cycle page and request page (Claude, Session 672)

Session 672 fixed the "could not be read" message, did the request-page
wording from the staff flow audit, and rebuilt the J27 Proposal section and
file readers around the file names and folders Connor gave the owner that day.
Documentation landed on `main`; runtime work is on the J27 line and is **not
promoted**. Session 671's summary (the cycle page itself) is in
`git show b2c271344:SESSION_PROMPT.md`.

#### What Was Completed

1. **"Some details could not be read." traced and fixed.** Two causes.
   (a) Memo fields whose schema wave is switched off were reported as failed
   reads; they now read `not-provisioned`, which marks nothing (`e287e1bec`).
   (b) The integrity read needs the table from migration 096, which exists only
   on the J27 line; the Preview was using the shared Production database, which
   lacks it. Fixed by giving the Preview its own database (item 6). The two
   batch reads now log their error instead of swallowing it (`393da5dde`).
   Seen gone on the Preview in the browser.
2. **Request-page wording (owner decisions, 2026-11-10; staff flow audit
   section 3 on `main` has the full list).** "Status" for "Phase I status";
   the document is "Draft Writeup" and becomes the "Final Writeup"; "visit"
   became "presentation"; the roster sub-tab is "Reviewers", not "Panel"; the
   Peer Review chip reads "Invite reviewers"; a read-only Scoring card says
   who can record it; the coordinator-attention line links to the meeting
   record; two messages name the tab the layout actually has.
3. **Stage strip and list agree.** The strip uses the cycle list's next-step
   rule ("Awaiting the Chairs' outcome"), and "Nothing is waiting on staff
   right now." appears on the strip only when every fact has loaded and on a
   list row only when no read failed. A failed read is said once above the
   list (`562a094a6`, `d30005fba`).
4. **J27 file layout (Connor, via the owner; alignment log D57 to D61 on the
   branch; `docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md` on the branch).**
   - Individual files live in `Submission-Documents`: `Project-Narrative_`,
     `Bibliography_`, `Biosketches_`, `Other-Support_`,
     `Collaboration-Letters_` (each `{Request#}.pdf`) and
     `Graphical-Abstract_{Request#}.jpg`. `[VERIFIED via owner-run read-only
     listing of Production test request 1003384, 2026-11-10]`
   - Staff version: `{AKA}_Staff-Version_{Request#}.pdf` at the request root
     (dash, PDF). Not yet seen on a real request.
   - Reviewer Finder input: `AI Materials/Narrative-Bibliography_{Request#}.pdf`,
     built by Connor's flow; not yet created. Derived files go in
     `AI Materials`; `Submission-Documents` holds originals only.
   - No `Phase II` folder is expected; later budget detail goes in Dataverse,
     fields to be decided.
5. **Built for that layout, for J27 and every later cycle** (rule keyed on the
   cycle code being J27 or later, or on the file being present; earlier cycles
   unchanged):
   - Proposal section: staff version first, then Reviewer Materials, then a
     collapsed "Individual files" list; "not received yet" for a missing file;
     no "Phase I documents" group; "Phase II documents" only when that folder
     holds a file (`3e3c7e80f`, `17e9de95d`, `5f886b51a`).
   - The governed narrative and bibliography readers (Initial Assessment,
     Field Primer, Pre-Site draft, AI Review Panel, cycle dossier) also accept
     the J27 names in `Submission-Documents`; exactly one copy across the
     accepted places or the read fails closed (`ebb38322b`).
   - Reviewer Finder loads the Narrative-Bibliography file by default when a
     request has exactly one (`f43f2db77`). The owner was offered two defaults
     and did not choose; the recommended one was built.
   - Expertise Finder batch match accepts the J27 staff version name
     (`e300877b9`, `0dcd87f5c`).
6. **The J27 Preview has its own database.** Neon branch `j27-preview` of the
   Production database (project `expert-reviewers-neon-db`, auto-delete
   Never); `POSTGRES_URL` and `DATABASE_URL` scoped to Preview for
   `claude/j27-read-model`; migration 096 applied there (owner-run, "1
   applied, 94 skipped, 95 total"). Production does not have the J27 table.
   Recorded in the rollout plan on the branch, with the removal step.
7. **Decisions recorded with Connor (alignment log D53 to D56, D61).** The
   staff decisions before the Chairs meeting stay in Phase I Status, including
   Recommended Invite; no new staff state field; nothing existing reacts to
   those values. No "program at submission" field: the program goes in
   `akoya_programid`. Requested amount is `akoya_request`, total budget
   `akoya_expenses`. The files-ready flag is `wmkf_readyforreview`. The apps
   will not rerun or flag AI outputs when a submitted file is replaced.
8. **Sandbox fixture titles.** #1000382 to #1000385 renamed to drop "First
   Cut" and "Semi-finalist" (title only; sandbox write, read back).
9. **Preview walk-through in Chrome** (owner signed in; read only). The wording
   and layout changes were seen on #1000385 and #1000369.

Verification on the branch tip `0bfca223d`: full Jest run, 1,560 suites pass,
one fails (`tests/unit/reviewer-follow-up.test.js`, "announces the initial
loading state", failing before this session); 40 of 41 gates pass
(`check:agent-invariants` fails in that worktree only because its per-machine
memory link is missing). Gate self-tests were run in the morning (71 of 72)
but not after the later commits, except the J27 register's.

**Not exercised:** anything behind a save button on the Preview; the "Status"
label on an editable Scoring card; the new file readers against a request that
has both a staff version and `Submission-Documents` files. `/contract-reconcile`
was not run on the cross-layer file changes; the path was traced by hand.

#### Commits

`main` (docs): `a873a1940`, `844f3bf23`, `435a887ce`, `e1454f389`,
`f2774d2b1`, `f9e713073`, `e390e2f28`, `f66855d68`, plus this handoff.
J27 line, `026143d7b..0bfca223d` (25 commits): `e287e1bec`, `eaf8758f1`,
`562a094a6`, `0719afdf6`, `3e3c7e80f`, `89ab1e4ee`, `34ac78319`, `8e64d22e8`,
`b99f5ea29`, `00e26813d`, `17e9de95d`, `e300877b9`, `0dcd87f5c`, `5f886b51a`,
`ebb38322b`, `0af9c123c`, `f43f2db77`, `f4161adcd`, `128f0278e`, `686847fca`,
`6ed76cbf7`, `d30005fba`, `393da5dde`, `ea7d8448f`, `0bfca223d`.

### Next Items

#### Verified Open

1. **Give the sandbox test requests J27-shaped files.** On the Preview every
   J27 fixture shows the staff version and the six individual files as "not
   received yet", because `lib/services/test-requests/file-plan.js` writes
   `Phase I` and `AI Materials` files with last cycle's names. Quickest:
   upload `Submission-Documents` files and a staff version to a few existing
   fixtures in sandbox SharePoint (a sandbox write; get the owner's go).
   Durable: update the Factory's file plan, which belongs to the Factory
   stream on a Codex branch. Then rehearse the Initial Assessment on the new
   location.
2. **See the staff version name on a real request.** Once Connor's flow builds
   one on 1003384, an owner-run
   `DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-external-files.js 1003384`
   (main checkout) confirms `{AKA}_Staff-Version_1003384.pdf` at the root.
3. **Small app items seen on the Preview.** The Overview's next steps name a
   tab in plain text instead of linking to it (audit finding 10). A list row
   says "Nothing is waiting on staff right now." while the request page stays
   quiet until every fact loads (by design on each side; the owner was told
   and did not ask for a change). #1000370 shows "Invite reviewers" with
   "Next: Record Scored or Not Scored" (item Verify Before Acting 5).
4. **Reconcile the restatements at promotion.** The Atlas, the agent wiki and
   `.claude-memory/project-j27-doc-capture-evolution.md` describe the governed
   AI input as `AI Materials` only; that is true of Production. The memory
   note carries a pointer to the J27-line change. Run `/sweep` on the file
   contract when the J27 line merges.
5. **Deliberations and Final Assessment lists need their own plan** (build
   plan, section 3a; carried, not started).
6. **Promotion of the J27 line is an owner decision, not yet taken.** Path when
   taken: Tier 2 per `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md`
   (on the branch), which now requires migration 096 on the Production
   database first and lists the Preview database to remove.
7. **Records not yet written:** the cycle-page decision in the alignment log
   (redesign plan, section 10) and the agent wiki page
   `docs/agent-wiki/topics/workbench-shell-handoffs.md` for the new layout
   (carried).
8. **Final Assessment tab on the sandbox Preview** showed "Checking the writeup
   stage…" six seconds after loading on #1000369; Session 671 saw "Final
   writeup review tracking is unavailable until its Dataverse schema is
   verified." there. Not looked into.
9. **Contract-reconcile reviews not run:** the terminology rename (carried) and
   this session's file-layout changes.
10. Carried: deferred UI mirroring of the Offramped refusals (read-model plan
    §9 I6(a)); intake display and staff field contract with Connor.

#### Owner Decision Needed

1. **When Connor's J27 `AI Materials` folder arrives:** if it holds a
   `Project-Narrative_{Request#}.pdf` while one is still in
   `Submission-Documents`, the AI readers see two copies and stop. Decide
   which wins once its contents are known (alignment log D59).
2. **Reviewer Finder's J27 default** was built as "the Narrative-Bibliography
   file wins when present". The alternative (reviewer copy first) was offered
   and not chosen; confirm or change.
3. What is shared with colleagues and the Chairs before a research
   presentation (build plan decision 3; carried).
4. Whether Initial Assessment chips gain colour (carried).
5. Where the written offramp justification lives, and who sets Phase II status
   to Offramped (carried; with Connor and Sarah).
6. Who sets the status that opens reviewer invitations (carried).
7. Whether staff keep the original Scoring answer once a Recommendation to
   Chairs replaces the status (carried).
8. Whether the AI fit flag affects Flagged for concerns, remaining intake
   output formats and owners, staff queues, Chairs materials and calendar
   changes; the November 15 target needs reconfirmation (carried).
9. Which Dataverse fields hold the fuller budget information (D61: to be
   decided).

#### Waiting On Connor

1. **Reviewer copy flow.** The owner asked him on 2026-11-10 for a new Power
   Automate flow: when Phase I Status becomes Recommended Invite, copy the
   staff version to `Reviewer Materials/Proposal_{Request#}.pdf`. Keeping that
   name means the reviewer portal and Reviewer Finder need no change. The
   owner judged a reversed recommendation and a replaced staff version to be
   edge cases the flow need not handle. Suggested to him, unanswered: skip
   requests flagged `wmkf_istestrequest`.
2. The Narrative-Bibliography file and the J27 `AI Materials` contents.

#### Parked

1. The wide gap between request details and the status column on a large
   screen (owner, 2026-11-09: later).
2. Program Coordinator support in the Workbench. Tracked in
   `docs/CURRENT_WORK_QUEUE.md`.
3. Southern California as a separate app suite (D8). Re-open when the owner asks.
4. Research readiness readback after the December 8 readiness date.
5. Phase II, bulk edits, queues and packet exports; see the cycle plan.
6. Lockfile drift: uncommitted `package-lock.json` in the read-model worktree;
   hygiene only, left untouched.
7. Six older sandbox rehearsal requests (#1000368, #1000373 to #1000375 and
   others) still carry the retired terms in their titles; they belong to other
   streams' rehearsals and are not flagged as test requests. The owner was
   offered a rename and did not ask for it.

#### Verify Before Acting

1. **Preview alias.** `wmkfresearchapps-preview.vercel.app` pointed at
   `wmkfresearchapps-ksb8kwki6-justin-gallivans-projects.vercel.app` (built
   from `claude/j27-read-model` at `393da5dde`) when this session closed.
   Check with `vercel inspect` before assuming. The owner repoints it with
   `vercel alias set <deployment> wmkfresearchapps-preview.vercel.app`.
2. **Preview settings to remove when the J27 line is promoted or retired:**
   the branch-scoped `DYNAMICS_URL`, `POSTGRES_URL` and `DATABASE_URL` for
   `claude/j27-read-model`, and the Neon branch `j27-preview`. It is a copy of
   Production data taken 2026-11-10; treat its connection string as a
   Production secret. Its host begins `ep-aged-wave`; Production's begins
   `ep-frosty-credit`.
3. **Moving the Preview forward** is a fast-forward push of the cycle-page tip
   to `claude/j27-read-model`, then the owner repoints the alias. The owner
   approved it twice this session; ask again next time.
4. **Applying a migration with a pasted connection string.** The string
   contains `&`; pasted inline it split the command, and the script fell back
   to `.env.local` (Production) from the wrong directory. It applied nothing.
   Use `read -s POSTGRES_URL`, `export POSTGRES_URL`, print the host, then run
   `node scripts/apply-migrations.js` from the J27 worktree.
5. **#1000370's odd state is deliberate.** The rollout rehearsal uses it to
   confirm a request with reviews and no formal outcome is handled. Do not
   "correct" its Phase I status.
6. **The Test Request Factory still uses the retired scenario names**
   (`lib/services/test-requests/j27-sandbox-scenarios.js` on
   `codex/j27-factory-scenarios`). Rebuilt fixtures would get the old titles
   back. It checks only that a title starts with `TEST:`.
7. **Local runs read Production**, Dataverse and Postgres both.
8. **The colleague deck is out of date** (owner): do not start from
   https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj.
9. **Mock-up.** https://claude.ai/artifact/Fov94msvFQit3QZCzv4TZZ is a static
   mock-up with invented data; the built page is the reference.
10. **Codex's untracked brief** in the main checkout: preserve it.
11. **Memory on the branch.** `.claude-memory/project-vercel-cli-deploy-preview-auth.md`
    differs on the J27 line; it arrives with the merge.
12. Sandbox fixtures 1000368 to 1000387 stay; no deletion authorized.

#### Do Not Reopen Without New Decision

1. Tabs and order on the cycle page; reviewer progress on the Peer Review list
   only; unmapped Phase I statuses are closed; a Deliberations row shows no
   next-step line before its presentation (Session 671).
2. "First Cut" and "Semi-finalist" are retired, in text and in code. Steps are
   "Scoring" (Scored, Not Scored) and "Recommendation to Chairs" (Recommended
   Invite, Recommended Do Not Invite; shown on the strip as "Recommended to
   Chairs" and "Not Recommended"); then Invited or Not Invited.
3. Wording (owner, 2026-11-10): "Status"; "Draft Writeup" then "Final
   Writeup"; "presentation"; "Reviewers".
4. Staff decisions live in Phase I Status; no new staff state field; no
   "program at submission" field (D53, D54).
5. The apps do not rerun or flag AI outputs when a submitted file is replaced
   (D26, dropped 2026-11-10).
6. The J27 Proposal section does not show the cover page, abstract or
   graphical abstract page (D20).
7. D7 (offramp is `wmkf_phaseiistatus = 682090001`), D8 (the read model is
   Research-only), and scenario 7's sandbox status being observed, not asserted.

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` (branch) | Decisions D53 to D61 from 2026-11-10 |
| `docs/POWER_AUTOMATE_PROPOSAL_FILE_CONTRACT.md` (branch) | J27 file names and folders, and which reader uses which |
| `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` (branch) | Migration 096, the Preview database, removal steps |
| `docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md` (`main`) | Which audit findings are fixed and which are open |
| `shared/config/workbenchProposalDocuments.js` (branch) | Which cycles use the individual-files layout |
| `lib/services/workbench-proposal-documents.js` (branch) | Proposal section listing and the governed narrative and bibliography readers |
| `lib/services/reviewer-finder/load-proposal-service.js` (branch) | Reviewer Finder's default file |
| `lib/services/expertise-finder/batch-match-service.js` (branch) | Staff version lookup |
| `shared/utils/j27CycleRows.js`, `shared/config/j27Labels.js` (branch) | List row rules and every J27 label |
| `lib/services/workbench/j27-read-model-inputs.js` (branch) | `not-provisioned`, and the logged batch reads |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest --testPathPatterns "tests/unit/.*(workbench|proposal|j27)"
npx jest --findRelatedTests lib/services/workbench-proposal-documents.js
npx jest   # full run done at 0bfca223d: one pre-existing failure
```

No DEVELOPMENT_LOG entry was required: nothing reached Production.

## Stream B — Expertise roster (Codex, Session 670)

Copied from Codex's handoff at `5782bad43`; headings lowered one level, text
unchanged. Its references to "this session" mean Session 670.

Owner requested stop and a docs-only handoff on main. Roster runtime work remains on
`codex/expertise-roster-foundation-2026-11-09` at `1aedcb25d`, pushed. Its last verified
foundation is `d2b467e84`; the later service/editor changes are explicitly unverified.
Do not promote the feature branch. Detailed resume boundary, settled mappings, test
limits and local-only evidence: `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`.

The complete preceding Request-narratives handoff remains retrievable with
`git show 7b7e483b0:SESSION_PROMPT.md`; its durable details are also on main in
`docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md`. Those owner decisions and
release boundaries remain in force. This session did not resume those changes.

#### What Was Completed

- Roster plan/reviews, real read-only inventory, sandbox schema and synthetic
  identity/key/ETag/FK rollback rehearsal. No Production data or runtime cutover.
- Confirmed staff mapping and eligibility decisions, Amy staging, and TBD exclusion
  with preserved numeric history. Slot attendees correctly belong to parent sessions.
- Latest service/editor draft preserved in an explicitly marked WIP commit and pushed.
  No claim that this draft is tested, complete or ready for deployment.

#### Commits

Verified foundation: `7512c0fd6`, `e4e39b494`, `ad7c4a511`, `d2b467e84`.
Unverified checkpoint: `1aedcb25d`. Earlier plan/review commits are listed in the
roster handoff. All are on the feature branch, not promoted by this docs landing.

### Next Items

#### Verified Open

1. Review and test roster WIP before extending it. Build real import execution,
   then complete dependent runtime consumers and the editor. Evidence: checkpoint
   source and detailed roster handoff; importer remains planning-only.
2. Owner-reviewed minimal matching prompt contract and full isolated app rehearsal
   remain necessary before cutover. No expertise-content/scoring decision is needed
   to resume mechanics. See roster plan on feature branch.
3. Separate Request-narratives stream: external Power Automate initialization contract,
   J27 integration review, and approved staff save/readback remain open as recorded in
   its owning handoff. Recheck with that owner before acting; do not restart built code.

#### Owner Decision Needed

- Roster Production release is not authorized. Private local exports/receipts need
  an approved secure transfer/retention location if continuing on another Mac.
- Request-narratives release timing and test Request/environment remain owner decisions.
- Inherited J27 decisions (unchanged): offramp justification location and status owner,
  retention of First Cut answers, fit-flag meaning, intake outputs/owners, staff queues,
  Chairs materials and calendar changes. Recheck Claude's current alignment log.

#### Parked

SoCal separation; real J27 readiness readback after December 8; bulk edits, queues and
packet exports. Existing scope boundaries preserved, not newly authorized.

#### Verify Before Acting

- Roster local-only data and container paths are in the detailed handoff. Git does not
  transfer them. No real data was imported into sandbox. Preserve all fixtures.
- J27 cycle page is already branch-built; current main build plan section 7 owns its
  status. Preview alias/settings are owner-controlled and were not probed here.
- Preserve main's untracked J27 development brief and concurrent worktree changes.
  This handoff was prepared in a separate docs worktree from current origin/main.
- Claim-evidence pilot report returned unavailable. No row was invented. No memory
  router edits occurred. Check current permissions and worktree state on resume.

#### Do Not Reopen Without New Decision

- Roster: one profile/person, one category, optional Contact links, no new Contacts for
  privacy-sensitive Board members, separate lead eligibility, preserved expertise fields.
- Justin/Jean/John lead eligible; Beth off; Kevin inactive; Amy staged inactive. John
  reuses roster ID 1. TBD profile excluded but ID 35 preserves existing feedback.
- Request narrative fields already exist in Production; external flow initializes them,
  app edits them, and intentional human edits/clearing must not be overwritten.
- Inherited D7/D8: Offramped is Phase II status `682090001`; Workbench is Research-only.

### Testing and milestone determination

18 roster foundation tests and relevant gates passed at `d2b467e84`. Later WIP only
received parser checks on three JS files and `git diff --check`; run appropriate tests,
build/type/DAL/security gates and browser verification before readiness claims.

No DEVELOPMENT_LOG entry required: no new Production capability shipped in this
roster work. CLAUDE.md unchanged. This main landing contains documentation only.

## Stream C — Request narratives (Codex, Session 669)

Copied from Codex's handoff at `7b7e483b0`; headings lowered one level, text
unchanged. Its references to "this session" mean Session 669, and its
concurrent-stream notes are as of that close.
The production metadata probe in its Testing section needs the owner's
explicit authorization each time it is run; its presence here is not one.

This is a **docs-only handoff on main**. Runtime implementation remains on
`codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed and verified.
The prior complete handoff is retrievable with
`git show a046f8a22487a81666fb126bf4c81cf571020a6d:SESSION_PROMPT.md`.
Concurrent-session details below are dated resume boundaries, not authority to
change their checkouts, fixtures, deployment settings or branches.

#### What Was Completed

1. **Two optional Request text fields implemented on the feature branch.**
   `lay_abstract` maps to `akoya_request.wmkf_layabstract` (Lay Abstract);
   `initial_assessment` maps to `wmkf_initialassessment` (Initial Assessment).
   Both are plain-text Memo columns with a 100,000-character limit. No in-app
   generation: Power Automate supplies the initial values. The new assessment
   text is separate from the governed Initial Assessment document and pointer.
2. **Production schema provisioned after explicit owner approval.**
   [VERIFIED via wave `36-request-narratives` apply and independent
   `scripts/probe-request-narrative-fields.js --target=prod --verify` on the
   feature branch] Both fields have exact names, labels, type, optional status,
   length and read/update capability. A zero-row runtime projection accepted
   both columns. No Request content was read or changed during verification.
3. **Explicit staff editing implemented and tested, not promoted.** Overview
   hosts one new card (three-line integration). GET/PATCH
   `/api/workbench/request-narratives` reads both fields and saves only changed
   keys. Writes require lead PD or linked superuser, enabled staff impersonation,
   trusted DAL context and concrete ETag; stale/concurrent edits fail without
   retry. Dirty drafts survive errors and navigation asks before discarding.
4. **Verification.** 33 focused tests plus 18 existing Overview regression tests
   passed; production build and affected gates passed. Full lint: zero errors,
   190 warnings. Independent review found tab-navigation draft loss; it was
   fixed and the reviewer verified the regression test. Feature worktree clean.
5. **Connor memo drafted in chat, not sent.** It names both production fields and
   the external flow's required one-time initialization / concurrency safeguards.
   Detailed evidence and rollout limits:
   `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md`.

#### Commits

Feature branch (both pushed):
- `7b5305a7c` — Add editable Request lay abstract and initial assessment fields.
- `06e1ba6a4` — Verify production Request narrative fields and record provisioning.

Milestone determination: no DEVELOPMENT_LOG entry required. This session
provisioned additive schema and built branch code; the end-to-end production
capability is not deployed. CLAUDE.md stays unchanged: feature inventory belongs
in the Atlas and handoff, not the root instructions.

### Next Items

#### Verified Open

1. **Power Automate initialization contract.** The external flow is not in this
   repository and was not changed. Connor must verify durable once-per-Request
   initialization, concrete `If-Match`, refusal on conflict, and no refill after
   intentional human clearing. A blank field is not an initialization marker.
   Evidence: feature handoff's Power Automate owner contract and owner direction
   in this chat. Flow implementation/status must be checked with its owner.
2. **J27 integration and app promotion.** The Request text card is built on its
   own branch; the owner authorized only a small integration pending merge review
   with Claude's active J27 work. Evidence: branch `06e1ba6a4` and main's
   `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` section 7. Review the
   Overview placement against that branch before deliberate runtime promotion.
3. **Approved staff save/readback rehearsal.** Mocked tests and live metadata
   verification do not prove an actual staff save. Choose an owner-approved
   test Request and environment, verify impersonation, then exercise initial
   fill, save/reload, clearing, stale form and external-flow retry behavior.
   Local sandbox URL is absent and local impersonation was disabled; no
   environment setting was changed.

#### Owner Decision Needed

1. Runtime deployment timing and approved test Request/environment for the new
   fields. Schema provisioning approval did not authorize arbitrary record writes
   or feature promotion.
2. Inherited unresolved J27 decisions: where offramp justification lives; who
   sets Offramped; retention of the original First Cut answer; fit-flag meaning,
   remaining intake outputs/owners, staff queues, Chairs materials and calendar
   changes. These were recorded in the prior handoff and were not resolved by
   creating these two text fields. Recheck the active alignment log with Claude.

#### Parked

Inherited scope boundaries (not reauthorized): Southern California as a separate
suite; real J27 readiness readback after December 8; bulk edits, queues and packet
exports. Re-open only with owner direction and current-plan verification.

#### Verify Before Acting

1. **J27 cycle page is already branch-built.** Do not restart its design/build
   from the prior session prompt. Main commit `a046f8a22` records the built slices
   on `claude/j27-cycle-page`, including `4038e8ace`; that was the observed local
   tip at handoff preparation. Staff-flow audit and remaining details belong to
   Claude's current plan and should be rechecked there.
2. **Preview alias and branch-scoped environment settings.** The prior handoff
   records a sandbox-backed Preview and an owner-controlled restore. Current alias
   was not probed here. Do not restore, retire settings or deploy based on that
   inherited snapshot.
3. **Preserve dirty work.** Main checkout contains the unrelated untracked
   `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md`; Claude's active J27
   checkout has a modified `package-lock.json`. Both were observed and untouched.
   Re-inventory before any future reuse or cleanup; no teardown is authorized.
4. **Existing test fixtures stay.** No fixture deletion or status change occurred
   or was authorized in this session. Historical cleanup ideas require live
   caller/ownership checks and a new decision.
5. **Claim-evidence pilot report unavailable.** The required current-session
   report returned unavailable; this Codex environment has no usable current
   report context. No observation row was invented or borrowed from another
   session. No memory-router edits or growth occurred in this session.

#### Do Not Reopen Without New Decision

- Both new columns are already provisioned in production. Re-probe before any
  schema operation; do not recreate or backfill them automatically.
- External Power Automate owns initial generation; the app only reads/edits/saves.
- Preserve intentional staff edits and clearing; no automatic overwrite/refill.
- Inherited D7/D8: Offramped is Phase II status `682090001`; Workbench read model
  is Research-only. This session does not revise those decisions.

### Key Files Reference

| File / location | Purpose |
|---|---|
| `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` (main) | Production schema evidence, feature contract, external-flow safeguards |
| `docs/atlas/dataverse-akoya-request.md` (main) | Live new fields; app consumer explicitly branch-only |
| Feature branch schema wave `36-request-narratives` | Reproducible additive schema definition |
| Feature branch `request-narratives-service.js` and `request-narratives.js` API | Conditional staff read/save path |
| Feature branch `RequestNarrativesCard.js` | Request-scoped editor and dirty-draft navigation guard |
| `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` (main) | Current J27 cycle-page build record |

### Testing

Run in the feature worktree; these files are intentionally not on main:

```bash
npx jest tests/unit/request-narratives-service.test.js tests/unit/request-narratives-card.test.js tests/unit/request-narratives-route.test.js --runInBand
DATAVERSE_ALLOW_PROD_READS=yes node scripts/probe-request-narrative-fields.js --target=prod --verify
```

The metadata probe is read-only and does not return Request content. Full build,
lint and affected gates passed on the feature branch. Handoff changes on main are
documentation only; they do not deploy the new route or editor.

## Other streams (not worked on 2026-11-09 or 2026-11-10)

Dated inherited resume boundaries, not fresh audits or permissions.

| Owner / stream | Resume boundary and authority |
|---|---|
| Codex / J27 Factory | `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory`, `codex/j27-factory-scenarios` at `9070030c7`; `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` |
| Codex / J27 reports line | `/private/tmp/wmkf-j27-workbench-reports`, `codex/j27-workbench-reports` at `97f696faf`; that Codex session closed 2026-11-09; copies of its reports are in `~/Downloads/J27-review-2026-11-08/` |
| Earlier streams | Preview CSRF, per-reminder history, shared prompts, Integrity (Session 658), reviewer outcomes: boundaries unchanged from `git show 53066edc1:SESSION_PROMPT.md` |
