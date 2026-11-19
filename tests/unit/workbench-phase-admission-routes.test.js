/** @jest-environment node */
/**
 * The three prose field routes in a Production deployment: the shared phase
 * admission decides on every GET and POST before the request (and its new
 * column) is read, and again just before the conditional write. The roster
 * route has the same cases in workbench-meeting-roster.test.js.
 */
import rationaleHandler from '../../pages/api/workbench/initial-assessment-rationale';
import summaryHandler from '../../pages/api/workbench/staff-review-summary';
import visitHandler from '../../pages/api/workbench/staff-visit-assessment';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { requireAppAccess } from '../../lib/utils/auth';
import { getReviewers } from '../../lib/services/review-manager/reviewers-service';
import { getSettingStrict } from '../../lib/services/settings-service';

jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleCode: row => row?.cycleCode,
  linkedCycleExpand: () => 'cycle',
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_name, callback) => callback() }));
jest.mock('../../lib/services/review-manager/reviewers-service', () => ({ getReviewers: jest.fn() }));

const requestId = '11111111-1111-4111-8111-111111111111';
const other = '44444444-4444-4444-8444-444444444444';
const actor = '22222222-2222-4222-8222-222222222222';
const version = 'W/"123"';
const evidenceHash = 'a'.repeat(64);
const originalEnv = process.env;

const ROUTES = [
  ['staff rationale', rationaleHandler, { rationale: 'New rationale.' }],
  ['staff review summary', summaryHandler, { summary: 'New summary.', evidenceHash }],
  ['staff visit assessment', visitHandler, { assessment: 'New assessment.' }],
];

async function call(handler, method, extra = {}) {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const req = method === 'GET'
    ? { method, query: { requestId } }
    : { method, query: {}, body: { requestId, version, ...extra } };
  await handler(req, res);
  // The routes call res.status(200) before awaiting the read and overwrite it on a refusal: the last one is sent.
  return res.status.mock.calls.at(-1)[0];
}

function setting(rollout) {
  getSettingStrict.mockResolvedValue({ found: true, value: JSON.stringify(rollout), revision: 'W/"1"' });
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv, VERCEL_ENV: 'production', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
    WORKBENCH_PRODUCTION_SCHEMA_READY: 'on', WORKBENCH_PHASE_RELEASE: 'on', DYNAMICS_IMPERSONATION_ENABLED: 'true' };
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: actor } } });
  getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'J27', _etag: version });
  getReviewers.mockResolvedValue({ proposals: [{ staffReviewEvidenceHash: evidenceHash }] });
});

afterEach(() => { process.env = originalEnv; });

describe.each(ROUTES)('%s route in Production', (_label, handler, save) => {
  test('setting on: reads and saves', async () => {
    setting({ mode: 'on' });
    expect(await call(handler, 'GET')).toBe(200);
    expect(await call(handler, 'POST', save)).toBe(200);
    expect(updateById).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['off', { mode: 'off' }],
    ['a pilot without this request', { mode: 'pilot', requestIds: [other] }],
    ['an unrecognised value', { mode: 'everyone' }],
  ])('setting %s: GET and POST are refused before the request is read', async (_name, rollout) => {
    setting(rollout);
    expect(await call(handler, 'GET')).toBe(404);
    expect(await call(handler, 'POST', save)).toBe(404);
    expect(getById).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test('no setting row in Production: refused', async () => {
    getSettingStrict.mockResolvedValue({ found: false, value: null, revision: null });
    expect(await call(handler, 'GET')).toBe(404);
    expect(getById).not.toHaveBeenCalled();
  });

  test('the setting cannot be read: refused', async () => {
    getSettingStrict.mockRejectedValue(new Error('Dataverse unavailable'));
    expect(await call(handler, 'GET')).toBe(404);
    expect(getById).not.toHaveBeenCalled();
  });

  test('a pilot naming this request is admitted', async () => {
    setting({ mode: 'pilot', requestIds: [requestId.toUpperCase()] });
    expect(await call(handler, 'GET')).toBe(200);
  });

  test('a request before 2027 is refused even with the setting on', async () => {
    setting({ mode: 'on' });
    getById.mockResolvedValue({ akoya_requestid: requestId, cycleCode: 'D26', _etag: version });
    expect(await call(handler, 'GET')).toBe(404);
    expect(await call(handler, 'POST', save)).toBe(404);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('switched off between the route check and the write: nothing is written', async () => {
    getSettingStrict
      .mockResolvedValueOnce({ found: true, value: '{"mode":"on"}' })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}' });
    expect(await call(handler, 'POST', save)).toBe(404);
    expect(getById).toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['the Production switch is unset', () => { delete process.env.WORKBENCH_PRODUCTION_SCHEMA_READY; }],
    ['the cycle page release is unset', () => { delete process.env.WORKBENCH_PHASE_RELEASE; }],
  ])('%s: refused without reading the setting', async (_name, change) => {
    setting({ mode: 'on' });
    change();
    expect(await call(handler, 'GET')).toBe(404);
    expect(getSettingStrict).not.toHaveBeenCalled();
    expect(getById).not.toHaveBeenCalled();
  });
});
