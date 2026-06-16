/**
 * @jest-environment node
 *
 * /api/workbench/triage — set wmkf_triagestatus behind a HARD manage gate.
 * Covers: superuser allowed, lead-PD allowed, non-lead-PD 403, null-PD 403
 * (superuser-only), GUID-400, bad-value-400, 404, 405, and that the write
 * targets only wmkf_triagestatus.
 */
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  getUserRole: jest.fn(async () => 'read_only'),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

const getRecord = jest.fn();
const updateRecord = jest.fn(async () => {});
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: (...a) => getRecord(...a),
    updateRecord: (...a) => updateRecord(...a),
  },
}));

import handler from '../../pages/api/workbench/triage';
import { requireAppAccess, getUserRole } from '../../lib/utils/auth';
import { TRIAGE_STATUS } from '../../shared/config/triageStatus';

const REQ = '11111111-1111-1111-1111-111111111111';
const PD_SYSID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function post(body) {
  return { method: 'POST', body };
}

// caller is the lead PD by default; getRecord returns that same PD.
function asUser({ profileId = 7, systemId = PD_SYSID } = {}) {
  requireAppAccess.mockResolvedValue({ profileId, session: { user: { dynamicsSystemuserId: systemId } } });
}

beforeEach(() => {
  jest.clearAllMocks();
  getUserRole.mockResolvedValue('read_only');
  asUser();
  getRecord.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: PD_SYSID });
  updateRecord.mockResolvedValue(undefined);
});

test('405 on non-POST', async () => {
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
});

test('lead PD can set triage — writes only wmkf_triagestatus', async () => {
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(200);
  expect(updateRecord).toHaveBeenCalledTimes(1);
  const [entitySet, id, patch] = updateRecord.mock.calls[0];
  expect(entitySet).toBe('akoya_requests');
  expect(id).toBe(REQ);
  expect(patch).toEqual({ wmkf_triagestatus: TRIAGE_STATUS.ADVANCING });
});

test('superuser can set triage even when not the lead PD', async () => {
  asUser({ systemId: 'someone-else' });
  getUserRole.mockResolvedValue('superuser');
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.SET_ASIDE }), r);
  expect(r.statusCode).toBe(200);
  expect(updateRecord).toHaveBeenCalledTimes(1);
});

test('non-lead-PD non-superuser → 403, no write', async () => {
  asUser({ systemId: 'not-the-pd' });
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(403);
  expect(updateRecord).not.toHaveBeenCalled();
});

test('null/absent lead PD → 403 for non-superuser (superuser-only)', async () => {
  getRecord.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: null });
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(403);
  expect(updateRecord).not.toHaveBeenCalled();
});

test('null lead PD → superuser still allowed', async () => {
  getRecord.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: null });
  getUserRole.mockResolvedValue('superuser');
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(200);
  expect(updateRecord).toHaveBeenCalledTimes(1);
});

test('non-GUID requestId → 400, no record read', async () => {
  const r = res();
  await handler(post({ requestId: 'not-a-guid', triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(400);
  expect(getRecord).not.toHaveBeenCalled();
});

test('invalid triageStatus → 400, no record read', async () => {
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: 999 }), r);
  expect(r.statusCode).toBe(400);
  expect(getRecord).not.toHaveBeenCalled();
});

test('missing triageStatus → 400', async () => {
  const r = res();
  await handler(post({ requestId: REQ }), r);
  expect(r.statusCode).toBe(400);
});

test('request not found → 404', async () => {
  getRecord.mockResolvedValue(null);
  const r = res();
  await handler(post({ requestId: REQ, triageStatus: TRIAGE_STATUS.ADVANCING }), r);
  expect(r.statusCode).toBe(404);
  expect(updateRecord).not.toHaveBeenCalled();
});
