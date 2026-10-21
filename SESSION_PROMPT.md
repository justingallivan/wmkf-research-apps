# Session 627 Prompt: Reviewer panel coverage parked pending single-phase priorities

## Session 626 Summary — Reviewer Finder strategy and pilot design (Codex, 2026-10-21 PT)

### What Was Completed

1. **Gap identified; potential solution drafted.** [VERIFIED via owner discussion and saved documents] Reviewer search should help staff assemble complementary expertise for consequential scientific judgments, not merely return individually plausible people. The forthcoming single-phase narrative and bibliography create richer inputs; this session did not verify their live availability.
2. **Pilot specification and fictional example.** [PLANNED, not executed] Three search approaches share input and resource budgets. Staff assess proposal-specific judgments, evidence-supported candidate contributions, critical coverage, useful overlap, and effort. The example contains no real reviewers, publications, or measured outcomes.
3. **Principles accepted in principle.** [VERIFIED via owner discussion] Criticality follows consequences for the scientific/funding decision, without requiring high-risk work to be already demonstrated. Secure critical coverage, avoid all critical judgments depending on one person, then add useful independent perspectives and supporting breadth. A concrete improvement must explain the gain and any loss; weighted coverage alone is insufficient.
4. **Smallest useful starting point.** [PLANNED] One staff-assisted practice report, with an editable coverage map and explicit candidate evidence/uncertainty, before automation or a scored comparison. A later product slice could add judgment annotations and staff-triggered gap searches. No implementation is authorized.
5. **Parked by owner.** [VERIFIED via final instruction] Other single-phase submission work takes priority. No practice application was selected. Do not run the pilot, expand the plan, or build functionality until Justin explicitly reopens this workstream.

### Commits

Planning branch `codex/reviewer-strategy`:
- `c2e5d9c64` — draft pilot specification and fictional coverage report.
- `6e0bfc4ab` — align drafts with agreed judgment, overlap, and improvement principles.
- `d689eb9eb` — park the pilot and record the smallest useful future scope.

The owner explicitly chose main for this session's handoff. The two planning documents are included with this handoff so future sessions can find them without switching branches. No runtime changes from this session are included.

## Next Items

### Parked

1. **Reviewer Finder complementary panel coverage.** Evidence: owner's 2026-10-21 instruction to set it aside while other single-phase submission work takes priority; linked pilot specification. Reopen only at Justin's direction. The gap and potential solution are recorded; the six-case comparison is not an immediate worklist.

### Verify Before Acting — only after reopening

1. Choose one substantive narrative plus bibliography for a practice case; an older full proposal may be a labeled format proxy. Confirm input identity/version, field availability, and staff participation before analysis.
2. Confirm resource limits, permitted model/services, report destination, and any reused route's audit-write behavior before execution. Prior willingness to pilot does not authorize named metered calls or production writes.
3. Re-read current source before implementation: this was strategy work, and parallel sessions may change the document readers, search pipeline, or UI. Do not infer deployment or live-input readiness from the design.

### Concurrent work

