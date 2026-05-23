/**
 * EMERGENCY_AUTH_BYPASS production monitor.
 *
 * `EMERGENCY_AUTH_BYPASS=true` disables authentication in production — it is
 * the only env value that lets a misconfigured prod deploy fall open (see
 * `lib/utils/auth-policy.js`). It is an emergency lever and must never be left
 * set after an incident. This module raises a CRITICAL `system_alerts` row
 * whenever the lever is found active in production, and auto-resolves that
 * alert once the lever is cleared.
 *
 * One logic path, two callers (so cold-start and cron can't drift):
 *   - `instrumentation.js` register()        → fires on every server cold start
 *   - `/api/cron/auth-bypass-check`          → daily re-assert + auto-resolve
 *
 * Deliberately NOT imported by `auth-policy.js`: that module is Edge-bundle
 * constrained and must not pull in `@vercel/postgres`. This module is
 * Node-runtime only.
 */

import NotificationService from '../services/notification-service';
import AlertService from '../services/alert-service';

const AUTO_RESOLVE_KEY = 'emergency-auth-bypass';

/**
 * True only when the bypass lever is active in a production environment.
 * Non-production envs use the lever routinely for local/dev auth-off work,
 * so they are intentionally not alerted on.
 */
export function isEmergencyAuthBypassActive() {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.EMERGENCY_AUTH_BYPASS === 'true'
  );
}

/**
 * Check the lever and raise/resolve the alert accordingly.
 *
 * Best-effort: never throws. An alerting failure must not crash a server
 * cold start or fail a cron run — the structured log is emitted first so the
 * signal survives even if the Postgres write fails.
 *
 * @param {Object} opts
 * @param {string} opts.source - origin tag, recorded on the alert + logs
 * @returns {Promise<{active:boolean, alerted:boolean, resolved:number, error:(string|null)}>}
 */
export async function checkEmergencyAuthBypass({ source }) {
  const active = isEmergencyAuthBypassActive();
  try {
    if (active) {
      // Structured, greppable log — emitted before the DB write so the signal
      // survives a Postgres outage. Fires on every check while the lever holds.
      console.error(JSON.stringify({
        level: 'critical',
        event: 'emergency_auth_bypass_active',
        message: 'EMERGENCY_AUTH_BYPASS=true in production — authentication is DISABLED',
        source,
      }));
      const alert = await NotificationService.notify({
        type: 'security',
        severity: 'critical',
        title: 'EMERGENCY_AUTH_BYPASS active in production',
        message:
          'EMERGENCY_AUTH_BYPASS=true is set in the production environment — ' +
          'all authentication is bypassed. Unset this variable immediately ' +
          'unless an active incident requires it.',
        metadata: { source, detectedAt: new Date().toISOString() },
        source,
        autoResolveKey: AUTO_RESOLVE_KEY,
        emailAdmins: true,
        category: 'security',
      });
      // `notify` returns null when an active alert with this key already
      // exists (dedup) — so `alerted` is true only for the first detection.
      return { active: true, alerted: !!alert, resolved: 0, error: null };
    }
    // Lever clear — resolve any standing alert from a prior incident.
    const resolved = await AlertService.autoResolve(AUTO_RESOLVE_KEY);
    return { active: false, alerted: false, resolved, error: null };
  } catch (err) {
    console.error(`[auth-bypass-monitor] check failed (${source}): ${err.message}`);
    return { active, alerted: false, resolved: 0, error: err.message };
  }
}
