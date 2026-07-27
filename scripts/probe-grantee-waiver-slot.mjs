#!/usr/bin/env node

/**
 * Post-seed / pre-deploy probe for the grantee-waiver policy slot.
 *
 * The grantee portal fails CLOSED on an unresolvable waiver policy (context +
 * submit both refuse). This probe is the rollout gate: run it AFTER seeding the
 * slot and BEFORE deploying the fail-closed portal code, and re-run it any time
 * to confirm the slot still resolves in the target environment. It exercises the
 * exact resolver the portal uses (getActivePolicy), so a green probe means the
 * portal will render/submit; a red probe means grantees would be blocked.
 *
 * READ-ONLY. Exit 0 = slot resolves; exit 1 = misconfigured; exit 2 = error.
 *   node scripts/probe-grantee-waiver-slot.mjs
 */

import fs from 'fs';
import { createHash } from 'crypto';
const env = fs.readFileSync('.env.local', 'utf8');
for (const line of env.split('\n')) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const SLOT = 'grantee-waiver';

const { getActivePolicy, invalidate } = await import('../lib/external/policy-fetcher.js');

(async () => {
  invalidate(SLOT); // never trust a warm cache for a provisioning probe
  let policy;
  try {
    policy = await getActivePolicy(SLOT);
  } catch (e) {
    console.error(`✗ ${SLOT} did NOT resolve — grantee portal would fail closed.`);
    console.error(`  reason: ${e?.message || e}`);
    process.exit(1);
  }

  console.log(`✓ ${SLOT} resolves.`);
  console.log(`  parent:        ${policy.parentDisplayName} (${policy.parentId})`);
  console.log(`  activeVersion: ${policy.versionLabel} (${policy.activeVersionId})`);
  console.log(`  title:         ${policy.title}`);
  console.log(`  effectiveDate: ${policy.effectiveDate || '(none)'}`);
  console.log(`  body chars:    ${(policy.body || '').length}`);
  if (!policy.activeVersionId || !(policy.body || '').trim()) {
    console.error('✗ resolved but missing active version id or body — misconfigured.');
    process.exit(1);
  }
  console.log(`  body sha256:   ${createHash('sha256').update(policy.body).digest('hex')}`);
  console.log('\n--- active policy body ---');
  console.log(policy.body);
  console.log('--- end active policy body ---');
  console.log('\nVERDICT: OK — active grantee waiver resolver is healthy.');
  process.exit(0);
})().catch((e) => { console.error('probe error:', e?.message || e); process.exit(2); });
