/**
 * @jest-environment node
 *
 * Unit tests for lib/services/contacts/request-liaison.js: the Research
 * Liaison of record is the applicant institution's Primary Contact, never the
 * Request copy; other programs keep the Request copy; read failures throw.
 * Plan: docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md (*Test matrix*).
 */

jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true,
  queryAccounts: jest.fn(),
}));

import * as accountAdapter from '../../lib/dataverse/adapters/account';
import {
  resolveRequestLiaison,
  resolveRequestLiaisons,
  isResearchProgram,
  REQUEST_LIAISON_FIELDS,
} from '../../lib/services/contacts/request-liaison';

const SER = '8DCAB30B-958F-EE11-8179-000D3A341E8F'; // Science and Engineering Research, upper-cased
const SOCAL = '11111111-2222-3333-4444-555555555555';
const guid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACCOUNT = 'AAAAAAAA-0000-4000-8000-000000000001';
const COPY = guid(900);
const INSTITUTION_CONTACT = guid(901);

function request(overrides = {}) {
  return {
    _akoya_programid_value: SER,
    _akoya_applicantid_value: ACCOUNT,
    _akoya_primarycontactid_value: COPY,
    _akoya_primarycontactid_value_formatted: 'Request Copy',
    ...overrides,
  };
}

function accountsResponse(records, extra = {}) {
  return { records, count: records.length, totalCount: records.length, hasMore: false, ...extra };
}

beforeEach(() => {
  accountAdapter.queryAccounts.mockReset();
});

describe('single Request', () => {
  test('Research: the institution Primary Contact, not a differing Request copy', async () => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([
      { accountid: ACCOUNT.toLowerCase(), _primarycontactid_value: INSTITUTION_CONTACT, _primarycontactid_value_formatted: 'Institution Liaison' },
    ]));
    await expect(resolveRequestLiaison(request())).resolves.toEqual({
      status: 'found', contactId: INSTITUTION_CONTACT, source: 'institution', displayName: 'Institution Liaison',
    });
    const call = accountAdapter.queryAccounts.mock.calls[0][0];
    expect(call.select).toBe('accountid,_primarycontactid_value');
    expect(call.filter).toBe(`accountid eq ${ACCOUNT.toLowerCase()}`);
    expect(call.top).toBe(1);
  });

  test('Research: blank account Primary Contact is none, with no Request-copy fallback', async () => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([{ accountid: ACCOUNT, _primarycontactid_value: null }]));
    await expect(resolveRequestLiaison(request())).resolves.toEqual({ status: 'none', source: 'institution' });
  });

  test('Research: blank applicant is none, with no account read and no fallback', async () => {
    await expect(resolveRequestLiaison(request({ _akoya_applicantid_value: null }))).resolves.toEqual({ status: 'none', source: 'institution' });
    expect(accountAdapter.queryAccounts).not.toHaveBeenCalled();
  });

  test('Research: an account read failure throws', async () => {
    accountAdapter.queryAccounts.mockRejectedValue(new Error('dataverse 503'));
    await expect(resolveRequestLiaison(request())).rejects.toThrow('dataverse 503');
  });

  test('Research: an account missing from the response throws, not none', async () => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([]));
    await expect(resolveRequestLiaison(request())).rejects.toThrow(/was not returned/);
  });

  test('Research: a malformed account response throws', async () => {
    accountAdapter.queryAccounts.mockResolvedValue({ value: [] });
    await expect(resolveRequestLiaison(request())).rejects.toThrow(/malformed/);
  });

  test.each(REQUEST_LIAISON_FIELDS)('an omitted %s throws (projection bug, not blank data)', async (key) => {
    const row = request();
    delete row[key];
    await expect(resolveRequestLiaison(row)).rejects.toThrow(new RegExp(`omits ${key}`));
    expect(accountAdapter.queryAccounts).not.toHaveBeenCalled();
  });

  test('SoCal keeps the Request copy even when the institution differs', async () => {
    await expect(resolveRequestLiaison(request({ _akoya_programid_value: SOCAL }))).resolves.toEqual({
      status: 'found', contactId: COPY, source: 'request_copy', displayName: 'Request Copy',
    });
    expect(accountAdapter.queryAccounts).not.toHaveBeenCalled();
  });

  test('an explicitly blank program keeps the Request copy', async () => {
    await expect(resolveRequestLiaison(request({ _akoya_programid_value: null }))).resolves.toMatchObject({
      status: 'found', contactId: COPY, source: 'request_copy',
    });
  });

  test('a non-Research blank Request copy is none', async () => {
    await expect(resolveRequestLiaison(request({ _akoya_programid_value: SOCAL, _akoya_primarycontactid_value: null })))
      .resolves.toEqual({ status: 'none', source: 'request_copy' });
  });
});

