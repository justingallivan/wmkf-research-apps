/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/contact-history-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — the logic-level test
 * layer that could not exist while this lived in the route. Adapters mocked.
 */

jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  queryAllRequests: jest.fn(),
  queryRequests: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/app-request-person', () => ({
  __esModule: true,
  queryAllPersons: jest.fn(),
}));

const { queryAllRequests, queryRequests } = require('../../lib/dataverse/adapters/grant-request');
const { queryAllPersons } = require('../../lib/dataverse/adapters/app-request-person');
const { getContactHistory } = require('../../lib/services/reviewer-finder/contact-history-service');

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const REQ_A = '22222222-2222-4222-8222-222222222222';
const REQ_B = '33333333-3333-4333-8333-333333333333';

function meta(id, over = {}) {
  return {
    akoya_requestid: id,
    akoya_requestnum: `REQ-${id.slice(0, 1)}`,
    akoya_title: `Title ${id.slice(0, 1)}`,
    wmkf_meetingdate: '2026-06-15',
    akoya_requeststatus: 'Phase II Pending',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  queryAllPersons.mockResolvedValue({ records: [] });
  queryAllRequests.mockResolvedValue({ records: [] });
  queryRequests.mockResolvedValue({ records: [] });
});

test('junction + projectleader rows for the same request/role merge into one row with both sources', async () => {
  queryAllPersons.mockResolvedValue({
    records: [{ _wmkf_request_value: REQ_A, wmkf_role: 100000000, wmkf_authorposition: 0 }],
  });
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: REQ_A }] });
  queryRequests.mockResolvedValue({ records: [meta(REQ_A)] });

  const out = await getContactHistory({ contactId: CONTACT_ID });

  expect(out.rows).toHaveLength(1);
  expect(out.rows[0]).toMatchObject({
    requestId: REQ_A,
    role: 'pi',
    position: 0,
    sources: ['junction', 'projectleader'],
  });
  expect(out.counts).toEqual({ pi: 1, copi: 0, total: 1 });
  expect(out.contactId).toBe(CONTACT_ID);
});

test('same request with pi AND copi junction rows stays as two distinct rows', async () => {
  queryAllPersons.mockResolvedValue({
    records: [
      { _wmkf_request_value: REQ_A, wmkf_role: 100000000, wmkf_authorposition: 0 },
      { _wmkf_request_value: REQ_A, wmkf_role: 100000001, wmkf_authorposition: 2 },
    ],
  });
  queryRequests.mockResolvedValue({ records: [meta(REQ_A)] });

  const out = await getContactHistory({ contactId: CONTACT_ID });

  expect(out.rows).toHaveLength(2);
  expect(out.counts).toEqual({ pi: 1, copi: 1, total: 2 });
});

test('non-PI/co-PI junction roles (e.g. Senior Personnel) are excluded', async () => {
  queryAllPersons.mockResolvedValue({
    records: [{ _wmkf_request_value: REQ_A, wmkf_role: 100000002, wmkf_authorposition: 3 }],
  });

  const out = await getContactHistory({ contactId: CONTACT_ID });

  expect(out.rows).toEqual([]);
  expect(out.counts).toEqual({ pi: 0, copi: 0, total: 0 });
});

test('rows sort newest-first by meeting date with missing-meta (null date) rows last', async () => {
  queryAllPersons.mockResolvedValue({
    records: [
      { _wmkf_request_value: REQ_A, wmkf_role: 100000000, wmkf_authorposition: 0 },
      { _wmkf_request_value: REQ_B, wmkf_role: 100000000, wmkf_authorposition: 0 },
    ],
  });
  // REQ_B has meta (older date resolvable); REQ_A meta missing → null meetingDate → last.
  queryRequests.mockResolvedValue({ records: [meta(REQ_B, { wmkf_meetingdate: '2024-02-01' })] });

  const out = await getContactHistory({ contactId: CONTACT_ID });

  expect(out.rows.map((r) => r.requestId)).toEqual([REQ_B, REQ_A]);
  expect(out.rows[1]).toMatchObject({
    requestNumber: null,
    title: null,
    meetingDate: null,
    cycleCode: null,
    cycleLabel: null,
    requestStatus: null,
  });
});

test('projectleader-only row is inferred as pi at position 0 with projectleader provenance', async () => {
  queryAllRequests.mockResolvedValue({ records: [{ akoya_requestid: REQ_A }] });
  queryRequests.mockResolvedValue({ records: [meta(REQ_A)] });

  const out = await getContactHistory({ contactId: CONTACT_ID });

  expect(out.rows[0]).toMatchObject({ role: 'pi', position: 0, sources: ['projectleader'] });
});

test('metadata fetch is chunked at 50 request ids per OR-filter query', async () => {
  const ids = Array.from({ length: 60 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
  queryAllPersons.mockResolvedValue({
    records: ids.map((id) => ({ _wmkf_request_value: id, wmkf_role: 100000000, wmkf_authorposition: 0 })),
  });
  queryRequests.mockResolvedValue({ records: [] });

  await getContactHistory({ contactId: CONTACT_ID });

  expect(queryRequests).toHaveBeenCalledTimes(2);
  expect(queryRequests.mock.calls[0][0].filter.split(' or ')).toHaveLength(50);
  expect(queryRequests.mock.calls[1][0].filter.split(' or ')).toHaveLength(10);
});

test("a non-GUID contactId fails closed via odata.eqGuid before any adapter call", async () => {
  // D2 ruling (OData Escape Consolidation Plan, S331): the raw lookup filters
  // are built with odata.eqGuid, which rejects a non-GUID. This adds a
  // service-level guard on top of the route shell's existing GUID validation.
  await expect(
    getContactHistory({ contactId: "11111111'1111-4111-8111-111111111111" }),
  ).rejects.toThrow(/must be a GUID/);

  expect(queryAllPersons).not.toHaveBeenCalled();
  expect(queryAllRequests).not.toHaveBeenCalled();
});

test('adapter failure propagates untyped (shell owns the 500 mapping)', async () => {
  queryAllPersons.mockRejectedValue(new Error('Dataverse unavailable'));

  await expect(getContactHistory({ contactId: CONTACT_ID })).rejects.toThrow('Dataverse unavailable');
});
