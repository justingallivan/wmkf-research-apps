/**
 * @jest-environment node
 */
import {
  parseDecision, selectLine, splitName, contactCreatePayload, junctionCreatePayload, foldLedger, applyDone, rollbackEligible, ROLE_COPI,
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
    expect(selectLine(line, ctx({ decision: { newContactAccountFrom: 'pao-contact' } })).newContactAccount).toBe('pao-contact');
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
  test('interrupted, done, failed retry, rollback eligibility', () => {
    const m = foldLedger([
      { kind: 'contact-create', id: 'a', phase: 'intent' },
      { kind: 'junction-create', id: 'b', phase: 'intent' },
      { kind: 'junction-create', id: 'b', phase: 'result', result: 'created', postEtag: 'W/"1"' },
      { kind: 'iaa-set', id: 'c', phase: 'intent' },
      { kind: 'iaa-set', id: 'c', phase: 'result', result: 'failed' },
      { kind: 'junction-create', id: 'd', phase: 'intent' },
      { kind: 'junction-create', id: 'd', phase: 'result', result: 'created', postEtag: 'W/"2"' },
      { kind: 'junction-create', id: 'd', phase: 'rollback', outcome: 'deleted' },
    ]);
    expect(m.get('contact-create|a').interrupted).toBe(true);
    expect(applyDone(m.get('contact-create|a'))).toBe(false);
    expect(applyDone(m.get('junction-create|b'))).toBe(true);
    expect(rollbackEligible(m.get('junction-create|b'))).toBe(true);
    expect(applyDone(m.get('iaa-set|c'))).toBe(false);
    expect(rollbackEligible(m.get('junction-create|d'))).toBe(false);
    expect(applyDone(m.get('junction-create|d'))).toBe(true);
  });
});
