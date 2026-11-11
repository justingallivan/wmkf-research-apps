# Session 674 Prompt: Three open streams — J27 later phases built, expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked in Session 673
(2026-11-10 to 2026-11-11, Claude). Streams B and C were not touched by Claude
that session and are carried as their authors wrote them on 2026-11-09.
**Find out which stream the owner wants before doing anything; if he does not
say, ask.** Then read that stream's section and the document it names. The
other two streams are not yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 cycle page and request page** | Claude, Session 673 (2026-11-11) | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, on `claude/j27-cycle-page` at `01a798524`, pushed. `claude/j27-read-model` (the sandbox Preview branch) fast-forwarded to the same commit and deployed; the stable alias points at it | Stream A below; `docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` section 6 (on `main`) | Owner's browser walk-through on the Preview (Stream A, Verified Open 1) |
| **B. Expertise roster** | Codex, Session 670; Codex again 2026-11-10 | **Observed 2026-11-11 by Claude, not Codex's own record:** active work is on `codex/expertise-roster-import-2026-11-10` at `e59d1ecb6` in `/Users/gallivan/Code/WMKF_Apps-codex-roster-import`, clean, **not pushed** (no remote branch). Codex's own section below still names the 2026-11-09 branch | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`; that branch's own handoff commits | Ask Codex or the owner for the current boundary; do not resume from the 2026-11-09 text alone |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed and verified. Recorded worktree `/private/tmp/wmkf-request-narratives` is gone from disk | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |

Branch tips for A and C and the B foundation branch confirmed on the remote at
the close of Session 673 `[VERIFIED via git ls-remote, 2026-11-11]`.

**Session numbers.** 669, 670 and 671 overlapped on 2026-11-09; 672 was
Stream A on 2026-11-10; 673 was Stream A, 2026-11-10 to 2026-11-11. The next
session is 674 whichever stream it takes. Earlier handoffs:
`git show 33a233633:SESSION_PROMPT.md` (Session 672 close),
`git show b2c271344:SESSION_PROMPT.md` (Session 671),
`git show 7b7e483b0:SESSION_PROMPT.md` (Request narratives),
`git show 5782bad43:SESSION_PROMPT.md` (roster).

**Where the streams meet.**
- Stream C's Overview card must be reviewed against Stream A's J27 line
  before any runtime promotion (Stream C, Verified Open 2).
- **Stream A changed shared files Stream B also changes:**
  `pages/api/expertise-finder/batch-match.js` (J27 staff version name, Session
  672) and `SESSION_PROMPT.md`. Whoever merges second reconciles.
- The Test Request Factory (Codex branch `codex/j27-factory-scenarios`) still
  writes last cycle's file layout and the retired scenario names (Stream A,
  Verify Before Acting).

## Rules for every stream

1. **Nothing is promoted.** All three streams' runtime work is on feature
   branches. `main` deploys to Production on push; only documentation lands
   there without the owner's explicit go.
2. **Worktrees under `/private/tmp` are volatile.** All nine Codex ones listed
   by `git worktree list` were gone from disk on 2026-11-10 (git marks them
   prunable; not pruned). If one is gone, the pushed branch is the source.
3. **Local runs read Production.** `.env.local` in the main checkout (linked
   from the J27 worktree) points at production Dataverse and the Production
   Postgres database. Production reads are owner-run: hand him the command.
   A sandbox read is allowed only pinned to the sandbox host
   (`scripts/probe-sandbox-j27-fields.cjs` is the pattern).
4. **Sandbox Preview.** Only `claude/j27-read-model` has the branch-scoped
   sandbox `DYNAMICS_URL` and its own Postgres database (Neon branch
   `j27-preview`). Staff sign-in works only through
   `wmkfresearchapps-preview.vercel.app`; the owner signs in and repoints that
   alias himself, or Claude does at his request. **Since 2026-11-11 it points
   at `wmkfresearchapps-e5t3tam4d-justin-gallivans-projects.vercel.app`
   (`dpl_EQFqtn7LtKy9G3XyNuspzzquvo6z`, `claude/j27-read-model` at
   `01a798524`)** `[VERIFIED via vercel inspect and the deployment's API
   meta]`. Previous target, to restore if needed:
   `dpl_2GaUBQnXmXsYd2WdYEnxAKfppSxV` (`ksb8kwki6`, `393da5dde`).
5. **Preserve:** sandbox fixtures 1000368 to 1000387; the untracked
   `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` in the main
   checkout (Codex's); the uncommitted `package-lock.json` in the J27,
   Codex dashboards and Codex J27 Factory worktrees; every other stream's
   branches, worktrees and settings.

## Stream A — J27 cycle page and request page (Claude, Session 673)

Session 673 finished every list on the J27 cycle page and made the request
page agree with it. The Deliberations and Final Assessment tabs are request
lists built from facts worked out on the server for every viewer, and the
request page uses the same facts. Two guards now stop group review before a
presentation (2027 and later cycles) and stop any review step for an
offramped request. Nothing is tied to the cycle named J27 any more. All on the
J27 line; **not promoted, not on the Preview, not exercised in a browser or
against live data.** The owner gave a standing go-ahead to build, with Codex
adversarial review of plans and builds and Claude deciding when iteration
stops (2026-11-10).

#### What Was Completed

1. **Owner decisions, 2026-11-10** (alignment log D60, D62 to D65 on the
   branch; the later-phase lists plan section 1 on `main`):
   - The later-phase facts move to the server, for the list and the page.
   - A Deliberations row shows a timing chip and no line until its
     presentation has ended. What is prepared before a J27 presentation will
     change and is undecided (D65 records the owner's account of how D26
     worked and why J27 differs).
   - Today's Staff deliberations and Final writeups panels are each tab's
     second section ("Drafts", "Writeup review"); the Deliberations one is
     temporary.
   - **No group review before a presentation** for J27 and later (D63); an
     offramped request does not go to the Board.
   - **Nothing hard-coded to J27** (D64): "We don't want things like that as
     hard coded." The owner expects the JXX / DXX cadence to continue and no
     wholesale change for D27. Recorded in
     `.claude-memory/feedback-minimize-per-cycle-configuration.md`.
   - Accepted as built: a request with a final decision is on All requests
     only (D62); Reviewer Finder's default stays the Narrative-Bibliography
     file, which Connor must create at intake (D60).
   - Accepted difference: only the request page knows when a saved review
     summary is out of date.
   - The Overview's tab-name links stay closed for now; polish waits until
     the plumbing is done (staff flow audit on `main`).
2. **Review of last session's file layout** (`2ad468d96`, `c6292bbf1`): the
   narrative not-found message names all three accepted places; the Proposal
   list's rule matches the readers.
3. **2027-or-later rule** (`31ee18bb6`): twelve literal `'J27'` tests replaced;
   seven `J27_`-named settings renamed (none was set in Vercel). Rollout plan
   lists each setting and whether it is deleted after go-live.
4. **Transition guards** (`91fc83581`, written by Codex, reviewed by Claude).
5. **Later-phase facts and lists** in three pieces, each reviewed by Codex:
   `75b73897f` (shared module `lib/services/workbench/j27-later-facts.js`),
   `3d9e71363` (feed and both lists), `562717d42`, `4a2f9c82e`, `ffdeedb43`
   (request page), `f5cbc0361` (Final Assessment hint fix, page test, probe).
   Every Codex finding was reproduced or checked before it was fixed; the
   review record is the plan's section 6.
6. **Sandbox fields checked** (read-only, sandbox-pinned,
   `scripts/probe-sandbox-j27-fields.cjs`): all eight fields the Preview
   settings would switch on exist.
7. **Records:** Atlas reader entries (request, request document, site visit),
   read-model plan C7 and step E amended, wiki page, alignment log, rollout
   plan, and the stale restatements on `main` reconciled (`33e2dc907`).
8. **Failing test fixed** (`3cb22bbb8`): the reviewer follow-up test expected
   the panel's loading text; the shell now shows "Loading…" until it knows
   the layout, for earlier-cycle links without a cycle too.

Verification at `f5cbc0361` (code unchanged since): full Jest, 1,562 suites
pass; type check; every `check:*` gate and its self-test pass except
`check:agent-invariants`, red only in the J27 worktree because its
per-machine memory link is missing. CI on `main` green at `6c96aab57`.
**Not exercised:** anything in a browser, the Preview, live Dataverse, the
feed's cost at volume (three batched reads per load; Codex counts at least
36 queries at 300 rows).

#### Commits

J27 line (`claude/j27-cycle-page`, all pushed): `3cb22bbb8`, `2ad468d96`,
`afad05e16`, `c6292bbf1`, `3f561b330`, `7ed3f9322`, `31ee18bb6`, `91fc83581`,
`e64587bc8`, `75b73897f`, `3d9e71363`, `562717d42`, `981095662`, `078cecef3`,
`4a2f9c82e`, `ffdeedb43`, `f5cbc0361`, `01a798524`.
`main` (documentation only, pushed): `5231fb6b3` through `33e2dc907`,
including the later-phase lists plan and this handoff.

### Next Items

#### Verified Open

1. **Browser walk-through on the Preview (owner signs in).** Done
   2026-11-11 at the owner's request: `claude/j27-read-model` fast-forwarded
   to `01a798524`, five Config settings added for that Preview branch
   (`INITIAL_RATIONALE_SCHEMA_READY`, `MEETING_ROSTER_SCHEMA_READY`,
   `CHAIRS_RECOMMENDATION_ENABLED`, `FINAL_WRITEUP_SCHEMA_READY` all `on`;
   `STAFF_DELIBERATIONS_SITE_VISIT_STATE_STATUS_PAIRS` copied from Production,
   `[[0,1,true],[1,2,true],[2,3,false],[3,4,true]]`), all read back from
   Vercel; the build was attested and the alias moved (rule 4). **Not yet
   done:** signing in and walking every tab, a request in each phase, and
   timing the feed. Note that `CHAIRS_RECOMMENDATION_ENABLED` still limits the
   step to test requests or the rehearsal request id.
2. **Confirm one behaviour on the request page** (owner): the stage strip,
   like the list, shows no next step in Deliberations until the presentation
   has ended. His decision was about the list row.
3. **D26 Grant Cycle links before promotion** (owner-run Production read):
   since `91fc83581` only a request linked to a pre-2027 Grant Cycle keeps the
   no-presentation exception. Rollout plan.
4. **Factory file plan** for J27-shaped sandbox files and scenario names:
   Codex's Factory stream; hand over a note rather than editing it.
5. **Promotion** remains the owner's decision; path in the rollout plan on
   the branch (migration 096 on Production first).
6. Carried: the Final Assessment tab's "Checking the writeup stage…" seen on
   #1000369 is likely the missing `FINAL_WRITEUP_SCHEMA_READY` on the Preview
   (status returns unavailable); confirm on the walk-through.

#### Owner Decision Needed

1. What is prepared and shared before a J27 research presentation (carried;
   D65 records the context). Revisits the Deliberations "Drafts" section.
2. When Connor's J27 `AI Materials` folder arrives: if it also holds a
   `Project-Narrative_{#}.pdf`, the AI readers see two copies and stop (D59).
3. Carried: offramp justification location and who sets Offramped; who sets
   the status that opens invitations; keeping the original Scoring answer;
   AI fit-flag meaning, intake outputs, queues, Chairs materials, calendar;
   which fields hold fuller budget information (D61).

#### Waiting On Connor

1. Reviewer copy flow on Recommended Invite (asked 2026-11-10).
2. The Narrative-Bibliography file at intake (D60) and the J27 `AI Materials`
   contents.

#### Parked

1. Polish pass, including the Overview tab-name links and the four Grant
   Cycle "Semi-Finalist" date labels (owner, 2026-11-10: after the plumbing).
2. Review-summary freshness on the list (accepted difference).
3. Carried: wide gap on large screens; Program Coordinator support; SoCal
   as a separate suite; readiness readback after December 8; Phase II, bulk
   edits, queues and packet exports; six older sandbox rehearsal titles.

#### Verify Before Acting

1. **`ffdeedb43` and `f5cbc0361` had no Codex review** (stop rule: two rounds
   per piece). Both are narrow, with tests that fail if their rule is
   removed.
2. **The stage model raises "presentation end not verified" when no
   presentation exists.** Existing reviewed tests require it; the list does
   not show it. Do not "fix" it without rechecking those tests.
3. **A not-yet-shared draft now reads "no Board draft" on the page** (it was
   "unavailable" under step E), to match the server.
4. **Preview settings to remove at promotion or retirement:** the
   branch-scoped `DYNAMICS_URL`, `POSTGRES_URL`, `DATABASE_URL`, the five
   Config settings added 2026-11-11 (Verified Open 1), and the Neon branch `j27-preview` (a copy of
   Production data; treat its connection string as a Production secret).
5. **Applying a migration with a pasted connection string:** use
   `read -s POSTGRES_URL`, export, print the host, then run
   `node scripts/apply-migrations.js` from the J27 worktree.
6. **#1000370's odd state is deliberate** (rollout rehearsal).
7. **The colleague deck is out of date** (do not start from
   https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj); the mock-up
   https://claude.ai/artifact/Fov94msvFQit3QZCzv4TZZ has invented data.
8. **Codex sandbox and git:** a Codex build run could not write the
   worktree's git index; Claude committed its work after review. Plan for it.

#### Do Not Reopen Without New Decision

1. Everything in Session 672's list (tabs and order; retired terms; wording;
   staff decisions in Phase I Status; no rerun on file replacement; J27
   Proposal section; D7, D8): `git show 33a233633:SESSION_PROMPT.md`.
2. Session 673's decisions above (D60, D62 to D65), and the closed Overview
   link finding.

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` (`main`) | The design, owner decisions, review record (section 6) |
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` (branch) | D53 to D65 |
| `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` (branch) | Settings table, Preview steps, pre-promotion checks |
| `lib/services/workbench/j27-later-facts.js` (branch) | The four later-phase facts, one rule for every reader |
| `lib/services/final-writeup/transition-schedule.js`, `transition-state.js` (branch) | The two guards; `stageFacts` on the status read |
| `shared/utils/j27PageStage.js` (branch) | The page's composer: whole keys, latest report wins |
| `shared/utils/j27CycleRows.js`, `shared/config/j27Labels.js` (branch) | List rules and labels |
| `shared/components/workbench/workbench-location.js`, `WorkbenchShell.js` (branch) | Tabs, second sections, old links |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest --testPathPatterns "tests/unit/(j27|workbench|final-writeup|staff-deliberations)"
npx jest   # full run at f5cbc0361: 1,562 suites pass
node scripts/probe-sandbox-j27-fields.cjs   # read-only, sandbox-pinned
```

No DEVELOPMENT_LOG entry: nothing reached Production.

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
