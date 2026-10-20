/**
 * backfill-research-pi-institution-at-award.mjs — Stage A of the Research
 * Institution at Award backfill: PI rows on awarded Research requests.
 * Plan: docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.1.
 * Owner-run only. Write/log shape follows apply-research-pi-orcid-backfill.mjs;
 * decision rules live in scripts/lib/research-iaa-backfill.mjs (unit-tested).
 *
 * Scope (owner, 2026-10-20): akoya_requeststatus Approved/Active/Closed,
 * program name contains "research" but not "reviewer" (same as
 * export-research-orcid-backfill-pool.mjs), wmkf_meetingdate >= --since
 * (default 2017-01-01).
 *
 * Two write groups, each applied only when asked:
 *   iaa      Set wmkf_apprequestperson.wmkf_InstitutionAtAward to the
 *            request's applicant account on the PI junction row.
 *   contact  (--contact-accounts) Set contact.parentcustomerid to an applicant
 *            account, only for PI contacts with no account and no other contact
 *            sharing an email or first + last name. The account comes from the
 *            contact's latest in-scope award (IAA already set or not); a tie
 *            between different applicants on that date is not written.
 *
 * Modes (all take --out-dir=<dir outside the repo>):
 *   --resolve (default) READ-ONLY. Classifies every in-scope award and writes
 *       research-pi-iaa-resolve.jsonl (ids only; apply input) and
 *       research-pi-iaa-review.csv (names, for owner review), then prints
 *       counts and the 8-char resolve hash. Options: --since=YYYY-MM-DD.
 *   --apply --confirm=<resolve hash> --approver="<name>" [--contact-accounts] [--first=N]
 *       Per target: re-reads the request and its PI rows and skips any drift
 *       from the resolve snapshot, including the meeting date. Contact targets
 *       also re-collect the contact's in-scope awards and re-run the
 *       latest-award selection and the duplicate search. Then re-reads the
 *       target and writes only an empty value with If-Match, taking the
 *       rollback ETag from the PATCH response itself (return=representation).
 *       Intent/result lines go to research-pi-iaa-applied.jsonl; reruns skip
 *       targets with a non-failed result.
 *   --verify READ-ONLY. Re-reads every written value not confirmed cleared.
 *   --rollback --ids=<file of target ids | all>
 *       Clears a value only where this script's attributed write still stands
 *       (unchanged ETag since the post-write read and the same value). Failed
 *       attempts can be retried; cleared targets are never re-applied.
 * Write modes need DATAVERSE_PROD_WRITE_ACK="<purpose> <YYYY-MM-DD>" (the
 * Dataverse interlock's local→production write exception).
 *
 * Acts against whatever .env.local points at. The review CSV holds PI names:
 * keep it out of the repo. The JSONL logs hold ids only.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  AWARDED, lc, classifyAward, pickContactAccounts, sourceDrift, inScope, contactSelectionDrift, planTargets,
  foldLedger, applyDone, rollbackEligible, verifyTarget,
} from './lib/research-iaa-backfill.mjs';

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
const { fetchWithTimeout, buildHeaders } = await import('../lib/services/dynamics/http.js');
const { escape } = await import('../lib/dataverse/core/odata.js');

const ROLE_PI = 100000000;
const JUNCTION = 'wmkf_apprequestpersons';
const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,_akoya_applicantid_value,_wmkf_projectleader_value';
const PI_ROW_SELECT = 'wmkf_apprequestpersonid,wmkf_assignmentkey,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value';
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
async function getOrNull(entitySet, id, select) {
  try { return await DynamicsService.getRecord(entitySet, id, { select }); }
  catch (err) { if (err?.status === 404) return null; throw err; }
}
const readPiRows = (requestId) => readAll(JUNCTION, { select: PI_ROW_SELECT, filter: `_wmkf_request_value eq ${requestId} and wmkf_role eq ${ROLE_PI}` });

// ── Write targets. Each target is one lookup on one record. ──
const TARGETS = {
  iaa: {
    entitySet: JUNCTION,
    select: '_wmkf_institutionataward_value',
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
const readTarget = (kind, id) => getOrNull(TARGETS[kind].entitySet, id, TARGETS[kind].select);

// ── Duplicate-contact search ──
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

// ── Resolve ──
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
    select: REQUEST_SELECT,
    filter: `(${programFilter}) and (${statusFilter}) and wmkf_meetingdate ge ${SINCE}`,
    orderby: 'wmkf_meetingdate asc',
  });
  const requestIds = requests.map((r) => lc(r.akoya_requestid));

  const piRows = await inBatches(requestIds, 50, (ids) => readAll(JUNCTION, {
    select: PI_ROW_SELECT,
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

  const classified = requests.map((r) => ({ r, ...classifyAward(r, rowsByRequest.get(lc(r.akoya_requestid)) || [], contacts) }));

  // Contact accounts: duplicate check on every empty-account PI contact, then
  // pick each eligible contact's latest award among write and already-set rows.
  const emptyRows = classified.filter((x) => (x.cls === 'write' || x.cls === 'already-set') && x.contactAccount === 'empty');
  const dupStatus = new Map();
  for (const x of emptyRows) {
    const id = lc(x.row._wmkf_contact_value);
    if (!dupStatus.has(id)) dupStatus.set(id, (await otherContactCount(contacts.get(id))) ? 'duplicate' : 'eligible');
  }
  const picks = pickContactAccounts(emptyRows
    .filter((x) => dupStatus.get(lc(x.row._wmkf_contact_value)) === 'eligible')
    .map((x) => ({
      contactId: lc(x.row._wmkf_contact_value),
      meetingDate: (x.r.wmkf_meetingdate || '').slice(0, 10),
      applicantAccountId: lc(x.r._akoya_applicantid_value),
      requestId: lc(x.r.akoya_requestid),
    })));

  const results = classified.map(({ r, cls, row, reason, contactAccount }) => {
    const leader = contacts.get(lc(r._wmkf_projectleader_value));
    const rowContact = row ? contacts.get(lc(row._wmkf_contact_value)) : null;
    const contactId = row ? lc(row._wmkf_contact_value) : lc(r._wmkf_projectleader_value);
    const pick = picks.get(contactId);
    const contactLink = contactAccount !== 'empty' || !row ? null
      : dupStatus.get(contactId) === 'duplicate' ? 'duplicate'
        : pick?.status === 'tie' ? 'tie' : 'eligible';
    const contactLinkSelected = contactLink === 'eligible' && pick?.status === 'selected' && pick.requestId === lc(r.akoya_requestid);
    return {
      ids: {
        class: cls,
        host,
        requestId: lc(r.akoya_requestid),
        requestNum: r.akoya_requestnum,
        programId: lc(r._akoya_programid_value),
        since: SINCE,
        meetingDate: (r.wmkf_meetingdate || '').slice(0, 10),
        junctionRowId: row ? lc(row.wmkf_apprequestpersonid) : null,
        contactId,
        applicantAccountId: lc(r._akoya_applicantid_value),
        existingInstitutionAtAward: row ? lc(row._wmkf_institutionataward_value) : null,
        contactAccount: contactAccount || null,
        contactLink,
        contactLinkSelected,
        reason: reason || null,
      },
      review: {
        class: cls,
        contact_account: contactAccount || '',
        contact_link: contactLink || '',
        contact_link_write: contactLinkSelected ? 'yes' : '',
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
  const dupVals = [...dupStatus.values()];
  console.log(`  empty-account PI contacts: ${dupStatus.size} — ${dupVals.filter((v) => v === 'duplicate').length} possible duplicate, `
    + `${[...picks.values()].filter((p) => p.status === 'tie').length} tie, ${count((x) => x.ids.contactLinkSelected)} contact account writes planned`);
  const years = [...new Set(results.map((x) => x.review.meeting_date.slice(0, 4)))].sort();
  console.log('  by meeting year (total / write):');
  for (const y of years) console.log(`    ${y}  ${count((x) => x.review.meeting_date.startsWith(y))} / ${count((x) => x.review.meeting_date.startsWith(y) && x.ids.class === 'write')}`);
  console.log(`\nWrote ${RESOLVE_LOG}`);
  console.log(`Wrote ${REVIEW_CSV}`);
  console.log(`Resolve hash (pass to --apply --confirm=): ${sha(jsonl).slice(0, 8)}`);
}

// ── Apply ──
// PATCH with Prefer: return=representation, so the ETag recorded for rollback
// is the version this PATCH produced — no separate read that another writer
// (even one using the same app credentials) could slip in front of. Goes
// through the interlocked fetchWithTimeout seam like every Dataverse call.
async function patchReturning(kind, id, body, ifMatch) {
  const token = await DynamicsService.getAccessToken();
  const headers = { ...buildHeaders(token), Prefer: 'return=representation,odata.include-annotations="*"', 'If-Match': ifMatch };
  const url = `${process.env.DYNAMICS_URL}/api/data/v9.2/${TARGETS[kind].entitySet}(${id})?$select=${TARGETS[kind].select}`;
  const res = await fetchWithTimeout(url, { method: 'PATCH', headers, body: JSON.stringify(body) }, 60000);
  if (!res.ok) {
    const err = new Error(`PATCH failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return DynamicsService.processAnnotations(await res.json());
}

// A contact's current in-scope PI awards, for re-running the latest-award selection.
async function contactEvidence(contactId, scope) {
  const rows = await readAll(JUNCTION, { select: PI_ROW_SELECT, filter: `_wmkf_contact_value eq ${contactId} and wmkf_role eq ${ROLE_PI}` });
  const evidence = [];
  // The target re-read already requires this contact's account to be empty.
  const contactsMap = new Map([[contactId, {}]]);
  for (const requestId of new Set(rows.map((j) => lc(j._wmkf_request_value)))) {
    const r = await getOrNull('akoya_requests', requestId, REQUEST_SELECT);
    if (!r || !inScope(r, scope)) continue;
    const c = classifyAward(r, await readPiRows(requestId), contactsMap);
    if ((c.cls === 'write' || c.cls === 'already-set') && c.contactAccount === 'empty') {
      evidence.push({ contactId, meetingDate: (r.wmkf_meetingdate || '').slice(0, 10), applicantAccountId: lc(r._akoya_applicantid_value), requestId });
    }
  }
  return evidence;
}

async function runApply() {
  if (!fs.existsSync(RESOLVE_LOG)) { console.error('No resolve file; run --resolve first.'); process.exit(2); }
  const text = fs.readFileSync(RESOLVE_LOG, 'utf8');
  const hash = sha(text).slice(0, 8);
  if (arg('confirm') !== hash) { console.error(`--confirm must equal the resolve hash ${hash}.`); process.exit(2); }
  const approver = arg('approver');
  if (!approver) { console.error('--approver="<name>" is required'); process.exit(2); }
  const resolved = readJsonl(RESOLVE_LOG);
  if (resolved.some((x) => x.host !== host || !('programId' in x) || !x.since)) { console.error('Resolve file is from another host or an older script version. Re-run --resolve.'); process.exit(2); }
  const scope = { programIds: new Set(resolved.map((x) => x.programId)), since: resolved[0].since };
  const plan = planTargets(resolved, flag('contact-accounts'));
  const first = Number(arg('first')) || Infinity;
  const ledger = foldLedger(readJsonl(APPLIED_LOG));
  const runId = `${now()}-${crypto.randomBytes(3).toString('hex')}`;
  let done = 0; const counts = {};

  await bypassDynamicsRestrictions('research-pi-iaa-apply', async () => {
    for (const t of plan) {
      const key = `${t.kind}|${t.id}`;
      const state = ledger.get(key);
      if (applyDone(state)) continue;
      if (done >= first) break;
      done += 1;
      const base = { runId, resolveHash: hash, approver, host, kind: t.kind, id: t.id, value: t.value, requestNum: t.requestNum };
      append(APPLIED_LOG, { ...base, phase: 'intent', at: now() });
      let result; let detail = ''; let etag = null; let after = null;
      try {
        // The resolve hash authenticates the snapshot, not current eligibility: re-read the source.
        let drift = sourceDrift(t.source, {
          request: await getOrNull('akoya_requests', t.source.requestId, REQUEST_SELECT),
          piRows: await readPiRows(t.source.requestId),
        });
        let dupNow = 0;
        if (!drift && t.kind === 'contact') {
          drift = contactSelectionDrift(t.source, await contactEvidence(t.id, scope));
          const c = drift ? null : await getOrNull('contacts', t.id, CONTACT_SELECT);
          dupNow = c ? await otherContactCount(c) : 0;
        }
        const cur = drift || dupNow ? null : await readTarget(t.kind, t.id);
        const curValue = TARGETS[t.kind].value(cur);
        if (drift) { result = 'changed_since_resolve'; detail = drift; }
        else if (dupNow) { result = 'skipped'; detail = 'possible duplicate contact now exists'; }
        else if (!cur) { result = 'missing'; }
        else if (t.kind === 'contact' && cur.statecode !== 0) { result = 'skipped'; detail = 'contact inactive'; }
        else if (curValue === t.value) {
          // Our own interrupted write, or someone else's identical one: not ours to roll back.
          result = state?.interrupted ? 'present_unattributed' : 'already_set';
        } else if (curValue) { result = 'conflict'; detail = `already holds ${curValue}`; }
        else if (!cur._etag) { result = 'skipped'; detail = 'no ETag on re-read'; }
        else {
          try {
            const post = await patchReturning(t.kind, t.id, TARGETS[t.kind].bind(t.value), cur._etag);
            etag = post?._etag || null;
            after = TARGETS[t.kind].value(post);
            result = after === t.value ? 'write' : 'write_then_changed';
            if (result === 'write' && !etag) detail = 'no ETag in write response; rollback disabled';
          } catch (err) {
            if (err?.status === 412) { result = 'changed_since_resolve'; detail = '412 on write'; } else throw err;
          }
        }
      } catch (err) { result = 'failed'; detail = String(err.message || err).slice(0, 200); }
      const rec = { ...base, phase: 'result', result, detail, postWriteEtag: etag, postWriteValue: after, rollbackEligible: result === 'write' && Boolean(etag), at: now() };
      append(APPLIED_LOG, rec);
      ledger.set(key, { receipt: rec, cleared: false, rollbacks: [], interrupted: false });
      counts[`${t.kind}:${result}`] = (counts[`${t.kind}:${result}`] || 0) + 1;
      if (result !== 'already_set' && (result !== 'write' || detail)) console.log(`  ${t.kind} ${t.requestNum} ${result}${detail ? ` (${detail})` : ''}`);
    }
  });
  console.log(`Apply this run: ${JSON.stringify(counts)}. Log: ${APPLIED_LOG}`);
  const pending = plan.filter((t) => !applyDone(ledger.get(`${t.kind}|${t.id}`))).length;
  const cleared = plan.filter((t) => ledger.get(`${t.kind}|${t.id}`)?.cleared).length;
  console.log(`Targets not yet applied: ${pending} of ${plan.length}; rolled back (never re-applied): ${cleared}${flag('contact-accounts') ? '' : ' (contact accounts not included; pass --contact-accounts)'}`);
}

async function runVerify() {
  const ledger = foldLedger(readJsonl(APPLIED_LOG));
  const states = [...ledger.values()];
  const written = states.filter(verifyTarget).map((s) => s.receipt);
  let ok = 0; const bad = [];
  await bypassDynamicsRestrictions('research-pi-iaa-verify', async () => {
    for (const l of written) {
      const v = TARGETS[l.kind].value(await readTarget(l.kind, l.id));
      if (v === l.value) ok += 1; else bad.push(`${l.kind} ${l.requestNum} ${l.id} expected ${l.value} found ${v ?? '(empty)'}`);
    }
  });
  const byKind = (k) => written.filter((l) => l.kind === k).length;
  console.log(`Verify: ${ok}/${written.length} written values still hold (iaa ${byKind('iaa')}, contact ${byKind('contact')}).`);
  console.log(`Confirmed rolled back: ${states.filter((s) => s.cleared).length}; writes not rollback-eligible: ${written.filter((l) => !l.rollbackEligible).length}`);
  for (const b of bad) console.log(`  MISMATCH ${b}`);
}

async function runRollback() {
  const ids = arg('ids');
  if (!ids) { console.error('--ids=<file of target ids | all> is required'); process.exit(2); }
  const ledger = foldLedger(readJsonl(APPLIED_LOG));
  const wanted = ids === 'all'
    ? [...ledger.keys()]
    : fs.readFileSync(ids, 'utf8').split(/\s+/).filter(Boolean).map((s) => s.toLowerCase())
      .flatMap((id) => ['iaa', 'contact'].map((k) => `${k}|${id}`).filter((k) => ledger.has(k)));
  const counts = {};
  await bypassDynamicsRestrictions('research-pi-iaa-rollback', async () => {
    for (const key of wanted) {
      const s = ledger.get(key);
      if (s?.cleared) { counts.already_cleared = (counts.already_cleared || 0) + 1; continue; }
      const l = s?.receipt;
      let outcome;
      if (!rollbackEligible(s)) outcome = 'not_eligible';
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

await {
  resolve: () => bypassDynamicsRestrictions('research-pi-iaa-resolve', runResolve),
  apply: runApply,
  verify: runVerify,
  rollback: runRollback,
}[MODE]();
