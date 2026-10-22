---
name: project-awardee-onboarding
description: The Awardee tab and grantee-facing deliverables portal are built end to end; GAL/status-triggered automation remains separate, unverified scope.
metadata:
  type: project
  status: active
  scope: reviewer
  last_verified: 2026-10-22 via AwardeeTab, generate route/service, and grantee-abstract-service source for the staff-triggered rewrite; GAL/status automation not probed
---

## Recall Rule

Read this when planning or changing the post-award Awardee/grantee-deliverables workflow,
its external portal, or a GAL/status-driven automation.

Do:

- Treat `shared/components/workbench/AwardeeTab.js`,
  `pages/api/workbench/grantee-deliverables/*`, `/external/grantee/[token]`, and
  the `wmkf_granteedeliverable` child entity as the live implementation.
- Preserve the shipped abstract approval/edit, artwork upload, caption, waiver/release,
  invite, website-output, and cycle-awardee tracking paths.
- Probe the exact GAL-sent/status signal before designing any automatic invitation or
  abstract-generation trigger.
- Use `docs/GRANTEE_PORTAL_SPEC.md` and the relevant Atlas/API-security entries as
  canonical implementation contracts.

Do not:

- describe Awardee as a placeholder, future tab, or unbuilt external portal;
- rebuild it by generalizing the reviewer-specific `lib/external` implementation;
- infer that the shipped manual/staff-triggered workflow includes GAL/status automation;
- assume additional or GAL/status-triggered AI abstract generation beyond the shipped
  staff-triggered rewrite is in scope without an owner decision.

## Source-backed state

**VERIFIED 2026-07-26:** the PD-facing Awardee tab and distinct grantee-facing portal are
built. The external route is `/external/grantee/[token]`; persistence uses the
`wmkf_granteedeliverable` child entity rather than reviewer-suggestion storage. The live
flow covers invitation/token handling, abstract approve/edit, artwork/caption upload,
waiver agreement, staff tracking, and cycle output.

The Awardee tab also has a staff-triggered house-style rewrite/edit flow for the
applicant's abstract. `AwardeeTab.js` calls the grantee-deliverables generate route;
`grantee-deliverables/generate-service.js` reads the applicant abstract and call text,
uses the `grantee-abstract.generate` Executor prompt, and persists the result with an
ETag. Regeneration is rejected after the grantee submits. This is a staff editorial
action within the grantee-approval workflow; it does not establish automatic generation
or invitation from a GAL/status event.

**UNKNOWN / separate scope:**

1. the exact Dataverse field/value or event that proves a Grant Award Letter was sent;
2. whether that event should automatically send the grantee invitation;
3. whether GAL/status automation should trigger any additional abstract work beyond the
   existing staff-triggered rewrite, and what approval contract would govern it;
4. whether additional post-award artifacts are required beyond the shipped deliverables.

## Historical rationale

The original May 2026 concept correctly identified that the request lifecycle extends
past the board decision and that awardees need to approve an abstract, provide artwork,
and agree to a release. It incorrectly remained in memory as if the external surface and
schema were still future work after those pieces shipped. Preserve only the remaining
GAL/status-trigger questions as future design. Preserve the May rationale for grantee
approval and artwork/release collection; do not treat that rationale as evidence that
future automation has been decided.

Related: `docs/GRANTEE_PORTAL_SPEC.md`, `docs/GRANTEE_PORTAL_BUILD_PLAN.md`,
`docs/audits/AUDIT_REQUEST_WORKBENCH_TRUTH_2026-07-26.md`,
[[project-reviewer-apps-redesign-direction]], [[project-backend-automation]].
