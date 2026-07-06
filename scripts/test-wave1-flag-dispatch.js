#!/usr/bin/env node
/**
 * Verify that DatabaseService (and eventually the app-access / settings
 * wrappers) return identical results for the same operations regardless of
 * the WAVE1_BACKEND_* flag.
 *
 * Approach: for each method pair, invoke twice — once with the flag
 * pointed at postgres, once at dataverse. Compare outputs.
 *
 * Prefs are the only table wired in this pass. app-access + settings tests
 * will go here as their wiring lands.
 *
 * Test subject: Justin (pg id=2). Uses test-only keys so nothing mutates
 * real data.
 */

const { loadEnvLocal } = require('../lib/dataverse/client');
loadEnvLocal();
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');
enterDynamicsBypassForScript('test-wave1-flag-dispatch');

// Must set the flag BEFORE requiring DatabaseService so the lazy loader
// captures the right thing — except actually the dispatch is at call time,
// not require time, so we can flip the env var per test.
const { DatabaseService } = require('../lib/services/database-service');
const appAccess = require('../lib/services/app-access-service');
const settings = require('../lib/services/settings-service');

const JUSTIN = 2;
const KEVIN = 3;

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function withBackend(flagName, backend, fn) {
  const prev = process.env[flagName];
  process.env[flagName] = backend;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env[flagName];
    else process.env[flagName] = prev;
  }
}

// Back-compat shim for existing prefs tests
async function withPrefsBackend(backend, fn) {
  return withBackend('WAVE1_BACKEND_PREFS', backend, fn);
}

async function withAppAccessBackend(backend, fn) {
  return withBackend('WAVE1_BACKEND_APP_ACCESS', backend, fn);
}

async function withSettingsBackend(backend, fn) {
  return withBackend('WAVE1_BACKEND_SETTINGS', backend, fn);
}

async function cleanupBoth() {
  // Clean up test keys on both backends so rerun is safe.
  for (const backend of ['postgres', 'dataverse']) {
    await withPrefsBackend(backend, async () => {
      for (const key of ['test.flag.plain', 'test.flag.encrypted', 'test.flag.temp']) {
        await DatabaseService.deleteUserPreference(JUSTIN, key);
      }
    });
  }
}

