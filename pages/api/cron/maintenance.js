/**
 * Cron: /api/cron/maintenance
 *
 * Daily cleanup job (3:00 AM UTC) that runs all maintenance tasks:
 * - Delete old api_usage_log records
 * - Delete old dynamics_query_log records
 * - Clean up expired search cache
 * - Clean up old health check history
 * - Clean up resolved alerts
 * - Clean up orphaned Vercel Blob files
 *
 * Records results in maintenance_runs table and creates an info alert
 * with a summary. Each task runs sequentially to avoid overwhelming the DB.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses)
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import MaintenanceService from '../../../lib/services/maintenance-service';
import AlertService from '../../../lib/services/alert-service';
import FeedbackService from '../../../lib/services/feedback-service';
import NotificationService from '../../../lib/services/notification-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const runId = await MaintenanceService.startRun('daily-maintenance');
  const results = {};
  let totalDeleted = 0;

  try {
    // Get configurable retention periods
    const config = await MaintenanceService.getRetentionConfig();

    // 1. Usage log cleanup
    try {
      results.usageLog = await MaintenanceService.cleanupUsageLog(config.usage_log_days);
      totalDeleted += results.usageLog;
    } catch (error) {
      results.usageLog = { error: error.message };
    }

    // 2. Query log cleanup
    try {
      results.queryLog = await MaintenanceService.cleanupQueryLog(config.query_log_days);
      totalDeleted += results.queryLog;
    } catch (error) {
      results.queryLog = { error: error.message };
    }

    // 3. Expired cache cleanup
    try {
      results.cache = await MaintenanceService.cleanupExpiredCache();
      if (typeof results.cache === 'number') totalDeleted += results.cache;
    } catch (error) {
      results.cache = { error: error.message };
    }

    // 4. Health history cleanup
    try {
      results.healthHistory = await MaintenanceService.cleanupHealthHistory(config.health_history_days);
      totalDeleted += results.healthHistory;
    } catch (error) {
      results.healthHistory = { error: error.message };
    }

    // 5. Old alerts cleanup
    try {
      results.alerts = await AlertService.cleanupOldAlerts(config.alert_days);
      totalDeleted += results.alerts;
    } catch (error) {
      results.alerts = { error: error.message };
    }

    // 6. Blob cleanup (actual deletion, not dry run)
    try {
      results.blobs = await MaintenanceService.cleanupBlobs(config.blob_days, false);
      totalDeleted += results.blobs.deleted;
    } catch (error) {
      results.blobs = { error: error.message };
    }

    // 7. Dynamics feedback cleanup (resolved entries older than 180 days)
    try {
      results.feedback = await FeedbackService.cleanupOldFeedback(180);
      totalDeleted += results.feedback;
    } catch (error) {
      results.feedback = { error: error.message };
    }

    // 8. Intake-portal pending-attachment sweep (S184 chunk 6). Cleans
    //    up stale pending entries (and their Blobs) that the three-call
    //    /attach dance left behind. 2h cutoff per A6.
    try {
      results.intakePending = await MaintenanceService.sweepIntakePending();
      if (typeof results.intakePending?.deleted === 'number') {
        totalDeleted += results.intakePending.deleted;
      }
    } catch (error) {
      results.intakePending = { error: error.message };
    }

    // Record successful run
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: totalDeleted,
      recordsDeleted: totalDeleted,
      details: results,
    });

    // Create info alert with summary
    const summary = Object.entries(results)
      .map(([key, val]) => {
        if (typeof val === 'number') return `${key}: ${val} deleted`;
        if (val?.deleted !== undefined) return `${key}: ${val.deleted} deleted, ${val.errors || 0} errors`;
        if (val?.error) return `${key}: ERROR - ${val.error}`;
        return `${key}: done`;
      })
      .join('; ');

    await NotificationService.notify({
      type: 'maintenance',
      severity: 'info',
      title: `Daily maintenance completed: ${totalDeleted} records cleaned`,
      message: summary,
      metadata: results,
      source: 'cron/maintenance',
      category: 'ops',
    });

    return res.json({ ok: true, totalDeleted, results });
  } catch (error) {
    console.error('Maintenance cron error:', error);

    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
      details: results,
    });

    await NotificationService.notify({
      type: 'maintenance',
      severity: 'error',
      title: 'Daily maintenance failed',
      message: error.message,
      metadata: results,
      source: 'cron/maintenance',
      category: 'ops',
    });

    return res.status(500).json({ error: 'Maintenance failed', message: error.message });
  }
}
