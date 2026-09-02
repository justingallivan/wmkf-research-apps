/**
 * GET/POST /api/review-manager/campaign-config — akoya_requests read/write
 * contract test. Written tests-before the Wave-5(c) conversion to the
 * grant-request adapter (getById/updateById) per the data-access-layer
 * migration plan's per-file recipe: golden-path DTO shape + one failure path,
 * pinned against CURRENT behavior BEFORE the raw-call swap (no prior route
 * test existed for this file).
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), updateRecord: jest.fn() },
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (labelOrFn, maybeFn) => {
    const fn = typeof labelOrFn === 'function' ? labelOrFn : maybeFn;
    return Promise.resolve().then(() => fn());
  },
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';
import handler from '../../pages/api/review-manager/campaign-config';

const GUID = '55555555-5555-5555-5555-555555555555';
const READ_SELECT = [
  'akoya_requestid',
  'wmkf_respondoffsetdays', 'wmkf_reviewduedate', 'wmkf_respondreminderenabled',
  'wmkf_respondreminderleaddays', 'wmkf_reviewduereminderenabled', 'wmkf_reviewduereminderleaddays',
  'wmkf_desiredcount',
  'wmkf_quotanotifiedat',
].join(',');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'sys-1' } } });
  DynamicsService.getRecord.mockReset();
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
});

describe('method + auth envelope', () => {
  test('wrong method -> 405 with Allow header, no auth/adapter call', async () => {
    const res = mockRes();
    await handler({ method: 'DELETE', query: {}, headers: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(res.headers.Allow).toBe('GET, POST');
    expect(requireAppAccess).not.toHaveBeenCalled();
  });

  test('unauthenticated -> short-circuits before any GUID/adapter work', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const res = mockRes();
    await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
    expect(DynamicsService.getRecord).not.toHaveBeenCalled();
  });
});

describe('GET /api/review-manager/campaign-config (grant-request adapter contract)', () => {
  test('golden: reads the config off the exact READ_SELECT projection', async () => {
    DynamicsService.getRecord.mockResolvedValueOnce({
      akoya_requestid: GUID, wmkf_respondoffsetdays: 5, wmkf_desiredcount: 3, wmkf_quotanotifiedat: null,
    });
    const res = mockRes();
    await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      requestId: GUID,
      config: {
        respondOffsetDays: 5, reviewDueDate: null, respondReminderEnabled: null,
        respondReminderLeadDays: null, reviewDueReminderEnabled: null, reviewDueReminderLeadDays: null,
        desiredCount: 3, quotaNotifiedAt: null,
      },
    });
    expect(DynamicsService.getRecord).toHaveBeenCalledWith('akoya_requests', GUID, { select: READ_SELECT });
  });

  test('failure: unknown requestId -> 404', async () => {
    DynamicsService.getRecord.mockRejectedValueOnce(new Error('not found'));
    const res = mockRes();
    await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/review-manager/campaign-config (grant-request adapter contract)', () => {
  test('golden: writes only the provided fields with actingUserSystemId (no ifMatch)', async () => {
    DynamicsService.getRecord.mockResolvedValue({ akoya_requestid: GUID });
    const res = mockRes();
    await handler({
      method: 'POST',
      body: { requestId: GUID, config: { respondOffsetDays: 7, desiredCount: 4 } },
      headers: {},
    }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(DynamicsService.updateRecord).toHaveBeenCalledWith('akoya_requests', GUID,
      { wmkf_respondoffsetdays: 7, wmkf_desiredcount: 4 },
      { actingUserSystemId: 'sys-1' });
    expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({
      profileId: undefined,
      callerSystemId: 'sys-1',
      requestIds: [GUID],
    });
  });
});
