---
title: "Grantee Publication Waiver Versioning Plan"
domain: grantee-deliverables
kind: plan
status: draft
summary: "Version the grantee publication waiver like the reviewer COI/AI-use policies: a grantee-waiver slot, admin editing, and an acked-version lookup."
owner: product-engineering
related:
  - docs/GRANTEE_PORTAL_SPEC.md
  - lib/services/admin/policies-service.js
  - lib/external/policy-fetcher.js
  - shared/components/external/GranteeDeliverableForm.js
  - lib/services/grantee-upload.js
  - lib/dataverse/schema/wave3/04_wmkf_appreviewersuggestion_stage2a.json
---

# Grantee Publication Waiver Versioning Plan

## Implementation status — IMPLEMENTED IN CODE 2026-07-09 (S350)

All code, tests, and doc reconciliation are committed to `main` (stages A–D:
`9b327651`, `ec46676e`, `e0cbbb56`, `ebbe0e4c`, + suite fix `8b70fadd`); full suite
green (5224). The proposed artifacts below now EXIST and match this plan
— re-checked this session:
- [RECHECKED after scripts/seed-grantee-waiver-policy.mjs change: built as described in §2; body = current WAIVER_LABEL verbatim]
- [RECHECKED after lib/services/admin/policies-service.js change: `grantee-waiver` added to `VISIBLE_SLOT_CODES` per §3]
- [RECHECKED after lib/external/grantee-waiver-policy.js change: `resolveActiveWaiverPolicy` fail-closed classifier built per §5]
- [RECHECKED after lib/services/grantee-upload.js change: atomic changeset + cross-store recovery built per §4b]

**Prod Dataverse steps — DONE 2026-07-09 (owner-run).** `apply-dataverse-schema
--target=prod --wave=12-grantee-waiver-consent --execute` created `wmkf_WaiverAckedAt`,
`wmkf_WaiverBodyHash`, and the `wmkf_WaiverPolicyVersion` lookup on `wmkf_granteedeliverable`
(prod `wmkf.crm.dynamics.com`); `seed-grantee-waiver-policy.mjs` seeded the `grantee-waiver`
slot + initial version; `probe-grantee-waiver-slot.mjs` passed (VERDICT: OK). The
fail-closed dependency (§5) is now satisfied in prod — the portal edit view resolves
the waiver and records the acknowledged version. Only the production code deploy of
`main` remains (if not already auto-deployed).

## Goal

