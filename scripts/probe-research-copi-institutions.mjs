/**
 * probe-research-copi-institutions.mjs — READ-ONLY. Is a co-PI's institution
 * tracked in Dataverse for awarded Research requests?
 *
 * Same award scope as probe-research-pi-orcid-coverage.mjs (akoya_programid
 * name contains "Research" minus "Research Reviewer"; status
 * Approved/Active/Closed; wmkf_meetingdate within N years).
 *
 * 1. Schema: lists akoya_request / contact / wmkf_apprequestperson columns
 *    whose logical name looks co-PI- or institution-related, so a per-award
 *    institution field is not missed.
 * 2. Data: co-PIs from the `wmkf_apprequestperson` junction (role Co-PI) and
 *    the legacy `wmkf_copi1..5` slots; for PIs and co-PIs, whether the
 *    contact's `parentcustomerid` account is empty, equals the request's
 *    applicant account, or is a different account. NOTE: parentcustomerid is
 *    the contact's CURRENT account, not a snapshot at award time.
 *
 * No writes. Acts against whatever .env.local points at (prod Dataverse).
 *   node scripts/probe-research-copi-institutions.mjs [--years=10]
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
if (!Number.isInteger(YEARS) || YEARS < 1) { console.error('--years must be a positive integer'); process.exit(2); }

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { getMetadataBatch } = await import('../lib/dataverse/adapters/metadata.js');
enterDynamicsBypassForScript('probe-research-copi-institutions');

const AWARDED = ['Approved', 'Active', 'Closed'];
const ROLE_PI = 100000000;
const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5].map((n) => `_wmkf_copi${n}_value`);
const cutoff = new Date();
cutoff.setUTCFullYear(cutoff.getUTCFullYear() - YEARS);
const cutoffDate = cutoff.toISOString().slice(0, 10);

const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : 'n/a');
const row = (n, label, d) => console.log(`  ${String(n).padStart(6)}  ${label}${d !== undefined ? `  (${pct(n, d)})` : ''}`);
const lc = (v) => (v ? String(v).toLowerCase() : null);

// queryAllRecords stops at MAX_EXPORT_RECORDS (5,000); a truncated count would be wrong.
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

// 1. Schema scan.
const ENTITIES = ['akoya_request', 'contact', 'wmkf_apprequestperson'];
const NAME_RE = /copi|co_pi|coinv|coprinc|investig|collab|partner|institution|affiliat|organi|subaward|department|employer/i;
const metadata = await getMetadataBatch(ENTITIES.map((e) => `/EntityDefinitions(LogicalName='${e}')/Attributes?$select=LogicalName,AttributeType,DisplayName`));
console.log('\n=== Schema: co-PI / institution-looking columns ===');
ENTITIES.forEach((entity, i) => {
  const hits = (metadata[i].value || []).filter((a) => NAME_RE.test(a.LogicalName) && !/yominame$/.test(a.LogicalName) && a.AttributeType !== 'Virtual');
  console.log(`\n${entity} (${hits.length}):`);
  for (const a of hits.sort((x, y) => x.LogicalName.localeCompare(y.LogicalName))) {
    console.log(`  ${a.LogicalName.padEnd(42)} ${String(a.AttributeType).padEnd(10)} ${a.DisplayName?.UserLocalizedLabel?.Label ?? ''}`);
  }
});

// 2. Awarded Research requests.
const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
  ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
const programFilter = research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ');
const statusFilter = AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ');
const requests = await readAll('akoya_requests', {
  select: ['akoya_requestid', '_akoya_applicantid_value', '_wmkf_projectleader_value', ...SLOTS].join(','),
  filter: `(${programFilter}) and (${statusFilter}) and wmkf_meetingdate ge ${cutoffDate}`,
});
const byId = new Map(requests.map((r) => [lc(r.akoya_requestid), r]));

console.log(`\n=== Awarded Research requests, meeting date >= ${cutoffDate} ===\n`);
console.log(`Programs: ${research.map(programName).join(', ')}`);
row(requests.length, 'awarded requests');
row(requests.filter((r) => r._akoya_applicantid_value).length, 'with an applicant account (akoya_applicantid)', requests.length);

// 3. Junction rows (PI + Co-PI) for those requests.
const junction = await inBatches([...byId.keys()], 50, (ids) => readAll('wmkf_apprequestpersons', {
  select: '_wmkf_request_value,_wmkf_contact_value,wmkf_role',
  filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and (wmkf_role eq ${ROLE_PI} or wmkf_role eq ${ROLE_COPI})`,
}));

// Co-PI (request, contact) pairs from both sources.
const copiPairs = new Map(); // key request|contact → { request, contact, junction, slot }
const addPair = (req, contact, source) => {
  const key = `${req}|${contact}`;
  const p = copiPairs.get(key) || { request: req, contact, junction: false, slot: false };
  p[source] = true;
  copiPairs.set(key, p);
};
for (const j of junction) if (j.wmkf_role === ROLE_COPI) addPair(lc(j._wmkf_request_value), lc(j._wmkf_contact_value), 'junction');
for (const r of requests) for (const s of SLOTS) if (r[s]) addPair(lc(r.akoya_requestid), lc(r[s]), 'slot');
const pairs = [...copiPairs.values()];

console.log('\nCo-PIs on awarded requests:');
row(new Set(pairs.map((p) => p.request)).size, 'requests with at least one co-PI', requests.length);
row(pairs.length, 'co-PI assignments (request × contact)');
row(pairs.filter((p) => p.junction && p.slot).length, '  in both junction and legacy slot', pairs.length);
row(pairs.filter((p) => p.junction && !p.slot).length, '  junction only', pairs.length);
row(pairs.filter((p) => !p.junction && p.slot).length, '  legacy slot only', pairs.length);
const copiIds = [...new Set(pairs.map((p) => p.contact))];
row(copiIds.length, 'distinct co-PI contacts');

// 4. Contacts (PIs + co-PIs): current account and ORCID.
const piIds = [...new Set(requests.map((r) => lc(r._wmkf_projectleader_value)).filter(Boolean))];
const contactIds = [...new Set([...piIds, ...copiIds])];
const contacts = new Map((await inBatches(contactIds, 50, (ids) => readAll('contacts', {
  select: 'contactid,_parentcustomerid_value,adx_organizationname,wmkf_copiorganizationname,wmkf_orcid',
  filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
}))).map((c) => [lc(c.contactid), c]));

const classify = (assignments) => {
  const out = { empty: 0, same: 0, different: 0, missingContact: 0, orgTextOnly: 0 };
  for (const { contact, request } of assignments) {
    const c = contacts.get(contact);
    if (!c) { out.missingContact += 1; continue; }
    const account = lc(c._parentcustomerid_value);
    if (!account) { out.empty += 1; if (c.adx_organizationname) out.orgTextOnly += 1; continue; }
    if (account === lc(byId.get(request)?._akoya_applicantid_value)) out.same += 1; else out.different += 1;
  }
  return out;
};
const report = (label, assignments) => {
  const c = classify(assignments);
  console.log(`\n${label} — contact's CURRENT parent account vs the request's applicant:`);
  row(assignments.length, 'assignments');
  row(c.same, 'same account as applicant', assignments.length);
  row(c.different, 'different account', assignments.length);
  row(c.empty, 'no parent account on contact', assignments.length);
  row(c.orgTextOnly, '  of which: free-text adx_organizationname present', c.empty);
  if (c.missingContact) row(c.missingContact, 'contact not readable', assignments.length);
};
report('PIs', requests.filter((r) => r._wmkf_projectleader_value).map((r) => ({ request: lc(r.akoya_requestid), contact: lc(r._wmkf_projectleader_value) })));
report('Co-PIs', pairs);

// Free-text institution fields on co-PI contacts (contact-level, not per award).
const has = (id, f) => Boolean(contacts.get(id)?.[f]?.trim());
console.log('\nCo-PI free-text institution fields on contact:');
row(copiIds.filter((id) => has(id, 'wmkf_copiorganizationname')).length, 'wmkf_copiorganizationname populated', copiIds.length);
row(copiIds.filter((id) => has(id, 'adx_organizationname')).length, 'adx_organizationname populated', copiIds.length);
row(copiIds.filter((id) => has(id, 'wmkf_copiorganizationname') && has(id, 'adx_organizationname')
  && contacts.get(id).wmkf_copiorganizationname.trim().toLowerCase() !== contacts.get(id).adx_organizationname.trim().toLowerCase()).length,
'  both populated but different text', copiIds.length);
row(copiIds.filter((id) => contacts.get(id)?._parentcustomerid_value || has(id, 'wmkf_copiorganizationname') || has(id, 'adx_organizationname')).length,
  'any institution signal (account or either text field)', copiIds.length);
const copiRequests = [...new Set(pairs.map((p) => p.request))];
const collab = await inBatches(copiRequests, 50, (ids) => readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_collaboration',
  filter: `(${ids.map((id) => `akoya_requestid eq ${id}`).join(' or ')}) and akoya_collaboration ne null`,
}));
row(collab.length, 'co-PI requests with akoya_collaboration text', copiRequests.length);

console.log('\nCo-PI ORCID on contact:');
row(copiIds.filter((id) => normalizeOrcid(contacts.get(id)?.wmkf_orcid).state === 'valid').length, 'distinct co-PI contacts with a valid ORCID', copiIds.length);
row(copiIds.filter((id) => piIds.includes(id)).length, 'co-PI contacts who are also a PI in this set', copiIds.length);
console.log('');
