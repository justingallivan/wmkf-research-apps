# Session 679 Prompt: Three open streams — J27 Workbench (intake checks, cleanup), expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked in Session 678
(2026-11-14 to 2026-11-15, Claude). Streams B and C were not touched by Claude and are
carried as their authors wrote them on 2026-11-09. **Find out which stream the
owner wants before doing anything; if he does not say, ask.** Then read that
stream's section and the document it names. The other two streams are not
yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 Workbench** | Claude, Session 678 (2026-11-14 to 2026-11-15) | `main` (clean). Worktree `/Users/gallivan/Code/WMKF_Apps-claude-factory-j27-files` (merged, kept until cleanup); `claude/j27-read-model` (sandbox Preview) at `2adc6dfb0` | Stream A below; alignment log D70, D71 | Ask the owner. Candidates: note to Connor about broken bibliographies (Verified Open 1); intake checks around 2026-12-05 |
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
  (`097_shared_prompt_jobs.sql`); Sessions 677 and 678 used 098 and 099 on `main`. Whoever lands
  097 checks `schema_migrations` ordering (memory
  `project-migration-numbers-claimed-off-main.md`).
- **Other checkouts' `check:factory-ledger` gate is red until they pull
  `main`:** both Factory ledgers now carry migrations 098 and 099, and a checkout without
  those fingerprints refuses them.

