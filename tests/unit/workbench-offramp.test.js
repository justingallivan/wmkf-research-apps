/** @jest-environment node */
/**
 * Workbench offramp route (D69, D70): Production only behind
 * WORKBENCH_OFFRAMP_READY, the shared phase admission, request-ETag writes
 * under the staff identity, and the offramp/undo/justification rules.
 */
import handler from '../../pages/api/workbench/offramp';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { requireAppAccess } from '../../lib/utils/auth';
import { getSettingStrict } from '../../lib/services/settings-service';

jest.mock('../../lib/services/settings-service', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({ getById: jest.fn(), updateById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleCode: row => row?.cycleCode,
  linkedCycleExpand: () => 'cycle',
}));
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_name, callback) => callback() }));

const requestId = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const version = 'W/"123"';
const OFFRAMPED = 682090001;
const PENDING = 100000002;
const APPROVED = 100000003;
const row = { akoya_requestid: requestId, cycleCode: 'J27', _etag: version };
const writeOptions = { ifMatch: version, actingUserSystemId: actor, noFallback: true };
const originalEnv = process.env;

async function call(method, extra = {}) {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  const req = method === 'GET'
    ? { method, query: { requestId } }
    : { method, query: {}, body: { requestId, version, ...extra } };
  await handler(req, res);
  return { status: res.status.mock.calls.at(-1)[0], body: res.json.mock.calls.at(-1)?.[0] };
}

function setting(rollout) {
  getSettingStrict.mockResolvedValue({ found: true, value: JSON.stringify(rollout), revision: 'W/"1"' });
}

beforeEach(() => {
  jest.resetAllMocks();
  process.env = { ...originalEnv, VERCEL_ENV: 'production', DYNAMICS_URL: 'https://wmkf.crm.dynamics.com',
    WORKBENCH_PRODUCTION_SCHEMA_READY: 'on', WORKBENCH_PHASE_RELEASE: 'on', WORKBENCH_OFFRAMP_READY: 'on',
    DYNAMICS_IMPERSONATION_ENABLED: 'true' };
  delete process.env.DYNAMICS_SANDBOX_URL;
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: actor } } });
  getById.mockResolvedValue(row);
  setting({ mode: 'on' });
});

afterEach(() => { process.env = originalEnv; });

describe('availability', () => {
  test.each([
    ['the offramp switch is unset', () => { delete process.env.WORKBENCH_OFFRAMP_READY; }],
    ['the offramp switch is not the literal on', () => { process.env.WORKBENCH_OFFRAMP_READY = 'true'; }],
    ['the shared Production switch is unset', () => { delete process.env.WORKBENCH_PRODUCTION_SCHEMA_READY; }],
    ['a sandbox Preview', () => { process.env.VERCEL_ENV = 'preview'; process.env.DYNAMICS_URL = 'https://orgd9e66399.crm.dynamics.com'; }],
    ['the phase rollout is off', () => setting({ mode: 'off' })],
  ])('404 without reading or writing when %s', async (_label, arrange) => {
    arrange();
    expect((await call('GET')).status).toBe(404);
    expect((await call('POST', { action: 'offramp' })).status).toBe(404);
    expect(getById).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });

  test('requires Reviewers app access', async () => {
    await call('GET');
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reviewers');
  });

  test('an earlier cycle is not found', async () => {
    getById.mockResolvedValue({ ...row, cycleCode: 'D26' });
    expect((await call('GET')).status).toBe(404);
  });
});

describe('reading', () => {
  test('no Phase II Status: can offramp, no justification box', async () => {
    const { status, body } = await call('GET');
    expect(status).toBe(200);
    expect(body).toMatchObject({ offramped: false, canOfframp: true, canUndo: false, showJustification: false, version });
  });

  test('offramped from Pending Committee Review: undo restores it', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED, wmkf_phaseiistatus_formatted: 'Phase II Offramped',
      wmkf_phaseiistatusbeforeofframp: PENDING, wmkf_offrampjustification: 'Three Poor reviews.' });
    const { body } = await call('GET');
    expect(body).toMatchObject({ offramped: true, statusLabel: 'Phase II Offramped', canOfframp: false, canUndo: true,
      undoRestores: 'Phase II Pending Committee Review', justification: 'Three Poor reviews.', showJustification: true });
  });

  test('offramped in AkoyaGO with nothing remembered: undo restores blank', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED });
    expect((await call('GET')).body).toMatchObject({ canUndo: true, undoRestores: 'no Phase II Status' });
  });

  test('a later Phase II outcome cannot be offramped', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: APPROVED });
    expect((await call('GET')).body).toMatchObject({ offramped: false, canOfframp: false });
  });

  test('a justification kept after an undo stays visible', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: PENDING, wmkf_offrampjustification: 'Kept.' });
    expect((await call('GET')).body).toMatchObject({ offramped: false, showJustification: true });
  });
});

