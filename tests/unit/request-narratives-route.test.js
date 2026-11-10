/** @jest-environment node */
import handler from '../../pages/api/workbench/request-narratives';
import { requireAppAccess, actorRefFromSession } from '../../lib/utils/auth';
import { readRequestNarratives, saveRequestNarratives } from '../../lib/services/workbench/request-narratives-service';
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(), actorRefFromSession: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_, fn) => fn() }));
jest.mock('../../lib/services/workbench/request-narratives-service', () => ({ readRequestNarratives: jest.fn(), saveRequestNarratives: jest.fn() }));
const id = '11111111-1111-1111-1111-111111111111';
const response = () => ({ setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => { jest.resetAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } }); actorRefFromSession.mockReturnValue('trusted-actor'); });
test('PATCH uses session identity only', async () => {
  const res = response();
  const changes = { initial_assessment: 'Staff text' };
  await handler({ method: 'PATCH', body: { requestId: id, version: 'W/"1"', changes, profileId: 999, callerSystemId: 'spoofed' } }, res);
  expect(saveRequestNarratives).toHaveBeenCalledWith({ requestId: id, version: 'W/"1"', changes, profileId: 7, callerSystemId: 'trusted-actor' });
});
test('unauthenticated request cannot reach the service', async () => {
  requireAppAccess.mockResolvedValue(null);
  await handler({ method: 'GET', query: { requestId: id } }, response());
  expect(readRequestNarratives).not.toHaveBeenCalled();
});
test('invalid ID and unsupported method are refused', async () => {
  const res = response();
  await handler({ method: 'GET', query: { requestId: ['bad'] } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  await handler({ method: 'POST' }, res);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(readRequestNarratives).not.toHaveBeenCalled();
});
