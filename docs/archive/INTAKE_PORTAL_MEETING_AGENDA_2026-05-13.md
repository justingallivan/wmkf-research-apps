# Meeting Agenda — Intake Portal Pilot Decisions

**Date:** 2026-05-13
**Attendees:** Justin, Sarah, Connor
**Timing target:** 60–90 min
**Hard deadline anchor:** Pilot opens for submissions **2026-06-01** (~20 days from this meeting). Every decision deferred extends slip risk.

**Objective:** Walk out of this meeting with all 5 launch blockers either resolved or with an owner + named follow-up date. No "we'll figure it out later" without a concrete date. Field inventory does not need to be 100% complete — first pass is enough to unblock form scaffolding.

**Reference docs to have open:**
- `docs/INTAKE_PORTAL_DESIGN.md` — open to "Schema (pilot — minimal)" (line 84) and "Open questions / open work" (line 547).
- `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` — schema audit catalog; capture new entity/field decisions here in real time.
- `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` — 2026-05-06 walkthrough, esp. § 6 (structured-tables persistence).

---

## Pre-meeting prep (today, 15 min)

- Open the reference docs above so they're visible during the meeting.
- Print or screen-share the architecture diagram (design doc line 49). Easiest way to align all three of you on the portal/PA boundary without re-explaining it.
- Have a blank scratchpad ready for the field inventory — lightweight table format (field name / type / required? / notes). Don't try to format pretty mid-meeting.

---

## Opening — 5 min

**Goal:** state shared context so everyone is in the same room mentally.

- Today's status: auth foundation shipped (S129), `/apply` landing page renders authenticated session, design doc refreshed 2026-05-12. **No form, no API routes, no portal-originated Dynamics writes exist yet.**
- 20 days to 2026-06-01 pilot open. Critical path is this meeting's outputs → engineering work (Justin) → end-to-end smoke against deployed URL.
- Five launch blockers (design doc lines 549–555). Today's job is to resolve them in priority order.

**Explicit framing for Connor and Sarah:** "I need a decision today on the blockers in your column, even if it's not the final answer. We can revise, but I cannot ship without a starting point."

---

## Track 1 — Connor's decisions (30–40 min)

Four launch blockers in Connor's column. Do these **first** because they have schema and PA implications Justin needs to start building against immediately. If Connor has to leave early, this is what must get done.

### 1A. `wmkf_portal_membership` shape sign-off (10 min)

**Decision needed:** approve the schema for the new entity that tracks person ↔ institution relationships with approval state.

**Show Connor:**
- The proposed entity from `INTAKE_PORTAL_DESIGN.md` "One new entity" section (line 98).
- Schema-as-code JSON if drafted; if not, sketch the columns on screen.

**Specific questions:**
- Does the proposed column set match his expectations (member role, approval status, approved-by, approved-at, request audit)?
- Should the entity be `wmkf_portal_membership` or does Connor want a different prefix/name to match AkoyaGO conventions?
- Approval workflow: who approves a new applicant claiming an institution? Connor's PA side, or staff in `/apply/admin/`?
- Is the summary-after model (per memory `project_dataverse_creator_privileges`) still the working agreement — i.e., I create the entity under delegated authority and send Connor the summary?

**Acceptable outputs:**
- ✅ Best: "Yes, ship it as drafted, send me the summary after."
- ✅ Acceptable: "Yes with these changes [...]. Send me the summary after."
- ⚠️ Risky: "Let me think about it — get back to me by [date]." If this happens, push for **2026-05-15** at latest. Anything past that pushes the schema work into next week and the form-build runway shrinks.

### 1B. PA trigger confirmation (10 min)

**Decision needed:** confirm which existing Power Automate flows fire on `'Phase II Pending'` status flip, and whether any need updating for portal-originated submissions vs. GOapply-originated.

**Show Connor:**
- The "Architecture overview" diagram bottom half (the PA branches that fan out from a status flip).
- The submission lifecycle section (design doc line 256) — async submission queue → final Dynamics write → status flip.

**Specific questions:**
- List the existing PA flows that fire on `'Phase II Pending'`. Which of them assume GOapply as the origin (e.g., reading a GOapply form definition)?
- For portal-originated rows, does the same set of flows fire correctly, or do any need a conditional branch on the originating system?
- Is there a field on `akoya_request` that distinguishes portal vs. GOapply origin, or do we need to add one? (Suggest `wmkf_originatingsystem` text field, values `'portal' | 'goapply'`.)
- Are there flows that *should not* fire for portal submissions (e.g., a GOapply-cleanup flow)?

