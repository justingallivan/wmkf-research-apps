---
title: "Intake Attach Endpoint — Build Scoping (S184)"
domain: intake-portal
kind: plan
status: active
summary: shared/forms/phase-ii-research-2026-06/schema.js is the only live form schema. Shape:.
canonical: false
cataloged: 2026-07-02
owner: product-engineering
related:
  - shared/forms/phase-ii-research-2026-06/schema.js
  - lib/utils/file-magic.js
  - lib/services/intake-draft-service.js
  - pages/api/upload-handler.js
---

# Intake Attach Endpoint — Build Scoping (S184)

Scoping pass before implementing the three-call dance for applicant
attachments. The contract baseline is `INTAKE_PORTAL_DRAIN_PLAN.md`
§"Attachment upload — three-call dance" (lines 341–~450). This doc
captures the audit, **decisions locked after Codex review**, build
sequence, test plan, and production hazards surfaced during scoping
that extend (or amend) the locked contract.

Status: **scoped — ready to implement**. Codex round-1 of scoping
review folded in.

## 1. Audit findings

### 1.1 Form schema — per-field maxBytes lookup

`shared/forms/phase-ii-research-2026-06/schema.js` is the only live form
schema. Shape:

- `ATTACHMENT_TYPES = { pdf, docx, xlsx }` — three MIME types declared;
  XLSX not yet referenced by any field but present in the type table.
- File fields have `{ type: 'file', accept: [<mime>...], maxSizeMb: N }`.
  All current pilot fields use `maxSizeMb: 10`.
- File fields live in two locations:
  - **Inline** top-level field (e.g. `budget_justification_attachment`
    at line 218).
  - **Nested** under the `attachments` group (key=`attachments`, line
    286, with `fields[]` inside).

A flat `fieldKey → {accept, maxBytes}` resolver is needed. Existing
`validate.js` likely already walks this structure — reuse, don't
reimplement. Conversion: `maxBytes = maxSizeMb * 1024 * 1024`.

### 1.2 Magic-byte validation — coverage gap

`lib/utils/file-magic.js`:
- `sniffFileType(buf)` returns `pdf | doc | docx | unknown`. XLSX is
  not detected (would sniff as `docx` since both are OOXML/ZIP).
- `validateReviewFile(filename, buf)` — extension allowlist is
  hardcoded to `pdf | docx | doc`. Review-domain specific.

