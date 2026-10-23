/**
 * research-copi-apply.mjs — pure rules for the Stage B apply of the Research
 * Institution at Award backfill (plan
 * docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.2–3.4).
 * The resolve run stays the frozen evidence snapshot; this module overlays the
 * owner's workbook approvals and the decisions file on it, row by row, and
 * builds the create payloads and the apply ledger. No I/O.
 * Tests: tests/unit/research-copi-apply.test.js.
 */

import { approvalBucket } from './research-copi-stage-b.mjs';

export const ROLE_COPI = 100000001;
export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

// ── Decisions file ──

/**
 * One decisions-file row. Account columns hold a GUID, the literal `none` (a
 * deliberate empty value) or nothing (no decision). Anything else throws, so a
 * typo never reaches an OData filter or a lookup bind.
 */
export function parseDecision(row) {
  const account = (col) => {
    const v = String(row[col] ?? '').trim().toLowerCase();
    if (!v) return undefined;
    if (v === 'none') return '';
    if (!GUID.test(v)) throw new Error(`decisions ${row.key}: ${col} is not a GUID or "none": ${v}`);
    return v;
  };
  const email = (col) => {
    const v = String(row[col] ?? '').trim().toLowerCase();
    if (v && !EMAIL.test(v)) throw new Error(`decisions ${row.key}: ${col} is not an email address: ${v}`);
    return v || undefined;
  };
  const contactDecision = String(row.contactDecision ?? '').trim() || undefined;
  if (contactDecision && !['same-person', 'new-person', 'blocked'].includes(contactDecision)) {
    throw new Error(`decisions ${row.key}: unknown contactDecision ${contactDecision}`);
  }
  return {
    key: row.key,
    contactDecision,
    existingContactEmail: email('existingContactEmail'),
    iaaAccountId: account('iaaAccountId'),
    contactAccountId: account('contactAccountId'),
    newContactAccountId: account('newContactAccountId'),
    newContactAccountFrom: String(row.newContactAccountFrom ?? '').trim() || undefined,
    email: email('email'),
    updateEmail: email('updateEmail'),
    updateAccountName: String(row.updateAccountName ?? '').trim() || undefined,
  };
}

// ── Row selection ──

const HELD = (reason) => ({ include: false, reason });
const BLOCKED_CLASSES = new Set(['is-pi', 'is-liaison']);
// Classes the staff answers can settle when they supply the missing facts.
const STAFF_SETTLED = new Set(['possible-existing-contact', 'no-account-match', 'conflicting-evidence']);

/**
 * Whether one resolve line is written, and with what values.
 * @param {object} line resolve line
 * @param {{approvedGroups: Set<string>, excluded: Set<string>, checks: Map<string,string>, decision?: object}} ctx
 *   `checks` maps "<check type>|<line key>" to the owner's v3 answer.
 * @returns {{include: boolean, reason?: string, kind?: string, iaaAccountId?: string,
 *   contact?: {mode: 'existing'|'lookup'|'new', contactId?: string, email?: string},
 *   newContactAccount?: string, contactAccountId?: string}}
 *   `iaaAccountId` and `newContactAccount` may be '' (written empty / not set);
 *   `copyAccountOf` names the line whose resolved contact's current account a new contact copies.
 */
