# Atlas: `wmkf_policy` + `wmkf_policyversion` (Dataverse)

**Last verified:** 2026-05-25 via `scripts/reconcile-memory-claims.js`
**Live row counts:** `wmkf_policy` = 2 (`reviewer-coi`, `reviewer-ai-use`); `wmkf_policyversion` = 8 (version history; one Active child per parent, prior versions retained)
**Entity sets:** `wmkf_policies` (parent), `wmkf_policyversions` (child)
**Schema manifests:**
- `lib/dataverse/schema/wave3/01_wmkf_policy.json` (parent entity create)
- `lib/dataverse/schema/wave3/02_wmkf_policyversion.json` (child entity create + parent lookup)
- `lib/dataverse/schema/wave3/03_wmkf_policy_activeversion.json` (parent → active child lookup, added after both entities exist to break the cyclic dependency)

**Seed script:** `scripts/seed-stage2a-policies.mjs`

## Source of truth

**Active.** Staff-editable policy library. Each parent `wmkf_policy` row is a stable conceptual slot (e.g., `reviewer-coi`); each `wmkf_policyversion` child is one specific version of the policy text. The parent's `wmkf_activeversion` lookup points at whichever child is currently in force. Reviewer-facing surfaces fetch the active child by slot code at render time.

General-purpose: applicant T&C, staff handbook, and other future surfaces use the same entity pair without schema changes.

## Schema

### `wmkf_policy` (parent — slot)

| Field | Type | Purpose |
|---|---|---|
| `wmkf_policyid` | Uniqueidentifier (PK) | |
| `wmkf_code` | String, primary name attribute, alt-key `wmkf_policy_code_unique` | Stable slot identifier in kebab-case (e.g., `reviewer-coi`). Application code references slot codes directly. |
| `wmkf_displayname` | String | Human-readable slot name for staff browsing in Dynamics views. |
| `wmkf_description` | Memo | Internal staff note: what the slot is for, where it surfaces. |
| `wmkf_activeversion` | Lookup → `wmkf_policyversion` | The currently-active child. Reading this is the only authoritative way to find the in-force policy text for a slot. |
| `statecode`, `statuscode` | State / Status | Slot lifecycle. |

### `wmkf_policyversion` (child — versioned text)

| Field | Type | Purpose |
|---|---|---|
| `wmkf_policyversionid` | Uniqueidentifier (PK) | |
| `wmkf_versionlabel` | String, primary name attribute (Application Required) | Free-form version identifier (e.g., `2026-05-09`, `v1.2`). Operationally meaningful — appears in screenshots, printouts, audit trails. |
| `wmkf_policy` | Lookup → `wmkf_policy` (Application Required) | Parent slot. |
| `wmkf_policytitle` | String (Application Required) | Card heading rendered in the modal. |
| `wmkf_policybody` | Memo (Application Required) | Full policy text (markdown or plain). |
| `wmkf_effectivedate` | DateTime | When staff intended this version to take effect. **Informational only** — activation is staff-controlled via the parent's `wmkf_activeversion` lookup, not date-driven. |
| `statecode`, `statuscode` | State / Status | Draft / Active / Retired. |

## Read paths

**Render-time fetch by slot code:**

```
GET wmkf_policies?$filter=wmkf_code eq '<slot-code>' and statecode eq 0
  &$expand=wmkf_activeversion($select=wmkf_policyversionid,wmkf_versionlabel,wmkf_policytitle,wmkf_policybody,wmkf_effectivedate)
```

**Historical ack resolution (from a `wmkf_appreviewersuggestion` ack lookup):**

```
GET wmkf_appreviewersuggestions(<id>)?$select=wmkf_coiackedat,wmkf_aiuseackedat
  &$expand=wmkf_coipolicyversion($select=wmkf_versionlabel,wmkf_policytitle,wmkf_policybody;
           $expand=wmkf_policy($select=wmkf_code,wmkf_displayname))
```

The lookup chain (engagement → version → parent slot) preserves the exact policy text the reviewer saw at acknowledgment time, regardless of subsequent staff edits or activation flips.

## Write paths

