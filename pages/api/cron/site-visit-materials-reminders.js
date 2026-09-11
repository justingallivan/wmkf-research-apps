/**
 * Cron: /api/cron/site-visit-materials-reminders
 *
 * Automatic applicant-materials reminder (docs/APPLICANT_ADDITIONAL_MATERIALS_PLAN.md
 * §16.3, PR 3). One reminder per collection, on the first run after the due
 * date with a required item still missing and no reminder recorded since the
 * due date; claim-before-send. Policy and sender live in
 * lib/services/site-visit-materials/reminder-sweep.js.
 *
 * Built but NOT scheduled: the route is callable with CRON_SECRET; adding it
 * to vercel.json is the owner's decision (M5 flagged the cadence as a
 * follow-up).
 *
 *   ?maxBatch=N   Cap sends per run (default 100).
 *   ?dryRun=1     Report eligibility without claiming or sending.
 *
 * Auth: Vercel CRON_SECRET (matches all /api/cron/* routes).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { sweepMaterialsReminders } from '../../../lib/services/site-visit-materials/reminder-sweep';

function clampInt(raw, lo, hi, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!verifyCronSecret(req, res)) return;

  const maxBatch = clampInt(req.query.maxBatch, 1, 500, 100);
  const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
  const runId = await MaintenanceService.startRun('site-visit-materials-reminders');

  try {
    const result = await withDalContext('cron-site-visit-materials-reminders', () =>
      sweepMaterialsReminders({ maxBatch, dryRun }));
    const errs = result.errors?.length || 0;
    if (result.sent || errs) {
      console.log(`[cron:site-visit-materials-reminders] scanned=${result.scanned} eligible=${result.eligible} sent=${result.sent} nothingMissing=${result.skippedNothingMissing} noSender=${result.skippedNoSender} claimLost=${result.claimLost} sendFail=${result.sendFailed} receiptFail=${result.receiptFailed} dryRun=${dryRun}`);
    }
    await MaintenanceService.completeRun(runId, {
      status: errs > 0 ? 'failed' : 'completed',
      recordsProcessed: result.scanned ?? 0,
      recordsDeleted: result.sent ?? 0,
      details: { maxBatch, dryRun, ...result },
      errorMessage: errs > 0 ? `${errs} error(s)` : undefined,
    });
    return res.json({ ok: true, maxBatch, dryRun, ...result });
  } catch (error) {
    console.error('[cron:site-visit-materials-reminders] failed:', error?.message || error);
    await MaintenanceService.completeRun(runId, { status: 'failed', errorMessage: error?.message || String(error) });
    return res.status(500).json({ ok: false, error: 'Automatic materials reminders failed.' });
  }
}
