/** @jest-environment node */
import handler from '../../pages/api/workbench/primary-discipline';
import { requireAppAccess, actorRefFromSession } from '../../lib/utils/auth';
import { readPrimaryDiscipline, savePrimaryDiscipline } from '../../lib/services/workbench/primary-discipline-service';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(), actorRefFromSession: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_, fn) => fn() }));
jest.mock('../../lib/services/workbench/primary-discipline-service', () => ({ readPrimaryDiscipline: jest.fn(), savePrimaryDiscipline: jest.fn() }));

const id = '11111111-1111-1111-1111-111111111111';
const discipline = '22222222-2222-2222-2222-222222222222';
const response = () => ({ setHeader: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
beforeEach(() => {
  jest.resetAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } });
  actorRefFromSession.mockReturnValue('trusted-actor');
});

test('PATCH passes the session identity, never a body-supplied one', async () => {
  await handler({ method: 'PATCH', body: { requestId: id, version: 'W/"1"', disciplineId: discipline, callerSystemId: 'spoofed' } }, response());
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reviewers');
  expect(savePrimaryDiscipline).toHaveBeenCalledWith({ requestId: id, callerSystemId: 'trusted-actor', version: 'W/"1"', disciplineId: discipline });
});

test('GET asks for the picker list only with options=1', async () => {
  await handler({ method: 'GET', query: { requestId: id } }, response());
  await handler({ method: 'GET', query: { requestId: id, options: '1' } }, response());
  expect(readPrimaryDiscipline.mock.calls.map(([args]) => args.withOptions)).toEqual([false, true]);
});

test('unauthenticated, invalid id and unsupported method never reach the service', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler({ method: 'GET', query: { requestId: id } }, response());
  const res = response();
  await handler({ method: 'GET', query: { requestId: 'bad' } }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  await handler({ method: 'DELETE' }, res);
  expect(res.status).toHaveBeenCalledWith(405);
  expect(readPrimaryDiscipline).not.toHaveBeenCalled();
});

test('a provider failure returns a safe message without details', async () => {
  readPrimaryDiscipline.mockRejectedValue(Object.assign(new Error('secret provider body'), { status: 500 }));
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  const res = response();
  await handler({ method: 'GET', query: { requestId: id } }, res);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/secret/);
  spy.mockRestore();
});
