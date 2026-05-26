/**
 * IntakeDraftService - CRUD over the intake_drafts table.
 *
 * Drafts are Postgres-only — they never reach Dynamics directly. Submission
 * is asynchronous via the drain queue:
 *   1. /api/intake/submit reads the draft, validates, INSERTs a
 *      submission_jobs row (idempotency-keyed), and pins
 *      intake_drafts.request_id so autosave can't mutate the frozen payload.
 *   2. /api/cron/drain-submissions (every 2 min in vercel.json) advances the
 *      job: scanning → request_created (POST akoya_request) → files_moved
 *      (Blob → SharePoint) → dynamics_patched (currently: budget-line
 *      children only; persons + parent aggregate PATCH are unbuilt and parked)
 *      → status_flipped (unbuilt, pending Connor Q1, parked) → completed.
 *   3. At terminal `completed`, the draft row is cleared.
 *
 * Source of truth for the submit/drain seam + current state vs. deferred
 * handlers: docs/INTAKE_PORTAL_DRAIN_PLAN.md.
 *
 * Uniqueness is scoped per partial unique index:
 *   - request_id IS NOT NULL → (account_id, request_id, form_key)
 *   - request_id IS NULL     → (contact_oid, account_id, form_key)
 *     ↑ contact-scoped after migration 012 (P3, v7): the single-phase pivot
 *       makes the requestless branch dominant, so two applicants at the same
 *       institution must be able to hold active drafts for the same form
 *       independently.
 * `upsert()` switches between the two ON CONFLICT targets accordingly.
 *
 * pending_attachments JSONB (migration 013, S184) holds attachments mid-way
 * through the three-call attach dance (upload-token → browser PUT → attach
 * scan/promote). MaintenanceService.sweepIntakePending reaps rows older than
 * 2h. Server-managed — never overwritten by autosave.
 *
 * See docs/INTAKE_PORTAL_DESIGN.md for the design backdrop.
 */

const { sql } = require('@vercel/postgres');

