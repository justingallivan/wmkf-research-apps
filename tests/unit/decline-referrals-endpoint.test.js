/**
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    session: { user: { dynamicsSystemuserId: 'user-1' } },
  })),
}));

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));

const getDeclineReferrals = jest.fn();
const dismissLegacyDeclineReferral = jest.fn();
jest.mock('../../lib/services/workbench/decline-referrals-service', () => ({
  getDeclineReferrals: (...args) => getDeclineReferrals(...args),
  dismissLegacyDeclineReferral: (...args) => dismissLegacyDeclineReferral(...args),
}));

import handler from '../../pages/api/workbench/decline-referrals';

const REQUEST_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SUGGESTION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getDeclineReferrals.mockResolvedValue({ success: true, referrals: [] });
  dismissLegacyDeclineReferral.mockResolvedValue({ success: true, dismissed: true });
});

test('GET lists referrals for the GUID-validated request', async () => {
  const res = response();
  await handler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(getDeclineReferrals).toHaveBeenCalledWith({ requestId: REQUEST_ID });
});

test('PATCH dismisses one exact legacy source note with the authenticated actor', async () => {
  const res = response();
  await handler({
    method: 'PATCH',
    body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(dismissLegacyDeclineReferral).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    actingUserSystemId: 'user-1',
  });
});

test('PATCH rejects malformed ids', async () => {
  const res = response();
  await handler({ method: 'PATCH', body: { requestId: REQUEST_ID, suggestionId: 'bad', referralIndex: 0 } }, res);
  expect(res.statusCode).toBe(400);
  expect(dismissLegacyDeclineReferral).not.toHaveBeenCalled();
});