describe('offramp', () => {
  test.each([
    ['no Phase II Status', undefined, null],
    ['Pending Committee Review', PENDING, PENDING],
  ])('from %s remembers the earlier value in the same write', async (_label, before, remembered) => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: before });
    expect((await call('POST', { action: 'offramp', actor: 'spoofed' })).status).toBe(200);
    expect(updateById).toHaveBeenCalledWith(requestId,
      { wmkf_phaseiistatus: OFFRAMPED, wmkf_phaseiistatusbeforeofframp: remembered }, writeOptions);
  });

  test('refuses a request with a later Phase II outcome', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: APPROVED });
    expect((await call('POST', { action: 'offramp' })).status).toBe(409);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('an already offramped request is not written again', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED, wmkf_phaseiistatusbeforeofframp: PENDING });
    expect((await call('POST', { action: 'offramp' })).status).toBe(200);
    expect(updateById).not.toHaveBeenCalled();
  });
});

describe('undo', () => {
  test.each([
    ['Pending Committee Review', PENDING, PENDING],
    ['nothing remembered', undefined, null],
  ])('restores %s and clears the remembered value', async (_label, remembered, restored) => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED, wmkf_phaseiistatusbeforeofframp: remembered });
    expect((await call('POST', { action: 'undo' })).status).toBe(200);
    expect(updateById).toHaveBeenCalledWith(requestId,
      { wmkf_phaseiistatus: restored, wmkf_phaseiistatusbeforeofframp: null }, writeOptions);
  });

  test('refuses to write back a remembered value outside the allowed starting points', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED, wmkf_phaseiistatusbeforeofframp: APPROVED });
    expect((await call('POST', { action: 'undo' })).status).toBe(409);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('refuses when the request is not offramped', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: PENDING, wmkf_phaseiistatusbeforeofframp: PENDING });
    expect((await call('POST', { action: 'undo' })).status).toBe(409);
    expect(updateById).not.toHaveBeenCalled();
  });
});

describe('justification', () => {
  test('saves trimmed text on an offramped request', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED });
    expect((await call('POST', { action: 'justification', justification: '  Three Poor reviews. ' })).status).toBe(200);
    expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_offrampjustification: 'Three Poor reviews.' }, writeOptions);
  });

  test('can be cleared after an undo', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: PENDING, wmkf_offrampjustification: 'Kept.' });
    expect((await call('POST', { action: 'justification', justification: '' })).status).toBe(200);
    expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_offrampjustification: null }, writeOptions);
  });

  test('refuses a request that was never offramped', async () => {
    expect((await call('POST', { action: 'justification', justification: 'Text.' })).status).toBe(409);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('refuses text over 2,000 characters', async () => {
    getById.mockResolvedValue({ ...row, wmkf_phaseiistatus: OFFRAMPED });
    expect((await call('POST', { action: 'justification', justification: 'x'.repeat(2001) })).status).toBe(400);
    expect(updateById).not.toHaveBeenCalled();
  });
});

describe('write guards', () => {
  test('a stale version is a conflict without a write', async () => {
    getById.mockResolvedValue({ ...row, _etag: 'W/"124"' });
    expect((await call('POST', { action: 'offramp' })).status).toBe(409);
    expect(updateById).not.toHaveBeenCalled();
  });

  test('a row changed during the save is a conflict', async () => {
    updateById.mockRejectedValue({ status: 412 });
    expect((await call('POST', { action: 'offramp' })).status).toBe(409);
  });

  test('admission is checked again just before the write', async () => {
    getSettingStrict
      .mockResolvedValueOnce({ found: true, value: '{"mode":"on"}', revision: 'W/"1"' })
      .mockResolvedValueOnce({ found: true, value: '{"mode":"off"}', revision: 'W/"2"' });
    expect((await call('POST', { action: 'offramp' })).status).toBe(404);
    expect(updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['an unmapped staff identity', () => requireAppAccess.mockResolvedValue({ session: { user: {} } }), 403],
    ['impersonation off', () => { process.env.DYNAMICS_IMPERSONATION_ENABLED = 'false'; }, 503],
  ])('refuses %s', async (_label, arrange, status) => {
    arrange();
    expect((await call('POST', { action: 'offramp' })).status).toBe(status);
    expect(updateById).not.toHaveBeenCalled();
  });

  test.each([
    ['an unknown action', { action: 'approve' }],
    ['a malformed version', { action: 'offramp', version: '123' }],
    ['a justification that is not text', { action: 'justification', justification: 5 }],
  ])('400 for %s', async (_label, extra) => {
    expect((await call('POST', extra)).status).toBe(400);
    expect(updateById).not.toHaveBeenCalled();
  });
});
