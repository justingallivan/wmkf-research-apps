# Session 672 Prompt: Three open streams — J27 cycle page, expertise roster, Request narratives

## Start here, whichever agent you are

Three sessions closed on 2026-11-09 Pacific, each on its own stream. This file
holds all three handoffs. **Find out which stream the owner wants before doing
anything; if he does not say, ask.** Then read that stream's section and the
document it names. The other two streams are not yours to change.

| Stream | Last worked by | Resume in | Read first | First step |
|---|---|---|---|---|
| **A. J27 cycle page** | Claude, Session 671 | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, checked out on `claude/j27-cycle-page`; it and `claude/j27-read-model` are both at `026143d7b`, pushed | Stream A below; `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` | Trace and fix "Some details could not be read." (Stream A, Verified Open 1) |
| **B. Expertise roster** | Codex, Session 670 | `codex/expertise-roster-foundation-2026-11-09` at `1aedcb25d`, pushed (unverified work in progress; last verified foundation `d2b467e84`). Recorded worktree `/private/tmp/wmkf-codex-isolated-start-2026-11-09` | Stream B below; `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`, which is the authoritative resume boundary | Review and test the work in progress before extending it |
| **C. Request narratives** | Codex, Session 669 | `codex/request-narratives-2026-11-09` at `06e1ba6a4`, pushed and verified. Recorded worktree `/private/tmp/wmkf-request-narratives` | Stream C below; `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` | Power Automate initialization contract with Connor, then the J27 integration review |

Both Codex branch tips were confirmed on the remote at the close of Session
671 `[VERIFIED via git ls-remote, 2026-11-09]`. Everything else in Streams B
and C is copied from Codex's own handoffs and was not re-checked.

**Session numbers.** The three sessions overlapped. Request narratives closed
first as Session 669, the roster second as Session 670, and the J27 cycle page
last as Session 671. The next session is 672 whichever stream it takes. The
handoffs as their authors wrote them: `git show 7b7e483b0:SESSION_PROMPT.md`
(Request narratives), `git show 5782bad43:SESSION_PROMPT.md` (roster),
`git show f03936e3e:SESSION_PROMPT.md` (Session 668).

**Where the streams meet.** Stream C's Overview card must be reviewed against
Stream A's J27 line before any runtime promotion (Stream C, Verified Open 2).
Streams A and C both carry the same inherited J27 owner decisions; Stream A's
list is the current wording. No other overlap is known.

## Rules for every stream

1. **Nothing is promoted.** All three streams' runtime work is on feature
   branches. `main` deploys to Production on push; only documentation lands
   there without the owner's explicit go.
2. **Worktrees under `/private/tmp` are volatile.** If one is gone, the pushed
   branch is the source; do not recreate another agent's local-only data.
3. **Local runs read Production.** `.env.local` in the main checkout (linked
   from the J27 worktree) points at production Dataverse. Do not start the app
   locally to check something "against the sandbox".
4. **Sandbox Preview.** Only `claude/j27-read-model` has the branch-scoped
   sandbox `DYNAMICS_URL`. Staff sign-in works only through
   `wmkfresearchapps-preview.vercel.app`, the owner signs in himself, and the
   alias pointed at `wmkfresearchapps-f8n44w5wh-justin-gallivans-projects.vercel.app`
   when Session 671 closed. Check with `vercel inspect` before assuming.
5. **Preserve:** sandbox fixtures 1000368 to 1000387; the untracked
   `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` in the main
   checkout; the uncommitted `package-lock.json` in the J27 worktree; every
   other stream's branches, worktrees and settings.

## Stream A — J27 cycle page (Claude, Session 671)

The J27 cycle page went from an owner request to a built, reviewed and
Preview-checked first version. Documentation landed on `main`; runtime work is
on the J27 line and is **not promoted**.

#### What Was Completed

1. **Codex session closed out.** Its at-risk reports were copied to
   `~/Downloads/J27-review-2026-11-08/`; the main checkout returned to `main`.
2. **Plans, on `main`:** the cycle-page redesign plan, the staff flow audit
   (desk audit, owner answered its questions), the design brief (revision 2,
   after the owner reviewed a mock-up), and the build plan (three Codex
   adversarial reviews; section 7 records what was built and where it differs).
   All under `docs/plans/J27_CYCLE_PAGE_*_2026-11-09.md` and
   `docs/plans/J27_STAFF_FLOW_AUDIT_2026-11-09.md`.
3. **Terminology (owner):** "First Cut" and "Semi-finalist" retired in
   staff-facing text and in code; Dataverse choice names used; steps are
   "Scoring" and "Recommendation to Chairs" for now. Renamed on the J27 line
   (`7034cf2d7`; alignment log D52 on that branch).
