---
name: project-grantee-waiver-versioning
description: Grantee publication waiver is VERSIONED (SHIPPED S350) — staff edit it in the admin Policies section; acknowledged version+hash persisted on the deliverable
metadata:
  type: project
status: active
---

SHIPPED S350 (2026-07-09). The grantee publication-consent waiver is no longer a
hardcoded frontend constant — it is a versioned policy in the same
`wmkf_policy`/`wmkf_policyversion` machinery as the reviewer COI/AI-use policies.

**Where staff edit it:** admin → Policies section → **Grantee Publication Waiver**
(`grantee-waiver` slot) → "Publish new version". Generic `PoliciesSection` UI; the
slot is in `VISIBLE_SLOT_CODES` (`lib/services/admin/policies-service.js`).

**Consent captured** on the `wmkf_granteedeliverable` row: `wmkf_WaiverPolicyVersion`
(lookup → the exact acknowledged `wmkf_policyversion`), `wmkf_waiverackedat`, and
`wmkf_waiverbodyhash` (SHA-256 of the body seen — audit aid to detect a later
in-place body edit). Added by schema wave `wave12-grantee-waiver-consent`,
**applied to prod 2026-07-09**; `grantee-waiver` slot seeded + active.

**Records "what the grantee saw", not active-at-submit:** context mints a signed
render token (`mintWaiverRenderToken`, `lib/services/external-token.js`) binding
version+bodyHash; submit verifies it (`verifyWaiverRenderToken`), confirms it was
minted for this request, GUID-validates, then the atomic changeset in
`lib/services/grantee-upload.js` pins the version. This sidesteps the 5-min
`policy-fetcher` cache. Fail-closed: unresolvable slot → context 503
`policy_unavailable` / 500 `policy_misconfigured` (`lib/external/grantee-waiver-policy.js`).

**Rollout lesson (fail-closed feature):** the portal fails closed on the slot, so
the Dataverse schema+seed MUST be provisioned before the code deploys — run
`scripts/probe-grantee-waiver-slot.mjs` as the gate. Reverses the old
GRANTEE_PORTAL_SPEC "no consent fields persisted" decision. Plan + 3 adversarial
Codex passes: `docs/GRANTEE_WAIVER_VERSIONING_PLAN.md`. See
[[feedback-verify-before-destructive-carryover]] (additive twin: provision before deploy).
