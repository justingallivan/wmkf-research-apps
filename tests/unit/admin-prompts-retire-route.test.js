/**
 * @jest-environment node
 */
/** POST /api/admin/prompts/[name] { action: 'retire' } — route shell only. */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(async () => ({ profileId: 42 })) }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: (_label, fn) => fn() }));
jest.mock('../../lib/services/admin/prompts-publish-service', () => ({ getPrompt: jest.fn(), publishPrompt: jest.fn(), retirePrompt: jest.fn() }));
jest.mock('../../lib/services/admin/prompts-catalog-service', () => ({ updatePromptCatalog: jest.fn() }));

import handler from '../../pages/api/admin/prompts/[name]';
import { requireSuperuser } from '../../lib/utils/auth';
import { retirePrompt } from '../../lib/services/admin/prompts-publish-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

function res() { return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } }; }
beforeEach(() => jest.clearAllMocks());

it('retires with the gate profile, never a client-supplied one', async () => {
  retirePrompt.mockResolvedValue({ status: 'completed', kind: 'retire' });
  const r = res();
  await handler({ method: 'POST', query: { name: 'a.b' }, body: { action: 'retire', expectedVersion: 2, requestId: 'q', profileId: 999 } }, r);
  expect(r.statusCode).toBe(200);
  expect(retirePrompt).toHaveBeenCalledWith({ name: 'a.b', expectedVersion: 2, requestId: 'q', profileId: 42 });
});

it('refuses an unknown action', async () => {
  const r = res();
  await handler({ method: 'POST', query: { name: 'a.b' }, body: { action: 'delete' } }, r);
  expect(r.statusCode).toBe(400);
  expect(retirePrompt).not.toHaveBeenCalled();
});

it('maps a blocked retire', async () => {
  retirePrompt.mockRejectedValue(new ServiceHttpError('x', { httpStatus: 409, body: { status: 'retire_blocked_application', error: 'x' } }));
  const r = res();
  await handler({ method: 'POST', query: { name: 'a.b' }, body: { action: 'retire' } }, r);
  expect(r.statusCode).toBe(409);
  expect(r.body.status).toBe('retire_blocked_application');
});

it('does nothing for non-superusers', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await handler({ method: 'POST', query: { name: 'a.b' }, body: { action: 'retire' } }, res());
  expect(retirePrompt).not.toHaveBeenCalled();
});
