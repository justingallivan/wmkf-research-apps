/**
 * @jest-environment node
 */
/** PUT /api/admin/prompt-groups — route shell only; service mocked. */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 42 })) }));
jest.mock('../../lib/services/admin/prompt-groups-service', () => ({ savePromptGroups: jest.fn() }));

import handler from '../../pages/api/admin/prompt-groups';
import { requireSuperuser } from '../../lib/utils/auth';
import { savePromptGroups } from '../../lib/services/admin/prompt-groups-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
beforeEach(() => jest.clearAllMocks());

it('saves with the gate profile and the submitted revision', async () => {
  savePromptGroups.mockResolvedValue({ status: 'groups_saved' });
  const r = res();
  await handler({ method: 'PUT', body: { groups: [{ id: 'a', label: 'A' }], expectedRevision: 'W/"1"', profileId: 999 } }, r);
  expect(r.statusCode).toBe(200);
  expect(savePromptGroups).toHaveBeenCalledWith({ groups: [{ id: 'a', label: 'A' }], expectedRevision: 'W/"1"', profileId: 42 });
});

it('maps a typed conflict', async () => {
  savePromptGroups.mockRejectedValue(new ServiceHttpError('x', { httpStatus: 409, body: { status: 'groups_conflict', error: 'x' } }));
  const r = res();
  await handler({ method: 'PUT', body: { groups: [] } }, r);
  expect(r.statusCode).toBe(409);
  expect(r.body.status).toBe('groups_conflict');
});

it('refuses non-superusers and other methods', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'PUT', body: {} }, res());
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
  expect(savePromptGroups).not.toHaveBeenCalled();
});
