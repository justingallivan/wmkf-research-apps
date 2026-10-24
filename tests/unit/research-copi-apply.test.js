/**
 * @jest-environment node
 */
import {
  parseDecision, selectLine, splitName, contactCreatePayload, junctionCreatePayload, foldLedger, applyDone, rollbackEligible, ROLE_COPI,
  makeApplier, requestDrift, runOperations, planOverwriteBlocked, ledgerPlanHash, recordedRowMismatch,
} from '../../scripts/lib/research-copi-apply.mjs';

const G = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ctx = (o = {}) => ({ approvedGroups: new Set(['recorded', 'existing-strong', 'new-strong', 'contact-web-agrees', 'contact-web-silent']), excluded: new Set(), checks: new Map(), ...o });
const ext = (o) => ({ key: 'ext|a', cohort: 'extracted', class: 'ready', actions: ['create-contact', 'create-junction-row', 'set-iaa'], iaaVia: 'pi-email-domain+domain-map', iaaAccountId: G(1), contactMatch: 'new-contact', contactId: null, ...o });

describe('parseDecision', () => {
  test('GUID, none and blank account columns', () => {
    const d = parseDecision({ key: 'k', iaaAccountId: G(2).toUpperCase(), contactAccountId: 'none', newContactAccountId: '' });
    expect(d.iaaAccountId).toBe(G(2));
    expect(d.contactAccountId).toBe('');
    expect(d.newContactAccountId).toBeUndefined();
  });
  test('rejects a non-GUID account and a malformed email', () => {
    expect(() => parseDecision({ key: 'k', iaaAccountId: "x' or 1 eq 1" })).toThrow(/not a GUID/);
    expect(() => parseDecision({ key: 'k', email: 'nyao at harvard' })).toThrow(/not an email/);
    expect(() => parseDecision({ key: 'k', contactDecision: 'maybe' })).toThrow(/unknown contactDecision/);
  });
});