- **`POST /api/admin/policies` — Publish new version** (S145). Single application write path; staff-driven via `/admin` Policies section. Implementation in `pages/api/admin/policies.js`. Server-side allowlist (`VISIBLE_SLOT_CODES` at line 42) restricts visible/writable slot codes to `reviewer-coi` and `reviewer-ai-use`. Flow:
  1. Validate inputs (allowlist, lengths, date format, markdown via `shared/utils/policy-markdown.js`).
  2. Write a `pending` row to `policy_publish_audit` (Postgres, see migration `006_policy_publish_audit.sql`). Hard-abort on audit-write failure — audit availability is a precondition.
  3. Resolve parent slot by code; fail loud on zero matches or more than one match (`slot_not_provisioned` / `duplicate_slot_rows`).
  4. Idempotency lookup by `(parentId, versionLabel)` against the alternate key `wmkf_policyversion_parent_label_unique`. Dispatch into `already_published` / `label_conflict` / resume-from-flip / fresh-publish branches.
  5. Create child `wmkf_policyversion` → PATCH parent `wmkf_activeversion` lookup with `If-Match: parentEtag` (412 → `concurrency_conflict`, child surfaced as orphan) → PATCH prior version statecode (best-effort).
  6. Write `final` audit row to `policy_publish_audit` with structured outcome JSON + warnings array. On finalize failure, raise `system_alerts` (alert_type=`policy_audit_finalize_failed`) and return `audit_finalize_failed` warning.
- **Direct Dataverse writes by staff** (e.g., via Dynamics admin UI) remain available but bypass the application audit trail. Don't.
- **Edit body in-place:** **DO NOT** edit `wmkf_policybody`/`wmkf_policytitle`/`wmkf_versionlabel` on a child once any engagement row references it. Create a new version row instead. See immutability rules in `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md` §4a.

### Verified statecode/statuscode values (`wmkf_policyversion`)

Probed 2026-05-10 via `scripts/probe-policyversion-statecodes.mjs`. Hardcoded into `POLICY_VERSION_STATUS` in `pages/api/admin/policies.js`. Re-run the probe if Dataverse shows the values have shifted (e.g., custom state additions).

| state | statecode | statuscode |
|---|---|---|
| Active | 0 | 1 |
| Retired (Inactive) | 1 | 2 |

**Source-of-truth convention:** the *only* authoritative signal for "which version is in force" is `parent.wmkf_activeversion`. Version row `statecode` is decorative — the publish route best-efforts the prior version into `Retired` after the parent flip, but failure there does **not** invalidate the publish. `isResidue` in the API response surfaces orphan child versions (created but never activated) so admins can repair them manually if frequent.

### Alternate key (S145)

`wmkf_policyversion_parent_label_unique` on `(_wmkf_policy_value, wmkf_versionlabel)`. Enforces DB-level uniqueness so concurrent publish requests for the same `(slot, label)` pair cannot both create children. The publish route catches the duplicate-key error and re-dispatches into the idempotency branch logic.

## Immutability and delete enforcement

Two layers:
1. **Referential** — the lookups from `wmkf_appreviewersuggestion` to `wmkf_policyversion` use default `Restrict` cascade on delete. A delete of a referenced child fails at the database level.
2. **Security role** (TODO before slice 1 ships to a real cycle): restrict delete privilege on `wmkf_policy` and `wmkf_policyversion` to a small admin role. Ordinary staff who can edit policy bodies should NOT have delete privilege on used rows.

## Seeded slot rows (2026-05-09)

| Code | Display name | Active version label | Body source |
|---|---|---|---|
| `reviewer-coi` | Reviewer Confidentiality and Conflict of Interest | `2026-05-09` | **Placeholder** — pending staff wording feedback per `docs/REVIEWER_STAGE_2A_BUILD_PLAN.md` open question 7. Replace with finalized text via Dynamics admin (create new version row, flip active_version) before slice 1 ships to a real reviewer. |
| `reviewer-ai-use` | Reviewer AI-Use Policy | `2026-05-09` | Lifted from existing review form footer text. May want staff review on parity with what reviewers see today. |

## Cross-system

None. Net-new entity pair; no Postgres mirror, no legacy migration.

## Migration disposition

N/A — created in S143 Stage 2a slice 1.
