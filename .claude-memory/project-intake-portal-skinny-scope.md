---
name: Intake portal — skinny scope, not feature-for-feature GOapply replacement
description: Long-term goal is full GOapply replacement, but pilot is sized like the external reviewer intake — not a parallel GOapply
type: project
originSessionId: 05e61454-b0c9-4b62-a30f-89e979b3157b
---
The new applicant intake portal targets full GOapply replacement long-term
(target "a"), but every pilot decision should be sized like the external
reviewer intake portal: skinny, focused, leverages existing infra.

**Why:** GOapply is a giant feature surface (scholarship automatch, multi-site,
donor management, third-party contributor, payment processing, Canada charity
DB) that WMKF doesn't use. Replicating it would be multi-quarter work for
features that have no value. Skinny pilot proves the architecture in one cycle
(Phase II Research, mid-June 2026, ~25 proposals).

**How to apply:**
- When sizing pilot work, anchor on "external reviewer intake but for
  applicants" not "GOapply but better."
- Forms-as-code, no form builder UI. Per-cycle deploys are acceptable for ~6
  cycles/year.
- Submission PDF generator: deferred unless downstream tools actually need it.
  Reviewer pipeline consumes structured fields + attachments fine.
- Admin UI: shrink to the minimum (collaborator approval, list of submitted
  requests). Opportunity/phase config can be code/seed data for pilot.
- Schema: prefer fields on existing entities over new tables. Pilot adds
  fields to `contact` and `akoya_request`, plus one new entity
  `wmkf_portal_membership`. The four-table model in the original planning doc
  is for Phase 1+ expansion, not pilot.

Strategic doc: `docs/INTAKE_PORTAL_DESIGN.md` (still skewed toward the larger
target — pilot section needs to be tightened to reflect this skinny scope).

Pilot exit: 25 proposals submitted via portal (or GOapply fallback) without
data loss; reviewer pipeline kickoff fires correctly on Phase II Pending
status flip.
