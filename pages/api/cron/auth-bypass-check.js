/**
 * Cron: /api/cron/auth-bypass-check
 *
 * Daily re-assert (07:30 UTC) of the EMERGENCY_AUTH_BYPASS production lever.
 *
 * EMERGENCY_AUTH_BYPASS=true disables all authentication in production. The
 * `instrumentation.js` cold-start hook raises a CRITICAL alert when the lever
 * is set, but a long-lived server instance never cold-starts again — this
 * cron is the standing daily check that keeps the alert fresh and, once the
 * lever is cleared, auto-resolves it.
 *
 * Shared logic with the cold-start hook lives in
 * `lib/utils/auth-bypass-monitor.js` so the two paths can't drift.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { checkEmergencyAuthBypass } from '../../../lib/utils/auth-bypass-monitor';
import { withDalContext } from '../../../lib/dataverse/core/context';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const runId = await MaintenanceService.startRun('auth-bypass-check');

  try {
    const result = await withDalContext('cron-auth-bypass-check', () =>
      checkEmergencyAuthBypass({
        source: 'cron/auth-bypass-check',
      })
    );

    // The monitor swallows its own errors and reports them in `result.error`.
    // Surface that as a failed run so the maintenance dashboard flags it.
    await MaintenanceService.completeRun(runId, {
      status: result.error ? 'failed' : 'completed',
      recordsProcessed: 1,
      errorMessage: result.error || undefined,
      details: {
        bypassActive: result.active,
        alertRaised: result.alerted,
        alertsResolved: result.resolved,
      },
    });

    return res.json({ ok: !result.error, ...result });
  } catch (error) {
    console.error('Auth-bypass-check cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Auth bypass check failed', message: 'Internal error' });
  }
}
