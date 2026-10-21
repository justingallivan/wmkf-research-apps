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
