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
    const { checkEmergencyAuthBypass } = await import(
      './lib/utils/auth-bypass-monitor'
    );
    await checkEmergencyAuthBypass({ source: 'instrumentation/cold-start' });
  } catch (err) {
    console.error('[instrumentation] register() failed:', err.message);
  }
}
