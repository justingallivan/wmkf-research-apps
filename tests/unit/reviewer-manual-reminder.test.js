/**
 * Manual "Send reminder now" action (workbench Reviews tab Phase 1).
 *
 * Verifies eligibility rejection, atomic marker persistence (412 →
 * conflict, no send), marker+count stamped BEFORE the email goes out, and that a re-send IS
 * allowed even when `wmkf_remindersentat` is already set (unlike the cron,
 * which is fire-once). All Dataverse/email calls are mocked — no real sends.
 */

const getRecord = jest.fn();
const updateRecord = jest.fn();
const createAndSendEmail = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    getRecord: (...a) => getRecord(...a),
    updateRecord: (...a) => updateRecord(...a),
    createAndSendEmail: (...a) => createAndSendEmail(...a),
  },
}));

const mintAndStore = jest.fn(async () => ({ url: 'https://reviews.example/external/review/jwt' }));
jest.mock('../../lib/external/token-lifecycle', () => ({ mintAndStore: (...a) => mintAndStore(...a) }));

const getSettingStrict = jest.fn();
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: (...a) => getSettingStrict(...a),
}));

const notify = jest.fn(async () => ({ id: 1 }));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: (...a) => notify(...a) },
}));

jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD\nW. M. Keck Foundation' })),
}));

const {
  previewManualRespondReminder,
  sendManualRespondReminder,
  sendManualReviewDueReminder,
} = require('../../lib/services/reviewer-manual-reminder');

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const PD = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';

const REVIEW_DUE_SUBJECT_KEY = 'email.reviewer_reminder_review_due.subject';
const REVIEW_DUE_BODY_KEY = 'email.reviewer_reminder_review_due.body';
const REVIEW_DUE_SUBJECT = 'Reminder: your W. M. Keck Foundation review';
const REVIEW_DUE_BODY =
  'Dear [Reviewer Name],\n\nThis is a friendly reminder about your review of [proposal].\n\nThank you,\n\n[Program Director signature]';
const RESPOND_SUBJECT_KEY = 'email.reviewer_reminder_respond_by.subject';
const RESPOND_BODY_KEY = 'email.reviewer_reminder_respond_by.body';
const RESPOND_SUBJECT = 'Reminder: please respond to your review invitation';
const RESPOND_BODY =
  'Dear [Reviewer Name],\n\nPlease use your secure link to respond about [proposal].\n\nThank you,\n\n[Program Director signature]';

const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const REVIEW_STATUS_UNDER_REVIEW = 100000002;
const REVIEW_STATUS_REVIEW_RECEIVED = 100000003;

function suggestionRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_selected: true,
    wmkf_externaltokenhash: 'stored-token-hash',
    wmkf_externaltokenexpires: '2100-01-01T00:00:00Z',
    wmkf_externaltokenrevoked: false,
    wmkf_invited: true,
    wmkf_emailsentat: '2026-06-01T00:00:00Z',
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_reviewstatus: REVIEW_STATUS_MATERIALS_SENT,
    wmkf_reviewreceivedat: null,
    wmkf_applicantdisposition: null,
    wmkf_remindercount: 0,
    _etag: 'W/"100"',
    ...over,
  };
}

function requestRecord(over = {}) {
  return {
    akoya_requestid: REQ,
    akoya_requestnum: 'R-1',
    akoya_title: 'A Proposal',
    _wmkf_programdirector_value: PD,
    wmkf_reviewduedate: '2099-09-09',
    ...over,
  };
}

function installReads({ suggestion = suggestionRow(), suggestionAfterClaim = suggestion, request = requestRecord(), pdDisabled = false, reviewerEmail = 'rev@example.org' } = {}) {
  let suggestionReads = 0;
  getRecord.mockImplementation(async (set, id) => {
    if (set === 'wmkf_appreviewersuggestions') {
      const value = suggestionReads === 0 ? suggestion : suggestionAfterClaim;
      suggestionReads += 1;
      return value;
    }
    if (set === 'akoya_requests') return request;
    if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: pdDisabled };
    if (set === 'wmkf_potentialreviewerses') return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: reviewerEmail };
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettingStrict.mockImplementation(async (key) => {
    if (key === RESPOND_SUBJECT_KEY) return { found: true, value: RESPOND_SUBJECT };
    if (key === RESPOND_BODY_KEY) return { found: true, value: RESPOND_BODY };
    if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: REVIEW_DUE_SUBJECT };
    if (key === REVIEW_DUE_BODY_KEY) return { found: true, value: REVIEW_DUE_BODY };
    throw new Error(`unexpected setting ${key}`);
  });
  notify.mockResolvedValue({ id: 1 });
  mintAndStore.mockResolvedValue({ url: 'https://reviews.example/external/review/jwt' });
  createAndSendEmail.mockResolvedValue({ emailId: 'e-1' });
  updateRecord.mockResolvedValue(undefined);
});

