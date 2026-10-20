/**
 * Pure decision logic for scripts/backfill-research-pi-institution-at-award.mjs
 * (plan docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md §3.1).
 * No Dataverse access here, so every rule is unit-tested
 * (tests/unit/research-iaa-backfill.test.js).
 */

export const AWARDED = ['Approved', 'Active', 'Closed'];
export const lc = (v) => (v ? String(v).toLowerCase() : null);

/**
 * Classify one award's PI junction row.
 * @param {object} r akoya_request row (annotated: `_x_value_entity`).
 * @param {object[]} rows PI junction rows on that request.
 * @param {Map<string, object>} contacts contactid (lower) → contact.
 * @returns {{cls: string, row?: object, reason?: string, contactAccount?: string}}
 *   `contactAccount` (same | elsewhere | empty | not-account) is set on `write`
 *   and on `already-set` rows whose applicant is an account, so contact-account
 *   selection can use every validated award, not only those still needing IAA.
 */
export function classifyAward(r, rows, contacts) {
  const leader = lc(r._wmkf_projectleader_value);
  const applicant = lc(r._akoya_applicantid_value);
  if (rows.length === 0) return leader ? { cls: 'no-junction-row' } : { cls: 'other', reason: 'no project leader and no PI row' };
  if (rows.length > 1) return { cls: 'multiple-pi-rows' };
  const row = rows[0];
  const contact = lc(row._wmkf_contact_value);
  if (!leader) return { cls: 'other', row, reason: 'PI row but no project leader' };
  if (contact !== leader) return { cls: 'pi-mismatch', row };
  const applicantIsAccount = applicant && (!r._akoya_applicantid_value_entity || r._akoya_applicantid_value_entity === 'account');
  const c = contacts.get(contact);
  const parent = lc(c?._parentcustomerid_value);
  const contactAccount = !applicantIsAccount ? undefined
    : !parent ? 'empty'
      : c._parentcustomerid_value_entity !== 'account' ? 'not-account'
        : parent === applicant ? 'same' : 'elsewhere';
  if (row._wmkf_institutionataward_value) return { cls: 'already-set', row, contactAccount };
  if (!applicant) return { cls: 'no-applicant', row };
  if (!applicantIsAccount) return { cls: 'other', row, reason: `applicant is a ${r._akoya_applicantid_value_entity}` };
  return { cls: 'write', row, contactAccount };
}

/**
 * Choose the account to set on each empty-account PI contact: the applicant of
 * the contact's latest in-scope award (write or already-set). A tie on the
 * latest meeting date between different applicants is not resolved.
 * @param {object[]} evidence [{ contactId, meetingDate, applicantAccountId, requestId }]
 *   — only awards whose contact has no account and passed the duplicate check.
 * @returns {Map<string, {status: 'selected'|'tie', requestId?: string, accountId?: string}>}
 */
export function pickContactAccounts(evidence) {
  const byContact = new Map();
  for (const e of evidence) byContact.set(e.contactId, [...(byContact.get(e.contactId) || []), e]);
  const out = new Map();
  for (const [contactId, list] of byContact) {
    const latest = list.reduce((m, e) => (e.meetingDate > m ? e.meetingDate : m), '');
    const top = list.filter((e) => e.meetingDate === latest);
    const accounts = new Set(top.map((e) => e.applicantAccountId));
    if (accounts.size > 1) out.set(contactId, { status: 'tie' });
    else out.set(contactId, { status: 'selected', requestId: top[0].requestId, accountId: top[0].applicantAccountId });
  }
  return out;
}

/**
 * Compare a resolved award snapshot with a fresh read before writing.
 * @param {object} snap resolve line (requestId, programId, contactId, junctionRowId, applicantAccountId).
 * @param {{request: object|null, piRows: object[]}} cur fresh request row and its PI junction rows.
 * @returns {string|null} why the source changed, or null when it still matches.
 */
export function sourceDrift(snap, cur) {
  const r = cur.request;
  if (!r) return 'request not found';
  if (!AWARDED.includes(r.akoya_requeststatus)) return `status now ${r.akoya_requeststatus}`;
  if (lc(r._akoya_programid_value) !== snap.programId) return 'program changed';
  if (lc(r._wmkf_projectleader_value) !== snap.contactId) return 'project leader changed';
  if (lc(r._akoya_applicantid_value) !== snap.applicantAccountId) return 'applicant changed';
  if (r._akoya_applicantid_value_entity && r._akoya_applicantid_value_entity !== 'account') return 'applicant is not an account';
  if (cur.piRows.length !== 1) return `${cur.piRows.length} PI rows now`;
  if (lc(cur.piRows[0].wmkf_apprequestpersonid) !== snap.junctionRowId) return 'PI row replaced';
  if (lc(cur.piRows[0]._wmkf_contact_value) !== snap.contactId) return 'PI row contact changed';
  return null;
}

/** Write targets implied by a resolve file. */
export function planTargets(resolved, includeContacts) {
  const plan = resolved.filter((x) => x.class === 'write').map((x) => ({
    kind: 'iaa', id: x.junctionRowId, value: x.applicantAccountId, requestNum: x.requestNum, source: x,
  }));
  if (includeContacts) {
    for (const x of resolved.filter((y) => y.contactLinkSelected)) {
      plan.push({ kind: 'contact', id: x.contactId, value: x.applicantAccountId, requestNum: x.requestNum, source: x });
    }
  }
  return plan;
}

/**
 * Fold the applied log into per-target state. The write receipt (latest
 * `result`) is kept apart from rollback attempts, so a failed rollback stays
 * retryable and the value stays under verify until a clear is confirmed.
 * @returns {Map<string, {receipt: object|null, cleared: boolean, rollbacks: object[], interrupted: boolean}>}
 *   keyed `${kind}|${id}`.
 */
export function foldLedger(lines) {
  const m = new Map();
  for (const l of lines) {
    const key = `${l.kind}|${l.id}`;
    const s = m.get(key) || { receipt: null, cleared: false, rollbacks: [], interrupted: false };
    if (l.phase === 'intent') s.interrupted = true;
    else if (l.phase === 'result') { s.receipt = l; s.interrupted = false; s.cleared = false; s.rollbacks = []; }
    else if (l.phase === 'rollback') { s.rollbacks.push(l); if (l.outcome === 'cleared') s.cleared = true; }
    m.set(key, s);
  }
  return m;
}

/** Apply skips a target once it has a non-failed receipt (including after a confirmed clear). */
export const applyDone = (s) => Boolean(s?.receipt && s.receipt.result !== 'failed');
/** Rollback may act only on this script's own attributed write that is not yet cleared. */
export const rollbackEligible = (s) => Boolean(s?.receipt?.result === 'write' && s.receipt.rollbackEligible && s.receipt.postWriteEtag && !s.cleared);
/** Verify checks every write still standing (not confirmed cleared). */
export const verifyTarget = (s) => Boolean(s?.receipt?.result === 'write' && !s.cleared);