Today the grantee publication-consent waiver is a hardcoded frontend constant
(`WAIVER_LABEL` in `shared/components/external/GranteeDeliverableForm.js:21`),
rendered as a client-side submit gate and **never persisted** — a deliberate
decision documented in `docs/GRANTEE_PORTAL_SPEC.md:48-54,141-142` ("No consent
fields are persisted to Dataverse").

Owner ask (2026-07-09): make the waiver behave like the reviewer COI/AI-use
policies — staff-editable/versioned in Dataverse, surfaced in the SAME admin
Policies section, and capture which version each grantee consented to.

This plan REVERSES the "no consent fields persisted" decision. That reversal must
be reconciled in `GRANTEE_PORTAL_SPEC.md`.

## Owner-confirmed decisions (2026-07-09)

1. **Ack storage:** a version lookup + timestamp on the `wmkf_granteedeliverable`
   package row (mirror the reviewer suggestion pattern). No text snapshot — the
   immutable `wmkf_policyversion` row is the exact-wording record.
2. **Fail posture:** fail closed, consistent with the reviewer policies
   (`getActivePolicy` has no fallback by design). Provision the slot BEFORE wiring
   the portal to read it.
3. **Schema path:** author schema JSON + a seed script (mirroring the existing
   Stage-2a artifacts); run them against the environment.

## Verified current-state citations (read 2026-07-09)

- [VERIFIED via `lib/services/admin/policies-service.js:40`] `VISIBLE_SLOT_CODES =
  ['reviewer-coi', 'reviewer-ai-use']` is a server-side allowlist; adding a slot
  code here surfaces it, and it also gates `validateInputs`' slot allowlist.
- [VERIFIED via `shared/components/admin/PoliciesSection.js:45-92`] The admin UI
  renders one generic `SlotPanel` per slot returned by `/api/admin/policies`, with
  publish-new-version + version history — no per-slot UI code.
- [VERIFIED via `lib/services/admin/policies-service.js:144,226` +
  `lib/dataverse/adapters/policy.js:161`] `publishPolicy → runPublish →
  createVersion` is generic: pending audit → immutable version create → active
  pointer flip → prior retire → final audit.
- [VERIFIED via `lib/external/policy-fetcher.js:44-88`] `getActivePolicy(slotCode)`
  resolves a slot to its active version with a 5-min cache and FAIL-CLOSED
  semantics (throws on missing parent / no active version / inactive or
  mismatched child; no bundled fallback).
- [VERIFIED via `lib/dataverse/adapters/reviewer-suggestion.js:1319-1322`] The
  reviewer ack is written as a version LOOKUP bind
  (`wmkf_CoiPolicyVersion@odata.bind = /wmkf_policyversions(<id>)`) plus a DateTime
  (`wmkf_coiackedat`). Version id is resolved SERVER-SIDE at respond time
  (`lib/services/external-review/respond-service.js`), never client-supplied.
- [VERIFIED via `lib/dataverse/schema/wave3/04_wmkf_appreviewersuggestion_stage2a.json`]
  Lookups are declared as N:1 `relationships` (referencedEntity `wmkf_policyversion`,
  Restrict cascade); DateTimes as `attributes`. Deployed via
  `scripts/apply-dataverse-schema.js`.
- [VERIFIED via `scripts/seed-stage2a-policies.mjs`] Slot seeding = find/create
  parent by `wmkf_code`, create version child, flip `wmkf_ActiveVersion@odata.bind`;
  idempotent, first-seed only, wrapped in `bypassDynamicsRestrictions`.
- [VERIFIED via `lib/services/grantee-upload.js:111-129`] Submit does an
  ETag-conditional `akoya_request` PATCH + a `patchDeliverable` PATCH
  (`wmkf_imagecaption`, `wmkf_imagefileref`, status→Submitted). **NOT rollback-safe:**
  the `catch` only deletes the newly-uploaded SharePoint item; it does NOT revert the
  first `akoya_request` PATCH if `patchDeliverable` fails — a pre-existing partial-
  success hole (abstract updated, status/caption/image not). See Change 4b.
- [VERIFIED via `pages/api/external/grantee/[token]/submit.js` +
  `pages/api/external/grantee/[token]/context.js`] Both routes exist, token-authed
  via `verifyGranteeToken`, wrapped in `withDalContext`. Neither reads a policy today.
- [VERIFIED via `lib/services/grantee-deliverable-record.js:17-19,96-98`] The
  package row currently exposes `wmkf_deliverablestatus`, `wmkf_imagefileref`,
  `wmkf_imagecaption`; no consent fields.

## Proposed changes

### 1. Dataverse schema (new; irreversible)
Extensions-on-existing JSON on `wmkf_granteedeliverable` (processed after
`wmkf_policyversion` exists):
- `wmkf_WaiverPolicyVersion` — N:1 lookup → `wmkf_policyversion`, Restrict cascade,
  `required: None` (mirrors `wmkf_CoiPolicyVersion`).
- `wmkf_WaiverAckedAt` — DateTime.
Deploy via `scripts/apply-dataverse-schema.js`; add a preflight check.

### 2. Seed the slot
`scripts/seed-grantee-waiver-policy.mjs` (mirror `seed-stage2a-policies.mjs`):
parent `grantee-waiver` / display "Grantee Publication Waiver" + one initial
version whose body is the current `WAIVER_LABEL` text verbatim; flip active pointer.
Version label = today's date (convention).

### 3. Admin visibility
Add `'grantee-waiver'` to `VISIBLE_SLOT_CODES`. UI renders it automatically.

### 4. Grantee portal wiring (fail-closed)

**4a. Consent semantics = record WHAT THE GRANTEE SAW (Codex Finding 1).**
The `policy-fetcher` cache (5-min TTL, per-instance) makes an "active-at-submit"
re-resolve nondeterministic across a mid-session version flip. For a legal consent
record we instead pin the version the grantee actually acknowledged:
- Context route: resolve `getActivePolicy('grantee-waiver')`, return
  `{ waiverPolicy: { title, body, versionId } }`. Fail closed.
- Form: render the body from context (not the constant); keep the client-side
  submit gate; echo `versionId` back on submit.
- Submit route: **do not trust a raw client id** (Codex pass-2 Finding 1 — a
  parent-checked id still only proves it's *some* grantee-waiver version, not the one
  this render served). Instead, context returns a **server-signed waiver-render
  token** (HMAC, reusing the grantee-portal token signing infra — [NOT-READ: the
  grantee-token signer module — confirm the reusable sign/verify helper at impl])
  whose payload binds `{ versionId, requestId, deliverableId, bodyHash, issuedAt }`.
  Submit **verifies the token signature + freshness**, takes `versionId` from the
  VERIFIED payload (not raw input), and still defence-in-depth GUID-validates
  ([VERIFIED via `lib/utils/guid.js:41`] `isGuid`, per `check:trust-boundary-guid`)
  and parent-checks it before binding. Bad/absent/foreign token → fail closed
  (`policy_misconfigured`), never a silent skip. Records exactly what was displayed
  and sidesteps the cache.
  - *Threat-model note:* the grantee consents on their own behalf, so a tampered id
    only weakens their OWN record (no third-party benefit); the signed token is the
    higher-assurance option and is cheap given existing HMAC infra. If the owner
    deems the self-consent threat negligible, the fallback is GUID+parent-check on
    the echoed id alone — decision recorded before impl.

**4b. Atomic DATAVERSE write + cross-store recovery (Codex Findings 2 & 3).**
Today `grantee-upload.js` PATCHes `akoya_request` then `patchDeliverable` with no
revert of the first on the second's failure (verified: upload at
`grantee-upload.js:97-108` precedes the PATCHes at 121-129; the `catch` only cleans
up SharePoint).
- **Dataverse atomicity (scoped honestly):** wrap the two PATCHes — `akoya_request`
  (`wmkf_abstractapproved`) and `wmkf_granteedeliverable` (`wmkf_imagecaption`,
  `wmkf_imagefileref`, status→Submitted, `wmkf_WaiverPolicyVersion@odata.bind`,
  `wmkf_waiverackedat`) — in a **Dataverse changeset**
  (`project-dataverse-batch-changeset-available`) so those two rows commit
  atomically. The **image (SharePoint) is NOT in the changeset**, so this is
  Dataverse-only atomicity, not end-to-end.
