/**
 * Cleanup: drop concept-evaluator grants from user_app_access (both backends).
 *
 * Concept Evaluator was deprecated in Session 110 (2026-04-25) — page + API
 * + prompt moved to /_archived. Existing user_app_access grants for
 * 'concept-evaluator' are harmless (the app no longer exists), but they
 * pollute admin views.
 *
 * History:
 *   - 2026-04-25 (Session 111): first version cleaned only Postgres via raw
 *     SQL, when WAVE1_BACKEND_APP_ACCESS still defaulted to postgres.
 *   - 2026-04-27: Wave 1 flag flipped to dataverse; the parity test
 *     test-wave1-flag-dispatch.js surfaced pg=16 / dv=17 for Justin —
 *     concept-evaluator was still living in Dataverse. Rewrote to use the
 *     dispatch service and force WAVE1_BACKEND_APP_ACCESS=dataverse so the
 *     cleanup hits Dataverse on this run. Postgres is already clean, so
 *     the Postgres branch is a no-op when re-run there.
 *
 * Usage:
 *   node scripts/cleanup-concept-evaluator-grants.js --dry-run
 *   node scripts/cleanup-concept-evaluator-grants.js --execute
 *   node scripts/cleanup-concept-evaluator-grants.js --execute --backend=postgres   # explicit override
 */

// Use the canonical env loader so quoting edge-cases in .env.local are
// handled the same way every dispatch-touching script handles them.
require('../lib/dataverse/client').loadEnvLocal();
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');
enterDynamicsBypassForScript('cleanup-concept-evaluator-grants');

const DRY = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
const backendArg = process.argv.find((a) => a.startsWith('--backend='));
const backendOverride = backendArg ? backendArg.split('=')[1] : 'dataverse';

if (!DRY && !EXECUTE) {
  console.error('Pass --dry-run or --execute. Refusing to run without an explicit mode.');
  process.exit(2);
}
if (!['dataverse', 'postgres'].includes(backendOverride)) {
  console.error(`--backend must be 'dataverse' or 'postgres' (got '${backendOverride}')`);
  process.exit(2);
}

// Force the dispatch wrapper to route to the requested backend regardless
// of .env.local. Default is dataverse — that's the active read backend in
// prod after the 2026-04-27 flag flip. Re-running with --backend=postgres
// is supported in case the local Postgres copy ever drifts back.
process.env.WAVE1_BACKEND_APP_ACCESS = backendOverride;

const APP_KEY = 'concept-evaluator';
const appAccess = require('../lib/services/app-access-service');

(async () => {
  console.log(`Backend in use: ${backendOverride}`);

  const allGrants = await appAccess.listAllGrantsForAdmin();
  const affected = allGrants.filter((g) => Array.isArray(g.apps) && g.apps.includes(APP_KEY));

  console.log(`Users with '${APP_KEY}' grant: ${affected.length}`);
  for (const u of affected) {
    console.log(`  user_profile_id=${u.user_profile_id} (${u.user_name || u.azure_email || '<unknown>'})`);
  }

  if (affected.length === 0) {
    console.log('Nothing to clean up. Exiting.');
    return;
  }

  if (DRY) {
    console.log(`\n--- DRY RUN ---`);
    console.log(`Would call revokeApps(profileId, ['${APP_KEY}']) for each of the ${affected.length} user(s) above.`);
    return;
  }

  let removed = 0;
  for (const u of affected) {
    try {
      const result = await appAccess.revokeApps(u.user_profile_id, [APP_KEY]);
      if (result?.revoked?.length) {
        console.log(`  ✓ revoked from profileId=${u.user_profile_id}`);
        removed += 1;
      } else {
        console.warn(`  ⚠ no grant returned for profileId=${u.user_profile_id} (already gone?)`);
      }
    } catch (err) {
      console.error(`  ✗ revoke failed for profileId=${u.user_profile_id}: ${err.message}`);
    }
  }

  console.log(`\n✓ Revoked ${removed}/${affected.length}.`);

  // Verify post-state
  const post = await appAccess.listAllGrantsForAdmin();
  const remaining = post.filter((g) => Array.isArray(g.apps) && g.apps.includes(APP_KEY));
  if (remaining.length !== 0) {
    console.error(`✗ Verification: ${remaining.length} user(s) still have the grant.`);
    process.exit(1);
  }
  console.log('✓ Verified: 0 users remain with the grant.');
})().catch((err) => {
  console.error('✗ Error:', err);
  process.exit(1);
});
