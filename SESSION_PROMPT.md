# Session 628 Prompt: Stage B co-PI backfill — read back staff answers, re-run resolve

## Concurrent Claude session summary — Stage B re-scope and staff review (Claude, 2026-10-21 PT)

Ran concurrently with the Codex sessions 625–627 below. Supersedes the Session 623 Claude Stage B handoff, which has been removed. Plan of record: `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` §3.2 (now covers this session's decisions).

### What Was Completed

1. **Stage B re-scoped (owner).** [VERIFIED via owner decisions in session] The owner approves strong-evidence groups only; a staff member (Duncan) works every individual-check row in AkoyaGO; the agent applies the answers. Memory `feedback-owner-review-burden-must-shrink` updated to match.
2. **Staff workbook built and shared.** [VERIFIED via builder output] `scripts/build-research-copi-staff-workbook.mjs` → `research-copi-staff-review.xlsx` in `~/Downloads/Research Co-PI Searches/stage-b/` (names; not in git), from resolve `05b61fa0` (file re-hashed to `05b61fa0`; input CSV hashes match its meta line). How-to tab plus parts: (1) existing contact? 17; (2) confirm single-signal Institution at Award 22; (3) find account 23; (4) current institution 23; (5) direct AkoyaGO fixes 13 (6 duplicate-PI merges, 1000954, 1001012, Billinge → UCSB, 4 ORCID held-back PIs: Hong, Reiners, Townsend, Vitelli). Hidden key column per row for read-back.
3. **The owner's shared copy is the working file.** It was shared before two pre-answers were built into the local copy; the owner is relaying them to Duncan: Part 1 994413 Mehrad and 995677 Oermann → "Not a co-PI" (each is the current Dynamics PI). Read back from the copy Duncan returns, by key; do not rebuild over it.
4. **Proposal PI vs Dynamics PI.** [VERIFIED via local CSV comparison, no Dataverse read] 153 extracted requests, 143 with an extracted PI, 10 differ. PI changed after award, left as is (owner): 990699, 991315, 992966, 994413, 995718. Two-PI grants: 992853, 994359, 995123, 995677, 995764 — owner: the other PI (Dykstra-Aiello, Bao, Ferguson, He, Kono) is a co-PI. New resolve flag `--approve-extracted-pi` adds them (test in `tests/unit/research-copi-stage-b.test.js`, 81 pass). Owner: award-time PIs that were replaced (e.g., Smith on 994413) stay unrecorded.
5. **Data folder restored.** The owner's CSVs went missing from SharePoint and were moved back to `~/Downloads/Research Co-PI Searches/`; all Stage B inputs and outputs present. `stage-b-v3/` created with the web cache copied in, ready for the re-run.

### Commits

- `a78a7f295` staff workbook builder and review split; `fea84c9c0` ORCID held-back PIs in Part 5 + memory.
- `06991e545` 994413 PI replacement; `8772473d6` PI comparison; `6f62592ae` 995718 PI change.
- `07c0899ee` `--approve-extracted-pi` for the five second PIs.
- This handoff commit follows.

## Next Items

### Verified Open

1. **Re-run the resolve after Duncan finishes Part 5** (owner-run, production read-only; ≤5 new web searches expected). Evidence: plan §3.2; `07c0899ee`.
   `node scripts/resolve-research-copi-institution-at-award.mjs --inputs-dir="$HOME/Downloads/Research Co-PI Searches" --out-dir="$HOME/Downloads/Research Co-PI Searches/stage-b-v3" --approve-budget-only=992950 --approve-unassessed=991649,994865 --approve-extracted-pi=992853,994359,995123,995677,995764`
   Then diff against `05b61fa0`: the five new rows, class changes from Duncan's merges, and confirm every staff-workbook key still resolves. Bring any of the five that are not `ready` to the owner as a short list, not a workbook.
2. **Read back Duncan's workbook** when returned (owner sends the file). Keys: `p1|…`–`p4|…` map to resolve keys; `p5|…` are direct fixes he reports as Done.
3. **Build apply/verify/rollback for Stage B** after the answers are in: creates contacts and junction rows (new for this backfill; delete-based rollback, own ledger kinds), sets Institution at Award, contact accounts only while empty. Codex adversarial review before any write. Evidence: plan §3.2 "Still open", §4.

### Owner Decision Needed

1. Approve the five groups in `research-copi-confirm-v2.xlsx` (recorded 47 pre-filled from earlier answers; existing-strong 15; new-strong 61; contact web-agrees 3; web-silent 28 with Billinge excluded).
2. Email for new contacts: proposal-era address, none, or kept marked unverified. Evidence: plan §3.2.
3. Locate the Stage A apply log (needed for `--rollback` of the 230 PI writes); it is not in the restored folder.
4. Connor's confirmation of the 2024-on split (plan §1, §4); held note to Connor (plan §7).

### Verify Before Acting

1. Part 5 tells Duncan to use "Personnel row", "co-PI slot", "project leader" and "merge" — AkoyaGO labels not verified by the agent. Check his notes for mismatches.
2. Plan line on 994465 being one of the 4 ORCID held-back cases is unconfirmed; the held-back four by contact id are Hong, Reiners, Townsend, Vitelli.
3. Accent-insensitive Dataverse name search is still `[ASSUMED]` (plan §3.2).

### Parked

1. PI/co-PI confirmation email campaign; earlier years (before 2017); 994464 and 1001976 — unchanged from plan §3.2/§6.

### Do Not Reopen Without New Decision

1. Do not record replaced award-time PIs (owner, 2026-10-21).
2. Do not route staff-workbook rows back to the owner one by one (memory `feedback-owner-review-burden-must-shrink`).
3. Do not re-run Stage A writes (hash `7e5cdcf7`) or the paid co-PI role check.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md` | Plan, results, owner decisions |
| `scripts/build-research-copi-staff-workbook.mjs` | Staff review workbook (five parts, hidden keys) |
| `scripts/resolve-research-copi-institution-at-award.mjs` | Stage B read-only resolve (owner-run) |
| `scripts/lib/research-copi-stage-b.mjs` | Stage B rules incl. `selectApprovedCopis` |
| `scripts/build-research-copi-confirm-workbook.mjs` | Owner group-approval workbook |

## Testing

```bash
npx jest tests/unit/research-copi-stage-b.test.js
```

## Handoff notes

Startup: all 71 gate/self-test runs green. No DEVELOPMENT_LOG.md milestone: nothing written to production, no capability shipped. CLAUDE.md unchanged. Claim-evidence pilot: 1 advisory recorded and classified in `docs/AGENT_ADJACENT_VERIFICATION_PILOT_DIRECTIVE.md`. Untracked `commit-times*.txt` in the repo root belong to another session and were left alone.

---

# Prior concurrent handoff snapshots — historical, not re-verified worklists

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
