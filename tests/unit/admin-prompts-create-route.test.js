/**
 * @jest-environment node
 */
/** POST /api/admin/prompts — create a new prompt (route shell only; service mocked). */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 42 })) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_label, fn) => fn() }));
jest.mock('../../lib/services/admin/prompts-publish-service', () => ({ createPrompt: jest.fn() }));
jest.mock('../../lib/services/admin/prompts-list-service', () => ({ listPrompts: jest.fn() }));

import handler from '../../pages/api/admin/prompts/index';
import { requireSuperuser } from '../../lib/utils/auth';
import { createPrompt } from '../../lib/services/admin/prompts-publish-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }

beforeEach(() => jest.clearAllMocks());

it('passes the body to createPrompt with the gate profile, never a client-supplied one', async () => {
  createPrompt.mockResolvedValue({ status: 'completed', targetVersion: 1 });
  const r = res();
  await handler({ method: 'POST', body: { name: 'a.b', catalog: { title: 'T' }, body: 'x', variables: '{"execution":{}}', profileId: 999, requestId: 'req' } }, r);
  expect(r.statusCode).toBe(200);
  expect(createPrompt).toHaveBeenCalledWith(expect.objectContaining({ name: 'a.b', requestId: 'req', variables: '{"execution":{}}', profileId: 42 }));
});

it('maps a typed service error to its status and body', async () => {
  createPrompt.mockRejectedValue(new ServiceHttpError('exists', { httpStatus: 409, body: { status: 'name_exists', error: 'exists' } }));
  const r = res();
  await handler({ method: 'POST', body: { name: 'a.b' } }, r);
  expect(r.statusCode).toBe(409);
  expect(r.body).toEqual({ status: 'name_exists', error: 'exists' });
});

it('does not create for non-superusers', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'POST', body: { name: 'a.b' } }, res());
  expect(createPrompt).not.toHaveBeenCalled();
});

it('rejects other methods', async () => {
  const r = res();
  await handler({ method: 'DELETE' }, r);
  expect(r.statusCode).toBe(405);
  expect(createPrompt).not.toHaveBeenCalled();
});
