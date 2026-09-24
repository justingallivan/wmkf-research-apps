import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  sharedReminderTemplate,
  loadSenderReminderTemplate,
  saveOwnReminderTemplate,
  clearOwnReminderTemplate,
} from '../../lib/services/reviewer-reminder-personalization';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_label, fn) => fn()) }));
jest.mock('../../lib/services/reviewer-reminder-personalization', () => ({
  REMINDER_KINDS: ['respond', 'reviewdue'],
  sharedReminderTemplate: jest.fn(), loadSenderReminderTemplate: jest.fn(),
  saveOwnReminderTemplate: jest.fn(), clearOwnReminderTemplate: jest.fn(),
}));

let handler;
beforeAll(async () => { handler = (await import('../../pages/api/review-manager/reminder-email-preferences')).default; });
const ownSystemId = '33333333-3333-4333-8333-333333333333';
const template = { subject: 'Mine', body: '{{greeting}} {{signature}}' };
function call(method, { kind = 'respond', ...body } = {}) {
  return {
    req: createMockReq({ method, query: { kind }, body: { kind, ...body } }),
    res: createMockRes(),
  };
}
beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 17, session: { user: { dynamicsSystemuserId: ownSystemId } } });
  sharedReminderTemplate.mockResolvedValue({ ok: true, template });
  loadSenderReminderTemplate.mockResolvedValue({ ok: true, configured: true, template });
  saveOwnReminderTemplate.mockResolvedValue({ ok: true, template });
  clearOwnReminderTemplate.mockResolvedValue(true);
});

test('GET reads exact session owner under the same reviewer app gate', async () => {
  const { req, res } = call('GET');
  await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-reminder-email-preferences', expect.any(Function));
  expect(loadSenderReminderTemplate).toHaveBeenCalledWith(ownSystemId, 'respond', template);
  expect(res._data).toMatchObject({ ok: true, ownSystemId, configured: true, template });
});

test('PUT saves only the authenticated profile and rejects forged identity fields', async () => {
  const { req, res } = call('PUT', { template });
  await handler(req, res);
  expect(saveOwnReminderTemplate).toHaveBeenCalledWith(17, 'respond', template);
  expect(res.statusCode).toBe(200);
  const forged = call('PUT', { template, profileId: 99 });
  await handler(forged.req, forged.res);
  expect(forged.res.statusCode).toBe(400);
  expect(saveOwnReminderTemplate).toHaveBeenCalledTimes(1);
});

test('DELETE clears only the caller kind; disabled access does nothing', async () => {
  const { req, res } = call('DELETE', { kind: 'reviewdue' });
  await handler(req, res);
  expect(clearOwnReminderTemplate).toHaveBeenCalledWith(17, 'reviewdue');
  expect(sharedReminderTemplate).not.toHaveBeenCalled();
  requireAppAccess.mockResolvedValueOnce(null);
  const denied = call('DELETE');
  await handler(denied.req, denied.res);
  expect(clearOwnReminderTemplate).toHaveBeenCalledTimes(1);
});

test('preference read failure does not show shared copy as an apparent personal fallback', async () => {
  loadSenderReminderTemplate.mockResolvedValueOnce({ ok: false, reason: 'preference_unavailable' });
  const { req, res } = call('GET');
  await handler(req, res);
  expect(res.statusCode).toBe(503);
  expect(res._data).toEqual({ ok: false, reason: 'preference_unavailable' });
});
