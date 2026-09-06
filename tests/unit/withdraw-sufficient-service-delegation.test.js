/**
 * Delegation pin (Stage 3 build plan, mandatory from 3E on) for slice 3I:
 * mocks `reviewer-engagement/withdraw-pending-invitation` and drives the
 * real `withdraw-sufficient-service.js` for one still-pending suggestion,
 * asserting the extracted command is called once with the row's `_etag`
 * BEFORE any email send, and that the caller maps every outcome exactly as
 * before. A faithful inline reimplementation that keeps the import (to
 * satisfy the census) but does not actually delegate would fail this test.
 */

const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...a) => findById(...a),
  // Deliberately no updateLifecycle here: if the caller bypassed the
  // extracted command and called the adapter directly, this mock would
  // throw "not a function" rather than silently pass.
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

const withdrawPendingInvitation = jest.fn();
jest.mock('../../lib/services/reviewer-engagement/withdraw-pending-invitation', () => ({
  withdrawPendingInvitation: (...a) => withdrawPendingInvitation(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const PERSON = 'person-1';

let withdrawSufficient;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/withdraw-sufficient-service');
  withdrawSufficient = mod.withdrawSufficient;
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

test('delegates the write to withdrawPendingInvitation once with the etag, before the email', async () => {
  findById.mockResolvedValue(pendingRow());
  withdrawPendingInvitation.mockResolvedValueOnce(undefined);

  const out = await withdrawSufficient(ARGS);

  expect(withdrawPendingInvitation).toHaveBeenCalledTimes(1);
  expect(withdrawPendingInvitation).toHaveBeenCalledWith({
    id: SUG,
    nowIso: expect.any(String),
    ifMatch: 'W/"1"',
    actingUserSystemId: 'u-1',
  });
  expect(withdrawPendingInvitation.mock.invocationCallOrder[0])
    .toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
  expect(out).toEqual({ ok: true, withdrawn: 1, results: [{ suggestionId: SUG, status: 'withdrawn_emailed' }] });
});

test('thrown 412 from the command → changed_skipped, no email', async () => {
  findById.mockResolvedValue(pendingRow());
  withdrawPendingInvitation.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));

  const out = await withdrawSufficient(ARGS);

  expect(out.withdrawn).toBe(0);
  expect(out.results[0]).toMatchObject({ suggestionId: SUG, status: 'changed_skipped' });
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('thrown other error from the command → write_failed, no email', async () => {
  findById.mockResolvedValue(pendingRow());
  withdrawPendingInvitation.mockRejectedValueOnce(new Error('boom'));

  const out = await withdrawSufficient(ARGS);

  expect(out.withdrawn).toBe(0);
  expect(out.results[0]).toMatchObject({ suggestionId: SUG, status: 'write_failed', error: expect.stringContaining('boom') });
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('success → withdrawn count increments and the email path proceeds', async () => {
  findById.mockResolvedValue(pendingRow());
  withdrawPendingInvitation.mockResolvedValueOnce(undefined);

  const out = await withdrawSufficient(ARGS);

  expect(out.withdrawn).toBe(1);
  expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  expect(out.results[0]).toMatchObject({ suggestionId: SUG, status: 'withdrawn_emailed' });
});
