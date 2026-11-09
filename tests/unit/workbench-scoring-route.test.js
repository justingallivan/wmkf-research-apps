/** @jest-environment node */

import handler from '../../pages/api/workbench/scoring';
import { requireAppAccess } from '../../lib/utils/auth';
import { saveScoring, saveChairsRecommendation } from '../../lib/services/workbench/scoring-service';

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  actorRefFromSession: (session) => session.actor,
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: (_name, fn) => fn(),
}));
jest.mock('../../lib/services/workbench/scoring-service', () => ({
  saveScoring: jest.fn(),
  saveChairsRecommendation: jest.fn(),
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
  saveScoring.mockResolvedValue({ success: true });
  saveChairsRecommendation.mockResolvedValue({ success: true });
});

test('a payload without a stage dispatches to scoring', async () => {
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(saveScoring).toHaveBeenCalledWith({ ...body, profileId: 7, callerSystemId });
  expect(saveChairsRecommendation).not.toHaveBeenCalled();
});

test('the recommendation stage dispatches with the authenticated actor', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, stage: 'chairs-recommendation', callerSystemId: 'spoofed' } }, res);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(saveChairsRecommendation).toHaveBeenCalledWith({ ...body, profileId: 7, callerSystemId });
  expect(saveScoring).not.toHaveBeenCalled();
});

test('an unknown stage does not fall back to a scoring save', async () => {
  const res = response();
  await handler({ method: 'POST', body: { ...body, stage: 'final' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(saveScoring).not.toHaveBeenCalled();
  expect(saveChairsRecommendation).not.toHaveBeenCalled();
});