// RFC 4122 §4.4 UUIDv4: 8-4-4-4-12 hex with version nibble `4` and
// variant bits `10xx` (= 8/9/a/b at the variant nibble). Used by
// upsertDraftJson to validate idempotency_key shape.
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class IntakeDraftService {
  /**
   * Insert or update a draft keyed by (account_id, request_id, form_key).
   * Returns the full row.
   */
  static async upsert({
    contactOid,
    accountId,
    requestId = null,
    formKey,
    draftJson = {},
    attachments = [],
  }) {
    if (!contactOid) throw new Error('contactOid is required');
    if (!accountId) throw new Error('accountId is required');
    if (!formKey) throw new Error('formKey is required');

    const draftJsonStr = JSON.stringify(draftJson);
    const attachmentsStr = JSON.stringify(attachments);

    if (requestId) {
      // With-request branch: `request_id` is populated by /api/intake/submit in
      // the same txn as the submission_jobs INSERT (v7 §"Draft rotation on 409").
      // After that, the draft is frozen for the v1 user-facing /apply flow — the
      // applicant doesn't edit a draft once it has a request_id; failed re-submits
      // route to a brand-new requestless draft. The v1.x compliance loop (out of
      // v1 scope per the plan) is the future consumer of this branch.
      //
      // Because v1 doesn't hit this UPDATE path, the partial-unique on
      // (account_id, request_id, form_key) is sufficient: request_id is unique
      // per submission, so contact-scoping it would add no value. If the v1.x
      // compliance loop ever lets two contacts at the same institution edit
      // the same submitted request's draft, that workflow will need to (a) rekey
      // the with-request partial-unique to include contact_oid and (b) update
      // this DO UPDATE set accordingly. Today, keeping DO UPDATE writing
      // contact_oid is defensive but moot.
      const result = await sql`
        INSERT INTO intake_drafts (
          contact_oid, account_id, request_id, form_key,
          draft_json, attachments
        ) VALUES (
          ${contactOid}, ${accountId}, ${requestId}, ${formKey},
          ${draftJsonStr}::jsonb, ${attachmentsStr}::jsonb
        )
        ON CONFLICT (account_id, request_id, form_key)
        WHERE request_id IS NOT NULL
        DO UPDATE SET
          contact_oid = EXCLUDED.contact_oid,
          draft_json = EXCLUDED.draft_json,
          attachments = EXCLUDED.attachments,
          updated_at = now()
        RETURNING *
      `;
      return result.rows[0];
    }

    const result = await sql`
      INSERT INTO intake_drafts (
        contact_oid, account_id, request_id, form_key,
        draft_json, attachments
      ) VALUES (
        ${contactOid}, ${accountId}, NULL, ${formKey},
        ${draftJsonStr}::jsonb, ${attachmentsStr}::jsonb
      )
      ON CONFLICT (contact_oid, account_id, form_key)
      WHERE request_id IS NULL
      DO UPDATE SET
        draft_json = EXCLUDED.draft_json,
        attachments = EXCLUDED.attachments,
        updated_at = now()
      RETURNING *
    `;
    return result.rows[0];
  }

  /**
   * Look up a single draft by its natural key.
   *
   * Requestless branch (request_id IS NULL) requires `contactOid` after P3 —
   * the index is now (contact_oid, account_id, form_key) and a lookup without
   * contact scoping could return either of multiple contacts' active drafts.
   */
  static async getByKey({ contactOid = null, accountId, requestId = null, formKey }) {
    if (requestId) {
      const result = await sql`
        SELECT * FROM intake_drafts
        WHERE account_id = ${accountId}
          AND request_id = ${requestId}
          AND form_key = ${formKey}
        LIMIT 1
      `;
      return result.rows[0] ?? null;
    }
    if (!contactOid) {
      throw new Error('getByKey: contactOid is required when requestId is null (P3, v7)');
    }
    const result = await sql`
      SELECT * FROM intake_drafts
      WHERE contact_oid = ${contactOid}
        AND account_id = ${accountId}
        AND request_id IS NULL
        AND form_key = ${formKey}
      LIMIT 1
    `;
    return result.rows[0] ?? null;
  }

  /**
   * Autosave path: INSERT-or-UPDATE that touches ONLY draft_json (and
   * updated_at). Never overwrites attachments[] — those are managed
   * independently by the /attach endpoint via appendAttachment() and
   * removeAttachment().
   *
   * Why this exists separate from upsert(): the autosave endpoint runs
   * on every debounced edit (potentially many times per minute). The
   * full upsert path would have a race window where an autosave between
   * a /attach append and the UI's next state push would clobber the
   * appended row. By scoping autosave to only draft_json, append-side
   * concurrency is provably safe.
   *
   * On INSERT, attachments[] defaults to `[]::jsonb`.
   * On UPDATE, attachments[] is left untouched.
   *
   * Same partial-unique branching as upsert():
   *   requestId IS NULL → ON CONFLICT (contact_oid, account_id, form_key)
   *   requestId set     → ON CONFLICT (account_id, request_id, form_key)
   */
  static async upsertDraftJson({
    contactOid,
    accountId,
    requestId = null,
    formKey,
    draftJson = {},
  }) {
    if (!contactOid) throw new Error('contactOid is required');
    if (!accountId) throw new Error('accountId is required');
    if (!formKey) throw new Error('formKey is required');

    const draftJsonStr = JSON.stringify(draftJson);

    if (requestId) {
      const result = await sql`
        INSERT INTO intake_drafts (
          contact_oid, account_id, request_id, form_key,
          draft_json, attachments
        ) VALUES (
          ${contactOid}, ${accountId}, ${requestId}, ${formKey},
          ${draftJsonStr}::jsonb, '[]'::jsonb
        )
        ON CONFLICT (account_id, request_id, form_key)
        WHERE request_id IS NOT NULL
        DO UPDATE SET
          contact_oid = EXCLUDED.contact_oid,
          draft_json = EXCLUDED.draft_json,
          updated_at = now()
        RETURNING *
      `;
      return result.rows[0];
    }

    // Service-level pre-condition (Codex S183-round-9 LOW, tightened in
    // round-10): require the caller to supply a UUIDv4-shaped
    // idempotency_key in draftJson.
    //
    // Why UUIDv4 specifically and not just "any non-empty string":
    //   The field is internal infrastructure — only the endpoint
    //   pages/api/intake/draft.js mints values, and it always mints
    //   via crypto.randomUUID() (UUIDv4). A whitespace-only,
    //   control-char-bearing, or 1KB-long key would technically work
    //   in Postgres's UNIQUE constraint but would violate the implicit
    //   shape contract /submit and the drain assume. Defensive at the
    //   service boundary so any future caller (script, internal tool)
    //   that bypasses the endpoint mints fails loud.
    const idemKey = draftJson?.idempotency_key;
    if (typeof idemKey !== 'string' || !UUID_V4_RE.test(idemKey)) {
      throw new Error('upsertDraftJson: draftJson.idempotency_key must be a UUIDv4 string');
    }

    // Race-free idempotency_key preservation (Codex S183-round-8 MOD,
    // hardened S183-round-9):
    //
    //   Two-tab race on first autosave would have both tabs see
    //   getByKey → null in the endpoint, both mint different UUIDs,
    //   and last-write would win, breaking the "stable forever"
    //   contract /submit's collision-returning UPSERT relies on.
    //
    //   Round-8 fix used COALESCE on the existing row's idempotency_key.
    //   Round-9 caught a JSON-null edge case: `intake_drafts.draft_json
    //   -> 'idempotency_key'` returns JSONB `null` (NOT SQL NULL) when
    //   the key is present with a JSON null value — and COALESCE treats
    //   JSONB null as "present", silently preserving it. NULLIF against
    //   `'null'::jsonb` collapses both shapes (SQL NULL = key absent;
    //   JSONB null = key present-but-null) into SQL NULL, so COALESCE
    //   correctly falls through to the EXCLUDED value.
    //
    //   Both sides get the same NULLIF treatment for symmetry; the
    //   service-level pre-condition above guarantees EXCLUDED has a
    //   real string, so the COALESCE never returns NULL into jsonb_set.
    const result = await sql`
      INSERT INTO intake_drafts (
        contact_oid, account_id, request_id, form_key,
        draft_json, attachments
      ) VALUES (
        ${contactOid}, ${accountId}, NULL, ${formKey},
        ${draftJsonStr}::jsonb, '[]'::jsonb
      )
      ON CONFLICT (contact_oid, account_id, form_key)
      WHERE request_id IS NULL
      DO UPDATE SET
        draft_json = jsonb_set(
          EXCLUDED.draft_json,
          '{idempotency_key}',
          COALESCE(
            NULLIF(intake_drafts.draft_json->'idempotency_key', 'null'::jsonb),
            NULLIF(EXCLUDED.draft_json->'idempotency_key', 'null'::jsonb)
          )
        ),
        updated_at = now()
      RETURNING *
    `;
    return result.rows[0];
  }

  static async getById(id) {
    const result = await sql`
      SELECT * FROM intake_drafts WHERE id = ${id} LIMIT 1
    `;
    return result.rows[0] ?? null;
  }

  /**
   * All drafts associated with a contact (across institutions). Used by
   * the applicant dashboard.
   */
  static async listByContact(contactOid) {
    const result = await sql`
      SELECT * FROM intake_drafts
      WHERE contact_oid = ${contactOid}
      ORDER BY updated_at DESC
    `;
    return result.rows;
  }

  /**
   * All drafts for an institution (across contacts). Used by staff admin.
   */
  static async listByAccount(accountId) {
    const result = await sql`
      SELECT * FROM intake_drafts
      WHERE account_id = ${accountId}
      ORDER BY updated_at DESC
    `;
    return result.rows;
  }

  static async delete(id) {
    const result = await sql`
      DELETE FROM intake_drafts WHERE id = ${id}
    `;
    return result.rowCount || 0;
  }

  /**
   * Append a single attachment record to attachments[]. Atomic at the
   * row level (jsonb || operator) — avoids the read-modify-write race
   * that would happen if two concurrent uploads tried to write the array.
   */
  static async appendAttachment(id, attachment) {
    const result = await sql`
      UPDATE intake_drafts
         SET attachments = attachments || ${JSON.stringify([attachment])}::jsonb,
             updated_at = now()
       WHERE id = ${id}
      RETURNING *
    `;
    return result.rows[0] ?? null;
  }

  /**
   * Remove an attachment record from attachments[] by its blob_url.
   * Filters in SQL via jsonb_array_elements so it stays atomic.
   */
  static async removeAttachment(id, blobUrl) {
    const result = await sql`
      UPDATE intake_drafts
         SET attachments = COALESCE((
               SELECT jsonb_agg(elem)
                 FROM jsonb_array_elements(attachments) elem
                WHERE elem->>'blob_url' <> ${blobUrl}
             ), '[]'::jsonb),
             updated_at = now()
       WHERE id = ${id}
      RETURNING *
    `;
    return result.rows[0] ?? null;
  }

  /**
   * Daily GC: delete drafts past the cutoff. Called by the maintenance
   * cron. Returns `{ count, attachments }`, where `attachments` is a
   * flat list of every attachment record from the deleted rows. The
   * caller uses this to delete the corresponding Vercel Blob objects —
   * if we returned only a count, the Blob URLs would be unrecoverable
   * after the row is gone.
   */
  static async deleteExpired({ olderThanDays = 90 } = {}) {
    const result = await sql`
      DELETE FROM intake_drafts
       WHERE updated_at < NOW() - MAKE_INTERVAL(days => ${olderThanDays})
      RETURNING id, attachments
    `;
    const attachments = [];
    for (const row of result.rows) {
      if (Array.isArray(row.attachments)) {
        for (const a of row.attachments) attachments.push({ draftId: row.id, ...a });
      }
    }
    return { count: result.rows.length, attachments };
  }

  // ──────────────────────────────────────────────────────────────────
  // Pending-attachments helpers (S184 chunk 3) — operate on the
  // `pending_attachments` JSONB column added by migration 013. Spec:
  // docs/INTAKE_ATTACH_BUILD_SCOPING.md § Q1/A2/A5/A6 and
  // docs/INTAKE_ATTACH_CHUNK3_DESIGN.md. Server-managed; the autosave
  // path (`upsertDraftJson`) never touches this column.
  // ──────────────────────────────────────────────────────────────────

  /**
   * Read one draft by its primary key. Used by /upload-token + /attach,
   * which receive draftId from the client and need to load the row
   * before any ownership / membership / fieldKey resolution.
   *
   * @param {number} id
   * @returns {Promise<object | null>}  the row, or null if not found.
   */
  static async getById(id) {
    const result = await sql`
      SELECT * FROM intake_drafts WHERE id = ${id}
    `;
    return result.rows[0] ?? null;
  }

  /**
   * Append a pending-attachment entry. Idempotent on duplicate
   * attachmentId — a duplicate is treated as a no-op rather than an
   * error so a retry of /upload-token for the same logical upload
   * doesn't fail. The collision is ∼improbable in practice
   * (`attachmentId` is server-minted UUIDv4) but the helper is
   * defense-in-depth.
   *
   * @param {number} draftId
   * @param {{attachmentId, fieldKey, filename, pathname, contentType, maxBytes, createdAt, validUntil}} entry
   * @returns {Promise<{pending: Array} | null>}  null if draft not found.
   */
  static async appendPending(draftId, entry) {
    if (!entry || typeof entry.attachmentId !== 'string') {
      throw new Error('appendPending: entry.attachmentId required');
    }
    const result = await sql`
      UPDATE intake_drafts
         SET pending_attachments = CASE
               WHEN EXISTS (
                 SELECT 1 FROM jsonb_array_elements(pending_attachments) e
                 WHERE e->>'attachmentId' = ${entry.attachmentId}
               ) THEN pending_attachments
               ELSE pending_attachments || ${JSON.stringify([entry])}::jsonb
             END,
             updated_at = now()
       WHERE id = ${draftId}
      RETURNING pending_attachments
    `;
    const row = result.rows[0];
    if (!row) return null;
    return { pending: Array.isArray(row.pending_attachments) ? row.pending_attachments : [] };
  }

  /**
   * Read pending entries for one draft.
   *
   * @param {number} draftId
   * @returns {Promise<Array | null>}  null if draft not found.
   */
  static async selectPendingForDraft(draftId) {
    const result = await sql`
      SELECT pending_attachments
        FROM intake_drafts
       WHERE id = ${draftId}
    `;
    const row = result.rows[0];
    if (!row) return null;
    return Array.isArray(row.pending_attachments) ? row.pending_attachments : [];
  }

  /**
   * Atomic move: remove from `pending_attachments` and append to
   * `attachments`. The UPDATE's WHERE clause gates on (a) entry
   * present in `pending_attachments`, (b) entry NOT already in
   * `attachments`, AND (c) per-field cardinality cap not yet reached.
   * Postgres EvalPlanQual re-evaluates the WHERE after row-lock wait
   * at READ COMMITTED, so two racing concurrent attaches for the same
   * `(draftId, fieldKey)` serialize — the second sees the first's
   * committed update + the higher field count, and is blocked.
   *
   * Codex chunk-5 post-impl: the cardinality gate is now SQL-level
   * instead of in-endpoint TOCTOU. Required `fieldCardinality` opts:
   *   { fieldKey: string, cap: number }
   * Single-valued fields pass `cap: 1`. Multi-valued fields pass
   * `cap: field.maxFiles`. The UPDATE permits the promote only when
   * `count(attachments where fieldKey = X) < cap`.
   *
   * @param {number} draftId
   * @param {string} attachmentId
   * @param {object} cleanRow  shape per chunk-3 design § 2
   * @param {object} fieldCardinality  { fieldKey, cap }
   * @returns {Promise<{promoted: true} | {promoted: false, reason: 'race_already_promoted' | 'cap_exceeded_race' | 'pending_not_found' | 'draft_not_found'}>}
   */
  static async promoteToClean(draftId, attachmentId, cleanRow, fieldCardinality) {
    if (typeof attachmentId !== 'string' || !attachmentId) {
      throw new Error('promoteToClean: attachmentId required');
    }
    if (
      !fieldCardinality
      || typeof fieldCardinality.fieldKey !== 'string'
      || !fieldCardinality.fieldKey
      || typeof fieldCardinality.cap !== 'number'
      || !Number.isFinite(fieldCardinality.cap)
      || fieldCardinality.cap < 1
    ) {
      throw new Error('promoteToClean: fieldCardinality {fieldKey, cap≥1} required');
    }
    const { fieldKey, cap } = fieldCardinality;
    const result = await sql`
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
         AND (
           SELECT COUNT(*) FROM jsonb_array_elements(attachments) a
           WHERE a->>'fieldKey' = ${fieldKey}
         ) < ${cap}
      RETURNING id
    `;
    if (result.rows.length === 1) {
      return { promoted: true };
    }
    // 0 rows: disambiguate the four reasons via a follow-up read.
    // The probe also counts current attachments for the fieldKey so we
    // can distinguish `cap_exceeded_race` (still in pending, but cap
    // hit) from `pending_not_found` (entry removed by sweep).
    const probe = await sql`
      SELECT
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(attachments) a
          WHERE a->>'attachmentId' = ${attachmentId}
        ) AS in_attachments,
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(pending_attachments) e
          WHERE e->>'attachmentId' = ${attachmentId}
        ) AS in_pending,
        (
          SELECT COUNT(*) FROM jsonb_array_elements(attachments) a
          WHERE a->>'fieldKey' = ${fieldKey}
        ) AS field_count
      FROM intake_drafts
      WHERE id = ${draftId}
    `;
    const probeRow = probe.rows[0];
    if (!probeRow) return { promoted: false, reason: 'draft_not_found' };
    if (probeRow.in_attachments) return { promoted: false, reason: 'race_already_promoted' };
    if (probeRow.in_pending) {
      // Entry still pending — UPDATE was blocked by the cardinality
      // gate (some other call promoted into this fieldKey since our
      // initial read).
      return { promoted: false, reason: 'cap_exceeded_race', fieldCount: Number(probeRow.field_count), cap };
    }
    return { promoted: false, reason: 'pending_not_found' };
  }

  /**
   * Remove a pending entry; no-op when not present (or draft gone).
   *
   * @param {number} draftId
   * @param {string} attachmentId
   * @returns {Promise<{removed: boolean}>}
   */
  static async removePending(draftId, attachmentId) {
    if (typeof attachmentId !== 'string' || !attachmentId) {
      throw new Error('removePending: attachmentId required');
    }
    const result = await sql`
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
      RETURNING id
    `;
    return { removed: result.rows.length === 1 };
  }

  /**
   * Stale pending entries across all drafts, flattened to one row per
   * entry. Caller (sweep cron) provides the cutoff timestamp — the
   * helper never reads the clock, so tests can pass any cutoff.
   *
   * @param {string} cutoffIso  ISO 8601; entries with createdAt < this are returned
   * @returns {Promise<Array<{draftId: number, entry: object}>>}
   */
  static async listPendingOlderThan(cutoffIso) {
    if (typeof cutoffIso !== 'string' || !cutoffIso) {
      throw new Error('listPendingOlderThan: cutoffIso required');
    }
    const result = await sql`
      SELECT d.id AS draft_id, e AS entry
        FROM intake_drafts d, jsonb_array_elements(d.pending_attachments) e
       WHERE (e->>'createdAt')::timestamptz < ${cutoffIso}::timestamptz
       ORDER BY d.id, (e->>'createdAt')::timestamptz
    `;
    return result.rows.map(r => ({ draftId: r.draft_id, entry: r.entry }));
  }
}

module.exports = IntakeDraftService;
