/**
 * @jest-environment node
 *
 * get_related contact→requests: the Research Liaison relationship comes from
 * the institutions the contact leads (account Primary Contact), merged with the
 * existing role query; the Request's own copy is labelled as the copy.
 * Plan: docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 7.
 */
const queryRecords = jest.fn();
const queryAllAccounts = jest.fn();
const queryRequests = jest.fn();

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: (...args) => queryRecords(...args) },
}));
jest.mock('../../lib/dataverse/adapters/account.js', () => ({
  __esModule: true,
  queryAllAccounts: (...args) => queryAllAccounts(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  __esModule: true,
  queryRequests: (...args) => queryRequests(...args),
}));

import { getRelated } from '../../lib/services/dynamics-explorer/tools/get-related.js';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';

const CONTACT = '304bf67c-ce8f-ee11-8179-000d3a341e8f';
const OTHER = '99999999-9999-4999-8999-999999999999';
const guid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACCOUNT = guid(1);

function req(num, date, over = {}) {
  return {
    akoya_requestid: guid(1000 + num),
    akoya_requestnum: String(num),
    akoya_submitdate: date,
    _akoya_applicantid_value: ACCOUNT,
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
    _akoya_primarycontactid_value: OTHER,
    ...over,
  };
}
const page = (records, extra = {}) => ({ records, count: records.length, totalCount: records.length, hasMore: false, ...extra });
const accounts = (ids, extra = {}) => ({ records: ids.map((accountid) => ({ accountid })), totalCount: ids.length, capped: false, ...extra });
const run = () => getRelated({ source_type: 'contact', source_id: CONTACT, target_type: 'requests' });
const lineFor = (result, num) => result.requests.split('\n').find((line) => line.startsWith(`Req ${num} `));

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.TEST_REQUEST_ISOLATION;
  queryRecords.mockResolvedValue(page([]));
  queryAllAccounts.mockResolvedValue(accounts([]));
  queryRequests.mockResolvedValue(page([]));
});

test('the institution Liaison relationship returns Research Requests of the account the contact leads; the old copy match is labelled as the copy', async () => {
  queryAllAccounts.mockResolvedValue(accounts([ACCOUNT]));
  // Request 1: current institution Liaison, Request copy still a former Liaison.
  queryRequests.mockResolvedValue(page([req(1, '2026-06-01T00:00:00Z')]));
  // Request 2: another institution where the contact is only the stale copy.
  queryRecords.mockResolvedValue(page([req(2, '2025-01-01T00:00:00Z', { _akoya_applicantid_value: guid(2), _akoya_primarycontactid_value: CONTACT })]));

  const result = await run();

  expect(lineFor(result, 1)).toContain('Liaison (institution)');
  expect(lineFor(result, 1)).not.toContain('Request Primary Contact (copy)');
  expect(lineFor(result, 2)).toContain('Request Primary Contact (copy)');
  expect(lineFor(result, 2)).not.toContain('Liaison (institution)');
  expect(queryAllAccounts).toHaveBeenCalledWith({ select: 'accountid', filter: `_primarycontactid_value eq ${CONTACT}` });
  const { filter, orderby, top } = queryRequests.mock.calls[0][0];
  expect(filter).toContain(`_akoya_applicantid_value eq ${ACCOUNT}`);
  for (const id of RESEARCH_PROGRAM_IDS) expect(filter).toContain(`_akoya_programid_value eq ${id}`);
  expect(orderby).toBe('akoya_submitdate desc,akoya_requestid asc');
  expect(top).toBe(100);
  expect(result).toMatchObject({ requestCount: 2, totalCount: 2, hasMore: false });
});

test('a Request found by both queries appears once with both roles', async () => {
  queryAllAccounts.mockResolvedValue(accounts([ACCOUNT]));
  const both = req(3, '2026-01-01T00:00:00Z', { _wmkf_projectleader_value: CONTACT });
  queryRecords.mockResolvedValue(page([both]));
  queryRequests.mockResolvedValue(page([{ ...both, akoya_requestid: both.akoya_requestid.toUpperCase() }]));

  const result = await run();

  expect(result.requests.split('\n')).toHaveLength(1);
  expect(lineFor(result, 3)).toContain('Liaison (institution), PI');
  expect(result.totalCount).toBe(1);
});

test('a SoCal Request of an account the contact leads is not labelled Liaison (institution)', async () => {
  queryAllAccounts.mockResolvedValue(accounts([ACCOUNT]));
  queryRecords.mockResolvedValue(page([req(4, '2026-02-01T00:00:00Z', { _akoya_programid_value: guid(77), _wmkf_projectleader_value: CONTACT })]));

  const result = await run();

  expect(lineFor(result, 4)).not.toContain('Liaison (institution)');
  expect(lineFor(result, 4)).toContain('PI');
});

