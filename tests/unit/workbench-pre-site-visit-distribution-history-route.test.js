/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/pre-site-visit/distribution-service', () => ({
  getPreSiteDistributionHistory: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { ServiceHttpError } from '../../lib/services/service-http-error';
import { getPreSiteDistributionHistory } from '../../lib/services/pre-site-visit/distribution-service';
import handler from '../../pages/api/workbench/pre-site-visit/distribution/history';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; return res; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: 'actor' } } });
  getPreSiteDistributionHistory.mockResolvedValue({ attempts: [], currentSourceEverSent: false });
});

test('rejects non-GET methods with Allow and does not call access or service', async () => {
  const res = mockRes();
  await handler({ method: 'POST' }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET');
  expect(requireAppAccess).not.toHaveBeenCalled();
  expect(getPreSiteDistributionHistory).not.toHaveBeenCalled();
});

test('returns the access denial without injecting an actor into the history query', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(getPreSiteDistributionHistory).not.toHaveBeenCalled();
});

test('trims requestId, ignores a GET body, and returns the service projection', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: ` ${REQUEST_ID} ` }, body: { actorId: 'spoofed' } }, res);
  expect(getPreSiteDistributionHistory).toHaveBeenCalledWith({ requestId: REQUEST_ID });
  expect(getPreSiteDistributionHistory.mock.calls[0][0]).not.toHaveProperty('actorId');
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-distribution-history', expect.any(Function));
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, attempts: [], currentSourceEverSent: false });
});

test('real history validation rejects a non-GUID query before any dependency read', async () => {
  const actualHistory = jest.requireActual('../../lib/services/pre-site-visit/distribution-service.js')
    .getPreSiteDistributionHistory;
  getPreSiteDistributionHistory.mockImplementationOnce((input) => actualHistory(input, {}));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, res);
  expect(res.statusCode).toBe(400);
  expect(res.body).toEqual({ error: 'requestId must be a GUID.', code: 'distribution_request_invalid' });
});

test('maps ServiceHttpError status and body from the history service', async () => {
  getPreSiteDistributionHistory.mockRejectedValueOnce(new ServiceHttpError('Request not found.', {
    httpStatus: 404,
    code: 'pre_site_request_not_found',
    body: { error: 'Request not found.', code: 'pre_site_request_not_found' },
  }));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(404);
  expect(res.body).toEqual({ error: 'Request not found.', code: 'pre_site_request_not_found' });
});