describe('sendManualReviewDueReminder', () => {
  test('eligible reviewer atomically claims the marker without rotating token authority before sending', async () => {
    installReads();
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG, actingUserSystemId: 'u-1' });
    expect(result).toEqual({ ok: true });

    expect(mintAndStore).not.toHaveBeenCalled();
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUG,
      expect.objectContaining({ wmkf_remindersentat: expect.any(String), wmkf_remindercount: 1 }),
      { actingUserSystemId: 'u-1', ifMatch: 'W/"100"' },
    );
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    expect(updateRecord.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);

    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.from).toBe('pd@keck.org');
    expect(email.to).toBe('rev@example.org');
    expect(email.subject).toBe(REVIEW_DUE_SUBJECT);
    expect(email.body).toContain('original review materials email');
    expect(email.body).not.toContain('/external/review/');
  });

  test('re-send allowed even when wmkf_remindersentat is already set (unlike the cron)', async () => {
    installReads({
      suggestion: suggestionRow({ wmkf_remindercount: 2 }),
    });
    // Marker already set from a prior send — manual send does not filter on it.
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: true });
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_remindercount: 3 }), expect.any(Object),
    );
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });

  test('review-due atomic claim increments the freshly authorized reminder count', async () => {
    installReads({
      suggestion: suggestionRow({ wmkf_remindercount: 1 }),
      suggestionAfterClaim: suggestionRow({ wmkf_remindercount: 2, _etag: 'W/"101"' }),
    });

    await expect(sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG })).resolves.toEqual({ ok: true });

    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_remindercount: 3 }),
      expect.objectContaining({ ifMatch: 'W/"101"' }),
    );
  });

  test('atomic marker conflict (412 / stale etag) → conflict result, no send', async () => {
    installReads();
    updateRecord.mockRejectedValue(Object.assign(new Error('412'), { status: 412 }));
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(updateRecord).toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('marker persistence failure attempts no email and is retryable', async () => {
    installReads();
    updateRecord.mockRejectedValueOnce(new Error('Dataverse unavailable'));

    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toMatchObject({ ok: false, reason: 'prepare_failed' });
    expect(updateRecord).toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('email failure after atomic persistence retains the marker and is not retryable', async () => {
    installReads();
    createAndSendEmail.mockRejectedValueOnce(new Error('SMTP unavailable'));

    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toMatchObject({ ok: false, reason: 'send_failed' });
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_remindersentat: expect.any(String) }), expect.any(Object),
    );
  });

  test.each([
    ['removed', { wmkf_selected: false, wmkf_externaltokenrevoked: true }, 'removed'],
    ['revoked', { wmkf_selected: true, wmkf_externaltokenrevoked: true }, 'token_revoked'],
  ])('%s reviewer passes every review-due gate but is refused before claim/mint/send', async (_label, state, reason) => {
    installReads({ suggestion: suggestionRow(state) });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a review submitted after initial eligibility is refused before atomic claim/send', async () => {
    installReads({
      suggestion: suggestionRow(),
      suggestionAfterClaim: suggestionRow({
        wmkf_reviewreceivedat: '2026-08-13T12:00:00Z',
        _etag: 'W/"101"',
      }),
    });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'ineligible' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('token becoming insufficient on the authorization re-read is refused before claim/send', async () => {
    installReads({
      suggestion: suggestionRow(),
      suggestionAfterClaim: suggestionRow({
        wmkf_externaltokenexpires: '2099-09-09T23:59:59Z',
        _etag: 'W/"101"',
      }),
    });

    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toEqual({ ok: false, reason: 'token_insufficient_window' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['removed', { wmkf_selected: false, wmkf_externaltokenrevoked: true }, 'removed'],
    ['revoked', { wmkf_selected: true, wmkf_externaltokenrevoked: true }, 'token_revoked'],
  ])('reviewer becoming %s after initial eligibility is refused before atomic claim/send', async (_label, state, reason) => {
    installReads({
      suggestion: suggestionRow(),
      suggestionAfterClaim: suggestionRow({ ...state, _etag: 'W/"101"' }),
    });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['not accepted', suggestionRow({ wmkf_accepted: false })],
    ['materials not sent', suggestionRow({ wmkf_reviewstatus: null })],
    ['already submitted', suggestionRow({ wmkf_reviewreceivedat: '2026-06-01T00:00:00Z' })],
    ['applicant-excluded', suggestionRow({ wmkf_applicantdisposition: 100000001 })],
    ['belongs to a different request', suggestionRow({ _wmkf_request_value: 'other-request' })],
  ])('ineligible: %s → rejected, no claim/send', async (_label, suggestion) => {
    installReads({ suggestion });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'ineligible' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('under-review status is still eligible (materials already sent, still not submitted)', async () => {
    installReads({ suggestion: suggestionRow({ wmkf_reviewstatus: REVIEW_STATUS_UNDER_REVIEW }) });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: true });
  });

  test('review-received status (post-submit) is ineligible even without reviewreceivedat set', async () => {
    installReads({ suggestion: suggestionRow({ wmkf_reviewstatus: REVIEW_STATUS_REVIEW_RECEIVED }) });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'ineligible' });
  });

  test('misconfigured email defaults → rejected before any read/claim', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: '   ' };
      if (key === REVIEW_DUE_BODY_KEY) return { found: true, value: REVIEW_DUE_BODY };
      throw new Error(`unexpected setting ${key}`);
    });
    installReads();
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('misconfigured');
    expect(getRecord).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('suggestion not found → not_found, no claim/send', async () => {
    getRecord.mockImplementation(async (set) => {
      if (set === 'wmkf_appreviewersuggestions') {
        throw Object.assign(new Error('Get record failed (404)'), { status: 404 });
      }
      return null;
    });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('initial Dataverse read failure is surfaced as retryable, not not_found', async () => {
    getRecord.mockRejectedValueOnce(Object.assign(new Error('Dataverse unavailable'), { status: 503 }));

    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toEqual({ ok: false, reason: 'read_failed' });
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('transient authorization re-read failure is retryable and writes nothing', async () => {
    let suggestionReads = 0;
    installReads();
    getRecord.mockImplementation(async (set, id) => {
      if (set === 'wmkf_appreviewersuggestions') {
        suggestionReads += 1;
        if (suggestionReads === 1) return suggestionRow();
        throw Object.assign(new Error('Dataverse unavailable'), { status: 503 });
      }
      if (set === 'akoya_requests') return requestRecord();
      if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: false };
      if (set === 'wmkf_potentialreviewerses') return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'rev@example.org' };
      return null;
    });

    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toEqual({ ok: false, reason: 'read_failed' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('missing _etag on the fetched row → fails closed (surfaces as conflict, no send)', async () => {
    const { _etag, ...noEtag } = suggestionRow();
    installReads({ suggestion: noEtag });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });
});

describe('sendManualRespondReminder', () => {
  const pendingInvitation = (over = {}) => suggestionRow({
    wmkf_accepted: false,
    wmkf_reviewstatus: null,
    wmkf_reviewreceivedat: null,
    wmkf_externaltokenexpires: '2020-01-01T00:00:00Z',
    ...over,
  });
  const reviewed = (over = {}) => ({
    subject: RESPOND_SUBJECT,
    bodyText: 'Dear Dr. Reviewer,\n\nPlease respond.\n\nDr. PD',
    to: 'rev@example.org',
    from: 'pd@keck.org',
    senderId: PD,
    ...over,
  });

  test('preview renders editable copy without claiming, minting, or sending', async () => {
    installReads({ suggestion: pendingInvitation() });

    const result = await previewManualRespondReminder({ requestId: REQ, suggestionId: SUG });

    expect(result).toEqual({
      ok: true,
      draft: expect.objectContaining({
        suggestionId: SUG,
        name: 'Dr. Reviewer',
        to: 'rev@example.org',
        from: 'pd@keck.org',
        senderId: PD,
        subject: RESPOND_SUBJECT,
        bodyText: expect.stringContaining('A Proposal'),
      }),
    });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('eligible unanswered invite claims only the respond marker and sends the reviewed copy', async () => {
    installReads({ suggestion: pendingInvitation() });
    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, actingUserSystemId: 'u-1', reviewed: reviewed() });

    expect(result).toEqual({ ok: true });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({
      ifMatch: 'W/"100"',
      actingUserSystemId: 'u-1',
      writeFields: { wmkf_respondremindersentat: expect.any(String) },
    }));
    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: RESPOND_SUBJECT,
      to: 'rev@example.org',
    }));
  });

  test('sent copy carries the automation notice like its cron twin (2026-08-26 inventory divergence)', async () => {
    installReads({ suggestion: pendingInvitation() });
    await expect(sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() }))
      .resolves.toEqual({ ok: true });
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.body).toContain('This automated reminder was sent by the W. M. Keck Foundation');
    expect(email.body).toContain('pd@keck.org');
  });

  test('edited body is escaped and receives the server-minted secure link', async () => {
    installReads({ suggestion: pendingInvitation() });

    await expect(sendManualRespondReminder({
      requestId: REQ,
      suggestionId: SUG,
      reviewed: reviewed({ subject: 'Edited subject', bodyText: 'Hello <script>alert(1)</script>' }),
    })).resolves.toEqual({ ok: true });

    expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
      subject: 'Edited subject',
      body: expect.stringContaining('https://reviews.example/external/review/jwt'),
    }));
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(email.body).not.toContain('<script>alert(1)</script>');
  });

  test.each([
    ['recipient_changed', { to: 'redirect@example.org' }],
    ['sender_changed', { from: 'other@keck.org' }],
    ['sender_changed', { senderId: '55555555-5555-4555-8555-555555555555' }],
  ])('%s guard rejects changed preview identity before mint/send', async (reason, override) => {
    installReads({ suggestion: pendingInvitation() });

    const result = await sendManualRespondReminder({
      requestId: REQ,
      suggestionId: SUG,
      reviewed: reviewed(override),
    });

    expect(result).toEqual({ ok: false, reason });
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('missing reviewed copy fails closed before mint/send', async () => {
    installReads({ suggestion: pendingInvitation() });
    await expect(sendManualRespondReminder({ requestId: REQ, suggestionId: SUG }))
      .resolves.toEqual({ ok: false, reason: 'invalid_preview' });
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('re-send remains allowed when the respond marker is already set', async () => {
    installReads({ suggestion: pendingInvitation({ wmkf_respondremindersentat: '2026-06-02T00:00:00Z' }) });
    await expect(sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() })).resolves.toEqual({ ok: true });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['removed', { wmkf_selected: false, wmkf_externaltokenrevoked: true }, 'removed'],
    ['revoked', { wmkf_selected: true, wmkf_externaltokenrevoked: true }, 'revoked'],
  ])('%s unanswered invite passes every other gate but is refused before claim/mint/send', async (_label, state, reason) => {
    installReads({ suggestion: pendingInvitation(state) });
    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });
    expect(result).toEqual({ ok: false, reason });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['removed', { wmkf_selected: false, wmkf_externaltokenrevoked: true }, 'removed'],
    ['revoked', { wmkf_selected: true, wmkf_externaltokenrevoked: true }, 'revoked'],
  ])('unanswered invite becoming %s after initial eligibility is refused before atomic claim/send', async (_label, state, reason) => {
    installReads({
      suggestion: pendingInvitation(),
      suggestionAfterClaim: pendingInvitation({ ...state, _etag: 'W/"101"' }),
    });
    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });
    expect(result).toEqual({ ok: false, reason });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('an invitation accepted after initial eligibility is refused before atomic claim/send', async () => {
    installReads({
      suggestion: pendingInvitation(),
      suggestionAfterClaim: pendingInvitation({ wmkf_accepted: true, _etag: 'W/"101"' }),
    });
    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });
    expect(result).toEqual({ ok: false, reason: 'ineligible' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a concurrent change at the ETag-bound token write returns conflict without sending', async () => {
    installReads({
      suggestion: pendingInvitation(),
      suggestionAfterClaim: pendingInvitation({ _etag: 'W/"101"' }),
    });
    mintAndStore.mockRejectedValueOnce(Object.assign(new Error('412'), { status: 412 }));

    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });

    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: 'W/"101"' }));
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a transient authorization re-read failure is retryable and leaves no reminder marker or token write', async () => {
    let suggestionReads = 0;
    getRecord.mockImplementation(async (set) => {
      if (set === 'wmkf_appreviewersuggestions') {
        suggestionReads += 1;
        if (suggestionReads === 1) return pendingInvitation();
        throw Object.assign(new Error('Dataverse transient'), { status: 503 });
      }
      if (set === 'akoya_requests') return requestRecord();
      if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: false };
      if (set === 'wmkf_potentialreviewerses') {
        return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: 'rev@example.org' };
      }
      return null;
    });

    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });

    expect(result).toEqual({ ok: false, reason: 'read_failed' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['not invited', { wmkf_invited: false }],
    ['no sent invitation', { wmkf_emailsentat: null }],
    ['accepted', { wmkf_accepted: true }],
    ['declined', { wmkf_declined: true }],
    ['resolved response', { wmkf_responsetype: 100000001 }],
    ['applicant-excluded', { wmkf_applicantdisposition: 100000001 }],
    ['different request', { _wmkf_request_value: 'other-request' }],
  ])('ineligible: %s', async (_label, state) => {
    installReads({ suggestion: pendingInvitation(state) });
    const result = await sendManualRespondReminder({ requestId: REQ, suggestionId: SUG, reviewed: reviewed() });
    expect(result).toEqual({ ok: false, reason: 'ineligible' });
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });
});
