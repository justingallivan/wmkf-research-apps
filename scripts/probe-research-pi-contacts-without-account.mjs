/**
 * probe-research-pi-contacts-without-account.mjs — READ-ONLY follow-up to the
 * Stage A resolve of the Research Institution at Award backfill
 * (docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md).
 *
 * For every `write` row whose PI contact has no current parent account
 * (contact_account = empty), looks for other contacts that may be the same
 * person: any shared email (emailaddress1/2/3 in either direction) or the
 * same first + last name. Also records who created the PI contact and when,
 * to tell "intake never linked an account" apart from "duplicate contact".
 *
 *   node scripts/probe-research-pi-contacts-without-account.mjs --resolve=<research-pi-iaa-resolve.jsonl> [--out-dir=<dir>]
 *
 * --out-dir defaults to the resolve file's folder and must be outside the
 * repo: the CSV holds names and emails. Acts against whatever .env.local
 * points at.
 */

import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const RESOLVE = arg('resolve');
if (!RESOLVE) { console.error('--resolve=<research-pi-iaa-resolve.jsonl> is required'); process.exit(2); }
const outAbs = path.resolve(arg('out-dir') || path.dirname(RESOLVE));
const repoAbs = path.resolve('.');
if (outAbs === repoAbs || outAbs.startsWith(`${repoAbs}${path.sep}`)) {
  console.error('--out-dir must be outside the repository (the CSV holds names and emails).');
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('probe-research-pi-contacts-without-account');
const { escape } = await import('../lib/dataverse/core/odata.js');

const lc = (v) => (v ? String(v).toLowerCase() : null);
const lcTrim = (v) => (v ? String(v).trim().toLowerCase() : null);

async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap.`); process.exit(1); }
  return result.records;
}

const targets = fs.readFileSync(RESOLVE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.class === 'write' && r.contactAccount === 'empty');
if (!targets.length) { console.error('No write rows with contactAccount = empty in the resolve file.'); process.exit(1); }

const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1,emailaddress2,emailaddress3,_parentcustomerid_value,adx_organizationname,wmkf_orcid,statecode,createdon,_createdby_value';
const emailsOf = (c) => [c.emailaddress1, c.emailaddress2, c.emailaddress3].map(lcTrim).filter(Boolean);

const rows = [];
for (const t of targets) {
  const [pi] = await readAll('contacts', { select: CONTACT_SELECT, filter: `contactid eq ${t.contactId}` });
  if (!pi) { rows.push({ t, pi: null, dupes: [] }); continue; }

  const clauses = [];
  for (const e of emailsOf(pi)) {
    for (const f of ['emailaddress1', 'emailaddress2', 'emailaddress3']) clauses.push(`${f} eq '${escape(e)}'`);
  }
  if (pi.firstname && pi.lastname) {
    clauses.push(`(firstname eq '${escape(pi.firstname.trim())}' and lastname eq '${escape(pi.lastname.trim())}')`);
  }
  const found = clauses.length
    ? await readAll('contacts', { select: CONTACT_SELECT, filter: `(${clauses.join(' or ')}) and contactid ne ${t.contactId}` })
    : [];
  const piEmails = new Set(emailsOf(pi));
  const dupes = found.map((d) => ({
    d,
    byEmail: emailsOf(d).some((e) => piEmails.has(e)),
    byName: lcTrim(d.firstname) === lcTrim(pi.firstname) && lcTrim(d.lastname) === lcTrim(pi.lastname),
    hasAccount: Boolean(d._parentcustomerid_value) && d._parentcustomerid_value_entity === 'account',
    accountIsApplicant: lc(d._parentcustomerid_value) === t.applicantAccountId,
  }));
  rows.push({ t, pi, dupes });
}

// CSV: one row per PI, duplicate details joined.
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const cols = ['request_num', 'pi_name', 'pi_emails', 'pi_created_on', 'pi_created_by', 'pi_free_text_org', 'pi_has_orcid', 'pi_inactive',
  'other_contacts', 'other_by_email', 'other_by_name_only', 'other_with_account', 'other_with_applicant_account', 'other_contacts_detail'];
const lines = rows.map(({ t, pi, dupes }) => [
  t.requestNum,
  pi?.fullname || '(contact not found)',
  pi ? emailsOf(pi).join('; ') : '',
  (pi?.createdon || '').slice(0, 10),
  pi?._createdby_value_formatted || '',
  pi?.adx_organizationname || '',
  pi?.wmkf_orcid ? 'yes' : '',
  pi && pi.statecode !== 0 ? 'yes' : '',
  dupes.length,
  dupes.filter((x) => x.byEmail).length,
  dupes.filter((x) => x.byName && !x.byEmail).length,
  dupes.filter((x) => x.hasAccount).length,
  dupes.filter((x) => x.accountIsApplicant).length,
  dupes.map((x) => `${x.d.fullname} <${emailsOf(x.d).join(', ')}> account=${x.d._parentcustomerid_value_formatted || 'none'} created=${(x.d.createdon || '').slice(0, 10)}${x.d.statecode !== 0 ? ' INACTIVE' : ''}`).join(' | '),
].map(csvCell).join(','));
const outFile = path.join(outAbs, 'research-pi-no-account-probe.csv');
fs.writeFileSync(outFile, `${[cols.join(','), ...lines].join('\n')}\n`);

// Summary without names.
const n = (pred) => rows.filter(pred).length;
const creators = new Map();
for (const { pi } of rows) { const k = pi?._createdby_value_formatted || '(unknown)'; creators.set(k, (creators.get(k) || 0) + 1); }
console.log(`\nPI contacts without an account: ${rows.length}`);
console.log(`  contact not found:                         ${n((r) => !r.pi)}`);
console.log(`  no other matching contact:                 ${n((r) => r.pi && !r.dupes.length)}`);
console.log(`  other contact sharing an email:            ${n((r) => r.dupes.some((x) => x.byEmail))}`);
console.log(`  other contact by name only:                ${n((r) => r.dupes.length && !r.dupes.some((x) => x.byEmail))}`);
console.log(`  an other contact has an account:           ${n((r) => r.dupes.some((x) => x.hasAccount))}`);
console.log(`  an other contact has the applicant account:${n((r) => r.dupes.some((x) => x.accountIsApplicant))}`);
console.log(`  PI contact has free-text organization:     ${n((r) => r.pi?.adx_organizationname)}`);
console.log('  PI contact created by:');
for (const [k, v] of [...creators].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
console.log(`\nWrote ${outFile}`);
