---
name: Grant lifecycle states confirmed (2026-05-01)
description: Observed akoya_requeststatus transitions across the cycle and what each state means for Reviewer Finder picker behavior
type: project
originSessionId: 0c2648c3-78b0-4258-ad88-9960b3a3d864
---
Confirmed on 2026-05-01 by querying production Dataverse on the day Phase I opened for the D26 cycle.

**`akoya_requeststatus` is a string field, not an optionset.** No `_formatted` annotation comes back; read the raw `akoya_requeststatus` directly.

**Observed values and lifecycle order:**
1. `'Concept Pending'` — applicant has submitted a concept; pre-Phase-I.
2. `'Phase I Pending'` — applicant has submitted a Phase I proposal; awaiting committee review.
3. `'Phase II Pending'` — Phase I committee has advanced this proposal; staff are assigning Phase II reviewers. **This is the only state the Reviewer Finder picker considers "actionable."**
4. (Later, post-funding/decline states exist but weren't surveyed today.)

**Why this matters:**
- `pages/api/reviewer-finder/my-proposals.js` filters to `akoya_requeststatus = 'Phase II Pending'` in default `?status=actionable` mode. New cycle submissions don't appear in the picker until staff advance them — months after the cycle opens.
- D26 picker was empty on 2026-05-01 because all 378 D26 rows were `Phase I Pending` (75) / `Concept Pending` (25) of the first 100 — zero `Phase II Pending`. That's the desired state, not a bug.

**`wmkf_phaseiistatus IS NULL` correlates with "no Phase II review work yet"** — confirmed across all sampled D26 rows.

**`wmkf_potentialreviewer1..5` DO exist on `akoya_request`** (corrected 2026-05-15 — the original "do NOT exist" claim was false). Verified four ways: `docs/atlas/dataverse-akoya-request.md:36` lists them; a live `audit-dataverse-state.js` sample row (2026-05-14) shows all 5 `_wmkf_potentialreviewer{1..5}_value` populated; `project-akoya-request-pd-fields.md` and `project-reviewer-count-invariant.md` both document them. They are legacy lookup slots → `wmkf_potentialreviewers`. **Live code DOES read them** (corrected S209 — the prior "no live code reads them" claim is now false): `pages/api/reviewer-finder/my-proposals.js:143` selects all five (`reviewerSlotsFilled` display/count at :179), and `pages/api/dynamics-explorer/chat.js` selects them at :859/:1462 and uses them as **load-bearing query logic** in `handleReviewerRequests` (:1578, reverse lookup). The richer per-(person,request) reviewer state still lives in `wmkf_appreviewersuggestion`, but the slots are no longer write-only/unread. **Relevant to the Workbench Phase 3 ingestion premise** — see [[project-d26-reviewer-inputs-probe]] / [[project-intake-portal-reviewer-capture]].

**How to apply:**
- When debugging "the picker is empty for cycle X," first check `akoya_requeststatus` distribution for that cycle's meeting date — empty is expected until Phase I review selects proposals to advance.
- Don't expect `Phase II Pending` to be the value on freshly-submitted proposals; that state is assigned later in the cycle.
- Don't conflate `wmkf_phaseiistatus` (a Phase II-specific status field, often null) with `akoya_requeststatus` (the lifecycle stage field).
