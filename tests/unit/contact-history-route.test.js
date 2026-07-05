/**
 * @jest-environment node
 *
 * Tests-before coverage (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6)
 * for pages/api/reviewer-finder/contact-history.js ahead of converting its
 * grant-request-owned raw DynamicsService calls (akoya_requests) to the
 * grant-request adapter (the wmkf_apprequestpersons calls have no owning
 * adapter in this cluster and stay raw). Captures CURRENT behavior: golden
 * path (junction + projectleader UNION merges into one row set) and one
 * failure path (missing contactId → 400).
 */
import { createMockReq, createMockRes } from '../helpers/auth-mock';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({})) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryAllRecords: jest.fn(), queryRecords: jest.fn() },
}));

const { DynamicsService } = require('../../lib/services/dynamics-service');

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

let handler;
beforeAll(() => {
  handler = require('../../pages/api/reviewer-finder/contact-history').default;
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('golden path: junction PI row + projectleader-fallback PI row on the same request merge into one row', async () => {
  DynamicsService.queryAllRecords.mockImplementation(async (entity) => {
    if (entity === 'wmkf_apprequestpersons') {
      return { records: [{ _wmkf_request_value: REQUEST_ID, wmkf_role: 100000000, wmkf_authorposition: 0 }] };
    }
    if (entity === 'akoya_requests') {
      return { records: [{ akoya_requestid: REQUEST_ID }] };
    }
    return { records: [] };
  });
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: 'REQ-1',
      akoya_title: 'A Proposal',
      wmkf_meetingdate: '2026-06-15',
      akoya_requeststatus: 'Phase II Pending',
    }],
  });

  const req = createMockReq({ method: 'GET', query: { contactId: CONTACT_ID } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res._data.rows).toEqual([
    expect.objectContaining({
      requestId: REQUEST_ID,
      requestNumber: 'REQ-1',
      role: 'pi',
      sources: ['junction', 'projectleader'],
    }),
  ]);
  expect(res._data.counts).toEqual({ pi: 1, copi: 0, total: 1 });
});

test('failure path: missing contactId → 400', async () => {
  const req = createMockReq({ method: 'GET', query: {} });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res._data).toEqual({ error: 'contactId is required' });
});

test('failure path: malformed contactId (not a GUID) → 400', async () => {
  const req = createMockReq({ method: 'GET', query: { contactId: 'not-a-guid' } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(res._data).toEqual({ error: 'contactId must be a GUID' });
});

test('wrong method → 405', async () => {
  const req = createMockReq({ method: 'POST', query: { contactId: CONTACT_ID } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(405);
  expect(res._data).toEqual({ error: 'Method not allowed' });
});

test('unauthenticated (requireAppAccess denies) → route returns immediately, does not touch the response requireAppAccess already sent', async () => {
  const { requireAppAccess } = require('../../lib/utils/auth');
  requireAppAccess.mockImplementationOnce(async (req, res) => {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  });
  const req = createMockReq({ method: 'GET', query: { contactId: CONTACT_ID } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res._data).toEqual({ error: 'Authentication required' });
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
});

test('happy-path response envelope is pinned exactly (full shape)', async () => {
  DynamicsService.queryAllRecords.mockImplementation(async (entity) => {
    if (entity === 'wmkf_apprequestpersons') {
      return { records: [{ _wmkf_request_value: REQUEST_ID, wmkf_role: 100000000, wmkf_authorposition: 0 }] };
    }
    if (entity === 'akoya_requests') {
      return { records: [{ akoya_requestid: REQUEST_ID }] };
    }
    return { records: [] };
  });
  DynamicsService.queryRecords.mockResolvedValue({
    records: [{
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: 'REQ-1',
      akoya_title: 'A Proposal',
      wmkf_meetingdate: '2026-06-15',
      akoya_requeststatus: 'Phase II Pending',
    }],
  });

  const req = createMockReq({ method: 'GET', query: { contactId: CONTACT_ID } });
  const res = createMockRes();
  await handler(req, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res._data).toEqual({
    contactId: CONTACT_ID,
    rows: [{
      requestId: REQUEST_ID,
      requestNumber: 'REQ-1',
      title: 'A Proposal',
      meetingDate: '2026-06-15',
      cycleCode: expect.any(String),
      cycleLabel: expect.any(String),
      requestStatus: 'Phase II Pending',
      role: 'pi',
      position: 0,
      sources: ['junction', 'projectleader'],
    }],
    counts: { pi: 1, copi: 0, total: 1 },
  });
});
