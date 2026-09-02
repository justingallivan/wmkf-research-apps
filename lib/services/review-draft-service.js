/**
 * ReviewDraftService — CRUD over the review_drafts table (migration 021).
 *
 * The Postgres scratchpad behind the external reviewer in-browser authoring
 * surface. As a reviewer answers the rich-text questions, the editor autosaves
 * here (high-frequency partial writes). Drafts NEVER reach Dataverse directly —
 * on final submit, the route maps the draft into the wmkf_appreviewanswer
 * snapshot child rows + the parent rating columns and writes those atomically,
 * then deletes the draft.
 *
 * Cousin of IntakeDraftService but deliberately smaller: one row per review
 * (suggestion_id UNIQUE), last-write-wins autosave, no attachments, no
 * idempotency-key dance, no async drain (submit writes Dataverse synchronously).
 *
 * FINALITY IS NOT ENFORCED HERE. "Refuse once the review is submitted" depends
 * on the parent wmkf_reviewreceivedat flag, which lives in Dataverse — the
 * draft GET/PUT/submit ROUTES perform that precheck before calling this service.
 * This layer is pure Postgres.
 *
 * Richtext answers in draft_json are ALWAYS server-sanitized
 * (lib/external/sanitize-review-html.js) by the PUT route before they reach
 * upsertDraftJson — the autosave path is a write boundary, not just render.
 *
 * See docs/REVIEWER_REVIEW_FORM_AUTHORING_BUILD_PLAN.md §3b and
 * docs/atlas/postgres-review-drafts.md.
 */

const { sql } = require('@vercel/postgres');

// RFC 4122 UUID (any version). suggestion_id is the wmkf_appreviewersuggestion
// GUID, sourced from the verified suggestion token in the route — validated
// here too so a malformed value fails loud at the service boundary rather than
// as an opaque Postgres uuid cast error.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertSuggestionId(suggestionId) {
  if (typeof suggestionId !== 'string' || !UUID_RE.test(suggestionId)) {
    throw new Error('ReviewDraftService: suggestionId must be a UUID');
  }
}

class ReviewDraftService {
  /**
   * Read the single draft for a review, or null.
   * @param {string} suggestionId - wmkf_appreviewersuggestion GUID
   * @returns {Promise<object|null>}
   */
  static async getBySuggestion(suggestionId) {
    assertSuggestionId(suggestionId);
    const result = await sql`
      SELECT * FROM review_drafts WHERE suggestion_id = ${suggestionId} LIMIT 1
    `;
    return result.rows[0] ?? null;
  }

  /**
   * Autosave: INSERT-or-UPDATE the draft for a review, touching only
   * draft_json (+ updated_at). Last-write-wins — a single reviewer with two
   * tabs is the only concurrency, and there is no async drain to corrupt.
   *
   * @param {{ suggestionId: string, draftJson?: object }} args
   * @returns {Promise<object>} the full row
   */
  static async upsertDraftJson({ suggestionId, draftJson = {} }) {
    assertSuggestionId(suggestionId);
    if (draftJson == null || typeof draftJson !== 'object' || Array.isArray(draftJson)) {
      throw new Error('ReviewDraftService: draftJson must be an object');
    }
    const draftJsonStr = JSON.stringify(draftJson);
    const result = await sql`
      INSERT INTO review_drafts (suggestion_id, draft_json)
      VALUES (${suggestionId}, ${draftJsonStr}::jsonb)
      ON CONFLICT (suggestion_id)
      DO UPDATE SET
        draft_json = EXCLUDED.draft_json,
        updated_at = now()
      RETURNING *
    `;
    return result.rows[0];
  }

  /**
   * Delete the draft for a review. Called AFTER the submit changeset commits to
   * Dataverse, and on explicit staff token revoke. Regeneration deliberately
   * preserves the draft. Idempotent — returns the
   * number of rows removed (0 if there was no draft).
   *
   * @param {string} suggestionId
   * @returns {Promise<number>}
   */
  static async deleteBySuggestion(suggestionId) {
    assertSuggestionId(suggestionId);
    const result = await sql`
      DELETE FROM review_drafts WHERE suggestion_id = ${suggestionId}
    `;
    return result.rowCount || 0;
  }

  /**
   * GC: delete drafts not touched since the cutoff. Called by the maintenance
   * cron (interval finalized in Phase 5). The helper never reads the clock —
   * the caller supplies the age so tests are deterministic.
   *
   * @param {{ olderThanDays?: number }} [opts]
   * @returns {Promise<number>} rows deleted
   */
  static async deleteExpired({ olderThanDays = 90 } = {}) {
    const result = await sql`
      DELETE FROM review_drafts
       WHERE updated_at < NOW() - MAKE_INTERVAL(days => ${olderThanDays})
    `;
    return result.rowCount || 0;
  }
}

module.exports = ReviewDraftService;