export function selectLine(line, ctx) {
  const d = ctx.decision || {};
  if (d.contactDecision === 'blocked') return HELD('owner-blocked');
  if (BLOCKED_CLASSES.has(line.class)) return HELD(line.class);
  if (ctx.excluded.has(line.key)) return HELD('excluded');
  const bucket = approvalBucket(line);
  const groupOk = Boolean(bucket.group && ctx.approvedGroups.has(bucket.group));
  const answer = (type) => ctx.checks.get(`${type}|${line.key}`);

  if (line.cohort === 'contact') {
    const accountId = d.contactAccountId !== undefined ? d.contactAccountId
      : line.class === 'ready' && groupOk ? line.contactAccountTarget : undefined;
    if (accountId === undefined) return HELD(line.class === 'ready' ? 'group-not-approved' : line.class);
    if (!accountId) return HELD('owner-left-empty');
    return { include: true, kind: 'contact-account', contactAccountId: accountId };
  }

  const iaaAccountId = d.iaaAccountId !== undefined ? d.iaaAccountId : line.iaaAccountId || '';

  if (line.cohort === 'recorded') {
    if (line.class === 'ready') {
      if (!groupOk) return HELD('group-not-approved');
      if (answer('recorded-unanswered') !== undefined && answer('recorded-unanswered') !== 'Yes') return HELD('check-not-approved');
    } else if (!(STAFF_SETTLED.has(line.class) && d.iaaAccountId !== undefined)) return HELD(line.class);
    if (!iaaAccountId) return HELD('no-institution');
    return { include: true, kind: 'recorded', iaaAccountId, contact: { mode: 'existing', contactId: line.contactId } };
  }

  // extracted
  if (line.class === 'ready') {
    if (bucket.group) {
      if (!groupOk) return HELD('group-not-approved');
    } else if (bucket.checks.includes('single-signal')) {
      if (d.iaaAccountId === undefined) return HELD('check-unanswered');
    } else return HELD('no-approval-route');
  } else if (STAFF_SETTLED.has(line.class)) {
    if (d.iaaAccountId === undefined) return HELD(line.class);
    if (line.class === 'possible-existing-contact' && !d.contactDecision) return HELD(line.class);
  } else return HELD(line.class);

  let contact;
  if (d.contactDecision === 'same-person') {
    if (!d.existingContactEmail) return HELD('same-person-without-email');
    contact = { mode: 'lookup', email: d.existingContactEmail };
  } else if (d.contactDecision === 'new-person' || (!line.contactId && line.contactMatch === 'new-contact')) {
    contact = { mode: 'new' };
  } else if (line.contactId) {
    contact = { mode: 'existing', contactId: line.contactId };
  } else return HELD('no-contact');

  const out = { include: true, kind: 'extracted', iaaAccountId, contact };
  if (contact.mode === 'new') {
    if (d.newContactAccountFrom?.startsWith('copy-account-of:')) { out.copyAccountOf = d.newContactAccountFrom.slice('copy-account-of:'.length); out.newContactAccount = ''; } else if (d.newContactAccountId !== undefined) out.newContactAccount = d.newContactAccountId;
    else if (bucket.checks.includes('web-suggestion') && answer('web-suggestion') === 'Yes') out.newContactAccount = line.suggestedContactAccount || '';
    else out.newContactAccount = '';
  } else if (d.contactAccountId) {
    out.contactAccountId = d.contactAccountId;
  }
  return out;
}

// ── Payloads ──

const HONORIFIC = /^(dr|prof|professor|mr|mrs|ms)\.?$/i;
const SUFFIX = /^(jr|sr|ii|iii|iv|phd|md)\.?,?$/i;
/**
 * First / middle / last for a new contact, keeping the proposal's spelling
 * and case. Parenthesized nicknames ("Ahmad (Mo) Khalil") are dropped.
 */
export function splitName(name) {
  const tokens = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/,/g, ' ').split(/\s+/).filter(Boolean)
    .filter((t) => !HONORIFIC.test(t));
  while (tokens.length > 2 && SUFFIX.test(tokens.at(-1))) tokens.pop();
  if (tokens.length < 2) return null;
  return { firstname: tokens[0], middlename: tokens.slice(1, -1).join(' ') || undefined, lastname: tokens.at(-1) };
}

export function contactCreatePayload({ contactId, name, email, accountId }) {
  if (!GUID.test(contactId || '')) throw new Error('contactCreatePayload: contactId must be a GUID');
  const parts = splitName(name);
  if (!parts) throw new Error(`contactCreatePayload: cannot split name "${name}"`);
  return {
    contactid: contactId,
    firstname: parts.firstname,
    ...(parts.middlename ? { middlename: parts.middlename } : {}),
    lastname: parts.lastname,
    ...(email ? { emailaddress1: email } : {}),
    ...(accountId ? { 'parentcustomerid_account@odata.bind': `/accounts(${accountId})` } : {}),
  };
}

/** Junction row; PascalCase binds (lowercase keys are a 0x80048d19 400). */
export function junctionCreatePayload({ junctionId, requestId, requestNum, contactId, iaaAccountId, position }) {
  for (const [k, v] of Object.entries({ junctionId, requestId, contactId })) {
    if (!GUID.test(v || '')) throw new Error(`junctionCreatePayload: ${k} must be a GUID`);
  }
  if (iaaAccountId && !GUID.test(iaaAccountId)) throw new Error('junctionCreatePayload: iaaAccountId must be a GUID');
  return {
    wmkf_apprequestpersonid: junctionId,
    'wmkf_Request@odata.bind': `/akoya_requests(${requestId})`,
    'wmkf_Contact@odata.bind': `/contacts(${contactId})`,
    wmkf_role: ROLE_COPI,
    wmkf_assignmentkey: `${requestNum}-Co-PI-${position}`,
    ...(iaaAccountId ? { 'wmkf_InstitutionAtAward@odata.bind': `/accounts(${iaaAccountId})` } : {}),
  };
}

