#!/usr/bin/env node
/**
 * rebaseline-email-defaults.mjs — one-off SAFE re-baseline of email-default settings
 * whose copy changed AFTER they were first seeded (removed request number, renamed
 * [proposal title clause] → [proposal]).
 *
 * SAFETY: for each catalog key it compares the live value to the current seed text.
 *   - equal               → already current, skip.
 *   - differs AND the live value still contains a REMOVED token ([requestNumber] or
 *     [proposal title clause]) → it is the un-edited old default → OVERWRITE with seed.
 *   - differs, no removed token → treated as an ADMIN EDIT → SKIP + warn (never clobber).
 *
 * Dry-run by default; pass --execute to write. Same .env.local + script-bypass pattern.
 *   node scripts/rebaseline-email-defaults.mjs            # dry-run
 *   node scripts/rebaseline-email-defaults.mjs --execute  # write
 */

import { EMAIL_DEFAULT_SEED_TEXT, loadEnvLocal } from './seed-email-defaults.mjs';

loadEnvLocal();

const EXECUTE = process.argv.includes('--execute');
const REMOVED_TOKENS = ['[requestNumber]', '[proposal title clause]'];

const { getSettingStrict, setSetting } = await import('../lib/services/settings-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('rebaseline-email-defaults');

console.log(`\n=== rebaseline-email-defaults — ${EXECUTE ? 'EXECUTE' : 'DRY RUN'} ===\n`);

const results = [];
for (const [key, seedText] of Object.entries(EMAIL_DEFAULT_SEED_TEXT)) {
  let current;
  try {
    const r = await getSettingStrict(key);
    current = r?.found ? String(r.value ?? '') : '';
  } catch (e) {
    console.log(`ERROR ${key}: strict read failed (${e.message}) — skipped`);
    results.push({ key, action: 'read-error' });
    continue;
  }

  if (current === seedText) {
    results.push({ key, action: 'already-current' });
    continue;
  }
  const hasRemovedToken = REMOVED_TOKENS.some((t) => current.includes(t));
  if (!hasRemovedToken) {
    console.log(`SKIP  ${key}: differs from seed but has no removed token → treating as an admin edit (NOT clobbered)`);
    results.push({ key, action: 'skip-possible-edit' });
    continue;
  }

  if (EXECUTE) {
    const ok = await setSetting(key, seedText, null);
    if (!ok) throw new Error(`Failed to write ${key}`);
    console.log(`UPDATE ${key}: stale default re-baselined (${seedText.length} chars)`);
    results.push({ key, action: 'updated' });
  } else {
    console.log(`DRY   ${key}: stale default → would re-baseline (${seedText.length} chars)`);
    results.push({ key, action: 'dry-update' });
  }
}

const tally = results.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {});
console.log('\ndone:', JSON.stringify(tally));
process.exit(0);
