/**
 * API Route: /api/admin/alerts
 *
 * GET  — List active/acknowledged alerts (superuser only)
 *   Query: ?status=active|acknowledged|resolved (default: active+acknowledged)
 *   Query: ?repairContext=<alert id> re-reads the current server-owned request,
 *          reviewer, address-conflict, and evidence context for one repair alert
 * PATCH — Acknowledge or resolve an alert
 *   Body: { id, action: 'acknowledge'|'resolve' }
 *
 * Also supports GET ?summary=true for badge counts only.
 */

import { requireSuperuser } from '../../../lib/utils/auth';
import { withDalContext } from '../../../lib/dataverse/core/context';
import AlertService from '../../../lib/services/alert-service';
import { getAddressRepairRequestContext } from '../../../lib/services/reviewer-address-trust-service';

export default async function handler(req, res) {
  const gate = await requireSuperuser(req, res);
  if (!gate) return;
  const { profileId } = gate;

  if (req.method === 'GET') {
    try {
      if (req.query.repairContext !== undefined) {
        const rawAlertId = req.query.repairContext;
        const alertId = typeof rawAlertId === 'string' && /^\d+$/.test(rawAlertId)
          ? Number(rawAlertId)
          : NaN;
        if (!Number.isSafeInteger(alertId) || alertId <= 0) {
          return res.status(400).json({ error: 'Invalid repair alert id' });
        }
        const alert = await AlertService.getAlertById(alertId);
        if (
          !alert
          || alert.alert_type !== 'reviewer_address_repair_requested'
          || !['active', 'acknowledged'].includes(alert.status)
        ) {
          return res.status(404).json({ error: 'Active reviewer repair alert not found' });
        }
        const metadata = alert.metadata && typeof alert.metadata === 'object'
          ? alert.metadata
          : {};
        const context = await withDalContext('admin-reviewer-repair-context', () => (
          getAddressRepairRequestContext({
            requestId: metadata.requestId,
            candidateKey: metadata.candidateKey,
            suggestionId: metadata.suggestionId,
            code: metadata.code,
            repairSurface: metadata.repairSurface,
          })
        ));
        if (!context) {
          return res.status(404).json({ error: 'Current reviewer repair context not found' });
        }
        return res.json({ context });
      }

      // Summary mode — just counts for badge
      if (req.query.summary === 'true') {
        const summary = await AlertService.getAlertSummary();
        return res.json(summary);
      }

      const alerts = await AlertService.getAlerts({ status: req.query.status });
      return res.json({ alerts });
    } catch (error) {
      console.error('Admin alerts GET error:', error);
      return res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { id, action } = req.body;
      if (!id || !['acknowledge', 'resolve'].includes(action)) {
        return res.status(400).json({ error: 'Missing id or invalid action (acknowledge|resolve)' });
      }

      let result;
      if (action === 'acknowledge') {
        result = await AlertService.acknowledgeAlert(id, profileId);
      } else {
        result = await AlertService.resolveAlert(id, profileId);
      }

      if (!result) {
        return res.status(404).json({ error: 'Alert not found or already resolved' });
      }

      return res.json({ alert: result });
    } catch (error) {
      console.error('Admin alerts PATCH error:', error);
      return res.status(500).json({ error: 'Failed to update alert' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