The previous handoffs below are preserved as historical snapshots, not current action lists. [VERIFIED via Git] Remote main already contains refactoring merge `73c5fb36f`; the older handoff's statements that that branch was unmerged are historical. This session does not assert production deployment or reauthorize any of its next steps. The shared checkout's preexisting untracked `commit-times.txt` and `commit-times-exact.txt` were preserved.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/REVIEWER_FINDER_PANEL_COVERAGE_PILOT_2026-10-21.md` | Parked strategy, practice-case scope, proposed experiment and decision criteria |
| `docs/plans/REVIEWER_FINDER_COVERAGE_EXAMPLE_2026-10-21.md` | Fictional evidence and panel tradeoff report |
| `.claude-memory/project-reviewer-panel-coverage-pilot.md` | Compact parked-workstream recall note |

## Verification and handoff

Planning branch startup checks and bounded reviewer tests were recorded earlier in this chat; none measures the proposed strategy's effectiveness. Documentation gates and sequential self-tests passed during drafting; final handoff checks are reported in the closing response. No pilot search, candidate outreach, paid model run, application change, or production data write occurred in this workstream.

No DEVELOPMENT_LOG.md milestone entry required: design exploration and a parked potential solution, with no capability shipped. CLAUDE.md is unchanged. Claim-evidence observation report returned local state unavailable; no observation row was invented. The reviewer-strategy worktree is retained. Owner: Codex; next action: wait for Justin to reopen the topic.

---

# Prior concurrent handoff snapshots — historical, not re-verified worklists

Preserved for continuity. Their dated branch/release statements may be superseded; use current Git, source, and owning-session decisions before acting.

# Session 626 Prompt: Choose an active user workflow before further performance work

## Session 625 Summary — Bounded refactoring and user-facing latency audit (Codex, 2026-10-21)

### What Was Completed

1. **Isolated refactoring branch.** [VERIFIED via Git] Runtime work is on `codex/refactor-inspection`, through `e2ee81769`, based on `fea84c9c0`. Worktree: `/Users/gallivan/.codex/worktrees/refactor-inspection/WMKF_Apps`. It is not merged into main. Owner chose main for stop-time documentation only. Do not infer runtime release from this handoff.
2. **Behavior-preserving extractions.** Executor budget editor; immutable Dossier/Review Panel file transport; PromptPublishForm; PolicyPublishForm/PolicyDiffBlock; ReviewQuestionRowEditor; model-override mapping helpers; OperationalEventCard; HealthHistoryCheckRow. A separate policy publication conflict-details fix forwards the comparison details. Scoped characterization/regression tests passed for each slice. The initial Executor extraction used independent Codex review; subsequent requested plan/build reviews used Claude Opus through host OAuth, with no API keys or Ultrareview.
3. **Read-only user-facing latency audit.** Traced Grant Reporting, Literature Analyzer, Expense Reporter and Expertise Finder. Serial processing and waits were source-verified; production latency and organic usage were not measured. The optional literature comparison is not requested by its current page, so parallelizing that branch is not a current UI speedup. Other sessions' Meeting/Workbench and research data work remained outside implementation scope.
4. **Owner direction on dormant apps.** Grant Reporting is out of date and should be reworked to integrate useful features elsewhere; destination/timing undecided. Literature Analyzer is substantially outdated; possible capability reuse elsewhere is an unverified owner recollection. These decisions are in the two linked project memory notes and deprioritize standalone optimization.
5. **Expense Reporter bounded concurrency.** [VERIFIED via branch source/tests] Two receipt pipelines overlap downloads and model calls; PDF parsing remains serial per request. Indexed results preserve equal/missing-date order; per-file errors and final response shape remain. Unexpected worker errors stop new work and drain in-flight work before ending the response. Opus plan review required this drain guard; amended plan and final implementation review were READY. Owner subsequently said the app is dormant and to leave it as it is: keep the completed commit, do no further work without a new decision.

### Commits (feature branch; not merged to main)

- `f62ac3218` — refactor(admin): extract Executor budget editor
- `e10acc54b` — refactor(storage): share immutable artifact byte transport
- `8aed7d863` — refactor(admin): extract prompt publication form
- `a20797137` — test(admin): pin policy publication outcome and retry behavior
- `9264b72eb` — refactor(admin): extract policy publication form
- `25b6dcc8c` — fix(admin): expose policy label-conflict comparison details
- `33095b7be` — test(admin): verify question conflict retry and type transitions
- `09785faa3` — refactor(admin): extract review question row editor
- `b6e52952d` — test(admin): pin model override mapping and ordered save behavior
- `810dd1cd5` — refactor(admin): share model override mapping helpers
- `e5728d703` — test(admin): pin operational event card controls and expansion
- `0bfe62b84` — refactor(admin): extract operational event card
- `d445f4f1b` — test: characterize health history row behavior
- `4c87e1e16` — refactor: extract HealthHistoryCheckRow
- `b69e1b40d` — docs: record future Grant Reporting rework
- `f3e269a88` — docs: record outdated Literature Analyzer and reassessment need
- `e2ee81769` — perf: process expense receipts with two bounded workers

## Next Items

### Owner Decision Needed

1. **Choose a currently used workflow for any further performance audit.** Evidence: owner shifted focus to user-facing latency, then identified Grant Reporting, Literature Analyzer and Expense Reporter as outdated/dormant. No next implementation target was selected. Expertise Finder concurrency is only an unmeasured candidate, not approved work.
2. **Disposition of the refactoring branch.** Evidence: Git branch and commits above. Publishing the branch for handoff does not authorize merging or deploying runtime changes. Reconcile against current main and review/test the intended release slice before any later promotion.

### Parked

1. **Grant Reporting rework/integration.** Evidence: `.claude-memory/project-grant-reporting-rework.md`. Reopen when owner chooses destination and scope.
2. **Literature Analyzer reassessment.** Evidence: `.claude-memory/project-literature-analyzer-rework.md`. Trace any reused capabilities before deciding the standalone app's future; no retirement authorized.
3. **Expense Reporter further work.** Evidence: owner's final instruction, “Let's leave it as it is.” The completed `e2ee81769` stays on the feature branch. No further optimization or stream-parser cleanup requested.

### Verify Before Acting

1. **Concurrent design/data work:** prior handoffs below are historical, not a fresh worklist. Main advanced independently during this session, including Stage B changes through `07c0899ee` at the stop preflight. Read the latest owner decisions and owning session before taking those surfaces; this session did not re-verify their data or authorization.
2. **Existing Expense Reporter limitations:** Opus observed a preexisting client parser that does not retain split stream chunks and processing that continues after disconnect. Neither was changed. Synthetic PDF parser probes were inconclusive even serially; no real parallel-PDF or production speedup claim is made.

## Key Files Reference

| Surface | Location / purpose |
|---|---|
| Runtime changes | `codex/refactor-inspection`, commits above; admin component extractions and storage transport |
| Expense Reporter | `pages/api/process-expenses.js` on the feature branch; two bounded pipelines |
| Grant Reporting direction | `.claude-memory/project-grant-reporting-rework.md` |
| Literature Analyzer direction | `.claude-memory/project-literature-analyzer-rework.md` |

## Verification and handoff

Each implementation slice passed its relevant tests; counts are per slice, not additive unique totals: Executor 36; file transport 182; PromptPublishForm 43; PolicyPublishForm 107; conflict details 108; review-question editor 154; model mappings 58; event card 83; health row 66. Expense Reporter passed 85 tests across seven suites, scoped lint, prompt-injection and API-route gates plus sequential self-tests. Concurrency regressions failed against the original serial implementation before passing after the change. No full production build or live performance acceptance is claimed for the final slice.

Claim-evidence report: local state unavailable; no observation row invented. No DEVELOPMENT_LOG milestone entry required: unreleased bounded refactoring/performance work and future-work notes, not a shipped architecture or capability. CLAUDE.md unchanged. Main's preexisting untracked `commit-times-exact.txt` and `commit-times.txt` were left untouched. The isolated worktree is retained. Stop-time doc gates and remote synchronization are reported in the closing response.

---

# Prior concurrent handoffs — historical snapshots, not re-verified worklists

The following text is preserved verbatim for the owning sessions. Newer main commits and owner decisions may supersede it; do not execute its next items without re-verifying scope.

# Session 625 Prompt: Review Workbench and Meeting coordination designs

## Session 624 Summary — Design exploration and audience split (Codex, 2026-10-20 PT)

### What Was Completed

1. **Design artifacts saved and merged to main.** [VERIFIED via git and saved files] Cycle schedule, Sessions, session detail, visit detail, PD Workbench and Duncan/superuser coordination layouts have standalone HTML and desktop/narrow captures under `docs/plans/review/meeting-tracker-2026-10-20/`. These are synthetic mockups, not application changes or production screenshots.
2. **Audience split.** [VERIFIED via owner decisions] PDs primarily consume meeting information and outputs in the Workbench. Duncan and superusers handle logistics, materials and transcript preparation/assignments. The saved flow map records the handoffs; exact runtime permissions and artifact visibility still need source/security review before implementation.
3. **Writeup first.** [VERIFIED via owner correction and “looks better” response] Staff Deliberations leads with working writeup/review, supporting video/transcript/summary links follow, meeting logistics are behind a compact link. `workbench-pd-writeup.html` is the current direction for further design. The materials-first mockup is superseded, retained as history. This is not implementation approval.
4. **Meeting coordination.** [VERIFIED via owner agreement] Provisional workspace title replaces Meeting preparation, with Before the meeting (setup, invitations, collection) and After the meeting (transcript preparation) groups. Four task views switch locally; other actions are inert. No sending, paid processing, uploads or production writes occurred.
5. **Terminology and build remain pending.** Do not implement app changes or infer final vocabulary from these mockups. Session detail still felt busy to the owner; its composition remains an exploration. The earlier assistant assurance about retaining slot sliders is design intent only: inspected SessionEditor currently uses a numeric minutes input, so verify the owner’s intended slider behavior before designing that edit state.

### Commits

- `bc184b4e1` cycle-schedule mockups and design handoff.
- `9fde7d84b` Sessions; `ec8445407` session detail; `833baf6a0` visit detail.
- `f490bc419` Workbench-first audience flow.
- `363b83684` materials-first Workbench (superseded); `4c6d1f0ef` writeup-first revision.
- `11be069e6` four-task coordination workspace; `9847ef6e4` provisional coordination title and before/after grouping.
- Merge and stop documentation commits follow; inspect Git history for identities.

## Next Items

### Verified Open — design only, owner-paced

1. Review the Meeting coordination workspace and refine the four task views. Evidence: saved HTML/captures and owner request. Calendar invitations versus agenda emails, recording intake/transcription generation and full output creation still need design; do not assume delivery or publication contracts.
2. Continue the writeup-first Workbench direction. Evidence: owner feedback and `workbench-pd-writeup.html`. Resolve lifecycle/role variants, unavailable/failed artifacts, active-meeting Join behavior and summary editorial responsibility before an implementation brief.

### Owner Decision Needed

1. Final meeting vocabulary remains pending colleague feedback. Evidence: `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md` and owner instruction this session.
2. App implementation scope is not authorized. Naming/layout discussion does not authorize route, identifier, schema or role changes.

### Verify Before Acting — separate Claude data work

Claude’s Session 623 handoff below is retained to avoid losing concurrent work. Its Stage B scope warning is owner-directed and remains important; Codex did not re-probe its production results or re-verify every carried item. Before any data work, read its plan/memory and re-scope with the owner. Do not treat the historical next-step list as a newly verified or authorized worklist. Stage B apply must not proceed without the scope decision. No data work was performed in this design session.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/review/MEETING_TRACKER_LANDING_STRUCTURE_2026-10-20.md` | Design index, decisions, historical/superseded mockups and limitations |
| `docs/plans/review/meeting-tracker-2026-10-20/workbench-audience-flow.md` | Audience flow and writeup-first hierarchy |
| `docs/plans/review/meeting-tracker-2026-10-20/workbench-pd-writeup.html` | Current PD Workbench direction |
| `docs/plans/review/meeting-tracker-2026-10-20/preparation-workspace.html` | Meeting coordination prototype (filename unchanged) |