// ── Ledger ──

/**
 * Fold the apply log into per-target state. Targets are keyed "<kind>|<id>".
 * `interrupted` means an intent line has no result after it: the write may or
 * may not have committed. A later rollback line marks the target undone.
 */
export function foldLedger(lines) {
  const m = new Map();
  for (const l of lines) {
    const key = `${l.kind}|${l.id}`;
    const s = m.get(key) || { receipt: null, undone: false, interrupted: false };
    if (l.phase === 'intent') s.interrupted = true;
    if (l.phase === 'result') { s.receipt = l; s.interrupted = false; }
    if (l.phase === 'rollback' && (l.outcome === 'deleted' || l.outcome === 'cleared' || l.outcome === 'restored')) s.undone = true;
    m.set(key, s);
  }
  return m;
}
// `failed` and `blocked` (a prerequisite not done yet) are retried on the next run.
const RETRY = new Set(['failed', 'blocked']);
export const applyDone = (s) => Boolean(s?.receipt && !RETRY.has(s.receipt.result)) || Boolean(s?.undone);
// A write whose outcome this script cannot be sure of: interrupted, or failed after sending.
export const uncertain = (s) => Boolean(s?.interrupted || s?.receipt?.result === 'failed');
/**
 * `created`/`set` were observed in the write response. `recovered` was found
 * after an uncertain run in exactly the planned state; an edit between that
 * write and the recovery cannot be ruled out, so its rollback needs an explicit
 * opt-in. `recovered_modified` is never rolled back automatically.
 */
export function rollbackEligible(s, { includeRecovered = false } = {}) {
  if (!s?.receipt || s.undone || !s.receipt.postEtag) return false;
  return s.receipt.result === 'created' || s.receipt.result === 'set' || (includeRecovered && s.receipt.result === 'recovered');
}

// ── Apply ──

export const JUNCTION = 'wmkf_apprequestpersons';
export const AWARDED_STATUSES = ['Approved', 'Active', 'Closed'];
export const REQUEST_SELECT = 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,akoya_requeststatus,statecode,_akoya_applicantid_value,_wmkf_projectleader_value,_akoya_primarycontactid_value';
export const ROW_SELECT = 'wmkf_apprequestpersonid,wmkf_role,_wmkf_request_value,_wmkf_contact_value,_wmkf_institutionataward_value';
export const CONTACT_SELECT = 'contactid,statecode,firstname,middlename,lastname,emailaddress1,emailaddress2,emailaddress3,_parentcustomerid_value';
const id = (v) => (v ? String(v).trim().toLowerCase() : '');
const bindId = (v) => id(String(v || '').match(/\(([^)]+)\)/)?.[1]);

/** Why an awarded request no longer matches its plan snapshot ('' when it does). */
export function requestDrift(src, r) {
  if (!r) return 'request missing';
  if (r.statecode !== 0 || !AWARDED_STATUSES.includes(r.akoya_requeststatus)) return 'request no longer awarded/active';
  if ((r.wmkf_meetingdate || '').slice(0, 10) !== src.meetingDate) return 'meeting date changed';
  if (id(r._akoya_applicantid_value) !== src.applicantId) return 'applicant changed';
  if (id(r._wmkf_projectleader_value) !== src.projectLeaderId) return 'PI changed';
  return '';
}
/** Whether a contact read back still holds exactly what the create sent. */
export function contactMatchesPayload(c, p) {
  return (c.firstname || '') === (p.firstname || '') && (c.middlename || '') === (p.middlename || '') && (c.lastname || '') === (p.lastname || '')
    && id(c.emailaddress1) === id(p.emailaddress1) && id(c._parentcustomerid_value) === bindId(p['parentcustomerid_account@odata.bind']);
}
export function junctionMatchesPayload(j, p) {
  return id(j._wmkf_request_value) === bindId(p['wmkf_Request@odata.bind']) && id(j._wmkf_contact_value) === bindId(p['wmkf_Contact@odata.bind'])
    && j.wmkf_role === p.wmkf_role && id(j._wmkf_institutionataward_value) === bindId(p['wmkf_InstitutionAtAward@odata.bind']);
}
const SETS = {
  'iaa-set': { entitySet: JUNCTION, select: ROW_SELECT, value: (r) => id(r?._wmkf_institutionataward_value), bind: (v) => ({ 'wmkf_InstitutionAtAward@odata.bind': v ? `/accounts(${v})` : null }) },
  'contact-account-set': { entitySet: 'contacts', select: CONTACT_SELECT, value: (r) => id(r?._parentcustomerid_value), bind: (v) => ({ 'parentcustomerid_account@odata.bind': v ? `/accounts(${v})` : null }) },
};
export const SET_TARGETS = SETS;
const contactState = (c) => ({ emailaddress1: id(c.emailaddress1), emailaddress2: id(c.emailaddress2), parentcustomerid: id(c._parentcustomerid_value) });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The per-operation write step, with Dataverse access injected so failures can
 * be replayed in tests. io: getOrNull(entitySet, id, select), activeContactsWithEmail(email),
 * rowsForRequest(requestId), create(entitySet, payload) -> record with _etag,
 * patch(entitySet, id, select, body, ifMatch) -> record with _etag (throws err.status 412 on ETag mismatch).
 * Returns the result fields for the ledger line.
 */
