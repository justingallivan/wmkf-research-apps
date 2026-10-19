/**
 * export-research-orcid-backfill-pool.mjs — READ-ONLY Dataverse export of the
 * ORCID backfill pool: PIs and co-PIs on awarded Research requests (same scope
 * as probe-research-pi-orcid-coverage.mjs) whose contact has no valid
 * `wmkf_orcid`. Writes JSON for scripts/match-orcid-backfill-candidates.mjs,
 * which talks to ORCID only (no Dataverse access).
 *
 * Institution evidence per person:
 *   - PI: the request's applicant account (`akoya_applicantid`) — the award
 *     goes to the institution, so this is the institution at award time.
 *   - co-PI and PI: the contact's CURRENT parent account and free-text
 *     `adx_organizationname` (not a snapshot at award time).
 * Co-PIs come from the `wmkf_apprequestperson` junction (role Co-PI) and the
 * legacy `wmkf_copi1..5` slots.
 *
 * No writes to Dataverse. Acts against whatever .env.local points at.
 *   node scripts/export-research-orcid-backfill-pool.mjs --out=<path> [--years=10] [--include-known]
 * The output contains names and emails: keep it out of the repo.
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
const OUT = arg('out');
// Also emit contacts that already have a valid ORCID (as `knownOrcid`) so the
// matcher can be scored blind against a known answer.
const INCLUDE_KNOWN = process.argv.includes('--include-known');
if (!OUT) { console.error('--out=<path> is required'); process.exit(2); }
if (!Number.isInteger(YEARS) || YEARS < 1) { console.error('--years must be a positive integer'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('export-research-orcid-backfill-pool');

const AWARDED = ['Approved', 'Active', 'Closed'];
const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5].map((n) => `_wmkf_copi${n}_value`);
const cutoff = new Date();
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - YEARS);
const cutoffDate = cutoff.toISOString().slice(0, 10);
const lc = (v) => (v ? String(v).toLowerCase() : null);

// queryAllRecords stops at MAX_EXPORT_RECORDS (5,000); a truncated pool would be wrong.
async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap — narrow the window.`); process.exit(1); }
  return result.records;
}
async function inBatches(ids, size, fn) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(...(await fn(ids.slice(i, i + size))));
  return out;
}

// 1. Awarded Research requests.
const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
  ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
const programFilter = research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ');
const statusFilter = AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ');
const requests = await readAll('akoya_requests', {
  select: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate', '_akoya_applicantid_value', '_wmkf_projectleader_value', ...SLOTS].join(','),
  filter: `(${programFilter}) and (${statusFilter}) and wmkf_meetingdate ge ${cutoffDate}`,
});
const byId = new Map(requests.map((r) => [lc(r.akoya_requestid), r]));

// 2. Person × award assignments.
const assignments = []; // { contact, request, role }
const seen = new Set();
const assign = (contact, request, role) => {
  const key = `${contact}|${request}|${role}`;
  if (!contact || seen.has(key)) return;
  seen.add(key);
  assignments.push({ contact, request, role });
};
for (const r of requests) {
  assign(lc(r._wmkf_projectleader_value), lc(r.akoya_requestid), 'PI');
  for (const s of SLOTS) assign(lc(r[s]), lc(r.akoya_requestid), 'Co-PI');
}
const junction = await inBatches([...byId.keys()], 50, (ids) => readAll('wmkf_apprequestpersons', {
  select: '_wmkf_request_value,_wmkf_contact_value,wmkf_role',
  filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and wmkf_role eq ${ROLE_COPI}`,
}));
for (const j of junction) assign(lc(j._wmkf_contact_value), lc(j._wmkf_request_value), 'Co-PI');

// 3. Contacts and linked potential-reviewer ORCIDs.
const contactIds = [...new Set(assignments.map((a) => a.contact))];
const contacts = new Map((await inBatches(contactIds, 50, (ids) => readAll('contacts', {
  select: 'contactid,firstname,lastname,fullname,emailaddress1,wmkf_orcid,_parentcustomerid_value,adx_organizationname',
  filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
}))).map((c) => [lc(c.contactid), c]));
const reviewerOrcids = new Map();
for (const rv of await inBatches(contactIds, 50, (ids) => readAll('wmkf_potentialreviewerses', {
  select: 'wmkf_orcid,_wmkf_contact_value',
  filter: ids.map((id) => `_wmkf_contact_value eq ${id}`).join(' or '),
}))) {
  const n = normalizeOrcid(rv.wmkf_orcid);
  if (n.state !== 'valid') continue;
  const id = lc(rv._wmkf_contact_value);
  reviewerOrcids.set(id, new Set([...(reviewerOrcids.get(id) || []), n.id]));
}

// 4. Build the pool (contacts without a valid ORCID).
const people = new Map();
for (const a of assignments) {
  const c = contacts.get(a.contact);
  if (!c) continue;
  const known = normalizeOrcid(c.wmkf_orcid);
  if (known.state === 'valid' && !INCLUDE_KNOWN) continue;
  const r = byId.get(a.request);
  const p = people.get(a.contact) || {
    contactId: a.contact,
    firstname: c.firstname || '',
    lastname: c.lastname || '',
    fullname: c.fullname || '',
    email: c.emailaddress1 || '',
    existingOrcidRaw: c.wmkf_orcid || '',
    ...(known.state === 'valid' ? { knownOrcid: known.id } : {}),
    roles: [],
    awards: [],
    institutions: [],
    reviewerOrcids: [...(reviewerOrcids.get(a.contact) || [])],
  };
  if (!p.roles.includes(a.role)) p.roles.push(a.role);
  p.awards.push({ requestNum: r.akoya_requestnum, meetingDate: r.wmkf_meetingdate, role: a.role, applicant: r._akoya_applicantid_value_formatted || '' });
  const addInst = (name, source) => {
    if (name && !p.institutions.some((i) => i.name === name && i.source === source)) p.institutions.push({ name, source });
  };
  if (a.role === 'PI') addInst(r._akoya_applicantid_value_formatted, 'award-applicant');
  addInst(c._parentcustomerid_value_formatted, 'contact-account');
  addInst(c.adx_organizationname?.trim(), 'contact-orgtext');
  people.set(a.contact, p);
}

const pool = [...people.values()];
const alreadyHave = contactIds.filter((id) => normalizeOrcid(contacts.get(id)?.wmkf_orcid).state === 'valid').length;
fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), cutoffDate, people: pool }, null, 2)}\n`);
console.log(`\nAwarded Research requests since ${cutoffDate}: ${requests.length}`);
console.log(`Distinct PI/co-PI contacts: ${contactIds.length} (${alreadyHave} already have a valid ORCID)`);
const backfill = pool.filter((p) => !p.knownOrcid);
console.log(`Backfill pool: ${backfill.length} — ${backfill.filter((p) => p.roles.includes('PI')).length} PI, ${backfill.filter((p) => !p.roles.includes('PI')).length} co-PI only`);
if (INCLUDE_KNOWN) console.log(`Known-ORCID validation set included: ${pool.length - backfill.length}`);
console.log(`  with an institution signal: ${pool.filter((p) => p.institutions.length).length}`);
console.log(`  with a linked reviewer ORCID: ${pool.filter((p) => p.reviewerOrcids.length).length}`);
console.log(`Wrote ${OUT}\n`);
