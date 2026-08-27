/**
 * Migration drift detection.
 *
 * Cold-start hook reads the committed manifest (`lib/db/migrations-manifest.json`)
 * and compares against `schema_migrations` tracker rows. Raises a
 * deduplicated `system_alerts` entry on drift AND emails the `ops` category
 * recipients via NotificationService; best-effort and never throws.
 *
 * Three distinct alert states (S464 split the drift direction — the two
 * directions carry different risk and different severities):
 *   - `migration_tracker_missing` (error, emails): the tracker table itself
 *     does not exist (42P01). The "fresh env / Phase 0 hasn't run" signal.
 *   - `migration_drift` with MISSING entries (error, emails): the manifest
 *     expects a migration the tracker lacks — code expects schema that
 *     doesn't exist; S192 proved this materializes as broken features within
 *     ≤24h.
 *   - `migration_drift_ahead`, EXTRA-only (warning, DB alert, no email): the
 *     tracker holds migrations the running build's manifest doesn't know.
 *     This is the NORMAL apply-before-merge deploy sequence in flight
 *     (additive migrations are applied to the shared database before the
 *     code deploys), so it must not email on every cold start of the
 *     pre-merge build. It still records a system_alert for the dashboard.
 *     Distinct autoResolveKey from the missing-direction error so an active
 *     ahead-warning row can never dedup-suppress a later missing-drift email.
 *
 * Wired into `instrumentation.js` `register()` via dynamic import, matching
 * the existing `auth-bypass-monitor` pattern.
 *
 * See docs/archive/READINESS_AUDIT_PHASE0_PLAN.md § Step 4c.
 */

const TRACKER_TABLE_MISSING_CODE = '42P01'; // undefined_table
const TRACKER_MISSING_KEY = 'migration-tracker-missing';
const DRIFT_KEY = 'migration-drift';
const AHEAD_KEY = 'migration-drift-ahead';

let manifest;
try {
  manifest = require('../db/migrations-manifest.json');
} catch (err) {
  // Manifest missing at runtime is a build pipeline failure. Don't crash;
  // the cold-start hook will log + skip the check.
  manifest = null;
  console.warn('[migration-drift] migrations-manifest.json not found:', err.message);
}

async function detectMigrationDrift() {
  if (!manifest || !Array.isArray(manifest.files)) {
    console.warn('[migration-drift] manifest missing or malformed; skipping drift check');
    return;
  }

  const { sql } = await import('@vercel/postgres');
  const { default: AlertService } = await import('../services/alert-service');
  const { default: NotificationService } = await import('../services/notification-service');

  let rows;
  try {
    const result = await sql`SELECT name FROM schema_migrations`;
    rows = result.rows;
  } catch (err) {
    if (getPgErrorCode(err) === TRACKER_TABLE_MISSING_CODE) {
      await NotificationService.notify({
        type: 'migration_tracker_missing',
        severity: 'error',
        title: 'schema_migrations table does not exist',
        message:
          'Cold-start drift check could not read the migration tracker. ' +
          'Either Phase 0 Step 1 has not run on this environment, or the tracker was dropped. ' +
          'Run scripts/apply-migrations.js to bootstrap.',
        source: 'instrumentation/migration-drift',
        autoResolveKey: TRACKER_MISSING_KEY,
        category: 'ops',
      }).catch(() => {});
      return;
    }
    console.warn('[migration-drift] tracker query failed:', err && err.message);
    return;
  }

  await AlertService.autoResolve(TRACKER_MISSING_KEY).catch(() => {});

  const tracked = new Set(rows.map(r => r.name));
  const missing = manifest.files.filter(f => !tracked.has(f));
  const manifestSet = new Set(manifest.files);
  const extra = rows.map(r => r.name).filter(name => !manifestSet.has(name));
  if (missing.length === 0 && extra.length === 0) {
    await AlertService.autoResolve(DRIFT_KEY).catch(() => {});
    await AlertService.autoResolve(AHEAD_KEY).catch(() => {});
    return;
  }

  const detail =
    `Tracked: ${tracked.size}. Manifest: ${manifest.files.length}. ` +
    `Missing: ${missing.join(', ') || 'none'}. Extra: ${extra.join(', ') || 'none'}`;
  const metadata = { missing, extra, trackedCount: tracked.size, manifestCount: manifest.files.length };

  if (missing.length > 0) {
    // Severity `error` because a missing migration means code expects schema
    // that doesn't exist — by construction this surfaces as broken features
    // within hours (S192 incident: a `warning` drift alert sat 17h in DB-only
    // state before the maintenance cron tripped on the missing table). The
    // drift check is the proactive signal; treat it that way.
    await AlertService.autoResolve(AHEAD_KEY).catch(() => {});
    await NotificationService.notify({
      type: 'migration_drift',
      severity: 'error',
      title: 'Migration tracker differs from committed manifest',
      message: detail,
      metadata,
      source: 'instrumentation/migration-drift',
      autoResolveKey: DRIFT_KEY,
      category: 'ops',
    }).catch(() => {});
    return;
  }

  // Extra-only: the tracker is AHEAD of this build's manifest — the normal
  // apply-before-merge window. Warning severity records the alert without
  // emailing (NotificationService emails only error/critical by default).
  await AlertService.autoResolve(DRIFT_KEY).catch(() => {});
  await NotificationService.notify({
    type: 'migration_drift_ahead',
    severity: 'warning',
    title: 'Migration tracker is ahead of this build\'s manifest',
    message: detail,
    metadata,
    source: 'instrumentation/migration-drift',
    autoResolveKey: AHEAD_KEY,
    category: 'ops',
  }).catch(() => {});
}

function getPgErrorCode(err) {
  return err?.code || err?.cause?.code || err?.originalError?.code;
}

module.exports = { detectMigrationDrift };
