# Session 669 Prompt: Plan the J27 cycle page and audit the staff flows

## Session 668 Summary — Codex then Claude, 2026-11-06 to 2026-11-09 Pacific

Codex opened the session with the J27 Workbench development brief and the
reports line; Claude carried the J27 read model from plan to a reviewed branch.
Nothing merged to `main`. Session 667 is preserved at
`git show 53066edc1:SESSION_PROMPT.md`.

### What Was Completed

1. **J27 read model and discovery on `claude/j27-read-model`** (based on
   `codex/j27-workbench-reports` at `97f696faf`; tip `680252fe5`, pushed).
   Steps C to F, E and I of the read-model plan
   (`docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md`, on the branch,
   not yet on main) are built,
   Codex-reviewed to READY and recorded in `docs/plans/J27_*_REVIEW_2026-11-09.md`.
   Pure stage derivation; Research-only program gate (D8); discovery admits every
   ready J27 Research request (step F); request-page recomputation with a
   read-only stage strip (step E); the offramp read as Phase II status
   `682090001` "Phase II Offramped" with server refusals on every presentation,
   materials and invitation write (step I; D7 closed, D51 logged). Full Jest,
   unit and integration, is green on the branch; two integration suites and
   four unit suites that the reports line had turned red were repinned.
2. **J27 Factory batch on `codex/j27-factory-scenarios`** (tip `9070030c7`,
   pushed). Owner-authorized GoVerify bypass created synthetic requests
   1000380 to 1000387 in sandbox `orgd9e66399`; scenario 7 (1000386) completed
   with the derived request status observed, not asserted. Sandbox request
   status rules are stale 2024 copies and differ from production; see memory
   `project-sandbox-request-status-business-rules`.
3. **Preview smoke and walkthrough deck.** The stage strip, the dashboard and
   five request states were captured on a sandbox-backed Preview and assembled
   into a fifteen-slide deck for colleagues:
   https://claude.ai/artifact/Q3dicY5DA2vGBrVPA2bXwj (private until shared).
   A branch-scoped Preview `DYNAMICS_URL` (sandbox) exists for
   `claude/j27-read-model`.
4. **Branch hygiene.** `codex/j27-semi-finalist` is superseded by the reports
   line, pushed and parked; its route test was ported (`4358a08ab`). Merge
   rehearsal recorded in plan §10: reports → read-model → factory merge cleanly.
5. **Stopgap tab reorder** (`680252fe5`): Initial assessments now leads the
   cycle-page tab row. The owner called this insufficient; see Next Items 1.

### Commits

Read-model branch, 2026-11-09 (oldest first): `ff1a978cf`, `470cd3f76`,
`e1b24f6a7`, `fec2c7228`, `f75704137`, `62855a91b`, `881aad5bd`, `406727a74`,
`9469c47b5`, `af82d6b91`, `65ae8d088`, `e814aed1e`, `446acf4cb`, `4da4947ae`,
`9d7f6aee1`, `b43dfe68f`, `00bc221ea`, `4358a08ab`, `90142b22b`, `806c446c4`,
`1556da9e9`, `806e7bc6c`, `52fc7a6b6`, `b0b4f21d9`, `591f33267`, `74f6b8111`,
`480464177`, `680252fe5`. Factory branch: `e0ad4ade7` to `9070030c7`.

## Expertise roster migration planning — November 9, 2026

