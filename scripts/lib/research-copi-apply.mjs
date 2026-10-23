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
 *   `newContactAccount` 'pao-contact' means "copy that contact's account".
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
    if (d.newContactAccountFrom === 'pao-contact') out.newContactAccount = 'pao-contact';
    else if (d.newContactAccountId !== undefined) out.newContactAccount = d.newContactAccountId;
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
 * `created`/`set` results are reversible; a later rollback line marks them undone.
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
export const applyDone = (s) => Boolean(s?.receipt && s.receipt.result !== 'failed') || Boolean(s?.undone);
export const REVERSIBLE = new Set(['created', 'set']);
export const rollbackEligible = (s) => Boolean(s?.receipt && REVERSIBLE.has(s.receipt.result) && s.receipt.postEtag && !s.undone);