Intake needs `pdf | docx | xlsx`. Decision (no debate): add
`validateIntakeAttachment(filename, buf, allowedMimeTypes)` next to
`validateReviewFile`. Parameterized so the caller passes the field's
`accept[]`. XLSX sniffing: same ZIP signature as DOCX; disambiguation
by extension (matches today's DOCX behavior). Leave `validateReviewFile`
alone — no shared-domain churn.

### 1.3 IntakeDraftService — JSONB ops pattern

`lib/services/intake-draft-service.js` already has the patterns we need:
- **Atomic append to a JSONB column:** `attachments = attachments || $val::jsonb`
  (`addAttachment`, line 295).
- **Atomic filtered remove:** `jsonb_agg + jsonb_array_elements` filter
  (`removeAttachment`, line 307).

`upsertDraftJson` (S183) writes `draft_json` wholesale, preserving only
`idempotency_key`. This is the reason `pendingAttachments` cannot live
inside `draft_json` — Q1 below.

### 1.4 Vercel Blob — SDK shape + env wiring

`@vercel/blob` v2.3.0 is already a dependency. In-repo usage:
- `pages/api/upload-handler.js` — single-call `handleUpload` flow (not
  what we want here).
- `pages/api/cron/drain-submissions.js:524` — `blobGet(pathname, { token: blobToken })`
  reads from the private intake store using `INTAKE_BLOB_RW_TOKEN`.
  **Confirms the read pattern for `/attach`.**
- Several `put()` call sites for server-side writes — not relevant.

`INTAKE_BLOB_RW_TOKEN` is documented in CLAUDE.md and consumed by the
drain. No upload-side code uses it yet.

**Codex confirmed (Q2 locked):** `@vercel/blob` v2.3 exposes
`generateClientTokenFromReadWriteToken({ pathname, token, maximumSizeInBytes, allowedContentTypes, validUntil })`
(`client.d.ts:340`), and browser-side `put()` accepts that client token
(`client.d.ts:53`). The pre-issued token model is supported as-is; no
architectural fold-back to `handleUpload`.

### 1.5 Test scaffolding pattern

`tests/unit/intake-draft-endpoint.test.js` (S183) is the template.
Mocks: `next-auth/next.getServerSession`, `contact-bridge-service`,
`membership-service`, `intake-draft-service`, `intake-audit-service`.

For attach we additionally mock:
- `@vercel/blob` for `blobGet` and `del`
- `lib/services/cloudmersive-scan` for `scanBytes`

`validateIntakeAttachment` is pure logic — call through with real
bytes, no mock.

**Path correction (Codex catch):** the autosave endpoint lives at
`pages/api/intake/draft.js` (file), not `pages/api/intake/draft/index.js`
(directory). The new endpoints `/upload-token` and `/attach` will
therefore be **new files** alongside it, not siblings inside a
directory:
- `pages/api/intake/draft/upload-token.js`
- `pages/api/intake/draft/attach.js`

Confirming: in Next.js Pages Router, `pages/api/intake/draft.js` matches
`/api/intake/draft` exactly, and `pages/api/intake/draft/upload-token.js`
matches `/api/intake/draft/upload-token` — the two coexist without
conflict (Next's filename-as-route resolution; the directory shadows
nothing as long as no `index.js` is present inside).

## 2. Locked decisions (Codex round-1)

### Q1 — `pending_attachments` storage location → **Option A**

Add `pending_attachments JSONB NOT NULL DEFAULT '[]'::jsonb` as a new
column on `intake_drafts`. Mirrors the existing `attachments` column
(server-managed, never overwritten by autosave). Migration is small
and reversible.

**Rejected alternatives:** carve out a second special case in
`upsertDraftJson` (fragile); unify pending + clean into one column
with a `state` field (forces churn on every existing call site).

### Q2 — Blob client-upload token → **pre-issued via `generateClientTokenFromReadWriteToken`**

Server-side in `/upload-token` mints a one-shot token with explicit
pathname, `maximumSizeInBytes`, `allowedContentTypes`, `validUntil`.
Browser holds the token and PUTs to Blob via `put()` from
`@vercel/blob/client`. Token can ONLY be used for the exact pathname
the server controls.

### Q3 — Filename sanitization → **new small util**

Add `lib/utils/blob-filename.js` exporting `sanitizeBlobFilename(name)`.
Constraints: strip control chars (0x00–0x1F, 0x7F), reject `..`, strip
leading dots/slashes, normalize Unicode (NFKC), truncate to 200 chars
preserving extension. Fail-loud on empty result.

**Rejected:** reuse `lib/utils/sharepoint-buckets.js` or the
person-name-to-eml helper — those are domain-specific to their callers
and don't enforce Blob pathname semantics.

### Q4 — Endpoint guard on submitted drafts → **reject**

Both `/upload-token` and `/attach` reject (409) if the draft has
`request_id IS NOT NULL`. Submit advances `request_id` in the
submission transaction (`pages/api/intake/submit.js:260`); the
draft becomes append-only frozen. Autosave already does this for the
inverse direction.

### Q5 — Orphan sweep audit shape → **one row per removed entry**

Each pending entry removed by the cron emits a separate audit row
with `action: 'draft.attach_orphan_swept'`. Aligns with the existing
"one row per state-changing action" framing
(`lib/services/intake-audit-service.js:4`) and the locked contract
(`drain-plan.md:431`).

## 3. Contract amendments (NEW — extending the locked contract)

These four hazards were surfaced during scoping and extend or amend
the locked contract in `INTAKE_PORTAL_DRAIN_PLAN.md`. Folded into
this scoping doc; the drain plan doc will be updated in the same
commit as chunk 1.

### A1 — Submit must reject non-empty `pending_attachments`

The locked contract's submit-strict validator gates on
`scan_result === 'clean'` for every entry in `attachments[]`. With
`pending_attachments` as a separate column, submit reads only
`attachments` and would silently complete with the pending entries
orphaned in Blob.

**Amendment:** `/api/intake/submit` must `SELECT pending_attachments`
and reject 409 (`pending_attachments_present`) if non-empty. User
guidance: "An upload is still in progress. Wait for it to complete,
or refresh and remove the in-flight item before submitting." This is
a normal user-facing validation failure (not corruption — see A4).

### A2 — `/attach` retry-after-success returns a discriminated success, not a bare 404

The locked contract says: on `/attach` retry after a successful clean
response, the pending entry is gone, so the endpoint returns 404
`pending_not_found`, and the client must independently check
`attachments[]` for the same `attachmentId` to disambiguate
"already-promoted" from "never-existed."

**Amendment:** `/attach` looks up `attachmentId` in BOTH
`pending_attachments` and `attachments` before deciding the response.
- Found in `attachments` (already promoted) → 200 with
  `{status: 'already_attached', attachmentId}`. Idempotent. No-op.
- Found in `pending_attachments` → continue the normal scan flow.
- Not found in either → 404 `pending_not_found`. Either genuinely
  never minted, or swept by the cron after expiry.

This keeps idempotency on the server side, where it belongs.

### A3 — Audit metadata-vs-payload split

`intake-audit-service.js` stores audit rows with two slots: `payload`
(sha256-hashed, opaque) and `metadata` (queryable JSONB). Incident
forensics queries like "every attachment with virus X in the last 30
days" or "every infected upload from contact Y" require the
operationally-relevant fields in `metadata`, not buried in the hash.

**Amendment:** for the six new audit actions (`draft.upload_token.mint`,
`draft.attach`, `draft.attach_infected`, `draft.attach_scan_misconfigured`,
`draft.attach_scan_unavailable`, `draft.attach_orphan_swept`), the
field split is:

| Field | Slot | Why |
|---|---|---|
| `attachmentId` (UUID) | `metadata` | Forensics join key |
| `draftId` (UUID) | `metadata` | Forensics join key |
| `fieldKey` | `metadata` | Filter by which form field was abused |
| `pathname` | `metadata` | Locate Blob during incident response (opaque per A5 — no filename component, so safe in queryable metadata) |
| `sha256` | `metadata` | Cross-store dedup / IOC matching |
| `size` (number) | `metadata` | Anomaly detection |
| `scanner` | `metadata` | "Were these uploads scanned?" query |
| `scan_result` | `metadata` | "Show all `infected`" query |
| `virusName` | `metadata` | "Show all hits for X" query |
| `scannedAt` (ISO) | `metadata` | Time bound |
| `filename` (sanitized) | `payload` | Possibly PII-bearing in user-chosen names |
| `contentType` | `metadata` | Filter by claimed type |
| `validUntil` (token mint only) | `metadata` | Token lifecycle audits |

Filenames are the only PII-leaning field; everything else is structural
and belongs in queryable metadata.

### A4 — `INTAKE_BLOB_RW_TOKEN` enforcement at every call site

`@vercel/blob` SDK defaults to `BLOB_READ_WRITE_TOKEN`
(`client.d.ts:310`). Every Blob call in the new endpoints +
sweep must pass `{ token: process.env.INTAKE_BLOB_RW_TOKEN }`
explicitly. The drain already does this correctly
(`drain-submissions.js:479`).

**Amendment:** add a small helper `lib/utils/intake-blob.js`
exporting `getIntakeBlobToken()` that reads `INTAKE_BLOB_RW_TOKEN`
and fail-louds on missing. All four call sites
(`/upload-token` mint, `/attach` blobGet, `/attach` del-on-infected,
sweep del) route through this helper. Cleaner than three or four
inline `process.env` reads + missing-key checks.

### A5 — Opaque Blob pathname (filename preserved separately)

The locked plan's pathname format `drafts/{draftId}/{attachmentId}/{sanitizedFilename}`
embeds the applicant-chosen filename in the Blob path. If the filename
is PII-bearing (which is why A3 puts `filename` in `payload`/hashed),
the pathname leaks the same data through Blob URL listings, debug
logs, and any audit row that surfaces `pathname`.

**Amendment:** pathname is opaque — `drafts/{draftId}/{attachmentId}`,
no filename component. The original sanitized filename is:

- Returned to the browser in the `/upload-token` response so the UI
  can echo it back to the user.
- Stored in `pending_attachments[].filename` and (after promotion) in
  `attachments[].filename` for the drain to use when copying to
  SharePoint.
- Stored in audit rows under `payload` (hashed) per A3.

This decouples Blob storage layout from filename PII and lets us
keep `pathname` in queryable `metadata` (per A3 — incident response
can grep by pathname without exposing filenames).

### A6 — Sweep cutoff > token expiry, not equal

The locked plan sweeps `pendingAttachments` older than 1h, matching
the 1h Blob token expiry. A slow user (PUT at 0:59, `/attach` at 1:01)
or any clock skew between Vercel + Blob storage turns a legitimate
pending upload into a 404 `pending_not_found` because the sweep ran
between the PUT and the `/attach`.

**Amendment:** sweep cutoff is **2h**. The token still expires at 1h
(prevents bytes after that), but the pending entry survives an
additional hour so a slow `/attach` can complete. After 2h the entry
is genuinely abandoned; the Blob bytes are deleted by the sweep.

### A7 — Scanner flag/key posture (two distinct branches)

`isVirusScanEnabled()` and `CLOUDMERSIVE_API_KEY` are independent. The
locked drain plan allows `VIRUS_SCAN_ENABLED=false` with
`scanner:'skipped'` audit records; the credentials runbook says
`CLOUDMERSIVE_API_KEY` missing with the flag on is fail-loud. Both
are correct but the resulting branch table is worth being explicit:

| `VIRUS_SCAN_ENABLED` | `CLOUDMERSIVE_API_KEY` | Behavior |
|---|---|---|
| `false` (or unset) | any | Skip scan; `scanner:'skipped'`; clean-promote happy path. |
| `true` | present | Run scan; map result per A3 (`infected`/`misconfigured`/`unavailable`/`clean`). |
| `true` | missing | Fail-loud at endpoint startup; `/attach` returns 500 `scan_misconfigured` per S183 contract; pending entry intact. |

`/attach` and `/upload-token` both follow this table.

## 4. Build sequence (Codex-revised, 6 chunks)

Each chunk is ~one logical commit with green tests before moving on.

1. **Migration + schema doc** — add `pending_attachments` column;
   update `lib/db/schema.sql` + new migration file; update
   `docs/atlas/postgres-infra-tables.md` (intake_drafts lives in the
   infra-tables collective page, not a per-table file). Zero behavior change.
2. **Magic-byte extension + filename sanitizer** — add
   `validateIntakeAttachment` to `lib/utils/file-magic.js`; add
   `sanitizeBlobFilename` to `lib/utils/blob-filename.js`; add
   `getIntakeBlobToken` to `lib/utils/intake-blob.js`. Pure logic.
3. **IntakeDraftService — pending helpers** — `appendPending`,
   `removePending`, `promoteToClean` (atomic pending→attachments
   move), `listPendingOlderThan(cutoffIso)`, `selectPendingForDraft(draftId)`.
   Service-level tests with mocked postgres.
4. **`/api/intake/draft/upload-token`** — auth + membership + draft
   ownership + `request_id IS NOT NULL` reject + fieldKey resolution
   + pathname mint + token mint via
   `generateClientTokenFromReadWriteToken` + pendingAttachments append
   + audit row with the A3 metadata split.
5. **`/api/intake/draft/attach`** — auth + dual lookup (A2:
   `attachments` first, then `pending_attachments`) + Blob download
   + recompute sha256 + magic-byte + size cross-check + scan +
   branch: clean→promote+200, already-attached→200, infected→delete+422,
   misconfig→500, unavailable→503 + audit rows with A3 split.
6. **Cron orphan sweep** — extend existing maintenance cron with
   `sweepStaleIntakePending(now)`; per-entry audit row; del via
   `getIntakeBlobToken`; tolerant of 404 from `del`. Also extend
   `/api/intake/submit` with the A1 `pending_attachments` non-empty
   reject in the same commit (paired contract amendment).

After chunk 5: Codex round-1 review. After chunk 6: Codex round-2
review + manual preview verification.

## 5. Test plan

| Chunk | Tests | Mocks |
|---|---|---|
| C1 migration | smoke: column exists, default `[]::jsonb`, NOT NULL | none |
| C2 utils | `validateIntakeAttachment` 8 cases (3 happy + 5 mismatches) + `sanitizeBlobFilename` 10 cases (control chars, `..`, Unicode NFKC, length cap, extension preservation, empty input, leading dot, leading slash, repeated dots, mixed-case ext) + `getIntakeBlobToken` 2 cases (present/missing) | env mock |
| C3 service | `appendPending` happy + idempotent on dup `attachmentId` (A1 gap) + concurrent-promote-race coverage + `promoteToClean` atomic + `removePending` no-op when absent + `listPendingOlderThan` cutoff + draftId in result | postgres mock |
| C4 upload-token | ~16 cases: auth, CSRF, membership any-role, draft ownership, `request_id NOT NULL`-reject (A4 Q4), unknown fieldKey, sanitizer rejection, oversized decl (size > field max), blob-mint-fail, happy 200 shape, audit metadata-vs-payload assertion (A3), pendingAttachments persisted, `INTAKE_BLOB_RW_TOKEN` missing → 500 | next-auth, bridge, membership, draft-service, audit, `@vercel/blob` token mint |
| C5 attach | ~24 cases: auth, dual-lookup precedence — already in attachments → 200 (A2) + retry-during-pending re-scans → deterministic, dual-not-found → 404, bytes_not_uploaded → 409, magic mismatch → 422 + Blob NOT deleted (operator decision), size_exceeds_field_max → 413 + Blob deleted, sha256 recompute discards client claim, clean→atomic promote+200, infected→422 + del + audit_infected + pending removed, misconfig→500 + pending intact, unavailable→503 + pending intact, intake-attachment-shape on the freshly-promoted row, `INTAKE_BLOB_RW_TOKEN` missing → 500, request_id-non-null reject, idempotent retry traces (clean→retry→already_attached) | next-auth, bridge, membership, draft-service, audit, `blobGet`, `del`, `cloudmersive-scan` |
| C6 sweep + submit-amend | ~8 cases: no pending → no-op, one stale pending → del+remove+audit, del-404 → still remove+audit, multiple drafts → all swept, del-throws → log+skip, audit one-row-per-entry shape (Q5), submit with non-empty pending_attachments → 409 (A1), submit happy path unchanged | postgres mock, `del`, audit |

Target: ~70 new unit tests across the 6 chunks (up from the initial
~54 estimate as Codex test-plan gaps fold in).

## 6. Risks and rollback

- **Migration is reversible.** `pending_attachments` defaults to
  `[]::jsonb`; rollback is `ALTER TABLE intake_drafts DROP COLUMN pending_attachments` after rollback of
  endpoints. No data backfill required.
- **A1 + A2 + A3 + A4 are NEW contract amendments** beyond the locked
  drain plan. The drain plan doc must be updated in chunk 1 so the
  contract and the implementation stay aligned (CLAUDE.md "Reconcile
  docs, don't append-patch" rule).
- **Submit endpoint pair-edit** — `/submit` is touched in chunk 6 to
  add the A1 guard. The submit endpoint is on the load-bearing path
  for the pilot; the change is a NEW reject path, not a behavior
  modification. Existing submit tests should pass unchanged; one new
  test for the A1 path.
- **Cron sweep ordering** — the new sweep step runs BEFORE the
  existing maintenance blob-cleanup, so any pending→orphan transitions
  feed into the established cleanup path on the same tick.

## 7. Done definition

A session is "done" when:
1. Six chunks committed, all green CI gates (`check:atlas`,
   `check:atlas:self-test`, `check:api-routes`,
   `check:fact-consistency`, `check:prompt-injection-tagging`,
   `check:canonical-pointers`).
2. ~70 new unit tests passing; total suite 898 → ~968.
3. Both endpoints exercised end-to-end on the preview deployment
   (manual: clean upload via UI → 200; sanitizer rejection → 400;
   `/attach` retry after success → `already_attached`). Same posture
   as the S184 reviewer-upload virus-scan verification (live wiring +
   smoke + unit-test detection mapping).
4. Codex round-1 (post-chunk-5) and round-2 (post-chunk-6) review
   passes folded in.
5. `INTAKE_PORTAL_DRAIN_PLAN.md` updated to reflect A1–A4
   contract amendments and to point at the implementation files.
