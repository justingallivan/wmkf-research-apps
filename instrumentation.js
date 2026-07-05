/**
 * Next.js instrumentation hook.
 *
 * `register()` runs once per server instance startup (i.e. on every cold
 * start). The only thing wired here today is the EMERGENCY_AUTH_BYPASS
 * production monitor — see `lib/utils/auth-bypass-monitor.js` and the
 * companion daily cron `/api/cron/auth-bypass-check`.
 *
 * Guarded to the Node.js runtime: the monitor imports `@vercel/postgres`,
 * which must not load in the Edge bundle.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  try {
    // Dynamic import so the @vercel/postgres dependency is never pulled into
    // a non-nodejs bundle, and a monitor failure can't break server startup.
    const [{ withDalContext }, { checkEmergencyAuthBypass }] = await Promise.all([
      import('./lib/dataverse/core/context'),
      import('./lib/utils/auth-bypass-monitor'),
    ]);
    await withDalContext('cold-start-alerts', () =>
      checkEmergencyAuthBypass({ source: 'instrumentation/cold-start' })
    );
  } catch (err) {
    console.error('[instrumentation] auth-bypass-check failed:', err.message);
  }

  try {
    // Migration-drift detection (Phase 0 Step 4c). Best-effort; raises a
    // system_alerts row on drift or missing tracker, never throws.
    const [{ withDalContext }, { detectMigrationDrift }] = await Promise.all([
      import('./lib/dataverse/core/context'),
      import('./lib/utils/migration-drift'),
    ]);
    await withDalContext('cold-start-alerts', () => detectMigrationDrift());
  } catch (err) {
    console.warn('[instrumentation] migration-drift check failed:', err.message);
  }
}
