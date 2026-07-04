/**
 * Manual "Send reminder now" action (workbench Reviews tab Phase 1).
 *
 * Verifies eligibility rejection, claim-before-send (412 → conflict, no send),
 * marker+count stamped BEFORE the email goes out, and that a re-send IS
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

const { sendManualReviewDueReminder } = require('../../lib/services/reviewer-manual-reminder');

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const PD = '33333333-3333-4333-8333-333333333333';
const PERSON = '44444444-4444-4444-8444-444444444444';

const REVIEW_DUE_SUBJECT_KEY = 'email.reviewer_reminder_review_due.subject';
const REVIEW_DUE_BODY_KEY = 'email.reviewer_reminder_review_due.body';
const REVIEW_DUE_SUBJECT = 'Reminder: your W. M. Keck Foundation review';
const REVIEW_DUE_BODY =
  'Dear [Reviewer Name],\n\nThis is a friendly reminder about your review of [proposal].\n\nThank you,\n\n[Program Director signature]';

const REVIEW_STATUS_MATERIALS_SENT = 100000001;
const REVIEW_STATUS_UNDER_REVIEW = 100000002;
const REVIEW_STATUS_REVIEW_RECEIVED = 100000003;

function suggestionRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_accepted: true,
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
    wmkf_reviewduedate: null,
    ...over,
  };
}

function installReads({ suggestion = suggestionRow(), request = requestRecord(), pdDisabled = false, reviewerEmail = 'rev@example.org' } = {}) {
  getRecord.mockImplementation(async (set, id) => {
    if (set === 'wmkf_appreviewersuggestions') return suggestion;
    if (set === 'akoya_requests') return request;
    if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: pdDisabled };
    if (set === 'wmkf_potentialreviewerses') return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: reviewerEmail };
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getSettingStrict.mockImplementation(async (key) => {
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
  test('eligible reviewer: claims marker (If-Match) BEFORE minting/sending, increments count', async () => {
    installReads();
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG, actingUserSystemId: 'u-1' });
    expect(result).toEqual({ ok: true });

    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_remindersentat: expect.any(String), wmkf_remindercount: 1 }),
      expect.objectContaining({ ifMatch: 'W/"100"', actingUserSystemId: 'u-1' }),
    );
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    // Claim-before-send: marker write precedes token mint precedes send.
    expect(updateRecord.mock.invocationCallOrder[0]).toBeLessThan(mintAndStore.mock.invocationCallOrder[0]);
    expect(mintAndStore.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);

    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.from).toBe('pd@keck.org');
    expect(email.to).toBe('rev@example.org');
    expect(email.subject).toBe(REVIEW_DUE_SUBJECT);
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
      expect.objectContaining({ wmkf_remindercount: 3 }),
      expect.anything(),
    );
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });

  test('claim conflict (412 / stale etag) → conflict result, no send', async () => {
    installReads();
    updateRecord.mockRejectedValue(Object.assign(new Error('412'), { status: 412 }));
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'conflict' });
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
      if (set === 'wmkf_appreviewersuggestions') throw new Error('Get record failed (404)');
      return null;
    });
    const result = await sendManualReviewDueReminder({ requestId: REQ, suggestionId: SUG });
    expect(result).toEqual({ ok: false, reason: 'not_found' });
    expect(updateRecord).not.toHaveBeenCalled();
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