## Verification and handoff

Startup: 70 checks/self-tests returned success; live factory-ledger check skipped without configured test URL. Mockups were rendered at 1440px and 390px with bounded independent visual review; no horizontal document overflow observed. Task switching and compact meeting disclosure were exercised. This is not runtime accessibility, authorization, delivery or publication verification. Relevant documentation gates ran before each save; final stop gates are reported in the closing message.

No DEVELOPMENT_LOG.md milestone entry required: design exploration only, no capability shipped. CLAUDE.md unchanged. Claim-evidence report returned local state unavailable; no observation row invented. Owner authorized landing/pushing these design docs on main after Claude left. Existing untracked `output/` and the October 19 board-writeups critique were preserved, not included. The isolated worktree is retained.

---

# Prior Claude handoff — historical snapshot, not re-verified by Codex

## Raise First (owner request, end of Session 623, 2026-10-20)

**Stage B is mushrooming. Re-scope with the owner before building anything else.** Owner: "I can't deal with this anymore … this seems to be mushrooming. We're now verifying 58 people by hand which is a larger task than what we've done thus far." Memory: `feedback-owner-review-burden-must-shrink`. Original ask (Session 622 handoff): build the Stage B resolve (read-only) and an approval workbook for the 136 approved 2017–2023 co-PIs and the 52 recorded 2024-on co-PIs. Owner-usable today: the resolve output and workbooks; nothing written to Dataverse.

