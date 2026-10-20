/**
 * @jest-environment node
 */
import {
  classifyAward, pickContactAccounts, sourceDrift, inScope, contactSelectionDrift, planTargets,
  foldLedger, applyDone, rollbackEligible, verifyTarget,
} from '../../scripts/lib/research-iaa-backfill.mjs';

const A = 'acc-a'; const B = 'acc-b'; const P = 'c-p'; const Q = 'c-q';
const req = (o = {}) => ({
  akoya_requestid: 'R1', akoya_requeststatus: 'Active', _akoya_programid_value: 'prog', wmkf_meetingdate: '2025-06-01T00:00:00Z',
  _wmkf_projectleader_value: P, _akoya_applicantid_value: A, _akoya_applicantid_value_entity: 'account', ...o,
});
const row = (o = {}) => ({ wmkf_apprequestpersonid: 'J1', _wmkf_contact_value: P, _wmkf_institutionataward_value: null, ...o });
const contacts = (parent, entity = 'account') => new Map([[P, parent ? { _parentcustomerid_value: parent, _parentcustomerid_value_entity: entity } : {}]]);

describe('classifyAward', () => {
  test.each([
    ['write, contact at applicant', req(), [row()], contacts(A), 'write', 'same'],
    ['write, contact elsewhere', req(), [row()], contacts(B), 'write', 'elsewhere'],
    ['write, contact without account', req(), [row()], contacts(null), 'write', 'empty'],
    ['write, contact parent is a contact', req(), [row()], contacts(Q, 'contact'), 'write', 'not-account'],
    ['already set keeps contact status', req(), [row({ _wmkf_institutionataward_value: A })], contacts(null), 'already-set', 'empty'],
    ['PI row names someone else', req(), [row({ _wmkf_contact_value: Q })], contacts(A), 'pi-mismatch', undefined],
    ['two PI rows', req(), [row(), row({ _wmkf_contact_value: Q })], contacts(A), 'multiple-pi-rows', undefined],
    ['no PI row', req(), [], contacts(A), 'no-junction-row', undefined],
    ['no applicant', req({ _akoya_applicantid_value: null }), [row()], contacts(A), 'no-applicant', undefined],
    ['applicant is a contact', req({ _akoya_applicantid_value_entity: 'contact' }), [row()], contacts(A), 'other', undefined],
    ['PI row without project leader', req({ _wmkf_projectleader_value: null }), [row()], contacts(A), 'other', undefined],
    ['ids compared case-insensitively', req(), [row({ _wmkf_contact_value: 'C-P' })], new Map([[P, { _parentcustomerid_value: 'ACC-A', _parentcustomerid_value_entity: 'account' }]]), 'write', 'same'],
  ])('%s', (_name, r, rows, cs, cls, contactAccount) => {
    const out = classifyAward(r, rows, cs);
    expect(out.cls).toBe(cls);
    expect(out.contactAccount).toBe(contactAccount);
  });
});

describe('pickContactAccounts (Codex finding 3)', () => {
  test('uses the latest award even when its IAA is already set', () => {
    // Evidence includes already-set awards; the older write-class award must not win.
    const picks = pickContactAccounts([
      { contactId: P, meetingDate: '2019-06-01', applicantAccountId: A, requestId: 'old' },
      { contactId: P, meetingDate: '2025-06-01', applicantAccountId: B, requestId: 'new' },
    ]);
    expect(picks.get(P)).toEqual({ status: 'selected', requestId: 'new', accountId: B });
  });
  test('a same-date tie between different applicants is not resolved', () => {
    const picks = pickContactAccounts([
      { contactId: P, meetingDate: '2025-06-01', applicantAccountId: A, requestId: 'r1' },
      { contactId: P, meetingDate: '2025-06-01', applicantAccountId: B, requestId: 'r2' },
    ]);
    expect(picks.get(P)).toEqual({ status: 'tie' });
  });
  test('a same-date pair at one applicant is selected', () => {
    const picks = pickContactAccounts([
      { contactId: P, meetingDate: '2025-06-01', applicantAccountId: A, requestId: 'r1' },
      { contactId: P, meetingDate: '2025-06-01', applicantAccountId: A, requestId: 'r2' },
    ]);
    expect(picks.get(P).status).toBe('selected');
    expect(picks.get(P).accountId).toBe(A);
  });
});

describe('sourceDrift (Codex finding 1)', () => {
  const snap = { requestId: 'r1', programId: 'prog', meetingDate: '2025-06-01', contactId: P, junctionRowId: 'j1', applicantAccountId: A };
  const fresh = (o = {}, piRows = [row()]) => ({ request: req(o), piRows });
  test('unchanged source passes', () => {
    expect(sourceDrift(snap, fresh())).toBeNull();
  });
  test.each([
    ['request gone', { request: null, piRows: [] }, 'request not found'],
    ['status left the awarded set', fresh({ akoya_requeststatus: 'Withdrawn' }), 'status now Withdrawn'],
    ['program changed', fresh({ _akoya_programid_value: 'other' }), 'program changed'],
    ['meeting date moved out of scope', fresh({ wmkf_meetingdate: '2010-06-01T00:00:00Z' }), 'meeting date changed'],
    ['applicant corrected', fresh({ _akoya_applicantid_value: B }), 'applicant changed'],
    ['project leader changed', fresh({ _wmkf_projectleader_value: Q }), 'project leader changed'],
    ['second PI row added', fresh({}, [row(), row({ wmkf_apprequestpersonid: 'j2', _wmkf_contact_value: Q })]), '2 PI rows now'],
    ['PI row replaced', fresh({}, [row({ wmkf_apprequestpersonid: 'j9' })]), 'PI row replaced'],
    ['PI row contact changed', fresh({}, [row({ _wmkf_contact_value: Q })]), 'PI row contact changed'],
  ])('%s', (_name, cur, reason) => {
    expect(sourceDrift(snap, cur)).toBe(reason);
  });
});

