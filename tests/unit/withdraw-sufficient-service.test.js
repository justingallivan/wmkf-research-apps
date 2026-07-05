/**
 * Logic-level unit tests for lib/services/review-manager/withdraw-sufficient-service.js
 * (Route→Service Consolidation Plan, Stage 1 pilot — the new test layer that
 * could not exist while logic lived in the route).
 *
 * Adapters + DynamicsService mocked; covers the per-suggestion partial-success
 * matrix and state-before-email ordering. No req/res anywhere — plain args in,
 * plain envelope out, WithdrawSufficientError for domain failures.
 */

const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));
const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));
const getSystemUserById = jest.fn();
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getById: (...a) => getSystemUserById(...a),
}));
const getReviewerByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getReviewerByIdWithSelect(...a),
}));
const createAndSendEmail = jest.fn(async () => ({ emailId: 'e-1' }));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...a) => createAndSendEmail(...a) },
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD' })),
}));
const readRequiredEmailDefaults = jest.fn();
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: (...a) => readRequiredEmailDefaults(...a),
}));
const renderWithdrawSufficient = jest.fn(() => ({ subject: 'Thank you', html: '<p>note</p>' }));
jest.mock('../../lib/external/reviewer-withdraw-email', () => ({
  renderWithdrawSufficient: (...a) => renderWithdrawSufficient(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const SUG2 = '44444444-4444-4444-8444-444444444444';
const PERSON = 'person-1';

let withdrawSufficient;
let WithdrawSufficientError;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/withdraw-sufficient-service');
  withdrawSufficient = mod.withdrawSufficient;
  WithdrawSufficientError = mod.WithdrawSufficientError;
});

function pendingRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_invited: true, wmkf_accepted: false, wmkf_declined: false, wmkf_responsetype: null,
    _etag: 'W/"1"',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getRequestById.mockResolvedValue({
    akoya_requestid: REQ, akoya_title: 'A Proposal', _wmkf_programdirector_value: 'pd-1',
  });
  getSystemUserById.mockResolvedValue({
    systemuserid: 'pd-1', internalemailaddress: 'pd@keck.org', isdisabled: false,
  });
  getReviewerByIdWithSelect.mockResolvedValue({ wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'rev@example.org' });
  readRequiredEmailDefaults.mockResolvedValue({
    ok: true,
    values: {
      'email.reviewer_withdraw.subject': 'Subject tpl',
      'email.reviewer_withdraw.body': 'Body tpl',
    },
  });
});

const ARGS = { requestId: REQ, suggestionIds: [SUG], actingUserSystemId: 'u-1' };

test('request not found → throws WithdrawSufficientError with httpStatus 404', async () => {
  getRequestById.mockResolvedValue(null);
  await expect(withdrawSufficient(ARGS)).rejects.toMatchObject({
    name: 'WithdrawSufficientError',
    httpStatus: 404,
    message: `No request found for ${REQ}`,
  });
  expect(findById).not.toHaveBeenCalled();
});

test('request lookup error is swallowed and also maps to the 404 domain error', async () => {
  getRequestById.mockRejectedValue(new Error('dataverse down'));
  await expect(withdrawSufficient(ARGS)).rejects.toBeInstanceOf(WithdrawSufficientError);
});

test('happy path: withdrawn_emailed, lifecycle write with ifMatch BEFORE the email', async () => {
  findById.mockResolvedValue(pendingRow());
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_emailed' }] });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUG,
    expect.objectContaining({ responseType: 'withdrawn_sufficient', withdrawnSufficientAt: expect.any(String), respondReminderSentAt: null }),
    expect.objectContaining({ actingUserSystemId: 'u-1', ifMatch: 'W/"1"' }),
  );
  expect(updateLifecycle.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
  expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
    from: 'pd@keck.org', to: 'rev@example.org',
    regardingId: REQ, regardingType: 'akoya_request',
    actingUserSystemId: 'pd-1', noFallback: true,
  }));
});

test('missing suggestion → not_found, no write', async () => {
  findById.mockResolvedValue(null);
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 0, results: [{ suggestionId: SUG, status: 'not_found' }] });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('row from another request → wrong_request, no write', async () => {
  findById.mockResolvedValue(pendingRow({ _wmkf_request_value: '33333333-3333-4333-8333-333333333333' }));
  const out = await withdrawSufficient(ARGS);
  expect(out.results).toEqual([{ suggestionId: SUG, status: 'wrong_request' }]);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('accepted row → not_pending, never touched', async () => {
  findById.mockResolvedValue(pendingRow({ wmkf_accepted: true }));
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 0, results: [{ suggestionId: SUG, status: 'not_pending' }] });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('412 on the conditional write → changed_skipped, no email', async () => {
  findById.mockResolvedValue(pendingRow());
  updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const out = await withdrawSufficient(ARGS);
  expect(out.withdrawn).toBe(0);
  expect(out.results[0]).toMatchObject({ suggestionId: SUG, status: 'changed_skipped' });
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('non-412 write failure → write_failed with truncated error, no email', async () => {
  findById.mockResolvedValue(pendingRow());
  updateLifecycle.mockRejectedValueOnce(new Error('boom'));
  const out = await withdrawSufficient(ARGS);
  expect(out.withdrawn).toBe(0);
  expect(out.results[0]).toMatchObject({ status: 'write_failed', error: expect.stringContaining('boom') });
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('email send failure → withdrawn_email_failed, lifecycle write NOT rolled back (state-before-email)', async () => {
  findById.mockResolvedValue(pendingRow());
  createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
  const out = await withdrawSufficient(ARGS);
  expect(out.withdrawn).toBe(1);
  expect(out.results[0]).toMatchObject({ suggestionId: SUG, status: 'withdrawn_email_failed' });
  expect(updateLifecycle).toHaveBeenCalledTimes(1);
});

test('email defaults not ok → withdrawn_email_skipped after the write', async () => {
  findById.mockResolvedValue(pendingRow());
  readRequiredEmailDefaults.mockResolvedValue({ ok: false });
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_email_skipped' }] });
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('reviewer has no email address → withdrawn_no_email (still withdrawn)', async () => {
  findById.mockResolvedValue(pendingRow());
  getReviewerByIdWithSelect.mockResolvedValue({ wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: null });
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_no_email' }] });
});

test('no usable PD (disabled) → withdrawn_no_pd, no reviewer lookup, no email', async () => {
  findById.mockResolvedValue(pendingRow());
  getSystemUserById.mockResolvedValue({ systemuserid: 'pd-1', internalemailaddress: 'pd@keck.org', isdisabled: true });
  const out = await withdrawSufficient(ARGS);
  expect(out).toEqual({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_no_pd' }] });
  expect(getReviewerByIdWithSelect).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('mixed batch accumulates per-suggestion partial success in order', async () => {
  findById
    .mockResolvedValueOnce(pendingRow())
    .mockResolvedValueOnce(null);
  const out = await withdrawSufficient({ requestId: REQ, suggestionIds: [SUG, SUG2], actingUserSystemId: 'u-1' });
  expect(out).toEqual({
    ok: true,
    withdrawn: 1,
    results: [
      { suggestionId: SUG, status: 'withdrawn_emailed' },
      { suggestionId: SUG2, status: 'not_found' },
    ],
  });
});
