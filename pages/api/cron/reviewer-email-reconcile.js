/**
 * Cron: /api/cron/reviewer-email-reconcile
 *
 * Backstop (Fix A, S317) for reviewers whose vetted enrichment email reached the
 * durable roster but not Dataverse (save/enrichment ordering; applicant promote
 * pre-B1). Writes the ownerless ones, repoints the duplicate-person ones, alerts on
 * anything ambiguous. Path-agnostic; id-anchored on the roster `suggestionId`.
 *
 * Manually triggerable:
 *   ?maxBatch=N   Cap candidates scanned per run (default 200, clamp [1,1000]).
 *   ?dryRun=1     Report intended actions without mutating Dataverse.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import { reconcileReviewerEmails } from '../../../lib/services/reviewer-email-reconciler';
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

  const runId = await MaintenanceService.startRun('reviewer-email-reconcile');
  try {
    const result = await withDalContext('cron-reviewer-email-reconcile', () =>
      reconcileReviewerEmails({ maxBatch, dryRun }),
    );

    const acted = result.written.length + result.repointed.length + result.alerted.length;
    if (acted || result.errors.length) {
      console.log(`[cron:reviewer-email-reconcile] scanned=${result.scanned} wrote=${result.written.length} repointed=${result.repointed.length} alerted=${result.alerted.length} skipped=${result.skipped} errors=${result.errors.length} dryRun=${dryRun}`);
    }

    await MaintenanceService.completeRun(runId, {
      status: result.errors.length > 0 ? 'failed' : 'completed',
      recordsProcessed: result.scanned,
      recordsDeleted: result.written.length + result.repointed.length,
      details: { maxBatch, dryRun, ...result },
      errorMessage: result.errors.length > 0 ? `${result.errors.length} row error(s)` : undefined,
    });
    return res.json({ ok: true, maxBatch, dryRun, ...result });
  } catch (error) {
    console.error('[cron:reviewer-email-reconcile] error:', error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error.message });
    return res.status(500).json({ error: 'Reconcile sweep failed', message: error.message });
  }
}