Suggested cut to put to the owner: write only the strong-evidence groups, and leave every individual-check row unwritten (for staff or the parked confirmation campaign).

## Session 623 Summary — Stage B resolve built and run (Claude, 2026-10-20 PT)

All production reads were owner-run. Plan of record: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` §3.2 (full rules, counts, owner decisions).

### What Was Completed

1. **Read-only Stage B resolve.** [VERIFIED via sandbox runs and two owner-run production resolves] `scripts/resolve-research-copi-institution-at-award.mjs` with rules in `scripts/lib/research-copi-stage-b.mjs` (80 tests). Owner rules: Institution at Award only from our data (PI email domain → applicant, domain → account map, exact Account name); SerpAPI only for current-account evidence (owner authorized up to 400 searches; 118 used). Checks for duplicates (email, name + domain, nicknames, batch-level grouping), `is-pi`, `is-liaison`, Keck Foundation applicants, trashed requests. Three Codex adversarial rounds (gpt-6-astra): 4, 2, 1 findings, all fixed with tests.
2. **Production resolve `05b61fa0`** (owner-run, at `c2d154fe5`): extracted 98 ready / 20 no account / 15 possible existing contact / 2 is-pi / 1 conflict; recorded 47 ready / 1 is-liaison (1001012, Aaron Diaz) / 2 is-pi (1000954) / 2 no account; 31 contact accounts ready, 6 web conflicts, 2 unresolved. Output in `~/Downloads/Research Co-PI Searches/stage-b/` (restricted, not in git).
3. **Approval workbook** `research-copi-confirm-v2.xlsx` from `scripts/build-research-copi-confirm-workbook.mjs`: 5 group decisions + 58 individual checks. The owner's earlier row-by-row answers (47 recorded rows) carry over by key; Billinge's contact row is pre-excluded.
4. **Owner findings recorded in the plan:** the 2017–2023 total is 136 (the old "133" line was stale); Billinge was at Columbia at the 1001565 award and is now at UCSB (Institution at Award right, latest-award contact account stale); the web check found nothing usable for 28 of 37 contacts; the confirmation email campaign is parked.

### Commits

`5eeba6f8d`..`980478a77` on `main` (11 commits, all pushed). Key ones: `5eeba6f8d` resolve; `12c0f9fe1`/`474ec8b5e`/`158bfefb2` Codex fixes; `c2d154fe5` liaison check, contact web check, workbook builder; `b5a7da11f` re-run record; `980478a77` scope note and memory. This handoff commit follows.

## Next Items

### Owner Decision Needed

1. **Stage B scope cut** (see Raise First). Evidence: plan §3.2; `research-copi-confirm-v2.xlsx`. Do not build the apply step until decided.
2. **Email for new contacts** (81 proposed): proposal-era address, none, or kept in a secondary field marked unverified. Evidence: plan §3.2 "Still open". The parked campaign would need a working address.
3. **Billinge's current institution (UCSB)** needs an override path if contact accounts are written. Evidence: plan §3.2 owner findings.
4. **Send the held note to Connor.** Evidence: plan §7. Owner is waiting on another thread with him.
5. **Colleague vocabulary review.** Evidence: `docs/plans/review/PROPOSAL_WORKFLOW_VOCABULARY_2026-10-19.md`.
6. **Meeting Tracker redesign direction.** Codex was working on it in its own worktree this session. Evidence: `.impeccable/critique/2026-10-19T22-21-01Z__nts-meeting-tracker-meetingtrackerlist-js-ef43d395.md`.

### Verified Open

1. **Data fixes for staff in Dynamics.** Evidence: plan §3.1, §3.2. Merge the 6 duplicate PI contacts (992966, 994465, 1001530, 1001618, 1002341, 1002353); 1000954 (PI row names another contact; its slot co-PI is the PI); 1001012 (liaison recorded as co-PI); the 4 held-back ORCID duplicate cases.

### Parked

1. **PI/co-PI confirmation email campaign** (owner, 2026-10-20). Evidence: plan §3.2. Re-open when the owner schedules it.
2. **Earlier years (before 2017).** Evidence: plan §6.
3. **994464** ("Zhange"; owner handling). **1001976** trashed Keck Foundation test grant; three duplicate "W. M. Keck Foundation" accounts exist.

### Verify Before Acting

1. Accent-insensitive Dataverse name search is `[ASSUMED]`, not probed (plan §3.2).
2. Session 620 limits carried: audio PR #513 released (`413c5f048`); no fresh Production transcription or 4 GB rerun proved; Board real release/email/archive acceptance unproved.

### Do Not Reopen Without New Decision

1. Do not re-run Stage A writes (hash `7e5cdcf7`) or the paid co-PI role check.
2. PRs #506, #511, #512, #513 merged; keep `codex/legacy-test-request-1002788` (`e563c5f3b`) unmerged.
3. Proposed naming does not imply route, database, API or identifier migration.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` | Plan, Stage A/B results, owner decisions |
| `scripts/resolve-research-copi-institution-at-award.mjs` | Stage B read-only resolve (owner-run) |
| `scripts/lib/research-copi-stage-b.mjs` | Stage B rules (`tests/unit/research-copi-stage-b.test.js`) |
| `scripts/build-research-copi-confirm-workbook.mjs` | Group-approval workbook from a resolve run (local files only) |
| `scripts/backfill-research-pi-institution-at-award.mjs` | Stage A (applied) |
| `docs/atlas/dataverse-wmkf-apprequestperson.md` | Junction Atlas incl. backfill state |

## Testing

```bash
npx jest tests/unit/research-copi-stage-b.test.js tests/unit/research-iaa-backfill.test.js tests/unit/research-copi-roles.test.js
```

## Handoff notes

No DEVELOPMENT_LOG.md milestone: nothing was written to production and no capability shipped. CLAUDE.md needs no change. Claim-evidence report: no eligible event, no row. Sandbox runs: set `DYNAMICS_URL=https://orgd9e66399.crm.dynamics.com` on the command line. Codex worked in its own worktrees; the untracked `output/` and `.impeccable/critique/2026-10-19T02-04-42Z__…` in the shared checkout belong to another session and were left alone. Sandbox resolve output (names) was deleted from the session scratchpad at handoff.
