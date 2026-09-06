/** @jest-environment node */

/**
 * Stage 3G delegation pin: `lib/services/reviewer-reminder-sweep.js` delegates
 * the review-due (`kind !== 'respond'`) fire-once claim to
 * `lib/services/reviewer-engagement/claim-reminder.js`'s `claimReviewDueReminder`
 * — not a faithful inline reimplementation that keeps the import only for a
 * caller-boundary census. Mocking `claim-reminder` here proves the sweep
 * actually calls it (name, args) and that the sweep's own catch still maps a
 * thrown 412 to `claimFailed` (no send) and any other thrown error to
 * `prepareFailed`. A respond-kind candidate must NOT call it — the respond
 * branch's atomic marker+token claim stays on `mintAndStore` in the sweep.
 */

const queryAllRecords = jest.fn();
const getRecord = jest.fn();
const updateRecord = jest.fn();
const createAndSendEmail = jest.fn();
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryAllRecords: (...a) => queryAllRecords(...a),
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
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  notExcludedFilter: () => 'wmkf_applicantdisposition ne 100000001',
  selectedAndNotRevokedFilter: () => 'wmkf_selected eq true and (wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null)',
  queryAllSuggestions: (options) => {
    const { DynamicsService } = jest.requireMock('../../lib/services/dynamics-service');
    return DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', options);
  },
}));

const claimReviewDueReminder = jest.fn(async () => undefined);
jest.mock('../../lib/services/reviewer-engagement/claim-reminder', () => ({
  __esModule: true,
  claimReviewDueReminder: (...a) => claimReviewDueReminder(...a),
}));

const {
  sweepRespondReminders,
  sweepReviewDueReminders,
} = require('../../lib/services/reviewer-reminder-sweep');

const DAY = 24 * 60 * 60 * 1000;
const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = 'req-1';
const PD = 'pd-1';
const PERSON = 'person-1';
const RESPOND_SUBJECT_KEY = 'email.reviewer_reminder_respond_by.subject';
const RESPOND_BODY_KEY = 'email.reviewer_reminder_respond_by.body';
const REVIEW_DUE_SUBJECT_KEY = 'email.reviewer_reminder_review_due.subject';
const REVIEW_DUE_BODY_KEY = 'email.reviewer_reminder_review_due.body';
const RESPOND_SUBJECT = 'Reminder: your W. M. Keck Foundation review invitation';
const RESPOND_BODY =
  'Dear [Reviewer Name],\n\n' +
  'I’m following up on my recent invitation to review [proposal] for the W. M. Keck Foundation. ' +
  'We have not yet heard back from you and would be grateful to know whether you are able to serve.\n\n' +
  'Please use your secure link below to accept or decline. If you accept, you can confirm a few details now ' +
  'and the full proposal will follow once it is released. If your circumstances have changed, a quick decline ' +
  'is just as helpful.\n\n' +
  'Thank you,\n\n' +
  '[Program Director signature]';
const REVIEW_DUE_SUBJECT = 'Reminder: your W. M. Keck Foundation review';
const REVIEW_DUE_BODY =
  'Dear [Reviewer Name],\n\n' +
  'This is a friendly reminder about your review of [proposal] for the W. M. Keck Foundation. ' +
  'Your review is due by [review due date].\n\n' +
  'Your secure link below opens the proposal materials and the review form. If you have already submitted, ' +
  'thank you — no further action is needed.\n\n' +
  'Thank you,\n\n' +
  '[Program Director signature]';

function isoDaysAgo(d) { return new Date(Date.now() - d * DAY).toISOString(); }
function ymdDaysFromNow(d) {
  const dt = new Date(Date.now() + d * DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function requestConfig(over = {}) {
  return {
    akoya_requestid: REQ, akoya_requestnum: 'R-1', akoya_title: 'A Proposal',
    _wmkf_programdirector_value: PD,
    wmkf_respondoffsetdays: 7, wmkf_respondreminderenabled: true, wmkf_respondreminderleaddays: 0,
    wmkf_reviewduedate: null, wmkf_reviewduereminderenabled: false, wmkf_reviewduereminderleaddays: 0,
    ...over,
  };
}

function reviewDueRequest(over = {}) {
  return requestConfig({
    wmkf_respondreminderenabled: false,
    wmkf_reviewduedate: ymdDaysFromNow(-1),
    wmkf_reviewduereminderenabled: true,
    wmkf_reviewduereminderleaddays: 0,
    ...over,
  });
}

function reviewDueCandidate(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: PERSON,
    _wmkf_request_value: REQ,
    wmkf_remindercount: 0,
    wmkf_externaltokenhash: 'stored-token-hash',
    wmkf_externaltokenexpires: new Date(Date.now() + 120 * DAY).toISOString(),
    wmkf_externaltokenrevoked: false,
    _etag: 'W/"200"',
    ...over,
  };
}

function respondCandidate(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: PERSON,
    _wmkf_request_value: REQ,
    wmkf_emailsentat: isoDaysAgo(8),
    wmkf_externaltokenexpires: new Date(Date.now() + 5 * DAY).toISOString(),
    _etag: 'W/"100"',
    ...over,
  };
}

function installReads({ request = requestConfig(), pdDisabled = false, reviewerEmail = 'rev@example.org' } = {}) {
  getRecord.mockImplementation(async (set) => {
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
  claimReviewDueReminder.mockResolvedValue(undefined);
});

describe('reviewer-engagement claim-reminder delegation (Stage 3G)', () => {
  test('review-due sweep calls claimReviewDueReminder once with the expected args, then sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });

    const r = await sweepReviewDueReminders();

    expect(r.sent).toBe(1);
    expect(claimReviewDueReminder).toHaveBeenCalledTimes(1);
    expect(claimReviewDueReminder).toHaveBeenCalledWith({
      id: SUG,
      claimPatch: expect.objectContaining({
        wmkf_remindersentat: expect.any(String),
        wmkf_remindercount: 1,
      }),
      claimIfMatch: 'W/"200"',
      actingUserSystemId: null,
    });
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
  });

  test('a thrown 412 from claimReviewDueReminder yields claimFailed with no send', async () => {
    claimReviewDueReminder.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });

    const r = await sweepReviewDueReminders();

    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a thrown non-412 error from claimReviewDueReminder yields prepareFailed', async () => {
    claimReviewDueReminder.mockRejectedValueOnce(new Error('boom'));
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });

    const r = await sweepReviewDueReminders();

    expect(r.prepareFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(r.errors[0]).toMatchObject({ id: SUG, message: expect.stringContaining('boom') });
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a respond-kind candidate does NOT call claimReviewDueReminder (uses mintAndStore instead)', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ request: requestConfig() });

    const r = await sweepRespondReminders();

    expect(r.sent).toBe(1);
    expect(claimReviewDueReminder).not.toHaveBeenCalled();
    expect(mintAndStore).toHaveBeenCalledTimes(1);
  });
});
