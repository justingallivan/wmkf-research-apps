---
title: "Chunk 4 Design — POST /api/intake/draft/upload-token"
domain: intake-portal
kind: spec
status: active
summary: "Adds the FIRST endpoint of the three-call dance. The browser PUT (step 2) and /attach (step 3) come in chunk 5."
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - docs/INTAKE_ATTACH_BUILD_SCOPING.md
  - docs/INTAKE_PORTAL_DRAIN_PLAN.md
  - pages/api/intake/draft.js
  - pages/api/intake/draft/upload-token.js
---

# Chunk 4 Design — POST /api/intake/draft/upload-token

Pre-implementation design for chunk 4 of the S184 build. Subordinate
to `docs/INTAKE_ATTACH_BUILD_SCOPING.md` (scoping doc, Codex round-2
locked) and `docs/INTAKE_PORTAL_DRAIN_PLAN.md` § "Attachment upload —
three-call dance" (post-S184 contract amendments).

Adds the FIRST endpoint of the three-call dance. The browser PUT
(step 2) and `/attach` (step 3) come in chunk 5.

## 1. Path-conflict decision (Codex round-1: SKIP refactor)

The scoping doc explicitly says `pages/api/intake/draft.js` (autosave)
and `pages/api/intake/draft/upload-token.js` (this chunk) coexist
under Next.js Pages Router. Per Codex round-1 review: do not refactor
`draft.js` → `draft/index.js`; the refactor is unnecessary and
contradicts the scoping doc. Existing test imports
(`tests/unit/intake-draft-endpoint.test.js:37`) resolve to `draft.js`
under Node's module-resolution rules and stay correct after adding
the new sibling file. New endpoints land alongside `draft.js`:
- `pages/api/intake/draft/upload-token.js` (this chunk)
- `pages/api/intake/draft/attach.js` (chunk 5)

## 2. Contract

### Request

```
POST /api/intake/draft/upload-token
Content-Type: application/json

{
  "draftId":      <number>,  // returned by /api/intake/draft autosave
  "fieldKey":     <string>,  // schema field (e.g. "budget_justification_attachment")
  "filename":     <string>,  // raw user-supplied; server sanitizes
  "contentType":  <string>   // claimed MIME (server tightens to this in the token)
}
```

`draftId` is the integer SERIAL from `intake_drafts.id`. The autosave
endpoint already returns this; the UI carries it forward.

### Sequence

1. **Method/HTTP**: only POST; 405 otherwise.
2. **Auth**: applicant session + `contactOid` (same shape as autosave —
   `lib/services/contact-bridge-service.js`).
3. **Body validation**: 400 on missing/wrong-type fields. **Forbidden
   fields** (server-derived, must NOT appear in body): `attachmentId`,
   `pathname`, `accountId`, `formKey`, `requestId`, `contactOid`,
   `draftJson`. `formKey` rejected outright (don't even compare to
   stored value — `draft.form_key` is the trusted source).
   Codex round-1 expanded list.
4. **Load draft**: `IntakeDraftService.getById(draftId)` (NEW helper —
   see § 3 below). 404 if not found.
5. **Direct-owner short-circuit**: if `draft.contact_oid === session.contactOid`
   skip the bridge + membership round-trip — owner can always upload
   to their own draft. Skip to step 8.
6. **Bridge** (non-owner path only): `resolveContactForSession({oid, email, name})`.
   Same altKey-503 + conflict-409 handling as autosave.
7. **Membership check** (non-owner path only):
   `hasLiveMembership(contactId, draft.account_id)`. 403 if false.
   (The OR branch lets a Contributor at the institution upload
   attachments even if the draft was started by a different
   Submitter — mirrors autosave membership semantics.)
8. **Q4 reject**: if `draft.request_id IS NOT NULL` → 409
   `draft_submitted`. The draft is frozen post-submit.
9. **fieldKey resolution**:
   - Look up `draft.form_key` in `shared/forms/<form_key>/schema.js`.
     The schemas live in a per-form directory; the loader has to map
     `form_key` → schema module. (See § 4 — `getFormSchema(formKey)`.)
   - Walk `schema.sections[].fields[]` AND
     `schema.sections[].fields[*].fields[]` (nested attachment group)
     to find `field.key === fieldKey AND field.type === 'file'`.
   - 422 `unknown_field_key` if not found.
   - 422 `field_not_uploadable` if found but `type !== 'file'`.
10. **contentType validation**: must be in `field.accept[]`. 422
    `content_type_not_allowed` otherwise.
11. **Per-field cardinality enforcement** (Codex Q1 catch): count
    existing entries for this `fieldKey` across BOTH `attachments[]`
    AND `pending_attachments[]`.
    - If `field.multiple !== true`: single-valued field; reject 422
      `field_already_has_attachment` if count > 0.
    - If `field.multiple === true`: reject 422 `field_max_files_exceeded`
      if count ≥ `field.maxFiles`.
    The applicant can `/attach` or remove the existing entry first
    and then retry. Without this gate, the applicant burns Blob
    storage on uploads that submit-strict will reject anyway.