**Acceptable outputs:**
- ✅ Best: Connor confirms list of flows + whether they need a conditional, names the origin-marker field if needed.
- ✅ Acceptable: Connor says "I'll audit the flows by [date] and tell you which need updates." Push for **2026-05-15**.
- ⚠️ Risky: "It should just work" without verification. Push back gently — the cost of a missed PA flow firing on pilot day is much higher than 30 min of audit now.

### 1C. Reviewer-consumable artifact (5 min)

**Decision needed:** how do downstream reviewers see the structured body of a portal-submitted proposal?

**Show Connor:**
- Design doc line 28 ("No submission PDF generator for pilot — but...") with the four options.
- Default assumption: option 1 (staff-rendered Word/PDF on demand from `/apply/admin/*`, dropped in `Reviewer_Downloads/`).

**Specific questions:**
- Does option 1 work for him, or does he want option 2 (PA-built review packet on status flip)?
- If option 2: how soon can he build the PA flow? Pilot deadline is 2026-06-01.
- For option 1: does the staff trigger (button click in `/apply/admin/request/:id`) work, or should it auto-generate on `'Phase II Pending'` flip?

**Acceptable outputs:**
- ✅ Best: pick option 1 or option 2, confirm I can build it.
- ⚠️ Risky: "Both?" or "Let me think." This blocks reviewer pipeline integration; push for a decision today even if it's "option 1 for pilot, option 2 post-pilot."

### 1D. Structured-tables persistence contract (10 min)

**Decision needed:** how do structured form sub-tables (budgets, rosters, milestones) persist?

**Show Connor:**
- `docs/archive/CONNOR_INTAKE_PORTAL_SYNC.md` § 6 (the 2026-05-06 walkthrough where this was discussed).
- Design doc line 20 ("machine-legible structured data") and line 555 (the open question).

**The three options:**
1. **Real child entities** (e.g., `wmkf_proposalbudgetline`, `wmkf_proposalmilestone`). Schema-heavy; cleanest for downstream querying; the long-term-correct answer per Connor's 2026-05-06 sync.
2. **JSON columns on `akoya_request`** (`wmkf_budget_json`, etc.). Schema-light; faster to ship; harder to query in Dataverse.
3. **Defer.** Capture as PDF/narrative for pilot, structured for next cycle.

**Specific questions:**
- Which option for pilot? The 2026-05-06 sync leaned toward real child entities — is that still the position with 20 days to ship?
- If real child entities: do we need to design and create them before form work starts? That's 3-5 new entities; tight.
- If JSON columns: schema-light is the pilot-friendly answer, but downstream tools (Reviewer Finder, AI summarization) would need to parse JSON instead of reading typed fields. Acceptable for pilot?

**Acceptable outputs:**
- ✅ Best: pick a single option for pilot. Recommendation: option 2 (JSON) for pilot, option 1 (real child entities) post-pilot as the planned migration. Get Connor's explicit OK to deviate from 2026-05-06.
- ⚠️ Risky: "Real child entities, but we'll see how much we can fit in." Force a yes/no decision — pilot doesn't tolerate "we'll see."

---

## Track 2 — Sarah's field inventory (30–40 min)

The single highest-bandwidth item. Sarah is back from conference travel; this is the first time we can drive a real form-content session.

**Goal of the session:** capture enough of the Phase II Research form structure to start scaffolding `phase-ii-research-2026-06` form module. **Does not need to be 100% complete** — 80% with names + types is enough to unblock; refinements can come in async passes after this meeting.

### 2A. Setup (3 min)

