/**
 * FeedbackService - CRUD for dynamics_feedback table
 *
 * Stores user feedback (thumbs up/down) and auto-detected failures
 * for the Dynamics Explorer chat. Each record captures the conversation
 * context (current turn + 3 previous turns) for diagnostic review.
 *
 * Static-method class matching AlertService pattern.
 */

const { sql } = require('@vercel/postgres');

class FeedbackService {
  /**
   * Create a feedback record
   */
  static async createFeedback({ userProfileId, sessionId, feedbackType, category, userNote, queryText, conversationContext, autoDetected = false }) {
    try {
      const result = await sql`
        INSERT INTO dynamics_feedback (
          user_profile_id, session_id, feedback_type, category,
          user_note, query_text, conversation_context, auto_detected
        ) VALUES (
          ${userProfileId}, ${sessionId || null}, ${feedbackType}, ${category || null},
          ${userNote || null}, ${queryText || null},
          ${conversationContext ? JSON.stringify(conversationContext) : null},
          ${autoDetected}
        )
        RETURNING *
      `;
      return result.rows[0];
    } catch (error) {
      console.error('FeedbackService.createFeedback error:', error.message);
      throw error;
    }
  }

  /**
   * Get feedback records with optional filters (admin view)
   */
  static async getFeedback({ status, feedbackType, limit = 50, offset = 0 } = {}) {
    try {
      if (status && feedbackType) {
        const result = await sql`
          SELECT df.*, up.name AS user_name, rp.name AS reviewed_by_name
          FROM dynamics_feedback df
          LEFT JOIN user_profiles up ON df.user_profile_id = up.id
          LEFT JOIN user_profiles rp ON df.reviewed_by = rp.id
          WHERE df.status = ${status} AND df.feedback_type = ${feedbackType}
          ORDER BY df.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        return result.rows;
      }
      if (status) {
        const result = await sql`
          SELECT df.*, up.name AS user_name, rp.name AS reviewed_by_name
          FROM dynamics_feedback df
          LEFT JOIN user_profiles up ON df.user_profile_id = up.id
          LEFT JOIN user_profiles rp ON df.reviewed_by = rp.id
          WHERE df.status = ${status}
          ORDER BY df.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        return result.rows;
      }
      if (feedbackType) {
        const result = await sql`
          SELECT df.*, up.name AS user_name, rp.name AS reviewed_by_name
          FROM dynamics_feedback df
          LEFT JOIN user_profiles up ON df.user_profile_id = up.id
          LEFT JOIN user_profiles rp ON df.reviewed_by = rp.id
          WHERE df.feedback_type = ${feedbackType}
          ORDER BY df.created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
        return result.rows;
      }
      const result = await sql`
        SELECT df.*, up.name AS user_name, rp.name AS reviewed_by_name
        FROM dynamics_feedback df
        LEFT JOIN user_profiles up ON df.user_profile_id = up.id
        LEFT JOIN user_profiles rp ON df.reviewed_by = rp.id
        ORDER BY df.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
      return result.rows;
    } catch (error) {
      console.error('FeedbackService.getFeedback error:', error.message);
      return [];
    }
  }

  /**
   * Get summary counts for admin dashboard
   */
  static async getFeedbackSummary() {
    try {
      const result = await sql`
        SELECT
          feedback_type,
          status,
          COUNT(*)::int AS count
        FROM dynamics_feedback
        GROUP BY feedback_type, status
      `;
      const summary = { positive: 0, negative: 0, new: 0, reviewed: 0, resolved: 0, total: 0 };
      for (const row of result.rows) {
        summary[row.feedback_type] = (summary[row.feedback_type] || 0) + row.count;
        summary[row.status] = (summary[row.status] || 0) + row.count;
        summary.total += row.count;
      }
      return summary;
    } catch (error) {
      console.error('FeedbackService.getFeedbackSummary error:', error.message);
      return { positive: 0, negative: 0, new: 0, reviewed: 0, resolved: 0, total: 0 };
    }
  }

  /**
   * Update feedback status (admin review).
   *
   * The first successful admin action is the acknowledgement point used by
   * retention. Later transitions (for example reviewed -> resolved) must not
   * restart the clock or reassign the acknowledging admin.
   */
  static async updateFeedback(id, { status, adminNote, reviewedBy }) {
    try {
      const result = await sql`
        UPDATE dynamics_feedback
        SET status = ${status},
            admin_note = COALESCE(${adminNote || null}, admin_note),
            reviewed_by = CASE
              WHEN reviewed_at IS NULL THEN ${reviewedBy}
              ELSE reviewed_by
            END,
            reviewed_at = COALESCE(reviewed_at, CURRENT_TIMESTAMP)
        WHERE id = ${id}
        RETURNING *
      `;
      return result.rows[0] || null;
    } catch (error) {
      console.error('FeedbackService.updateFeedback error:', error.message);
      throw error;
    }
  }

  /**
   * Delete acknowledged feedback after retentionDays.
   *
   * `reviewed_at` is the durable acknowledgement timestamp. Unacknowledged
   * rows remain ineligible regardless of status or creation age.
   */
  static async cleanupOldFeedback(retentionDays = 20) {
    try {
      const result = await sql`
        DELETE FROM dynamics_feedback
        WHERE reviewed_at IS NOT NULL
          AND reviewed_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('FeedbackService.cleanupOldFeedback error:', error.message);
      throw error;
    }
  }
}

module.exports = FeedbackService;
