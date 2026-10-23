import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  sharedReleaseTemplate,
  loadOwnerReleaseTemplate,
  saveOwnReleaseTemplate,
  clearOwnReleaseTemplate,
} from '../../lib/services/reviewer-release-personalization';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_label, fn) => fn()) }));
jest.mock('../../lib/services/reviewer-release-personalization', () => ({
  RELEASE_TEMPLATE_KINDS: ['withdraw', 'release'],
  sharedReleaseTemplate: jest.fn(), loadOwnerReleaseTemplate: jest.fn(),
  saveOwnReleaseTemplate: jest.fn(), clearOwnReleaseTemplate: jest.fn(),
}));

let handler;
beforeAll(async () => { handler = (await import('../../pages/api/review-manager/release-email-preferences')).default; });
const ownSystemId = '33333333-3333-4333-8333-333333333333';
const shared = { subject: 'Admin', body: '{{greeting}} admin {{signature}}' };
const template = { subject: 'Mine', body: '{{greeting}} mine {{signature}}' };
function call(method, { kind = 'withdraw', ...body } = {}) {
  return {
    req: createMockReq({ method, query: { kind }, body: { kind, ...body } }),
    res: createMockRes(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 17, session: { user: { dynamicsSystemuserId: ownSystemId } } });
  sharedReleaseTemplate.mockResolvedValue({ ok: true, template: shared });
  loadOwnerReleaseTemplate.mockResolvedValue({ ok: true, configured: true, template });
  saveOwnReleaseTemplate.mockResolvedValue({ ok: true, kind: 'withdraw', template });
  clearOwnReleaseTemplate.mockResolvedValue({ ok: true });
});

test('GET reads the exact session owner under the reviewer app gate', async () => {
  const { req, res } = call('GET');
  await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-release-email-preferences', expect.any(Function));
  expect(loadOwnerReleaseTemplate).toHaveBeenCalledWith(ownSystemId, 'withdraw');
  expect(res._data).toEqual({ ok: true, kind: 'withdraw', ownSystemId, shared, configured: true, template });
});

test('GET with no saved row returns the Admin copy as the starting template', async () => {
  loadOwnerReleaseTemplate.mockResolvedValueOnce({ ok: true, configured: false, template: null });
  const { req, res } = call('GET', { kind: 'release' });
  await handler(req, res);
  expect(res._data).toMatchObject({ ok: true, kind: 'release', configured: false, template: shared });
});

test('unknown kinds are rejected before any read', async () => {
  const { req, res } = call('GET', { kind: 'respond' });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(sharedReleaseTemplate).not.toHaveBeenCalled();
});

test('PUT saves only the authenticated user and rejects forged identity fields', async () => {
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(saveOwnReleaseTemplate).toHaveBeenCalledWith(ownSystemId, 'withdraw', template);
  expect(res.statusCode).toBe(200);
  const forged = call('PUT', { template, ownerSystemId: 'someone-else' });
  await handler(forged.req, forged.res);
  expect(forged.res.statusCode).toBe(400);
  expect(saveOwnReleaseTemplate).toHaveBeenCalledTimes(1);
});

test('PUT validation failures are 400 with the error list', async () => {
  saveOwnReleaseTemplate.mockResolvedValueOnce({ ok: false, reason: 'validation', errors: ['link'] });
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._data).toEqual({ ok: false, reason: 'validation', errors: ['link'] });
});

test('DELETE clears only the caller and kind; a template body is refused; denied access does nothing', async () => {
  const { req, res } = call('DELETE', { kind: 'release' });
  await handler(req, res);
  expect(clearOwnReleaseTemplate).toHaveBeenCalledWith(ownSystemId, 'release');
  const withBody = call('DELETE', { template });
  await handler(withBody.req, withBody.res);
  expect(withBody.res.statusCode).toBe(400);
  requireAppAccess.mockResolvedValueOnce(null);
  const denied = call('DELETE');
  await handler(denied.req, denied.res);
  expect(clearOwnReleaseTemplate).toHaveBeenCalledTimes(1);
});

test('a read failure is 503 and never presents Admin copy as the saved default', async () => {
  loadOwnerReleaseTemplate.mockResolvedValueOnce({ ok: false, reason: 'preference_unavailable' });
  const { req, res } = call('GET');
  await handler(req, res);
  expect(res.statusCode).toBe(503);
  expect(res._data).toEqual({ ok: false, reason: 'preference_unavailable' });
});

test('an invalid own default offers a repair path', async () => {
  loadOwnerReleaseTemplate.mockResolvedValueOnce({ ok: false, reason: 'preference_invalid' });
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
  expect(saveOwnReleaseTemplate).not.toHaveBeenCalled();
});
