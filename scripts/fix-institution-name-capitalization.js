#!/usr/bin/env node
/**
 * One-off: lower-case minor words ("For", "Of", "And", "In") in six Research
 * Program applicant accounts whose `akoya_aka` (what Phase II writeups render
 * as DV:InstitutionName — lib/services/pre-site-visit/proposal-core-service.js)
 * and `name` carry title-cased minor words. Found by a read-only scan on
 * 2026-10-08; NOT yet approved — confirm with the database maintainers first.
 *
 * Capitalization only: no other wording (Inc, punctuation) is changed.
 *
 * Safety:
 *   - Dry-run by default; --commit to write.
 *   - Each field is patched only if its live value still equals the exact
 *     `from` value below; anything else is reported and skipped.
 *   - Writes go through DynamicsService, so the Dataverse target interlock
 *     applies. Running against production from a laptop needs both
 *       DATAVERSE_ALLOW_PROD_READS=yes
 *       DATAVERSE_PROD_WRITE_ACK="<purpose> <today's UTC date YYYY-MM-DD>"
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/fix-institution-name-capitalization.js
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_PROD_WRITE_ACK="institution capitalization 2026-10-08" \
 *     node scripts/fix-institution-name-capitalization.js --commit
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim().replace(/^"(.*)"$/, '$1');
    if (!process.env[k]) process.env[k] = v;
  }
}

const COMMIT = process.argv.includes('--commit');

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const FIXES = [
  {
    accountid: '4ed01d17-f12f-ef11-840a-000d3a31a7f3',
    name: { from: 'Bigelow Laboratory For Ocean Sciences', to: 'Bigelow Laboratory for Ocean Sciences' },
    akoya_aka: { from: 'Bigelow Laboratory For Ocean Sciences', to: 'Bigelow Laboratory for Ocean Sciences' },
  },
  {
    accountid: 'd78da502-2472-f011-bec2-6045bd02b4cc',
    name: { from: 'Foundation For Applied Molecular Evolution Inc', to: 'Foundation for Applied Molecular Evolution Inc' },
    akoya_aka: { from: 'Foundation For Applied Molecular Evolution Inc', to: 'Foundation for Applied Molecular Evolution Inc' },
  },
  {
    accountid: 'f271380a-ab77-f011-b4cb-6045bd02b4cc',
    name: { from: 'Magee-Womens Research Institute And Foundation', to: 'Magee-Womens Research Institute and Foundation' },
    akoya_aka: { from: 'Magee-Womens Research Institute And Foundation', to: 'Magee-Womens Research Institute and Foundation' },
  },
  {
    accountid: '918d17a9-d507-ef11-9f89-000d3a32c1ae',
    name: { from: 'Morgridge Institute For Research Inc.', to: 'Morgridge Institute for Research Inc.' },
    akoya_aka: { from: 'Morgridge Institute For Research', to: 'Morgridge Institute for Research' },
  },
  {
    accountid: 'ce151d23-7bb6-f011-bbd3-6045bd0510d4',
    name: { from: 'The University Of Alabama In Huntsville', to: 'The University of Alabama in Huntsville' },
    akoya_aka: { from: 'University Of Alabama In Huntsville', to: 'University of Alabama in Huntsville' },
  },
  {
    accountid: 'c5b96146-6b62-f011-bec3-6045bd0510d4',
    name: { from: 'University Of Wisconsin - Milwaukee', to: 'University of Wisconsin - Milwaukee' },
    akoya_aka: { from: 'University Of Wisconsin - Milwaukee', to: 'University of Wisconsin - Milwaukee' },
  },
];

const FIELDS = ['name', 'akoya_aka'];
let patched = 0, skipped = 0, already = 0, failed = 0;

await bypassDynamicsRestrictions('fix-institution-name-capitalization', async () => {
  for (const fix of FIXES) {
    const live = await DynamicsService.getRecord('accounts', fix.accountid, { select: FIELDS.join(',') });
    const payload = {};
    for (const field of FIELDS) {
      const { from, to } = fix[field];
      const current = live[field] ?? '';
      if (current === to) { already++; console.log(`  = ${fix.accountid} ${field}: already "${to}"`); continue; }
      if (current !== from) { skipped++; console.log(`  ! ${fix.accountid} ${field}: live value "${current}" ≠ expected "${from}" — skipped`); continue; }
      payload[field] = to;
      console.log(`  ${COMMIT ? '→' : '?'} ${fix.accountid} ${field}: "${from}" → "${to}"`);
    }
    if (!Object.keys(payload).length || !COMMIT) continue;
    try {
      await DynamicsService.updateRecord('accounts', fix.accountid, payload);
      patched += Object.keys(payload).length;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${fix.accountid}: ${err.message}`);
    }
  }
});

console.log(`\nfields patched=${patched} already-correct=${already} skipped=${skipped} failed-accounts=${failed}`);
if (!COMMIT) console.log('DRY-RUN — re-run with --commit to apply.');
if (failed) process.exit(1);
