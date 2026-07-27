---
name: Grant lifecycle states confirmed (2026-05-01)
description: Observed akoya_requeststatus transitions across the cycle and what each state means for Reviewer Finder picker behavior
type: project
originSessionId: 0c2648c3-78b0-4258-ad88-9960b3a3d864
status: active
scope: dynamics
last_verified: 2026-07-27 via docs/atlas/dataverse-akoya-request.md and current proposal-reader/slot consumers; observed lifecycle counts remain dated
---

## Recall Rule

Read this when: filtering proposals by lifecycle state, debugging an empty Reviewer Finder picker, or reading reviewer slot fields on `akoya_request`.

Do:
- Read `akoya_requeststatus` as a raw string (no `_formatted`); `'Phase II Pending'` is the only picker-actionable state.
- When a picker is empty for a cycle, first check the `akoya_requeststatus` distribution for that cycle's meeting date — empty is expected until Phase I review advances proposals.
- Treat `wmkf_potentialreviewer1..5` as existing AND read by live code (`reviewer-finder/my-proposals.js`, `dynamics-explorer/chat.js` `handleReviewerRequests`).

Do not:
- Expect freshly-submitted proposals to be `'Phase II Pending'` — that state is assigned later.
- Conflate `wmkf_phaseiistatus` (often null) with `akoya_requeststatus`.
- Repeat the retracted claims that the slots "do NOT exist" or that "no live code reads them" — both were corrected (2026-05-15 / S209).

Ground truth: `lib/services/reviewer-finder/my-proposals-service.js`,
`pages/api/dynamics-explorer/chat.js` `handleReviewerRequests`,
`docs/atlas/dataverse-akoya-request.md`,
[[project-d26-reviewer-inputs-probe]].

Confirmed on 2026-05-01 by querying production Dataverse on the day Phase I opened for the D26 cycle.

**`akoya_requeststatus` is a string field, not an optionset.** No `_formatted` annotation comes back; read the raw `akoya_requeststatus` directly.

**Observed values and lifecycle order:**
1. `'Concept Pending'` — applicant has submitted a concept; pre-Phase-I.
2. `'Phase I Pending'` — applicant has submitted a Phase I proposal; awaiting committee review.
3. `'Phase II Pending'` — Phase I committee has advanced this proposal; staff are assigning Phase II reviewers. **This is the only state the Reviewer Finder picker considers "actionable."**
4. (Later, post-funding/decline states exist but weren't surveyed today.)

**Why this matters:**
- `lib/services/reviewer-finder/my-proposals-service.js` filters to
  `akoya_requeststatus = 'Phase II Pending'` in default `?status=actionable`
  mode. New cycle submissions don't appear in the picker until staff advance
  them — months after the cycle opens.
- D26 picker was empty on 2026-05-01 because all 378 D26 rows were `Phase I Pending` (75) / `Concept Pending` (25) of the first 100 — zero `Phase II Pending`. That's the desired state, not a bug.

**`wmkf_phaseiistatus IS NULL` correlates with "no Phase II review work yet"** — confirmed across all sampled D26 rows.

**`wmkf_potentialreviewer1..5` DO exist on `akoya_request`** (corrected
2026-05-15 — the original “do NOT exist” claim was false). The Akoya request
Atlas lists them; a dated 2026-05-14 Dataverse sample showed all five populated;
and the related project memories document them. They are legacy lookup slots to
`wmkf_potentialreviewers`. **Live code reads them:** the Reviewer Finder
`my-proposals-service.js` selects all five and derives
`reviewerSlotsFilled`, while Dynamics Explorer
`handleReviewerRequests` builds its reverse lookup across the five slots. The
richer per-(person,request) reviewer state still lives in
`wmkf_appreviewersuggestion`, but the slots are not write-only/unread.
**Relevant to the Workbench Phase 3 ingestion premise** — see
[[project-d26-reviewer-inputs-probe]] /
[[project-intake-portal-reviewer-capture]].

**How to apply:**
- When debugging "the picker is empty for cycle X," first check `akoya_requeststatus` distribution for that cycle's meeting date — empty is expected until Phase I review selects proposals to advance.
- Don't expect `Phase II Pending` to be the value on freshly-submitted proposals; that state is assigned later in the cycle.
- Don't conflate `wmkf_phaseiistatus` (a Phase II-specific status field, often null) with `akoya_requeststatus` (the lifecycle stage field).
