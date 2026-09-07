# Session 492 Prompt: D26 Final-writeup planning items, then the J27 build plan when Connor's file decision lands

## Session 491 Summary

A long owner-present session on `main`. Three things shipped or landed, then the owner worked
through the J27 decisions one at a time.

### What Was Completed

1. **Session 490 stack merged and promoted.** PRs #170–#173 merged in order, final `7389e489`,
   Production Ready. DEVELOPMENT_LOG entry written (Sessions 490–491).
2. **Slice 6A: Final writeups dashboard cycle scoping — Production-live and owner-smoked.**
   Three Codex plan passes, build on `claude/final-writeups-cycle-scoping`, two Codex diff passes,
   merged `842c9f13`. Owner decision recorded: lenses focus rather than conceal, so the PD lens keeps
   Leadership-stage rows with an amber warn-not-lock notice; existence-only cycle codes disclosed to
   all personas. Smoke defects fixed on `main` as Tier 0: `12cfbafc` plural, `e53beb97` focused
   header label, `3a2c4352` bookmarked-cycle label. Docs reconciled in `09d360a9`. Branch deleted.
3. **Codex reviewer follow-up polish merged** `f0494607` (owner-approved shared-component edits;
   "Mark complete" rename finished `d0a5fc07`); wiki note and queue item 7 in `a8cb8591`. Codex
   worktree parked on `codex/parked` at main.
4. **J27 single-phase transition inventory.** Plan `docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md`
   (`6a2d2756`, `4f5b6df9`); six read-only agents swept slices A–F; register
   `docs/J27_TRANSITION_REGISTER.md` synthesized (`6b784362`); Codex adversarial review NEEDS REWORK,
   four of five findings fixed (`08839a6a`), the fifth is the unbuilt `J27:` marker check script.
   Register: 76 rows, 7 contradictions (5 resolved), 25 owner questions, slice G owner-run checklist.