describe('inScope', () => {
  const scope = { programIds: new Set(['prog']), since: '2017-01-01' };
  test('awarded, in program, on or after the floor', () => {
    expect(inScope(req(), scope)).toBe(true);
    expect(inScope(req({ wmkf_meetingdate: '2017-01-01T00:00:00Z' }), scope)).toBe(true);
  });
  test.each([
    ['before the floor', { wmkf_meetingdate: '2016-12-31T00:00:00Z' }],
    ['other program', { _akoya_programid_value: 'other' }],
    ['not awarded', { akoya_requeststatus: 'Declined' }],
  ])('%s is out of scope', (_name, o) => {
    expect(inScope(req(o), scope)).toBe(false);
  });
});

describe('contactSelectionDrift (Codex re-review finding 2)', () => {
  const snap = { contactId: P, requestId: 'r1', applicantAccountId: A };
  const ev = (requestId, meetingDate, applicantAccountId) => ({ contactId: P, requestId, meetingDate, applicantAccountId });
  test('selection unchanged', () => {
    expect(contactSelectionDrift(snap, [ev('r0', '2019-06-01', B), ev('r1', '2025-06-01', A)])).toBeNull();
  });
  test('a newer award now exists', () => {
    expect(contactSelectionDrift(snap, [ev('r1', '2025-06-01', A), ev('r2', '2026-06-01', B)])).toBe('a different award is now latest');
  });
  test('a same-date tie has appeared', () => {
    expect(contactSelectionDrift(snap, [ev('r1', '2025-06-01', A), ev('r2', '2025-06-01', B)])).toBe('latest awards now tie');
  });
  test('the selected award no longer qualifies', () => {
    expect(contactSelectionDrift(snap, [])).toBe('no in-scope award evidence');
  });
});

describe('planTargets', () => {
  const resolved = [
    { class: 'write', junctionRowId: 'j1', contactId: P, applicantAccountId: A, requestNum: '1', contactLinkSelected: false },
    { class: 'already-set', junctionRowId: 'j2', contactId: Q, applicantAccountId: B, requestNum: '2', contactLinkSelected: true },
    { class: 'pi-mismatch', junctionRowId: 'j3', contactId: 'x', applicantAccountId: A, requestNum: '3', contactLinkSelected: false },
  ];
  test('IAA targets come only from write rows', () => {
    expect(planTargets(resolved, false).map((t) => `${t.kind}:${t.id}`)).toEqual(['iaa:j1']);
  });
  test('contact targets come from the selected award, whatever its IAA class', () => {
    expect(planTargets(resolved, true).map((t) => `${t.kind}:${t.id}:${t.value}`)).toEqual(['iaa:j1:acc-a', `contact:${Q}:acc-b`]);
  });
});

describe('ledger (Codex findings 2 and 4)', () => {
  const key = 'iaa|j1';
  const receipt = (o = {}) => ({ kind: 'iaa', id: 'j1', phase: 'result', result: 'write', postWriteEtag: 'W/"5"', rollbackEligible: true, ...o });
  const rb = (outcome) => ({ kind: 'iaa', id: 'j1', phase: 'rollback', outcome });

  test('a failed rollback stays retryable and under verify', () => {
    const s = foldLedger([receipt(), rb('failed: dataverse failed (503)')]).get(key);
    expect(rollbackEligible(s)).toBe(true);
    expect(verifyTarget(s)).toBe(true);
    expect(applyDone(s)).toBe(true);
  });
  test('two failed attempts still leave it retryable', () => {
    const s = foldLedger([receipt(), rb('failed: 503'), rb('changed_since_write')]).get(key);
    expect(rollbackEligible(s)).toBe(true);
  });
  test('a confirmed clear ends rollback and verify, and apply never re-writes it', () => {
    const s = foldLedger([receipt(), rb('failed: 503'), rb('cleared')]).get(key);
    expect(rollbackEligible(s)).toBe(false);
    expect(verifyTarget(s)).toBe(false);
    expect(applyDone(s)).toBe(true);
  });
  test('a write not attributed to this script is never rollback-eligible', () => {
    const s = foldLedger([receipt({ rollbackEligible: false })]).get(key);
    expect(rollbackEligible(s)).toBe(false);
    expect(verifyTarget(s)).toBe(true);
  });
  test('an intent without a result marks the target interrupted and not done', () => {
    const s = foldLedger([{ kind: 'iaa', id: 'j1', phase: 'intent' }]).get(key);
    expect(s.interrupted).toBe(true);
    expect(applyDone(s)).toBe(false);
  });
  test('a failed write is retried by apply', () => {
    const s = foldLedger([receipt({ result: 'failed', postWriteEtag: null })]).get(key);
    expect(applyDone(s)).toBe(false);
    expect(rollbackEligible(s)).toBe(false);
  });
});
