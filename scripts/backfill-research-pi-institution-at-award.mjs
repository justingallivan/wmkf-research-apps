/**
 * backfill-research-pi-institution-at-award.mjs — Stage A of the Research
 * Institution at Award backfill: PI rows on awarded Research requests.
 * Plan: docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.1.
 * Owner-run only. Write/log shape follows apply-research-pi-orcid-backfill.mjs.
 *
 * Scope (owner, 2026-10-20): akoya_requeststatus Approved/Active/Closed,
 * program name contains "research" but not "reviewer" (same as
 * export-research-orcid-backfill-pool.mjs), wmkf_meetingdate >= --since
 * (default 2017-01-01).
 *
 * Two write groups, each applied only when asked:
 *   iaa      Set wmkf_apprequestperson.wmkf_InstitutionAtAward to the
 *            request's applicant account on the PI junction row.
 *   contact  (--contact-accounts) Set contact.parentcustomerid to that
 *            applicant account, only for PI contacts with no account and no
 *            other contact sharing an email or first + last name. One write
 *            per contact, from its most recent in-scope award.
 *
 * Modes (all take --out-dir=<dir outside the repo>):
 *   --resolve (default) READ-ONLY. Classifies every in-scope award and writes
 *       research-pi-iaa-resolve.jsonl (ids only; apply input) and
 *       research-pi-iaa-review.csv (names, for owner review), then prints
 *       counts and the 8-char resolve hash. Options: --since=YYYY-MM-DD.
 *   --apply --confirm=<resolve hash> --approver="<name>" [--contact-accounts] [--first=N]
 *       Re-reads each target, writes with If-Match, re-reads the result, and
 *       appends intent/result lines to research-pi-iaa-applied.jsonl.
 *       Rerunnable: rows with a non-failed result are skipped.
 *   --verify READ-ONLY. Re-reads every target whose latest result is `write`.
 *   --rollback --ids=<file of target ids | all>
 *       Clears a value only where this script's `write` still stands
 *       (unchanged ETag since the post-write read and the same value).
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>" (the
 * Dataverse interlock's local→production write exception).
 *
 * Resolve classes: write, already-set, no-junction-row, multiple-pi-rows,
 * pi-mismatch, no-applicant, other. `write` rows carry contactAccount =
 * same | elsewhere | empty | not-account, and for `empty` contactLink =
 * eligible | duplicate.
 *
 * Acts against whatever .env.local points at. The review CSV holds PI names:
 * keep it out of the repo. The JSONL logs hold ids only.
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
const MODE = flag('apply') ? 'apply' : flag('verify') ? 'verify' : flag('rollback') ? 'rollback' : 'resolve';
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
const RESOLVE_LOG = path.join(outAbs, 'research-pi-iaa-resolve.jsonl');
const REVIEW_CSV = path.join(outAbs, 'research-pi-iaa-review.csv');
const APPLIED_LOG = path.join(outAbs, 'research-pi-iaa-applied.jsonl');
if ((MODE === 'apply' || MODE === 'rollback') && !process.env.DATAVERSE_PROD_WRITE_ACK) {
  const today = new Date().toISOString().slice(0, 10);
  console.error(`Write mode needs DATAVERSE_PROD_WRITE_ACK, e.g. DATAVERSE_PROD_WRITE_ACK="research PI institution at award ${today}"`);
  process.exit(2);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { bypassDynamicsRestrictions } = await import('../lib/services/dynamics-context.js');
const { escape } = await import('../lib/dataverse/core/odata.js');

const AWARDED = ['Approved', 'Active', 'Closed'];
const ROLE_PI = 100000000;
const JUNCTION = 'wmkf_apprequestpersons';
const lc = (v) => (v ? String(v).toLowerCase() : null);
const lcTrim = (v) => (v ? String(v).trim().toLowerCase() : null);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
const host = (() => { try { return new URL(process.env.DYNAMICS_URL).host; } catch { return ''; } })();
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const append = (f, obj) => fs.appendFileSync(f, `${JSON.stringify(obj)}\n`);

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

// ── Write targets. Each target is one field on one record. ──
const TARGETS = {
  iaa: {
    entitySet: JUNCTION,
    select: '_wmkf_institutionataward_value,_wmkf_contact_value,_wmkf_request_value',
    value: (rec) => lc(rec?._wmkf_institutionataward_value),
    bind: (accountId) => ({ 'wmkf_InstitutionAtAward@odata.bind': accountId ? `/accounts(${accountId})` : null }),
  },
  contact: {
    entitySet: 'contacts',
    select: '_parentcustomerid_value,statecode',
    value: (rec) => lc(rec?._parentcustomerid_value),
    bind: (accountId) => ({ 'parentcustomerid_account@odata.bind': accountId ? `/accounts(${accountId})` : null }),
  },
};
const readTarget = (kind, id) => DynamicsService.getRecord(TARGETS[kind].entitySet, id, { select: TARGETS[kind].select });

// ── Resolve ──
const CONTACT_SELECT = 'contactid,fullname,firstname,lastname,emailaddress1,emailaddress2,emailaddress3,_parentcustomerid_value';
const emailsOf = (c) => [c.emailaddress1, c.emailaddress2, c.emailaddress3].map(lcTrim).filter(Boolean);

// Other contacts sharing any email (either direction) or the same first + last name.
async function otherContactCount(c) {
  const clauses = [];
  for (const e of emailsOf(c)) for (const f of ['emailaddress1', 'emailaddress2', 'emailaddress3']) clauses.push(`${f} eq '${escape(e)}'`);
  if (c.firstname && c.lastname) clauses.push(`(firstname eq '${escape(c.firstname.trim())}' and lastname eq '${escape(c.lastname.trim())}')`);
  if (!clauses.length) return 0;
  return (await readAll('contacts', { select: 'contactid', filter: `(${clauses.join(' or ')}) and contactid ne ${c.contactid}` })).length;
}

async function runResolve() {
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

  const piRows = await inBatches(requestIds, 50, (ids) => readAll(JUNCTION, {
    select: 'wmkf_apprequestpersonid,wmkf_assignmentkey,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value',
    filter: `(${ids.map((id) => `_wmkf_request_value eq ${id}`).join(' or ')}) and wmkf_role eq ${ROLE_PI}`,
  }));
  const rowsByRequest = new Map();
  for (const j of piRows) {
    const k = lc(j._wmkf_request_value);
    rowsByRequest.set(k, [...(rowsByRequest.get(k) || []), j]);
  }

  const contactIds = [...new Set([
    ...requests.map((r) => lc(r._wmkf_projectleader_value)),
    ...piRows.map((j) => lc(j._wmkf_contact_value)),
  ].filter(Boolean))];
  const contacts = new Map((await inBatches(contactIds, 50, (ids) => readAll('contacts', {
    select: CONTACT_SELECT,
    filter: ids.map((id) => `contactid eq ${id}`).join(' or '),
  }))).map((c) => [lc(c.contactid), c]));

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

  const classified = requests.map((r) => ({ r, ...classify(r) }));
  // Duplicate check only for contacts that would receive an account.
  const linkStatus = new Map();
  for (const x of classified.filter((y) => y.cls === 'write' && y.contactAccount === 'empty')) {
    const id = lc(x.row._wmkf_contact_value);
    if (!linkStatus.has(id)) linkStatus.set(id, (await otherContactCount(contacts.get(id))) ? 'duplicate' : 'eligible');
  }

  const results = classified.map(({ r, cls, row, reason, contactAccount }) => {
    const leader = contacts.get(lc(r._wmkf_projectleader_value));
    const rowContact = row ? contacts.get(lc(row._wmkf_contact_value)) : null;
    const contactLink = contactAccount === 'empty' ? linkStatus.get(lc(row._wmkf_contact_value)) : null;
    return {
      ids: {
        class: cls,
        host,
        requestId: lc(r.akoya_requestid),
        requestNum: r.akoya_requestnum,
        meetingDate: (r.wmkf_meetingdate || '').slice(0, 10),
        junctionRowId: row ? lc(row.wmkf_apprequestpersonid) : null,
        contactId: row ? lc(row._wmkf_contact_value) : lc(r._wmkf_projectleader_value),
        applicantAccountId: lc(r._akoya_applicantid_value),
        existingInstitutionAtAward: row ? lc(row._wmkf_institutionataward_value) : null,
        contactAccount: contactAccount || null,
        contactLink: contactLink || null,
        reason: reason || null,
      },
      review: {
        class: cls,
        contact_account: contactAccount || '',
        contact_link: contactLink || '',
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

  const jsonl = `${results.map((x) => JSON.stringify(x.ids)).join('\n')}\n`;
  fs.writeFileSync(RESOLVE_LOG, jsonl);
  const cols = Object.keys(results[0]?.review || { class: '' });
  const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  fs.writeFileSync(REVIEW_CSV, `${[cols.join(','), ...results.map((x) => cols.map((k) => csvCell(x.review[k])).join(','))].join('\n')}\n`);

  const count = (pred) => results.filter(pred).length;
  const classes = ['write', 'already-set', 'no-junction-row', 'multiple-pi-rows', 'pi-mismatch', 'no-applicant', 'other'];
  console.log(`\nAwarded Research requests with meeting date >= ${SINCE}: ${requests.length}`);
  for (const k of classes) console.log(`  ${k.padEnd(17)} ${count((x) => x.ids.class === k)}`);
  console.log('  write rows by contact_account:');
  for (const k of ['same', 'elsewhere', 'empty', 'not-account']) console.log(`    ${k.padEnd(12)} ${count((x) => x.ids.class === 'write' && x.ids.contactAccount === k)}`);
  console.log(`  empty-account contacts: ${[...linkStatus.values()].filter((v) => v === 'eligible').length} eligible for an account link, ${[...linkStatus.values()].filter((v) => v === 'duplicate').length} with a possible duplicate`);
  const years = [...new Set(results.map((x) => x.review.meeting_date.slice(0, 4)))].sort();
  console.log('  by meeting year (total / write):');
  for (const y of years) console.log(`    ${y}  ${count((x) => x.review.meeting_date.startsWith(y))} / ${count((x) => x.review.meeting_date.startsWith(y) && x.ids.class === 'write')}`);
  console.log(`\nWrote ${RESOLVE_LOG}`);
  console.log(`Wrote ${REVIEW_CSV}`);
  console.log(`Resolve hash (pass to --apply --confirm=): ${sha(jsonl).slice(0, 8)}`);
}

// ── Plan: the write targets implied by a resolve file. ──
function planTargets(resolved, includeContacts) {
  const writes = resolved.filter((x) => x.class === 'write');
  const plan = writes.map((x) => ({
    kind: 'iaa', id: x.junctionRowId, value: x.applicantAccountId,
    expect: { contact: x.contactId, request: x.requestId }, requestNum: x.requestNum,
  }));
  if (includeContacts) {
    const latestByContact = new Map();
    for (const x of writes.filter((y) => y.contactLink === 'eligible')) {
      const prev = latestByContact.get(x.contactId);
      if (!prev || x.meetingDate > prev.meetingDate) latestByContact.set(x.contactId, x);
    }
    for (const x of latestByContact.values()) plan.push({ kind: 'contact', id: x.contactId, value: x.applicantAccountId, requestNum: x.requestNum });
  }
  return plan;
}

const latestByTarget = () => {
  const m = new Map();
  for (const l of readJsonl(APPLIED_LOG)) m.set(`${l.kind}|${l.id}`, l);
  return m;
};

async function runApply() {
  if (!fs.existsSync(RESOLVE_LOG)) { console.error('No resolve file; run --resolve first.'); process.exit(2); }
  const text = fs.readFileSync(RESOLVE_LOG, 'utf8');
  const hash = sha(text).slice(0, 8);
  if (arg('confirm') !== hash) { console.error(`--confirm must equal the resolve hash ${hash}.`); process.exit(2); }
  const approver = arg('approver');
  if (!approver) { console.error('--approver="<name>" is required'); process.exit(2); }
  const resolved = readJsonl(RESOLVE_LOG);
  if (resolved.some((x) => x.host !== host)) { console.error('Resolve was run against a different Dataverse host. Re-run --resolve.'); process.exit(2); }
  const plan = planTargets(resolved, flag('contact-accounts'));
  const first = Number(arg('first')) || Infinity;
  const latest = latestByTarget();
  const runId = `${now()}-${crypto.randomBytes(3).toString('hex')}`;
  let done = 0; const counts = {};

  await bypassDynamicsRestrictions('research-pi-iaa-apply', async () => {
    for (const t of plan) {
      const key = `${t.kind}|${t.id}`;
      const prev = latest.get(key);
      if (prev?.phase === 'result' && prev.result !== 'failed') continue;
      if (prev?.phase === 'rollback') continue;
      if (done >= first) break;
      done += 1;
      const base = { runId, resolveHash: hash, approver, host, kind: t.kind, id: t.id, value: t.value, requestNum: t.requestNum };
      append(APPLIED_LOG, { ...base, phase: 'intent', at: now() });
      let result; let detail = ''; let etag = null; let after = null;
      try {
        // State can change between resolve and apply (or across an interrupted run): re-read first.
        const cur = await readTarget(t.kind, t.id);
        const curValue = TARGETS[t.kind].value(cur);
        if (!cur) { result = 'missing'; }
        else if (t.kind === 'iaa' && (lc(cur._wmkf_contact_value) !== t.expect.contact || lc(cur._wmkf_request_value) !== t.expect.request)) {
          result = 'changed_since_resolve'; detail = 'junction row now points elsewhere';
        } else if (t.kind === 'contact' && cur.statecode !== 0) { result = 'skipped'; detail = 'contact inactive'; }
        else if (curValue === t.value) {
          // Our own interrupted write, or someone else's identical one: not ours to roll back.
          result = prev?.phase === 'intent' ? 'present_unattributed' : 'already_set';
        } else if (curValue) { result = 'conflict'; detail = `already holds ${curValue}`; }
        else if (!cur._etag) { result = 'skipped'; detail = 'no ETag on re-read'; }
        else {
          try {
            await DynamicsService.updateRecord(TARGETS[t.kind].entitySet, t.id, TARGETS[t.kind].bind(t.value), { ifMatch: cur._etag });
            const post = await readTarget(t.kind, t.id);
            etag = post?._etag || null;
            after = TARGETS[t.kind].value(post);
            result = after === t.value && etag ? 'write' : 'write_then_changed';
          } catch (err) {
            if (err?.status === 412) { result = 'changed_since_resolve'; detail = '412 on write'; } else throw err;
          }
        }
      } catch (err) { result = 'failed'; detail = String(err.message || err).slice(0, 200); }
      const rec = { ...base, phase: 'result', result, detail, postWriteEtag: etag, postWriteValue: after, at: now() };
      append(APPLIED_LOG, rec); latest.set(key, rec);
      counts[`${t.kind}:${result}`] = (counts[`${t.kind}:${result}`] || 0) + 1;
      if (result !== 'write' && result !== 'already_set') console.log(`  ${t.kind} ${t.requestNum} ${result}${detail ? ` (${detail})` : ''}`);
    }
  });
  console.log(`Apply this run: ${JSON.stringify(counts)}. Log: ${APPLIED_LOG}`);
  const rolledBack = plan.filter((t) => latest.get(`${t.kind}|${t.id}`)?.phase === 'rollback').length;
  const pending = plan.filter((t) => { const l = latest.get(`${t.kind}|${t.id}`); return !(l?.phase === 'rollback' || (l?.phase === 'result' && l.result !== 'failed')); }).length;
  console.log(`Targets not yet applied: ${pending} of ${plan.length}; rolled back (never re-applied): ${rolledBack}${flag('contact-accounts') ? '' : ' (contact accounts not included; pass --contact-accounts)'}`);
}

async function runVerify() {
  const all = [...latestByTarget().values()];
  const written = all.filter((l) => l.phase === 'result' && l.result === 'write');
  console.log(`Rolled back (not verified): ${all.filter((l) => l.phase === 'rollback' && l.outcome === 'cleared').length}`);
  let ok = 0; const bad = [];
  await bypassDynamicsRestrictions('research-pi-iaa-verify', async () => {
    for (const l of written) {
      const v = TARGETS[l.kind].value(await readTarget(l.kind, l.id));
      if (v === l.value) ok += 1; else bad.push(`${l.kind} ${l.requestNum} ${l.id} expected ${l.value} found ${v ?? '(empty)'}`);
    }
  });
  const byKind = (k) => written.filter((l) => l.kind === k).length;
  console.log(`Verify: ${ok}/${written.length} written values still hold (iaa ${byKind('iaa')}, contact ${byKind('contact')}).`);
  for (const b of bad) console.log(`  MISMATCH ${b}`);
}

async function runRollback() {
  const ids = arg('ids');
  if (!ids) { console.error('--ids=<file of target ids | all> is required'); process.exit(2); }
  const latest = latestByTarget();
  const wanted = ids === 'all'
    ? [...latest.keys()]
    : fs.readFileSync(ids, 'utf8').split(/\s+/).filter(Boolean).map((s) => s.toLowerCase())
      .flatMap((id) => ['iaa', 'contact'].map((k) => `${k}|${id}`).filter((k) => latest.has(k)));
  const counts = {};
  await bypassDynamicsRestrictions('research-pi-iaa-rollback', async () => {
    for (const key of wanted) {
      const l = latest.get(key);
      let outcome;
      if (!l || l.phase !== 'result' || l.result !== 'write' || !l.postWriteEtag) outcome = 'not_eligible';
      else {
        const cur = await readTarget(l.kind, l.id);
        if (cur?._etag !== l.postWriteEtag || TARGETS[l.kind].value(cur) !== l.value) outcome = 'changed_since_write';
        else {
          try { await DynamicsService.updateRecord(TARGETS[l.kind].entitySet, l.id, TARGETS[l.kind].bind(null), { ifMatch: l.postWriteEtag }); outcome = 'cleared'; }
          catch (err) { outcome = err?.status === 412 ? 'changed_since_write' : `failed: ${String(err.message || err).slice(0, 120)}`; }
        }
      }
      if (l) append(APPLIED_LOG, { runId: l.runId, kind: l.kind, id: l.id, value: l.value, requestNum: l.requestNum, phase: 'rollback', outcome, at: now() });
      counts[outcome] = (counts[outcome] || 0) + 1;
    }
  });
  console.log(`Rollback: ${JSON.stringify(counts)}`);
}

await { resolve: () => bypassDynamicsRestrictions('research-pi-iaa-resolve', runResolve), apply: runApply, verify: runVerify, rollback: runRollback }[MODE]();
