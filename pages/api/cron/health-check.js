/**
 * Cron: /api/cron/health-check
 *
 * Runs every 15 minutes. Calls the shared runHealthChecks() and stores
 * results in health_check_history. Creates alerts on degradation,
 * auto-resolves on recovery, and escalates severity if unhealthy
 * for consecutive checks.
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses)
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import { runHealthChecks } from '../../../lib/utils/health-checker';
import AlertService from '../../../lib/services/alert-service';
import NotificationService from '../../../lib/services/notification-service';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { withDalContext } from '../../../lib/dataverse/core/context';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const runId = await MaintenanceService.startRun('health-check');

  try {
    // Run health checks
    const health = await runHealthChecks();

    // Store in history
    await sql`
      INSERT INTO health_check_history (overall_status, services, response_time_ms, triggered_by)
      VALUES (${health.overall}, ${JSON.stringify(health.services)}, ${health.responseTimeMs}, 'cron')
    `;

    // Get previous check for comparison
    const prevResult = await sql`
      SELECT overall_status, created_at FROM health_check_history
      ORDER BY created_at DESC
      OFFSET 1 LIMIT 1
    `;
    const prevStatus = prevResult.rows[0]?.overall_status;

    // Determine if we need to alert or auto-resolve
    if (health.overall === 'healthy' && prevStatus && prevStatus !== 'healthy') {
      // Recovery — auto-resolve any active health alerts
      const resolved = await AlertService.autoResolve('health:degraded');
      await AlertService.autoResolve('health:unhealthy');

      await NotificationService.notify({
        type: 'health',
        severity: 'info',
        title: 'Services recovered — all healthy',
        message: `System recovered from ${prevStatus} state. ${resolved} alert(s) auto-resolved.`,
        metadata: { services: health.services, responseTimeMs: health.responseTimeMs },
        source: 'cron/health-check',
        category: 'ops',
      });
    } else if (health.overall !== 'healthy') {
      // Find which services are unhealthy
      const failedServices = Object.entries(health.services)
        .filter(([, s]) => s.status === 'error')
        .map(([name]) => name);

      const warnServices = Object.entries(health.services)
        .filter(([, s]) => s.status === 'warning')
        .map(([name]) => name);

      // Check consecutive unhealthy count for severity escalation
      const consecutiveResult = await sql`
        SELECT COUNT(*) as count FROM (
          SELECT overall_status FROM health_check_history
          ORDER BY created_at DESC
          LIMIT 4
        ) recent
        WHERE overall_status != 'healthy'
      `;
      const consecutiveUnhealthy = parseInt(consecutiveResult.rows[0]?.count) || 0;

      // Escalate: warning for first occurrence, error for 2+, critical for 4+
      let severity = 'warning';
      if (consecutiveUnhealthy >= 4) severity = 'critical';
      else if (consecutiveUnhealthy >= 2) severity = 'error';

      const resolveKey = health.overall === 'unhealthy' ? 'health:unhealthy' : 'health:degraded';

      await withDalContext('notification-email', () => NotificationService.notify({
        type: 'health',
        severity,
        title: `System ${health.overall}: ${[...failedServices, ...warnServices].join(', ')}`,
        message: `${failedServices.length} service(s) erroring, ${warnServices.length} warning. Consecutive unhealthy checks: ${consecutiveUnhealthy}.`,
        metadata: {
          failedServices,
          warnServices,
          services: health.services,
          consecutiveUnhealthy,
          responseTimeMs: health.responseTimeMs,
        },
        source: 'cron/health-check',
        autoResolveKey: resolveKey,
        category: 'ops',
      }));
    }

    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      details: {
        overall: health.overall,
        responseTimeMs: health.responseTimeMs,
        previousStatus: prevStatus || 'none',
      },
    });

    return res.json({
      ok: true,
      overall: health.overall,
      responseTimeMs: health.responseTimeMs,
      previousStatus: prevStatus || 'none',
    });
  } catch (error) {
    console.error('Health check cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Health check failed', message: 'Internal error' });
  }
}
