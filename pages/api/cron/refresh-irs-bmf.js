/**
 * Cron: /api/cron/refresh-irs-bmf
 *
 * Quarterly (15th of Jan/Apr/Jul/Oct, 06:00 UTC) refresh of the IRS
 * Exempt Organizations Business Master File extract. Downloads all four
 * regional CSVs, streams them into a staging table via COPY, then
 * atomically swaps to live.
 *
 * Auth: CRON_SECRET (Vercel cron passes it). Dev bypasses for ad-hoc
 *   `curl` testing.
 *
 * Audit trail: maintenance_runs row with start/complete timestamps,
 *   per-region row counts, and alert on failure.
 *
 * See:
 *   lib/services/irs-bmf-service.js
 *   docs/atlas/postgres-irs-exempt-orgs.md
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import MaintenanceService from '../../../lib/services/maintenance-service';
import AlertService from '../../../lib/services/alert-service';
import { refresh } from '../../../lib/services/irs-bmf-service';

export const config = {
  // Quarterly refresh downloads ~400 MB across four regions and COPY-streams
  // ~1.95M rows. End-to-end usually completes in 40–90 s; raise the ceiling
  // above the cron-default 120 s in vercel.json so a slow IRS download
  // doesn't 504 mid-import.
  maxDuration: 300,
};

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';
  const strict = req.query?.strict === '1' || req.query?.strict === 'true';
  const runId = await MaintenanceService.startRun(
    dryRun ? 'irs-bmf-refresh-dryrun' : 'irs-bmf-refresh',
  );

  try {
    const stats = await refresh({ dryRun, strict });

    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: stats.totalRows,
      recordsDeleted: 0,
      details: stats,
    });

    return res.status(200).json({
      success: true,
      runId,
      ...stats,
    });
  } catch (error) {
    console.error('IRS BMF refresh failed:', error);

    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      details: { error: error.message },
      errorMessage: error.message,
    });

    try {
      await AlertService.createAlert({
        type: 'cron_failure',
        severity: 'warning',
        title: 'IRS BMF refresh failed',
        message: `Quarterly IRS BMF refresh failed: ${error.message}. Live `
          + `irs_exempt_orgs table is unchanged (atomic-swap pattern); `
          + `verification endpoint continues to serve the previous quarter's `
          + `data. Investigate before the next cycle opens.`,
        source: 'cron:refresh-irs-bmf',
      });
    } catch (alertError) {
      console.error('Failed to record alert for IRS BMF refresh failure:', alertError);
    }

    return res.status(500).json({
      success: false,
      runId,
      error: 'IRS BMF refresh failed',
    });
  }
}
