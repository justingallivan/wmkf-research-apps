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
const dismissDeclineReferral = jest.fn();
jest.mock('../../lib/services/workbench/decline-referrals-service', () => ({
  getDeclineReferrals: (...args) => getDeclineReferrals(...args),
  dismissDeclineReferral: (...args) => dismissDeclineReferral(...args),
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
  dismissDeclineReferral.mockResolvedValue({ success: true, dismissed: true });
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
    body: {
      requestId: REQUEST_ID,
      suggestionId: SUGGESTION_ID,
      referralVersion: 'legacy:Ada Lovelace',
    },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(dismissDeclineReferral).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    referralIndex: undefined,
    referralVersion: 'legacy:Ada Lovelace',
    actingUserSystemId: 'user-1',
  });
});

test('PATCH dismisses one exact structured referral index', async () => {
  const res = response();
  await handler({
    method: 'PATCH',
    body: {
      requestId: REQUEST_ID,
      suggestionId: SUGGESTION_ID,
      referralIndex: 2,
      referralVersion: 'structured:[{"n":"Ada"},{"n":"Grace"},{"n":"Katherine"}]',
    },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(dismissDeclineReferral).toHaveBeenCalledWith({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    referralIndex: 2,
    referralVersion: 'structured:[{"n":"Ada"},{"n":"Grace"},{"n":"Katherine"}]',
    actingUserSystemId: 'user-1',
  });
});

test('PATCH rejects malformed ids', async () => {
  const res = response();
  await handler({ method: 'PATCH', body: { requestId: REQUEST_ID, suggestionId: 'bad', referralIndex: 0 } }, res);
  expect(res.statusCode).toBe(400);
  expect(dismissDeclineReferral).not.toHaveBeenCalled();
});

test('PATCH rejects an out-of-range structured referral index', async () => {
  const res = response();
  await handler({
    method: 'PATCH',
    body: {
      requestId: REQUEST_ID,
      suggestionId: SUGGESTION_ID,
      referralIndex: 4,
      referralVersion: 'structured:[{"n":"Ada"}]',
    },
  }, res);
  expect(res.statusCode).toBe(400);
  expect(dismissDeclineReferral).not.toHaveBeenCalled();
});

test('PATCH requires the exact referral content version', async () => {
  const res = response();
  await handler({
    method: 'PATCH',
    body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID },
  }, res);
  expect(res.statusCode).toBe(400);
  expect(dismissDeclineReferral).not.toHaveBeenCalled();
});
