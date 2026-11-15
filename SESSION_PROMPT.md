# Session 678 Prompt: Three open streams — J27 offramp justification next, expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked in Session 677
(2026-11-14, Claude). Streams B and C were not touched by Claude and are
carried as their authors wrote them on 2026-11-09. **Find out which stream the
owner wants before doing anything; if he does not say, ask.** Then read that
stream's section and the document it names. The other two streams are not
yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 Workbench** | Claude, Session 677 (2026-11-14) | `main`. Worktree `/Users/gallivan/Code/WMKF_Apps-claude-factory-j27-files` (branch `claude/factory-j27-file-names`, merged); `claude/j27-read-model` (sandbox Preview) at `2adc6dfb0` | Stream A below; alignment log D69 in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | **Owner wants it soon:** build the offramp justification edit and display in the Workbench (Stream A, Verified Open 1). Clear the red `check:agent-wiki` gate first (Verified Open 2) |
| **B. Expertise roster** | Codex, Session 670; Codex again 2026-11-10 and 2026-11-11 | **Observed 2026-11-12 by Claude, not Codex's own record:** `codex/expertise-roster-import-2026-11-10` last commit 2026-11-11 15:37 ("record reviewed native output schema build"), worktree `/Users/gallivan/Code/WMKF_Apps-codex-roster-import`. Codex's own section below still names the 2026-11-09 branch | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`; that branch's own handoff commits | Ask Codex or the owner for the current boundary; do not resume from the 2026-11-09 text alone |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed. Recorded worktree `/private/tmp/wmkf-request-narratives` is gone from disk | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |

**Other Codex work seen 2026-11-12 (observed by Claude; not a handoff, not
Claude's to change; not rechecked 2026-11-14):**
- A Codex app session ran with the main checkout as its working directory.
  Its latest work was `codex/power-automate-integration-2026-11-11` in
  `/private/tmp/wmkf-pa-integration-20261111` (last commit 2026-11-12 20:32);
  surface: Power Automate, shared prompt jobs, sandbox Request creation.
- `codex/coordinated-start-2026-11-10-b` (pushed) carries **Codex's own
  "Session 674 / 675" handoff**, which it calls branch-local: the shared
  Executor trial and four Sandbox recommendation jobs whose due-only cleanup
  deadlines fall on 2026-11-12 and 2026-11-18 (Phoenix time). That cleanup is
  Codex's. **Session numbers clash**: `main`'s 674 to 677 are Claude's Stream
  A sessions; whoever lands a Codex handoff on `main` reconciles.
- `/private/tmp/wmkf-staff-draft-store-20261111` had uncommitted Codex changes
  to `lib/services/execute-prompt.js` and `lib/services/prompt-jobs/*`.
- **Codex branches claim app migration number 097**
  (`097_shared_prompt_jobs.sql`); Session 677 used 098 on `main`. Whoever lands
  097 checks `schema_migrations` ordering (memory
  `project-migration-numbers-claimed-off-main.md`).
- **Other checkouts' `check:factory-ledger` gate is red until they pull
  `main`:** both Factory ledgers now carry migration 098, and a checkout without
  the 098 fingerprint refuses them.

**Session numbers.** 669, 670 and 671 overlapped on 2026-11-09; 672 to 677
were Stream A (Claude, 2026-11-10 to 2026-11-14). The next session is 678
whichever stream it takes. Earlier handoffs: `git show
1031a6ce2:SESSION_PROMPT.md` (Session 676 close: request page on in
Production), `git show 749d59e40:SESSION_PROMPT.md` (Session 675),
`git show 20deeb251:SESSION_PROMPT.md` (Session 674),
`git show 146980bc6:SESSION_PROMPT.md` (Session 673),
`git show 33a233633:SESSION_PROMPT.md` (Session 672),
`git show b2c271344:SESSION_PROMPT.md` (Session 671),
`git show 7b7e483b0:SESSION_PROMPT.md` (Request narratives),
`git show 5782bad43:SESSION_PROMPT.md` (roster).

**Where the streams meet.**
- Stream C's Overview card must be reviewed against Stream A's J27 line
  (now live, request page included) before any runtime promotion (Stream C,
  Verified Open 2).
- **Stream A is on `main`**, including its change to
  `pages/api/expertise-finder/batch-match.js` (J27 staff version name, Session
  672) that Stream B also changes: Stream B rebases onto `main` and reconciles.

## Rules for every stream

1. **Promotion needs the owner's explicit go.** Stream A's J27 line is live
   (2026-11-13 and 2026-11-14, owner go at each step); Streams B and C are
   still on feature branches. `main` deploys to Production on push; only
   documentation lands there without the owner's go.
2. **Worktrees under `/private/tmp` are volatile.** Several Codex ones listed
   by `git worktree list` are gone from disk (git marks them prunable; not
   pruned). If one is gone, the pushed branch is the source.
3. **Local runs read Production.** `.env.local` in the main checkout (linked
   from the J27 worktree) points at production Dataverse and the Production
   Postgres database, and has no `DYNAMICS_SANDBOX_URL` (checked 2026-11-14).
   Production reads are owner-run: hand him the command with real values,
   never `<placeholders>` (the shell reads `<x` as a file redirect). A sandbox
   read is allowed only pinned to the sandbox host
   `orgd9e66399.crm.dynamics.com` (`scripts/probe-sandbox-j27-fields.cjs` is
   the pattern).
4. **Sandbox Preview.** Only `claude/j27-read-model` has the branch-scoped
   sandbox `DYNAMICS_URL` and its own Postgres database (Neon branch
   `j27-preview`). Staff sign-in works only through
   `wmkfresearchapps-preview.vercel.app`; at the close of Session 675 it
   pointed at `dpl_8C5J3QpUy5uaPA1VLPAk12FprrRX` (`2adc6dfb0`) [VERIFIED
   2026-11-13; not rechecked 2026-11-14]. Earlier targets are in
   `git show 749d59e40:SESSION_PROMPT.md`. The sandbox's
   `workbench.phase_rollout` setting is `{"mode":"on"}`.
5. **Preserve:** sandbox fixtures 1000368 to 1000387, including the
   presentation record added to #1000383 on 2026-11-12 (until a Factory
   Deliberations scenario replaces it; work queue entry); Production test
   request #1003456 and its test text in the three new fields; the untracked
   `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` in the main
   checkout (Codex's); the uncommitted `package-lock.json` in the Codex
   dashboards and Codex J27 Factory worktrees; every other stream's branches,
   worktrees and settings.

## Stream A — J27 Workbench (Claude, Session 677)

Session 677 (2026-11-14) made the Production Test Request Factory produce
J27-shaped test requests, accepted it on a real run, worked through the
owner's open items one at a time, and created the offramp justification field
in Production.

### What Was Completed

1. **Factory J27 file destinations** (owner: Production Factory only; narrative
   and bibliography only). A J27-or-later run copies them to
   `Submission-Documents/Project-Narrative_N.pdf` and `Bibliography_N.pdf`;
   the layout is bound in the manifest and plan digest. Ledger migration 098
   widens `test_request_receipt_ok`; the owner applied it to both Factory
   ledgers and the Production app database. Merged `3e382029a`, docs `2d0b43a67`.
2. **Accepted on a real run.** Run `174e770e-cdfe-51c9-a8c5-945a02abe534`
   (ledger `managed-ledger/ledger_prod`) created J27 test Request **1003515**
   from 1002874. Its Initial Assessment → Proposal → Documents list shows
   Project Narrative and Bibliography (View, Download) and the other four "not
   received yet" (owner screenshot). The run is **parked `needs_attention` at
   verify**: the GoVerify refresh triggered by the create changed the Keck
   Foundation account (BMF 509 Undetermined → blank, subsection text shortened,
   verified address upper-cased, PDF replaced; owner-read Audit History). These
   are vendor writes; nothing restored. Runbook "What 'cannot continue' leaves
   behind" records it (`a40aac95e`).
3. **Two Factory fixes, promoted with the owner's go.** The form offers the
   readback-first Retry after a create that timed out (`c689c352d`); the
   Production Request create gets 60 s instead of 30 (`74f442200`). Both J27
   runs (2026-11-03, 2026-11-14) timed out at 30 s while the create committed.
4. **Owner decisions recorded** in the alignment log:
   - **D68:** PDs meet before every J27 presentation. One question list per
     request: the lead PD drafts it, the meeting edits it live (saved as typed),
     it is tidied afterwards, then shared with the PI, co-PIs and liaison. AI may
     suggest starting questions, each attributed. Not built; supersedes the
     2026-10-26 "questions to PIs happen outside the apps".
   - **D69:** offramp justification is a new Dataverse field, written in the
     Workbench like the wave 37–40 memos, not on an AkoyaGO form.
   - **D59:** the J27 `AI Materials` folder will be created and hold an
     assemblage; the one file named is `Narrative-Bibliography_N.pdf` (D60),
     which the governed readers do not accept, so no single-copy conflict.
   - **D61:** budget fields wait (PDs use top-line numbers only).
5. **Wave 41 applied to Production** (owner-run, dry-run then `--execute`):
   `akoya_request.wmkf_offrampjustification`, Memo, 2,000 characters, optional
   (`f80172d20`, `41379bc5b`, `1031a6ce2`).
6. **Work queue:** Factory acceptance recorded; follow-up (unscheduled) to have
   the Factory build `AI Materials/Narrative-Bibliography_N.pdf` (D60).
7. Earlier in the session: Stream A doc fixes, wiki `wmkf_name` padding note,
   `potential-reviewer.js:37` comment fixed, stage-box item closed.

### Commits
- `7d6466a5c`, `353425585`, `3e382029a`, `2d0b43a67` Factory J27 files + 098
- `75646ca16`, `c689c352d` Retry after create timeout
- `1190e466a`, `74f442200` 60 s create limit
- `a40aac95e`, `bc9df75d2`, `7527ce1af`, `23a61b0d2` runbook and work queue
- `69ab3ba3c`, `1f4e4c918`, `1f0496028`, `98fa6dc9d` D68
- `9cf4309cd`, `f9b1994c7`, `f80172d20`, `41379bc5b`, `1031a6ce2` D59, D61, D69, wave 41
- `122962e50`, `e20825316`, `c6b052326` session-start decisions and wiki
- Session close commit (this handoff)

### Next Items

#### Verified Open

1. **Offramp justification in the Workbench (owner: build soon, next
   session or after).** Field `wmkf_offrampjustification` exists in Production
   [VERIFIED via owner-run wave 41 output]; no app code selects it [VERIFIED
   via grep, 2026-11-14]. Pattern: the wave 37–40 memos, e.g.
   `/api/workbench/initial-assessment-rationale` with request-ETag saves and a
   schema-ready switch (Atlas `docs/atlas/dataverse-akoya-request.md`). Open
   questions for the owner before planning: does the box appear only once
   Phase II Status is "Phase II Offramped" (`682090001`, D51) or earlier; who
   may edit it; where it shows (request page, All requests and Peer Review rows).
   Branch work; promotion needs the owner's go. Needed by about 2027-03-25.
2. **Red gate: `check:agent-wiki`.** `docs/agent-wiki/topics/review-panel.md`
   passed its 60-day window (last_verified 2026-09-15). Re-verify against
   source and refresh, as Session 676 did for `dataverse-dynamics.md`.
3. **J27 intake checks (about 2026-12-05):** #1003456 and a D26 request still
   open; then on real J27 requests: cycle-page load with full lists, several
   staff editing at once, attendance with a presentation and no Zoom
   suggestions.
4. **Clean up after intake** (owner, 2026-11-14): Preview branch settings on
   `claude/j27-read-model` (6 Config settings, sandbox `DYNAMICS_URL`,
   `POSTGRES_URL`/`DATABASE_URL`), Neon branch `j27-preview`, the J27
   worktrees including `/Users/gallivan/Code/WMKF_Apps-claude-factory-j27-files`
   (its `.agents/skills` symlink and the `~/.claude/projects/...-claude-factory-j27-files/memory`
   symlink are local only). Preservation preflight first.
5. **D68 plan** (pre-presentation questions): owner suggested the new year;
   presentations start 2027-04-19. Starting point: the Site Visit Materials
   route (PI and liaison link; no co-PIs). Open: one typist or several,
   approval, co-PI addresses, send route, timing, attribution after edits.

#### Owner Decision Needed

1. Formal offramp outcome display and Zoom attendance suggestions: owner
   recommended deciding after real J27 traffic (not decided).
2. Ranking and briefing select `akoya_requeststatus = 'Phase II Pending'` and
   the two Research program IDs; whether J27 requests carry both after the
   Chairs is unconfirmed (alignment log, Apr–Jun note). Ask Connor and Sarah
   before May.

#### Verify Before Acting

1. **Factory form runs that trigger a GoVerify refresh likely stop at verify**
   on the Foundation transition contract (two runs) [ASSUMED from 2026-11-03
   and 2026-11-14]. The test request itself is fine; read the stop text with
   `vercel logs --environment production --since 30m -q "step stopped"`
   (`-x` was removed from the CLI). Relaxing the contract is a reviewed change.
2. Schema waves: `scripts/apply-dataverse-schema.js --wave=<dir suffix>`;
   Production dry-run needs `DATAVERSE_TARGET_INTERLOCK=on
   DATAVERSE_ALLOW_PROD_READS=yes`, `--execute` adds
   `DATAVERSE_PROD_WRITE_ACK="<purpose> <UTC date>"`. No AkoyaGO form
   placement is needed for app-edited fields.
3. Carried from Session 676: setting-script and rollback details, audit
   evidence via the owner's AkoyaGO Audit History, cycle page vs request page
   (`git show 1031a6ce2:SESSION_PROMPT.md`).

#### Parked

1. Factory follow-up: build `AI Materials/Narrative-Bibliography_N.pdf` on
   test requests (work queue).
2. Run `174e770e` / Request 1003515 stays `needs_attention` until the
   post-intake cleanup.
3. Codex's sandbox Factory branch (gaps 2 and 3): parked by the owner.

#### Do Not Reopen Without New Decision

1. Factory venue is Production; J27 files limited to narrative and
   bibliography; cleanup after intake; stage box closed (owner, 2026-11-14).
2. D59, D61, D68, D69 as recorded on 2026-11-14.
3. The Keck Foundation account GoVerify changes of 2026-11-14 are vendor
   data; do not restore.
4. Session 672 to 676 decisions (earlier handoffs).

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | D59, D61, D68, D69 |
| `lib/dataverse/schema/wave41-j27-offramp-justification/akoya_request.json` | Offramp justification field |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Retry table, parked run 174e770e |
| `lib/services/test-requests/admin-run-service.js` | Form diagnosis (Retry rules) |
| `lib/services/test-requests/basic-clone-steps.js` | J27 layout, `CREATE_REQUEST_TIMEOUT_MS` |
| `lib/db/migrations/098_test_request_j27_file_names.sql` | Ledger receipt widening |
| `docs/CURRENT_WORK_QUEUE.md` | Factory entry, acceptance, follow-up |

### Testing

```bash
npx jest tests/unit/test-request
npm run check:factory-ledger -- --allow-unreachable
```
Ledger pg suites run one at a time (shared schema).

Milestone: none required this session (Factory and schema changes are
incremental; the J27 Workbench milestone entry already exists).

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