describe('selectLine', () => {
  test('approved strong group creates a new contact with the resolved institution', () => {
    expect(selectLine(ext({}), ctx())).toEqual({ include: true, kind: 'extracted', iaaAccountId: G(1), contact: { mode: 'new' }, newContactAccount: '' });
  });
  test('group not approved or row excluded is held', () => {
    expect(selectLine(ext({}), ctx({ approvedGroups: new Set() })).reason).toBe('group-not-approved');
    expect(selectLine(ext({}), ctx({ excluded: new Set(['ext|a']) })).reason).toBe('excluded');
  });
  test('is-pi and is-liaison stay blocked even with a staff "same person" answer', () => {
    const decision = { contactDecision: 'same-person', existingContactEmail: 'a@b.edu', iaaAccountId: G(3) };
    expect(selectLine(ext({ class: 'is-pi', actions: [] }), ctx({ decision })).reason).toBe('is-pi');
    expect(selectLine(ext({ class: 'is-liaison', actions: [] }), ctx({ decision })).reason).toBe('is-liaison');
    expect(selectLine(ext({}), ctx({ decision: { contactDecision: 'blocked' } })).reason).toBe('owner-blocked');
  });
  test('single-signal row needs the staff institution answer', () => {
    const line = ext({ iaaVia: 'account-name' });
    expect(selectLine(line, ctx()).reason).toBe('check-unanswered');
    expect(selectLine(line, ctx({ decision: { iaaAccountId: G(4) } })).iaaAccountId).toBe(G(4));
    expect(selectLine(line, ctx({ decision: { iaaAccountId: '' } }))).toMatchObject({ include: true, iaaAccountId: '' });
  });
  test('possible duplicate needs both a contact answer and an institution', () => {
    const line = ext({ class: 'possible-existing-contact', actions: [], contactMatch: 'possible-existing-contact', iaaAccountId: null });
    expect(selectLine(line, ctx()).reason).toBe('possible-existing-contact');
    expect(selectLine(line, ctx({ decision: { iaaAccountId: G(5) } })).reason).toBe('possible-existing-contact');
    expect(selectLine(line, ctx({ decision: { contactDecision: 'same-person', existingContactEmail: 'x@y.edu', iaaAccountId: G(5) } })))
      .toEqual({ include: true, kind: 'extracted', iaaAccountId: G(5), contact: { mode: 'lookup', email: 'x@y.edu' } });
    expect(selectLine(line, ctx({ decision: { contactDecision: 'new-person', iaaAccountId: G(5) } })).contact).toEqual({ mode: 'new' });
  });
  test('existing contact with an owner account decision sets it only through contactAccountId', () => {
    const line = ext({ actions: ['create-junction-row', 'set-iaa'], contactMatch: 'email', contactId: G(6), iaaVia: 'pi-email-domain+domain-map' });
    expect(selectLine(line, ctx({ decision: { contactAccountId: G(7) } }))).toMatchObject({ contact: { mode: 'existing', contactId: G(6) }, contactAccountId: G(7) });
  });
  test('new-contact account: owner value, Pao copy, web suggestion only when answered Yes', () => {
    const line = ext({ actions: ['create-contact', 'suggest-contact-account', 'create-junction-row', 'set-iaa'], suggestedContactAccount: G(8) });
    expect(selectLine(line, ctx()).newContactAccount).toBe('');
    expect(selectLine(line, ctx({ checks: new Map([['web-suggestion|ext|a', 'Yes']]) })).newContactAccount).toBe(G(8));
    expect(selectLine(line, ctx({ checks: new Map([['web-suggestion|ext|a', 'No']]) })).newContactAccount).toBe('');
    expect(selectLine(line, ctx({ decision: { newContactAccountId: '' }, checks: new Map([['web-suggestion|ext|a', 'Yes']]) })).newContactAccount).toBe('');
    expect(selectLine(line, ctx({ decision: { newContactAccountFrom: 'copy-account-of:ext|p' } }))).toMatchObject({ copyAccountOf: 'ext|p', newContactAccount: '' });
  });
  test('recorded rows: group approval, unanswered check, staff-settled no-account-match', () => {
    const rec = { key: 'rec|r|c', cohort: 'recorded', class: 'ready', actions: ['set-iaa'], iaaAccountId: G(9), contactId: G(10) };
    expect(selectLine(rec, ctx())).toEqual({ include: true, kind: 'recorded', iaaAccountId: G(9), contact: { mode: 'existing', contactId: G(10) } });
    expect(selectLine(rec, ctx({ checks: new Map([['recorded-unanswered|rec|r|c', '']]) })).reason).toBe('check-not-approved');
    const nam = { ...rec, class: 'no-account-match', actions: [], iaaAccountId: null };
    expect(selectLine(nam, ctx()).reason).toBe('no-account-match');
    expect(selectLine(nam, ctx({ decision: { iaaAccountId: G(11) } })).iaaAccountId).toBe(G(11));
  });
  test('contact-level rows: group target, staff account, deliberate empty', () => {
    const con = { key: 'con|c', cohort: 'contact', class: 'ready', actions: ['set-contact-account'], contactAccountTarget: G(12), webAccountId: null };
    expect(selectLine(con, ctx())).toEqual({ include: true, kind: 'contact-account', contactAccountId: G(12) });
    expect(selectLine(con, ctx({ approvedGroups: new Set() })).reason).toBe('group-not-approved');
    const unresolved = { ...con, class: 'contact-account-unresolved', actions: [], contactAccountTarget: null };
    expect(selectLine(unresolved, ctx()).reason).toBe('contact-account-unresolved');
    expect(selectLine(unresolved, ctx({ decision: { contactAccountId: G(13) } })).contactAccountId).toBe(G(13));
    expect(selectLine(con, ctx({ decision: { contactAccountId: '' } })).reason).toBe('owner-left-empty');
  });
});

