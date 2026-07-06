#!/usr/bin/env node
/**
 * End-to-end test for lib/services/dataverse-prefs-service.js.
 *
 * Exercises the full write/read/delete cycle through the service exactly as
 * application code would call it. Runs against sandbox.
 *
 * Uses Justin (pg id=2) as the test subject. All test preferences use keys
 * prefixed with 'test.svc.' so they're trivially distinguishable from real
 * data and safe to clean up.
 *
 *   set → get → assert roundtrip
 *   set encrypted → get masked → assert masked
 *   getDecryptedApiKey → assert plaintext recovered
 *   hasPreference true / false
 *   delete → assert absent
 *   overwrite (set twice) → assert latest value wins
 *   unmapped profile id=1 → assert all methods return safe defaults
 */

const { loadEnvLocal } = require('../lib/dataverse/client');
loadEnvLocal();
const { enterDynamicsBypassForScript } = require('../lib/services/dynamics-context');
enterDynamicsBypassForScript('test-dataverse-prefs-service');

const prefs = require('../lib/services/dataverse-prefs-service');

const JUSTIN = 2;
const TEST_USER_SKIPPED = 1; // 'skip' in identity map

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function cleanup() {
  for (const k of [
    'test.svc.plain',
    'test.svc.autoenc',       // matches ENCRYPTED_PREFERENCE_KEYS? no — forced via flag
    'api_key_claude.testsvc', // not a real app key but exercises the list
    'test.svc.overwrite',
    'test.svc.temp',
  ]) {
    await prefs.deleteUserPreference(JUSTIN, k);
  }
}

(async () => {
  console.log('dataverse-prefs-service test — sandbox, user=Justin (pg id=2)\n');

  await cleanup();

  // ── Basic set → get (non-encrypted) ──
  console.log('━━━ Non-encrypted roundtrip ━━━');
  const setPlain = await prefs.setUserPreference(JUSTIN, 'test.svc.plain', 'hello-world');
  record('setUserPreference returns true', setPlain === true);
  const getAll = await prefs.getUserPreferences(JUSTIN, true);
  record('getUserPreferences returns plaintext', getAll['test.svc.plain'] === 'hello-world');

  // ── Encrypted: force via explicit flag ──
  console.log('\n━━━ Encrypted roundtrip (explicit flag) ━━━');
  const secret = 'sk-test-secret-1234567890-abcdef';
  const setEnc = await prefs.setUserPreference(JUSTIN, 'test.svc.temp', secret, true);
  record('setUserPreference encrypted returns true', setEnc === true);

  const masked = await prefs.getUserPreferences(JUSTIN, false);
  const maskedValue = masked['test.svc.temp'];
  record(
    'getUserPreferences(false) returns masked value',
    typeof maskedValue === 'string' && maskedValue !== secret && /[•*]/.test(maskedValue),
    `got=${maskedValue}`,
  );

  const decrypted = await prefs.getUserPreferences(JUSTIN, true);
  record(
    'getUserPreferences(true) returns plaintext',
    decrypted['test.svc.temp'] === secret,
    decrypted['test.svc.temp'] !== secret ? `got=${decrypted['test.svc.temp']}` : null,
  );

  // ── Encrypted: auto-detect via ENCRYPTED_PREFERENCE_KEYS list ──
  console.log('\n━━━ Auto-detect encryption on well-known key ━━━');
  const apiKey = 'sk-ant-autoenc-test-value';
  // Use a test key name that is in ENCRYPTED_PREFERENCE_KEYS
  const autoKey = 'api_key_ncbi';
  // Preserve the user's real value if any
  const originalNcbi = await prefs.getDecryptedApiKey(JUSTIN, autoKey);
  await prefs.setUserPreference(JUSTIN, autoKey, apiKey); // no isEncrypted arg → auto-detect
  const roundtrip = await prefs.getDecryptedApiKey(JUSTIN, autoKey);
  record(
    'auto-detected encryption on api_key_ncbi',
    roundtrip === apiKey,
    roundtrip !== apiKey ? `got=${roundtrip}` : null,
  );
  // Restore original (may be null if user had none, in which case leave blank)
  if (originalNcbi) {
    await prefs.setUserPreference(JUSTIN, autoKey, originalNcbi);
  } else {
    await prefs.deleteUserPreference(JUSTIN, autoKey);
  }

  // ── hasPreference ──
  console.log('\n━━━ hasPreference ━━━');
  record(
    'hasPreference(set key) → true',
    (await prefs.hasPreference(JUSTIN, 'test.svc.plain')) === true,
  );
  record(
    'hasPreference(unknown) → false',
    (await prefs.hasPreference(JUSTIN, 'test.svc.never-set')) === false,
  );

  // ── Overwrite: same key twice, second value wins ──
  console.log('\n━━━ Overwrite ━━━');
  await prefs.setUserPreference(JUSTIN, 'test.svc.overwrite', 'first');
  await prefs.setUserPreference(JUSTIN, 'test.svc.overwrite', 'second');
  const afterOverwrite = await prefs.getUserPreferences(JUSTIN, true);
  record(
    'overwrite — latest value wins',
    afterOverwrite['test.svc.overwrite'] === 'second',
    `got=${afterOverwrite['test.svc.overwrite']}`,
  );

  // ── Delete ──
  console.log('\n━━━ Delete ━━━');
  await prefs.deleteUserPreference(JUSTIN, 'test.svc.plain');
  record(
    'deleteUserPreference → hasPreference returns false',
    (await prefs.hasPreference(JUSTIN, 'test.svc.plain')) === false,
  );
  record(
    'delete on absent key is idempotent',
    (await prefs.deleteUserPreference(JUSTIN, 'test.svc.plain')) === true,
  );

  // ── Unmapped profile (Test User, pg id=1) ──
  console.log('\n━━━ Unmapped profile (skip) ━━━');
  record(
    'getUserPreferences returns {} for skipped profile',
    Object.keys(await prefs.getUserPreferences(TEST_USER_SKIPPED, true)).length === 0,
  );
  record(
    'setUserPreference returns false for skipped profile',
    (await prefs.setUserPreference(TEST_USER_SKIPPED, 'test.svc.x', 'y')) === false,
  );
  record(
    'hasPreference returns false for skipped profile',
    (await prefs.hasPreference(TEST_USER_SKIPPED, 'test.svc.x')) === false,
  );

  // ── setUserPreferences bulk ──
  console.log('\n━━━ Bulk set ━━━');
  const bulkOk = await prefs.setUserPreferences(JUSTIN, {
    'test.svc.plain': 'bulk-a',
    'test.svc.overwrite': 'bulk-b',
  });
  record('setUserPreferences returns true', bulkOk === true);
  const afterBulk = await prefs.getUserPreferences(JUSTIN, true);
  record(
    'bulk set — both values stored',
    afterBulk['test.svc.plain'] === 'bulk-a' && afterBulk['test.svc.overwrite'] === 'bulk-b',
  );

  await cleanup();

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
