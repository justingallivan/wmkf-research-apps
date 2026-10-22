---
name: project-reviewer-ack-provenance-parity-followup
description: "Minor follow-up: reviewer COI/AI-use acks record version+timestamp but no body-hash and bind the version at-submit; the grantee waiver records signed-context version+body-hash, without proving a human viewed or read it."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: global
  last_verified: 2026-10-22 via source read (respond-service.js + grantee-upload.js)
  originSessionId: c238c19b-e78c-4f94-9e8d-c7f1432af984
---

## Recall Rule

Read this when: changing reviewer COI/AI-use acknowledgments or comparing their
provenance to the grantee waiver.

Do:
- Preserve the current distinction: reviewer acknowledgments bind active policy
  versions at submit; the grantee waiver binds version plus body hash at render.
- If implementing parity, trace render-token mint → respond verification →
  Dataverse fields before calling it complete.

Do not:
- Claim reviewer acknowledgments currently prove the exact rendered body.
- Add schema fields without migration/Atlas/consumer reconciliation.

Ground truth: `lib/services/external-review/respond-service.js` resolves active
policy versions in the submit path, while `lib/services/grantee-upload.js`
records the version and body hash from the signed render context. This is
version-at-submit versus render-bound version/body evidence; neither reviewer
version value proves the reviewer read a rendered policy. Follow-up remains
`[PLANNED]` and owner-prioritized as minor; no schema change is authorized by
this memory.

MINOR follow-up (owner-approved priority, S351): make the reviewer COI/AI-use
acknowledgments match the grantee waiver's stronger provenance model.

**Current state (verified 2026-10-22):**
- **Reviewer acks** (`lib/services/external-review/respond-service.js` ~L283): record
  `coiVersionId` / `aiUseVersionId` (version provenance) + `ackedAt`
  (persisted as `wmkf_coiackedat` / `wmkf_aiuseackedat`). NO body hash. The
  version is resolved SERVER-SIDE at accept time via `getActivePolicies` — i.e.
  "whatever was active at submit," NOT bound to what the reviewer was shown
  (small TOCTOU window if staff republish between render and accept).
- **Grantee waiver** (`lib/services/grantee-upload.js`): records
  `wmkf_WaiverPolicyVersion` + `wmkf_waiverackedat` + `wmkf_waiverbodyhash`.
  The signed context token binds the version ID and hash of the policy body
  returned in `waiverPolicy.body`; submit verifies that token and persists its
  values. This records the signed context/response policy version and body hash.
  It does not prove the browser rendered the body or that a human viewed or read it.

**Why:** an auditor asking "what text did this person actually agree to, and
when" gets a stronger answer for grantees than reviewers. Parity would make the
reviewer acks render-bound and add a body-hash.

**How to apply (if picked up):** mirror the grantee pattern — mint a signed
render token carrying versionId+bodyHash when the Stage 2a policy cards render;
verify it on respond and persist a body-hash field per slot instead of
re-resolving the active version at submit. Adds reviewer-side schema fields
(`wmkf_coibodyhash` / `wmkf_aiusebodyhash` or equivalent). See the grantee
implementation as the reference. Related: [[project-grantee-waiver-versioning]].
