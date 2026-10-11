#!/usr/bin/env node
/**
 * One-off: lower-case title-cased minor words ("Of", "For", "And", "In",
 * "The", "At", "On") after the first word of the `name` and `akoya_aka` of
 * every account that has applied to a Research Program (RESEARCH_PROGRAM_IDS).
 * Phase II writeups render `akoya_aka` (falling back to `name`) as
 * DV:InstitutionName — lib/services/pre-site-visit/proposal-core-service.js.
 * A 2026-10-08 read-only scan found 40 such accounts; the owner's colleagues
 * approved fixing all of them on 2026-10-09.
 *
 * Capitalization only: no other wording, punctuation, dashes, or `&amp;`
 * entities are changed. Review the dry-run list before committing.
 *
 * Safety:
 *   - Dry-run by default; --commit to write.
 *   - Accounts are discovered live; each field is re-read immediately before
 *     patching and patched only if it still equals the discovered value.
 *   - Writes go through DynamicsService, so the Dataverse target interlock
 *     applies. Running against production from a laptop needs both
 *       DATAVERSE_ALLOW_PROD_READS=yes
 *       DATAVERSE_PROD_WRITE_ACK="<purpose> <today's UTC date YYYY-MM-DD>"
 *
 * Usage:
 *   DATAVERSE_ALLOW_PROD_READS=yes node scripts/fix-institution-name-capitalization.js
 *   DATAVERSE_ALLOW_PROD_READS=yes DATAVERSE_PROD_WRITE_ACK="institution capitalization 2026-10-09" \
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
const { RESEARCH_PROGRAM_IDS } = await import('../shared/config/researchPrograms.js');

const FIELDS = ['name', 'akoya_aka'];
const MINOR_WORDS = new Set(['Of', 'For', 'And', 'In', 'The', 'At', 'On']);

// Owner-reviewed exceptions to the rule (2026-10-09): exact `name` value →
// replacement. Rutgers keeps its official capital "The"; Temple keeps its
// legal "–Of The"; Notre Dame takes its official lower-case "du".
const NAME_OVERRIDES = new Map([
  ['Rutgers, The State University of New Jersey', 'Rutgers, The State University of New Jersey'],
  ['Temple University-Of The Commonwealth System Of Higher Education', 'Temple University-Of The Commonwealth System of Higher Education'],
  ['Temple University-Of The Commonwealth System of Higher Education', 'Temple University-Of The Commonwealth System of Higher Education'],
  ['University Of Notre Dame Du Lac', 'University of Notre Dame du Lac'],
]);

// Lower-case exact title-case minor words after the first word; all other
// tokens (and the whitespace between them) are kept byte-for-byte.
function fixCase(value) {
  let seenWord = false;
  return value.split(/(\s+)/).map((token) => {
    if (!token || /^\s+$/.test(token)) return token;
    const out = seenWord && MINOR_WORDS.has(token) ? token.toLowerCase() : token;
    if (/[A-Za-z]/.test(token)) seenWord = true;
    return out;
  }).join('');
}

function requireComplete(result, label) {
  if (result?.capped) throw new Error(`${label} reached Dataverse's pagination limit.`);
  if (!Array.isArray(result?.records)) throw new Error(`${label} did not return a complete record set.`);
  return result.records;
}

let patched = 0, skipped = 0, failed = 0;

await bypassDynamicsRestrictions('fix-institution-name-capitalization', async () => {
  const programFilter = RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ');
  // More than queryAllRecords' 5000-row cap: page by request id (keyset).
  const requests = [];
  for (let lastId = null; ;) {
    const result = await DynamicsService.queryAllRecords('akoya_requests', {
      select: 'akoya_requestid,_akoya_applicantid_value',
      filter: `(${programFilter})${lastId ? ` and akoya_requestid gt ${lastId}` : ''}`,
      orderby: 'akoya_requestid asc',
    });
    if (!Array.isArray(result?.records)) throw new Error('Research Program request scan did not return a record set.');
    requests.push(...result.records);
    if (!result.capped) break;
    lastId = result.records.at(-1).akoya_requestid;
  }
  if (new Set(requests.map((r) => r.akoya_requestid)).size !== requests.length) throw new Error('Request scan returned duplicate rows.');
  const applicantIds = [...new Set(requests.map((r) => r._akoya_applicantid_value).filter(Boolean).map((id) => id.toLowerCase()))];

  const accounts = [];
  for (let i = 0; i < applicantIds.length; i += 20) {
    const chunk = applicantIds.slice(i, i + 20);
    accounts.push(...requireComplete(await DynamicsService.queryAllRecords('accounts', {
      select: `accountid,${FIELDS.join(',')}`,
      filter: `(${chunk.map((id) => `accountid eq ${id}`).join(' or ')})`,
    }), 'Applicant account scan'));
  }
  console.log(`Scanned ${requests.length} Research Program requests → ${applicantIds.length} applicant ids → ${accounts.length} accounts.\n`);

  const fixes = [];
  for (const account of accounts) {
    const fix = { accountid: account.accountid };
    for (const field of FIELDS) {
      const from = account[field];
      if (typeof from !== 'string') continue;
      const to = NAME_OVERRIDES.get(from) ?? fixCase(from);
      if (to !== from) fix[field] = { from, to };
    }
    if (fix.name || fix.akoya_aka) fixes.push(fix);
  }
  fixes.sort((a, b) => (a.name?.from ?? a.akoya_aka.from).localeCompare(b.name?.from ?? b.akoya_aka.from));

  for (const fix of fixes) {
    const fields = FIELDS.filter((field) => fix[field]);
    const live = COMMIT ? await DynamicsService.getRecord('accounts', fix.accountid, { select: fields.join(',') }) : null;
    const payload = {};
    for (const field of fields) {
      const { from, to } = fix[field];
      if (live && (live[field] ?? '') !== from) { skipped++; console.log(`  ! ${fix.accountid} ${field}: changed to "${live[field]}" since scan — skipped`); continue; }
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
  const fieldCount = fixes.reduce((n, fix) => n + FIELDS.filter((field) => fix[field]).length, 0);
  console.log(`\naccounts needing fixes=${fixes.length} fields=${fieldCount}`);
});

console.log(`fields patched=${patched} skipped=${skipped} failed-accounts=${failed}`);
if (!COMMIT) console.log('DRY-RUN — re-run with --commit to apply.');
if (failed) process.exit(1);
