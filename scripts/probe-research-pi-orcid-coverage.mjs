/**
 * probe-research-pi-orcid-coverage.mjs — READ-ONLY reconnaissance for a
 * possible ORCID backfill on awarded Research-program PIs.
 *
 * Question: of the PIs (`akoya_request.wmkf_projectleader` → contact) on
 * AWARDED Research-program requests with a meeting date in the last N years
 * (default 10), how many contacts carry a valid `contact.wmkf_orcid`?
 *
 * Program scope uses `akoya_programid` (the Atlas-mandated program axis,
 * never `wmkf_grantprogram`): every akoya_program whose name contains
 * "Research", excluding the "Research Reviewer" operational bucket. The
 * selected programs are printed so the scope can be checked.
 * Time scope uses `wmkf_meetingdate` (~universal on named processes);
 * `createdon` is collapsed to the 2023-12-03 import for migrated rows.
 * Awarded = `akoya_requeststatus` in Approved/Active/Closed (Atlas
 * award-eligible decided class); rows in that class without a positive
 * `akoya_grant` are counted so the predicate can be checked.
 *
 * Also reports, for PIs without a contact ORCID, how many have a linked
 * `wmkf_potentialreviewers` row (via `_wmkf_contact_value`) that already holds
 * a valid ORCID — an in-house backfill source needing no external lookup.
 *
 * No writes. Acts against whatever .env.local points at (prod Dataverse).
 *   node scripts/probe-research-pi-orcid-coverage.mjs [--years=10] [--csv=<path>]
 * --csv writes one row per PI contact (contains names/emails: keep it out of
 * the repo).
 */

