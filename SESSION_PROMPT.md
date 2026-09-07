# Session 493 Prompt: Leadership stage transition plan, J27 marker gate, or the J27 build plan when Connor's file decision lands

## Session 492 Summary

Owner-present session on `main`. Item 1 from the Session 492 prompt (plan Slices 6B + 6C together)
was planned, built, reviewed, merged, smoked, and closed. The rest of the session was owner-driven
toolbar and header consistency work across the four Workbench views.

### What Was Completed

1. **Slices 6B and 6C planned and Production-live.** Plan
   `docs/FINAL_WRITEUPS_DASHBOARD_VIEWS_AND_VERSION_PLAN.md` (`249954c5`); three Codex adversarial
   plan passes (NEEDS REWORK ×2, then READY WITH NAMED CHANGES), eight findings all accepted and
   recorded in §12 (`96b536fd`, `0d8919ac`, `2b17cc54`). Built on Tier 1 branch
   `claude/final-writeups-views-and-version` (`a2047af7`); two Codex diff passes (one medium
   finding, pd canonicalization, fixed `b8e7dc67`; then approve `bdc815a1`); PR #175 merged
   `44bdd240`, Production deployment `dpl_2UrsDnydRqudu95wJyLCK7A6FUFR`; docs reconciled `323eb7ae`.
   **Owner-run signed-in smoke PASSED 2026-09-07** on the three views, the empty state, bookmarked
   and invalid URLs, the version label ("Version 5.0" on Request `1002788`), and the PD filter
   (`f4bcb5b6`).
   - Dashboard opens on Needs my review for every role; Reviewed by me and All writeups are the
     alternatives; Program director dropdown derived from loaded rows; `view`/`pd` are page-URL
     state, sanitized on mount, never sent to the API. Every view re-sorts by request number.
   - `acknowledgedPublicationVersionId` is additive on the dashboard row and both acknowledgement
     responses (GET via the shared projection, POST from the confirmed row), null for the
     responsible PD. Rows and the focused page show the verbatim publication version.
   - Unconfigured matrix rows carry `responsibleProgramDirector` so the PD filter is total; the
     view selector does not filter the matrix.
   - Owner defaults (plan §10): Updated rows stay in Reviewed by me; Your writeups collapsed
     under the first two views, folded into All; walk-back unchanged with an informative empty state.
2. **Toolbar and header follow-ups (Tier 0 on `main`).** `dccb39b9` view control shares the 48px
   box; `02bc6a8b` selects opt out of the native menu-button appearance (Safari ignores height and
   padding on a native `<select>`, so they rendered ~30px) with a drawn chevron, and the persona
   lens label moved from the eyebrow above the title into the first line of the header's right-hand
   summary (owner chose this over a chip after a two-option mockup; the eyebrow pattern had no other
   instance in the suite).
3. **Shared `ToolbarSelect`.** `shared/components/ToolbarSelect.js` extracted (`314e9426`) and
   adopted by Final writeups, Reviewer follow-up, Request list, and Initial assessments
   (`e68bffe9`), so all four Workbench views share one toolbar dropdown; sibling button groups on
   Reviewer follow-up and Request list brought to the same height and radius. Owner confirmed all
   four. Suite survey: 54 other native selects in 13 class variants remain (17 compact rounded-lg
   text-sm, 8 unstyled, 6 rounded-lg base, 23 scattered inline/table/modal); they want a smaller
   shared variant, not this one.

### Commits (all on `main`)
`249954c5` `96b536fd` `0d8919ac` `2b17cc54` plan and Codex passes · `a2047af7` `b8e7dc67` `bdc815a1`
`88369693` build (branch) · `44bdd240` PR #175 merge · `323eb7ae` reconcile · `dccb39b9` `02bc6a8b`
toolbar/header · `314e9426` `e68bffe9` ToolbarSelect · `f4bcb5b6` smoke record.

## Next Items

### Verified Open

1. **Leadership stage transition (Slice 4): planned and BUILT in S493; promotion pending.** Plan
   `docs/FINAL_WRITEUP_LEADERSHIP_TRANSITION_PLAN.md` (six Codex plan passes, D2 owner-confirmed
   2026-09-07); build on branch `claude/final-writeup-leadership-review` (Codex diff passes in plan §14).
   Remaining: PR merge (deliberate Tier 1 promotion), Production deployment, owner-run signed-in smoke on
   Request `1002788` (the only Final row; it will sit at leadership stage afterwards). The S492 baseline
   note "nothing built" described `main` at `c4e256c8`.
2. **Build the `J27:` marker convention and `scripts/check-j27-register.js`** (advisory gate).
   Evidence: `docs/J27_SINGLE_PHASE_TRANSITION_INVENTORY_PLAN.md` §7, register §9, Codex high
   finding (S491). Register in `docs/CI_GATES_REFERENCE.md` and the `/start` list; gate then
   self-test sequentially.
3. **Write `docs/J27_BUILD_AND_CHANGE_PLAN.md`** once Connor's file-location decision (Q5) lands.
   Evidence: register §2 deliverables table. Sequence unchanged from the S492 prompt.