test('a capped Request query reports a partial list: hasMore, null totalCount, returnedCount', async () => {
  queryRecords.mockResolvedValue(page([req(5, '2026-01-01T00:00:00Z', { _wmkf_projectleader_value: CONTACT })], { totalCount: 250, hasMore: true }));

  const result = await run();

  expect(result).toMatchObject({ requestCount: 1, returnedCount: 1, totalCount: null, hasMore: true });
  expect(result.note).toMatch(/at least 1/);
});

test('a contact leading more than 25 accounts: the newest Request, in an account past the first 25, comes first', async () => {
  const ids = Array.from({ length: 26 }, (_, i) => guid(i + 1));
  queryAllAccounts.mockResolvedValue(accounts(ids));
  queryRequests
    .mockResolvedValueOnce(page([req(6, '2024-01-01T00:00:00Z')]))
    .mockResolvedValueOnce(page([req(7, '2026-09-01T00:00:00Z', { _akoya_applicantid_value: ids[25] })]));

  const result = await run();

  expect(queryRequests).toHaveBeenCalledTimes(2);
  expect(queryRequests.mock.calls[1][0].filter).toContain(`_akoya_applicantid_value eq ${ids[25]}`);
  expect(result.requests.split('\n')[0]).toMatch(/^Req 7 /);
});

test('a chunk with more than 100 matches plus a newer Request in another chunk: one global sort and cap', async () => {
  const ids = Array.from({ length: 26 }, (_, i) => guid(i + 1));
  queryAllAccounts.mockResolvedValue(accounts(ids));
  const older = Array.from({ length: 100 }, (_, i) => req(100 + i, `2025-${String((i % 12) + 1).padStart(2, '0')}-01T00:00:00Z`));
  queryRequests
    .mockResolvedValueOnce(page(older, { totalCount: 140, hasMore: true }))
    .mockResolvedValueOnce(page([req(8, '2026-09-15T00:00:00Z', { _akoya_applicantid_value: ids[25] })]));

  const result = await run();

  const lines = result.requests.split('\n');
  expect(lines).toHaveLength(100);
  expect(lines[0]).toMatch(/^Req 8 /);
  expect(result).toMatchObject({ requestCount: 100, returnedCount: 100, totalCount: null, hasMore: true });
});

test('complete sources give the exact de-duplicated totalCount', async () => {
  queryAllAccounts.mockResolvedValue(accounts([ACCOUNT]));
  queryRecords.mockResolvedValue(page([req(9, '2026-01-01T00:00:00Z', { _wmkf_projectleader_value: CONTACT }), req(10, null, { _wmkf_copi1_value: CONTACT })]));
  queryRequests.mockResolvedValue(page([req(9, '2026-01-01T00:00:00Z'), req(11, '2026-03-01T00:00:00Z')]));

  const result = await run();

  expect(result).toMatchObject({ requestCount: 3, totalCount: 3, hasMore: false });
  expect(result).not.toHaveProperty('returnedCount');
  // Newest first, a missing date last.
  expect(result.requests.split('\n').map((line) => line.split(' ')[1])).toEqual(['11', '9', '10']);
});

test.each([
  ['capped', accounts([ACCOUNT], { capped: true })],
  ['a larger totalCount', accounts([ACCOUNT], { totalCount: 5001 })],
  ['malformed', { value: [] }],
  ['an omitted totalCount', accounts([ACCOUNT], { totalCount: undefined })],
  ['a non-numeric totalCount', accounts([ACCOUNT], { totalCount: '1' })],
])('%s account discovery fails the tool call', async (_label, response) => {
  queryAllAccounts.mockResolvedValue(response);
  await expect(run()).rejects.toThrow(/account discovery was incomplete/);
  expect(queryRequests).not.toHaveBeenCalled();
});

test('a failed institution Request read fails the tool call', async () => {
  queryAllAccounts.mockResolvedValue(accounts([ACCOUNT]));
  queryRequests.mockRejectedValue(new Error('dataverse 503'));
  await expect(run()).rejects.toThrow('dataverse 503');
});

test.each([
  ['an omitted totalCount', { totalCount: undefined }],
  ['a non-numeric totalCount', { totalCount: '1' }],
])('a Request query with %s is reported as partial, never an exact total', async (_label, extra) => {
  queryRecords.mockResolvedValue(page([req(12, '2026-01-01T00:00:00Z', { _wmkf_projectleader_value: CONTACT })], extra));
  const result = await run();
  expect(result).toMatchObject({ totalCount: null, returnedCount: 1, hasMore: true });
});
