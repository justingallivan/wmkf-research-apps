/** @jest-environment node */

jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn(async (_label, callback) => callback()),
}));
jest.mock('../../lib/services/pre-site-visit/preparation-worker', () => ({
  drainStaffDeliberationsPreparations: jest.fn(),
  requestPreparationRetry: jest.fn(),
}));
jest.mock('../../lib/utils/auth', () => ({
  getUserRole: jest.fn(),
  requireAppAccess: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { drainStaffDeliberationsPreparations, requestPreparationRetry } from '../../lib/services/pre-site-visit/preparation-worker';
import { getUserRole, requireAppAccess } from '../../lib/utils/auth';
import cronHandler from '../../pages/api/cron/staff-deliberations-preparation';
import retryHandler from '../../pages/api/workbench/pre-site-visit/retry-preparation';

const REQUEST = 'aaaaaaaa-0000-4000-8000-000000000001';
const PD = 'bbbbbbbb-0000-4000-8000-000000000001';

function response() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.setHeader = jest.fn((name, value) => { res.headers[name] = value; });
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  verifyCronSecret.mockReturnValue(true);
  drainStaffDeliberationsPreparations.mockResolvedValue({ status: 'disabled', blockedBy: ['feature_disabled'] });
  requestPreparationRetry.mockResolvedValue({ success: true, queued: true, requestId: REQUEST });
  requireAppAccess.mockResolvedValue({
    profileId: 9,
    session: { user: { dynamicsSystemuserId: PD } },
  });
  getUserRole.mockResolvedValue('program_director');
});

it('rejects cron auth before establishing DAL context or entering the worker', async () => {
  verifyCronSecret.mockImplementation((_req, res) => { res.status(401).json({ error: 'unauthorized' }); return false; });
  const res = response();
  await cronHandler({ method: 'POST' }, res);
  expect(res.statusCode).toBe(401);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(drainStaffDeliberationsPreparations).not.toHaveBeenCalled();
});

it('allows an authenticated cron request to return disabled without forcing worker activation', async () => {
  const res = response();
  await cronHandler({ method: 'POST' }, res);
  expect(res.body).toMatchObject({ ok: true, status: 'disabled', blockedBy: ['feature_disabled'] });
  expect(withDalContext).toHaveBeenCalledWith('cron-staff-deliberations-preparation', expect.any(Function));
  expect(drainStaffDeliberationsPreparations).toHaveBeenCalledTimes(1);
});

it('requires strict requestId-only retry bodies before entering the retry service', async () => {
  let res = response();
  await retryHandler({ method: 'POST', body: { requestId: REQUEST, force: true } }, res);
  expect(res.statusCode).toBe(400);
  expect(requestPreparationRetry).not.toHaveBeenCalled();

  expect(requestPreparationRetry).not.toHaveBeenCalled();
});

it('passes authenticated lead-PD or superuser identity to the revalidating retry service', async () => {
  let res = response();
  await retryHandler({ method: 'POST', body: { requestId: REQUEST } }, res);
  expect(res.statusCode).toBe(202);
  expect(requestPreparationRetry).toHaveBeenCalledWith(REQUEST, undefined, { callerSystemId: PD, isSuperuser: false });

  requireAppAccess.mockResolvedValueOnce({ profileId: null, session: { user: {} } });
  res = response();
  await retryHandler({ method: 'POST', body: { requestId: REQUEST } }, res);
  expect(res.statusCode).toBe(202);
  expect(requestPreparationRetry).toHaveBeenCalledTimes(2);
  expect(requestPreparationRetry).toHaveBeenLastCalledWith(REQUEST, undefined, { callerSystemId: null, isSuperuser: true });
});
