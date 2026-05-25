# Chunk 3 Design — IntakeDraftService pending helpers

Pre-implementation design for the five helpers chunk 3 adds to
`lib/services/intake-draft-service.js`. Subordinate to
`docs/INTAKE_ATTACH_BUILD_SCOPING.md` (the authoritative scoping
doc, post-Codex round-2). Scope: SQL shape, function signatures,
dedup/concurrency policy, return contracts. No endpoint code in this
chunk; that lands in chunks 4 + 5.

## 1. The five helpers

| Helper | Purpose | Called from |
|---|---|---|
| `appendPending(draftId, entry)` | Add a new pending entry; idempotent on duplicate `attachmentId`. | `/upload-token` |
| `selectPendingForDraft(draftId)` | Read all pending entries for one draft. | `/attach` lookup step |
| `promoteToClean(draftId, attachmentId, cleanRow)` | Atomic move: remove from `pending_attachments`, append to `attachments`. | `/attach` happy path |
| `removePending(draftId, attachmentId)` | Atomic filter from `pending_attachments`; no-op when absent. | `/attach` infected/413 branches |
| `listPendingOlderThan(cutoffIso)` | Read all stale pending entries across drafts, with their `draftId`. | sweep cron |

## 2. Shared shape

The pending-entry JSON object stored in `pending_attachments[]` is
fixed by `/upload-token`:

```json
{
  "attachmentId": "<uuid v4>",
  "fieldKey": "<key from shared/forms/.../schema.js>",
  "filename": "<sanitizeBlobFilename output>",
  "pathname": "drafts/<draftId>/<attachmentId>",
  "contentType": "<mime>",
  "maxBytes": 10485760,
  "createdAt": "<iso 8601>",
  "validUntil": "<iso 8601 — createdAt + 1h>"
}
```

The clean entry written to `attachments[]` by `promoteToClean()`:

```json
{
  "attachmentId": "<uuid v4>",
  "fieldKey": "<key>",
  "filename": "<sanitized>",
  "pathname": "drafts/<draftId>/<attachmentId>",
  "blob_url": "<vercel blob URL>",
  "sha256": "<64-hex>",
  "size": 12345,
  "contentType": "<mime>",
  "scan_result": "clean",
  "scanner": "cloudmersive | skipped",
  "scanned_at": "<iso 8601>"
}
```

(The clean shape is the existing `attachments[]` contract from
S183; the new `attachmentId` field is the join key into pending and
the dual-lookup discriminator for A2.)

## 3. SQL shapes

All five use the existing `sql` tagged-template from `@vercel/postgres`
(same as `appendAttachment` / `removeAttachment`). All UPDATEs bump
`updated_at = now()`.

### 3.1 `appendPending(draftId, entry)`

```sql
UPDATE intake_drafts
SET pending_attachments = CASE
      WHEN EXISTS (
        SELECT 1 FROM jsonb_array_elements(pending_attachments) e
        WHERE e->>'attachmentId' = ${entry.attachmentId}
      ) THEN pending_attachments
      ELSE pending_attachments || ${JSON.stringify(entry)}::jsonb
    END,
    updated_at = now()
WHERE id = ${draftId}
RETURNING pending_attachments;
```

**Dedup policy:** idempotent. A duplicate `attachmentId` collides
∼never in practice (server mints UUIDv4) but defense in depth
catches a retry of `/upload-token` for the same logical upload —
the helper is a no-op in that case rather than throwing.

**Return:** `{ pending: <array> }` if draft exists; `null` if not.
Caller checks for presence of `attachmentId` in the returned array
to confirm the append happened (or was already there).

### 3.2 `selectPendingForDraft(draftId)`

```sql
SELECT pending_attachments
FROM intake_drafts
WHERE id = ${draftId};
```

**Return:** `<array>` if draft exists (possibly `[]`); `null` if not.

### 3.3 `promoteToClean(draftId, attachmentId, cleanRow, fieldCardinality)`

**S184 chunk-5 post-impl extension:** added the required
`fieldCardinality: {fieldKey, cap}` parameter. The cardinality
gate moves from in-endpoint TOCTOU (chunk-5 v0) to a SQL-level WHERE
clause that gives true atomic correctness against concurrent
promotions to the same fieldKey. See chunk-5 design § 19 for the
caller-side handling of the new `cap_exceeded_race` reason.

