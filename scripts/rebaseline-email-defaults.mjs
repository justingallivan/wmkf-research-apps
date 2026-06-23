#!/usr/bin/env node
/**
 * rebaseline-email-defaults.mjs — one-off SAFE re-baseline of email-default settings
 * whose copy changed AFTER they were first seeded (removed request number, renamed
 * [proposal title clause] → [proposal]).
 *
 * SAFETY (default mode): for each catalog key it compares the live value to the seed.
 *   - equal               → already current, skip.
 *   - differs AND the live value still contains a REMOVED token ([requestNumber] or
 *     [proposal title clause]) → it is the un-edited old default → OVERWRITE with seed.
 *   - differs, no removed token → treated as an ADMIN EDIT → SKIP + warn (never clobber).
 *
 * --force-keys mode: a formatting-only seed change (e.g. greeting punctuation,
 * paragraph structure) leaves NO removed token in the live value, so default mode
 * treats it as an admin edit and skips it. To deliberately push such a change to
 * prod, name the keys (or `all`) to OVERWRITE from seed REGARDLESS of token state.
 * This CLOBBERS any genuine admin edits on those keys — use only when the seed is
 * the intended new source of truth.
 *   --force-keys=all                       # force every catalog key
 *   --force-keys=email.grantee_invite.body,email.reviewer_acceptance.body
 *
 * Dry-run by default; pass --execute to write. Same .env.local + script-bypass pattern.
 *   node scripts/rebaseline-email-defaults.mjs                          # dry-run (safe mode)
 *   node scripts/rebaseline-email-defaults.mjs --execute               # write (safe mode)
 *   node scripts/rebaseline-email-defaults.mjs --force-keys=all        # dry-run (force all)
 *   node scripts/rebaseline-email-defaults.mjs --force-keys=all --execute  # write (force all)
 */

import { parseForceKeys } from './lib/parse-force-keys.mjs';
import { EMAIL_DEFAULT_SEED_TEXT, loadEnvLocal } from './seed-email-defaults.mjs';

loadEnvLocal();

const EXECUTE = process.argv.includes('--execute');
const REMOVED_TOKENS = ['[requestNumber]', '[proposal title clause]'];

const { forceAll: FORCE_ALL, forceKeys: FORCE_KEYS } = (() => {
  try {
    return parseForceKeys(process.argv, Object.keys(EMAIL_DEFAULT_SEED_TEXT));
  } catch (e) {
    if (e?.code === 'UNKNOWN_FORCE_KEY') {
      console.error(`ERROR: --force-keys names an unknown catalog key: ${e.key}`);
      console.error(`Valid keys:\n  ${Object.keys(EMAIL_DEFAULT_SEED_TEXT).join('\n  ')}`);
      process.exit(1);
    }
    throw e;
  }
})();
function isForced(key) {
  return FORCE_ALL || FORCE_KEYS.has(key);
}

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
  const forced = isForced(key);
  const hasRemovedToken = REMOVED_TOKENS.some((t) => current.includes(t));
  if (!forced && !hasRemovedToken) {
    console.log(`SKIP  ${key}: differs from seed but has no removed token → treating as an admin edit (NOT clobbered)`);
    results.push({ key, action: 'skip-possible-edit' });
    continue;
  }

  const reason = forced && !hasRemovedToken ? 'FORCED (clobbers any admin edit)' : 'stale default';
  if (EXECUTE) {
    const ok = await setSetting(key, seedText, null);
    if (!ok) throw new Error(`Failed to write ${key}`);
    console.log(`UPDATE ${key}: ${reason} re-baselined (${seedText.length} chars)`);
    results.push({ key, action: forced ? 'forced' : 'updated' });
  } else {
    console.log(`DRY   ${key}: ${reason} → would re-baseline (${seedText.length} chars)`);
    results.push({ key, action: forced ? 'dry-forced' : 'dry-update' });
  }
}

const tally = results.reduce((acc, r) => { acc[r.action] = (acc[r.action] || 0) + 1; return acc; }, {});
console.log('\ndone:', JSON.stringify(tally));
process.exit(0);