export function makeApplier(io) {
  const guarded = async (fn) => {
    try { return await fn(); } catch (err) { if (err?.status === 412) return { result: 'changed_since_plan', detail: '412 on write' }; throw err; }
  };
  return async function applyOp(o, ledger) {
    const state = ledger.get(`${o.op}|${o.id}`);
    const unsure = uncertain(state);
    if (o.op === 'contact-create') {
      // The id was minted by the plan, so a record with it is this script's own create.
      const found = await io.getOrNull('contacts', o.id, CONTACT_SELECT);
      if (found) return contactMatchesPayload(found, o.payload) ? { result: 'recovered', postEtag: found._etag } : { result: 'recovered_modified', detail: 'edited since created' };
      if (o.payload.emailaddress1 && (await io.activeContactsWithEmail(o.payload.emailaddress1)).length) return { result: 'skipped', detail: 'email now held by an active contact' };
      const drift = requestDrift(o.source, await io.getOrNull('akoya_requests', o.source.requestId, REQUEST_SELECT));
      if (drift) return { result: 'changed_since_plan', detail: drift };
      const rec = await io.create('contacts', o.payload);
      return { result: 'created', postEtag: rec?._etag || null };
    }
    if (o.op === 'junction-create') {
      if (o.newContact) {
        const c = ledger.get(`contact-create|${o.contactId}`);
        if (c?.receipt?.result === 'recovered_modified') return { result: 'blocked', detail: 'its new contact was edited after creation; owner to reconcile' };
        if (!['created', 'recovered'].includes(c?.receipt?.result) || c.undone) return { result: 'blocked', detail: 'its new contact is not created yet' };
      }
      // Re-read the contact now: a stored receipt says nothing about edits since.
      const contact = await io.getOrNull('contacts', o.contactId, CONTACT_SELECT);
      if (!contact || contact.statecode !== 0) return { result: 'blocked', detail: 'contact missing or inactive; owner to reconcile' };
      if (o.newContact && !contactMatchesPayload(contact, o.contactPayload || {})) return { result: 'blocked', detail: 'its new contact was edited after creation; owner to reconcile' };
      const found = await io.getOrNull(JUNCTION, o.id, ROW_SELECT);
      if (found) return junctionMatchesPayload(found, o.payload) ? { result: 'recovered', postEtag: found._etag } : { result: 'recovered_modified', detail: 'edited since created' };
      const r = await io.getOrNull('akoya_requests', o.source.requestId, REQUEST_SELECT);
      const drift = requestDrift(o.source, r);
      if (drift) return { result: 'changed_since_plan', detail: drift };
      if ([id(r._wmkf_projectleader_value), id(r._akoya_primarycontactid_value)].includes(id(o.contactId))) return { result: 'skipped', detail: 'contact is the PI or primary contact' };
      if ((await io.rowsForRequest(o.source.requestId)).some((j) => id(j._wmkf_contact_value) === id(o.contactId))) return { result: 'skipped', detail: 'contact already has a row on this request' };
      const rec = await io.create(JUNCTION, o.payload);
      return { result: 'created', postEtag: rec?._etag || null };
    }
    if (o.op === 'iaa-set' || o.op === 'contact-account-set') {
      const t = SETS[o.op];
      const cur = await io.getOrNull(t.entitySet, o.id, t.select);
      if (!cur) return { result: 'missing' };
      if (o.op === 'iaa-set') {
        const e = o.expect || {};
        if (id(cur._wmkf_request_value) !== e.requestId || id(cur._wmkf_contact_value) !== e.contactId || cur.wmkf_role !== e.role) return { result: 'changed_since_plan', detail: 'row request/contact/role changed' };
        const drift = requestDrift(o.source, await io.getOrNull('akoya_requests', o.source.requestId, REQUEST_SELECT));
        if (drift) return { result: 'changed_since_plan', detail: drift };
      } else if (cur.statecode !== 0) return { result: 'skipped', detail: 'contact inactive' };
      const v = t.value(cur);
      if (v === o.value) return unsure ? { result: 'recovered', postEtag: cur._etag } : { result: 'already_set' };
      if (v) return { result: 'conflict', detail: `already holds ${v}` };
      if (!cur._etag) return { result: 'skipped', detail: 'no ETag on re-read' };
      // If-Match on the same read that passed the checks above.
      return guarded(async () => {
        const post = await io.patch(t.entitySet, o.id, t.select, t.bind(o.value), cur._etag);
        return { result: t.value(post) === o.value ? 'set' : 'write_then_changed', postEtag: post?._etag || null };
      });
    }
    if (o.op === 'contact-update') {
      const cur = await io.getOrNull('contacts', o.id, CONTACT_SELECT);
      if (!cur) return { result: 'missing' };
      const now = contactState(cur);
      if (unsure && same(now, o.after)) return { result: 'recovered', postEtag: cur._etag };
      if (!same(now, o.before)) return { result: 'changed_since_plan', detail: 'contact email/account changed' };
      const body = { emailaddress1: o.after.emailaddress1, emailaddress2: o.after.emailaddress2 || null, 'parentcustomerid_account@odata.bind': `/accounts(${o.after.parentcustomerid})` };
      return guarded(async () => {
        const post = await io.patch('contacts', o.id, CONTACT_SELECT, body, cur._etag);
        return { result: same(contactState(post), o.after) ? 'set' : 'write_then_changed', postEtag: post?._etag || null };
      });
    }
    throw new Error(`unknown op ${o.op}`);
  };
}