Justin and Codex recovered the earlier roster migration design and settled the
schema decisions with Connor supporting the direction. The implementation plan
is `docs/plans/EXPERTISE_ROSTER_DATAVERSE_MIGRATION_PLAN_2026-11-09.md`.
This is planned work, not a provisioned table or deployed migration. One profile
per person, no program partition or Short ID, separate lead-PD eligibility,
optional external Contact links, Active/Inactive only, optional preserved
expertise fields, and unchanged editor access are settled. Expertise wording,
scoring and recommendation policy remain deferred. Beth's eligibility and the
two new PD identities remain import confirmations. Claude Fable 5.2 reviewed the plan via approved OAuth and returned READY WITH
NAMED CHANGES. The repairs are incorporated; the original review and disposition
are in `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_2026-11-09.md`. Third Fable OAuth review confirmed B1–B5 and all six rehearsal gates resolved.
Its two new cutover findings were repaired with inert automatic migrations, a
gated operational cutover script, and isolated v2 prompt/admission controls.
See `docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_3_2026-11-09.md`. The final Fable plan check returned READY with no named repairs; see
`docs/plans/EXPERTISE_ROSTER_FABLE_REVIEW_4_2026-11-09.md`.
Offline foundation built on `codex/expertise-roster-foundation-2026-11-09` in
`/private/tmp/wmkf-codex-isolated-start-2026-11-09`: schema spec, inert bridge SQL
draft and file-only import planner. Synthetic verification and runbook:
`docs/plans/data/expertise-roster/README.md`. Real inventory and a synthetic-only
local PostgreSQL 17.11 rehearsal database are prepared; see
`docs/plans/data/expertise-roster/INVENTORY_AND_REHEARSAL_2026-11-09.md`.
39 roster rows, 10 healthy Contact links, 7 feedback references. Slot attendee maps are inherited from parent sessions; the reported missing-field
issue was an inventory interpretation error, now resolved. The active
"TBD: Neurodegeneration specialist" roster placeholder needs an import decision. Mapping confirmation and sandbox
schema provisioning remain pending; no Production writes. Owner prompt approval and platform rehearsal
gates remain prerequisites; no schema or runtime has been deployed. The existing J27 stream below is
preserved and has not been resumed by this planning task.

## Next Items

### Verified Open

1. **Cycle-page redesign plan (owner, 2026-11-09): first thing.** The request
   page was rebuilt for J27 (Overview plus four phases) but the cycle-level
   Workbench page still carries six tabs accumulated since September: Request
   list, Reviewer follow-up, Staff deliberations, Initial assessments, Final
   writeups, Awardees. Write a plan, for owner review before any build, that
   reorganizes the cycle page by the request page's phases (Initial
   Assessment, Peer Review, Deliberations, Final Assessment, then Awardees),
   Research-only like the strip. State which tabs become phases, which become
   content inside a phase (Reviewer follow-up is Peer Review's cycle view, not
   a tab; it is the old Review Manager lifted into the shell on 2026-09-01),
   and which go away. Each phase view can list the cycle's requests with the
   stage model's next task and blockers, already computed per dashboard row.
   Log the decision in `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md`.
   Evidence: `shared/components/workbench/WorkbenchViewsNav.js`; memory
   `project-j27-cycle-page-redesign-pending`.
2. **Staff flow audit (owner, 2026-11-09).** Alongside item 1, audit whether
   the J27 flows make sense to the people using them: walk each phase as a
   Program Director, a Program Coordinator and the Grants Manager, note where a
   step, label or tab does not match how they work, and bring findings to the
   owner before the cycle-page plan is final. Start from the deck above and
   sandbox requests 1000380 to 1000387.
3. **Promotion of the J27 line is an owner decision, not yet taken.** The owner
   wants a hands-on look first. Path when taken: Tier 2 per the rollout plan
   (`docs/plans/J27_WORKBENCH_PRODUCTION_ROLLOUT_2026-11-07.md`, on the branch); merge order
   reports → read-model → factory (plan §10). Do not merge without the go.
4. **Deferred UI mirroring of the Offramped refusals** (plan §9 I6(a)):
   `SiteVisitEditor`, `SiteVisitMaterialsCard`, `PresentationInvitationPanel`,
   `RecordingAndTranscriptCard` still show their controls; the server refusal
   sentence reaches them through existing error paths.
5. **Intake display and staff field contract** (carried from Session 667).
   Connor owns intake AI Summary, Fit Flag, Fit Rationale and draft staff
   rationale; Justin owns the app. Agree fields and draft-to-edit handoff before
   staff saves.

### Owner Decision Needed

1. Where the written offramp justification lives (D50(2)): Dynamics note,
   Workbench field or meeting record.
2. Who sets Phase II status to Offramped: Program Director or Grants Manager.
3. Whether staff retain the original First Cut answer after a Semi-finalist
   recommendation replaces the status (carried from Session 667).
4. Whether the AI fit flag affects Flagged for concerns, remaining intake output
   formats and owners, staff queues, Chairs materials and calendar changes; the
   November 15 target needs reconfirmation (carried).

### Parked

1. Southern California as a separate app suite sharing code (D8; memory
   `project-workbench-is-research-only`). Re-open when the owner asks.