describe('payloads', () => {
  test('splitName keeps case, drops nickname and suffix', () => {
    expect(splitName('Ahmad (Mo) Khalil')).toEqual({ firstname: 'Ahmad', middlename: undefined, lastname: 'Khalil' });
    expect(splitName('John Alan McLachlan')).toEqual({ firstname: 'John', middlename: 'Alan', lastname: 'McLachlan' });
    expect(splitName('Dr. Jane Smith-Jones Jr.')).toEqual({ firstname: 'Jane', middlename: undefined, lastname: 'Smith-Jones' });
    expect(splitName('Madonna')).toBeNull();
  });
  test('contact payload binds the account only when given', () => {
    expect(contactCreatePayload({ contactId: G(1), name: 'Ann B Lee', email: 'a@x.edu', accountId: G(2) })).toEqual({
      contactid: G(1), firstname: 'Ann', middlename: 'B', lastname: 'Lee', emailaddress1: 'a@x.edu', 'parentcustomerid_account@odata.bind': `/accounts(${G(2)})`,
    });
    expect(contactCreatePayload({ contactId: G(1), name: 'Ann Lee', email: '', accountId: '' })).toEqual({ contactid: G(1), firstname: 'Ann', lastname: 'Lee' });
    expect(() => contactCreatePayload({ contactId: 'nope', name: 'Ann Lee' })).toThrow(/GUID/);
  });
  test('junction payload: PascalCase binds, Co-PI role, optional institution', () => {
    const p = junctionCreatePayload({ junctionId: G(3), requestId: G(4), requestNum: '991206', contactId: G(5), iaaAccountId: G(6), position: 2 });
    expect(p).toEqual({
      wmkf_apprequestpersonid: G(3), 'wmkf_Request@odata.bind': `/akoya_requests(${G(4)})`, 'wmkf_Contact@odata.bind': `/contacts(${G(5)})`,
      wmkf_role: ROLE_COPI, wmkf_assignmentkey: '991206-Co-PI-2', 'wmkf_InstitutionAtAward@odata.bind': `/accounts(${G(6)})`,
    });
    expect(junctionCreatePayload({ junctionId: G(3), requestId: G(4), requestNum: '1', contactId: G(5), iaaAccountId: '', position: 1 })).not.toHaveProperty('wmkf_InstitutionAtAward@odata.bind');
    expect(() => junctionCreatePayload({ junctionId: G(3), requestId: 'x', requestNum: '1', contactId: G(5), position: 1 })).toThrow(/requestId/);
  });
});

describe('ledger', () => {
  test('interrupted, done, failed and blocked retry, rollback eligibility', () => {
    const m = foldLedger([
      { kind: 'contact-create', id: 'a', phase: 'intent' },
      { kind: 'junction-create', id: 'b', phase: 'intent' },
      { kind: 'junction-create', id: 'b', phase: 'result', result: 'created', postEtag: 'W/"1"' },
      { kind: 'iaa-set', id: 'c', phase: 'intent' },
      { kind: 'iaa-set', id: 'c', phase: 'result', result: 'failed' },
      { kind: 'junction-create', id: 'd', phase: 'intent' },
      { kind: 'junction-create', id: 'd', phase: 'result', result: 'created', postEtag: 'W/"2"' },
      { kind: 'junction-create', id: 'd', phase: 'rollback', outcome: 'deleted' },
      { kind: 'junction-create', id: 'e', phase: 'result', result: 'blocked' },
      { kind: 'iaa-set', id: 'f', phase: 'result', result: 'recovered', postEtag: 'W/"3"' },
    ]);
    expect(m.get('contact-create|a').interrupted).toBe(true);
    expect(applyDone(m.get('contact-create|a'))).toBe(false);
    expect(applyDone(m.get('junction-create|b'))).toBe(true);
    expect(rollbackEligible(m.get('junction-create|b'))).toBe(true);
    expect(applyDone(m.get('iaa-set|c'))).toBe(false);
    expect(rollbackEligible(m.get('junction-create|d'))).toBe(false);
    expect(applyDone(m.get('junction-create|d'))).toBe(true);
    expect(applyDone(m.get('junction-create|e'))).toBe(false);
    expect(rollbackEligible(m.get('iaa-set|f'))).toBe(false);
    expect(rollbackEligible(m.get('iaa-set|f'), { includeRecovered: true })).toBe(true);
  });
});