import fs from 'fs';
import { normalizeOrcid } from '../lib/utils/orcid-normalize.js';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const YEARS = Number(arg('years') || 10);
const CSV_PATH = arg('csv');
if (!Number.isInteger(YEARS) || YEARS < 1) { console.error('--years must be a positive integer'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-research-pi-orcid-coverage');

const AWARDED = ['Approved', 'Active', 'Closed'];
const cutoff = new Date();
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - YEARS);
const cutoffDate = cutoff.toISOString().slice(0, 10);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const row = (n, label, d) => console.log(`  ${String(n).padStart(6)}  ${label}${d !== undefined ? `  (${pct(n, d)})` : ''}`);

// queryAllRecords stops at MAX_EXPORT_RECORDS (5,000); a truncated count would be wrong.
async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap — narrow the window.`); process.exit(1); }
  return result;
}

async function inBatches(ids, size, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

// 1. Research programs (GUID-keyed; name read from whichever *name column exists).
const { records: programs } = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
  ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '(unnamed)';
const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
const researchNames = new Map(research.map((p) => [p.akoya_programid, programName(p)]));

console.log(`\n=== Awarded Research PI ORCID coverage — meeting date >= ${cutoffDate} (${YEARS} years) ===\n`);
console.log('Programs in scope (akoya_programid):');
for (const [id, name] of researchNames) console.log(`  ${name}  [${id}]`);
if (!research.length) { console.error('No Research programs matched — stop.'); process.exit(1); }

// 2. Awarded requests in scope.
const programFilter = research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ');
const statusFilter = AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ');
const { records: requests } = await readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_requeststatus,akoya_grant,wmkf_meetingdate,_akoya_programid_value,_wmkf_projectleader_value',
  filter: `(${programFilter}) and (${statusFilter}) and wmkf_meetingdate ge ${cutoffDate}`,
});
const withPi = requests.filter((r) => r._wmkf_projectleader_value);

console.log('\nAwarded requests:');
row(requests.length, 'awarded Research requests in window');
for (const s of AWARDED) row(requests.filter((r) => r.akoya_requeststatus === s).length, `  ${s}`);
row(requests.filter((r) => !(Number(r.akoya_grant) > 0)).length, 'with no positive akoya_grant (check the awarded predicate)', requests.length);
row(withPi.length, 'with a PI (wmkf_projectleader)', requests.length);

// 3. Distinct PI contacts, with their programs, award count, and latest meeting date.
const pis = new Map();
for (const r of withPi) {
  const id = r._wmkf_projectleader_value.toLowerCase();
  const p = pis.get(id) || { id, awards: 0, programs: new Set(), latest: '' };
  p.awards += 1;
  p.programs.add(researchNames.get(r._akoya_programid_value) || r._akoya_programid_value);
  if ((r.wmkf_meetingdate || '') > p.latest) p.latest = r.wmkf_meetingdate || '';
  pis.set(id, p);
}
const piIds = [...pis.keys()];

const contacts = await inBatches(piIds, 50, async (ids) => (await readAll('contacts', {
  select: 'contactid,fullname,emailaddress1,wmkf_orcid,statecode',
  filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
})).records);
for (const c of contacts) Object.assign(pis.get(c.contactid.toLowerCase()), { contact: c, orcid: normalizeOrcid(c.wmkf_orcid) });

// 4. Linked potential-reviewer ORCIDs for every PI contact.
const reviewers = await inBatches(piIds, 50, async (ids) => (await readAll('wmkf_potentialreviewerses', {
  select: 'wmkf_potentialreviewersid,wmkf_orcid,_wmkf_contact_value',
  filter: ids.map((id) => `_wmkf_contact_value eq ${id}`).join(' or '),
})).records);
for (const rv of reviewers) {
  const p = pis.get(String(rv._wmkf_contact_value).toLowerCase());
  const n = normalizeOrcid(rv.wmkf_orcid);
  if (p && n.state === 'valid') (p.reviewerOrcids ||= new Set()).add(n.id);
}

// 5. Report.
const all = [...pis.values()];
const valid = all.filter((p) => p.orcid?.state === 'valid');
const malformed = all.filter((p) => p.orcid?.state === 'malformed');
const empty = all.filter((p) => p.orcid?.state === 'empty');
const unresolved = all.filter((p) => !p.contact);
const fromReviewer = empty.filter((p) => p.reviewerOrcids?.size === 1);
const reviewerConflict = empty.filter((p) => p.reviewerOrcids?.size > 1);
const disagree = valid.filter((p) => p.reviewerOrcids?.size && !p.reviewerOrcids.has(p.orcid.id));

console.log('\nAwarded PI contacts:');
row(all.length, 'distinct PI contacts');
row(valid.length, 'valid ORCID on contact', all.length);
row(malformed.length, 'malformed ORCID on contact (bad shape/checksum)', all.length);
row(empty.length, 'no ORCID on contact', all.length);
row(unresolved.length, 'PI lookup did not resolve to a readable contact', all.length);
row(fromReviewer.length, '  no-ORCID PIs with one valid ORCID on a linked potential-reviewer row', empty.length);
row(reviewerConflict.length, '  no-ORCID PIs whose linked reviewer rows disagree (>1 ORCID)', empty.length);
row(disagree.length, 'contact ORCID differs from linked reviewer ORCID', valid.length);
row(all.filter((p) => p.contact && p.contact.statecode !== 0).length, 'PI contacts that are inactive', all.length);

const byOrcid = new Map();
for (const p of valid) byOrcid.set(p.orcid.id, [...(byOrcid.get(p.orcid.id) || []), p.id]);
row([...byOrcid.values()].filter((ids) => ids.length > 1).length, 'ORCIDs shared by more than one PI contact (possible duplicates)');

console.log('\nCoverage by latest award meeting year:');
const byYear = {};
for (const p of all) {
  const y = (p.latest || '????').slice(0, 4);
  byYear[y] ||= { n: 0, valid: 0 };
  byYear[y].n += 1;
  if (p.orcid?.state === 'valid') byYear[y].valid += 1;
}
for (const [y, { n, valid: v }] of Object.entries(byYear).sort()) console.log(`    ${y}  ${String(v).padStart(5)} / ${String(n).padEnd(5)} ${pct(v, n)}`);

if (CSV_PATH) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['contactid,fullname,email,orcid_state,contact_orcid,reviewer_orcids,awards,latest_meeting,programs'];
  for (const p of all) {
    lines.push([p.id, p.contact?.fullname, p.contact?.emailaddress1, p.orcid?.state ?? 'unresolved',
      p.orcid?.state === 'valid' ? p.orcid.id : p.contact?.wmkf_orcid, [...(p.reviewerOrcids || [])].join(' '),
      p.awards, p.latest, [...p.programs].join('; ')].map(esc).join(','));
  }
  fs.writeFileSync(CSV_PATH, `${lines.join('\n')}\n`);
  console.log(`\nWrote ${all.length} rows to ${CSV_PATH}`);
}
console.log('');