- Confirm Sarah has access to a representative Phase II Research applicant view from GOapply (if she does — if not, she'll be working from memory + current paper forms).
- Frame: "We're not redesigning the form. We're translating the current Phase II Research form into structured fields we can store in Dynamics directly. Every narrative section we can split into typed fields is a section downstream AI tools don't have to re-extract."

### 2B. Field inventory walk-through (25 min)

Work top-to-bottom through the current Phase II Research form. For each field, capture:

| Field name (working) | Type | Required? | Notes |
|---|---|---|---|
| (e.g.) Project title | short text, 200 char | yes | Maps to `akoya_request.akoya_title` |
| Project abstract | long text, 3000 char | yes | Maps to `wmkf_abstract` (existing) |
| Budget — line items | structured table | yes | See structured-tables decision (Track 1D) |
| Co-investigators | structured table | yes | Roles + email + affiliation per row |
| Milestones | structured table | yes | Date + description per row |
| Eligibility statement | yes/no + free text | yes | Pilot decision: structured? |
| ... | ... | ... | ... |

**Sarah-specific calls she needs to make** (don't leave these implicit):
- Which narrative fields can be split into multiple structured fields without making the form feel bureaucratic?
- For each free-text field with a character limit, what's the working limit? (Hard-coding "long text" without a limit creates UX problems later.)
- Are there conditional fields (only show if X is selected)? Pilot can ship without conditional logic if it's complex — flag now.
- Eligibility gating: are there yes/no answers that should fail-fast (i.e., applicant can't submit if certain box is unchecked)?

### 2C. Sarah's UI must-haves (5 min)

Distinct from field structure — these are UX preferences:

- Multi-page form vs. single long page?
- Save-draft button visibility / autosave UX?
- Required field indicators?
- Section ordering preferences?

**Acceptable output of Track 2:**
- ✅ Best: full field list with types + required flags, even if some fields need followup on character limits.
- ✅ Acceptable: 70-80% of fields locked, with a named list of "Sarah will send the rest by [date]." Push for **2026-05-15**.
- ⚠️ Risky: "Let me think about it more." Bad — every day past tomorrow is one less day to build the form module.

---

## Track 3 — Resolutions and follow-ups (10 min)

### 3A. Decision summary (5 min)

Read back to Sarah and Connor what got decided, in plain language. Don't leave anything implicit. Example:
- "Connor, you're going to ship `wmkf_portal_membership` as drafted; I'll send you a schema-after summary by [date]."
- "Connor, structured tables are option 2 (JSON columns) for pilot; option 1 is post-pilot work."
- "Sarah, you'll send the remaining field details by 2026-05-15."

If any item didn't get decided, name the **specific** follow-up: who owns it, what they need to provide, and the date.

### 3B. Calendar follow-ups (3 min)

- Schedule a **2026-05-19 checkpoint** (1 week from today) to review: schema applied, form-module skeleton renders, end-to-end auth → form-load → save-draft → submit-mock → land-in-Dynamics smoke working on Vercel preview.
- Schedule a **2026-05-26 dry-run** (2 weeks from today) for full pre-launch verification checklist (the 6 unchecked items in design doc lines 563–573).
- Schedule a **2026-05-30 go/no-go review** (3 days before launch) to either green-light 2026-06-01 open or trigger contingency scope reduction.

### 3C. Contingency framing (2 min)

Surface explicitly: "If any decision today slips past 2026-05-15, we need to talk about pilot scope reduction." Concrete reductions to have in your back pocket:

- Cut admin UI from pilot (collaborator approval becomes manual staff email or out-of-band action).
- Cut structured tables entirely (single narrative field for budget, roster, milestones — capture as PDF instead).
- Cut conditional form logic (everything required, applicant has to fill all sections).
- Push pilot date one week (2026-06-08).

Don't decide which today, but make sure Sarah and Connor know these are the levers if their decisions slip.

---

## Post-meeting (Justin, same day, 30–60 min)

1. Update `docs/INTAKE_PORTAL_DESIGN.md` "Open questions / open work" section: strike through resolved blockers with date + outcome.
2. Add decisions to `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md` catalog.
3. Start engineering work that's now unblocked:
   - If membership schema signed off: create the JSON schema file under `lib/dataverse/schema/intake/` and apply.
   - If structured-tables decision = JSON columns: add the `wmkf_request` field extensions.
   - Begin `submission_jobs` Postgres migration (unblocked regardless of decisions above).
   - Begin form-module scaffolding for `phase-ii-research-2026-06`.

---

## Things NOT on the agenda (parking lot — don't let the meeting drift here)

- Long-term GOapply replacement strategy (out of pilot scope).
- Other funding lines beyond Phase II Research.
- Multi-cycle revision flows.
- Form builder UI (forms-as-code is locked).
- Anything in the "Open questions, not pilot-blocking" section (design doc lines 577–582). Address asynchronously after this meeting.
