/** @jest-environment node */
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({ getByIdWithSelect: jest.fn(), isExcluded: jest.fn(() => false), updateLifecycle: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/system-user.js', () => ({ getById: jest.fn() }));
jest.mock('../../lib/services/email-signature.js', () => ({ resolveSignatureForRequest: jest.fn() }));
jest.mock('../../lib/services/dynamics-service.js', () => ({ DynamicsService: { createAndSendEmail: jest.fn() } }));
jest.mock('../../lib/services/test-requests/reviewer-directed-email.js', () => ({ assertReviewerDirectedEmailBound: jest.fn() }));
jest.mock('../../lib/services/test-requests/request-test-state.js', () => ({ resolveRequestTestState: jest.fn() }));
jest.mock('../../lib/services/reviewer-deadline-personalization.js', () => ({
  ...jest.requireActual('../../lib/services/reviewer-deadline-personalization.js'),
  sharedDeadlineTemplate: jest.fn(), resolveSenderDeadlineTemplate: jest.fn(),
  mintDeadlinePreviewProof: jest.fn(async (digest) => digest),
  verifyDeadlinePreviewProof: jest.fn(async (proof, digest) => proof === digest),
}));
jest.mock('../../lib/services/settings-service.js', () => ({ getSettingStrict: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/user-preference.js', () => ({}));
jest.mock('../../lib/services/external-token.js', () => ({}));

import { previewReviewerDueDateNotification as preview, saveReviewerDueDateExtension as save, retryReviewerDueDateNotification as retry, renderReviewerDueDateUpdate, normalizeDeadlineCc } from '../../lib/services/reviewer-due-extension';
import * as suggestions from '../../lib/dataverse/adapters/reviewer-suggestion';
import { getById as getRequest } from '../../lib/dataverse/adapters/grant-request';
import { getById as getPerson } from '../../lib/dataverse/adapters/potential-reviewer';
import { getById as getPd } from '../../lib/dataverse/adapters/system-user';
import { resolveSignatureForRequest } from '../../lib/services/email-signature';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { assertReviewerDirectedEmailBound } from '../../lib/services/test-requests/reviewer-directed-email';
import { resolveRequestTestState } from '../../lib/services/test-requests/request-test-state';
import { sharedDeadlineTemplate, resolveSenderDeadlineTemplate, mintDeadlinePreviewProof } from '../../lib/services/reviewer-deadline-personalization';
const ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const PD = '44444444-4444-4444-8444-444444444444';
const TEMPLATE = { subject: 'Updated review deadline: {{proposalTitle}}', body: '{{greeting}}\n{{reviewDueDate}}\n{{signature}}' };
const INPUT = { suggestionId: ID, expectedRequestId: REQUEST, actingUserSystemId: PD, operation: 'save', reviewDueDateOverride: '2099-09-15', cc: [] };
let row;
let request;
let oldImpersonation;
beforeEach(() => {
  jest.resetAllMocks(); oldImpersonation = process.env.DYNAMICS_IMPERSONATION_ENABLED; process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  row = { wmkf_appreviewersuggestionid: ID, _wmkf_request_value: REQUEST, wmkf_accepted: true, wmkf_reviewstatus: 100000001,
    wmkf_reviewduedateoverride: null, wmkf_externaltokenhash: 'hash', wmkf_externaltokenexpires: '2099-12-01T23:59:59Z',
    wmkf_reviewerfirstname: 'Ada', wmkf_reviewerlastname: 'Lovelace', wmkf_revieweremail: 'reviewer@example.org', _etag: 'W/"7"' };
  request = { akoya_requestid: REQUEST, akoya_title: 'Telescope', wmkf_reviewduedate: '2099-09-01', _wmkf_programdirector_value: PD };
  suggestions.getByIdWithSelect.mockImplementation(async () => ({ ...row }));
  suggestions.isExcluded.mockReturnValue(false);
  suggestions.updateLifecycle.mockImplementation(async (_id, change) => { row = { ...row, wmkf_reviewduedateoverride: change.reviewDueDateOverride, _etag: 'W/"8"' }; });
  getRequest.mockImplementation(async () => ({ ...request }));
  getPd.mockResolvedValue({ systemuserid: PD, internalemailaddress: 'pd@wmkeck.org', isdisabled: false });
  getPerson.mockResolvedValue(null); resolveSignatureForRequest.mockResolvedValue('Pat Director');
  resolveRequestTestState.mockResolvedValue({ kind: 'ordinary' });
  assertReviewerDirectedEmailBound.mockResolvedValue({});
  sharedDeadlineTemplate.mockResolvedValue({ ok: true, template: TEMPLATE });
  resolveSenderDeadlineTemplate.mockImplementation(async (_pd, shared) => ({ template: shared, templateSource: 'shared' }));
  mintDeadlinePreviewProof.mockImplementation(async (digest) => digest);
  const { verifyDeadlinePreviewProof } = require('../../lib/services/reviewer-deadline-personalization');
  verifyDeadlinePreviewProof.mockImplementation(async (proof, digest) => proof === digest);
  DynamicsService.createAndSendEmail.mockResolvedValue('email');
});
afterEach(() => { if (oldImpersonation === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED; else process.env.DYNAMICS_IMPERSONATION_ENABLED = oldImpersonation; });
async function reviewed(input = INPUT) {
  const result = await preview(input); expect(result.ok).toBe(true);
  return { ...input, template: result.preview.template, cc: result.preview.cc, proof: result.preview.proof };
}
test('preview has no writes and supplies exact identity, date and rendered copy', async () => {
  const result = await preview(INPUT);
  expect(result.preview).toMatchObject({ subject: 'Updated review deadline: Telescope', from: 'pd@wmkeck.org', to: 'reviewer@example.org', cc: [], effectiveReviewDeadline: '2099-09-15' });
  expect(suggestions.updateLifecycle).not.toHaveBeenCalled(); expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test('conditional save precedes send, uses reviewed ETag and PD impersonation', async () => {
  expect(await save(await reviewed())).toMatchObject({ ok: true, saved: true, notified: true });
  expect(suggestions.updateLifecycle).toHaveBeenCalledWith(ID, expect.objectContaining({ reviewDueDateOverride: '2099-09-15' }), { ifMatch: 'W/"7"', actingUserSystemId: PD });
  expect(suggestions.updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(DynamicsService.createAndSendEmail.mock.invocationCallOrder[0]);
  expect(DynamicsService.createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({ from: 'pd@wmkeck.org', to: 'reviewer@example.org', actingUserSystemId: PD, noFallback: true, attachments: [expect.any(Object)] }));
});
test.each(['', '   '])('empty/whitespace body %p survives preview and transport with no reinserted signature', async (body) => {
  const input = await reviewed({ ...INPUT, template: { subject: 'Deadline', body } });
  expect(await save(input)).toMatchObject({ ok: true });
  const email = DynamicsService.createAndSendEmail.mock.calls[0][0];
  expect(email.body).not.toContain('Pat Director');
  if (body === '') expect(email.body).toBe('');
  expect(email.attachments[0]).toBeTruthy();
});
test('Cc normalized, deduped, proof-bound and passed to transport and safety checks', async () => {
  const input = await reviewed({ ...INPUT, cc: [' Friend@Example.org ', 'friend@example.org'] });
  expect(input.cc).toEqual(['friend@example.org']); await save(input);
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].cc).toEqual(['friend@example.org']);
  expect(assertReviewerDirectedEmailBound).toHaveBeenCalledWith(expect.objectContaining({ recipients: ['reviewer@example.org', 'friend@example.org'] }));
});
test.each([['bad'], ['reviewer@example.org'], ['pd@wmkeck.org'], Array(21).fill('x@example.org')])('rejects invalid Cc %p before writes', async (...values) => {
  const cc = values; expect((await preview({ ...INPUT, cc })).ok).toBe(false); expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
});
test('synthetic rejects a nonempty otherwise-valid Cc even if allowlisted; unknown state fails closed', async () => {
  resolveRequestTestState.mockResolvedValue({ kind: 'synthetic' });
  expect(await preview({ ...INPUT, cc: ['safe@example.org'] })).toMatchObject({ ok: false, reason: 'cc_not_allowed_for_test_request' });
  resolveRequestTestState.mockResolvedValue({ kind: 'unknown' });
  expect(await preview(INPUT)).toMatchObject({ ok: false, reason: 'recipient_policy_refused' });
  expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
});
test('test classification change after write stops dispatch without losing saved fact or offering unchanged retry', async () => {
  const input = await reviewed({ ...INPUT, cc: ['safe@example.org'] });
  suggestions.updateLifecycle.mockImplementation(async () => { row.wmkf_reviewduedateoverride = '2099-09-15'; row._etag = 'W/"8"'; resolveRequestTestState.mockResolvedValue({ kind: 'synthetic' }); });
  expect(await save(input)).toMatchObject({ saved: true, notified: false, reason: 'cc_not_allowed_for_test_request' });
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test('absent actor denied before any read and reassigned PD cannot send as new PD', async () => {
  expect(await preview({ ...INPUT, actingUserSystemId: null })).toMatchObject({ reason: 'assigned_pd_required' });
  expect(suggestions.getByIdWithSelect).not.toHaveBeenCalled();
  const input = await reviewed(); request._wmkf_programdirector_value = REQUEST;
  expect(await save(input)).toMatchObject({ reason: 'assigned_pd_required' }); expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
});
test.each(['cc', 'template', 'etag', 'requestTitle'])('proof refuses changed %s without writes', async (change) => {
  let input = await reviewed();
  if (change === 'cc') input = { ...input, cc: ['other@example.org'] };
  if (change === 'template') input = { ...input, template: { ...TEMPLATE, body: 'Changed' } };
  if (change === 'etag') row._etag = 'W/"9"';
  if (change === 'requestTitle') request.akoya_title = 'Another title';
  expect(await save(input)).toMatchObject({ reason: 'preview_stale' }); expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
});
test('no legacy direct-send bypass without template/proof', async () => {
  expect(await save(INPUT)).toMatchObject({ reason: 'invalid_preview' });
  expect(await retry({ ...INPUT, template: TEMPLATE })).toMatchObject({ reason: 'preview_stale' });
  expect(suggestions.updateLifecycle).not.toHaveBeenCalled(); expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test.each([
  ['declined', { wmkf_declined: true }, 'ineligible'],
  ['received', { wmkf_reviewreceivedat: '2099-01-01' }, 'ineligible'],
  ['terminal status without timestamp', { wmkf_reviewstatus: 100000003 }, 'ineligible'],
  ['completed', { wmkf_completedat: '2099-01-01' }, 'ineligible'],
  ['not accepted', { wmkf_accepted: false }, 'ineligible'],
  ['revoked token', { wmkf_externaltokenrevoked: true }, 'token_recovery_required'],
  ['short expiry', { wmkf_externaltokenexpires: '2099-09-02' }, 'token_recovery_required'],
])('rejects %s before writes', async (_name, patch, reason) => {
  Object.assign(row, patch); expect(await preview(INPUT)).toMatchObject({ reason }); expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
});
test('allows pre-materials no-token extension; confirmed snapshot wins over person fallback', async () => {
  row.wmkf_externaltokenhash = null; getPerson.mockResolvedValue({ wmkf_name: 'Other', wmkf_emailaddress: 'other@example.org' });
  expect((await preview(INPUT)).preview.to).toBe('reviewer@example.org'); expect(getPerson).not.toHaveBeenCalled();
});
test('legacy blank identity falls back to linked reviewer; no identity blocks', async () => {
  row.wmkf_reviewerfirstname = ''; row.wmkf_reviewerlastname = ''; row.wmkf_revieweremail = ''; row._wmkf_potentialreviewer_value = PD;
  getPerson.mockResolvedValue({ wmkf_name: 'Ada Lovelace', wmkf_emailaddress: 'fallback@example.org' });
  expect((await preview(INPUT)).preview.to).toBe('fallback@example.org');
  getPerson.mockResolvedValue(null); expect(await preview(INPUT)).toMatchObject({ reason: 'notification_unavailable' });
});
test('restoring previews original date and clears override only on final action', async () => {
  row.wmkf_reviewduedateoverride = '2099-09-15';
  const input = await reviewed({ ...INPUT, operation: 'restore', reviewDueDateOverride: undefined });
  expect(suggestions.updateLifecycle).not.toHaveBeenCalled();
  expect(await save(input)).toMatchObject({ ok: true, effectiveReviewDeadline: '2099-09-01' }); expect(row.wmkf_reviewduedateoverride).toBeNull();
});
test('definite failure issues post-write retry proof, retry sends retained copy without another write', async () => {
  const input = await reviewed();
  DynamicsService.createAndSendEmail.mockRejectedValueOnce(Object.assign(new Error('failed'), { dispatched: false }));
  const result = await save(input); expect(result).toMatchObject({ saved: true, notified: false, retryable: true, retryProof: expect.any(String) });
  expect(await retry({ ...input, operation: 'retry', proof: input.proof })).toMatchObject({ reason: 'preview_stale' });
  expect(await retry({ ...input, operation: 'retry', proof: result.retryProof })).toMatchObject({ ok: true, saved: false, notified: true });
  expect(suggestions.updateLifecycle).toHaveBeenCalledTimes(1);
});
test('uncertain dispatch never issues a retry proof', async () => {
  DynamicsService.createAndSendEmail.mockRejectedValue(new Error('timeout'));
  expect(await save(await reviewed())).toMatchObject({ saved: true, notified: false, retryable: false, reason: 'send_unconfirmed', retryProof: undefined });
});
test('post-write read failure preserves saved fact and requires new review', async () => {
  const input = await reviewed(); suggestions.updateLifecycle.mockImplementation(async () => { suggestions.getByIdWithSelect.mockRejectedValue(new Error('read failed')); });
  expect(await save(input)).toMatchObject({ saved: true, notified: false, requiresPreview: true }); expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test('post-write unrelated concurrent changes cannot be rebased into a retry proof', async () => {
  const input = await reviewed(); suggestions.updateLifecycle.mockImplementation(async () => { row.wmkf_reviewduedateoverride = '2099-09-15'; row._etag = 'W/"8"'; request.akoya_title = 'New title'; });
  expect(await save(input)).toMatchObject({ saved: true, reason: 'preview_stale', requiresPreview: true }); expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test('412 means conflict, no email', async () => {
  const input = await reviewed(); suggestions.updateLifecycle.mockRejectedValue({ status: 412 });
  expect(await save(input)).toMatchObject({ reason: 'conflict' }); expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});
test('no-title subject preserves fallback; hostile title is escaped in body and subject CRLF is removed', () => {
  expect(renderReviewerDueDateUpdate({ bodyTemplate: '', reviewerName: 'Ada', dueDate: '2099-09-15' }).subject).toBe('Updated review deadline');
  const rendered = renderReviewerDueDateUpdate({ bodyTemplate: '{{proposalTitle}}', reviewerName: 'Ada', proposalTitle: '<img>\r\nInjected', dueDate: '2099-09-15' });
  expect(rendered.subject).not.toMatch(/[\r\n]/); expect(rendered.body).toContain('&lt;img&gt;');
  expect(normalizeDeadlineCc(null, 'a@example.org', 'b@example.org')).toBeNull();
});