12. **Filename sanitization**: `sanitizeBlobFilename(filename)`. Wrap
    in try/catch; on throw → 422 `filename_invalid`.
13. **maxBytes**: `field.maxSizeMb * 1024 * 1024`.
14. **Mint identifiers**: `attachmentId = crypto.randomUUID()`,
    `pathname = drafts/{draftId}/{attachmentId}` (opaque per A5),
    `now = Date.now()`, `validUntil = now + 3600_000` (1h per A6).
15. **Blob token FIRST** (Codex round-1 reorder — mint before pending
    append so a mint failure doesn't leave an orphan pending entry):
    ```js
    const token = await generateClientTokenFromReadWriteToken({
      pathname,
      maximumSizeInBytes: field.maxSizeMb * 1024 * 1024,
      allowedContentTypes: [contentType],  // tightened to THIS upload
      validUntil,                           // ms timestamp
      addRandomSuffix: false,               // server controls path
      allowOverwrite: false,                // each pathname is unique
      token: getIntakeBlobToken(),          // A4: explicit RW token
    });
    ```
    The Blob token allows ONLY the exact pathname + ONLY the claimed
    contentType + ONLY up to maxBytes. Attacker can't reuse this
    token for a different upload. If mint throws → 500 with audit row
    `draft.upload_token.mint_failed` (so operators see scanner-style
    misconfig); pending_attachments untouched (nothing to clean up).
16. **Pending entry append**: build the JSON shape per chunk-3 design
    § 2 (with `validUntil` from step 14). Call
    `IntakeDraftService.appendPending(draftId, entry)`. If it returns
    `null` → 404 `draft_not_found` (race: draft deleted between
    steps 4 and 16). No Blob compensation needed — the bytes haven't
    been PUT yet; the token will simply expire unused at `validUntil`.
17. **Audit row** (A3 metadata/payload split):
    - `action: 'draft.upload_token.mint'`
    - `actor_oid: contactOid`, `actor_type: 'applicant'`
    - `target_entity: 'intake_drafts'`, `target_id: draftId`
    - `metadata`: `{ attachmentId, fieldKey, pathname, contentType, maxBytes, validUntil }`
    - `payload_digest`: sha256 of `{ filename }` (filename is PII-leaning)
18. **Response 200**:
    ```json
    {
      "attachmentId": "<uuid>",
      "token":        "<vercel client-upload token>",
      "pathname":     "drafts/<draftId>/<attachmentId>",
      "filename":     "<sanitized>",
      "validUntil":   <ms timestamp>
    }
    ```

### Error taxonomy

| HTTP | Code | When |
|---|---|---|
| 400 | (per-field message) | Missing/wrong-type body fields, or rejected forbidden fields |
| 401 | Authentication required (applicant) | No applicant session |
| 403 | No live membership / not draft owner | Ownership check failed |
| 404 | draft_not_found | `getById` returned null OR `appendPending` returned null |
| 405 | Method not allowed | Non-POST |
| 409 | draft_submitted | `draft.request_id IS NOT NULL` (Q4) |
| 409 | identity_conflict | Bridge `conflict` branch |
| 422 | unknown_field_key | fieldKey not in schema |
| 422 | field_not_uploadable | Field exists but `type !== 'file'` |
| 422 | content_type_not_allowed | contentType not in `field.accept[]` |
| 422 | field_already_has_attachment | Single-valued field already has an entry (pending or clean) |
| 422 | field_max_files_exceeded | Multi-valued field at `maxFiles` cap |
| 422 | filename_invalid | `sanitizeBlobFilename` threw |
| 500 | (internal) | Postgres / blob-mint failure |
| 502 | Identity bridge failed | Bridge throws non-altKey error |
| 503 | identity_service_initializing | altKey transient |

Note: `INTAKE_BLOB_RW_TOKEN` missing → `getIntakeBlobToken()` throws →
500 with the helper's structured "scan_misconfigured"-shape message.
This is operator-visible, applicant-opaque (per A4 + A7).

## 3. New service helper needed

### `IntakeDraftService.getById(draftId)`

The autosave endpoint reads drafts via `getByKey({contactOid, accountId, formKey})`,
which is the wrong shape here — the upload-token endpoint has only
`draftId` from the client. Add a single-key fetch:

```js
static async getById(draftId) {
  const result = await sql`
    SELECT * FROM intake_drafts WHERE id = ${draftId}
  `;
  return result.rows[0] ?? null;
}
```

Trivial; no concurrency concerns; one new case in the service tests.

## 4. Schema loader (Codex round-1: static import map)

`shared/forms/<form_key>/schema.js` exports the schema. New utility
`lib/utils/form-schema.js` uses a **static import map** (not a dynamic
`require(templateString)`) so webpack can bundle the schema files
deterministically:

```js
// Static import map. Add new form_key here as schemas are added.
// Webpack can't statically resolve `require(templateString)` reliably,
// and there's only one live schema today.
const phaseIIResearchSchema = require('../../shared/forms/phase-ii-research-2026-06/schema.js');

const SCHEMAS = {
  'phase-ii-research-2026-06': phaseIIResearchSchema,
};

export function getFormSchema(formKey) {
  return SCHEMAS[formKey] ?? null;
}

export function findFileField(schema, fieldKey) {
  for (const section of schema.sections ?? []) {
    for (const field of section.fields ?? []) {
      if (field.key === fieldKey) {
        return field.type === 'file' ? field : { _notUploadable: true, _found: field };
      }
      // Nested attachment group: walk one level deep (sufficient for
      // the live schema; nested file-fields are direct group children).
      if (Array.isArray(field.fields)) {
        for (const nested of field.fields) {
          if (nested.key === fieldKey) {
            return nested.type === 'file' ? nested : { _notUploadable: true, _found: nested };
          }
        }
      }
    }
  }
  return null;
}
```

`findFileField`'s discriminated return distinguishes "not found" (null)
from "found but wrong type" (object with `_notUploadable`).

Helper `countFieldEntries(draft, fieldKey)` for the cardinality gate:

```js
export function countFieldEntries(draft, fieldKey) {
  const clean = Array.isArray(draft.attachments) ? draft.attachments : [];
  const pending = Array.isArray(draft.pending_attachments) ? draft.pending_attachments : [];
  let n = 0;
  for (const a of clean) if (a.fieldKey === fieldKey) n += 1;
  for (const p of pending) if (p.fieldKey === fieldKey) n += 1;
  return n;
}
```

## 5. Test plan

`tests/unit/intake-upload-token-endpoint.test.js` (new), ~18 cases:

| Case | Expected |
|---|---|
| Non-POST | 405 |
| No applicant session | 401 |
| Session missing contactOid | 401 |
| Missing draftId | 400 |
| Wrong-type draftId (string) | 400 |
| Missing fieldKey | 400 |
| Missing filename | 400 |
| Missing contentType | 400 |
| Body contains attachmentId | 400 |
| Body contains pathname | 400 |
| Bridge altKeyNotActive | 503 + Retry-After |
| Bridge conflict | 409 identity_conflict |
| Bridge other failure | 502 |
| `getById` returns null | 404 |
| Not draft owner + no membership | 403 |
| `draft.request_id` non-null | 409 draft_submitted |
| Unknown fieldKey | 422 unknown_field_key |
| Field not uploadable (type !== 'file') | 422 field_not_uploadable |
| contentType not in accept[] | 422 content_type_not_allowed |
| Sanitizer throws | 422 filename_invalid |
| `appendPending` returns null (race) | 404 draft_not_found |
| `generateClientTokenFromReadWriteToken` throws | 500 + audit `mint_failed` |
| `INTAKE_BLOB_RW_TOKEN` missing | 500 |
| Body contains `requestId` | 400 |
| Body contains `contactOid` | 400 |
| Body contains `draftJson` | 400 |
| Direct owner skips bridge + membership (no mocks called) | 200 + assertion |
| Field with `multiple: false` + 1 existing entry | 422 field_already_has_attachment |
| Field with `multiple: true` + count at maxFiles | 422 field_max_files_exceeded |
| 403 ownership failure emits audit row | assertion on audit shape |
| Happy path | 200 + response shape + audit shape |

~30 cases — bumped from the scoping doc's 16 as the error taxonomy
expanded during this design + Codex round-1 additions (forbidden
fields, direct-owner short-circuit, cardinality gate, audit on
ownership-deny).

`tests/unit/intake-draft-service.test.js` (existing) — 1 new case
for `getById` (returns row | null).

## 6. Locked decisions (post-Codex round-1)

- **Q1 — Per-field cardinality gate:** ENFORCE in `/upload-token`.
  Schema already marks multi-valued fields with `multiple: true` +
  `maxFiles: N`. Cardinality check is step 11 (above); 422 with
  `field_already_has_attachment` / `field_max_files_exceeded`. Saves
  applicants from burning storage on uploads submit-strict will
  reject anyway.
- **Q2 — Sanitizer rejection:** 422 `filename_invalid`. Semantic
  failure post-type-check; not a 400.
- **Q3 — Audit on rejection paths:** audit ONLY 403 ownership
  failures (security signal — `draft.upload_token.ownership_denied`).
  Skip 400/404/409/422 to avoid PII-adjacent noise. Happy path
  audits `draft.upload_token.mint` per § 2 step 17. Add one more
  on Blob mint failure: `draft.upload_token.mint_failed` so
  operators see scanner-style misconfig in the same audit trail.
- **Q4 — `allowOverwrite: false`:** correct. A successful PUT
  proceeds to `/attach`, never re-PUTs. A re-PUT signals a bug or
  tamper attempt; fail-loud is right.

## 7. Risks / rollback

- **No path refactor.** Per Codex round-1 + scoping doc, `draft.js`
  and `draft/upload-token.js` coexist cleanly. No `git mv` needed.
- **Schema loader.** Static import map per Codex round-1 — webpack
  bundles deterministically. If a new form_key needs to be added,
  it's a one-line dictionary entry.
- **Security matrix.** Adds one new route → 91 → 92. Update
  `docs/API_ROUTE_SECURITY_MATRIX.md` in the same commit; otherwise
  `check:api-routes` fails.
