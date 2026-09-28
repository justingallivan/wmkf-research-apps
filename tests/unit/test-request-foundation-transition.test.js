/**
 * The production Foundation-account transition contract (MVP item 5; plan
 * open questions 4 and 7): lib/services/test-requests/foundation-transition.js.
 */
import {
  PROJECTION_EXCLUSIONS, captureFoundationBaseline, evaluateFoundationTransition, readFoundationAccount, sameFoundationBaseline,
} from '../../lib/services/test-requests/foundation-transition.js';
import { assertLedgerReceipt } from '../../lib/services/test-requests/run-ledger.js';

const ORG_ID = '66666666-6666-4666-8666-666666666666';
const CAPTURED = new Date('2026-09-28T18:00:00.000Z');
const VERIFIED = new Date('2026-09-28T18:05:00.000Z');

function account(overrides = {}) {
  return {
    '@odata.etag': 'W/"100"',
    accountid: ORG_ID,
    name: 'W. M. Keck Foundation',
    _primarycontactid_value: null,
    telephone1: '555-0100',
    versionnumber: 100,
    modifiedon: '2026-09-01T00:00:00Z',
    _modifiedby_value: '55555555-5555-4555-8555-555555555555',
    akoya_taxstatus: 100000001,
    wmkf_bmf509: 'Undetermined',
    akoya_goverifyexception: null,
    akoya_goverifytrigger: '2026-08-03T18:15:12Z',
    akoya_dexempt: '2026-08-03',
    akoya_countofrequests: 10,
    akoya_countofrequests_date: '2026-09-01T00:00:00Z',
    akoya_countofrequests_state: 1,
    akoya_countofawards: 0,
    wmkf_countofdiscretionarygrant: 0,
    wmkf_countofprogramgrants: 0,
    akoya_totalgrants: 0,
    wmkf_sumofdiscretionarygrants: 0,
    wmkf_sumofprogramgrants: 0,
    akoya_mostrecentgrant: null,
    akoya_totalgrants_date: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

const CONTACTS = [{ contactid: '77777777-7777-4777-8777-777777777777', versionnumber: 5 }];
const baseline = () => captureFoundationBaseline(account(), CONTACTS, CAPTURED);
const evaluate = (after, contacts = CONTACTS, verifiedAt = VERIFIED) => evaluateFoundationTransition(baseline(), after, contacts, { verifiedAt });

/** What the observed GoVerify refresh on a clone create looks like (plan P0b). */
const refreshed = (overrides = {}) => account({
  versionnumber: 140, modifiedon: '2026-09-28T18:01:00Z', _modifiedby_value: '88888888-8888-4888-8888-888888888888',
  akoya_goverifytrigger: '2026-09-28T18:01:00Z', akoya_dexempt: '2026-09-28',
  akoya_countofrequests: 11, akoya_countofrequests_date: '2026-09-28T18:01:05Z', akoya_totalgrants_date: '2026-09-28T18:01:05Z',
  ...overrides,
});

describe('captureFoundationBaseline', () => {
  test('the receipt carries digests, the count and the GoVerify stamps only, and the ledger accepts it', () => {
    const receipt = baseline();
    expect(Object.keys(receipt).sort()).toEqual([
      'capturedAt', 'count', 'exemptionCheckedAt', 'foundationContactsSha256', 'foundationGoverifyResultSha256',
      'foundationProjectionSha256', 'goverifyTriggerAt', 'kind', 'organizationId',
    ]);
    expect(receipt).toMatchObject({ kind: 'foundation_transition', count: 10, organizationId: ORG_ID, goverifyTriggerAt: '2026-08-03T18:15:12Z' });
    expect(JSON.stringify(receipt)).not.toMatch(/Undetermined|555-0100|Keck/);
    expect(() => assertLedgerReceipt(receipt)).not.toThrow();
  });

  test('a null stamp is omitted, not journaled', () => {
    const receipt = captureFoundationBaseline(account({ akoya_dexempt: null }), CONTACTS, CAPTURED);
    expect(receipt).not.toHaveProperty('exemptionCheckedAt');
  });

  test.each(['akoya_taxstatus', 'wmkf_bmf509', 'akoya_goverifytrigger', 'akoya_dexempt', 'akoya_countofrequests', 'akoya_mostrecentgrant'])(
    'fails closed when the contract column %s is absent from the read',
    (field) => {
      const row = account();
      delete row[field];
      expect(() => captureFoundationBaseline(row, CONTACTS, CAPTURED)).toThrow(new RegExp(field));
    },
  );

  test('refuses a count that is not a non-negative integer', () => {
    expect(() => captureFoundationBaseline(account({ akoya_countofrequests: null }), CONTACTS, CAPTURED)).toThrow(/non-negative integer/);
  });

  test('sameFoundationBaseline ignores only the capture time', () => {
    const later = captureFoundationBaseline(account(), CONTACTS, VERIFIED);
    expect(sameFoundationBaseline(baseline(), later)).toBe(true);
    expect(sameFoundationBaseline(baseline(), captureFoundationBaseline(account({ telephone1: 'x' }), CONTACTS, CAPTURED))).toBe(false);
    expect(sameFoundationBaseline(baseline(), captureFoundationBaseline(account({ akoya_goverifytrigger: '2026-09-01T00:00:00Z' }), CONTACTS, CAPTURED))).toBe(false);
  });
});

describe('evaluateFoundationTransition', () => {
  test('the observed refresh passes as refreshed', () => {
    expect(evaluate(refreshed())).toEqual({ failures: [], outcome: 'refreshed' });
  });

  test('a throttled refresh (no GoVerify field moved) passes as not_refreshed, with or without the count rising', () => {
    expect(evaluate(account())).toEqual({ failures: [], outcome: 'not_refreshed' });
    expect(evaluate(account({ akoya_countofrequests: 11, versionnumber: 101 }))).toEqual({ failures: [], outcome: 'not_refreshed' });
  });

  test('an exemption date returned as a midnight timestamp is compared by day', () => {
    expect(evaluate(refreshed({ akoya_dexempt: '2026-09-28T07:00:00Z' })).outcome).toBe('refreshed');
    expect(evaluate(refreshed({ akoya_dexempt: '2026-09-28T00:00:00Z' })).outcome).toBe('refreshed');
    expect(evaluate(refreshed({ akoya_dexempt: '2026-09-30T07:00:00Z' })).failures).toEqual(['Foundation akoya_dexempt changed to a value outside the run window']);
  });

  test('a same-day refresh that leaves the date-only exemption stamp unchanged passes', () => {
    expect(evaluate(refreshed({ akoya_dexempt: '2026-08-03' })).outcome).toBe('refreshed');
  });

  test.each([
    ['Tax Status left empty', { akoya_taxstatus: null }, /Tax Status or BMF 509/],
    ['Tax Status changed', { akoya_taxstatus: 100000002 }, /Tax Status or BMF 509/],
    ['BMF 509 changed', { wmkf_bmf509: 'Private foundation' }, /Tax Status or BMF 509/],
    ['an unnamed column changed', { telephone1: '555-0199' }, /protected columns/],
    ['a protected GoVerify result field changed', { akoya_goverifyexception: 'x' }, /protected columns/],
    ['the Foundation primary contact set', { _primarycontactid_value: '99999999-9999-4999-8999-999999999999' }, /protected columns/],
    ['a new column appeared', { wmkf_newcolumn: 1 }, /protected columns/],
    ['the Request count rose by two', { akoya_countofrequests: 12 }, /neither unchanged nor \+1/],
    ['the Request count fell', { akoya_countofrequests: 9 }, /neither unchanged nor \+1/],
    ['another Request rollup moved', { akoya_countofawards: 1 }, /protected columns/],
    ['the most recent grant moved', { akoya_mostrecentgrant: '2026-09-28' }, /protected columns/],
    ['the trigger stamp moved outside the window', { akoya_goverifytrigger: '2026-09-28T19:00:00Z' }, /akoya_goverifytrigger changed to a value outside/],
    ['the trigger stamp moved before the window', { akoya_goverifytrigger: '2026-09-28T17:00:00Z' }, /akoya_goverifytrigger changed to a value outside/],
    ['the trigger stamp cleared', { akoya_goverifytrigger: null }, /akoya_goverifytrigger changed to a value outside/],
    ['the exemption date moved far outside the window', { akoya_dexempt: '2026-09-30' }, /akoya_dexempt changed to a value outside/],
    ['the trigger stamp is not a timestamp', { akoya_goverifytrigger: 'yes' }, /not a date or UTC timestamp/],
  ])('fails when %s', (_label, overrides, expected) => {
    const result = evaluate(refreshed(overrides));
    expect(result.outcome).toBeNull();
    expect(result.failures.join('; ')).toMatch(expected);
  });

  test('an exemption date moving without the trigger fails', () => {
    const result = evaluate(account({ akoya_dexempt: '2026-09-28' }));
    expect(result.failures).toEqual(['Foundation akoya_dexempt moved without a GoVerify trigger']);
  });

  test('the rollup companions and write metadata may move', () => {
    const after = refreshed({ akoya_countofawards_date: '2026-09-28T18:02:00Z', akoya_countofawards_state: 2, _modifiedonbehalfby_value: ORG_ID });
    expect(evaluate(after).failures).toEqual([]);
    expect(PROJECTION_EXCLUSIONS).toEqual(expect.arrayContaining(['akoya_countofawards_date', 'akoya_mostrecentgrant_state', 'versionnumber']));
  });

  test('a changed or added Contact fails', () => {
    expect(evaluate(refreshed(), [{ ...CONTACTS[0], versionnumber: 6 }]).failures).toEqual(['Foundation contact rows changed during the run']);
    expect(evaluate(refreshed(), [...CONTACTS, { contactid: ORG_ID, versionnumber: 1 }]).failures).toEqual(['Foundation contact rows changed during the run']);
  });

  test('a missing or foreign baseline fails closed', () => {
    expect(evaluateFoundationTransition(null, refreshed(), CONTACTS, { verifiedAt: VERIFIED }).failures).toEqual(['Foundation pre-create baseline is missing or unreadable']);
    expect(evaluateFoundationTransition({ ...baseline(), kind: 'foundation_baseline' }, refreshed(), CONTACTS, { verifiedAt: VERIFIED }).outcome).toBeNull();
    expect(evaluate(refreshed({ accountid: '99999999-9999-4999-8999-999999999999' })).failures).toEqual(['Foundation account identity differs from the pre-create baseline']);
  });

  test('a contract column missing from the after-read fails closed', () => {
    const after = refreshed();
    delete after.wmkf_bmf509;
    expect(evaluate(after).failures.join('; ')).toMatch(/lacks transition-contract column\(s\): wmkf_bmf509/);
  });
});

describe('readFoundationAccount', () => {
  test('reads the whole row by ID and refuses a different row', async () => {
    const paths = [];
    const client = { get: async (path) => { paths.push(path); return { ok: true, status: 200, body: account() }; } };
    await expect(readFoundationAccount(client, ORG_ID)).resolves.toMatchObject({ accountid: ORG_ID });
    expect(paths).toEqual([`/accounts(${ORG_ID})`]);
    await expect(readFoundationAccount(client, '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/different row/);
    await expect(readFoundationAccount(client, "x' or 1")).rejects.toThrow(/not a GUID/);
  });
});