// ── Failure replay against an in-memory Dataverse ──
const REQ = G(100); const ACC = G(101); const PI = G(102); const NEWC = G(103); const JN = G(104); const ROW = G(105); const OLDC = G(106);
const source = { key: 'ext|a', requestId: REQ, requestNum: '990001', meetingDate: '2019-06-01', applicantId: ACC, projectLeaderId: PI };
function fakeDataverse() {
  let etag = 0; const next = () => `W/"${++etag}"`;
  const db = {
    akoya_requests: new Map([[REQ, { akoya_requestid: REQ, statecode: 0, akoya_requeststatus: 'Closed', wmkf_meetingdate: '2019-06-01T00:00:00Z', _akoya_applicantid_value: ACC, _wmkf_projectleader_value: PI, _akoya_primarycontactid_value: null, _etag: next() }]]),
    contacts: new Map([[OLDC, { contactid: OLDC, statecode: 0, emailaddress1: 'old@x.edu', _parentcustomerid_value: null, _etag: next() }]]),
    wmkf_apprequestpersons: new Map([[ROW, { wmkf_apprequestpersonid: ROW, wmkf_role: ROLE_COPI, _wmkf_request_value: REQ, _wmkf_contact_value: OLDC, _wmkf_institutionataward_value: null, _etag: next() }]]),
  };
  const fromPayload = (set, p) => (set === 'contacts'
    ? { contactid: p.contactid, statecode: 0, firstname: p.firstname, middlename: p.middlename, lastname: p.lastname, emailaddress1: p.emailaddress1, _parentcustomerid_value: p['parentcustomerid_account@odata.bind']?.match(/\((.+)\)/)?.[1] || null }
    : { wmkf_apprequestpersonid: p.wmkf_apprequestpersonid, wmkf_role: p.wmkf_role, _wmkf_request_value: p['wmkf_Request@odata.bind'].match(/\((.+)\)/)[1], _wmkf_contact_value: p['wmkf_Contact@odata.bind'].match(/\((.+)\)/)[1], _wmkf_institutionataward_value: p['wmkf_InstitutionAtAward@odata.bind']?.match(/\((.+)\)/)?.[1] || null });
  const io = {
    fail: {},
    getOrNull: async (set, id) => (db[set].get(id) ? { ...db[set].get(id) } : null),
    activeContactsWithEmail: async (e) => [...db.contacts.values()].filter((c) => c.statecode === 0 && c.emailaddress1 === e),
    rowsForRequest: async (r) => [...db.wmkf_apprequestpersons.values()].filter((j) => j._wmkf_request_value === r),
    create: async (set, p) => {
      if (io.fail.create) { io.fail.create = false; throw new Error('timeout before commit'); }
      const rec = { ...fromPayload(set, p), _etag: next() }; db[set].set(set === 'contacts' ? p.contactid : p.wmkf_apprequestpersonid, rec);
      if (io.fail.createResponse) { io.fail.createResponse = false; throw new Error('response lost after commit'); }
      return { ...rec };
    },
    patch: async (set, id, _sel, body, ifMatch) => {
      const cur = db[set].get(id);
      if (cur._etag !== ifMatch) { const e = new Error('412'); e.status = 412; throw e; }
      const key = Object.keys(body)[0];
      if (key === 'wmkf_InstitutionAtAward@odata.bind') cur._wmkf_institutionataward_value = body[key].match(/\((.+)\)/)[1];
      if (key === 'parentcustomerid_account@odata.bind') cur._parentcustomerid_value = body[key].match(/\((.+)\)/)[1];
      cur._etag = next();
      if (io.fail.patchResponse) { io.fail.patchResponse = false; throw new Error('response lost after commit'); }
      return { ...cur };
    },
  };
  return { db, io };
}
// Same loop as production: earlier lines folded once, this run's intent not folded in first.
async function run(apply, ops, ledgerLines) {
  const ledger = foldLedger(ledgerLines);
  await runOperations({ ops, ledger, applyOp: apply, log: (l) => ledgerLines.push(l) });
  return foldLedger(ledgerLines);
}
const contactOp = { op: 'contact-create', id: NEWC, payload: contactCreatePayload({ contactId: NEWC, name: 'Ann Lee', email: 'ann@x.edu', accountId: ACC }), source };
const junctionOp = { op: 'junction-create', id: JN, contactId: NEWC, newContact: true, contactPayload: contactOp.payload, payload: junctionCreatePayload({ junctionId: JN, requestId: REQ, requestNum: '990001', contactId: NEWC, iaaAccountId: ACC, position: 2 }), source };
const iaaOp = { op: 'iaa-set', id: ROW, value: ACC, expect: { requestId: REQ, contactId: OLDC, role: ROLE_COPI }, source };

