/**
 * backfill-research-pi-institution-at-award.mjs — Stage A of the Research
 * Institution at Award backfill: PI rows on awarded Research requests.
 * Plan: docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.1.
 * Owner-run only.
 *
 *   --resolve (default; the only mode built so far) READ-ONLY. Classifies
 *   every in-scope award's PI junction row against the request's applicant
 *   account and writes, under --out-dir:
 *     research-pi-iaa-resolve.jsonl  one line per award, ids only (apply input)
 *     research-pi-iaa-review.csv     same rows with names, for owner review
 *   and prints class counts and the 8-char resolve hash a later --apply will
 *   require.
 *
 * Scope (owner, 2026-10-20): akoya_requeststatus Approved/Active/Closed,
 * program name contains "research" but not "reviewer" (same as
 * export-research-orcid-backfill-pool.mjs), wmkf_meetingdate >= --since
 * (default 2017-01-01).
 *
 * Classes: write, already-set, no-junction-row, multiple-pi-rows,
 * pi-mismatch, no-applicant, other. `write` rows carry contact_account =
 * same | elsewhere | empty | not-account, comparing the PI contact's current
 * parent account with the applicant; `elsewhere` is still written (the
 * applicant is the award-time institution) but listed for review.
 *
 *   node scripts/backfill-research-pi-institution-at-award.mjs --out-dir=<dir outside the repo> [--since=2017-01-01]
 *
 * Acts against whatever .env.local points at. The review CSV holds PI names:
 * keep it out of the repo.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const flag = (name) => process.argv.includes(`--${name}`);
if (flag('apply') || flag('verify') || flag('rollback')) {
  console.error('Only --resolve is built. Apply/verify/rollback come after owner review of the resolve output.');
  process.exit(2);
}
const OUT_DIR = arg('out-dir');
const SINCE = arg('since') || '2017-01-01';
if (!OUT_DIR) { console.error('--out-dir=<dir outside the repo> is required'); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }
const outAbs = path.resolve(OUT_DIR);
const repoAbs = path.resolve('.');
if (outAbs === repoAbs || outAbs.startsWith(`${repoAbs}${path.sep}`)) {
  console.error('--out-dir must be outside the repository (the review CSV holds names).');
  process.exit(2);
}
fs.mkdirSync(outAbs, { recursive: true });

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('backfill-research-pi-institution-at-award');

const AWARDED = ['Approved', 'Active', 'Closed'];
const ROLE_PI = 100000000;
const lc = (v) => (v ? String(v).toLowerCase() : null);

// queryAllRecords stops at MAX_EXPORT_RECORDS (5,000); a truncated read would misclassify.
async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap — narrow --since.`); process.exit(1); }
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
if (!research.length) { console.error('No Research programs matched.'); process.exit(1); }
console.log(`Programs in scope: ${research.map(programName).join('; ')}`);
const programFilter = research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ');
const statusFilter = AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ');
const requests = await readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,_akoya_applicantid_value,_wmkf_projectleader_value',
  filter: `(${programFilter}) and (${statusFilter}) and wmkf_meetingdate ge ${SINCE}`,
  orderby: 'wmkf_meetingdate asc',
});
const requestIds = requests.map((r) => lc(r.akoya_requestid));

// 2. PI junction rows on those requests.
const piRows = await inBatches(requestIds, 50, (ids) => readAll('wmkf_apprequestpersons', {
  select: 'wmkf_apprequestpersonid,wmkf_assignmentkey,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value',
  filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and wmkf_role eq ${ROLE_PI}`,
}));
const rowsByRequest = new Map();
for (const j of piRows) {
  const k = lc(j._wmkf_request_value);
  rowsByRequest.set(k, [...(rowsByRequest.get(k) || []), j]);
}

// 3. Contacts (project leaders and junction PIs) with their current parent account.
const contactIds = [...new Set([
  ...requests.map((r) => lc(r._wmkf_projectleader_value)),
  ...piRows.map((j) => lc(j._wmkf_contact_value)),
].filter(Boolean))];
const contacts = new Map((await inBatches(contactIds, 50, (ids) => readAll('contacts', {
  select: 'contactid,fullname,_parentcustomerid_value',
  filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
}))).map((c) => [lc(c.contactid), c]));

// 4. Classify.
function classify(r) {
  const rows = rowsByRequest.get(lc(r.akoya_requestid)) || [];
  const leader = lc(r._wmkf_projectleader_value);
  const applicant = lc(r._akoya_applicantid_value);
  if (rows.length === 0) return leader ? { cls: 'no-junction-row' } : { cls: 'other', reason: 'no project leader and no PI row' };
  if (rows.length > 1) return { cls: 'multiple-pi-rows' };
  const row = rows[0];
  const contact = lc(row._wmkf_contact_value);
  if (!leader) return { cls: 'other', row, reason: 'PI row but no project leader' };
  if (contact !== leader) return { cls: 'pi-mismatch', row };
  if (row._wmkf_institutionataward_value) return { cls: 'already-set', row };
  if (!applicant) return { cls: 'no-applicant', row };
  if (r._akoya_applicantid_value_entity && r._akoya_applicantid_value_entity !== 'account') {
    return { cls: 'other', row, reason: `applicant is a ${r._akoya_applicantid_value_entity}` };
  }
  const c = contacts.get(contact);
  const parent = lc(c?._parentcustomerid_value);
  const contactAccount = !parent ? 'empty'
    : c._parentcustomerid_value_entity !== 'account' ? 'not-account'
      : parent === applicant ? 'same' : 'elsewhere';
  return { cls: 'write', row, contactAccount };
}

const results = requests.map((r) => {
  const { cls, row, reason, contactAccount } = classify(r);
  const leader = contacts.get(lc(r._wmkf_projectleader_value));
  const rowContact = row ? contacts.get(lc(row._wmkf_contact_value)) : null;
  return {
    ids: {
      class: cls,
      requestId: lc(r.akoya_requestid),
      requestNum: r.akoya_requestnum,
      junctionRowId: row ? lc(row.wmkf_apprequestpersonid) : null,
      contactId: row ? lc(row._wmkf_contact_value) : lc(r._wmkf_projectleader_value),
      applicantAccountId: lc(r._akoya_applicantid_value),
      existingInstitutionAtAward: row ? lc(row._wmkf_institutionataward_value) : null,
      contactAccount: contactAccount || null,
      reason: reason || null,
    },
    review: {
      class: cls,
      contact_account: contactAccount || '',
      reason: reason || '',
      request_num: r.akoya_requestnum || '',
      meeting_date: (r.wmkf_meetingdate || '').slice(0, 10),
      program: r._akoya_programid_value_formatted || '',
      status: r.akoya_requeststatus || '',
      project_leader: leader?.fullname || '',
      pi_row_contact: rowContact?.fullname || '',
      applicant: r._akoya_applicantid_value_formatted || '',
      contact_current_account: (rowContact || leader)?._parentcustomerid_value_formatted || '',
      existing_institution_at_award: row?._wmkf_institutionataward_value_formatted || '',
      pi_rows_on_request: (rowsByRequest.get(lc(r.akoya_requestid)) || []).length,
    },
  };
});

// 5. Write outputs.
const jsonl = `${results.map((x) => JSON.stringify(x.ids)).join('\n')}\n`;
const hash = crypto.createHash('sha256').update(jsonl).digest('hex').slice(0, 8);
fs.writeFileSync(path.join(outAbs, 'research-pi-iaa-resolve.jsonl'), jsonl);
const cols = Object.keys(results[0]?.review || { class: '' });
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
fs.writeFileSync(path.join(outAbs, 'research-pi-iaa-review.csv'),
  `${[cols.join(','), ...results.map((x) => cols.map((k) => csvCell(x.review[k])).join(','))].join('\n')}\n`);

// 6. Summary.
const count = (pred) => results.filter(pred).length;
const classes = ['write', 'already-set', 'no-junction-row', 'multiple-pi-rows', 'pi-mismatch', 'no-applicant', 'other'];
console.log(`\nAwarded Research requests with meeting date >= ${SINCE}: ${requests.length}`);
for (const k of classes) console.log(`  ${k.padEnd(17)} ${count((x) => x.ids.class === k)}`);
console.log('  write rows by contact_account:');
for (const k of ['same', 'elsewhere', 'empty', 'not-account']) console.log(`    ${k.padEnd(12)} ${count((x) => x.ids.class === 'write' && x.ids.contactAccount === k)}`);
const years = [...new Set(results.map((x) => x.review.meeting_date.slice(0, 4)))].sort();
console.log('  by meeting year (total / write):');
for (const y of years) console.log(`    ${y}  ${count((x) => x.review.meeting_date.startsWith(y))} / ${count((x) => x.review.meeting_date.startsWith(y) && x.ids.class === 'write')}`);
console.log(`\nWrote ${path.join(outAbs, 'research-pi-iaa-resolve.jsonl')}`);
console.log(`Wrote ${path.join(outAbs, 'research-pi-iaa-review.csv')}`);
console.log(`Resolve hash: ${hash}`);