#### Original (now obsolete) signature

`promoteToClean(draftId, attachmentId, cleanRow)`

Atomic move in a single statement. The existence checks live in the
UPDATE's `WHERE` clause (NOT in a CTE) — at READ COMMITTED, Postgres'
EvalPlanQual mechanism re-evaluates the UPDATE's `WHERE` after a
row-level write lock wait, which gives us the serialization we need.
A CTE's `EXISTS` subquery is NOT documented to re-evaluate after the
wait, so we don't use one. Codex round-1 catch.

The UPDATE also gates on `attachmentId NOT already in attachments[]`,
preventing a double-append if A2's dual-lookup races with a concurrent
`/attach` (Codex round-1 contract-drift catch — without this guard,
two racing calls could both pass dual-lookup, both call promote, and
the attachment would appear twice).

```sql
UPDATE intake_drafts
SET pending_attachments = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(pending_attachments) e
      WHERE e->>'attachmentId' <> ${attachmentId}
    ),
    attachments = attachments || ${JSON.stringify([cleanRow])}::jsonb,
    updated_at = now()
WHERE id = ${draftId}
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(pending_attachments) e
    WHERE e->>'attachmentId' = ${attachmentId}
  )
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(attachments) a
    WHERE a->>'attachmentId' = ${attachmentId}
  )
RETURNING id;
```

**Concurrency reasoning:** at READ COMMITTED, two concurrent
`promoteToClean` calls for the same `(draftId, attachmentId)`
serialize on the row-level write lock. When the second caller's
lock acquisition completes, EvalPlanQual re-evaluates the UPDATE's
`WHERE` clause against the now-committed state — pending entry is
gone AND attachments entry is present, so both gates are false and
the UPDATE is a no-op (0 rows). This is the documented Postgres
mechanism: https://www.postgresql.org/docs/current/transaction-iso.html
§ "Read Committed Isolation Level".

**Return:** `{ promoted: true }` on success; `{ promoted: false, reason: 'race_already_promoted' }`
on the racing-caller path; `{ promoted: false, reason: 'pending_not_found' }`
if neither gate condition holds (e.g. entry was swept by the cron
between dual-lookup and promote); `{ promoted: false, reason: 'draft_not_found' }`
if the draft id doesn't exist.

The caller in `/attach` treats `race_already_promoted` the same as
A2's `already_attached` short-circuit — by the time we observe it,
the attachment IS in `attachments[]` (just put there by the racing
call), so a follow-up `SELECT attachments` confirms and we return
200 `{status: 'already_attached', attachmentId}`.

**Disambiguating the three 0-row outcomes:** the helper runs a
follow-up read after 0 rows:
1. `SELECT id, attachments FROM intake_drafts WHERE id = $draftId`
2. No row → `draft_not_found`.
3. Row exists, `attachmentId` in `attachments[]` → `race_already_promoted`.
4. Row exists, `attachmentId` NOT in `attachments[]` AND not in
   `pending_attachments[]` → `pending_not_found` (likely cron-swept).

### 3.4 `removePending(draftId, attachmentId)`

```sql
UPDATE intake_drafts
SET pending_attachments = (
      SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
      FROM jsonb_array_elements(pending_attachments) e
      WHERE e->>'attachmentId' <> ${attachmentId}
    ),
    updated_at = now()
WHERE id = ${draftId}
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(pending_attachments) e
    WHERE e->>'attachmentId' = ${attachmentId}
  )
RETURNING id;
```

**Return:** `{ removed: true }` if 1 row updated; `{ removed: false }`
on 0 rows (entry not present OR draft gone — caller doesn't need to
distinguish; both are "no-op, nothing to clean up").

### 3.5 `listPendingOlderThan(cutoffIso)`

```sql
SELECT d.id AS draft_id, e AS entry
FROM intake_drafts d, jsonb_array_elements(d.pending_attachments) e
WHERE (e->>'createdAt')::timestamptz < ${cutoffIso}::timestamptz
ORDER BY d.id, (e->>'createdAt')::timestamptz;
```

