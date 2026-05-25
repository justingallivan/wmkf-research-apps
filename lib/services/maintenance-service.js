/**
 * MaintenanceService - Database and blob cleanup operations
 *
 * Provides batch-delete for unbounded tables (api_usage_log, dynamics_query_log),
 * expired cache cleanup, orphaned blob cleanup, and audit trail for all runs.
 *
 * Retention periods are configurable via Dataverse `wmkf_appsystemsettings`
 * (read through the settings-service dispatcher).
 */

const { sql } = require('@vercel/postgres');
const { list, del } = require('@vercel/blob');
const { DatabaseService } = require('./database-service');
const { listSettings } = require('./settings-service');
const { DynamicsService } = require('./dynamics-service');
const { bypassDynamicsRestrictions } = require('./dynamics-context');
const IntakeDraftService = require('./intake-draft-service');
const IntakeAuditService = require('./intake-audit-service');
const { getIntakeBlobToken } = require('../utils/intake-blob');

// Heuristic: Vercel Blob `del()` raises throws of an underspecified
// shape on non-2xx. Treat status===404 or message containing 'not found'
// or '404' as a missing-blob success (the bytes may have never been
// PUT in the first place). False negatives only cost a counted error
// + log line; no data corruption risk.
function isBlobNotFound(err) {
  if (!err) return false;
  if (err.status === 404) return true;
  const msg = (err.message || '').toLowerCase();
  return msg.includes('not found') || msg.includes('404');
}

class MaintenanceService {
  // ============================================
  // CLEANUP OPERATIONS
  // ============================================

