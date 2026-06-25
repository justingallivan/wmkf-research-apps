/**
 * @jest-environment node
 *
 * Chunk 3 (S289 reviewer-merge): the /api/reviewer-finder/merge-candidates route.
 * Asserts method/GUID guards, plan vs confirm dispatch, acting-user passthrough,
 * and the blocked(409)/validation(400) error mapping. The merge service itself is
 * mocked — its logic is covered by reviewer-merge-service.test.js.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 'P1', session: { user: { dynamicsSystemuserId: 'SYS-1' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-merge', () => ({
  planMerge: jest.fn(async () => ({ blocked: false, repoint: [], collisions: [] })),
  executeMerge: jest.fn(async () => ({ repointed: 1, deleted: 0, emailMoved: false })),
}));

const handler = require('../../pages/api/reviewer-finder/merge-candidates').default;
const mergeService = require('../../lib/services/reviewer-merge');

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

beforeEach(() => { jest.clearAllMocks(); });

test('rejects non-POST with 405', async () => {
  const res = mockRes();
  await handler({ method: 'GET', body: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('POST');
});

test('400 on a non-GUID id (trust boundary)', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { keeperId: 'nope', loserId: LOSER } }, res);
  expect(res.statusCode).toBe(400);
  expect(mergeService.planMerge).not.toHaveBeenCalled();
});

test('POST without confirm returns the read-only plan', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { keeperId: KEEPER, loserId: LOSER } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toHaveProperty('plan');
  expect(mergeService.planMerge).toHaveBeenCalledWith({ keeperId: KEEPER, loserId: LOSER });
  expect(mergeService.executeMerge).not.toHaveBeenCalled();
});

test('POST with confirm executes and threads the acting user', async () => {
  const res = mockRes();
  await handler({ method: 'POST', body: { keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' }, confirm: true } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toMatchObject({ success: true });
  expect(mergeService.executeMerge).toHaveBeenCalledWith({
    keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' }, actingUserSystemId: 'SYS-1',
  });
});

test('maps a blocked merge to 409 with reasons', async () => {
  mergeService.executeMerge.mockRejectedValueOnce(Object.assign(new Error('Merge blocked'), { code: 'merge_blocked', status: 409, reasons: [{ code: 'loser_engaged' }] }));
  const res = mockRes();
  await handler({ method: 'POST', body: { keeperId: KEEPER, loserId: LOSER, confirm: true } }, res);
  expect(res.statusCode).toBe(409);
  expect(res.body.reasons).toEqual([{ code: 'loser_engaged' }]);
});

test('maps a validation error to 400', async () => {
  mergeService.planMerge.mockRejectedValueOnce(Object.assign(new Error('keeper record not found'), { code: 'merge_validation', status: 400 }));
  const res = mockRes();
  await handler({ method: 'POST', body: { keeperId: KEEPER, loserId: LOSER } }, res);
  expect(res.statusCode).toBe(400);
});