4. **Cycle page built** on `claude/j27-cycle-page`, fast-forwarded into
   `claude/j27-read-model` (both at `026143d7b`, pushed). For a 2027-or-later
   Research cycle: tabs All requests, Initial Assessment, Peer Review,
   Deliberations, Final Assessment, Awardees. All requests, Initial Assessment
   and Peer Review are one shared row list (standing chip, next-step line,
   search, "Showing" menu, standing filter, "Show closed", reviewer progress on
   Peer Review only, "1 review outstanding", tab counts). Deliberations and
   Final Assessment mount today's panels. Old links map to the new tabs;
   earlier cycles and other programs are unchanged. The feed gained the request
   title, `stageProgramIds` and a per-reviewer `outstanding` count.
5. **Two red gates on the J27 line cleared** (`aa02f0068`): scoring route
   marked as not resolving a model; two J27 register rows rebound.
6. **Preview check** on the sandbox-backed Preview of `claude/j27-read-model`
   (owner signed in; alias repointed and restored). Layout, tabs, filters, old
   links and the December 2026 legacy layout behaved as designed.

Verification on the branch: 131 related suites (1,877 tests), the type check,
and the route, Atlas, label-parity, register and documentation gates. **The
full Jest run and the full gate list were not run after the build.**

#### Commits

`main` (docs): `647d0a46f`, `537f58c41`, `6f26df960`, `399095595`,
`07a1d0efe`, `d3d6b895c`, `e288dd038`, `a046f8a22`, plus this handoff.
J27 line: `7034cf2d7` (rename), `aa02f0068`, `34e467db8`, `056833739`,
`4038e8ace`, `026143d7b`.

### Next Items

#### Verified Open

1. **"Some details could not be read." (owner, 2026-11-09: seen often; do our
   best to address it).** On the sandbox Preview every J27 row was "degraded".
   `026143d7b` only collapses the note to one line above the list. Not yet
   traced: which input is unavailable. Start at
   `lib/services/workbench/j27-read-model-inputs.js:75-80` (a memo column whose
   wave is not provisioned is marked `unavailable`, the same status as a failed
   read) and the two batch reads at `:90-96`; `j27-read-model.js:149-153` turns
   any `unavailable` into "degraded". Decide whether "not provisioned on this
   deployment" should count, check Production's state, and apply the answer to
   the request page's stage strip too ("Some facts could not be read.").
2. **Deliberations and Final Assessment lists need their own plan.** Starting
   requirements and Codex's findings are in the build plan, section 3a; the
   four second-review findings there are as reported, not yet checked against
   source. Until built, a request in those phases shows its Peer Review
   standing on All requests.
3. **Run the full Jest suite and every gate on the J27 line** before anything
   further is built on it.
4. **Promotion of the J27 line is an owner decision, not yet taken.** It now
   includes the cycle page. Path when taken: Tier 2 per
   `docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md` (on the branch);
   merge order reports → read-model → factory. Do not merge without the go.
5. **Records not yet written:** the cycle-page decision in the alignment log
   (redesign plan, section 10: on the J27 line or on `main` after the merge),
   and the agent wiki page `docs/agent-wiki/topics/workbench-shell-handoffs.md`
   for the new layout.
6. **Request-page wording fixes** from the staff flow audit, plus one found in
   the build: the stage strip shows "Next: Identify reviewers" on a request
   that is waiting on the Chairs (build plan, finding 1).
7. **Final Assessment tab on the sandbox Preview** showed "Final writeup review
   tracking is unavailable until its Dataverse schema is verified." It comes
   from the existing panel; not confirmed to show the same on the old tab.
8. **Contract-reconcile review of the terminology rename** was not run.
9. Carried: deferred UI mirroring of the Offramped refusals (read-model plan
   §9 I6(a)); intake display and staff field contract with Connor.

#### Owner Decision Needed

1. What is shared with colleagues and the Chairs before a research
   presentation (drives what a Deliberations row says; build plan decision 3).
2. Whether Initial Assessment chips gain colour (owner prefers the Peer Review
   colours but is "not ready to change January yet").
3. Where the written offramp justification lives, and who sets Phase II status
   to Offramped (carried; with Connor and Sarah).
4. Who sets the status that opens reviewer invitations, and whether Dynamics
   draft-email triggers fire when Recommended Invite is written before the
   Chairs meeting (alignment log D52 on the branch flags this against D31).
5. Whether staff keep the original Scoring answer once a Recommendation to
   Chairs replaces the status (carried; earlier worded with the retired terms).
6. Whether the AI fit flag affects Flagged for concerns, remaining intake
   output formats and owners, staff queues, Chairs materials and calendar
   changes; the November 15 target needs reconfirmation (carried).

#### Parked

1. The wide gap between request details and the status column on a large
   screen (owner, 2026-11-09: later).
2. Program Coordinator support in the Workbench (owner: not urgent; he works
   mainly in Meeting Tracker). Tracked in `docs/CURRENT_WORK_QUEUE.md`.