/**
 * The apply loop shared by the script and the tests. The ledger passed to each
 * operation is the state from earlier runs plus earlier operations in this run;
 * this run's own intent line is logged but not folded in first, so `uncertain`
 * reflects only a previous interrupted or failed attempt.
 * @param {{ops: object[], ledger: Map, applyOp: Function, log: (line: object) => void, base?: (o: object) => object, first?: number}} args
 * @returns {Promise<Record<string, number>>} counts by "<op>:<result>"
 */
export async function runOperations({ ops, ledger, applyOp, log, base = () => ({}), first = Infinity }) {
  let done = 0; const counts = {};
  for (const o of ops) {
    const key = `${o.op}|${o.id}`;
    if (applyDone(ledger.get(key))) continue;
    if (done >= first) break;
    done += 1;
    const b = { ...base(o), kind: o.op, id: o.id, requestNum: o.source?.requestNum || '' };
    log({ ...b, phase: 'intent', at: new Date().toISOString() });
    let out;
    try { out = await applyOp(o, ledger); } catch (err) { out = { result: 'failed', detail: String(err.message || err).slice(0, 200) }; }
    const rec = { ...b, phase: 'result', ...out, at: new Date().toISOString() };
    log(rec);
    ledger.set(key, { receipt: rec, undone: false, interrupted: false });
    counts[`${o.op}:${out.result}`] = (counts[`${o.op}:${out.result}`] || 0) + 1;
  }
  return counts;
}

/** Re-planning would orphan the writes recorded against the current plan. */
export function planOverwriteBlocked(appliedLines) {
  return appliedLines.some((l) => l.phase === 'intent' || l.phase === 'result' || l.phase === 'rollback');
}
/** The one plan hash an apply log was written against (verify/rollback load that plan). */
export function ledgerPlanHash(appliedLines) {
  const hashes = [...new Set(appliedLines.map((l) => l.planHash).filter(Boolean))];
  if (hashes.length > 1) throw new Error(`apply log mixes plans ${hashes.join(', ')}`);
  return hashes[0] || null;
}
