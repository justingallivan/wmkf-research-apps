/**
 * Cron: /api/cron/drain-reviewer-acceptances
 *
 * Drains reviewer_acceptance_jobs, the durable post-accept side-effect queue for
 * external reviewer Stage 2a accept clicks. Dataverse remains authoritative for
 * accepted state; this route only resumes slower follow-up work after the accept
 * row is committed.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { drainReviewerAcceptanceJobs } from '../../../lib/services/reviewer-acceptance-drain';
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

  const limit = clampInt(req.query.limit, 1, 50, 5);
  const lockSeconds = clampInt(req.query.lockSeconds, 60, 900, 300);
  const runId = await MaintenanceService.startRun('drain-reviewer-acceptances');
  const deployment = {
    gitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID || null,
  };

  try {
    const result = await withDalContext('cron-drain-reviewer-acceptances', () =>
      drainReviewerAcceptanceJobs({ limit, lockSeconds }),
    );
    const status = result.failed > 0 || result.leaseLost > 0 ? 'failed' : 'completed';
    await MaintenanceService.completeRun(runId, {
      status,
      recordsProcessed: result.claimed,
      recordsDeleted: result.completed + result.cancelled,
      details: { limit, lockSeconds, deployment, ...result },
      errorMessage: status === 'failed'
        ? `${result.failed} reviewer acceptance job(s) failed; ${result.leaseLost} lease(s) lost`
        : undefined,
    });
    return res.json({ ok: true, limit, lockSeconds, ...result });
  } catch (error) {
    console.error('[cron:drain-reviewer-acceptances] error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      details: { limit, lockSeconds, deployment },
      errorMessage: error.message,
    });
    return res.status(500).json({
      error: 'Reviewer acceptance drain failed',
      message: error.message,
    });
  }
}
