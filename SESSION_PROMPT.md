# Session 677 Prompt: Three open streams — J27 request page on in Production, expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked in Session 676
(2026-11-14, Claude). Streams B and C were not touched by Claude and are
carried as their authors wrote them on 2026-11-09. **Find out which stream the
owner wants before doing anything; if he does not say, ask.** Then read that
stream's section and the document it names. The other two streams are not
yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 Workbench** | Claude, Session 676 (2026-11-14) | `main` (live in Production, release steps A to D done). Worktree `/Users/gallivan/Code/WMKF_Apps-claude-production-admission` (merged); `claude/j27-read-model` (sandbox Preview) at `2adc6dfb0`, alias pointed at it | Stream A below; `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` (change record above its Rollback section) | Nothing urgent: real J27 applications arrive in about three weeks (owner). Check before intake, then the real-use checks (Stream A, Verified Open 1) |
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
  Codex's. **Session numbers clash**: `main`'s 674 to 676 are Claude's Stream
  A sessions; whoever lands a Codex handoff on `main` reconciles.
- `/private/tmp/wmkf-staff-draft-store-20261111` had uncommitted Codex changes
  to `lib/services/execute-prompt.js` and `lib/services/prompt-jobs/*`.
- **The owner says Codex is not working on the Test Request Factory now
  (2026-11-14).** Its J27 gaps are logged in `docs/CURRENT_WORK_QUEUE.md`
  ("Test Request Factory — not yet J27-shaped").

**Session numbers.** 669, 670 and 671 overlapped on 2026-11-09; 672 to 676
were Stream A (Claude, 2026-11-10 to 2026-11-14). The next session is 677
whichever stream it takes. Earlier handoffs: `git show
749d59e40:SESSION_PROMPT.md` (Session 675 close: J27 merge, admission build,
steps A and B), `git show 20deeb251:SESSION_PROMPT.md` (Session 674),
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

## Stream A — J27 Workbench (Claude, Session 676)

Session 676 (2026-11-14) cleared the red wiki gate and finished the release:
the request page's phase layout is now on in Production for every
2027-or-later request.

### What Was Completed

1. **Red gate cleared.** `check:agent-wiki` was red because
   `docs/agent-wiki/topics/dataverse-dynamics.md` passed its 60-day window.
   A delegated agent re-verified it against source (three stale claims
   corrected: where the DAL write asserts live, the adapter count, stale line
   references) and refreshed the date (`b1fb866be`). Every other start gate
   was green.
2. **Step C, pilot** (owner-run `scripts/set-workbench-phase-rollout.mjs`):
   `workbench.phase_rollout` = pilot of #1003456
   (`8f4f6bbf-7cfe-487b-8b03-9c02f131d738`). Owner signed in: #1003456 opens on
   the phase tabs; rationale, staff review summary and staff visit assessment
   saved and survived a hard reload (first Production writes to the new
   fields); AkoyaGO Audit History shows three updates by the owner, one per
   save, and no other field changed.
3. **Step D, on**, the same day: no observation window (owner: no one else in
   the apps, these saves send no email, no real J27 applications for about
   three weeks, and `on` lets internal testing use every J27 test request).
   Read back `on`; `on` still admits only 2027-or-later cycles
   (`lib/services/workbench/phase-admission.js:126`, every caller goes
   through the cycle-checked loader).
4. **Factory gaps logged** in `docs/CURRENT_WORK_QUEUE.md`: D26 file names,
   retired scenario names (First Cut, Semi-finalist) on the unmerged Codex
   branch, no Deliberations scenario.
5. **Docs reconciled:** change record (steps C and D, no-window decision),
   Atlas, service catalog and route matrix no longer call the admission
   "branch-built, not merged"; memory and router; DEVELOPMENT_LOG entry
   extended to Sessions 675–676.

### Commits
- `b1fb866be` wiki page re-verified
- `476373222`, `76392a3bd`, `22d705a84` step C (setting, checks, editor)
- `13a6067c0` step D
- `5f1fd966d` Factory gaps in the work queue
- Session close commit (this handoff, reference docs, memory, dev log)

### Next Items

#### Verified Open

