/**
 * Reviewer reminder sweeps (Phase 3) — eligibility, fire-once claim-before-send,
 * per-request opt-in, and token-liveness gating.
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
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({ signature: 'Dr. PD\nW. M. Keck Foundation' })),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  notExcludedFilter: () => 'wmkf_applicantdisposition ne 100000001',
}));

const { sweepRespondReminders, sweepReviewDueReminders } = require('../../lib/services/reviewer-reminder-sweep');

const DAY = 24 * 60 * 60 * 1000;
const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = 'req-1';
const PD = 'pd-1';
const PERSON = 'person-1';

function isoDaysAgo(d) { return new Date(Date.now() - d * DAY).toISOString(); }
function ymdDaysFromNow(d) {
  const dt = new Date(Date.now() + d * DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Default request config: respond reminder enabled, 7-day offset, 0 lead.
function requestConfig(over = {}) {
  return {
    akoya_requestid: REQ, akoya_requestnum: 'R-1', akoya_title: 'A Proposal',
    _wmkf_programdirector_value: PD,
    wmkf_respondoffsetdays: 7, wmkf_respondreminderenabled: true, wmkf_respondreminderleaddays: 0,
    wmkf_reviewduedate: null, wmkf_reviewduereminderenabled: false, wmkf_reviewduereminderleaddays: 0,
    ...over,
  };
}

// Route getRecord by entity set. requestOver/reviewerOk let each test tweak.
function installReads({ request = requestConfig(), pdDisabled = false, reviewerEmail = 'rev@example.org' } = {}) {
  getRecord.mockImplementation(async (set) => {
    if (set === 'akoya_requests') return request;
    if (set === 'systemusers') return { systemuserid: PD, internalemailaddress: 'pd@keck.org', isdisabled: pdDisabled };
    if (set === 'wmkf_potentialreviewerses') return { wmkf_potentialreviewersid: PERSON, wmkf_name: 'Dr. Reviewer', wmkf_emailaddress: reviewerEmail };
    return null;
  });
}

function respondCandidate(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_potentialreviewer_value: PERSON,
    _wmkf_request_value: REQ,
    wmkf_emailsentat: isoDaysAgo(8),        // 8d ago, offset 7 → deadline 1d ago → eligible
    wmkf_externaltokenexpires: new Date(Date.now() + 5 * DAY).toISOString(), // live
    '@odata.etag': 'W/"100"',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mintAndStore.mockResolvedValue({ url: 'https://reviews.example/external/review/jwt' });
  createAndSendEmail.mockResolvedValue({ emailId: 'e-1' });
  updateRecord.mockResolvedValue(undefined);
});

describe('sweepRespondReminders', () => {
  test('eligible candidate: claims the marker (If-Match) then sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(1);
    // Claim happens with the row etag, setting the respond marker.
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_respondremindersentat: expect.any(String) }),
      expect.objectContaining({ ifMatch: 'W/"100"' }),
    );
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    // Sent from the PD; respond reminder is the "accept or decline" subject.
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.from).toBe('pd@keck.org');
    expect(email.to).toBe('rev@example.org');
    expect(email.subject).toMatch(/invitation/i);
  });

  test('disabled per request → skipped, no claim or send', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ request: requestConfig({ wmkf_respondreminderenabled: false }) });
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('before the per-reviewer deadline (minus lead) → skipped', async () => {
    // emailSentAt 1d ago, offset 7, lead 0 → deadline 6d in the future → not yet.
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_emailsentat: isoDaysAgo(1) })] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('expired token → skipped (offer window closed)', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_externaltokenexpires: isoDaysAgo(1) })] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('lead days bring an otherwise-future deadline into range', async () => {
    // emailSentAt 1d ago, offset 7 → deadline +6d; lead 7 → fire at deadline-7d = 1d ago → eligible.
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_emailsentat: isoDaysAgo(1) })] });
    installReads({ request: requestConfig({ wmkf_respondreminderleaddays: 7 }) });
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(1);
  });

  test('disabled PD (no sender) → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ pdDisabled: true });
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('dryRun: counts eligible but never claims or sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders({ dryRun: true });
    expect(r.eligible).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('claim loses the If-Match race → claimFailed, no send', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    const r = await sweepRespondReminders();
    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('send fails after a successful claim → at-most-once (sendFailed, marker stays)', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const r = await sweepRespondReminders();
    expect(updateRecord).toHaveBeenCalledTimes(1); // claim landed
    expect(r.sendFailed).toBe(1);
    expect(r.sent).toBe(0);
  });
});

describe('sweepReviewDueReminders', () => {
  function reviewDueRequest(over = {}) {
    return requestConfig({
      wmkf_respondreminderenabled: false,
      wmkf_reviewduedate: ymdDaysFromNow(-1), // due yesterday → past → eligible
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
      '@odata.etag': 'W/"200"',
      ...over,
    };
  }

  test('eligible: claims wmkf_remindersentat (+count) then sends the review-due reminder', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.sent).toBe(1);
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions', SUG,
      expect.objectContaining({ wmkf_remindersentat: expect.any(String), wmkf_remindercount: 1 }),
      expect.objectContaining({ ifMatch: 'W/"200"' }),
    );
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.subject).toMatch(/review/i);
  });

  test('no review-due date set → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest({ wmkf_reviewduedate: null }) });
    const r = await sweepReviewDueReminders();
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('due date still beyond the lead window → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest({ wmkf_reviewduedate: ymdDaysFromNow(30), wmkf_reviewduereminderleaddays: 3 }) });
    const r = await sweepReviewDueReminders();
    expect(r.sent).toBe(0);
  });
});