  /**
   * Delete api_usage_log records older than retentionDays.
   * Uses batch delete to avoid long-running transactions.
   */
  static async cleanupUsageLog(retentionDays = 90) {
    try {
      const result = await sql`
        DELETE FROM api_usage_log
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupUsageLog error:', error.message);
      throw error;
    }
  }

  /**
   * Delete dynamics_query_log records older than retentionDays
   */
  static async cleanupQueryLog(retentionDays = 365) {
    try {
      const result = await sql`
        DELETE FROM dynamics_query_log
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupQueryLog error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up expired search cache entries
   */
  static async cleanupExpiredCache() {
    try {
      return await DatabaseService.cleanupExpiredCache();
    } catch (error) {
      console.error('MaintenanceService.cleanupExpiredCache error:', error.message);
      throw error;
    }
  }

  /**
   * Clean up old health check history records
   */
  static async cleanupHealthHistory(retentionDays = 30) {
    try {
      const result = await sql`
        DELETE FROM health_check_history
        WHERE created_at < NOW() - MAKE_INTERVAL(days => ${retentionDays})
      `;
      return result.rowCount || 0;
    } catch (error) {
      console.error('MaintenanceService.cleanupHealthHistory error:', error.message);
      throw error;
    }
  }

  /**
   * Delete orphaned Vercel Blob files not referenced by any active record.
   *
   * Collects all blob URLs referenced in Dataverse (post-W5 cutover):
   *   - `wmkf_appgrantcycle.wmkf_reviewtemplateurl` (cycle-level template)
   *   - `wmkf_appreviewersuggestion.wmkf_summarybloburl` (per-candidate summary)
   *   - `wmkf_appreviewersuggestion.wmkf_reviewbloburl` (legacy; retained
   *      for historical rows — Vercel Blob retired for review uploads
   *      2026-05-03 in favor of SharePoint, but historical URLs still
   *      live in this column and must not be reaped)
   *
   * Postgres `proposal_searches.full_proposal_blob_url` is intentionally
   * omitted — the table is empty (0 rows, dead writer) and is being
   * dropped during Wave 2 cleanup.
   *
   * @param {number} retentionDays - Only consider blobs older than this for deletion
   * @param {boolean} dryRun - If true, list what would be deleted without deleting
   * @returns {{ deleted: number, skipped: number, errors: number, details: string[] }}
   */
  static async cleanupBlobs(retentionDays = 90, dryRun = false) {
    const stats = { deleted: 0, skipped: 0, errors: 0, details: [] };

    try {
      // 1. Collect all blob URLs still referenced in Dataverse.
      // Read-only system maintenance — wrap in bypass so the restriction
      // context (which can be absent for cron-initiated calls) is satisfied.
      // Fail-closed on `capped` (queryAllRecords' 5000-row safety limit):
      // an undercount of active URLs becomes false-positive deletions,
      // which here is permanent data loss of summary PDFs / review files.
      const dvUrls = await bypassDynamicsRestrictions('maintenance-blob-scan', async () => {
        const [cycles, suggestions] = await Promise.all([
          DynamicsService.queryAllRecords('wmkf_appgrantcycles', {
            select: 'wmkf_reviewtemplateurl',
            filter: 'wmkf_reviewtemplateurl ne null',
          }),
          DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', {
            select: 'wmkf_summarybloburl,wmkf_reviewbloburl',
            filter: 'wmkf_summarybloburl ne null or wmkf_reviewbloburl ne null',
          }),
        ]);

        if (cycles.capped || suggestions.capped) {
          throw new Error(
            `blob-scan refused: Dataverse query hit the 5000-row export cap ` +
            `(cycles.capped=${!!cycles.capped}, suggestions.capped=${!!suggestions.capped}). ` +
            `Continuing would silently undercount active URLs and risk reaping ` +
            `live files. Raise the cap or scope the scan before retrying.`
          );
        }

        const urls = new Set();
        for (const row of cycles.records) {
          if (row.wmkf_reviewtemplateurl) urls.add(row.wmkf_reviewtemplateurl);
        }
        for (const row of suggestions.records) {
          if (row.wmkf_summarybloburl) urls.add(row.wmkf_summarybloburl);
          if (row.wmkf_reviewbloburl) urls.add(row.wmkf_reviewbloburl);
        }
        return urls;
      });

      // Intake-portal drafts (still Postgres — `intake_drafts.attachments` is
      // JSONB of `{filename, blob_url, ...}`). The original Postgres scanner
      // never read this table; the new scanner closes that pre-existing gap
      // so cron can't reap an applicant's in-flight upload.
      const intakeRows = await sql`
        SELECT jsonb_array_elements(attachments)->>'blob_url' AS blob_url
        FROM intake_drafts
        WHERE attachments IS NOT NULL AND jsonb_array_length(attachments) > 0
      `;

      const activeUrls = new Set(dvUrls);
      for (const row of intakeRows.rows) {
        if (row.blob_url) activeUrls.add(row.blob_url);
      }

      stats.details.push(
        `Found ${activeUrls.size} active blob URLs ` +
        `(Dataverse: ${dvUrls.size}, intake_drafts: ${intakeRows.rows.length})`
      );

      // 2. List all blobs in storage
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
      let cursor;
      let totalBlobs = 0;

      do {
        const listing = await list({ cursor, limit: 100 });
        cursor = listing.cursor;
        totalBlobs += listing.blobs.length;

        for (const blob of listing.blobs) {
          // Skip blobs newer than retention cutoff
          if (new Date(blob.uploadedAt) > cutoff) {
            stats.skipped++;
            continue;
          }

          // Skip blobs that are still referenced
          if (activeUrls.has(blob.url)) {
            stats.skipped++;
            continue;
          }

          // Delete orphaned blob
          if (dryRun) {
            stats.details.push(`Would delete: ${blob.pathname} (${blob.size} bytes, uploaded ${blob.uploadedAt})`);
            stats.deleted++;
          } else {
            try {
              await del(blob.url);
              stats.deleted++;
            } catch (delError) {
              stats.errors++;
              stats.details.push(`Delete failed: ${blob.pathname}: ${delError.message}`);
            }
          }
        }
      } while (cursor);

      stats.details.unshift(`Scanned ${totalBlobs} total blobs in storage`);
      if (dryRun) {
        stats.details.unshift('DRY RUN — no blobs were actually deleted');
      }

      return stats;
    } catch (error) {
      console.error('MaintenanceService.cleanupBlobs error:', error.message);
      stats.errors++;
      stats.details.push(`Fatal error: ${error.message}`);
      return stats;
    }
  }

