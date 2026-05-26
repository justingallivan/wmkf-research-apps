#!/usr/bin/env node

/**
 * Reconcile user_profiles.dynamics_systemuser_id by matching
 * azure_email → systemuser.internalemailaddress.
 *
 * Usage:
 *   node scripts/reconcile-dynamics-identities.js              # default: stale (>30d) + null
 *   node scripts/reconcile-dynamics-identities.js --all         # full backfill (every active profile)
 *   node scripts/reconcile-dynamics-identities.js --stale 7    # custom staleness window in days
 *   node scripts/reconcile-dynamics-identities.js --profile 12 # single profile
 *
 * Read-only against Dynamics (queries systemusers); writes only to Postgres.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}

const { reconcileProfile, reconcileBatch } = await import('../lib/services/dynamics-identity-service.js');
const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('reconcile-dynamics-identities');

const args = process.argv.slice(2);
const allFlag = args.includes('--all');
const staleIdx = args.indexOf('--stale');
const staleDays = staleIdx !== -1 ? Number(args[staleIdx + 1]) : 30;
const profileIdx = args.indexOf('--profile');
const singleProfileId = profileIdx !== -1 ? Number(args[profileIdx + 1]) : null;

function fmt(r) {
  const tag = r.fullname ? ` → ${r.fullname}` : '';
  const id = r.systemuserid ? ` [${r.systemuserid}]` : '';
  const err = r.error ? ` (${r.error})` : '';
  return `  profile #${r.profileId}: ${r.result}${tag}${id}${err}`;
}

try {
  if (singleProfileId) {
    console.log(`Reconciling profile #${singleProfileId}...\n`);
    const r = await reconcileProfile(singleProfileId, { silent: true });
    console.log(fmt(r));
    process.exit(r.result === 'error' ? 1 : 0);
  }

  const mode = allFlag ? 'full backfill (all active)' : `stale (>${staleDays}d) + null`;
  console.log(`Reconciling Dynamics identities — mode: ${mode}\n`);

  const { totalScanned, summary, results } = await reconcileBatch({
    staleDays,
    includeNull: true,
    includeAll: allFlag,
  });

  for (const r of results) console.log(fmt(r));

  console.log(`\nScanned ${totalScanned} profile(s):`);
  for (const [k, v] of Object.entries(summary)) {
    if (v > 0) console.log(`  ${k.padEnd(20)} ${v}`);
  }
  console.log();
} catch (error) {
  console.error('\n✗ Reconciliation failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
