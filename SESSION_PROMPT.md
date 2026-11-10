# Session 672 Prompt: Fix "Some details could not be read", plan the later-phase lists; roster and Request-narratives streams continue

## Session 671 Summary — Claude, 2026-11-09 Pacific

Three sessions ran on 2026-11-09. Codex's Request-narratives handoff (Session
669) and expertise-roster handoff (Session 670) landed on `main` first; this
Claude session on the J27 cycle page closed last and takes the next number.
The roster handoff is preserved whole at `git show 5782bad43:SESSION_PROMPT.md`,
the Request-narratives one at `git show 7b7e483b0:SESSION_PROMPT.md`, and both
streams' durable details are in `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`
and `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md`. Their open items
are carried below by pointer; nothing in those streams was touched here.
Session 668 is preserved at `git show f03936e3e:SESSION_PROMPT.md`.

The J27 cycle page went from an owner request to a built, reviewed and
Preview-checked first version. Documentation landed on `main`; runtime work is
on the J27 line and is **not promoted**.

### What Was Completed

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

### Commits

`main` (docs): `647d0a46f`, `537f58c41`, `6f26df960`, `399095595`,
`07a1d0efe`, `d3d6b895c`, `e288dd038`, `a046f8a22`, plus this handoff.
Codex's docs landings on `main` the same day: `0944ec775` (#637), `0ca73a0dc` (#638).
J27 line: `7034cf2d7` (rename), `aa02f0068`, `34e467db8`, `056833739`,
`4038e8ace`, `026143d7b`.

## Next Items

### Verified Open

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
10. **Expertise roster (Codex stream, as recorded in its handoff; not checked
    here):** review and test the roster work-in-progress before extending it;
    build real import execution, then the dependent runtime consumers and the
    editor. A matching-prompt contract and a full isolated rehearsal are needed
    before cutover. Resume from `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`.
11. **Request narratives (Codex stream, as recorded; not checked here):** the
    external Power Automate initialization contract, J27 integration review and
    approved staff save/readback remain open. Recheck with
    `docs/plans/REQUEST_NARRATIVES_HANDOFF_2026-11-09.md` before acting; do not
    restart built code.

### Owner Decision Needed

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
6. Roster Production release is not authorized; private local exports and
   receipts need an approved secure location to continue on another Mac
   (roster handoff). Request-narratives release timing and its test request
   and environment are also the owner's (that handoff).
7. Whether the AI fit flag affects Flagged for concerns, remaining intake
   output formats and owners, staff queues, Chairs materials and calendar
   changes; the November 15 target needs reconfirmation (carried).

### Parked

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

### Verify Before Acting

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
8. **Roster local-only data and container paths** are in the roster handoff;
   Git does not carry them. No real data was imported into the sandbox.
9. Sandbox fixtures 1000368 to 1000387 stay; no deletion authorized.
   `/private/tmp/wmkf-j27-workbench-reports` is volatile and holds two
   untracked files; copies of the reports are in `~/Downloads/J27-review-2026-11-08/`.

### Do Not Reopen Without New Decision

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
7. The roster and Request-narratives decisions listed under this heading in
   `git show 5782bad43:SESSION_PROMPT.md` (one profile per person, lead
   eligibility, preserved expertise fields; narrative fields exist in
   Production and intentional human edits are never overwritten).

## Key Files Reference

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

## Concurrent Streams and Preservation

Dated inherited resume boundaries, not fresh audits or permissions. Preserve
fixtures, artifacts and other worktrees.

| Owner / stream | Resume boundary and authority |
|---|---|
| Claude / J27 line | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, checked out on `claude/j27-cycle-page`; it and `claude/j27-read-model` at `026143d7b`; build plan above |
| Codex / expertise roster | `/private/tmp/wmkf-codex-isolated-start-2026-11-09`, `codex/expertise-roster-foundation-2026-11-09`, pushed `1aedcb25d` (unverified work in progress; last verified foundation `d2b467e84`); roster handoff on `main` is the resume boundary; do not promote |
| Codex / Request narratives | `/private/tmp/wmkf-request-narratives`, `codex/request-narratives-2026-11-09`, `06e1ba6a4`; handoff on `main` |
| Codex / J27 Factory | `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory`, `codex/j27-factory-scenarios` at `9070030c7`; `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` |
| Codex / J27 reports line | `/private/tmp/wmkf-j27-workbench-reports`, `codex/j27-workbench-reports` at `97f696faf`; Codex session closed 2026-11-09 |
| Earlier streams | Preview CSRF, per-reminder history, shared prompts, Integrity (Session 658), reviewer outcomes: boundaries unchanged from `git show 53066edc1:SESSION_PROMPT.md` |

The Codex stream rows above are copied from the handoff at `5782bad43`, not
re-verified here.

## Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest tests/unit/j27-cycle-rows.test.js tests/unit/workbench-shell-j27-layout.test.js tests/unit/workbench-location.test.js
npx jest   # full run not done since 680252fe5
```

No DEVELOPMENT_LOG entry was required: nothing reached Production. The roster
handoff's own testing notes are in `docs/plans/EXPERTISE_ROSTER_HANDOFF_2026-11-09.md`.
