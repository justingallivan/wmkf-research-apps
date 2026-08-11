/**
 * AlertService - CRUD operations for system_alerts table
 *
 * Provides centralized alert management for health monitoring, maintenance,
 * secret expiration, and log analysis notifications. Uses deduplication via
 * auto_resolve_key to prevent duplicate active alerts.
 *
 * Static-method class matching DatabaseService pattern.
 */

const { sql } = require('@vercel/postgres');

class AlertService {
  /**
   * Create a new alert, with optional deduplication
   * If autoResolveKey is provided and an active alert with that key exists, skip creation.
   *
   * @returns {Object|null} The created alert, or null if deduplicated
   */
  static async createAlert({ type, severity = 'info', title, message, metadata, source, autoResolveKey }) {
    try {
      // Dedup: skip if active alert with same auto_resolve_key exists
      if (autoResolveKey) {
        const existing = await sql`
          SELECT id FROM system_alerts
          WHERE auto_resolve_key = ${autoResolveKey}
            AND status = 'active'
          LIMIT 1
        `;
        if (existing.rows.length > 0) {
          return null;
        }
      }

      const result = await sql`
        INSERT INTO system_alerts (
          alert_type, severity, title, message, metadata, source, auto_resolve_key
        ) VALUES (
          ${type}, ${severity}, ${title}, ${message || null},
          ${metadata ? JSON.stringify(metadata) : null},
          ${source || null}, ${autoResolveKey || null}
        )
        RETURNING *
      `;
      return result.rows[0];
    } catch (error) {
      console.error('AlertService.createAlert error:', error.message);
      throw error;
    }
  }

