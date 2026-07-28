/**
 * @jest-environment node
 *
 * Review-before-send for the "no longer needed" release (staff request,
 * 2026-07-27): renderWithdrawPreviews renders what WOULD be sent without
 * releasing anyone, and withdrawSufficient applies per-reviewer staff edits.
 *
 * The safety property under test is that an edited draft can change the words
 * and nothing else — in particular it cannot redirect the email, and it cannot
 * reach a row the send would otherwise refuse.
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
  resolveSignatureForRequest: jest.fn(async () => ({
    signature: 'Thank you,\nAvery Quinn',
    customClosing: true,
  })),
}));
const readRequiredEmailDefaults = jest.fn();
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: (...a) => readRequiredEmailDefaults(...a),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const OTHER_SUG = '44444444-4444-4444-8444-444444444444';
const PERSON = 'person-1';

let renderWithdrawPreviews;
let withdrawSufficient;
beforeAll(async () => {
  const mod = await import('../../lib/services/review-manager/withdraw-sufficient-service');
  renderWithdrawPreviews = mod.renderWithdrawPreviews;
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

function reviewedOverride(over = {}) {
  return {
    subject: 'Reviewed',
    bodyText: 'Edited',
    to: 'rev@example.org',
    from: 'pd@keck.org',
    senderId: 'pd-1',
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
  getReviewerByIdWithSelect.mockResolvedValue({
    wmkf_name: 'Karl Deisseroth', wmkf_emailaddress: 'rev@example.org',
  });
  readRequiredEmailDefaults.mockResolvedValue({
    ok: true,
    values: {
      'email.reviewer_withdraw.subject': 'Thank you — W. M. Keck Foundation review',
      'email.reviewer_withdraw.body': '{{greeting}},\n\nThank you for considering our request to review {{proposalClause}}.\n\n{{signature}}',
    },
  });
  findById.mockResolvedValue(pendingRow());
});

describe('renderWithdrawPreviews', () => {
  test('returns the rendered subject and body without releasing or sending', async () => {
    const { ok, drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });

    expect(ok).toBe(true);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      suggestionId: SUG,
      status: 'ok',
      name: 'Karl Deisseroth',
      to: 'rev@example.org',
      from: 'pd@keck.org',
      senderId: 'pd-1',
      subject: 'Thank you — W. M. Keck Foundation review',
    });
    // Real renderer output — greeting resolved, proposal clause interpolated.
    expect(drafts[0].bodyText).toContain('Dear Dr. Deisseroth,');
    expect(drafts[0].bodyText).toContain('the proposal “A Proposal”');

    // The whole point: preview is a pure read.
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['not_found', () => findById.mockResolvedValue(null)],
    ['wrong_request', () => findById.mockResolvedValue(pendingRow({ _wmkf_request_value: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }))],
    ['not_pending', () => findById.mockResolvedValue(pendingRow({ wmkf_accepted: true }))],
  ])('a row that fails the %s guard is reported with no draft', async (status, arrange) => {
    arrange();
    const { drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });
    expect(drafts[0]).toMatchObject({ suggestionId: SUG, status });
    expect(drafts[0].bodyText).toBeUndefined();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });

  test.each([
    ['null', null],
    ['empty', ''],
  ])('a %s request relationship fails closed as wrong_request', async (_label, requestValue) => {
    findById.mockResolvedValue(pendingRow({ _wmkf_request_value: requestValue }));
    const { drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });
    expect(drafts[0]).toMatchObject({ suggestionId: SUG, status: 'wrong_request' });
    expect(drafts[0].bodyText).toBeUndefined();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });

  test('a reviewer with no address is reported, not offered as editable', async () => {
    getReviewerByIdWithSelect.mockResolvedValue({ wmkf_name: 'No Address', wmkf_emailaddress: null });
    const { drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });
    expect(drafts[0]).toMatchObject({ status: 'no_email', name: 'No Address' });
    expect(drafts[0].bodyText).toBeUndefined();
  });

  test('a disabled PD yields no_pd rather than a draft nobody can send', async () => {
    getSystemUserById.mockResolvedValue({ systemuserid: 'pd-1', internalemailaddress: 'pd@keck.org', isdisabled: true });
    const { drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });
    expect(drafts[0].status).toBe('no_pd');
  });

  test('a blank live template yields defaults_unavailable rather than an empty draft', async () => {
    readRequiredEmailDefaults.mockResolvedValue({ ok: false, values: {}, failures: [{ key: 'x', reason: 'blank' }] });
    const { drafts } = await renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] });
    expect(drafts[0].status).toBe('defaults_unavailable');
  });

  test('a missing request throws for the shell to map to 404', async () => {
    getRequestById.mockResolvedValue(null);
    await expect(renderWithdrawPreviews({ requestId: REQ, suggestionIds: [SUG] }))
      .rejects.toMatchObject({ httpStatus: 404 });
  });
});

describe('withdrawSufficient overrides', () => {
  test('a staff edit replaces the sent subject and body', async () => {
    await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: {
        [SUG]: reviewedOverride({
          subject: 'A kinder subject',
          bodyText: 'Dear Karl,\n\nWe are all set — thank you.',
        }),
      },
    });

    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(readRequiredEmailDefaults).not.toHaveBeenCalled();
    const sent = createAndSendEmail.mock.calls[0][0];
    expect(sent.subject).toBe('A kinder subject');
    expect(sent.body).toContain('We are all set — thank you.');
    expect(sent.body).not.toContain('Thank you for considering our request');
  });

  test('the previewed recipient is a case-insensitive binding, never a redirect destination', async () => {
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: {
        [SUG]: reviewedOverride({
          to: 'REV@EXAMPLE.ORG',
        }),
      },
    });
    expect(result.results[0].status).toBe('withdrawn_emailed');
    const sent = createAndSendEmail.mock.calls[0][0];
    expect(sent.to).toBe('rev@example.org');
    expect(sent.from).toBe('pd@keck.org');
  });

  test('a changed current recipient fails before the lifecycle write', async () => {
    getReviewerByIdWithSelect.mockResolvedValue({
      wmkf_name: 'Karl Deisseroth',
      wmkf_emailaddress: 'new-address@example.org',
    });
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: {
        [SUG]: reviewedOverride(),
      },
    });

    expect(result).toEqual({
      ok: true,
      withdrawn: 0,
      results: [{ suggestionId: SUG, status: 'recipient_changed' }],
    });
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a changed current sender record fails before the lifecycle write', async () => {
    getSystemUserById.mockResolvedValue({
      systemuserid: 'pd-2', internalemailaddress: 'pd@keck.org', isdisabled: false,
    });
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [SUG]: reviewedOverride() },
    });

    expect(result).toEqual({
      ok: true,
      withdrawn: 0,
      results: [{ suggestionId: SUG, status: 'sender_changed' }],
    });
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a changed current sender address fails before the lifecycle write', async () => {
    getSystemUserById.mockResolvedValue({
      systemuserid: 'pd-1', internalemailaddress: 'new-pd@keck.org', isdisabled: false,
    });
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [SUG]: reviewedOverride() },
    });

    expect(result.results[0].status).toBe('sender_changed');
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a disabled current sender fails before the lifecycle write', async () => {
    getSystemUserById.mockResolvedValue({
      systemuserid: 'pd-1', internalemailaddress: 'pd@keck.org', isdisabled: true,
    });
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [SUG]: reviewedOverride() },
    });

    expect(result.results[0].status).toBe('sender_changed');
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a reviewed batch missing this suggestion fails closed', async () => {
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [OTHER_SUG]: reviewedOverride() },
    });
    expect(result.results[0].status).toBe('invalid_override');
    expect(readRequiredEmailDefaults).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['blank', '   '],
    ['empty', ''],
  ])('a %s override fails closed rather than falling back to unreviewed copy', async (_label, bodyText) => {
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [SUG]: reviewedOverride({ subject: bodyText, bodyText }) },
    });
    expect(result.results[0].status).toBe('invalid_override');
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('no reviewed payload retains the pre-modal behavior', async () => {
    await withdrawSufficient({ requestId: REQ, suggestionIds: [SUG], actingUserSystemId: 'u-1' });
    const sent = createAndSendEmail.mock.calls[0][0];
    expect(sent.subject).toBe('Thank you — W. M. Keck Foundation review');
    expect(sent.body).toContain('Thank you for considering our request');
  });

  test('an edit still cannot release a row that is no longer pending', async () => {
    findById.mockResolvedValue(pendingRow({ wmkf_accepted: true }));
    const result = await withdrawSufficient({
      requestId: REQ,
      suggestionIds: [SUG],
      actingUserSystemId: 'u-1',
      overrides: { [SUG]: { bodyText: 'edited anyway' } },
    });
    expect(result.results[0].status).toBe('not_pending');
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });
});
