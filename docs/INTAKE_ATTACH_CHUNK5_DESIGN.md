# Chunk 5 Design — POST /api/intake/draft/attach

Pre-implementation design for chunk 5 of the S184 build. Subordinate
to `docs/INTAKE_ATTACH_BUILD_SCOPING.md` (A1-A7) and
`docs/INTAKE_PORTAL_DRAIN_PLAN.md` § "Attachment upload — three-call
dance" (S184 amendments). Companion to chunk-4's design.

The third leg of the three-call dance: after the browser PUTs bytes
to Blob using the token from chunk 4, this endpoint downloads the
bytes back, recomputes sha256/size, magic-byte validates, scans, and
either promotes the entry from `pending_attachments` to `attachments`
(clean) or deletes the Blob (infected / oversized / mismatched magic).

Largest endpoint of the build (~5 distinct outcome branches).

## 1. Contract

### Request

```
POST /api/intake/draft/attach
Content-Type: application/json

{
  "draftId":      <number>,   // matches chunk-4 mint
  "attachmentId": <string>    // UUIDv4 minted by /upload-token
}
```

Per A2/MOD-5: server treats no other client metadata as trusted.
Filename / pathname / contentType / maxBytes all derived from the
pending entry — the client doesn't get to influence them.

### Sequence

Numbered for parity with chunk-4's design § 2.

1. **Method/HTTP** — POST only; 405 otherwise.
2. **Auth** — applicant session + `contactOid`. Same shape as chunks
   3-4 (`getServerSession` + `userType === 'applicant'`).
3. **Body validation** — Allowed: `draftId, attachmentId`. Anything
   else → 400 `unexpected field`. Forbidden (server-derived):
   `pathname, filename, contentType, fieldKey, accountId, formKey,
   requestId, contactOid, draftJson`. `draftId` requires
   `Number.isSafeInteger` (MOD-2 carryover from chunk 4).
   `attachmentId` is a UUIDv4 regex match.
4. **Load draft** — `IntakeDraftService.getById(draftId)`. 404 if not
   found.
5. **Direct-owner short-circuit** — if `draft.contact_oid === contactOid`
   skip bridge + membership. Same pattern as chunk 4.
6. **Bridge** (non-owner path) — `resolveContactForSession`; altKey
   503 + conflict 409 handling.
7. **Membership** (non-owner path) — `hasLiveMembership`; 403 +
   `draft.attach.ownership_denied` audit row on deny.
