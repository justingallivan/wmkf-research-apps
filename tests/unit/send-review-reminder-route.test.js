/** Proof-bound reviewer reminder route for both kinds. */
import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { previewManualReminder, sendManualReminderWithProof } from '../../lib/services/reviewer-manual-reminder';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_label, fn) => fn()) }));
jest.mock('../../lib/services/reviewer-manual-reminder', () => ({ previewManualReminder: jest.fn(), sendManualReminderWithProof: jest.fn() }));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({ authorizeReviewerRequestMutation: jest.fn(async () => ({})) }));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE = { subject: 'Reminder', body: '{{reviewDueDate}}\n\n{{signature}}' };
const PROOF = 'signed-preview-proof';
let handler;
beforeAll(async () => { handler = (await import('../../pages/api/review-manager/send-review-reminder')).default; });
beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 3, session: { user: { dynamicsSystemuserId: 'user-1' } } });
  previewManualReminder.mockResolvedValue({ ok: true, draft: { subject: 'Preview' } });
  sendManualReminderWithProof.mockResolvedValue({ ok: true });
});
function post(body) { return { req: createMockReq({ method: 'POST', body }), res: createMockRes() }; }

test.each(['respond', 'reviewdue'])('%s preview checks request ownership before reading another PD default', async (kind) => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind, action: 'preview' });
  await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'review-manager', 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('review-manager-send-review-reminder', expect.any(Function));
  expect(previewManualReminder).toHaveBeenCalledWith({ kind, requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, actingUserSystemId: 'user-1', template: undefined, proof: undefined });
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 3, callerSystemId: 'user-1', requestIds: [REQUEST_ID], suggestionIds: [SUGGESTION_ID] });
  expect(sendManualReminderWithProof).not.toHaveBeenCalled();
  expect(res.statusCode).toBe(200);
});

test('non-owner preview is denied before reading the assigned PD default or reviewer contact', async () => {
  const { ServiceHttpError } = await import('../../lib/services/service-http-error');
  authorizeReviewerRequestMutation.mockRejectedValueOnce(new ServiceHttpError('forbidden', { httpStatus: 403, body: { ok: false, reason: 'forbidden' } }));
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action: 'preview' });
  await handler(req, res);
  expect(res.statusCode).toBe(403);
  expect(previewManualReminder).not.toHaveBeenCalled();
  expect(sendManualReminderWithProof).not.toHaveBeenCalled();
});

test.each(['respond', 'reviewdue'])('%s send reauthorizes then passes only the reviewed template and proof', async (kind) => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind, action: 'send', template: TEMPLATE, proof: PROOF });
  await handler(req, res);
  expect(authorizeReviewerRequestMutation).toHaveBeenCalledWith({ profileId: 3, callerSystemId: 'user-1', requestIds: [REQUEST_ID], suggestionIds: [SUGGESTION_ID] });
  expect(sendManualReminderWithProof).toHaveBeenCalledWith({ kind, requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, actingUserSystemId: 'user-1', template: TEMPLATE, proof: PROOF });
  expect(res.statusCode).toBe(200);
});

test('legacy send with no proof fails before authorization or mutation', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(res._data.reason).toBe('invalid_preview');
  expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
  expect(sendManualReminderWithProof).not.toHaveBeenCalled();
});

test.each(['other', '', null, 1])('unknown kind %p fails closed', async (kind) => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind, action: 'preview' });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(previewManualReminder).not.toHaveBeenCalled();
});

test('unknown or client-owned fields fail closed', async () => {
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'respond', action: 'send', template: TEMPLATE, proof: PROOF, from: 'attacker@example.org' });
  await handler(req, res);
  expect(res.statusCode).toBe(400);
  expect(sendManualReminderWithProof).not.toHaveBeenCalled();
});

test.each(['preview_stale', 'token_expired', 'conflict'])('%s maps to 409 without claiming route success', async (reason) => {
  sendManualReminderWithProof.mockResolvedValueOnce({ ok: false, reason });
  const { req, res } = post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, kind: 'reviewdue', action: 'send', template: TEMPLATE, proof: PROOF });
  await handler(req, res);
  expect(res.statusCode).toBe(409);
  expect(res._data).toMatchObject({ ok: false, reason });
});
