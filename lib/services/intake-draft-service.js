/**
 * IntakeDraftService - CRUD over the intake_drafts table.
 *
 * Drafts are Postgres-only — they never reach Dynamics. On submission,
 * the API layer reads the draft, validates, writes final fields to
 * akoya_request via DynamicsService, moves attachments from Vercel Blob
 * staging to SharePoint via GraphService, then deletes the draft row.
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
 * See docs/INTAKE_PORTAL_DESIGN.md (Draft staging — Postgres, not Dynamics).
 */

const { sql } = require('@vercel/postgres');

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
}

module.exports = IntakeDraftService;
