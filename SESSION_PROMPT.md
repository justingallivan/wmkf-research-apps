# Session 196 Prompt: Request Workbench scoping — lock tab structure, then write the doc

## ⏰ Time-sensitive carryovers

### Operator-side action items
1. **Intake portal virus-scan e2e** — DEFERRED to pre-pilot. Must run EICAR through `/apply` flow before mid-June 2026 Phase II Research pilot. Recipe in [`project-intake-portal-virus-scan-e2e-deferred`](.claude-memory/project-intake-portal-virus-scan-e2e-deferred.md).

### BILL reviewer-honorarium build status (unchanged)
- **Chunks SHIPPED:** 2-3, 6, 7a.
- **Chunks PENDING:** 4 (extend respond.js — now UNBLOCKED, Connor shipped the schema 2026-05-28), 5 (Stage 2a UI address inputs — held), 8 (E2E sandbox test — blocked on Steph).
- **Connor's schema work: ✅ SHIPPED 2026-05-28** — `wmkf_HonorariumRequest` lookup on `wmkf_appreviewersuggestion` (the per-engagement junction; the earlier "potentialreviewer" framing was BILL-doc terminology drift, patched same session).
- **Target ready:** 2026-06-10. First reviewer invitations ≥ 2026-06-17.
- **S195 clarification:** Chunk 5 is NOT absorbed by the Request Workbench. Stage 2a address-capture lives on `/external/review/[token]/accept` (reviewer side, not PD side). Chunk 5 ships on its own timeline.

## Session 195 Summary

No code this session — pure design conversation that produced a substantially larger reframe than S194 anticipated.

### What was decided

1. **Reviewer Workbench → Request Workbench.** Holistic per-request surface for the entire PD workflow, not a narrow reviewer-lifecycle slice. URL pattern `/workbench/[requestId]/...`. Every existing per-request operation (`phase-ii-writeup`, `peer-review-summarizer`, `multi-perspective-evaluator`, integrity screener, funding-gap, virtual review panel, …) is a tab/affordance, not a separate app the PD navigates to.

2. **Workbench is a display + refinement surface, not a console.** Backend automation tier (event-driven: `proposal-submitted`, `phase-advanced`, `review-submitted`) auto-materializes artifacts (summary, draft writeup, peer-review summary, integrity screen, reviewer longlist, etc.). The Workbench reads state; the PD intervenes where judgment matters. PD-triggered regenerate is exception, not default.

3. **This unifies five initiatives that were sitting separate in memory** into the automation tier feeding the Workbench:
   - `project-backend-automation`
   - `project-staged-review-pipeline`
   - `project-proposal-context-extraction`
   - `project-prompt-storage-strategy` (+ Executor Contract)
   - `project-new-ai-capabilities`

4. **Phase I sunsetting simplifies the trigger model.** J26 is the last Phase I cohort. Going forward: single submission with full materials at the start; "long list → short list" winnowing happens on one submission. Don't over-design dual-phase branching; build for single-submission with internal staging labels.

5. **Build sequence locked:**
   - **Now (→ mid-June 2026):** reviewer-lifecycle slice as Workbench v1 + Reviewer Pool. URL pattern is the holistic one even though only one functional area lands.
   - **Next cycle:** automation tier + writeup tab + analyses tabs + triage surface. Runway: doesn't need to be live until next cycle accepts submissions.

6. **Honorarium is NOT a PD-facing tab.** It's a downstream automation consequence of Closeout: PD marks review closed → status flips to payable → BILL flow runs.

7. **Workbench tabs (working list, structure still open):**
   - **Find** — candidate discovery (request-aware)
   - **Invite** — shortlist + dispatch
   - **Track** — confirmed/pending/declined, materials, review-in-progress, overdue
   - **Closeout** — read returned review, mark closed → triggers honorarium downstream

### Workflow signals surfaced

- Connor maintains a parallel SharePoint folder per cycle (`<Institution>_<RequestNumber>`) because AkoyaGo's proposal-reading UX is painful. Workbench obviates this entirely (proposal viewer + writeup composed in-app eliminates both the read-pain and the filename-as-join-key brittleness).
- `00_All Staff Versions/` PA-merged PDFs are already automated (intake docs + DB-derived cover page).
- `0_MR Scored Write Ups/` Word docs are PA-templated; filename-keyed routing back to per-request folder; brittle convention the Workbench-composed writeup eliminates.
- MR = Medical Research, SE = Science and Engineering. May blur in coming years — don't hardcode program assumptions.

### Conversational landing position (where we stopped)

User asked for time to think about one specific structural question:

**Tab structure: Find / Invite / Track / Closeout (4-tab) vs Find + Roster + Closeout (3-tab).** In the 3-tab world, Roster consolidates Invite + Track into one list where actions vary by row state (un-invited row → "Invite"; invited → "Resend" / "Mark declined manually"; confirmed → "Send materials"; etc.). Find stays separate as the search affordance.

User is thinking overnight; S196 picks up here.

### Dashboard left-column compaction (deferred mid-conversation)

Before the holistic reframe, user proposed compacting the existing Reviewer Manager row structure:
- `#1002279  J26` on one line (number + cycle, both DB-derived) → saves a column
- Institution above PI line: `PI: Mike Pluth` → saves a column ("the Oregon proposal, not the Pluth proposal")
- Same compact identity unit becomes the persistent left-side header on every Workbench tab.

This was deferred when we shifted from chrome to workflow ("form follows function"). Worth coming back to once tab structure locks.

## Commits this session
None. Pure design.

## Potential next steps for S196

### 1. Lock the tab structure (PRIMARY)
3-tab (Find + Roster + Closeout) vs 4-tab (Find / Invite / Track / Closeout). User returning with instinct after overnight.

### 2. ✅ CLOSED — closeout status modeling resolved (S196)
Final model: PD closeout = quality read, not a payment gate. Reviewer submission flips `wmkf_reviewstatus = review_received` (payment-eligible for Steph). PD click "Close out" → `wmkf_reviewstatus = complete` (the previously-unused enum value, Connor confirmed) + new `wmkf_completedat` DateTime. Row drops off PD dashboard. Subpar/withhold case = PD pings Steph out-of-band (no schema). Shipped: `wmkf_completedat` on `wmkf_appreviewersuggestion`, `wmkf_HonorariumRequest` lookup also shipped (Connor).

### 3. Draft `docs/REQUEST_WORKBENCH_SCOPING.md`
Connor/Sarah-shareable. Once 1 and 2 are decided, structure is:
- Holistic architecture (three tiers: global / cycle-scoped / per-request)
- Phasing change + simplified trigger model
- Reviewer-lifecycle slice as v1 (URL, tabs, what they do, what they replace, integration points with already-shipped reviewer infra)
- Artifact-storage inventory pass (what's in Dataverse already, what's missing)
- Explicit out-of-scope for v1 (writeup, analyses tabs, triage surface, automation tier)

### 4. Other open items (deferred — pick up after scoping doc)
- Row content on the cycle dashboard (compaction direction set, specifics open)
- `isActionableForPD` policy function rules (internal-recommendation state vs official board-signoff state)
- Reviewer Pool surface design (which Dataverse fields, what filters/sorts, what actions)

## Key files reference

| File | Purpose |
|------|---------|
| `.claude-memory/project-reviewer-apps-redesign-direction.md` | UPDATED S195 — holistic reframe, build sequence, open tab-structure question |
| `docs/REQUEST_WORKBENCH_SCOPING.md` | TO BE WRITTEN S196 (or later) — Connor/Sarah-shareable scoping doc |

## Testing
N/A this session (no code changes).
