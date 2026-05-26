/**
 * Cron: /api/cron/secret-check
 *
 * Daily check (8:00 AM UTC) for approaching secret expirations.
 * Reads expiration dates from Dataverse `wmkf_appsystemsettings` (via the
 * settings-service dispatcher) and creates alerts at tiered thresholds:
 * warning at 14 days, error at 7 days, critical if expired.
 *
 * Secret expiration dates are stored with keys like:
 *   secret_expiration:azure_ad_client_secret = "2026-06-15"
 *
 * Last-rotation dates are stored as:
 *   secret_rotation:azure_ad_client_secret = "2026-01-15"
 *
 * Auth: Vercel CRON_SECRET (dev mode bypasses)
 */

import { sql } from '@vercel/postgres';
import { verifyCronSecret } from '../../../lib/utils/cron-auth';
import NotificationService from '../../../lib/services/notification-service';
import { listSettings } from '../../../lib/services/settings-service';
import AlertService from '../../../lib/services/alert-service';
import MaintenanceService from '../../../lib/services/maintenance-service';
import { TRACKED_SECRETS } from '../../../lib/utils/tracked-secrets';

// Cadence enforcement: this cron alerts ONLY against an explicit
// `secret_expiration:<key>` setting in Dataverse `wmkf_appsystemsettings`.
// HMAC-style secrets (no vendor-side expiration) won't fire unless an
// operator-set rotation cadence is recorded as a synthetic expiration
// (e.g. last_rotation + 180d). The TRACKED_SECRETS list is the canonical
// source (lib/utils/tracked-secrets.js); admin secrets endpoint + runbook
// reference the same list.

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!verifyCronSecret(req, res)) return;

  const runId = await MaintenanceService.startRun('secret-check');

  try {
    // Load all secret_expiration:* and secret_rotation:* settings
    const [expirations, rotations] = await Promise.all([
      listSettings('secret_expiration:'),
      listSettings('secret_rotation:'),
    ]);
    const settingsMap = { ...expirations, ...rotations };

    const results = [];
    const now = new Date();

    for (const secret of TRACKED_SECRETS) {
      const expirationStr = settingsMap[`secret_expiration:${secret.key}`];
      const rotationStr = settingsMap[`secret_rotation:${secret.key}`];

      if (!expirationStr) {
        results.push({ key: secret.key, name: secret.name, status: 'not_tracked' });
        continue;
      }

      const expiration = new Date(expirationStr);
      const daysUntilExpiry = Math.ceil((expiration - now) / (24 * 60 * 60 * 1000));
      const autoResolveKey = `secret:${secret.key}`;

      let severity = null;
      if (daysUntilExpiry <= 0) {
        severity = 'critical';
      } else if (daysUntilExpiry <= 7) {
        severity = 'error';
      } else if (daysUntilExpiry <= 14) {
        severity = 'warning';
      }

      if (severity) {
        const title = daysUntilExpiry <= 0
          ? `EXPIRED: ${secret.name}`
          : `${secret.name} expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? '' : 's'}`;

        await NotificationService.notify({
          type: 'secret_expiration',
          severity,
          title,
          message: `Expiration date: ${expirationStr}. ${rotationStr ? `Last rotated: ${rotationStr}` : 'No rotation date recorded.'}`,
          metadata: {
            secretKey: secret.key,
            secretName: secret.name,
            expirationDate: expirationStr,
            lastRotated: rotationStr || null,
            daysUntilExpiry,
          },
          source: 'cron/secret-check',
          autoResolveKey,
          category: 'ops',
        });
      } else {
        // Secret is healthy — auto-resolve any prior alerts for it
        await AlertService.autoResolve(autoResolveKey);
      }

      results.push({
        key: secret.key,
        name: secret.name,
        expirationDate: expirationStr,
        lastRotated: rotationStr || null,
        daysUntilExpiry,
        status: severity || 'ok',
      });
    }

    const flagged = results.filter(r => r.status !== 'ok').length;
    await MaintenanceService.completeRun(runId, {
      status: 'completed',
      recordsProcessed: results.length,
      details: { secretsChecked: results.length, flagged },
    });

    return res.json({ ok: true, secrets: results });
  } catch (error) {
    console.error('Secret check cron error:', error);
    await MaintenanceService.completeRun(runId, {
      status: 'failed',
      errorMessage: error.message,
    });
    return res.status(500).json({ error: 'Secret check failed', message: error.message });
  }
}
