/**
 * Cron: /api/cron/reconcile-identities
 *
 * Weekly (Mondays 7:00 AM UTC) refresh of user_profiles.dynamics_systemuser_id.
 *
 * Reconciles profiles where:
 *   - dynamics_systemuser_id IS NULL AND azure_email IS NOT NULL  (never linked), OR
 *   - dynamics_reconciled_at IS NULL OR older than 30 days        (stale)
 *
 * Catches staff who get their Dynamics account after first app login.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses).
 *
 * Plan: docs/DYNAMICS_IDENTITY_RECONCILIATION_PLAN.md
 */

import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { reconcileBatch } from '../../../lib/services/dynamics-identity-service';
import { withDalContext } from '../../../lib/dataverse/core/context';
import MaintenanceService from '../../../lib/services/maintenance-service';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const runId = await MaintenanceService.startRun('reconcile-identities');

  try {
    const result = await withDalContext('cron-reconcile-identities', () =>
      reconcileBatch({ staleDays: 30, includeNull: true }),
    );

    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: result.totalScanned,
      details: { summary: result.summary },
    });

    return res.json({
      ok: true,
      totalScanned: result.totalScanned,
      summary: result.summary,
    });
  } catch (error) {
    console.error('Reconcile identities cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Reconciliation failed', message: 'Internal error' });
  }
}
