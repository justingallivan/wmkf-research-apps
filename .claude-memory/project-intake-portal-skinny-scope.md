---
name: Intake portal — skinny scope, not feature-for-feature GOapply replacement
description: Long-term goal is full GOapply replacement, but pilot is sized like the external reviewer intake — not a parallel GOapply
type: project
originSessionId: 05e61454-b0c9-4b62-a30f-89e979b3157b
status: active
scope: intake
last_verified: 2026-07-27 via owner scope/park decisions and current intake design/source boundaries
---

> **BUILD PARKED (2026-07-08, S348):** the intake-portal build is on the back burner
> (Connor re-engineering GOApply). Retained for revival; don't start build work off
> this memory. See [[project-intake-portal-parked]].

## Recall Rule

Read this when: sizing or scoping any intake-portal pilot work.

Do:
- Anchor on "external reviewer intake but for applicants," not "GOapply but better."
- Use forms-as-code (no form builder UI); per-cycle deploys are acceptable.
- Prefer fields on existing entities over new tables; shrink admin UI to collaborator approval + submitted-request list.

Do not:
- Replicate GOapply's full surface (scholarship automatch, multi-site, donor management, payment processing) — no WMKF value.
- Build the submission PDF generator unless a downstream tool actually needs it.
- Treat the four-table model in the planning doc as pilot scope (it's Phase 1+ expansion).

Ground truth: `docs/INTAKE_PORTAL_DESIGN.md` (still skewed to the larger target), [[project-system-model]].

[VERIFIED 2026-07-27 as owner-approved scope and park decision, not deployed
state]: source currently provides partial intake foundations under `pages/apply`
and `lib/services/intake-*`; any entity/field provision claim must be checked
against `docs/APPLICATION_STATE_ATLAS.md` plus a read-only Dataverse metadata
probe before revival.

The new applicant intake portal targets full GOapply replacement long-term
(target "a"), but every pilot decision should be sized like the external
reviewer intake portal: skinny, focused, leverages existing infra.

**Why:** GOapply is a giant feature surface (scholarship automatch, multi-site,
donor management, third-party contributor, payment processing, Canada charity
DB) that WMKF doesn't use. Replicating it would be multi-quarter work for
features that have no value. Skinny pilot proves the architecture in one cycle
(the next cycle's Phase I intake, ~25 proposals; originally scoped for the
now-superseded June 2026 Phase II Research pilot — see [[project-system-model]]).

**How to apply:**
- When sizing pilot work, anchor on "external reviewer intake but for
  applicants" not "GOapply but better."
- Forms-as-code, no form builder UI. Per-cycle deploys are acceptable for ~6
  cycles/year.
- Submission PDF generator: deferred unless downstream tools actually need it.
  Reviewer pipeline consumes structured fields + attachments fine.
- Admin UI: shrink to the minimum (collaborator approval, list of submitted
  requests). Opportunity/phase config can be code/seed data for pilot.
- Planned schema posture: prefer fields on existing entities over new tables.
  The pilot design uses `contact`, `akoya_request`, and
  `wmkf_portalmembership`; verify current metadata through the Atlas plus a
  read-only probe before revival. The original four-table model is Phase 1+
  expansion, not pilot scope.

Strategic doc: `docs/INTAKE_PORTAL_DESIGN.md` (still skewed toward the larger
target — pilot section needs to be tightened to reflect this skinny scope).

Pilot exit: 25 proposals submitted via portal (or GOapply fallback) without
data loss; reviewer pipeline kickoff fires correctly on Phase II Pending
status flip.