4. **Annotate the pilot passages** coupling "J27 Initial Assessment" to 2026-08-18
   (`REQUEST_WORKBENCH_NEAR_TERM_EXECUTION_PLAN.md:60-61,71`, `DATAVERSE_SHAREPOINT_FILE_MODEL.md:804`,
   `strategy-roadmap.md:578`). Evidence: register J27-051, Q18. Copy only; no bulk replace. Line
   numbers as of `d05af5e8`, re-check before editing.
5. **Smaller shared select variant** for the 54 inline/table/modal selects (optional consistency
   follow-up). Evidence: S492 survey above; owner asked for consistency but did not direct this.
   Not urgent; propose before building.

### Owner Decision Needed

1. **Colleague discussion:** PD front-end flip to `Phase II Pending` as primary path (register Q8).
2. **Connor:** J27 proposal SharePoint location and filename (Q5); back-end status changes; slice G
   checklist (register §8).
3. **Filed, not urgent** (register §7 status line): Q1b, Q12, Q13, Q15, Q16, Q20, Q24.
4. **Dataverse attribute drops** (`wmkf_summarybloburl`, `wmkf_summarypages`) approved 2026-09-06;
   Connor-applied with its own pre-flight. Tier 0 when convenient.
5. **Final writeups header structure.** Final writeups is the only Workbench view not using the
   shared centered `PageHeader`; the other three do. Deliberate since 6A, but a consistency question
   surfaced in S492. No action unless the owner wants the four headers to match.

### Parked

- Toolbar rebuild (dropdown style), three-state triage dropdown, per-reminder audit trail,
  automatic reminder un-pause, materials-on-acceptance email (queue 6), 6D fingerprint smoke,
  custom intake portal, Stage 4 lifecycle plan, Ops eligibility view, one-click PDF conversion,
  five stale Preview callbacks — all J27 or later; unchanged from the S492 prompt.

### Verify Before Acting

1. **D26 residue deletions** (register J27-003…007) approved in principle for after D26 closes.
   Grep live callers per file; `scripts/probe-triage-filter.mjs:16`, `scripts/smoke-test-candidate.mjs:50`.
2. **Register SV labels sampled, not exhaustive.** Re-read cited `file:line` before scheduling.
3. **"You reviewed version X" copy is untested in Production.** Needs a colleague to acknowledge a
   D26 writeup that is later edited. Pinned by unit tests; observe on first real occurrence.
4. **Two stashes** (`stash@{0}` on main, `stash@{1}` on `codex/reviewer-promotion-remediation`)
   predate this work; untouched.
5. Production Dataverse reads remain owner-run only.

### Do Not Reopen Without New Decision

6B view/bucket mapping and §10 defaults; persona label placement (summary line, not eyebrow or
chip); PD dropdown is existence-only (derived from loaded rows; owner declined a roster-sourced
list 2026-09-07); 6D/6E closed; D26 hide of Initial Assessments; PD lens warn-not-lock; Set aside
hidden-but-counted; Concepts pre-Phase-I; `Phase II Pending` gate persists in J27; filename-match
bridge is Change; Hold step retired S279; automatic Complete from thank-you, Operations/Finance
remit flag, BILL API onboarding all closed.

## Preserve These Contracts

- Final writeups dashboard: `view`/`pd` never reach the API (route allowlist is `requestId` |
  `cycleCode`); explicit `cycleCode` never walks back; focused reads skip the global scan;
  `FINAL_WRITEUPS_DASHBOARD_MAX_ROWS` is per cycle and fails closed.
- `acknowledgedPublicationVersionId` is null for the responsible PD on every response variant.
- `visibleToPersona`: PC and PD see all; Leadership sees `leadership-review` only.
- `ToolbarSelect` is the page-level toolbar dropdown; do not reintroduce page-local select styles
  on Workbench toolbars.
- Register rule: nothing schedules unless `[OWNER-CONFIRMED]` or `[SOURCE-VERIFIED]`.
- Owner voice for error copy; OAuth-only agent sessions; no metered review products without
  explicit authorization; Codex never pushes `main`.

## Key Files Reference

| File | Purpose |
|------|---------|
| `docs/FINAL_WRITEUPS_DASHBOARD_VIEWS_AND_VERSION_PLAN.md` | 6B/6C plan, Codex dispositions (§12), build and smoke record (§14) |
| `shared/components/final-writeups/FinalWriteupsViews.js` | VIEWS map, URL state, PD filter, version context, persona summary line |
| `shared/components/ToolbarSelect.js` | Shared 48px toolbar dropdown used by all four Workbench views |
| `lib/services/final-writeup/acknowledgement-service.js` | `acknowledgedPublicationVersionId` in projection and POST response |
| `lib/services/final-writeup/dashboard-service.js` | Row passthrough; PD on unconfigured matrix rows |
| `docs/J27_TRANSITION_REGISTER.md` | J27 register, owner questions, slice G checklist |
| `docs/CURRENT_WORK_QUEUE.md` | Item 5 closed for 6B/6C; items 4, 6–8 carry the open work |

## Testing

```bash
npm test -- --runInBand --watch=false --testPathPatterns "final-writeup|reviewer-follow-up"
npm run check:docs-catalog && npm run check:doc-currency && npm run check:fact-consistency
```

## Handoff and Milestone Determination

Milestone entry added to DEVELOPMENT_LOG.md: "Final writeups dashboard views and version context
live; Workbench toolbars unified (Session 492)". Claim-evidence pilot row added for S492 (1 event,
universal shape, resolved by complement enumeration).
