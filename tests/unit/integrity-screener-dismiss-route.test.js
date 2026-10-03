/** @jest-environment node */
const requireAppAccess = jest.fn();
const getScreening = jest.fn();
const dismissMatch = jest.fn();
const getDismissals = jest.fn();
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: (...args) => requireAppAccess(...args) }));
jest.mock('../../lib/services/integrity-service', () => ({
  IntegrityService: {
    getScreening: (...args) => getScreening(...args),
    dismissMatch: (...args) => dismissMatch(...args),
    getDismissals: (...args) => getDismissals(...args),
  },
}));

const handler = require('../../pages/api/integrity-screener/dismiss').default;

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

const OWN = 11;
const OTHER = 12;
const body = { screeningId: OTHER, source: 'pubpeer', screenedName: 'Ada Example', reason: 'different_person' };

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  getScreening.mockImplementation(async (id, profileId) => (id === OWN && profileId === 7 ? { id } : null));
  getDismissals.mockResolvedValue([]);
  dismissMatch.mockResolvedValue(true);
});

test('POST refuses to dismiss a match on another user\'s screening', async () => {
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.statusCode).toBe(404);
  expect(getScreening).toHaveBeenCalledWith(OTHER, 7);
  expect(dismissMatch).not.toHaveBeenCalled();
});

test('GET refuses to list dismissals on another user\'s screening', async () => {
  const res = response();
  await handler({ method: 'GET', query: { screeningId: String(OTHER) } }, res);
  expect(res.statusCode).toBe(404);
  expect(getDismissals).not.toHaveBeenCalled();
});

test('the owner can dismiss and list', async () => {
  const post = response();
  await handler({ method: 'POST', body: { ...body, screeningId: OWN } }, post);
  expect(post.body).toMatchObject({ success: true });
  expect(dismissMatch).toHaveBeenCalledWith(OWN, 'pubpeer', null, 'Ada Example', 'different_person', null);
  const get = response();
  await handler({ method: 'GET', query: { screeningId: String(OWN) } }, get);
  expect(get.body).toMatchObject({ count: 0 });
});
