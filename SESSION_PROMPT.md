# Session 675 Prompt: Three open streams — J27 line reviewed and walked, expertise roster, Request narratives

## Start here, whichever agent you are

This file holds three handoffs. Stream A was worked in Session 674
(2026-11-12, Claude). Streams B and C were not touched by Claude and are
carried as their authors wrote them on 2026-11-09. **Find out which stream the
owner wants before doing anything; if he does not say, ask.** Then read that
stream's section and the document it names. The other two streams are not
yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 cycle page and request page** | Claude, Session 674 (2026-11-12) | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, on `claude/j27-cycle-page` at `3499d8730`, pushed. `claude/j27-read-model` (the sandbox Preview branch) is at `72368357e` (same code; later commits are docs and probes) and deployed; the stable alias points at it | Stream A below; `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` on the branch | Owner's promotion decision (Stream A, Verified Open 1) |
| **B. Expertise roster** | Codex, Session 670; Codex again 2026-11-10 and 2026-11-11 | **Observed 2026-11-12 by Claude, not Codex's own record:** `codex/expertise-roster-import-2026-11-10` last commit 2026-11-11 15:37 ("record reviewed native output schema build"), worktree `/Users/gallivan/Code/WMKF_Apps-codex-roster-import`. Codex's own section below still names the 2026-11-09 branch | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`; that branch's own handoff commits | Ask Codex or the owner for the current boundary; do not resume from the 2026-11-09 text alone |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed. Recorded worktree `/private/tmp/wmkf-request-narratives` is gone from disk | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |

**Other Codex work seen 2026-11-12 (observed by Claude; not a handoff, not
Claude's to change):**
- A Codex app session runs with the main checkout as its working directory.
  Its latest work is `codex/power-automate-integration-2026-11-11` in
  `/private/tmp/wmkf-pa-integration-20261111` (last commit 2026-11-12 20:32,
  "Record bounded trial stop at sandbox Request creation"); surface: Power
  Automate, shared prompt jobs, sandbox Request creation.
- `codex/coordinated-start-2026-11-10-b` (pushed) carries **Codex's own
  "Session 674 / 675" handoff**, which it calls branch-local: the shared
  Executor trial and four Sandbox recommendation jobs whose due-only cleanup
  deadlines fall on 2026-11-12 and 2026-11-18 (Phoenix time). That cleanup is
  Codex's. **Session numbers now clash**: this file's 674 is Claude's Stream A
  session; whoever lands a handoff on `main` next reconciles.
- `/private/tmp/wmkf-staff-draft-store-20261111` has uncommitted Codex changes
  to `lib/services/execute-prompt.js` and `lib/services/prompt-jobs/*`.

**Session numbers.** 669, 670 and 671 overlapped on 2026-11-09; 672 and 673
were Stream A on 2026-11-10 to 2026-11-11; 674 was Stream A on 2026-11-12
(Claude; see the clash above). The next session is 675 whichever stream it
takes. Earlier handoffs: `git show 146980bc6:SESSION_PROMPT.md` (Session 673
close), `git show 33a233633:SESSION_PROMPT.md` (Session 672),
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
2. **Worktrees under `/private/tmp` are volatile.** Several Codex ones listed
   by `git worktree list` are gone from disk (git marks them prunable; not
   pruned). If one is gone, the pushed branch is the source.
3. **Local runs read Production.** `.env.local` in the main checkout (linked
   from the J27 worktree) points at production Dataverse and the Production
   Postgres database. Production reads are owner-run: hand him the command,
   with real values, never `<placeholders>` (the shell reads `<x` as a file
   redirect; it happened 2026-11-12). A sandbox read is allowed only pinned to
   the sandbox host `orgd9e66399.crm.dynamics.com`
   (`scripts/probe-sandbox-j27-fields.cjs` is the pattern).
4. **Sandbox Preview.** Only `claude/j27-read-model` has the branch-scoped
   sandbox `DYNAMICS_URL` and its own Postgres database (Neon branch
   `j27-preview`). Staff sign-in works only through
   `wmkfresearchapps-preview.vercel.app`; the owner signs in and repoints that
   alias himself, or Claude does at his request. **At the close of Session
   674 it points at `wmkfresearchapps-6dchnuvu8-justin-gallivans-projects.vercel.app`
   (`dpl_CLcVRmYVBNEShTeszJeqH9ebheU7`, `claude/j27-read-model` at
   `72368357e`)** `[VERIFIED via vercel inspect and the deployment's API
   meta]`. Earlier targets the same day, to restore if needed:
   `dpl_ARxww8Gb6byXvihGmTWzGPC1Lorv` (`cc603be5e`),
   `dpl_THWVcsoBdLRjDACMEukwuUE69VgT` (`5f81733db` with the new setting),
   `dpl_HfWztktsLVVAXXAYLS26kgbFfMkE` (Session 673 close).
5. **Preserve:** sandbox fixtures 1000368 to 1000387, including the
   presentation record added to #1000383 on 2026-11-12 (Stream A item 4); the
   untracked `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` in the
   main checkout (Codex's); the uncommitted `package-lock.json` in the J27,
   Codex dashboards and Codex J27 Factory worktrees; every other stream's
   branches, worktrees and settings.

## Stream A — J27 cycle page and request page (Claude, Session 674)

Session 674 took the owner's Preview walk-through ("didn't notice anything
amiss") and a second look in Chrome, fixed what that found, had the
unreviewed J27 commits reviewed by Codex, put a request into Deliberations on
the sandbox, and ran the two pre-promotion Production checks with the owner.
All on the J27 line; **not promoted.** The owner's standing go-ahead to build,
with Codex adversarial review and Claude deciding when iteration stops
(2026-11-10), still applies.

#### What Was Completed

1. **Writeup review on the Preview.** The Final Assessment tab's "Writeup
   review" section failed with "Final writeup review tracking is unavailable":
   it needs `FINAL_WRITEUP_ACKNOWLEDGEMENT_SCHEMA_READY`, which Production has
   and the Preview branch did not (the 2026-11-11 note blamed
   `FINAL_WRITEUP_SCHEMA_READY`; corrected in the rollout plan). The sandbox
   schema checked exact and Active (read-only preflight, 11 exact); the
   setting was added `on` for `claude/j27-read-model`, read back, redeployed;
   the section now loads. **Six** branch-scoped Config settings now.
2. **Request page agrees with the list (`cc603be5e`, `5a3acc796`).** A Peer
   Review list row opens the request on its Peer Review tab, where the
   Overview, the only reader of the reviewer rollup, never mounted; #1000386's
   strip read "Reviewer invitations are not open yet" while its row read
   "Next: Identify reviewers". A 2027-or-later request page now reads the
   rollup itself (`shared/components/workbench/useReviewerProgress.js`),
   reports it to the strip and passes it to `OverviewTab`, which then reads
   nothing of its own; each return to the Overview reads it again. Earlier
   cycles unchanged. Read-model plan C7 amended (one rollup read added for a
   page opened on another tab).
3. **Codex adversarial review** of `ffdeedb43` through `cc603be5e` (the
   commits that had none): needs-attention, one medium finding, reproduced
   (page-owned counts went stale after reviewer updates); fixed in
   `5a3acc796`; second round **approve**, no material findings. Nothing found
   in the D66 / D67 commits.
4. **Deliberations fixture (owner go).** The sandbox had no request in
   Deliberations. One presentation record on #1000383
   (`wmkf_sitevisits` `f127beed-18df-f111-84ea-70a8a59af221`, "TEST: J27
   Deliberations walk-through (no meeting)", 2027-03-15 17:00 to 17:30 UTC,
   no attendees, nothing sent), by a one-off sandbox-pinned script (the
   Meeting Tracker is off on this Preview). The Deliberations row and the
   request strip both show no next step before the presentation ends:
   **Verified Open 2 of Session 673 is confirmed.** Delete that record to
   restore #1000383 as a plain Scored fixture.
5. **#1000370's list counts vs Track** ("0/3 accepted" vs two "Review
   Received"): rehearsal data with reports on never-invited reviewers; both
   views read the same rows. No change.
6. **Pre-promotion Production checks (owner-run, 2026-11-12):**
   - `scripts/probe-group-review-cycle-links.cjs` (new): one request could
     still start group review, #1003313 (no Grant Cycle link, document D26,
     complete review, one presentation record); none refused. The new
     linked-cycle rule does not touch it, because it has a presentation;
     whether that presentation reads as ended was not checked.
   - `scripts/probe-workbench-load-timing.js` (extended: `--cycle` now
     reaches the request list, `--scope`, `--later-facts=yes`; bundle fixed in
     `dabdf5378` for `createRequire(import.meta.url)`): D26, all directors, 25
     requests. List 2.8 s cold / 0.7 s warm; the three later-phase reads 0.93 /
     0.44 s, none unavailable; Deliberations panel 3.0 / 1.0 s.
7. **Records:** rollout plan (Preview moves, settings, fixture, both probe
   results), read-model plan C7 amendment, all on the branch.

Verification: the J27, workbench, Overview and reviewer suites pass (308
suites, 5,754 tests) and the type check is clean at `5a3acc796`; new tests
fail when their rule is removed; the doc and script-scanning gates pass. No
full Jest run this session. Every `check:*` gate and self-test passed on
`main` at session start.

#### Commits

J27 line (`claude/j27-cycle-page`, all pushed): `cc603be5e`, `851aaf35e`,
`5a3acc796`, `72368357e`, `a59a8f36d`, `5cb204db9`, `dabdf5378`, `3499d8730`.
`main`: this handoff only.

### Next Items

#### Verified Open

1. **Promotion** is the owner's decision; path in the rollout plan on the
   branch (migration 096 on Production first; remove the six Preview Config
   settings, the three branch-scoped connection settings and the Neon branch
   at promotion or retirement).
2. **Factory file plan** for J27-shaped sandbox files and scenario names, and
   a Deliberations scenario so the #1000383 record can go: Codex's Factory
   stream; hand over a note rather than editing it. Not sent yet.
3. **Optional before promotion:** whether #1003313's presentation reads as
   ended under Production's state/status pairs (extend the cycle-links probe
   to print end, state and status; owner-run). Not a blocker: the rule there
   is unchanged by the J27 line.
4. **Not measured:** a 300-request cycle. D26 gave 25 rows, one batch per
   read; 300 would need about twelve (Codex's 36 queries). Whether the
   batches run in sequence was not checked.

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
3. The Deliberations "Drafts" section and the Peer Review "Reviewers" section
   still list every request in the cycle (older panels kept on purpose).
4. The request page's "Staff assessment of the presentation" box can be
   saved before the presentation (existing tab behaviour; the strip asks for
   it only afterwards). Seen on #1000383; not raised with the owner as a
   change.
5. Carried: wide gap on large screens; Program Coordinator support; SoCal
   as a separate suite; readiness readback after December 8; Phase II, bulk
   edits, queues and packet exports; six older sandbox rehearsal titles.

#### Verify Before Acting

1. **The stage model raises "presentation end not verified" when no
   presentation exists.** Existing reviewed tests require it; the list does
   not show it. Do not "fix" it without rechecking those tests.
2. **A not-yet-shared draft reads "no Board draft" on the page**, to match
   the server.
3. **Neon branch `j27-preview`** is a copy of Production data; treat its
   connection string as a Production secret.
4. **Applying a migration with a pasted connection string:** use
   `read -s POSTGRES_URL`, export, print the host, then run
   `node scripts/apply-migrations.js` from the J27 worktree.
5. **#1000370's odd state is deliberate** (rollout rehearsal).
6. **The colleague deck is out of date** (do not start from
   https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj); the mock-up
   https://claude.ai/artifact/Fov94msvFQit3QZCzv4TZZ has invented data.
7. **Codex sandbox and git:** a Codex build run could not write the
   worktree's git index; Claude committed its work after review. Codex's
   review run could not run Jest in its read-only sandbox either.
8. **Watching a Preview build:** `vercel inspect` prints on stderr; capture
   with `2>&1`. `vercel ls --meta githubCommitSha=<sha>` finds a branch build.
   `vercel redeploy <url> --target preview` rebuilds with new settings.
   Recorded in `.claude-memory/project-vercel-cli-deploy-preview-auth.md`.
9. **The Chrome extension's first navigation in a new tab group often fails**
   ("browser-internal URL"); navigate again. The request page refuses to be
   framed, so read it by navigating, not with an iframe.

#### Do Not Reopen Without New Decision

1. Everything in Session 672's list (tabs and order; retired terms; wording;
   staff decisions in Phase I Status; no rerun on file replacement; J27
   Proposal section; D7, D8): `git show 33a233633:SESSION_PROMPT.md`.
2. Session 673's decisions (D60, D62 to D67), and the closed Overview link
   finding: `git show 146980bc6:SESSION_PROMPT.md`.
3. The Deliberations row and request strip show no next step before the
   presentation ends (owner's list decision; page confirmed 2026-11-12).

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` (branch) | Settings, Preview moves, fixture, pre-promotion checks and results |
| `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` (branch) | C7 read budget and its 2026-11-12 amendment |
| `docs/plans/J27_LATER_PHASE_LISTS_PLAN_2026-11-10.md` (`main`) | The later-phase design and review record |
| `pages/workbench/[requestId].js`, `shared/components/workbench/useReviewerProgress.js`, `OverviewTab.js` (branch) | Page-owned reviewer rollup |
| `shared/utils/j27PageStage.js`, `j27CycleRows.js` (branch) | The page's composer; list rules |
| `lib/services/workbench/j27-later-facts.js` (branch) | The four later-phase facts |
| `lib/services/final-writeup/transition-schedule.js` (branch) | Group-review guard and the earlier-cycle exception |
| `scripts/probe-group-review-cycle-links.cjs`, `scripts/probe-workbench-load-timing.js` (branch) | Owner-run pre-promotion probes |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest tests/unit/workbench tests/unit/j27 tests/unit/overview tests/unit/reviewer
npm run check:types
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