describe('batch', () => {
  test('26 Research Requests: two complete chunks, aligned results with display names', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => request({ _akoya_applicantid_value: guid(i + 1).toUpperCase() }));
    accountAdapter.queryAccounts.mockImplementation(async ({ filter }) => {
      const ids = filter.split(' or ').map((part) => part.replace('accountid eq ', ''));
      return accountsResponse(ids.map((id) => ({
        accountid: id, _primarycontactid_value: `contact-${id}`, _primarycontactid_value_formatted: `Name ${id}`,
      })));
    });
    const results = await resolveRequestLiaisons(rows);
    expect(accountAdapter.queryAccounts).toHaveBeenCalledTimes(2);
    expect(accountAdapter.queryAccounts.mock.calls.map(([opts]) => opts.top)).toEqual([25, 1]);
    results.forEach((result, i) => {
      const id = guid(i + 1);
      expect(result).toEqual({ status: 'found', contactId: `contact-${id}`, source: 'institution', displayName: `Name ${id}` });
    });
  });

  test('duplicate applicants are read once and mapped to every row', async () => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([{ accountid: ACCOUNT, _primarycontactid_value: INSTITUTION_CONTACT }]));
    const results = await resolveRequestLiaisons([request(), request({ _akoya_applicantid_value: ACCOUNT.toLowerCase() })]);
    expect(accountAdapter.queryAccounts.mock.calls[0][0].top).toBe(1);
    expect(results.map((r) => r.contactId)).toEqual([INSTITUTION_CONTACT, INSTITUTION_CONTACT]);
  });

  test('a response omitting one of three accounts throws', async () => {
    const rows = [1, 2, 3].map((n) => request({ _akoya_applicantid_value: guid(n) }));
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([
      { accountid: guid(1), _primarycontactid_value: guid(11) },
      { accountid: guid(3), _primarycontactid_value: guid(13) },
    ]));
    await expect(resolveRequestLiaisons(rows)).rejects.toThrow(new RegExp(`${guid(2)} was not returned`));
  });

  test.each([
    ['hasMore', { hasMore: true }],
    ['an excess totalCount', { totalCount: 2 }],
  ])('a chunk reporting %s throws', async (_label, extra) => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([{ accountid: ACCOUNT, _primarycontactid_value: INSTITUTION_CONTACT }], extra));
    await expect(resolveRequestLiaisons([request()])).rejects.toThrow(/truncated/);
  });

  test('mixed programs: only Research applicants are read', async () => {
    accountAdapter.queryAccounts.mockResolvedValue(accountsResponse([{ accountid: ACCOUNT, _primarycontactid_value: INSTITUTION_CONTACT }]));
    const results = await resolveRequestLiaisons([
      request({ _akoya_programid_value: SOCAL, _akoya_applicantid_value: guid(50) }),
      request(),
    ]);
    expect(accountAdapter.queryAccounts).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r.source)).toEqual(['request_copy', 'institution']);
  });

  test('a non-GUID applicant id is refused before it reaches a filter', async () => {
    await expect(resolveRequestLiaisons([request({ _akoya_applicantid_value: "x' or 1 eq 1" })])).rejects.toThrow(/GUID/);
    expect(accountAdapter.queryAccounts).not.toHaveBeenCalled();
  });
});

test('isResearchProgram compares case-insensitively and rejects blanks', () => {
  expect(isResearchProgram(SER)).toBe(true);
  expect(isResearchProgram(SER.toLowerCase())).toBe(true);
  expect(isResearchProgram(SOCAL)).toBe(false);
  expect(isResearchProgram(null)).toBe(false);
  expect(isResearchProgram('')).toBe(false);
});