8. **Q4 reject** — `draft.request_id IS NOT NULL` → 409 `draft_submitted`.
9. **A2 dual-lookup** —
   - Find `attachmentId` in `draft.attachments` (already promoted)?
     → 200 `{status: 'already_attached', attachmentId}`. Idempotent
     retry path; A3-shaped audit row optional (skip to reduce noise).
   - Find `attachmentId` in `draft.pending_attachments`? → take the
     entry as `pending` and continue.
   - Neither → 404 `pending_not_found`. No audit (legitimate cron-
     swept case shouldn't generate audit spam).
10. **Schema lookup** — `getFormSchema(draft.form_key)` + `findFileField(schema, pending.fieldKey)`.
    If schema/field is gone (form retired, schema edited mid-flight),
    500 `form_schema_unknown` / `field_not_uploadable`. Note: a clean
    upload-token mint guaranteed these fields existed at mint time —
    seeing them missing here is a real schema/data drift.
11. **Blob download** — `blobGet(pending.pathname, { access: 'private', useCache: false, token: getIntakeBlobToken() })`. **Codex pre-impl round-1 fix:** structured-error wrapping. Many `@vercel/blob` failure modes throw plain `Error` without an `isTransient` discriminator; the drain (`drain-submissions.js:539-543`) wraps with `buildNoResponseError('blob', err)` first, then classifies. Mirror that:
    ```js
    try {
      result = await blobGet(...);
    } catch (raw) {
      const wrapped = raw?.serviceName ? raw : buildNoResponseError('blob', raw);
      // wrapped now has serviceName='blob' + isTransient + noResponse + status
      ...
    }
    ```
    - `result == null || !result.stream` → 409 `bytes_not_uploaded`.
      Leave pending entry intact; sweep cron removes it after 2h.
      No audit.
    - `wrapped.isTransient === true` (incl. all `noResponse: true`
      cases from `buildNoResponseError`) → 503 `blob_unavailable`
      (retry-friendly). Pending intact.
    - `wrapped.isTransient === false` (4xx, auth, structured non-
      transient) → 500 `blob_misconfigured`. Pending intact. Audit
      `draft.attach_blob_misconfigured`.
12. **Read bytes** — `Buffer.from(await new Response(result.stream).arrayBuffer())`.
    Mirror the drain's pattern at `drain-submissions.js:538`.
13. **Compute sha256 + size** — over the actual bytes, not anything
    the client claimed.
14. **Magic-byte validation** — `validateIntakeAttachment(pending.filename, buf, field.accept)`.
    **Codex pre-impl round-1 fix:** use the field's full `accept[]`
    array (broader allowlist), not `[pending.contentType]` (single-MIME
    too narrow). Matches the drain plan's mandate at
    `INTAKE_PORTAL_DRAIN_PLAN.md:430` and the validator's parameterized
    signature.
    On `ok:false`:
    - 422 `magic_mismatch`.
    - **Blob NOT deleted** (operator-decision posture per scoping doc
      § 4 C5 row; operator inspects the byte-vs-extension mismatch to
      decide if it's malicious or honest user error). The orphan sweep
      eventually deletes after 2h.
    - `removePending(draftId, attachmentId)` so the cardinality slot
      frees up and the applicant can re-upload a properly-typed file.
    - **Audit `draft.attach_magic_mismatch`** (Codex pre-impl round-1
      Q1 reversal — magic mismatch is a probe-shaped signal worth
      logging; A3 split: filename in payload, declared+actual byte
      shape in metadata).
15. **Cardinality re-check** — chunk-4's mint-time cardinality gate
    could now be at cap if concurrent attaches succeeded between mint
    and this attach. Re-check
    `countFieldEntries(draft, pending.fieldKey)` against the field's
    `multiple/maxFiles`. **At cap** (already-attached count meets or
    exceeds the limit, NOT counting this attach):
    - 422 `field_max_files_exceeded` (multi-valued) or `field_already_has_attachment`
      (single-valued).
    - Delete Blob + `removePending`. (Different from magic mismatch:
      these bytes ARE the correct type, just over-limit — no operator
      forensic value.)
    - No audit (race-window timing artifact, not a security signal).
    Codex pre-impl round-1 catch: chunk-3's `promoteToClean` only
    gates on `attachmentId`, not cardinality.
16. **Size cap** — `size > pending.maxBytes` → 413 `size_exceeds_field_max`.
    Delete Blob + `removePending`. **Audit `draft.attach_size_exceeded`**
    (Codex pre-impl round-1 Q1 reversal — token-side enforcement
    failure is an operator-class signal). A3 split: filename in
    payload, sha256/size/maxBytes/contentType in metadata.
17. **Scanner posture (A7)** —
    - `isVirusScanEnabled() === false` → skip scan; treat as clean
      with `scanner: 'skipped'`.
    - `isVirusScanEnabled() === true` AND `CLOUDMERSIVE_API_KEY` set
      → `scanBytes(buf, pending.filename)`.
    - `isVirusScanEnabled() === true` AND key missing → scanner
      throws non-transient at startup; map to 500
      `scan_misconfigured`. Pending intact (operator fix unblocks
      retry). Audit `draft.attach_scan_misconfigured`.
18. **Map scan result**:

    | scan_result | Behavior |
    |---|---|
    | `clean` (or `skipped`) | Build `cleanRow` (see § 2); call `promoteToClean(draftId, attachmentId, cleanRow)`. See § 1.18. |
    | `infected` | `del(pathname, {token})` + `removePending`. Audit `draft.attach_infected` (A3 split — `virusName`, `scannedAt` in metadata). Response 422 with opaque message. |
    | Scanner throws transient + retries exhausted | 503 `scan_unavailable`. Pending intact. Audit `draft.attach_scan_unavailable`. |
    | Scanner throws non-transient | 500 `scan_misconfigured`. Pending intact. Audit `draft.attach_scan_misconfigured`. |

19. **`promoteToClean` result mapping** (chunk-3 return contract):

    | Reason | Response |
    |---|---|
    | `{promoted: true}` | 200 `{status: 'attached', attachmentId}` + audit `draft.attach`. |
    | `{promoted: false, reason: 'race_already_promoted'}` | 200 `{status: 'already_attached', attachmentId}`. Treat as A2 idempotency — the racing call already promoted; we're done. No audit (the racing caller already wrote one). |
    | `{promoted: false, reason: 'pending_not_found'}` | 404 `pending_not_found`. The cron swept it between dual-lookup and promote (race window ≤ ms; in practice impossible at 2h cutoff, but defensive). No audit. |
    | `{promoted: false, reason: 'draft_not_found'}` | 404 `draft_not_found`. Draft deleted between load and promote. No audit. |

### `cleanRow` shape

Built per chunk-3 design § 2, with all bytes-derived fields from
this call:

```json
{
  "attachmentId": "<from pending>",
  "fieldKey":     "<from pending>",
  "filename":     "<from pending>",
  "pathname":     "<from pending>",
  "blob_url":     "<from result.blob.url>",
  "sha256":       "<computed>",
  "size":         <computed>,
  "contentType":  "<from pending>",
  "scan_result":  "clean",
  "scanner":      "cloudmersive | skipped",
  "scanned_at":   "<scanner ISO output | now()>"
}
```

The `blob_url` is the public-ish object URL — the private store still
requires the token to read, but the URL is what the drain pattern
(at `drain-submissions.js`) stores and later uses to copy to SharePoint.

### Error taxonomy

| HTTP | Code | When |
|---|---|---|
| 400 | (per-field message) | Body validation: missing/wrong type, forbidden/extra keys, attachmentId not UUID |
| 401 | Authentication required (applicant) | No applicant session |
| 401 | identity_bridge_invalid | Bridge non-conflict failure |
| 403 | No live membership / not draft owner | Ownership deny |
| 404 | draft_not_found | `getById` returns null OR `promoteToClean` `draft_not_found` |
| 404 | pending_not_found | A2 dual-lookup miss OR `promoteToClean` `pending_not_found` |
| 405 | Method not allowed | Non-POST |
| 409 | draft_submitted | `request_id IS NOT NULL` |
| 409 | identity_conflict | Bridge conflict |
| 409 | bytes_not_uploaded | `blobGet` returns null |
| 413 | size_exceeds_field_max | Computed `size > pending.maxBytes` |
| 422 | magic_mismatch | `validateIntakeAttachment` `ok:false` |
| 422 | infected | Scanner reports `scan_result:'infected'` |
| 500 | scan_misconfigured | Scanner non-transient throw / `CLOUDMERSIVE_API_KEY` missing |
| 500 | blob_misconfigured | `blobGet` non-transient throw |
| 500 | (internal) | Postgres throw / audit insert throw is swallowed; `promoteToClean` throw |
| 500 | form_schema_unknown | Schema gone between mint and attach |
| 502 | Identity bridge failed | Bridge thrown non-altKey |
| 503 | scan_unavailable | Scanner transient retries exhausted |
| 503 | blob_unavailable | `blobGet` transient retries exhausted |
| 503 | identity_service_initializing | altKey transient |

### Response 200

```json
// happy path
{ "status": "attached", "attachmentId": "<uuid>" }

// idempotent retry / racing call won
{ "status": "already_attached", "attachmentId": "<uuid>" }
```

## 2. New service helper — `IntakeDraftService.promoteToClean` (already exists)

Chunk 3 shipped this. Contract recap:
- Returns `{promoted: true}` OR `{promoted: false, reason: 'race_already_promoted' | 'pending_not_found' | 'draft_not_found'}`.
- Atomic at the SQL row level via UPDATE-WHERE EvalPlanQual; no extra
  client work needed in chunk 5.

No new service helpers required for chunk 5.

## 3. Audit shape table

Nine audit actions across chunk-5 outcomes (A3 metadata/payload split,
filename ONLY in payload digest, everything else in metadata; chunk-4
MOD-5 carryover: `draftId` ALSO in metadata even though it's the
`targetId`). Codex pre-impl round-1 added rows for magic mismatch,
size exceeded, and infected-del-failure (Q1 + Q3 reversals).

`scanBytes` errors expose structured fields (`serviceName`, `status`,
`noResponse`, `isTransient`); chunk 5 inlines those into metadata
rather than defining a separate `errorClass` enum.

| Action | When | metadata | payload (digested) |
|---|---|---|---|
| `draft.attach` | clean+promoted | `{draftId, attachmentId, fieldKey, pathname, sha256, size, scanner, scan_result, scannedAt, contentType}` | `{filename}` |
| `draft.attach_infected` | scanner infected | `{draftId, attachmentId, fieldKey, pathname, sha256, size, scanner, scan_result:'infected', virusName, scannedAt, contentType}` | `{filename}` |
| `draft.attach_infected_del_failed` | scanner infected AND `del()` threw | `{draftId, attachmentId, fieldKey, pathname, virusName, delError: {serviceName, status, isTransient, message}}` | `{filename}` |
| `draft.attach_scan_misconfigured` | non-transient scanner throw | `{draftId, attachmentId, fieldKey, pathname, sha256, size, contentType, serviceName, status, isTransient}` | `{filename}` |
| `draft.attach_scan_unavailable` | transient scanner exhaust | `{draftId, attachmentId, fieldKey, pathname, sha256, size, contentType, serviceName, status, isTransient}` | `{filename}` |
| `draft.attach_blob_misconfigured` | non-transient blobGet throw | `{draftId, attachmentId, fieldKey, pathname, contentType, serviceName, status, isTransient}` (no sha256/size — bytes never read) | `{filename}` |
| `draft.attach_magic_mismatch` | byte signature mismatches declared MIME | `{draftId, attachmentId, fieldKey, pathname, sha256, size, declaredContentType, sniffedType, accept}` | `{filename}` |
| `draft.attach_size_exceeded` | computed size > pending.maxBytes | `{draftId, attachmentId, fieldKey, pathname, sha256, size, maxBytes, contentType}` | `{filename}` |
| `draft.attach.ownership_denied` | 403 path | `{draftId, attachmentId, accountIdAttempted}` | `{}` |

Validation-path rejections NOT audited:
- `bytes_not_uploaded` — legitimate timing artifact (user closed tab before PUT).
- `draft_submitted` — applicant tried to upload after submit.
- `pending_not_found` (cron-swept) — legitimate timing artifact.
- `race_already_promoted` → 200 `already_attached` — A2 idempotency, original `draft.attach` row exists.
- Cardinality re-check 422s — race-window timing, not a security signal.

## 4. Test plan

`tests/unit/intake-attach-endpoint.test.js` (new), target ~35 cases:

| Group | Cases |
|---|---|
| method + auth | non-POST 405, no session 401, no contactOid 401, wrong userType 401 |
| body validation | null body 400, array body 400, missing draftId 400, draftId not safe int 400, missing attachmentId 400, attachmentId not UUID 400, extra fields 400, each forbidden field rejected (9 cases) |
| draft load + ownership | getById null 404, getById throws 500, direct-owner skips bridge, non-owner with membership succeeds, non-owner without membership 403 + audit, bridge altKey 503, bridge conflict 409, request_id set 409 draft_submitted |
| A2 dual-lookup | attachmentId in attachments[] → 200 already_attached (no Blob/scan calls), attachmentId in neither → 404 pending_not_found, attachmentId in pending → proceeds to scan path |
| schema | form_schema_unknown 500, field not uploadable 500 (mid-flight schema drift) |
| Blob download | result null → 409 bytes_not_uploaded + pending intact, blobGet transient throw → 503 + pending intact, blobGet non-transient throw → 500 blob_misconfigured + audit, INTAKE_BLOB_RW_TOKEN missing → 500 |
| magic-byte + size | magic mismatch → 422 + del + removePending, size exceeds → 413 + del + removePending |
| scanner posture (A7) | scan disabled → skipped path → 200 attached + audit shows scanner:'skipped', scan enabled + clean → 200 attached, scan enabled + infected → 422 + del + removePending + audit infected, **scan enabled + infected + del throws → 422 + audit infected_del_failed** (Q3), scan transient throw → 503 + audit scan_unavailable, scan non-transient throw → 500 + audit scan_misconfigured |
| promoteToClean mapping | true → 200 attached, race_already_promoted → 200 already_attached, pending_not_found → 404, draft_not_found → 404 |
| audit shape | A3 metadata/payload split for `draft.attach` (all 10 metadata fields, only filename in payload), A3 split for `magic_mismatch` + `size_exceeded` |
| validation deletion semantics | magic mismatch → 422 + Blob NOT deleted + removePending + audit magic_mismatch (operator-decision posture per scoping doc), size exceeded → 413 + del + removePending + audit size_exceeded |
| cardinality re-check | single-valued field already at 1 at attach time (concurrent attach won) → 422 field_already_has_attachment + del + removePending, multi-valued at maxFiles at attach time → 422 + del + removePending, no audit |
| Blob error wrapping | unstructured `get()` throw → wrapped via buildNoResponseError → 503 path, structured non-transient → 500 + audit blob_misconfigured |
| field.accept validation | validate uses full field.accept array, not single pending.contentType (accepts a contentType from accept[] that differs from pending.contentType — currently uncovered case, deferred to integration since the mint constrains contentType to a single value) |

~38 cases (was 35; Codex pre-impl round-1 added infected-del-failed,
cardinality re-check, Blob error wrapping, validation deletion
semantics rows). Mock surfaces: `next-auth/next`,
`contact-bridge-service`, `membership-service`, `intake-draft-service`,
`intake-audit-service`, `@vercel/blob` (`get`, `del`),
`lib/utils/intake-blob`, `lib/utils/form-schema`,
`lib/services/cloudmersive-scan`, `lib/utils/virus-scan-config`,
`lib/utils/service-error` (for buildNoResponseError).

## 5. Locked decisions (post-Codex round-1)

- **Q1 — Audit magic mismatch + size exceeded**: YES (reversal from
  default). Magic mismatch is a probe-shaped signal; size-exceeds is
  a token-enforcement-failure operator signal. Both get A3-split
  audit rows. See § 3 table.
- **Q2 — `already_attached` (A2 idempotency)**: NO audit. The
  original `draft.attach` row already exists; auditing retries adds
  noise without forensic value. Same posture for both dual-lookup
  short-circuit AND `race_already_promoted` from `promoteToClean`.
- **Q3 — `del` failure after `infected`**: return 422 (verdict is
  final, applicant shouldn't get a retry), AND audit
  `draft.attach_infected_del_failed` so the operator sees infected
  bytes that need manual cleanup before the 2h sweep. Reversal from
  default-silent.
- **Q4 — `removePending` failure after successful `del`**: log +
  ignore; sweep cron handles cleanup. Returning 503 here would
  contradict the infected-verdict-is-final posture from Q3.
- **Q5 — Scanner key missing while flag on**: 500 `scan_misconfigured`
  (operator fix needed). Keep 500 — HTTP semantics; 503 would suggest
  transient when it's a config bug. Operator audit + alert handles
  the fix-it path.

## 6. Risks / rollback

- **No schema migration in chunk 5** — chunk 1's `pending_attachments`
  column is the only DB shape change for this whole build; chunks
  4-5-6 use it via the chunk-3 helpers.
- **Security matrix +1 route** — chunk 5 bumps 92 → 93. Update
  `docs/API_ROUTE_SECURITY_MATRIX.md` + `CLAUDE.md` route count +
  atlas reference in the same commit.
- **No production touchpoints yet** — chunk 5 lands the endpoint
  but doesn't wire it into any UI. The form code in
  `shared/components/intake/` is still on the old single-call
  attachment model (file passes through the function). That UI
  rewrite is out of scope for the 6-chunk build; lands in S185+.