5. **Owner decisions recorded (all 2026-09-06, commits `d05af5e8`…`05b15113`):**
   - Calendar: J27 proposals arrive **early December 2026**, date TBD. **2026-08-18 was the D26 Phase II
     proposal due date**, not J27 intake (six misattributions corrected by hand; no bulk replace). D26
     Phase I→II flip was **June 22, 2026**.
   - Sequence: proposals arrive probably as `Phase I Pending`; staff review every one with a mostly
     AI-generated Initial Assessment on existing infrastructure ("might have to change a bit"); only
     after staff decide does `akoya_requeststatus` become `Phase II Pending`. The advance is the status
     change; PDs will mostly flip it from the Workbench, Connor may change it behind the scenes via
     AkoyaGO or Power Automate. Colleague discussion still to confirm the PD front-end flip.
   - Review surface: every PD sees other PDs' requests but focuses on their own; **nothing gets lost**.
   - Triage gains an intermediate **"save for now"** state (name editable) settable by PDs **and PCs**
     (today's manage gate is lead-PD/superuser only). Default list = Advancing + Save for now +
     Untriaged; Set aside hidden but counted and one click away.
   - **Intake stays on GOApply** until further notice; custom portal parked for a future pilot; its
     gates are not J27 prerequisites.
   - **Delete after D26 closes:** concept-evaluator archive + registry residue, and the D26 allowlist
     patch cluster (destructive-carryover checks still apply at execution; re-point
     `scripts/smoke-test-candidate.mjs` first).
   - `SYSTEM_MODEL.md` and `GRANT_CYCLE_LIFECYCLE.md` now carry a dated cycle-boundary note in the
     owner's words.
   - **Connor's early decision:** SharePoint location and filename of the J27 submitted proposal (Q5);
     heads the slice G checklist and gates five register rows.
   - D26 posture: reviewer season under way (invitations out, many reviews in, 22 review DOCX
     backfilled). Reminders **stay manual for D26**. Toolbar rebuild, three-state triage, per-reminder
     audit trail, materials-on-acceptance email and invitation fingerprint smoke are **J27** items.
     Release-materials modal smoke effectively closed.
   - Final writeups dashboard: **6B** = open on "Needs my review" for every role, alternatives
     "Reviewed by me" / "All writeups", Program director dropdown, stage filter dropped. **6C** yes
     (acknowledged version per row). **6D/6E closed**. **Leadership stage transition = PD action in the
     Workbench** (new lifecycle-state write). PCs already see everything (no backup feature); a retiring
     PD's requests transfer by changing the program director in Dataverse.
   - Drop the two unused Dataverse attributes (`wmkf_summarybloburl`, `wmkf_summarypages`).
   - Seven J27 questions filed important-not-urgent (register §7 status line).
6. **Toolbar redesign assessment** (dropdown style; impeccable consulted) delivered; build deferred to J27.

### Commits (session, all on `main`)
`7389e489` stack merge · `842c9f13` 6A merge · `12cfbafc` `e53beb97` `3a2c4352` 6A smoke fixes ·
`09d360a9` 6A docs · `f0494607` `d0a5fc07` `a8cb8591` polish · `6a2d2756` `4f5b6df9` `d05af5e8` plan and
calendar · `6b784362` `08839a6a` register and Codex fixes · `3d1d29af` `5fd25644` `02e04662` `ac708391`
`9260743e` `ba35f2c7` `bbeab2a7` `2f382fae` `9f13de25` `30ed5444` `4a7609b9` `5870d79f` `ec481bda`
`aa5d7136` `43aa2318` `05b15113` owner decisions.

## Next Items

### Verified Open

1. **Plan Slice 6B + 6C together (D26, before Finals exist).** Evidence: queue item 5; owner shape
   2026-09-06 in `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` §12 tail. "Needs my review" as the
   opening view for every persona is a per-user computation (eligible ∧ not yet acknowledged) on top of
   the persona lens; PD dropdown; URL persistence beside `cycleCode`; 6C = publication version label per
   row keyed to the acknowledgement. Plan-first (`/contract-reconcile`), Tier 1 branch, Codex pass.
2. **Plan the Leadership stage transition as a PD Workbench action (D26).** Evidence: queue item 4
   completion column (owner 2026-09-06). A new `wmkf_requestdocument` lifecycle-state write Review→Final
   from the Workbench: DAL context, interlock, who may trigger, reversibility, what the Leadership lens
   shows before/after. Plan-first.
3. **Build the `J27:` marker convention and `scripts/check-j27-register.js`** (advisory gate). Evidence:
   plan §7, register §9, Codex high finding. Register it in `docs/CI_GATES_REFERENCE.md` and the `/start`
   list; run gate then self-test sequentially.
4. **Write `docs/J27_BUILD_AND_CHANGE_PLAN.md`** once Connor's file-location decision (Q5) lands.
   Evidence: register §2 deliverables table. Sequence: triage state + gate widening; staff review surface
   (J27-062) with nothing-lost default; Initial Assessment scale-out to ~300 (J27-060, J27-076); Workbench
   status write path for `Phase II Pending` (J27-064) plus the persist-gate tests; materials-on-acceptance
   email (queue 6); D26 close-out deletions (Q1).
5. **Annotate the pilot passages** that couple "J27 Initial Assessment" to 2026-08-18
   (`REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:60-61,71`, `DATAVERSE_SHAREPOINT_FILE_MODEL.md:804`,
   `strategy-roadmap.md:578`). Evidence: register J27-051, Q18. Copy only; owner said no bulk replace.

### Owner Decision Needed

1. **Colleague discussion:** confirm the PD front-end flip to `Phase II Pending` as the primary path
   (owner inclination) and whether any back-end path writes other fields. Register Q8.
2. **Connor:** J27 proposal SharePoint location and filename (Q5); how back-end status changes will be
   made; the other slice G checklist items (register §8).
3. **Filed, not urgent** (register §7 status line): Q1b, Q12, Q13, Q15, Q16, Q20, Q24.
4. **Dataverse attribute drops** approved 2026-09-06; Connor-applied schema change with its own
   pre-flight. Queue as Tier 0 when convenient.

### Parked

- Follow-up toolbar rebuild (dropdown style, set-aside as Requests option, shared cycle select) and the
  three-state triage dropdown — J27. Evidence: owner 2026-09-06, register J27-037.
- Per-reminder audit trail (queue 7) and automatic reminder un-pause — J27. Reminders manual for D26.
- Materials-on-acceptance email (queue 6) and 6D fingerprint smoke — J27 invitations (2027).
- Custom intake portal — parked for a future pilot; GOApply carries J27.
- 6D-2 fingerprint coverage; Stage 4 lifecycle plan; Ops eligibility view; one-click PDF conversion; five
  stale Preview callbacks in Entra. Not re-probed.

### Verify Before Acting

1. **D26 residue deletions** (register J27-003…007) are approved in principle for *after D26 closes*.
   Grep live callers per file at execution; `scripts/probe-triage-filter.mjs:16` imports the allowlist for a
   cycle code; `scripts/smoke-test-candidate.mjs:50` defaults to request 1002788.
2. **Register SV labels were sampled, not exhaustively verified** (Codex found two overclaims in a
   sample). Re-read the cited `file:line` before scheduling any row. Line numbers are as of `d05af5e8`.
3. **Two stashes** (`stash@{0}` on main, `stash@{1}` on `codex/reviewer-promotion-remediation`) predate
   this work; untouched.
4. Production Dataverse reads remain owner-run only.

### Do Not Reopen Without New Decision

D26 hide of Initial Assessments (Q3 leans keep; J27 brings the feature back). PD lens retains
leadership-stage rows with a warning, not a lock. Set aside hidden-but-counted by default. Concepts are
a pre-Phase-I stage, not Phase I. `Phase II Pending` gate persists in J27. Filename-match bridge is
Change, not Retire. Hold step retired S279 (not a J27 item). 6D/6E closed. Automatic Complete from
thank-you; Operations/Finance remit flag; BILL API onboarding — all still closed.

## Preserve These Contracts

- Final writeups dashboard: explicit `cycleCode` never walks back; focused reads skip the global scan;
  `FINAL_WRITEUPS_DASHBOARD_MAX_ROWS` is per cycle and fails closed; `QUERY_ALL_REQUESTS_CAP` is the
  adapter's re-export (services never import transport constants).
- `visibleToPersona`: PC and PD see all; Leadership sees `leadership-review` only.
- Register rule: nothing schedules unless `[OWNER-CONFIRMED]` or `[SOURCE-VERIFIED]`; Retire rows are
  candidates, not authorizations.
- Owner voice for error copy; OAuth-only agent sessions; no metered review products without explicit
  authorization; Codex never pushes `main`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/J27_TRANSITION_REGISTER.md` | The J27 register: rows, contradictions, owner questions (§7 status line), slice G checklist |
| `docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md` | Sweep method, schema, marker convention (§7 unbuilt) |
| `docs/FINAL_WRITEUPS_DASHBOARD_CYCLE_SCOPING_PLAN.md` | 6A build record, review dispositions, 6B shape |
| `lib/services/final-writeup/dashboard-service.js` | Cycle discovery, scoping, persona lens |
| `shared/components/final-writeups/FinalWriteupsViews.js` | CycleSelector, URL persistence, stage warning |
| `docs/CURRENT_WORK_QUEUE.md` | Items 5–8 carry today's decisions |
| `.claude-memory/project-grant-phasing-evolution.md` | Phasing facts incl. all 2026-09-06 decisions |

## Testing

```bash
npm test -- --runInBand --watch=false --testPathPatterns "final-writeups|reviewer-follow-up"
npm run check:docs-catalog && npm run check:doc-currency && npm run check:memory-router
```

## Handoff and Milestone Determination

Milestone entry added to DEVELOPMENT_LOG.md: "Final writeups cycle scoping live; J27 transition
register built and owner decisions taken (Session 491)". Claim-evidence pilot row added for S491
(1 event, universal shape, resolved by narrowing).
