---
name: Intake portal pilot — Track 1 decisions 2026-05-13
description: Historical Sarah+Connor Track 1 decisions from 2026-05-13. The recorded schema decisions later shipped, but this meeting record does not authorize current custom-portal work; see the owner parking decision and current system model.
type: project
originSessionId: 3c35888d-8da4-46e3-83ac-31a25bbdc4e4
status: closed
scope: intake
last_verified: 2026-07-08 (S348 audit) — closed: point-in-time meeting decisions; the 1C/1D deltas shipped (wmkf_proposalbudgetline + wmkf_apprequestperson extensions, verified in lib/dataverse/schema/wave4/). Historical record; for current shape read docs/atlas + wave4 schema.
---

## Historical decision record — 2026-05-13

This file records the Track 1 meeting decisions and subsequent schema follow-through. It is
not current implementation authority or a route to resume portal work. The owner later
parked the custom portal and kept J27 intake on GOApply until further notice; see
[[project-system-model]], `docs/SYSTEM_MODEL.md` (Applicant Intake), and
`docs/J27_TRANSITION_REGISTER.md` Q19. If a pilot is reopened, re-establish scope and
authorization from those current authorities and source before applying this record.

> **Historical schema correction (2026-05-14; applied S178):** Item 1D's "two child entities (budget + roster)" framing was refined the next day: budget became a new `wmkf_proposalbudgetline` entity (with cost-share unified into its `wmkf_category` enum), while roster extended the existing `wmkf_apprequestperson` junction via 3 nullable fields + 3 new role enum values. The `wmkf_proposalroster` name was withdrawn. The specs landed under `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:38-40`, `docs/INTAKE_PORTAL_DESIGN.md:587-588`, and `docs/BUDGET_FORM_SPEC.md`; the proposed `lib/dataverse/schema/intake/` path does not exist. This records historical schema follow-through, not current portal authorization.

Sarah+Connor sync 2026-05-13. Track 1 (Connor-side decisions, 4 items) ran to completion. Track 2 (Sarah's Phase II Research field inventory) was not reached — carry to next Sarah session.

**Meeting context:** Two items reversed or narrowed the May 6 decisions. The table records what participants decided on May 13; its then-current choices do not establish present authorization or implementation status.

## Four Track 1 decisions

| # | Resolution | Delta from 2026-05-06 |
|---|---|---|
| **1A** Membership shape (deployed as `wmkf_portalmembership`, no underscore — `wmkf_portal_membership` form was dropped pre-deploy) | Approved as drafted. Ships under existing delegated authority, summary-after model. **Institution-claim approval = Option A**, lives portal-side at `/apply/admin/memberships` (new `intake-admin` app key). Connor's plate unchanged. | Re-confirmation of 2026-05-06; Option A clarifies the approval-workflow owner (was implicit). |
| **1B** PA flows on `'Phase II Pending'` | Connor states flows are **origin-agnostic** and work as-is for portal-originated rows. No `wmkf_originatingsystem` field needed for pilot. Verification: smoke-test at 2026-05-26 dry-run. Flow-list email sent 2026-05-13 (turnaround target 2026-05-15). | Net-new — wasn't on the 2026-05-06 list. |
| **1C** Reviewer-consumable artifact | **REVERSAL**: PA-built review packet on `'Phase II Pending'` flip, dropped in `Reviewer_Downloads/` (Option 2). Connor owns the build. Structured-data layout becomes upstream of his packet build. | **Supersedes 2026-05-06 Option 1** (staff-rendered Word/PDF on demand). |
| **1D** Structured-tables persistence | Real child entities (Option 1) — **narrowed scope to budget + roster only**. **As-deployed S178 (2026-05-22):** budget = new `wmkf_proposalbudgetline` entity; roster = EXTENSIONS on existing `wmkf_apprequestperson` (3 nullable fields + 3 new role enum values) — the `wmkf_proposalroster` entity name proposed during the meeting was withdrawn pre-deploy. Milestones → narrative field for pilot; prior support → attached PDF for pilot. | **Narrows 2026-05-06** which included `wmkf_priorsupport` and `wmkf_milestone`. |

## Naming alignment — RESOLVED S178 (2026-05-22)

Deployed names: `wmkf_proposalbudgetline` (NEW entity, the meeting sketch) + `wmkf_apprequestperson` extensions (NOT a new entity — the `wmkf_proposalroster` sketch was withdrawn pre-deploy) + `wmkf_portalmembership` (NO underscore; the `wmkf_portal_membership` form was dropped pre-deploy). The 2026-05-06 sketch names (`wmkf_budgetline`/`wmkf_personnel`) are superseded.

## What carried to next session — closed

- ~~**Track 2 — Sarah field inventory**~~ — see Sarah session work, separately tracked.
- ~~**Connor's flow-list response** (1B email)~~ — handled; PA flows are origin-agnostic per 1B decision.
- ~~**Two JSON schema specs** under `lib/dataverse/schema/intake/` (budget + roster)~~ **DONE S178** — landed under `lib/dataverse/schema/wave4/` (budget = `wmkf_proposalbudgetline.json`, membership = `wmkf_portalmembership.json`) and `lib/dataverse/schema/wave4-existing/` (roster extensions = `wmkf_apprequestperson-roster-fields.json`). The `lib/dataverse/schema/intake/` directory does not exist.
- **`/apply/admin/memberships`** UI + endpoints (Option A path) — recorded as ongoing pilot work at the time of this note.

## Calendar checkpoints (historical — slice 0 deployed S178 2026-05-22)

Original soft-target schedule from agenda § 3B; preserved for historical reference. Slice-0 deploy completed 2026-05-22.

- 2026-05-15 — naming + flow-list response from Connor; budget+roster schema specs drafted.
- 2026-05-19 — checkpoint: schema applied, form-module skeleton renders, end-to-end smoke working.
- 2026-05-26 — dry-run; manually flip a throwaway test request to `'Phase II Pending'` and watch which PA flows fire.
- 2026-05-30 — go/no-go review.
- 2026-06-01 — pilot accepting submissions.
