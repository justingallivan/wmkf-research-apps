---
name: project-reviewer-ack-provenance-parity-followup
description: "Minor follow-up: reviewer COI/AI-use acks record version+timestamp but no body-hash and bind the version at-submit, unlike the grantee waiver's render-bound version+body-hash."
metadata: 
  node_type: memory
  type: project
  status: active
  scope: global
  last_verified: 2026-07-09 via source read (respond-service.js + grantee-upload.js)
  originSessionId: c238c19b-e78c-4f94-9e8d-c7f1432af984
---

MINOR follow-up (owner-approved priority, S351): make the reviewer COI/AI-use
acknowledgments match the grantee waiver's stronger provenance model.

**Current state (verified 2026-07-09):**
- **Reviewer acks** (`lib/services/external-review/respond-service.js` ~L283): record
  `coiVersionId` / `aiUseVersionId` (version provenance) + `ackedAt`
  (persisted as `wmkf_coiackedat` / `wmkf_aiuseackedat`). NO body hash. The
  version is resolved SERVER-SIDE at accept time via `getActivePolicies` — i.e.
  "whatever was active at submit," NOT bound to what the reviewer was shown
  (small TOCTOU window if staff republish between render and accept).
- **Grantee waiver** (`lib/services/grantee-upload.js`): records
  `wmkf_WaiverPolicyVersion` + `wmkf_waiverackedat` + `wmkf_waiverbodyhash`,
  where version + body-hash come from the signed render token minted at page
  load (context route) — so it binds to EXACTLY what the grantee saw.

**Why:** an auditor asking "what text did this person actually agree to, and
when" gets a stronger answer for grantees than reviewers. Parity would make the
reviewer acks render-bound and add a body-hash.

**How to apply (if picked up):** mirror the grantee pattern — mint a signed
render token carrying versionId+bodyHash when the Stage 2a policy cards render;
verify it on respond and persist a body-hash field per slot instead of
re-resolving the active version at submit. Adds reviewer-side schema fields
(`wmkf_coibodyhash` / `wmkf_aiusebodyhash` or equivalent). See the grantee
implementation as the reference. Related: [[project-grantee-waiver-versioning]].
