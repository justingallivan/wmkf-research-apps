/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/admin/prompt-profiles-service', () => ({ getPromptProfiles: jest.fn(), publishPromptProfile: jest.fn(), previewSharedTask: jest.fn() }));
import handler from '../../pages/api/admin/prompt-profiles';
import { requireSuperuser } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { getPromptProfiles, publishPromptProfile, previewSharedTask } from '../../lib/services/admin/prompt-profiles-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() });
beforeEach(() => { jest.clearAllMocks(); requireSuperuser.mockResolvedValue({ profileId: 7 }); });
it.each(['GET', 'PUT', 'POST'])('denies %s before any storage or preview work', async method => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method, body: {} }, response());
  expect(withDalContext).not.toHaveBeenCalled();
  expect(getPromptProfiles).not.toHaveBeenCalled(); expect(publishPromptProfile).not.toHaveBeenCalled(); expect(previewSharedTask).not.toHaveBeenCalled();
});
it('uses trusted identity for publication and rejects a client actor', async () => {
  const body = { profile: { key: 'p' }, expectedVersion: 0, requestId: 'id', profileId: 999 };
  await handler({ method: 'PUT', body }, response());
  expect(publishPromptProfile).toHaveBeenCalledWith({ ...body, profileId: 7 });
  expect(withDalContext).toHaveBeenCalledWith('admin-prompt-profiles', expect.any(Function));
});
it('preview forwards only task draft; client documents and identity are ignored', async () => {
  await handler({ method: 'POST', body: { task: { name: 'n' }, documents: ['real'], profileId: 999 } }, response());
  expect(previewSharedTask).toHaveBeenCalledWith({ task: { name: 'n' } });
});
it('maps conflict and sanitizes unexpected storage errors', async () => {
  const res = response(); getPromptProfiles.mockRejectedValueOnce(new ServiceHttpError('conflict', { httpStatus: 409, body: { error: 'conflict' } }));
  await handler({ method: 'GET' }, res); expect(res.status).toHaveBeenCalledWith(409);
  getPromptProfiles.mockRejectedValueOnce(new Error('private instructions in upstream error'));
  await handler({ method: 'GET' }, res); expect(res.status).toHaveBeenCalledWith(500); expect(JSON.stringify(res.json.mock.calls)).not.toContain('private instructions');
});