**Session numbers.** 669, 670 and 671 overlapped on 2026-11-09; 672 to 678
were Stream A (Claude, 2026-11-10 to 2026-11-15). The next session is 679
whichever stream it takes. Earlier handoffs: `git show
9ade0e729:SESSION_PROMPT.md` (Session 677 close), `git show
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
  (now live, request page and offramp control included) before any runtime promotion (Stream C,
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

## Stream A — J27 Workbench (Claude, Session 678)

Session 678 (2026-11-14 to 2026-11-15) shipped the Workbench offramp control,
made the Production Test Request Factory produce J27 test requests that can be
put in the Workbench from the admin page, and redesigned the admin Test
Requests page. Every runtime change had a Codex review and the owner's go
before deploy.

### What Was Completed

1. **Offramp control in the Workbench (D70).** Any Workbench user may set
   Phase II Status to Phase II Offramped (`682090001`) or undo it; undo
   restores the earlier value, kept in `wmkf_phaseiistatusbeforeofframp` (wave
   42, applied to Production by the owner). The justification
   (`wmkf_offrampjustification`, D69) is shown and saved only while
   offramped. Live with `WORKBENCH_OFFRAMP_READY=on`; owner-tested on #1003456
   (`0a1d90492` to `e17745d89`). Red `check:agent-wiki` gate cleared
   (`61ff97633`, `f9d7894a5`).
2. **Factory J27 files.** J27 test requests get
   `AI Materials/Narrative-Bibliography_N.pdf` (D60; ledger migration 099
   applied to both ledgers and the Production app database, `59ac3ee80`).
   Lookup refuses sources whose PDFs are not PDFs and prefers the applicant's
   originals in each source's `Phase II` folder (`c7ebedc1f` to `39f99d040`).
3. **Prepare for review on the admin page (D71).** One action sets Phase I to
   Invited, Phase II to Phase II Pending Committee Review, then
   `wmkf_readyforreview` = true (new route
   `POST /api/admin/test-requests/runs/[runId]/readiness`, same checks as the
   CLI's `--finalize-readiness`). Anyone with admin access, on their own runs;
   readiness cannot be undone. The sweep keeps a prepared run's files until
   readiness completes (30-day cap). Readiness route proved on 1003517
   (run `af194915`), the one-button flow on **1003518** (run
   `1640c8a0-1073-5a37-8ade-94874e3dbcc1`); both in the Workbench. Both runs are
   in ledger `ledger_prod` (Neon project `wmkf-factory-ledger`, the
   Production form's `TEST_REQUEST_LEDGER_URL`).
4. **Admin Test Requests page redesign** (owner: "kind of a mess").
   Sandbox-only "Basic Request clone preview" panel removed (route and service
   kept, no UI caller). Factory first; Previous runs and the email allowlist
   collapsed (allowlist problems show in its collapsed header). A created run
   shows the status **Created** (was "Ready"), collapses its clone steps and
   puts Prepare for review next; a sent but unconfirmed step reads "Sent, not
   confirmed" (a journaled unsent one "Planned, not sent"). Copy no longer
   sends readiness to the command-line tool.
5. Memory: `feedback-ordered-workflows-as-one-action.md` (owner: an
   order-dependent workflow ships as one guided action).

### Commits
- `0a1d90492` to `e17745d89` offramp control (D70), wave 42
- `61ff97633`, `f9d7894a5`, `ee615cad7` wiki and doc refresh
- `c7ebedc1f` to `39f99d040` Factory combined file, source checks, Phase II sources, migration 099
- `cc987f720` to `aa428a53d` readiness route and Prepare for review (D71)
- `aebba542a` memory; `8d000bc7f` preview panel removed
- `e8c1e7572` to `c49d91384` page redesign and collapsed sections (Production `dpl_HCopCMNiquP6LQEfvDKTdTnwJFR1`)
- Session close commit (this handoff)

### Next Items

#### Verified Open

1. **Tell Connor about the broken AI Materials bibliographies.** Source
   1002912's `AI Materials` bibliography is about 3.85 MB of JSON-like text
   (owner's `xxd` output); the owner says other submissions' are "also messed
   up". They come from Connor's Power Automate flow. The Factory now refuses
   such sources. Also tell him he can make and prepare his own test requests
   from Admin → Test Requests. Message goes from the owner (draft on request).
2. **J27 intake checks (about 2026-12-05):** #1003456 and a D26 request still
   open; then on real J27 requests: cycle-page load with full lists, several
   staff editing at once, attendance with a presentation and no Zoom
   suggestions; first real offramp.
3. **Clean up after intake** (owner, 2026-11-14). Test requests 1003515 and
   1003516 (`needs_attention`), run `55f93689` (reserved, not started),
   1003517, 1003518 and the older 1003308, 1003310, 1003312; Preview branch
   settings on `claude/j27-read-model`; Neon branch `j27-preview`; J27
   worktrees including `/Users/gallivan/Code/WMKF_Apps-claude-factory-j27-files`.
   List and confirm before deleting; Preservation preflight first. Test residue
   cleanup is for data mining (memory
   `project-test-residue-cleanup-is-for-data-mining.md`).
4. **D68 plan** (pre-presentation questions): owner suggested the new year;
   presentations start 2027-04-19. Starting point: the Site Visit Materials
   route. Open: one typist or several, approval, co-PI addresses, send route,
   timing, attribution after edits.

#### Owner Decision Needed

1. Formal offramp outcome display and Zoom attendance suggestions: decide
   after real J27 traffic.
2. Ranking and briefing select `akoya_requeststatus = 'Phase II Pending'` and
   the two Research program IDs; whether J27 requests carry both after the
   Chairs is unconfirmed. Ask Connor and Sarah before May.

#### Verify Before Acting

1. Factory runs that trigger a GoVerify refresh have stopped at verify on the
   Foundation transition contract (2026-11-03, 2026-11-14) [ASSUMED pattern;
   1003517 and 1003518 completed]. Read the stop text with
   `vercel logs --environment production --since 30m -q "step stopped"`.
2. Schema waves: `scripts/apply-dataverse-schema.js --wave=<dir suffix>`;
   Production dry-run needs `DATAVERSE_TARGET_INTERLOCK=on
   DATAVERSE_ALLOW_PROD_READS=yes`; `--execute` adds
   `DATAVERSE_PROD_WRITE_ACK="<purpose> <UTC date>"`.
3. Vercel deploy checks: after a fast-forward merge the commit's combined
   status can show the branch Preview's success before Production builds.
   Confirm with `vercel inspect applications.wmkeck.org` (deployment id).
4. Preview sign-in: point `wmkfresearchapps-preview.vercel.app` at the branch
   deployment with `vercel alias set`, then restore it. It points at
   `dpl_8C5J3QpUy5uaPA1VLPAk12FprrRX` [VERIFIED 2026-11-15 after restore].
   Preview has no Factory ledger, so run panels can only be seen in Production.

#### Parked

1. Codex's sandbox Factory branch (gaps 2 and 3): parked by the owner.
2. The removed preview's route `/api/admin/test-requests/preview` and
   `admin-preview-service.js` stay with no UI caller (owner chose "take it off
   the page only", 2026-11-15). Re-open only for full removal.

#### Do Not Reopen Without New Decision

1. D59, D60, D61, D68, D69, D70, D71 as recorded in the alignment log.
2. Factory venue is Production; anyone with admin access may prepare their own
   runs for review; readiness is never set back from the form.
3. The Keck Foundation account GoVerify changes of 2026-11-14 are vendor data;
   do not restore.

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | D59 to D71 |
| `lib/services/workbench/offramp-service.js`, `pages/api/workbench/offramp.js`, `shared/components/workbench/OfframpControl.js` | Offramp control |
| `lib/services/test-requests/readiness-finalizer.js`, `pages/api/admin/test-requests/runs/[runId]/readiness.js` | Readiness |
| `shared/components/admin/TestRequestPrepareForReview.js`, `TestRequestStatusControl.js`, `TestRequestFactoryRunPanel.js` | Admin form |
| `docs/TEST_REQUEST_FACTORY_FORM_RUNBOOK.md` | Operator runbook |

### Testing

```bash
npx jest tests/unit/test-request tests/unit/test-requests-workspace.test.js tests/unit/admin-view-coverage.test.js
npm run check:factory-ledger -- --allow-unreachable
```
Ledger pg suites run one at a time (shared schema).

Milestone: DEVELOPMENT_LOG entry "Workbench offramp control; Factory makes
reviewable J27 test requests (Sessions 677–678)".

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