**Caller:** the sweep cron computes `cutoffIso = (new Date(Date.now() - 2*3600*1000)).toISOString()`
(per A6) and passes it in. Helper itself does not read the clock —
keeps it deterministic for unit tests.

**Return:** `[{ draftId, entry }, ...]` — flat list. Empty array if
no stale entries. The sweep cron iterates this list, calls
`getIntakeBlobToken()` + `del(entry.pathname)`, then
`removePending(draftId, entry.attachmentId)` + audit row.

## 4. Function signatures

```js
class IntakeDraftService {
  // ...existing methods...

  /**
   * Append a pending-attachment entry. Idempotent on duplicate
   * attachmentId.
   * @param {number} draftId
   * @param {{attachmentId, fieldKey, filename, pathname, contentType, maxBytes, createdAt, validUntil}} entry
   * @returns {Promise<{pending: Array} | null>}  null if draft not found
   */
  static async appendPending(draftId, entry) { ... }

  /**
   * Read pending entries for one draft.
   * @param {number} draftId
   * @returns {Promise<Array | null>}  null if draft not found
   */
  static async selectPendingForDraft(draftId) { ... }

  /**
   * Atomic move: remove from pending, append to attachments.
   * @param {number} draftId
   * @param {string} attachmentId
   * @param {object} cleanRow  shape per § 2 above
   * @returns {Promise<{promoted: true} | {promoted: false, reason: 'race_already_promoted' | 'pending_not_found' | 'draft_not_found'}>}
   */
  static async promoteToClean(draftId, attachmentId, cleanRow) { ... }

  /**
   * Remove a pending entry; no-op if not present.
   * @param {number} draftId
   * @param {string} attachmentId
   * @returns {Promise<{removed: boolean}>}
   */
  static async removePending(draftId, attachmentId) { ... }

  /**
   * Stale pending entries across all drafts.
   * @param {string} cutoffIso  ISO 8601 timestamp; entries with createdAt < this are returned
   * @returns {Promise<Array<{draftId: number, entry: object}>>}
   */
  static async listPendingOlderThan(cutoffIso) { ... }
}
```

## 5. Test plan

`tests/unit/intake-draft-service-pending.test.js` (new file —
keeps the existing `intake-draft-service.test.js` focused on
S183's `upsertDraftJson`). Mock `@vercel/postgres` the same way
as the existing test.

Target ~12 cases (up from the scoping-doc's 6 — three Codex round-2
test-plan gaps fold in):

| Helper | Cases |
|---|---|
| `appendPending` | (1) happy: returns array containing new entry; (2) idempotent dup: returns array with attachmentId present only once; (3) draft not found → returns null |
| `selectPendingForDraft` | (1) happy: returns array; (2) draft not found → null; (3) empty pending → [] |
| `promoteToClean` | (1) happy: `{promoted: true}`; (2) racing path: 0 rows + draft exists + attachmentId in attachments[] → `{promoted: false, reason: 'race_already_promoted'}`; (3) pending swept: 0 rows + draft exists + attachmentId in neither array → `{promoted: false, reason: 'pending_not_found'}`; (4) draft not found: 0 rows + no draft → `{promoted: false, reason: 'draft_not_found'}` |
| `removePending` | (1) happy: `{removed: true}`; (2) entry absent: `{removed: false}` |
| `listPendingOlderThan` | (1) happy: returns `[{draftId, entry}, ...]` with the right shape; (2) empty result: returns `[]`; (3) ISO cutoff passed through unchanged (no in-helper clock read) |

The SQL itself (race-safety of the CTE in `promoteToClean`, JSONB
null handling, etc.) is intrinsically not a unit-test shape — mocks
don't run real PG. The integration tests in chunk 4 + 5 exercise
the actual SQL against a test DB.

## 6. Open question

**Does the pending-entry append need an updated_at-driven uniqueness
within the array beyond `attachmentId`?** No — `attachmentId` is
server-minted via `crypto.randomUUID()`, so a collision is
cryptographically improbable. The dedup is purely defense in depth
against a retry of `/upload-token` for the same logical request,
which is exactly the case where idempotency is desirable.
