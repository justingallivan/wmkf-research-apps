/**
 * Cron: /api/cron/send-review-thankyous
 *
 * Daily. Emails every reviewer whose review was RECEIVED
 * (`wmkf_reviewreceivedat` set) but who has not yet been thanked
 * (`wmkf_thankyousentat` null) the seeded 'thankyou' template, with a courtesy
 * DOCX copy of their own submitted review attached as real file bytes.
 *
 * Fire-once + at-most-once: the thank-you marker `wmkf_thankyousentat` is claimed
 * via an If-Match conditional write BEFORE the send, so a concurrent run, a manual
 * thank-you, or a post-send retry can never double-thank. A send failure after a
 * successful claim is logged, not retried. The attachment is non-fatal (the
 * thank-you still ships without the DOCX).
 *
 * Manually triggerable:
 *   ?maxBatch=N   Cap claims/sends per run (default 200).
 *   ?dryRun=1     Report eligibility without claiming/sending.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { sweepReviewThankYous } from '../../../lib/services/reviewer-thankyou-sweep';
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

  const runId = await MaintenanceService.startRun('review-thankyous');

  try {
    const result = await withDalContext('cron-review-thankyous', () =>
      sweepReviewThankYous({ maxBatch, dryRun }),
    );

    const errs = result.errors.length;
    if (result.sent || errs) {
      console.log(`[cron:review-thankyous] sent=${result.sent} eligible=${result.eligible} scanned=${result.scanned} claimFail=${result.claimFailed} sendFail=${result.sendFailed} attachmentFail=${result.attachmentFailed} dryRun=${dryRun}`);
    }

    const operationalFailures = (result.sendFailed || 0)
      + (result.attachmentFailed || 0)
      + (result.skippedMisconfigured || 0);
    await MaintenanceService.completeRun(runId, {
      status: operationalFailures > 0 ? 'failed' : 'completed',
      recordsProcessed: result.scanned ?? 0,
      recordsDeleted: result.sent ?? 0,
      details: { maxBatch, dryRun, ...result },
      errorMessage: operationalFailures > 0
        ? `${result.sendFailed || 0} send, ${result.attachmentFailed || 0} attachment, ${result.skippedMisconfigured || 0} configuration error(s)`
        : undefined,
    });
    return res.json({ ok: true, maxBatch, dryRun, ...result });
  } catch (error) {
    console.error('[cron:review-thankyous] error:', error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ error: 'Thank-you sweep failed', message: 'Internal error' });
  }
}