  /**
   * Sweep stale entries from intake_drafts.pending_attachments (S184
   * chunk 6). Designed to be called from the daily maintenance cron.
   * Default cutoff is 2h — 1h Blob token expiry + 1h safety margin so
   * a slow legitimate /attach retry isn't prematurely 404'd by the sweep
   * (per S184 A6).
   *
   * Order of operations is removePending FIRST, then del() (Codex
   * chunk-6 pre-impl Q3+Q7 catch): pending and clean attachments
   * share the same opaque pathname (A5), so a concurrent /attach that
   * promotes between our list-stale read and our action could be
   * silently corrupted if we del-first. Atomic JSONB removePending
   * gives us a concurrency gate — {removed:true} means we won the
   * race and the bytes are safe to delete.
   *
   * @param {object} opts
   * @param {number} opts.cutoffHours  default 2; entries with createdAt < now - cutoffHours are swept
   * @returns {Promise<{deleted, scanned, errors, blobDelErrors, removePendingErrors}>}
   *   `errors` is the total of the two granular counts (cron summary
   *   formatter expects {deleted, errors}; granular counts are kept
   *   for forensics).
   */
  static async sweepIntakePending({ cutoffHours = 2 } = {}) {
    const cutoffIso = new Date(Date.now() - cutoffHours * 3600_000).toISOString();
    const stale = await IntakeDraftService.listPendingOlderThan(cutoffIso);

    let deleted = 0;
    let blobDelErrors = 0;
    let removePendingErrors = 0;
    let blobToken = null;
    try {
      blobToken = getIntakeBlobToken();
    } catch (err) {
      // No token = skip Blob deletions but still process JSONB so the
      // column doesn't grow unbounded. An orphan Blob is recoverable;
      // an unbounded JSONB is not.
      console.warn('[sweepIntakePending] INTAKE_BLOB_RW_TOKEN unset; skipping Blob deletions:', err?.message ?? err);
    }

    for (const { draftId, entry } of stale) {
      // 1. Atomic JSONB remove — concurrency gate.
      let removed = false;
      try {
        const r = await IntakeDraftService.removePending(draftId, entry.attachmentId);
        removed = r?.removed === true;
      } catch (err) {
        removePendingErrors += 1;
        console.warn('[sweepIntakePending] removePending failed for', draftId, entry.attachmentId, err?.message ?? err);
        continue;
      }

      if (!removed) {
        // Concurrent /attach won the race. Bytes are now (or were
        // briefly) part of attachments[]; do NOT touch them.
        continue;
      }
      deleted += 1;

      // 2. Now-safe: pending entry was definitely there at removal
      //    time. Best-effort Blob delete.
      if (blobToken && entry.pathname) {
        try {
          await del(entry.pathname, { token: blobToken });
        } catch (err) {
          if (!isBlobNotFound(err)) {
            blobDelErrors += 1;
            console.warn('[sweepIntakePending] del failed for', entry.pathname, err?.message ?? err);
          }
        }
      }

      // 3. Audit (one row per actually-removed entry — S184 scoping Q5).
      IntakeAuditService.log({
        actorOid: null,
        actorType: 'system',
        action: 'draft.attach_orphan_swept',
        targetEntity: 'intake_drafts',
        targetId: draftId,
        payload: { filename: entry.filename },
        metadata: {
          draftId,
          attachmentId: entry.attachmentId,
          fieldKey: entry.fieldKey,
          pathname: entry.pathname,
          createdAt: entry.createdAt,
          validUntil: entry.validUntil,
          cutoffIso,
        },
      }).catch(() => {});
    }

    const errors = blobDelErrors + removePendingErrors;
    return { deleted, scanned: stale.length, errors, blobDelErrors, removePendingErrors };
  }

  // ============================================
  // AUDIT TRAIL
  // ============================================

  /**
   * Record the start of a maintenance job
   * @returns {number} The run ID
   */
  static async startRun(jobName) {
    try {
      const result = await sql`
        INSERT INTO maintenance_runs (job_name, status)
        VALUES (${jobName}, 'running')
        RETURNING id
      `;
      return result.rows[0].id;
    } catch (error) {
      console.error('MaintenanceService.startRun error:', error.message);
      return null;
    }
  }

  /**
   * Complete a maintenance run with results
   */
  static async completeRun(runId, { status = 'completed', recordsProcessed = 0, recordsDeleted = 0, details, errorMessage } = {}) {
    if (!runId) return;
    try {
      await sql`
        UPDATE maintenance_runs
        SET status = ${status},
            records_processed = ${recordsProcessed},
            records_deleted = ${recordsDeleted},
            details = ${details ? JSON.stringify(details) : null},
            error_message = ${errorMessage || null},
            completed_at = CURRENT_TIMESTAMP,
            duration_ms = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - started_at))::int * 1000
        WHERE id = ${runId}
      `;
    } catch (error) {
      console.error('MaintenanceService.completeRun error:', error.message);
    }
  }

  /**
   * Get the last run for each job
   */
  static async getLastRuns() {
    try {
      const result = await sql`
        SELECT DISTINCT ON (job_name)
          id, job_name, status, records_processed, records_deleted,
          details, error_message, started_at, completed_at, duration_ms
        FROM maintenance_runs
        ORDER BY job_name, started_at DESC
      `;
      return result.rows;
    } catch (error) {
      console.error('MaintenanceService.getLastRuns error:', error.message);
      return [];
    }
  }

  // ============================================
  // CONFIGURATION
  // ============================================

  /**
   * Read configurable retention periods from Dataverse `wmkf_appsystemsettings`
   * via the settings-service dispatcher. Falls back to defaults if not configured.
   */
  static async getRetentionConfig() {
    const defaults = {
      usage_log_days: 90,
      query_log_days: 365,
      blob_days: 90,
      health_history_days: 30,
      alert_days: 90,
    };

    try {
      const rows = await listSettings('retention:');
      for (const [settingKey, settingValue] of Object.entries(rows)) {
        const key = settingKey.replace('retention:', '');
        const value = parseInt(settingValue, 10);
        if (!isNaN(value) && defaults.hasOwnProperty(key)) {
          defaults[key] = value;
        }
      }
    } catch (error) {
      console.error('MaintenanceService.getRetentionConfig error:', error.message);
    }

    return defaults;
  }
}

module.exports = MaintenanceService;
