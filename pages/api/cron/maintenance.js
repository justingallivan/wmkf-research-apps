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

    // 4.5. Intake audit retention (S187 #11). Append-only audit trail of
    //      applicant-facing portal actions. Default 730d (Dataverse-
    //      overridable via retention:intake_audit_days). Grouped with the
    //      other Postgres time-series DELETEs.
    try {
      results.intakeAudit = await MaintenanceService.cleanupIntakeAudit(config.intake_audit_days);
      totalDeleted += results.intakeAudit;
    } catch (error) {
      results.intakeAudit = { error: error.message };
    }

    // 4.6. BILL.com webhook dedup table (S188). Default 7d TTL —
    //      comfortably exceeds any plausible BILL retry horizon.
    try {
      results.billWebhookEvents = await MaintenanceService.cleanupBillWebhookEvents(config.bill_webhook_events_days);
      totalDeleted += results.billWebhookEvents;
    } catch (error) {
      results.billWebhookEvents = { error: error.message };
    }

    // 4.7. maintenance_runs audit retention (eval #3 follow-up). The
    //      drain-submissions cron writes here on every active/failed tick;
    //      without a sweep the table grows unbounded. Default 90d
    //      (Dataverse-overridable via retention:maintenance_runs_days). The
    //      current run's own row (started just now) is never reaped.
    try {
      results.maintenanceRuns = await MaintenanceService.cleanupMaintenanceRuns(config.maintenance_runs_days);
      totalDeleted += results.maintenanceRuns;
    } catch (error) {
      results.maintenanceRuns = { error: error.message };
    }

    // 4.8. BILL honorarium onboarding resume sweep (chunk-4 hardening, Fix #3).
    //      Retries torn akoya_request writebacks (dynamics_pending rows) left by
    //      a Dynamics blip after the BILL side succeeded. Idempotent; fails closed
    //      on a malformed (pending_match NULL) marker. See docs/BILL_CHUNK_4_DESIGN.md.
    try {
      results.billOnboardingResume = await MaintenanceService.sweepBillOnboarding();
    } catch (error) {
      results.billOnboardingResume = { error: error.message };
    }

    // 4.9. BILL onboarding state TTL — prune completed (non-pending) rows.
    try {
      results.billOnboardingState = await MaintenanceService.cleanupBillOnboardingState(config.bill_onboarding_state_days);
      if (typeof results.billOnboardingState === 'number') totalDeleted += results.billOnboardingState;
    } catch (error) {
      results.billOnboardingState = { error: error.message };
    }

    // 5. Old alerts cleanup
    try {
      results.alerts = await AlertService.cleanupOldAlerts(config.alert_days);
      totalDeleted += results.alerts;
    } catch (error) {
      results.alerts = { error: error.message };
    }

    // 6. Intake-portal pending-attachment sweep (S184 chunk 6). Runs
    //    BEFORE cleanupBlobs so any sweep `del()` failures that leave
    //    orphan Blob references feed into the next task's cleanup pass
    //    on the same tick (per scoping doc § 6 "Cron sweep ordering").
    //    2h cutoff per A6.
    try {
      results.intakePending = await MaintenanceService.sweepIntakePending();
      if (typeof results.intakePending?.deleted === 'number') {
        totalDeleted += results.intakePending.deleted;
      }
    } catch (error) {
      results.intakePending = { error: error.message };
    }

    // 7. Blob cleanup (actual deletion, not dry run)
    try {
      results.blobs = await MaintenanceService.cleanupBlobs(config.blob_days, false);
      totalDeleted += results.blobs.deleted;
    } catch (error) {
      results.blobs = { error: error.message };
    }

    // 7.5. Intake private-Blob sweep (S187 #7). Reaps orphan bytes in the
    //      `intake-applicant-private` store left after successful drains
    //      (handleFilesMoved doesn't inline-del). Distinct store + token
    //      from step 7 (cleanupBlobs runs against the shared public store).
    //      Sources to keep "active": pre-submit drafts.attachments[],
    //      pending_attachments[], and non-terminal submission_jobs payload.
    try {
      results.intakePrivateBlobs = await MaintenanceService.cleanupIntakePrivateBlobs({});
      if (typeof results.intakePrivateBlobs?.deleted === 'number') {
        totalDeleted += results.intakePrivateBlobs.deleted;
      }
    } catch (error) {
      results.intakePrivateBlobs = { error: error.message };
    }

    // 8. Dynamics feedback cleanup (resolved entries older than 180 days)
    try {
      results.feedback = await FeedbackService.cleanupOldFeedback(180);
      totalDeleted += results.feedback;
    } catch (error) {
      results.feedback = { error: error.message };
    }

    // Identify subtasks that failed (Codex pass-1 Q-P3 + pass-2 §3 #29).
    // Without this, an `info`/`completed` outcome silently masked
    // cleanupExpiredCache and intakePending failures for days. Treat thrown
    // errors and non-zero counted errors as failed runs so object-shaped
    // subtasks like cleanupBlobs / sweepIntakePending can't pass quietly.
    const failedSubtasks = Object.entries(results)
      .filter(([_, val]) => isFailedSubtaskResult(val))
      .map(([key]) => key);
    const hasSubtaskFailure = failedSubtasks.length > 0;

    // Record run with status reflecting subtask outcomes
    await MaintenanceService.completeRun(runId, {
      status: hasSubtaskFailure ? 'failed' : 'completed',
      recordsProcessed: totalDeleted,
      recordsDeleted: totalDeleted,
      details: results,
      errorMessage: hasSubtaskFailure
        ? `Subtask failures: ${failedSubtasks.join(', ')}`
        : undefined,
    });

    // Summary line is computed the same way regardless of outcome
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
      severity: hasSubtaskFailure ? 'error' : 'info',
      title: hasSubtaskFailure
        ? `Daily maintenance had ${failedSubtasks.length} subtask failure(s)`
        : `Daily maintenance completed: ${totalDeleted} records cleaned`,
      message: summary,
      metadata: { ...results, failedSubtasks },
      source: 'cron/maintenance',
      category: 'ops',
    });

    return res.json({
      ok: !hasSubtaskFailure,
      totalDeleted,
      results,
      failedSubtasks,
    });
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

function isFailedSubtaskResult(val) {
  if (!val || typeof val !== 'object') return false;
  if (val.error) return true;
  for (const key of ['errors', 'blobDelErrors', 'removePendingErrors']) {
    const count = Array.isArray(val[key]) ? val[key].length : Number(val[key] || 0);
    if (count > 0) return true;
  }
  return false;
}