2. Research readiness readback after the December 8 readiness date: confirm the
   real J27 Research requests look right in the Workbench before anyone relies
   on it.
3. Phase II, bulk edits, queues and packet exports; see the cycle plan.
4. Lockfile drift in the read-model and factory worktrees (uncommitted
   `package-lock.json`); hygiene only.

### Verify Before Acting

1. **Preview alias.** `wmkfresearchapps-preview.vercel.app` was left on branch
   deployment `wmkfresearchapps-ng7nius87` (sandbox-backed, `680252fe5`) at the
   owner's request on 2026-11-09. Recorded prior target:
   `https://wmkfresearchapps-f8n44w5wh-justin-gallivans-projects.vercel.app`.
   The owner runs the restore; check `vercel inspect` before assuming either.
   Remove the branch-scoped Preview `DYNAMICS_URL` when `claude/j27-read-model`
   retires.
2. **Codex's untracked brief.** `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md`
   sits uncommitted in the main checkout (`/Users/gallivan/Code/WMKF_Apps`, on
   parked `codex/j27-semi-finalist`); the owner chose not to commit it in this
   handoff. Preserve it.
3. **Memory on the branch.** `.claude-memory/project-vercel-cli-deploy-preview-auth.md`
   gained the sandbox-backed Preview venue on `claude/j27-read-model`
   (`52fc7a6b6`, `480464177`), not on `main`; it arrives with the merge.
4. Sandbox fixtures 1000368 to 1000387 stay; no deletion authorized. Historical
   retirement items require live caller checks.

### Do Not Reopen Without New Decision

1. D7: the offramp is `wmkf_phaseiistatus = 682090001`; confirmed in production
   metadata 2026-11-09 (owner-authorized read).
2. D8: the Workbench read model is Research-only.
3. Scenario 7's sandbox derived status is observed, never asserted; production
   rules define the gate strings.

## Key Files Reference

| File | Purpose |
|---|---|
| `docs/plans/J27_READ_MODEL_AND_DISCOVERY_PLAN_2026-11-08.md` (branch) | Read model, discovery, strip, offramp: decisions, build records, merge rehearsal |
| `docs/plans/J27_STEP_I_REVIEW_2026-11-09.md` (branch) | Three Codex rounds on the offramp step |
| `lib/services/workbench/j27-read-model.js` | Pure stage derivation |
| `shared/components/workbench/J27StageStrip.js` | Request-page strip and label maps |
| `shared/config/workbenchVisibility.js` | Discovery predicate and OData superset |
| `shared/components/workbench/WorkbenchViewsNav.js` | Cycle-page tab registry (redesign pending) |
| `docs/plans/J27_ALIGNMENT_LOG_2026-10-24.md` | Owner decisions D1 to D51 |

## Concurrent Streams and Preservation

Dated inherited resume boundaries, not fresh audits or permissions. Preserve
fixtures, artifacts and other worktrees.

| Owner / stream | Resume boundary and authority |
|---|---|
| Claude / J27 read model | `/Users/gallivan/Code/WMKF_Apps-claude-j27-read-model`, `claude/j27-read-model` at `680252fe5`; plan above |
| Codex / J27 Factory | `/Users/gallivan/Code/WMKF_Apps-codex-j27-factory`, `codex/j27-factory-scenarios` at `9070030c7`; `docs/plans/J27_FACTORY_SANDBOX_SCENARIOS_PLAN_2026-11-08.md` |
| Codex / J27 reports line | `/private/tmp/wmkf-j27-workbench-reports`, `codex/j27-workbench-reports` at `97f696faf`; `docs/plans/J27_WORKBENCH_DEVELOPMENT_BRIEF_2026-11-06.md` (untracked, see above) |
| Earlier streams | Preview CSRF (#620/#621), per-reminder history (#625/#628), shared prompts, Integrity (Session 658), reviewer outcomes, terminology: boundaries unchanged from `git show 53066edc1:SESSION_PROMPT.md` |

## Testing

```bash
cd /Users/gallivan/Code/WMKF_Apps-claude-j27-read-model
npx jest tests/unit/j27-read-model.test.js tests/unit/workbench-views-nav.test.js
npx jest   # full run was green at 680252fe5
```
