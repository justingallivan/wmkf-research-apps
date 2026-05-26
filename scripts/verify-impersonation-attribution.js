#!/usr/bin/env node
// One-off: confirm wmkf_ai_run rows from the impersonation prod-flag run
// were attributed to the impersonated staff user, not the app user.

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
  } catch (e) {}
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('verify-impersonation-attribution');

const RUN_NUMS = process.argv.slice(2);
if (!RUN_NUMS.length) {
  console.error('Usage: node scripts/verify-impersonation-attribution.js <runNum> [...runNum]');
  process.exit(1);
}

const filter = RUN_NUMS.map(n => `wmkf_ai_runnum eq '${n}'`).join(' or ');
const runs = await DynamicsService.queryRecords('wmkf_ai_runs', {
  select: 'wmkf_ai_runnum,createdon,wmkf_ai_model,wmkf_ai_notes,_createdby_value,_modifiedby_value,_owninguser_value',
  filter,
  orderby: 'createdon desc',
});

console.log(`Found ${runs.records.length} run(s):`);
const userIds = new Set();
for (const r of runs.records) {
  console.log('---');
  console.log('runNum:     ', r.wmkf_ai_runnum);
  console.log('createdon:  ', r.createdon);
  console.log('model:      ', r.wmkf_ai_model);
  console.log('notes:      ', r.wmkf_ai_notes);
  console.log('createdby:  ', r._createdby_value);
  console.log('modifiedby: ', r._modifiedby_value);
  console.log('owninguser: ', r._owninguser_value);
  if (r._createdby_value) userIds.add(r._createdby_value);
  if (r._modifiedby_value) userIds.add(r._modifiedby_value);
  if (r._owninguser_value) userIds.add(r._owninguser_value);
}

console.log('\nResolving systemusers:');
for (const id of userIds) {
  const u = await DynamicsService.queryRecords('systemusers', {
    select: 'systemuserid,fullname,internalemailaddress,applicationid',
    filter: `systemuserid eq ${id}`,
  });
  const row = u.records[0];
  if (row) {
    const tag = row.applicationid ? '[APP USER]' : '[STAFF]';
    console.log(`  ${tag} ${id} -> ${row.fullname} <${row.internalemailaddress || '(no email)'}>`);
  } else {
    console.log(`  ${id} -> (not found)`);
  }
}
