import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  sharedDeadlineTemplate,
  loadOwnerDeadlineTemplate,
  saveOwnDeadlineTemplate,
  clearOwnDeadlineTemplate,
} from '../../lib/services/reviewer-deadline-personalization';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_label, fn) => fn()) }));
jest.mock('../../lib/services/reviewer-deadline-personalization', () => ({
  sharedDeadlineTemplate: jest.fn(), loadOwnerDeadlineTemplate: jest.fn(),
  saveOwnDeadlineTemplate: jest.fn(), clearOwnDeadlineTemplate: jest.fn(),
}));

let handler;
beforeAll(async () => { handler = (await import('../../pages/api/review-manager/deadline-email-preferences')).default; });
const ownSystemId = '33333333-3333-4333-8333-333333333333';
const shared = { subject: 'Admin', body: '{{greeting}} admin {{signature}}' };
const template = { subject: 'Mine', body: '' };
function call(method, body = {}) {
  return {
    req: createMockReq({ method, query: {}, body }),
    res: createMockRes(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 17, session: { user: { dynamicsSystemuserId: ownSystemId } } });
  sharedDeadlineTemplate.mockResolvedValue({ ok: true, template: shared });
  loadOwnerDeadlineTemplate.mockResolvedValue({ ok: true, configured: true, template });
  saveOwnDeadlineTemplate.mockResolvedValue({ ok: true, template });
  clearOwnDeadlineTemplate.mockResolvedValue({ ok: true });
});

test('GET reads the exact session owner under the reviewer app gate', async () => {
  const { req, res } = call('GET');
  await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-deadline-email-preferences', expect.any(Function));
  expect(loadOwnerDeadlineTemplate).toHaveBeenCalledWith(ownSystemId);
  expect(res._data).toEqual({ ok: true, ownSystemId, shared, configured: true, template });
});

test('GET with no saved row returns the Admin copy as the starting template', async () => {
  loadOwnerDeadlineTemplate.mockResolvedValueOnce({ ok: true, configured: false, template: null });
  const { req, res } = call('GET');
  await handler(req, res);
  expect(res._data).toMatchObject({ ok: true, configured: false, template: shared });
});

test('PUT saves only the authenticated user and rejects forged identity fields', async () => {
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(saveOwnDeadlineTemplate).toHaveBeenCalledWith(ownSystemId, template);
  expect(res.statusCode).toBe(200);
  const forged = call('PUT', { template, ownerSystemId: 'someone-else' });
  await handler(forged.req, forged.res);
  expect(forged.res.statusCode).toBe(400);
  expect(saveOwnDeadlineTemplate).toHaveBeenCalledTimes(1);
});

test('PUT validation failures are 400 with the error list', async () => {
  saveOwnDeadlineTemplate.mockResolvedValueOnce({ ok: false, reason: 'validation', errors: ['link'] });
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._data).toEqual({ ok: false, reason: 'validation', errors: ['link'] });
});

test('DELETE clears only the caller and kind; a template body is refused; denied access does nothing', async () => {
  const { req, res } = call('DELETE');
  await handler(req, res);
  expect(clearOwnDeadlineTemplate).toHaveBeenCalledWith(ownSystemId);
  const withBody = call('DELETE', { template });
  await handler(withBody.req, withBody.res);
  expect(withBody.res.statusCode).toBe(400);
  requireAppAccess.mockResolvedValueOnce(null);
  const denied = call('DELETE');
  await handler(denied.req, denied.res);
  expect(clearOwnDeadlineTemplate).toHaveBeenCalledTimes(1);
});

test('a read failure is 503 and never presents Admin copy as the saved default', async () => {
  loadOwnerDeadlineTemplate.mockResolvedValueOnce({ ok: false, reason: 'preference_unavailable' });
  const { req, res } = call('GET');
  await handler(req, res);
  expect(res.statusCode).toBe(503);
  expect(res._data).toEqual({ ok: false, reason: 'preference_unavailable' });
});

test('an invalid own default offers a repair path', async () => {
  loadOwnerDeadlineTemplate.mockResolvedValueOnce({ ok: false, reason: 'preference_invalid' });
  const { req, res } = call('GET');
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(res._data).toEqual({ ok: false, reason: 'preference_invalid', ownSystemId, shared, configured: true });
});

test('missing session systemuser is 503 and touches nothing', async () => {
  requireAppAccess.mockResolvedValueOnce({ profileId: 17, session: { user: {} } });
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(res.statusCode).toBe(503);
  expect(saveOwnDeadlineTemplate).not.toHaveBeenCalled();
});