1. **Before and at J27 intake (about 2026-12-05, owner estimate):** a
   last check that #1003456 and a D26 request still open as expected; then,
   on the first real J27 requests, the real-use checks listed in the change
   record's Observation window: cycle-page load with full lists, several
   staff editing at once, attendance with a presentation and no Zoom
   suggestions.
2. **Clean up after the release settles** (rollout plan): the Preview's
   branch-scoped settings, the Neon branch `j27-preview`, and the `.env.local`
   link in the admission worktree; then retire both J27 worktrees. Removal
   work: run the preservation preflight first (Verify Before Acting).
3. **Factory J27 gaps**: `docs/CURRENT_WORK_QUEUE.md` entry; no owner yet.
   Do before the Factory next creates J27 test requests.
4. **Stale code comment** at `lib/dataverse/adapters/potential-reviewer.js:37`
   ("Dynamics does NOT recompute [wmkf_name]") contradicts the wiki's
   2026-09-26 live proof that a server process rewrites it. Comment-only fix;
   not yet made.

#### Owner Decision Needed

1. Formal offramp outcome; Zoom attendance suggestions (both kept out).
2. Carried: what is prepared before a J27 presentation (D65); Connor's
   `AI Materials` folder (D59); offramp justification and other D61 items.
3. The stage box above the request tabs following `WORKBENCH_PHASE_RELEASE`
   while a request is on the old layout: now moot for J27 requests (all on
   the new layout); close unless it matters for older cycles.

#### Verify Before Acting

1. **Setting script**: run from a checkout with `.env.local`; Production
   needs `DATAVERSE_TARGET_INTERLOCK=on DATAVERSE_ALLOW_PROD_READS=yes`, and
   `--execute` a same-UTC-day `DATAVERSE_PROD_WRITE_ACK="workbench phase
   rollout YYYY-MM-DD"`, `--actor-email`, and the revision quoted as printed
   (`--expected-revision='W/"…"'`; the current Production revision follows the
   2026-11-14 `on` write). The `MODULE_TYPELESS_PACKAGE_JSON` warning is
   harmless.
2. **Rollback order:** setting off; then unset the two switches and redeploy;
   last resort `dpl_4xPvaNuQMW643fxL2CmuK9RWdKob` (`31ee58f8f`).
3. **Audit evidence** for Production saves comes from the owner's AkoyaGO
   Audit History: the production app user cannot read audit rows (wiki
   `dataverse-dynamics.md`).
4. **Cycle page vs request page:** the cycle page lists a request under the
   phase it has reached (#1003456 sits under Peer Review); the request page
   always shows all phase tabs. The rationale is Initial Assessment →
   Assessment.
5. Carried: the "presentation end not verified" blocker without a
   presentation is required by reviewed tests; Neon `j27-preview` is a
   Production-data copy; `vercel inspect` prints on stderr; shell
   `git checkout --` restores the committed file (commit before mutation
   checks).

#### Parked

1. Polish pass and older parked items: `git show 20deeb251:SESSION_PROMPT.md`.

#### Do Not Reopen Without New Decision

1. No observation window before step D (owner, 2026-11-14); attendance
   testing deferred to a real presentation (owner, option 1).
2. The four 2026-11-13 admission decisions; structured news rule in
   Production; Haiku with 8000 tokens; rollup concurrency 4.
3. Session 672 to 675 decisions (see the earlier handoffs).
4. "Next: Identify reviewers" with reviews received: no longer seen on
   #1003456 (now "Next: Read the reviewer reports", 2026-11-14); reopen only
   if it recurs.

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` | Release state, change record (steps A to D), rollback |
| `lib/services/workbench/phase-admission.js` | Per-request admission (2027-or-later and the setting) |
| `lib/utils/workbench-field-readiness.js` | Field readiness, Zoom suggestions off in Production |
| `scripts/set-workbench-phase-rollout.mjs` | Owner-run writer of `workbench.phase_rollout` |
| `docs/CURRENT_WORK_QUEUE.md` | Factory J27 gaps entry |

### Testing

```bash
npx jest tests/unit/workbench-phase-admission tests/unit/workbench-field-readiness tests/unit/workbench-phase-admission-routes tests/unit/set-workbench-phase-rollout tests/unit/workbench-meeting-roster
npm run check:types
```

Milestone: DEVELOPMENT_LOG entry "J27 Workbench in Production (Sessions 675–676)".

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
