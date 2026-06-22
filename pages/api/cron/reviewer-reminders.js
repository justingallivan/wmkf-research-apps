/**
 * Cron: /api/cron/reviewer-reminders
 *
 * Daily. Sends the two reviewer-engagement reminders (spec §3.B):
 *   - respond-by : invited reviewers who haven't accepted/declined, at their per-reviewer
 *                  soft deadline (emailSentAt + respondOffsetDays) - leadDays, while their
 *                  token is still live. Fire-once via wmkf_respondremindersentat.
 *   - review-due : accepted, materials-sent, not-yet-submitted reviewers, at the request's
 *                  reviewDueDate - leadDays. Fire-once via wmkf_remindersentat.
 *
 * Both are per-request opt-in (campaign-config enabled flags) and claim-before-send.
 *
 * Manually triggerable:
 *   ?maxBatch=N   Cap sends per reminder type per run (default 200).
 *   ?dryRun=1     Report eligibility without claiming/sending.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { bypassDynamicsRestrictions } from '../../../lib/services/dynamics-context';
import { sweepReviewerReminders } from '../../../lib/services/reviewer-reminder-sweep';
import MaintenanceService from '../../../lib/services/maintenance-service';

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
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
    const result = await bypassDynamicsRestrictions('cron-reviewer-reminders', () =>
      sweepReviewerReminders({ maxBatch, dryRun }),
    );

    const errs = (result.respond.errors.length + result.reviewDue.errors.length);
    if (result.respond.sent || result.reviewDue.sent || errs) {
      console.log(`[cron:reviewer-reminders] respond(sent=${result.respond.sent} eligible=${result.respond.eligible} scanned=${result.respond.scanned} claimFail=${result.respond.claimFailed} sendFail=${result.respond.sendFailed}) reviewDue(sent=${result.reviewDue.sent} eligible=${result.reviewDue.eligible} scanned=${result.reviewDue.scanned} claimFail=${result.reviewDue.claimFailed} sendFail=${result.reviewDue.sendFailed}) dryRun=${dryRun}`);
    }

    await MaintenanceService.completeRun(runId, {
      status: errs > 0 ? 'failed' : 'completed',
      recordsProcessed: (result.respond.scanned ?? 0) + (result.reviewDue.scanned ?? 0),
      recordsDeleted: (result.respond.sent ?? 0) + (result.reviewDue.sent ?? 0),
      details: { maxBatch, dryRun, ...result },
      errorMessage: errs > 0 ? `${errs} send error(s)` : undefined,
    });
    return res.json({ ok: true, maxBatch, dryRun, ...result });
  } catch (error) {
    console.error('[cron:reviewer-reminders] error:', error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ error: 'Reminder sweep failed', message: error.message });
  }
}
