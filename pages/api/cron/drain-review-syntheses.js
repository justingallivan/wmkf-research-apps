/**
 * Cron: /api/cron/drain-review-syntheses
 *
 * Scans participating reviewer lifecycles, enqueues each newly-ready input
 * fingerprint once, and drains a deliberately small generation batch.
 * REVIEW_SYNTHESIS_AUTOMATION_ENABLED must be exactly "true"; this prevents a
 * deployment from backfilling historical requests before deliberate rollout.
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainReviewSynthesisJobs } from '../../../lib/services/review-synthesis-drain';
import MaintenanceService from '../../../lib/services/maintenance-service';

function clampInt(raw, lo, hi, fallback) {
  const value = parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hi, Math.max(lo, value));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;
  if (process.env.REVIEW_SYNTHESIS_AUTOMATION_ENABLED !== 'true') {
    return res.json({ ok: true, enabled: false, reason: 'automation_disabled' });
  }

  const scanLimit = clampInt(req.query.scanLimit, 1, 100, 25);
  const claimLimit = clampInt(req.query.claimLimit, 1, 3, 1);
  const lockSeconds = clampInt(req.query.lockSeconds, 300, 1200, 600);
  const runId = await MaintenanceService.startRun('drain-review-syntheses');

  try {
    const result = await withDalContext('cron-drain-review-syntheses', () =>
      drainReviewSynthesisJobs({ scanLimit, claimLimit, lockSeconds }),
    );
    const status = result.failed > 0 ? 'failed' : 'completed';
    await MaintenanceService.completeRun(runId, {
      status,
      recordsProcessed: result.claimed,
      recordsDeleted: result.completed + result.cancelled,
      details: { scanLimit, claimLimit, lockSeconds, ...result },
      errorMessage: status === 'failed'
        ? `${result.failed} review synthesis job(s) failed`
        : undefined,
    });
    return res.json({ ok: true, enabled: true, ...result });
  } catch (error) {
    console.error('[cron:drain-review-syntheses] error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      details: { scanLimit, claimLimit, lockSeconds },
      errorMessage: error.message,
    });
    return res.status(500).json({
      error: 'Review synthesis drain failed',
      message: error.message,
    });
  }
}