3. Southern California as a separate app suite (D8). Re-open when the owner asks.
4. Research readiness readback after the December 8 readiness date. Load at
   300 requests can only be measured then; 20 sandbox fixtures exist.
5. Phase II, bulk edits, queues and packet exports; see the cycle plan.
6. Lockfile drift: uncommitted `package-lock.json` in the read-model worktree
   (and reportedly the factory worktree); hygiene only, left untouched.

#### Verify Before Acting

1. **Preview alias.** `wmkfresearchapps-preview.vercel.app` pointed at
   `wmkfresearchapps-f8n44w5wh-justin-gallivans-projects.vercel.app` at the end
   of this session (checked with `vercel inspect`). Check again before
   assuming. Staff sign-in works only through that alias, and the owner signs
   in himself.
2. **Sandbox setting.** The branch-scoped Preview `DYNAMICS_URL` (sandbox)
   exists for `claude/j27-read-model` only. A Preview of any other branch,
   including `claude/j27-cycle-page`, is not sandbox-backed. Remove the setting
   when that branch retires.
3. **Local runs read Production.** `.env.local` in the main checkout (and
   linked from the worktree) points at production Dataverse. Do not start the
   app locally to "check against the sandbox".
4. **The colleague deck is out of date** (owner): do not start an audit or a
   walkthrough from https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj. The
   stage model is correct; the deck predates the redesign.
5. **Mock-up.** https://claude.ai/artifact/Fov94msvFQit3QZCzv4TZZ is a static
   mock-up with invented data, private to the owner; the built page is the
   reference now.
6. **Codex's untracked brief.** `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md`
   sits uncommitted in the main checkout; the owner chose not to commit it.
   Preserve it.
7. **Memory on the branch.** `.claude-memory/project-vercel-cli-deploy-preview-auth.md`
   differs on the J27 line; it arrives with the merge.
8. Sandbox fixtures 1000368 to 1000387 stay; no deletion authorized.
   `/private/tmp/wmkf-j27-workbench-reports` is volatile and holds two
   untracked files; copies of the reports are in `~/Downloads/J27-review-2026-11-08/`.

#### Do Not Reopen Without New Decision

1. Tabs and order: All requests first and the opening view, then the four
   phases, then Awardees. Earlier cycles and other programs keep today's tabs.
2. Reviewer progress appears on the Peer Review list only; a waiting request
   shows a quiet status line with no role named.
3. A Phase I status the stage model does not map (Incomplete, Ineligible,
   Proposal Late, Rescinded Grant, Request Withdrawn, Deferred) is closed.
4. Before its presentation a Deliberations row shows no next-step line.
5. "First Cut" and "Semi-finalist" are retired, in text and in code.
6. D7 (offramp is `wmkf_phaseiistatus = 682090001`), D8 (the read model is
   Research-only), and scenario 7's sandbox status being observed, not asserted.

### Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md` | Findings, row rules, Codex reviews, owner decisions, what was built, later-phase requirements |
| `docs/plans/J27_CYCLE_PAGE_DESIGN_BRIEF_2026-11-09.md` | Layout and wording |
| `docs/plans/J27_CYCLE_PAGE_REDESIGN_PLAN_2026-11-09.md` | What the page contains; tab disposition |
| `shared/utils/j27CycleRows.js` (branch) | Chip, next-step line, notes, filters, counts |
| `shared/config/j27Labels.js` (branch) | One label list for the strip and the cycle page |
| `shared/components/workbench/J27RequestList.js`, `useJ27CycleRows.js` (branch) | The list and its one row read |
| `shared/components/workbench/WorkbenchShell.js`, `WorkbenchViewsNav.js`, `workbench-location.js` (branch) | Layout choice, tab sets, address keys and old-link mapping |
| `lib/services/workbench/j27-read-model-inputs.js` (branch) | Where "unavailable" inputs come from (Next Items 1) |

### Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest tests/unit/j27-cycle-rows.test.js tests/unit/workbench-shell-j27-layout.test.js tests/unit/workbench-location.test.js
npx jest   # full run not done since 680252fe5
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

## Other streams (not worked on 2026-11-09)

Dated inherited resume boundaries, not fresh audits or permissions.

| Owner / stream | Resume boundary and authority |
|---|---|
| Codex / J27 Factory | `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory`, `codex/j27-factory-scenarios` at `9070030c7`; `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` |
| Codex / J27 reports line | `/private/tmp/wmkf-j27-workbench-reports`, `codex/j27-workbench-reports` at `97f696faf`; that Codex session closed 2026-11-09; copies of its reports are in `~/Downloads/J27-review-2026-11-08/` |
| Earlier streams | Preview CSRF, per-reminder history, shared prompts, Integrity (Session 658), reviewer outcomes: boundaries unchanged from `git show 53066edc1:SESSION_PROMPT.md` |
