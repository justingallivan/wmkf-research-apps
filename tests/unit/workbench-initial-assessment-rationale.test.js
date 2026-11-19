/** @jest-environment node */

import { getMetadataBatch } from '../../lib/dataverse/adapters/metadata';
jest.mock('../../lib/dataverse/adapters/metadata', () => ({ getMetadataBatch: jest.fn() }));
import handler from '../../pages/api/workbench/initial-assessment-rationale';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { requireAppAccess } from '../../lib/utils/auth';

// The phase rollout setting (phase-admission.js): absent, which outside Production means on.
jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn(async () => ({ found: false, value: null, revision: null })) }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(), updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleCode: row => row?.cycleCode,
  linkedCycleExpand: () => 'cycle',
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_name, callback) => callback() }));

const requestId = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const version = 'W/"123"';
const body = { requestId, version, rationale: 'Staff rationale.' };
const row = { akoya_requestid: requestId, cycleCode: 'J27', _etag: version };
const originalEnv = process.env;

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv, INITIAL_RATIONALE_SCHEMA_READY: 'on', VERCEL_ENV: 'preview', DYNAMICS_IMPERSONATION_ENABLED: 'true', DYNAMICS_URL: 'https://orgd9e66399.crm.dynamics.com' };
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: actor } } });
  getById.mockResolvedValue(row);
});

afterEach(() => { process.env = originalEnv; });

test('Workbench staff can save the Initial Assessment rationale without lead ownership', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, actor: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'reviewers');
  expect(updateById).toHaveBeenCalledWith(requestId, {
    wmkf_initialassessmentrationale: body.rationale,
  }, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
});

test('the reader returns the saved rationale', async () => {
  getById.mockResolvedValue({ ...row, wmkf_initialassessmentrationale: body.rationale });
  const res = response();
  await handler({ method: 'GET', query: { requestId } }, res);
  expect(res.json).toHaveBeenCalledWith({ rationale: body.rationale, version });
});

test('production-backed Preview rejects direct saves before any Dataverse access', async () => {
  process.env.DYNAMICS_URL = 'https://wmkf.crm.dynamics.com';
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(404);
  expect(getById).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
});

test.each([
  ['an earlier cycle', { cycleCode: 'D26' }, 404],
  ['a stale request version', { _etag: 'W/"124"' }, 409],
])('refuses %s without writing', async (_label, override, status) => {
  getById.mockResolvedValue({ ...row, ...override });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(status);
  expect(updateById).not.toHaveBeenCalled();
});

test('a row changed during save returns conflict without a retry', async () => {
  updateById.mockRejectedValue({ status: 412 });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(409);
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('saving fails closed if staff attribution is disabled', async () => {
  delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(updateById).not.toHaveBeenCalled();
});

test('saving the same rationale with a current version succeeds without another write', async () => {
  getById.mockResolvedValue({ ...row, wmkf_initialassessmentrationale: body.rationale });
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(updateById).not.toHaveBeenCalled();
});

test('unprovisioned schema and production deployment refuse access before Dataverse', async () => {
  delete process.env.INITIAL_RATIONALE_SCHEMA_READY;
  const res = response();
  await handler({ method: 'GET', query: { requestId } }, res);
  process.env.INITIAL_RATIONALE_SCHEMA_READY = 'on';
  process.env.VERCEL_ENV = 'production';
  await handler({ method: 'POST', body }, res);
  expect(res.status.mock.calls).toEqual([[404], [404]]);
  expect(getById).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
});

// The step belongs to every cycle from J27 on, not to the cycle named J27.
test.each(['D27', 'J28'])('a later cycle (%s) is read like J27', async (cycleCode) => {
  getById.mockResolvedValue({ ...row, cycleCode });
  const res = response();
  await handler({ method: 'GET', query: { requestId } }, res);
  expect(res.status).not.toHaveBeenCalledWith(404);
  expect(res.json).toHaveBeenCalled();
});


test('Not Scored mode preserves notes and uses the mapped session actor', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000005, wmkf_declinereason: 682090000, wmkf_denialnotes: 'Keep me' });
  getMetadataBatch.mockResolvedValue([{ OptionSet: { Options: [{ Value: 682090003, Label: { LocalizedLabels: [{ LanguageCode: 1033, Label: 'Continuation/incremental' }] } }] } }, { MaxLength: 2000 }]);
  const res = response();
  await handler({ method: 'POST', body: { requestId, version, mode: 'not-scored', reason: 682090003, actor: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_declinereason: 682090003 }, { ifMatch: version, actingUserSystemId: actor, noFallback: true });
});
test('unknown editor modes fail without writing', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, mode: 'unknown' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(updateById).not.toHaveBeenCalled();
});

test('combined assessment saves status and rationale with the session actor in one write', async () => {
  getById.mockResolvedValue({ ...row, _wmkf_programdirector_value: actor, wmkf_phaseistatus: null, wmkf_denialnotes: 'Preserve notes' });
  const res = response();
  await handler({ method: 'POST', body: { ...body, mode: 'assessment', decision: 'yes', actor: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(updateById).toHaveBeenCalledTimes(1);
  expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_phaseistatus: 100000004, wmkf_initialassessmentrationale: body.rationale },
    { ifMatch: version, actingUserSystemId: actor, noFallback: true });
});
test('combined assessment rejects unknown decisions without writing', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, mode: 'assessment', decision: 'unknown' } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(updateById).not.toHaveBeenCalled();
});
test('combined assessment validates version before entering its service', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, mode: 'assessment', decision: 'yes', version: '*' } }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(updateById).not.toHaveBeenCalled();
});
