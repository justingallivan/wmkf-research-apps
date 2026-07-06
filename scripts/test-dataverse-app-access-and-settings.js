#!/usr/bin/env node
/**
 * End-to-end tests for dataverse-app-access-service and
 * dataverse-settings-service against sandbox.
 *
 * Test subject: Kevin Moses (pg id=3) for app-access — keeps Justin's grants
 * untouched. Test subject for settings: 'test.settings.*' keyspace.
 *
 * Every write is undone at the end; safe to rerun.
 */

const { loadEnvLocal } = require('../lib/dataverse/client');
loadEnvLocal();
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');
enterDynamicsBypassForScript('test-dataverse-app-access-and-settings');

const appAccess = require('../lib/services/dataverse-app-access-service');
const settings = require('../lib/services/dataverse-settings-service');

const KEVIN = 3;
const JUSTIN = 2;
const TEST_USER_SKIPPED = 1;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// Two arbitrary app keys for grant/revoke round-trip testing. The test
// is about the dispatch path, not these specific apps. Pick two that
// exist in APP_REGISTRY today.
const TEST_APPS = ['literature-analyzer', 'expense-reporter'];

async function cleanupAppAccess() {
  await appAccess.revokeApps(KEVIN, TEST_APPS);
}

async function cleanupSettings() {
  for (const k of ['test.settings.a', 'test.settings.b', 'test.settings.c']) {
    await settings.deleteSetting(k);
  }
}

(async () => {
  console.log('dataverse-app-access + settings tests — sandbox\n');

  await cleanupAppAccess();
  await cleanupSettings();

  // ── App access ──
  console.log('━━━ App access: listAppKeysForUser ━━━');
  const justinGrants = await appAccess.listAppKeysForUser(JUSTIN);
  record(
    'Justin has real migrated grants (>10 apps)',
    justinGrants.length >= 10,
    `got ${justinGrants.length}`,
  );
  record(
    'dynamics-explorer is in Justin\'s grants',
    justinGrants.includes('dynamics-explorer'),
  );
  record(
    'listAppKeysForUser returns [] for unmapped profile',
    (await appAccess.listAppKeysForUser(TEST_USER_SKIPPED)).length === 0,
  );

  console.log('\n━━━ App access: grant + revoke ━━━');
  const kevinBefore = await appAccess.listAppKeysForUser(KEVIN);
  const kevinHasNone = TEST_APPS.every((k) => !kevinBefore.includes(k));
  record('Kevin starts without test apps', kevinHasNone);

  const grantRes = await appAccess.grantApps(KEVIN, TEST_APPS, JUSTIN);
  record(
    'grantApps returns granted=[both]',
    grantRes.granted.length === 2 && !grantRes.error,
    `granted=[${grantRes.granted}] error=${grantRes.error || 'none'}`,
  );

  const kevinAfter = await appAccess.listAppKeysForUser(KEVIN);
  record(
    'Kevin now has both test apps',
    TEST_APPS.every((k) => kevinAfter.includes(k)),
    `kevin=[${kevinAfter.join(', ')}]`,
  );

  // Idempotent re-grant
  const regrant = await appAccess.grantApps(KEVIN, TEST_APPS, JUSTIN);
  record(
    'regrant is idempotent (granted=[])',
    regrant.granted.length === 0,
    `granted=[${regrant.granted}]`,
  );

  const revokeRes = await appAccess.revokeApps(KEVIN, TEST_APPS);
  record(
    'revokeApps returns revoked=[both]',
    revokeRes.revoked.length === 2,
    `revoked=[${revokeRes.revoked}]`,
  );
  const kevinFinal = await appAccess.listAppKeysForUser(KEVIN);
  record(
    'Kevin no longer has test apps',
    TEST_APPS.every((k) => !kevinFinal.includes(k)),
  );

  // Idempotent re-revoke
  const rerevoke = await appAccess.revokeApps(KEVIN, TEST_APPS);
  record(
    'rerevoke is idempotent (revoked=[])',
    rerevoke.revoked.length === 0,
  );

  console.log('\n━━━ App access: admin view (all users) ━━━');
  const all = await appAccess.listAllGrantsForAdmin();
  record(
    'listAllGrantsForAdmin returns shape [{ user_profile_id, user_name, apps }]',
    Array.isArray(all) && all.length > 0 && all[0].user_profile_id != null && Array.isArray(all[0].apps),
    `${all.length} user(s) returned`,
  );
  const justinEntry = all.find((u) => u.user_profile_id === JUSTIN);
  record(
    'Justin appears in admin view with his apps',
    justinEntry && justinEntry.apps.length >= 10,
    justinEntry ? `apps=${justinEntry.apps.length}` : 'not found',
  );

  // ── Settings ──
  console.log('\n━━━ Settings: set + get ━━━');
  const setA = await settings.setSetting('test.settings.a', 'value-a', JUSTIN);
  record('setSetting(new) returns true', setA === true);
  record(
    'getSetting returns the value',
    (await settings.getSetting('test.settings.a')) === 'value-a',
  );
  record(
    'getSetting(missing) returns null',
    (await settings.getSetting('test.settings.never-set')) === null,
  );

  console.log('\n━━━ Settings: upsert ━━━');
  await settings.setSetting('test.settings.a', 'value-a-updated', JUSTIN);
  record(
    'upsert updates existing value',
    (await settings.getSetting('test.settings.a')) === 'value-a-updated',
  );

  console.log('\n━━━ Settings: listSettings with prefix ━━━');
  await settings.setSetting('test.settings.b', 'value-b', JUSTIN);
  await settings.setSetting('test.settings.c', 'value-c', null); // no updatedBy
  const listed = await settings.listSettings('test.settings.');
  record(
    'listSettings returns all 3 test keys',
    Object.keys(listed).length === 3
      && listed['test.settings.a'] === 'value-a-updated'
      && listed['test.settings.b'] === 'value-b'
      && listed['test.settings.c'] === 'value-c',
    `got ${Object.keys(listed).length} keys`,
  );

  console.log('\n━━━ Settings: existing data reads ━━━');
  const overrides = await settings.listSettings('model_override:');
  record(
    'listSettings(model_override:) returns migrated overrides (>20 entries)',
    Object.keys(overrides).length >= 20,
    `got ${Object.keys(overrides).length} entries`,
  );

  console.log('\n━━━ Settings: delete ━━━');
  await settings.deleteSetting('test.settings.a');
  record(
    'deleteSetting removes the row',
    (await settings.getSetting('test.settings.a')) === null,
  );
  record(
    'delete on absent key is idempotent',
    (await settings.deleteSetting('test.settings.a')) === true,
  );

  await cleanupSettings();

  console.log('\n═══ Summary ═══');
  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(`\nFATAL: ${e.message}`);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
