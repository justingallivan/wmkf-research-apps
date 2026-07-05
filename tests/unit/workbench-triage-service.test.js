/**
 * @jest-environment node
 *
 * lib/services/workbench/triage-service — logic-level tests (adapter mocked),
 * Stage 4 series A extraction. Pins the HARD manage gate branches (superuser,
 * lead PD, null-PD fail-closed) and the single-field write.
 */

const getById = jest.fn();
const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: (...a) => getById(...a),
  updateById: (...a) => updateById(...a),
}));

const getUserRole = jest.fn(async () => 'read_only');
jest.mock('../../lib/utils/auth', () => ({
  getUserRole: (...a) => getUserRole(...a),
}));

import { setTriageStatus } from '../../lib/services/workbench/triage-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';
const PD = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  jest.clearAllMocks();
  getUserRole.mockResolvedValue('read_only');
  getById.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: PD });
});

const args = (over = {}) => ({ requestId: REQ, triageValue: 100000000, profileId: 7, callerSystemId: PD, ...over });

test('lead PD: writes only wmkf_triagestatus and returns the envelope body', async () => {
  const body = await setTriageStatus(args());
  expect(body).toEqual({ success: true, requestId: REQ, triageStatus: 100000000 });
  expect(updateById).toHaveBeenCalledWith(REQ, { wmkf_triagestatus: 100000000 }, { actingUserSystemId: PD });
});

test('lead-PD match is case-insensitive', async () => {
  getById.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: PD.toUpperCase() });
  await expect(setTriageStatus(args())).resolves.toMatchObject({ success: true });
});

test('non-lead non-superuser → 403, no write', async () => {
  const err = await setTriageStatus(args({ callerSystemId: 'someone-else' })).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(403);
  expect(updateById).not.toHaveBeenCalled();
});

test('null lead PD fails closed for non-superuser; superuser still allowed', async () => {
  getById.mockResolvedValue({ akoya_requestid: REQ, _wmkf_programdirector_value: null });
  const err = await setTriageStatus(args()).catch((e) => e);
  expect(err.httpStatus).toBe(403);

  getUserRole.mockResolvedValue('superuser');
  await expect(setTriageStatus(args({ callerSystemId: 'someone-else' }))).resolves.toMatchObject({ success: true });
});

test('request not found (throw or empty) → 404, no write', async () => {
  getById.mockRejectedValue(new Error('boom'));
  const e1 = await setTriageStatus(args()).catch((e) => e);
  expect(e1.httpStatus).toBe(404);

  getById.mockResolvedValue(null);
  const e2 = await setTriageStatus(args()).catch((e) => e);
  expect(e2.httpStatus).toBe(404);
  expect(updateById).not.toHaveBeenCalled();
});
