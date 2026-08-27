/**
 * Cron: /api/cron/reviewer-reminders
 *
 * Daily. Ledger mode (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md, reviewer
 * cron-reminders slice): the two sweeps CREATE/reconcile durable
 * scheduled_email_messages rows for the reviewer-engagement reminders
 * (spec §3.B) instead of sending directly —
 *   - respond-by : invited reviewers who haven't accepted/declined; send time
 *                  (emailSentAt + respondOffsetDays) - leadDays, queued while
 *                  their token is live. Marker: wmkf_respondremindersentat.
 *   - review-due : accepted, materials-sent, not-yet-submitted reviewers;
 *                  send time reviewDueDate - leadDays. Marker: wmkf_remindersentat.
 * Both are per-request opt-in (campaign-config enabled flags).
 *
 * After the sweeps, this run also processes the shared scheduled-email
 * pipeline (per-PD digests, due sends, unfinalized repairs) so reviewer rows
 * created here reach PDs the same morning. The 08:00 UTC grantee cron runs
 * the same loops; every step is idempotent under leases/receipts, so the two
 * runs coexist. Delivery re-checks eligibility from fresh reads and stamps
 * marker + fresh token in one If-Match PATCH before transport
 * (claim-before-send preserved).
 *
 * Manually triggerable:
 *   ?maxBatch=N   Cap ledger-row upserts per reminder type per run (default 200).
 *   ?dryRun=1     Report eligibility without creating rows or sending.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { sweepReviewerReminders } from '../../../lib/services/reviewer-reminder-sweep';
import {
  deliverScheduledEmail,
  finalizeScheduledEmail,
  groupDigestRowsByPd,
  sendScheduledEmailDigest,
} from '../../../lib/services/scheduled-email-service';
import * as scheduledEmailStore from '../../../lib/services/scheduled-email-store';
import MaintenanceService from '../../../lib/services/maintenance-service';

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

async function processScheduledEmailPipeline() {
  const pipeline = {
    digestsSent: 0, digestFailed: 0,
    sent: 0, stopped: 0, deferred: 0, sendFailed: 0,
    finalized: 0, finalizeFailed: 0,
    errors: [],
  };

  const digestRows = await scheduledEmailStore.listScheduledEmailDigestRows();
  for (const group of groupDigestRowsByPd(digestRows)) {
    try {
      const outcome = await sendScheduledEmailDigest(group);
      if (outcome.sent) pipeline.digestsSent++;
    } catch (error) {
      pipeline.digestFailed++;
      pipeline.errors.push({ step: 'digest', pd: group.pdSystemUserId, message: String(error?.message || error).slice(0, 240) });
    }
  }

  const dueMessages = await scheduledEmailStore.listDueScheduledEmails();
  for (const message of dueMessages) {
    try {
      const outcome = await deliverScheduledEmail(message.id);
      if (outcome.sent) pipeline.sent++;
      if (outcome.stopped) pipeline.stopped++;
      if (outcome.deferred) pipeline.deferred++;
    } catch (error) {
      pipeline.sendFailed++;
      pipeline.errors.push({ step: 'send', id: message.id, message: String(error?.message || error).slice(0, 240) });
    }
  }

  const unfinalized = await scheduledEmailStore.listUnfinalizedScheduledEmails();
  for (const message of unfinalized) {
    try {
      await finalizeScheduledEmail(message);
      pipeline.finalized++;
    } catch (error) {
      pipeline.finalizeFailed++;
      pipeline.errors.push({ step: 'finalize', id: message.id, message: String(error?.message || error).slice(0, 240) });
    }
  }

  return pipeline;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const maxBatch = clampInt(req.query.maxBatch, 1, 1000, 200);
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';

  const runId = await MaintenanceService.startRun('reviewer-reminders');

  try {
    const result = await withDalContext('cron-reviewer-reminders', async () => {
      const sweeps = await sweepReviewerReminders({ maxBatch, dryRun });
      const pipeline = dryRun ? null : await processScheduledEmailPipeline();
      return { ...sweeps, pipeline };
    });

    const sweepErrs = result.respond.errors.length + result.reviewDue.errors.length;
    const pipelineErrs = result.pipeline
      ? result.pipeline.digestFailed + result.pipeline.sendFailed + result.pipeline.finalizeFailed
      : 0;
    const errs = sweepErrs + pipelineErrs;
    const rowActivity = ['created', 'revived', 'reassigned', 'refreshed']
      .reduce((n, k) => n + (result.respond[k] ?? 0) + (result.reviewDue[k] ?? 0), 0);
    if (rowActivity || result.pipeline?.sent || result.pipeline?.stopped || errs) {
      console.log(
        `[cron:reviewer-reminders] respond(created=${result.respond.created} revived=${result.respond.revived} reassigned=${result.respond.reassigned} refreshed=${result.respond.refreshed} eligible=${result.respond.eligible} scanned=${result.respond.scanned})`
        + ` reviewDue(created=${result.reviewDue.created} revived=${result.reviewDue.revived} reassigned=${result.reviewDue.reassigned} refreshed=${result.reviewDue.refreshed} eligible=${result.reviewDue.eligible} scanned=${result.reviewDue.scanned})`
        + (result.pipeline
          ? ` pipeline(digests=${result.pipeline.digestsSent} sent=${result.pipeline.sent} stopped=${result.pipeline.stopped} deferred=${result.pipeline.deferred} finalized=${result.pipeline.finalized} errors=${pipelineErrs})`
          : '')
        + ` dryRun=${dryRun}`,
      );
    }

    await MaintenanceService.completeRun(runId, {
      status: errs > 0 ? 'failed' : 'completed',
      recordsProcessed: (result.respond.scanned ?? 0) + (result.reviewDue.scanned ?? 0),
      recordsDeleted: (result.pipeline?.sent ?? 0),
      details: { maxBatch, dryRun, ...result },
      errorMessage: errs > 0 ? `${errs} error(s)` : undefined,
    });
    return res.json({ ok: true, maxBatch, dryRun, ...result });
  } catch (error) {
    console.error('[cron:reviewer-reminders] error:', error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ error: 'Reminder sweep failed', message: 'Internal error' });
  }
}