- **Per-op If-Match is a HARD requirement (not a residual):** both changeset PATCH
  descriptors MUST carry `request._etag` and `deliverable._etag`; fail closed if
  either is missing (preserve today's `no_etag`→503); map a 412 anywhere in the
  changeset to `conflict` (409). Test: a stale request OR stale deliverable ETag
  rolls back the ENTIRE changeset (neither row mutates).
- **Cross-store (SharePoint) recovery contract:** on a non-412 / unknown changeset
  error after the image upload, **re-read the deliverable before deleting the
  uploaded item** — if it shows the new image committed, do NOT delete (return
  success / recoverable-committed); if uncommitted, delete the upload and alert on
  cleanup failure. Tests: (i) 412 → changeset rollback + upload cleanup; (ii)
  Dataverse failure → cleanup; (iii) unknown-after-commit → no delete of a
  referenced item.

### 5. Rollout ordering + operationalized fail-closed (Codex Finding 3)
Because the portal fails closed on an unresolvable slot: (a) apply schema →
(b) run seed → (c) **post-seed probe** confirms `grantee-waiver` resolves →
(d) deploy code. Write all code first (reversible); run the Dataverse steps only on
owner go. Beyond ordering:
- Map policy failures to explicit route reasons `policy_unavailable` (Dynamics
  degraded / transient) vs `policy_misconfigured` (missing/inactive/foreign slot),
  not a generic 500 `server_error`.
- Emit an operator alert (NotificationService) carrying the slot code on a
  fail-closed submit block, so a mis-seed / wrong-env / post-publish breakage is
  visible rather than silently blocking grantees.
- Add the post-seed resolve probe as a script so it is re-runnable pre-deploy.

### 6. Docs to reconcile
- `GRANTEE_PORTAL_SPEC.md` — reverse the "no consent fields persisted" decision
  with dated rationale.
- `API_ROUTE_SECURITY_MATRIX.md` — context reads a policy; submit writes the lookup.
- `APPLICATION_STATE_ATLAS.md` + the `wmkf_granteedeliverable` atlas page — new fields.

### 7. Tests + gates
- Unit: policies-service shows `grantee-waiver`; `grantee-upload` writes
  version+timestamp and fails closed without a version; form renders dynamic body +
  gates on the checkbox; context includes `waiverPolicy`.
- Gates: `check:api-routes`, `check:atlas`, `check:docs-catalog` (+ self-tests),
  targeted tests.

## Consent-record semantics (owner decision 2026-07-09)
Records **what the grantee saw**: the version id returned by the context route,
echoed on submit, GUID-validated + parent-checked server-side, then bound (Change
4a). Differs deliberately from the reviewer COI/AI-use flow (which records the
active-at-respond version and is cache-sensitive) — the grantee waiver is a
publication-consent record, so pinning the acknowledged version is the defensible
choice.

## Adversarial review (Codex, 2026-07-09) — two passes, resolved in this plan
Pass 1 (original plan):
- **[high] cache nondeterminism** → 4a ("what the grantee saw"; no active-at-submit).
- **[high] two-row write not rollback-safe** → 4b (Dataverse changeset).
- **[medium] fail-closed not operationalized** → §5 (probe, explicit reasons, alert).

Pass 3 (implemented code, base `edf9c2f5`):
- **[medium] render-token bodyHash minted but never persisted/enforced** → resolved:
  the acknowledged body hash is now persisted on the deliverable
  (`wmkf_WaiverBodyHash`, wave12), so a later in-place edit of the acknowledged
  version's body is detectable by audit (stored hash vs current `wmkf_policybody`).

Pass 2 (revised plan):
- **[high] client-echoed id ≠ proof of what was shown** → 4a now uses a server-signed
  waiver-render token; versionId comes from the verified payload (owner may downgrade
  to GUID+parent-check given the self-consent threat model).
- **[high] changeset ≠ atomic across SharePoint-first flow** → 4b atomicity claim
  narrowed to Dataverse + explicit cross-store recovery contract (re-read before
  delete; don't delete a committed reference).
- **[medium] If-Match left as residual** → 4b promotes per-op `If-Match` to a hard
  requirement with a stale-etag rollback test.

## Residual risks (accepted / to watch)
- Fail-closed on a PUBLIC grantee portal: a Dynamics blip or un-provisioned slot
  blocks submissions. Mitigated by provision-first + post-seed probe + explicit
  error reasons + operator alert (§5); accepted per owner's fail-closed choice.
- Publish→visibility lag: `policy-fetcher` 5-min TTL means a newly published waiver
  version is not rendered for up to 5 min. Acceptable (staff publish is rare and not
  time-critical); same as reviewer policies.
- Changeset semantics must include the ETag/If-Match preconditions currently on the
  two separate PATCHes — verify the batch adapter preserves conditional writes.
