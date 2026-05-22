---
name: Intake portal pilot — Track 1 decisions 2026-05-13
description: Sarah+Connor sync Track 1 closed all four agenda items. Two notable deltas from 2026-05-06: 1C reversed to PA-built packet, 1D narrowed to two entities. **SUPERSEDED in part by 2026-05-14 schema review** — see top-of-file banner.
type: project
originSessionId: 3c35888d-8da4-46e3-83ac-31a25bbdc4e4
---
> **⚠️ SUPERSEDED IN PART BY 2026-05-14 SCHEMA REVIEW.** Item 1D's "two child entities (budget + roster)" framing was refined the next day: budget is a new `wmkf_proposalbudgetline` entity (with cost-share unified into its `wmkf_category` enum), but **roster is NOT a new entity** — it extends the existing `wmkf_apprequestperson` junction via 3 nullable fields + 3 new role enum values. The `wmkf_proposalroster` name is withdrawn. Authoritative: `docs/INTAKE_PORTAL_SCHEMA_CHANGES.md:38-40`, `docs/INTAKE_PORTAL_DESIGN.md:587-588`. The `lib/dataverse/schema/intake/` path mentioned in this memory does not exist; the budget spec landed at `docs/BUDGET_FORM_SPEC.md` instead.

Sarah+Connor sync 2026-05-13. Track 1 (Connor-side decisions, 4 items) ran to completion. Track 2 (Sarah's Phase II Research field inventory) was not reached — carry to next Sarah session.

**Why this matters**: Two items reverse or narrow 2026-05-06 decisions. Future sessions should treat 2026-05-13 as ground truth for items 1C and 1D; the older memory's resolutions on those rows are superseded.

**How to apply**: Use the resolutions below directly. The 2026-05-06 memory remains correct for items not re-decided here (membership shape, account creation policy, reviewer-suggestion lifecycle, T&C magic-link pattern, etc.).

## Four Track 1 decisions

| # | Resolution | Delta from 2026-05-06 |
|---|---|---|
| **1A** `wmkf_portal_membership` shape | Approved as drafted. Ships under existing delegated authority, summary-after model. **Institution-claim approval = Option A**, lives portal-side at `/apply/admin/memberships` (new `intake-admin` app key). Connor's plate unchanged. | Re-confirmation of 2026-05-06; Option A clarifies the approval-workflow owner (was implicit). |
| **1B** PA flows on `'Phase II Pending'` | Connor states flows are **origin-agnostic** and work as-is for portal-originated rows. No `wmkf_originatingsystem` field needed for pilot. Verification: smoke-test at 2026-05-26 dry-run. Flow-list email sent 2026-05-13 (turnaround target 2026-05-15). | Net-new — wasn't on the 2026-05-06 list. |
| **1C** Reviewer-consumable artifact | **REVERSAL**: PA-built review packet on `'Phase II Pending'` flip, dropped in `Reviewer_Downloads/` (Option 2). Connor owns the build. Structured-data layout becomes upstream of his packet build. | **Supersedes 2026-05-06 Option 1** (staff-rendered Word/PDF on demand). |
| **1D** Structured-tables persistence | Real child entities (Option 1) — **narrowed scope to budget + roster only**. Milestones → narrative field for pilot; prior support → attached PDF for pilot. JSON specs drafted by 2026-05-15, applied by 2026-05-18. | **Narrows 2026-05-06** which included `wmkf_priorsupport` and `wmkf_milestone`. |

## Naming alignment is open

2026-05-06 suggested `wmkf_budgetline` and `wmkf_personnel`. 2026-05-13 sketch (during the meeting) used `wmkf_proposalbudgetline` and `wmkf_proposalroster`. Final names land at Connor's 2026-05-15 schema design review — don't write the JSON specs at the new names without resolving this.

## What carries to next session

- **Track 2 — Sarah field inventory** wasn't reached. Schedule a Sarah-only session before the 2026-05-19 checkpoint.
- **Connor's flow-list response** (1B email) — target 2026-05-15. Watch for replies that reveal a GOapply-coupled flow we missed.
- **Two JSON schema specs** under `lib/dataverse/schema/intake/` (budget + roster) — draft after naming resolves with Connor.
- **`/apply/admin/memberships`** UI + endpoints (Option A path).

## Calendar checkpoints (from agenda § 3B)

- **2026-05-15** — naming + flow-list response from Connor; budget+roster schema specs drafted.
- **2026-05-19** — checkpoint: schema applied, form-module skeleton renders, end-to-end smoke working.
- **2026-05-26** — dry-run; manually flip a throwaway test request to `'Phase II Pending'` and watch which PA flows fire.
- **2026-05-30** — go/no-go review.
- **2026-06-01** — pilot accepting submissions.