  /**
   * Get active alerts with optional filters
   */
  static async getActiveAlerts({ type, severity, limit = 50 } = {}) {
    try {
      if (type && severity) {
        const result = await sql`
          SELECT * FROM system_alerts
          WHERE status = 'active'
            AND alert_type = ${type}
            AND severity = ${severity}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
        return result.rows;
      }
      if (type) {
        const result = await sql`
          SELECT * FROM system_alerts
          WHERE status = 'active'
            AND alert_type = ${type}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
        return result.rows;
      }
      if (severity) {
        const result = await sql`
          SELECT * FROM system_alerts
          WHERE status = 'active'
            AND severity = ${severity}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
        return result.rows;
      }
      const result = await sql`
        SELECT * FROM system_alerts
        WHERE status = 'active'
        ORDER BY
          CASE severity
            WHEN 'critical' THEN 0
            WHEN 'error' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'info' THEN 3
          END,
          created_at DESC
        LIMIT ${limit}
      `;
      return result.rows;
    } catch (error) {
      console.error('AlertService.getActiveAlerts error:', error.message);
      return [];
    }
  }

  /**
   * Get all alerts (active + acknowledged) for admin dashboard
   */
  static async getAlerts({ status, limit = 100 } = {}) {
    try {
      if (status) {
        const result = await sql`
          SELECT sa.*,
            ap.name AS acknowledged_by_name,
            rp.name AS resolved_by_name
          FROM system_alerts sa
          LEFT JOIN user_profiles ap ON sa.acknowledged_by = ap.id
          LEFT JOIN user_profiles rp ON sa.resolved_by = rp.id
          WHERE sa.status = ${status}
          ORDER BY sa.created_at DESC
          LIMIT ${limit}
        `;
        return result.rows;
      }
      const result = await sql`
        SELECT sa.*,
          ap.name AS acknowledged_by_name,
          rp.name AS resolved_by_name
        FROM system_alerts sa
        LEFT JOIN user_profiles ap ON sa.acknowledged_by = ap.id
        LEFT JOIN user_profiles rp ON sa.resolved_by = rp.id
        WHERE sa.status IN ('active', 'acknowledged')
        ORDER BY
          CASE sa.severity
            WHEN 'critical' THEN 0
            WHEN 'error' THEN 1
            WHEN 'warning' THEN 2
            WHEN 'info' THEN 3
          END,
          sa.created_at DESC
        LIMIT ${limit}
      `;
      return result.rows;
    } catch (error) {
      console.error('AlertService.getAlerts error:', error.message);
      return [];
    }
  }

  /**
   * Return the open dedup/retraction keys for one alert type.
   *
   * This deliberately throws on a Postgres failure. Callers deciding whether a
   * missing key permits them to skip authoritative lifecycle reads must be able
   * to distinguish "no open keys" from "the key query failed".
   */
  static async getOpenAutoResolveKeysByType(type) {
    if (!type) return [];
    const result = await sql`
      SELECT auto_resolve_key
      FROM system_alerts
      WHERE alert_type = ${type}
        AND status IN ('active', 'acknowledged')
        AND auto_resolve_key IS NOT NULL
    `;
    return result.rows
      .map((row) => row.auto_resolve_key)
      .filter((key) => typeof key === 'string' && key.length > 0);
  }

  /**
   * Acknowledge an alert (mark as seen but not resolved)
   */
  static async acknowledgeAlert(id, profileId) {
    try {
      const result = await sql`
        UPDATE system_alerts
        SET status = 'acknowledged',
            acknowledged_by = ${profileId},
            acknowledged_at = CURRENT_TIMESTAMP
        WHERE id = ${id} AND status = 'active'
        RETURNING *
      `;
      return result.rows[0] || null;
    } catch (error) {
      console.error('AlertService.acknowledgeAlert error:', error.message);
      throw error;
    }
  }

  /**
   * Resolve an alert (mark as handled)
   */
  static async resolveAlert(id, profileId) {
    try {
      const result = await sql`
        UPDATE system_alerts
        SET status = 'resolved',
            resolved_by = ${profileId},
            resolved_at = CURRENT_TIMESTAMP
        WHERE id = ${id} AND status IN ('active', 'acknowledged')
        RETURNING *
      `;
      return result.rows[0] || null;
    } catch (error) {
      console.error('AlertService.resolveAlert error:', error.message);
      throw error;
    }
  }

  /**
   * Auto-resolve all active alerts matching a key (e.g., health recovery)
   */
  static async autoResolve(autoResolveKey) {
    try {
      const result = await sql`
        UPDATE system_alerts
        SET status = 'auto_resolved',
            resolved_at = CURRENT_TIMESTAMP
        WHERE auto_resolve_key = ${autoResolveKey}
          AND status IN ('active', 'acknowledged')
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('AlertService.autoResolve error:', error.message);
      return 0;
    }
  }

  /**
   * Merge a patch into an alert's `metadata` JSONB column (shallow key merge
   * via Postgres `||`). Built for two-phase audit breadcrumbs (write BEFORE
   * a destructive action, update with the outcome AFTER) — e.g. reviewer
   * "Remove entirely" (docs/REVIEWER_REMOVE_ENTIRELY_BUILD_PLAN.md). Does not
   * touch `status`/`severity`; callers that also want to resolve/acknowledge
   * use those dedicated methods.
   *
   * @param {number} id
   * @param {Object} metadataPatch
   * @returns {Object|null} the updated alert, or null if no row matched
   */
  static async updateAlertMetadata(id, metadataPatch) {
    try {
      const result = await sql`
        UPDATE system_alerts
        SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(metadataPatch || {})}::jsonb
        WHERE id = ${id}
        RETURNING *
      `;
      return result.rows[0] || null;
    } catch (error) {
      console.error('AlertService.updateAlertMetadata error:', error.message);
      throw error;
    }
  }

  /**
   * Get alert summary counts by severity for dashboard badges
   */
  static async getAlertSummary() {
    try {
      const result = await sql`
        SELECT severity, COUNT(*)::int AS count
        FROM system_alerts
        WHERE status = 'active'
        GROUP BY severity
      `;
      const summary = { critical: 0, error: 0, warning: 0, info: 0, total: 0 };
      for (const row of result.rows) {
        summary[row.severity] = row.count;
        summary.total += row.count;
      }
      return summary;
    } catch (error) {
      console.error('AlertService.getAlertSummary error:', error.message);
      return { critical: 0, error: 0, warning: 0, info: 0, total: 0 };
    }
  }

  /**
   * Delete resolved/auto_resolved alerts older than retentionDays
   */
  static async cleanupOldAlerts(retentionDays = 90) {
    try {
      const result = await sql`
        DELETE FROM system_alerts
        WHERE status IN ('resolved', 'auto_resolved')
          AND created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('AlertService.cleanupOldAlerts error:', error.message);
      return 0;
    }
  }
}

module.exports = AlertService;
