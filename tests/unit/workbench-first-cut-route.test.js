/** @jest-environment node */

import handler from '../../pages/api/workbench/first-cut';
import { requireAppAccess } from '../../lib/utils/auth';
import { saveFirstCut, saveSemiFinalist } from '../../lib/services/workbench/first-cut-service';

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  actorRefFromSession: (session) => session.actor,
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_name, fn) => fn(),
}));
jest.mock('../../lib/services/workbench/first-cut-service', () => ({
  saveFirstCut: jest.fn(),
  saveSemiFinalist: jest.fn(),
}));

const requestId = '11111111-1111-4111-8111-111111111111';
const callerSystemId = '22222222-2222-4222-8222-222222222222';
const body = { requestId, decision: 'yes', version: 'W/"123"' };

function response() {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { actor: callerSystemId } });
  saveFirstCut.mockResolvedValue({ success: true });
  saveSemiFinalist.mockResolvedValue({ success: true });
});

test('a legacy payload still dispatches to First Cut', async () => {
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(saveFirstCut).toHaveBeenCalledWith({ ...body, profileId: 7, callerSystemId });
  expect(saveSemiFinalist).not.toHaveBeenCalled();
});

test('the Semi-finalist stage dispatches with the authenticated actor', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, stage: 'semi-finalist', callerSystemId: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(saveSemiFinalist).toHaveBeenCalledWith({ ...body, profileId: 7, callerSystemId });
  expect(saveFirstCut).not.toHaveBeenCalled();
});

test('an unknown stage does not fall back to a First Cut save', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, stage: 'final' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(saveFirstCut).not.toHaveBeenCalled();
  expect(saveSemiFinalist).not.toHaveBeenCalled();
});