describe('apply failure replay', () => {
  test('a contact create that fails is retried, and its blocked junction row is created on the rerun', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    io.fail.create = true;
    let m = await run(apply, [contactOp, junctionOp], log);
    expect(m.get(`contact-create|${NEWC}`).receipt.result).toBe('failed');
    expect(m.get(`junction-create|${JN}`).receipt.result).toBe('blocked');
    m = await run(apply, [contactOp, junctionOp], log);
    expect(m.get(`contact-create|${NEWC}`).receipt.result).toBe('created');
    expect(m.get(`junction-create|${JN}`).receipt.result).toBe('created');
    expect(db.wmkf_apprequestpersons.get(JN)._wmkf_contact_value).toBe(NEWC);
  });
  test('a create whose response was lost is recovered on the rerun, not duplicated', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    io.fail.createResponse = true;
    await run(apply, [contactOp], log);
    const m = await run(apply, [contactOp, junctionOp], log);
    expect(m.get(`contact-create|${NEWC}`).receipt.result).toBe('recovered');
    expect(rollbackEligible(m.get(`contact-create|${NEWC}`))).toBe(false);
    expect(rollbackEligible(m.get(`contact-create|${NEWC}`), { includeRecovered: true })).toBe(true);
    expect(m.get(`junction-create|${JN}`).receipt.result).toBe('created');
    expect([...db.contacts.keys()].filter((k) => k === NEWC)).toHaveLength(1);
  });
  test('a created record edited by someone else before recovery is never adopted for rollback', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    io.fail.createResponse = true;
    await run(apply, [contactOp], log);
    db.contacts.get(NEWC).emailaddress1 = 'changed@x.edu';
    const m = await run(apply, [contactOp], log);
    expect(m.get(`contact-create|${NEWC}`).receipt.result).toBe('recovered_modified');
    expect(rollbackEligible(m.get(`contact-create|${NEWC}`), { includeRecovered: true })).toBe(false);
  });
  test('a recovered contact edited by someone else blocks its junction row', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    io.fail.createResponse = true;
    await run(apply, [contactOp], log);
    db.contacts.get(NEWC).lastname = 'Someone-Else';
    const m = await run(apply, [contactOp, junctionOp], log);
    expect(m.get(`contact-create|${NEWC}`).receipt.result).toBe('recovered_modified');
    expect(m.get(`junction-create|${JN}`).receipt).toMatchObject({ result: 'blocked', detail: expect.stringMatching(/edited after creation/) });
    expect(applyDone(m.get(`junction-create|${JN}`))).toBe(false);
    expect(db.wmkf_apprequestpersons.has(JN)).toBe(false);
  });
  test('a contact created earlier and edited before its junction retry blocks the junction', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    await runOperations({ ops: [contactOp, junctionOp], ledger: foldLedger(log), applyOp: apply, log: (l) => log.push(l), first: 1 });
    expect(foldLedger(log).get(`contact-create|${NEWC}`).receipt.result).toBe('created');
    db.contacts.get(NEWC).emailaddress1 = 'someone.else@x.edu';
    const m = await run(apply, [contactOp, junctionOp], log);
    expect(m.get(`junction-create|${JN}`).receipt).toMatchObject({ result: 'blocked', detail: expect.stringMatching(/edited after creation/) });
    expect(db.wmkf_apprequestpersons.has(JN)).toBe(false);
  });
  test('a junction to an existing contact that became inactive is blocked', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io);
    db.contacts.get(OLDC).statecode = 1;
    const op = { ...junctionOp, id: G(300), contactId: OLDC, newContact: false, contactPayload: undefined };
    db.wmkf_apprequestpersons.delete(ROW);
    expect((await apply(op, new Map())).result).toBe('blocked');
  });
  test('a recorded row reassigned or re-roled between resolve and plan is rejected', () => {
    const line = { requestId: REQ.toUpperCase(), contactId: OLDC };
    const row = { _wmkf_request_value: REQ, _wmkf_contact_value: OLDC, wmkf_role: ROLE_COPI };
    expect(recordedRowMismatch(line, row)).toBe('');
    expect(recordedRowMismatch(line, { ...row, _wmkf_contact_value: G(400) })).toMatch(/reassigned/);
    expect(recordedRowMismatch(line, { ...row, _wmkf_request_value: G(401) })).toMatch(/another request/);
    expect(recordedRowMismatch(line, { ...row, wmkf_role: 100000000 })).toMatch(/no longer Co-PI/);
  });
  test('re-planning is refused once the apply log has activity, and a log names one plan', () => {
    expect(planOverwriteBlocked([])).toBe(false);
    expect(planOverwriteBlocked([{ phase: 'intent', planHash: 'aaaa1111' }])).toBe(true);
    expect(ledgerPlanHash([{ planHash: 'aaaa1111' }, { planHash: 'aaaa1111' }, {}])).toBe('aaaa1111');
    expect(() => ledgerPlanHash([{ planHash: 'aaaa1111' }, { planHash: 'bbbb2222' }])).toThrow(/mixes plans/);
  });
  test('first run on a value someone else already set is already_set, with no rollback', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    db.wmkf_apprequestpersons.get(ROW)._wmkf_institutionataward_value = ACC;
    const m = await run(apply, [iaaOp], log);
    expect(m.get(`iaa-set|${ROW}`).receipt.result).toBe('already_set');
    expect(rollbackEligible(m.get(`iaa-set|${ROW}`), { includeRecovered: true })).toBe(false);
  });
  test('restart after an intent with no result (crash after commit) recovers the write', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io);
    db.wmkf_apprequestpersons.get(ROW)._wmkf_institutionataward_value = ACC; // committed before the crash
    const log = [{ kind: 'iaa-set', id: ROW, phase: 'intent' }];
    const m = await run(apply, [iaaOp], log);
    expect(m.get(`iaa-set|${ROW}`).receipt.result).toBe('recovered');
    expect(rollbackEligible(m.get(`iaa-set|${ROW}`))).toBe(false);
    expect(rollbackEligible(m.get(`iaa-set|${ROW}`), { includeRecovered: true })).toBe(true);
  });
  test('a PATCH whose response was lost is recovered with rollback coverage, not marked already_set', async () => {
    const { io } = fakeDataverse(); const apply = makeApplier(io); const log = [];
    io.fail.patchResponse = true;
    let m = await run(apply, [iaaOp], log);
    expect(m.get(`iaa-set|${ROW}`).receipt.result).toBe('failed');
    m = await run(apply, [iaaOp], log);
    expect(m.get(`iaa-set|${ROW}`).receipt.result).toBe('recovered');
    expect(m.get(`iaa-set|${ROW}`).receipt.postEtag).toBeTruthy();
  });
  test('an identical value set by someone else (no uncertain run) is already_set, not ours', async () => {
    const { db, io } = fakeDataverse(); const apply = makeApplier(io);
    db.wmkf_apprequestpersons.get(ROW)._wmkf_institutionataward_value = ACC;
    expect((await apply(iaaOp, new Map())).result).toBe('already_set');
  });
  test('institution update refuses a row reassigned to another contact, or a request whose PI changed', async () => {
    const a = fakeDataverse(); a.db.wmkf_apprequestpersons.get(ROW)._wmkf_contact_value = G(200);
    expect((await makeApplier(a.io)(iaaOp, new Map())).result).toBe('changed_since_plan');
    expect(a.db.wmkf_apprequestpersons.get(ROW)._wmkf_institutionataward_value).toBeNull();
    const b = fakeDataverse(); b.db.akoya_requests.get(REQ)._wmkf_projectleader_value = G(201);
    expect(await makeApplier(b.io)(iaaOp, new Map())).toEqual({ result: 'changed_since_plan', detail: 'PI changed' });
    expect(b.db.wmkf_apprequestpersons.get(ROW)._wmkf_institutionataward_value).toBeNull();
  });
  test('a junction row for a contact already on the request is skipped', async () => {
    const { io } = fakeDataverse(); const apply = makeApplier(io);
    const op = { ...junctionOp, contactId: OLDC, newContact: false, payload: junctionCreatePayload({ junctionId: JN, requestId: REQ, requestNum: '990001', contactId: OLDC, iaaAccountId: ACC, position: 2 }) };
    expect((await apply(op, new Map())).detail).toBe('contact already has a row on this request');
  });
  test('requestDrift reports status, date, applicant and PI changes', () => {
    const r = { statecode: 0, akoya_requeststatus: 'Closed', wmkf_meetingdate: '2019-06-01', _akoya_applicantid_value: ACC, _wmkf_projectleader_value: PI };
    expect(requestDrift(source, r)).toBe('');
    expect(requestDrift(source, { ...r, akoya_requeststatus: 'Declined' })).toMatch(/no longer awarded/);
    expect(requestDrift(source, { ...r, wmkf_meetingdate: '2020-01-01' })).toBe('meeting date changed');
    expect(requestDrift(source, null)).toBe('request missing');
  });
});
