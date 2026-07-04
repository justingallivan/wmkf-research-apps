/**
 * @jest-environment node
 */
/**
 * /api/grant-reporting/lookup-grant — contract test written BEFORE converting
 * the raw `DynamicsService.queryRecords('akoya_requests', ...)` call to the
 * grant-request adapter's `findByRequestNumber` (Wave 5 conversion,
 * data-access-layer migration plan). Pins the golden-path response DTO shape
 * and the not-found failure path so the conversion is provably
 * behavior-preserving. This route had no prior handler-level test.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: {} } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const queryRecords = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { queryRecords: (...a) => queryRecords(...a) },
}));

const getRequestSharePointBuckets = jest.fn(async () => []);
jest.mock('../../lib/utils/sharepoint-buckets', () => ({
  getRequestSharePointBuckets: (...a) => getRequestSharePointBuckets(...a),
}));

import handler from '../../pages/api/grant-reporting/lookup-grant';
import { requireAppAccess } from '../../lib/utils/auth';

function res() {
  return {
    statusCode: 200,
    body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function post(body) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: {} } });
  getRequestSharePointBuckets.mockResolvedValue([]);
});

test('rejects non-POST (405)', async () => {
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
});

test('stops when auth fails', async () => {
  requireAppAccess.mockResolvedValue(null);
  const r = res();
  await handler(post({ requestNumber: '1002836' }), r);
  expect(queryRecords).not.toHaveBeenCalled();
});

test('400s when requestNumber is missing', async () => {
  const r = res();
  await handler(post({}), r);
  expect(r.statusCode).toBe(400);
});

test('not found: queries by exact escaped request number, top 1', async () => {
  queryRecords.mockResolvedValue({ records: [] });
  const r = res();
  await handler(post({ requestNumber: "1002'836" }), r);
  expect(queryRecords).toHaveBeenCalledWith('akoya_requests', expect.objectContaining({
    filter: "akoya_requestnum eq '1002''836'",
    top: 1,
  }));
  expect(r.statusCode).toBe(200);
  expect(r.body.found).toBe(false);
  expect(r.body.requestId).toBeNull();
});

test('golden path: found record builds the header DTO', async () => {
  queryRecords.mockResolvedValue({
    records: [{
      akoya_requestid: 'guid-1',
      akoya_requestnum: '1002836',
      akoya_title: 'Test Grant',
      wmkf_abstract: 'Abstract text',
      akoya_grant: 50000,
      akoya_begindate: '2026-01-01',
      akoya_enddate: '2026-12-31',
      _akoya_programid_value_formatted: 'Science',
      _wmkf_projectleader_value_formatted: 'Dr. PI',
    }],
  });
  const r = res();
  await handler(post({ requestNumber: '1002836' }), r);

  expect(r.statusCode).toBe(200);
  expect(r.body.found).toBe(true);
  expect(r.body.requestId).toBe('guid-1');
  expect(r.body.header).toMatchObject({
    title: 'Test Grant',
    pis: ['Dr. PI'],
    award_amount: '$50,000',
    subject_area: 'Science',
    abstract: 'Abstract text',
  });
});
