/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_name, fn) => fn()) }));
jest.mock('../../lib/services/reviewer-due-extension', () => ({ previewReviewerDueDateNotification: jest.fn(), saveReviewerDueDateExtension: jest.fn(), retryReviewerDueDateNotification: jest.fn() }));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({ authorizeReviewerRequestMutation: jest.fn() }));
import handler from '../../pages/api/review-manager/review-due-extension';
import { requireAppAccess } from '../../lib/utils/auth';
import { authorizeReviewerRequestMutation } from '../../lib/services/reviewer-request-authorization';
import * as service from '../../lib/services/reviewer-due-extension';
const ID = '11111111-1111-4111-8111-111111111111'; const PD = '22222222-2222-4222-8222-222222222222'; const REQUEST = '33333333-3333-4333-8333-333333333333';
const response = () => ({ statusCode: 200, setHeader: jest.fn(), status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } });
beforeEach(() => { jest.resetAllMocks(); require('../../lib/dataverse/core/context').withDalContext.mockImplementation(async (_name, fn) => fn()); requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: PD } } }); authorizeReviewerRequestMutation.mockResolvedValue({ requestIds: [REQUEST], isSuperuser: true, programDirectorByRequestId: { [REQUEST]: PD } }); Object.values(service).filter(jest.isMockFunction).forEach((fn) => fn.mockResolvedValue({ ok: true, notified: true })); });
test.each(['save', 'restore', 'retry', 'resend'])('final %s has explicit proof contract and server identity', async (action) => {
  const res = response(); await handler({ method: 'POST', body: { action, suggestionId: ID, ...(action === 'save' ? { reviewDueDateOverride: '2099-09-15' } : {}), template: { subject: 'Deadline', body: '' }, cc: [], proof: 'proof' } }, res);
  expect(res.statusCode).toBe(200);
  const fn = ['retry', 'resend'].includes(action) ? service.retryReviewerDueDateNotification : service.saveReviewerDueDateExtension;
  expect(fn).toHaveBeenCalledWith(expect.objectContaining({ actingUserSystemId: PD, expectedRequestId: REQUEST, operation: action, proof: 'proof' }));
});
test('preview is app-gated and delegates without writes', async () => {
  const res = response(); await handler({ method: 'POST', body: { action: 'preview', operation: 'save', suggestionId: ID, reviewDueDateOverride: '2099-09-15' } }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), res, 'review-manager', 'reviewers'); expect(service.previewReviewerDueDateNotification).toHaveBeenCalled(); expect(service.saveReviewerDueDateExtension).not.toHaveBeenCalled();
});
test('superuser who is not assigned PD is denied despite shared helper approval', async () => {
  authorizeReviewerRequestMutation.mockResolvedValue({ isSuperuser: true, requestIds: [REQUEST], programDirectorByRequestId: { [REQUEST]: REQUEST } });
  const res = response(); await handler({ method: 'POST', body: { action: 'preview', operation: 'resend', suggestionId: ID } }, res);
  expect(res.statusCode).toBe(403); expect(service.previewReviewerDueDateNotification).not.toHaveBeenCalled();
});
test('null actor denied before ownership reads', async () => {
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: {} } }); const res = response(); await handler({ method: 'POST', body: {} }, res);
  expect(res.statusCode).toBe(403); expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
});
test.each([{ action: 'unknown', suggestionId: ID }, { action: 'save', suggestionId: ID }, { action: 'preview', operation: 'retry', suggestionId: 'bad' }, { action: 'preview', operation: 'retry', suggestionId: ID, owner: PD }, { action: 'preview', operation: 'retry', suggestionId: ID, reviewDueDateOverride: '1900-01-01' }])('invalid input is rejected before services %p', async (body) => {
  const res = response(); await handler({ method: 'POST', body }, res); expect(res.statusCode).toBe(400); expect(authorizeReviewerRequestMutation).not.toHaveBeenCalled();
});
test.each([['send_unconfirmed', 202], ['preview_stale', 409], ['invalid_cc', 400], ['cc_not_allowed_for_test_request', 409]])('reason %s maps to %s', async (reason, status) => {
  service.previewReviewerDueDateNotification.mockResolvedValue({ ok: false, reason, saved: true, notified: false });
  const res = response(); await handler({ method: 'POST', body: { action: 'preview', operation: 'resend', suggestionId: ID } }, res); expect(res.statusCode).toBe(status); expect(res.body.saved).toBe(true);
});