(async () => {
  console.log('Wave 1 flag-dispatch integration test — prefs only for now\n');
  await cleanupBoth();

  // ── Read parity: listing Justin's prefs via both backends ──
  console.log('━━━ Read parity: DatabaseService.getUserPreferences ━━━');
  const pgPrefs = await withPrefsBackend('postgres', () => DatabaseService.getUserPreferences(JUSTIN, true));
  const dvPrefs = await withPrefsBackend('dataverse', () => DatabaseService.getUserPreferences(JUSTIN, true));

  const pgKeys = new Set(Object.keys(pgPrefs));
  const dvKeys = new Set(Object.keys(dvPrefs));
  record(
    `key sets match (${pgKeys.size} pg, ${dvKeys.size} dv)`,
    pgKeys.size === dvKeys.size && [...pgKeys].every((k) => dvKeys.has(k)),
    pgKeys.size === dvKeys.size ? null : `pg-only=[${[...pgKeys].filter(k=>!dvKeys.has(k))}] dv-only=[${[...dvKeys].filter(k=>!pgKeys.has(k))}]`,
  );

  let valuesMatch = true;
  for (const k of pgKeys) {
    if (dvPrefs[k] !== pgPrefs[k]) valuesMatch = false;
  }
  record('decrypted values match for every key', valuesMatch);

  // ── Write-then-read through each backend ──
  console.log('\n━━━ Write parity: setUserPreference + read back ━━━');
  for (const backend of ['postgres', 'dataverse']) {
    await withPrefsBackend(backend, async () => {
      const ok = await DatabaseService.setUserPreference(JUSTIN, 'test.flag.plain', `hello-${backend}`);
      record(`[${backend}] setUserPreference returns true`, ok === true);
      const v = await DatabaseService.getDecryptedApiKey(JUSTIN, 'test.flag.plain');
      record(`[${backend}] getDecryptedApiKey returns written value`, v === `hello-${backend}`, `got=${v}`);
      const has = await DatabaseService.hasPreference(JUSTIN, 'test.flag.plain');
      record(`[${backend}] hasPreference returns true`, has === true);
    });
  }

  // ── Cross-backend: write via pg, read via dv (should both see the postgres row) ──
  // Note: the row in DV was NOT synced (this is a test-only key). So DV won't see it.
  // This documents the limitation: cross-backend visibility requires the sync script
  // or a dual-write layer. For cutover planning, we do the sync immediately before
  // flipping the flag — no cross-backend period.
  console.log('\n━━━ Cross-backend visibility (documented limitation) ━━━');
  await cleanupBoth();
  await withPrefsBackend('postgres', () => DatabaseService.setUserPreference(JUSTIN, 'test.flag.temp', 'pg-only'));
  const seenFromDv = await withPrefsBackend('dataverse', () => DatabaseService.getDecryptedApiKey(JUSTIN, 'test.flag.temp'));
  record(
    'write via postgres is NOT visible via dataverse (expected — separate storage)',
    seenFromDv === null,
    `got=${seenFromDv}`,
  );

  // ── Encryption parity: write encrypted via each backend, read back ──
  console.log('\n━━━ Encryption parity ━━━');
  const SECRET = 'sk-flag-test-secret-0987654321';
  for (const backend of ['postgres', 'dataverse']) {
    await withPrefsBackend(backend, async () => {
      await DatabaseService.setUserPreference(JUSTIN, 'test.flag.encrypted', SECRET, true);
      const plaintext = await DatabaseService.getDecryptedApiKey(JUSTIN, 'test.flag.encrypted');
      record(`[${backend}] encrypted roundtrip`, plaintext === SECRET, `got=${plaintext}`);
      const masked = (await DatabaseService.getUserPreferences(JUSTIN, false))['test.flag.encrypted'];
      record(`[${backend}] masked read returns mask`, typeof masked === 'string' && masked !== SECRET && /[•*]/.test(masked), `got=${masked}`);
    });
  }

  await cleanupBoth();

  // ── App-access parity ──
  console.log('\n━━━ App-access parity: listAppKeysForUser (Justin) ━━━');
  const pgApps = await withAppAccessBackend('postgres', () => appAccess.listAppKeysForUser(JUSTIN));
  const dvApps = await withAppAccessBackend('dataverse', () => appAccess.listAppKeysForUser(JUSTIN));
  record(
    `Justin's app grants match across backends (${pgApps.length} apps)`,
    pgApps.length === dvApps.length && pgApps.every((k, i) => k === dvApps[i]),
    pgApps.length === dvApps.length ? null : `pg=${pgApps.length} dv=${dvApps.length}`,
  );

  console.log('\n━━━ App-access parity: listAllGrantsForAdmin shape ━━━');
  const pgAdmin = await withAppAccessBackend('postgres', () => appAccess.listAllGrantsForAdmin());
  const dvAdmin = await withAppAccessBackend('dataverse', () => appAccess.listAllGrantsForAdmin());
  record(
    `admin view user count matches (${pgAdmin.length} pg, ${dvAdmin.length} dv)`,
    pgAdmin.length === dvAdmin.length,
  );

  // Compare Justin's apps in the admin view specifically
  const pgJustin = pgAdmin.find((u) => u.user_profile_id === JUSTIN);
  const dvJustin = dvAdmin.find((u) => u.user_profile_id === JUSTIN);
  record(
    'admin view: Justin present on both sides',
    pgJustin && dvJustin,
  );
  if (pgJustin && dvJustin) {
    const pgSorted = [...pgJustin.apps].sort();
    const dvSorted = [...dvJustin.apps].sort();
    record(
      `admin view: Justin's apps match (${pgSorted.length} each)`,
      pgSorted.length === dvSorted.length && pgSorted.every((k, i) => k === dvSorted[i]),
    );
  }

  console.log('\n━━━ App-access parity: grant + revoke (Kevin) ━━━');
  const TEST_APPS = ['literature-analyzer']; // Kevin doesn't have this one
  for (const backend of ['postgres', 'dataverse']) {
    await withAppAccessBackend(backend, async () => {
      // Ensure clean state for this backend
      await appAccess.revokeApps(KEVIN, TEST_APPS);

      const grant = await appAccess.grantApps(KEVIN, TEST_APPS, JUSTIN);
      record(
        `[${backend}] grantApps returned granted=[${TEST_APPS[0]}]`,
        grant.granted.includes(TEST_APPS[0]),
      );
      const after = await appAccess.listAppKeysForUser(KEVIN);
      record(
        `[${backend}] Kevin now has the granted app`,
        after.includes(TEST_APPS[0]),
      );
      const regrant = await appAccess.grantApps(KEVIN, TEST_APPS, JUSTIN);
      record(
        `[${backend}] regrant is idempotent`,
        regrant.granted.length === 0,
      );
      const revoke = await appAccess.revokeApps(KEVIN, TEST_APPS);
      record(
        `[${backend}] revokeApps returned revoked=[${TEST_APPS[0]}]`,
        revoke.revoked.includes(TEST_APPS[0]),
      );
    });
  }

  // ── Settings parity ──
  console.log('\n━━━ Settings parity: listSettings(model_override:) ━━━');
  const pgModels = await withSettingsBackend('postgres', () => settings.listSettings('model_override:'));
  const dvModels = await withSettingsBackend('dataverse', () => settings.listSettings('model_override:'));
  const pgModelKeys = Object.keys(pgModels).sort();
  const dvModelKeys = Object.keys(dvModels).sort();
  record(
    `model_override keys match (${pgModelKeys.length} each)`,
    pgModelKeys.length === dvModelKeys.length && pgModelKeys.every((k, i) => k === dvModelKeys[i]),
  );
  let settingsValuesMatch = true;
  for (const k of pgModelKeys) {
    if (pgModels[k] !== dvModels[k]) settingsValuesMatch = false;
  }
  record('model_override values match for every key', settingsValuesMatch);

  console.log('\n━━━ Settings parity: set + get + delete ━━━');
  const TEST_KEY = 'test.flag.setting';
  for (const backend of ['postgres', 'dataverse']) {
    await withSettingsBackend(backend, async () => {
      await settings.deleteSetting(TEST_KEY);
      const setOk = await settings.setSetting(TEST_KEY, `value-${backend}`, JUSTIN);
      record(`[${backend}] setSetting returns true`, setOk === true);
      const got = await settings.getSetting(TEST_KEY);
      record(`[${backend}] getSetting returns the written value`, got === `value-${backend}`, `got=${got}`);
      await settings.deleteSetting(TEST_KEY);
      const gotAfterDelete = await settings.getSetting(TEST_KEY);
      record(`[${backend}] delete removes value`, gotAfterDelete === null);
    });
  }

  console.log('\n━━━ Settings parity: listSettingsWithMeta has updatedAt ━━━');
  for (const backend of ['postgres', 'dataverse']) {
    await withSettingsBackend(backend, async () => {
      const meta = await settings.listSettingsWithMeta('model_override:');
      const firstKey = Object.keys(meta)[0];
      record(
        `[${backend}] listSettingsWithMeta returns { value, updatedAt }`,
        meta[firstKey] && 'value' in meta[firstKey] && 'updatedAt' in meta[firstKey],
      );
    });
  }

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
