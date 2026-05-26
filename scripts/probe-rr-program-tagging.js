#!/usr/bin/env node
// Probe whether akoya_program 'RR' (Research Reviewer) is used to tag contacts.
// Three checks:
//   1. Does the RR program row exist? Get its GUID + populated count.
//   2. Are any contacts associated with RR (via known FKs)?
//   3. What is the relationship shape? (e.g., 1:N program → contact, M:N, etc.)

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
enterDynamicsBypassForScript('probe-rr-program');

console.log('\n=== 1. Find akoya_program rows matching "Reviewer" or "RR" ===');
const programs = await DynamicsService.queryRecords('akoya_programs', {
  select: 'akoya_programid,akoya_program,wmkf_code,statecode',
  filter: `contains(akoya_program,'Reviewer') or wmkf_code eq 'RR'`,
  top: 10,
});
for (const p of programs.records) {
  console.log(JSON.stringify(p, null, 2));
}

if (!programs.records.length) {
  console.log('No matching program found. Listing all program codes for context:');
  const all = await DynamicsService.queryRecords('akoya_programs', {
    select: 'akoya_program,wmkf_code,statecode',
    top: 50,
    orderby: 'wmkf_code',
  });
  for (const p of all.records) {
    console.log(`  ${p.wmkf_code || '(no code)'}\t${p.akoya_program}\t${p.statecode === 0 ? 'active' : 'inactive'}`);
  }
  process.exit(0);
}

const rrProgram = programs.records[0];
const rrId = rrProgram.akoya_programid;
console.log(`\nUsing RR program GUID: ${rrId}`);

console.log('\n=== 2. Probe relationships from contact → akoya_program ===');
// Try common patterns for program tagging on contact
const candidateFields = [
  '_akoya_program_value',
  '_akoya_primaryprogram_value',
  '_wmkf_program_value',
  '_wmkf_programid_value',
  '_wmkf_reviewerprogram_value',
];

for (const field of candidateFields) {
  try {
    const r = await DynamicsService.queryRecords('contacts', {
      select: 'contactid',
      filter: `${field} eq ${rrId}`,
      top: 1,
      count: true,
    });
    console.log(`  ${field}: count=${r.count ?? r.records.length}`);
  } catch (e) {
    console.log(`  ${field}: NOT A FIELD ON contact (${e.message.slice(0, 60)})`);
  }
}

console.log('\n=== 3. Probe akoya_request.akoya_program for RR usage ===');
try {
  const reqs = await DynamicsService.queryRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
    filter: `_akoya_program_value eq ${rrId}`,
    top: 5,
    orderby: 'createdon desc',
    count: true,
  });
  console.log(`  Requests with akoya_program=RR: count=${reqs.count ?? reqs.records.length}`);
  for (const r of reqs.records) {
    console.log(`    ${r.akoya_requestnum}\tmeetingdate=${r.wmkf_meetingdate || '(none)'}`);
  }
} catch (e) {
  console.log(`  ERR: ${e.message.slice(0, 100)}`);
}

console.log('\n=== 4. Check for an N:N relationship between contact and program ===');
// Common N:N table names in Dataverse for relating contact to akoya_program
const candidateNN = [
  'akoya_contact_akoya_program',
  'wmkf_contact_akoya_program',
  'akoya_program_contact',
];
for (const nn of candidateNN) {
  try {
    const r = await DynamicsService.queryRecords(nn, { select: '*', top: 1 });
    console.log(`  ${nn}: EXISTS, sample=${JSON.stringify(r.records[0] || {})}`);
  } catch (e) {
    console.log(`  ${nn}: not present (${e.message.slice(0, 50)})`);
  }
}
