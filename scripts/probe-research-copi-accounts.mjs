/**
 * probe-research-copi-accounts.mjs — READ-ONLY input to Stage B of the
 * Research Institution at Award backfill
 * (docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2).
 *
 * For every co-PI already recorded on an awarded Research request (same scope
 * as backfill-research-pi-institution-at-award.mjs: program name contains
 * "research" but not "reviewer", Approved/Active/Closed, meeting date >=
 * --since), reports:
 *   - where the co-PI is recorded: Co-PI junction row, legacy wmkf_copi1..5
 *     slot, or both;
 *   - the co-PI contact's current account: same as the request's applicant,
 *     elsewhere, empty, or not an account;
 *   - whether the co-PI's email domain matches the PI's (a candidate signal
 *     that the applicant is also the co-PI's institution);
 *   - whether the junction row's Institution at Award is already set.
 * Prints counts by meeting year (no names) and writes a CSV with names for
 * owner review.
 *
 *   node scripts/probe-research-copi-accounts.mjs --out-dir=<dir outside the repo> [--since=2017-01-01]
 *
 * Acts against whatever .env.local points at.
 */

import fs from 'fs';
import path from 'path';
import { AWARDED, lc } from './lib/research-iaa-backfill.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const OUT_DIR = arg('out-dir');
const SINCE = arg('since') || '2017-01-01';
if (!OUT_DIR) { console.error('--out-dir=<dir outside the repo> is required'); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) { console.error('--since must be YYYY-MM-DD'); process.exit(2); }
const outAbs = path.resolve(OUT_DIR);
const repoAbs = path.resolve('.');
if (outAbs === repoAbs || outAbs.startsWith(`${repoAbs}${path.sep}`)) {
  console.error('--out-dir must be outside the repository (the CSV holds names).');
  process.exit(2);
}
fs.mkdirSync(outAbs, { recursive: true });

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');

const ROLE_COPI = 100000001;
const SLOTS = [1, 2, 3, 4, 5].map((n) => `_wmkf_copi${n}_value`);
const domainOf = (e) => (e && e.includes('@') ? e.split('@')[1].trim().toLowerCase() : '');
const emailsOf = (c) => [c?.emailaddress1, c?.emailaddress2, c?.emailaddress3].filter(Boolean).map((e) => e.trim().toLowerCase());

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

await bypassDynamicsRestrictions('probe-research-copi-accounts', async () => {
  const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
  const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
    ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
  const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
  const requests = await readAll('akoya_requests', {
    select: ['akoya_requestid', 'akoya_requestnum', 'wmkf_meetingdate', '_akoya_applicantid_value', '_wmkf_projectleader_value', '_wmkf_type_value', ...SLOTS].join(','),
    filter: `(${research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ')}) and (${AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ')}) and wmkf_meetingdate ge ${SINCE}`,
  });
  const byId = new Map(requests.map((r) => [lc(r.akoya_requestid), r]));

  const junction = await inBatches([...byId.keys()], 50, (ids) => readAll('wmkf_apprequestpersons', {
    select: 'wmkf_apprequestpersonid,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value',
    filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and wmkf_role eq ${ROLE_COPI}`,
  }));

  // One entry per (request, contact): junction, slot, or both.
  const pairs = new Map();
  const pair = (request, contact) => {
    const k = `${request}|${contact}`;
    if (!pairs.has(k)) pairs.set(k, { request, contact, junction: null, slot: false });
    return pairs.get(k);
  };
  for (const j of junction) pair(lc(j._wmkf_request_value), lc(j._wmkf_contact_value)).junction = j;
  for (const r of requests) for (const s of SLOTS) if (r[s]) pair(lc(r.akoya_requestid), lc(r[s])).slot = true;

  const contactIds = [...new Set([...[...pairs.values()].map((p) => p.contact), ...requests.map((r) => lc(r._wmkf_projectleader_value))].filter(Boolean))];
  const contacts = new Map((await inBatches(contactIds, 50, (ids) => readAll('contacts', {
    select: 'contactid,fullname,emailaddress1,emailaddress2,emailaddress3,_parentcustomerid_value',
    filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
  }))).map((c) => [lc(c.contactid), c]));

  const rows = [...pairs.values()].map((p) => {
    const r = byId.get(p.request);
    const c = contacts.get(p.contact);
    const pi = contacts.get(lc(r._wmkf_projectleader_value));
    const parent = lc(c?._parentcustomerid_value);
    const account = !c ? 'contact-missing' : !parent ? 'empty'
      : c._parentcustomerid_value_entity !== 'account' ? 'not-account'
        : parent === lc(r._akoya_applicantid_value) ? 'same-as-applicant' : 'elsewhere';
    const piDomains = new Set(emailsOf(pi).map(domainOf).filter(Boolean));
    const copiDomains = emailsOf(c).map(domainOf).filter(Boolean);
    const domain = !copiDomains.length ? 'no-email' : !piDomains.size ? 'pi-no-email'
      : copiDomains.some((d) => piDomains.has(d)) ? 'same-as-pi' : 'different';
    return {
      year: (r.wmkf_meetingdate || '').slice(0, 4),
      request_num: r.akoya_requestnum,
      grant_type: r._wmkf_type_value_formatted || '',
      recorded_in: p.junction && p.slot ? 'both' : p.junction ? 'junction' : 'slot-only',
      copi: c?.fullname || '',
      copi_emails: emailsOf(c).join('; '),
      account,
      contact_account: c?._parentcustomerid_value_formatted || '',
      applicant: r._akoya_applicantid_value_formatted || '',
      email_domain_vs_pi: domain,
      institution_at_award: p.junction?._wmkf_institutionataward_value_formatted || '',
    };
  }).sort((a, b) => `${a.year}${a.request_num}`.localeCompare(`${b.year}${b.request_num}`));

  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const cols = Object.keys(rows[0] || { year: '' });
  const outFile = path.join(outAbs, 'research-copi-accounts-probe.csv');
  fs.writeFileSync(outFile, `${[cols.join(','), ...rows.map((x) => cols.map((k) => csvCell(x[k])).join(','))].join('\n')}\n`);

  const tally = (list, key) => {
    const t = {};
    for (const x of list) t[x[key]] = (t[x[key]] || 0) + 1;
    return JSON.stringify(t);
  };
  console.log(`\nAwarded Research requests with meeting date >= ${SINCE}: ${requests.length}`);
  console.log(`Recorded co-PIs (request × contact): ${rows.length} on ${new Set(rows.map((x) => x.request_num)).size} requests`);
  console.log(`  recorded in: ${tally(rows, 'recorded_in')}`);
  console.log(`  contact account: ${tally(rows, 'account')}`);
  console.log(`  email domain vs PI: ${tally(rows, 'email_domain_vs_pi')}`);
  console.log(`  empty-account co-PIs whose domain matches the PI: ${rows.filter((x) => x.account === 'empty' && x.email_domain_vs_pi === 'same-as-pi').length}`);
  console.log(`  Institution at Award already set: ${rows.filter((x) => x.institution_at_award).length}`);
  console.log('  by meeting year (co-PIs / with an account / empty):');
  for (const y of [...new Set(rows.map((x) => x.year))].sort()) {
    const ys = rows.filter((x) => x.year === y);
    console.log(`    ${y}  ${ys.length} / ${ys.filter((x) => x.account === 'same-as-applicant' || x.account === 'elsewhere').length} / ${ys.filter((x) => x.account === 'empty').length}`);
  }
  console.log(`\nWrote ${outFile}`);
});
