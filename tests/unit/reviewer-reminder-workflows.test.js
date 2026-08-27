/**
 * Reviewer reminder delivery strategies (ledger slice) — send-time
 * eligibility verdicts (eligible / stop / defer), the marker+token claim
 * fused with activity creation, and the retry distinction between "someone
 * else reminded them" (stop) and "completing our own send" (proceed).
 */

const mintAndStore = jest.fn();
jest.mock('../../lib/external/token-lifecycle', () => ({ mintAndStore: (...a) => mintAndStore(...a) }));

const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));

const getSuggestionByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  getByIdWithSelect: (...a) => getSuggestionByIdWithSelect(...a),
  isExcluded: (row) => row.wmkf_applicantdisposition === 100000001,
}));

const getReviewerByIdWithSelect = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...a) => getReviewerByIdWithSelect(...a),
}));

const {
  REVIEWER_REMINDER_STRATEGIES,
  REVIEWER_RESPOND_WORKFLOW,
  REVIEWER_REVIEWDUE_WORKFLOW,
  computeReminderSendAtMs,
} = require('../../lib/services/reviewer-reminder-workflows');

const DAY = 24 * 60 * 60 * 1000;
const SUG = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const PD = '33333333-3333-4333-8333-333333333333';

const respond = REVIEWER_REMINDER_STRATEGIES[REVIEWER_RESPOND_WORKFLOW];
const reviewdue = REVIEWER_REMINDER_STRATEGIES[REVIEWER_REVIEWDUE_WORKFLOW];

function isoDaysAgo(d) { return new Date(Date.now() - d * DAY).toISOString(); }
function isoDaysFromNow(d) { return new Date(Date.now() + d * DAY).toISOString(); }
function ymd(offsetDays) {
  const dt = new Date(Date.now() + offsetDays * DAY);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// Eligible unanswered invitation, 8d old, live token, no markers.
function suggestionRow(over = {}) {
  return {
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: 'person-1',
    wmkf_selected: true,
    wmkf_externaltokenrevoked: false,
    wmkf_externaltokenexpires: isoDaysFromNow(5),
    wmkf_invited: true,
    wmkf_emailsentat: isoDaysAgo(8),
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_reviewstatus: null,
    wmkf_reviewreceivedat: null,
    wmkf_applicantdisposition: null,
    wmkf_remindercount: 0,
    wmkf_respondremindersentat: null,
    wmkf_remindersentat: null,
    wmkf_reviewduedateoverride: null,
    _etag: 'W/"100"',
    ...over,
  };
}

// Respond config: enabled, 7-day offset, 0 lead → 8d-old invite is past due.
function requestRow(over = {}) {
  return {
    akoya_requestid: REQ,
    wmkf_respondoffsetdays: 7,
    wmkf_respondreminderenabled: true,
    wmkf_respondreminderleaddays: 0,
    wmkf_reviewduedate: null,
    wmkf_reviewduereminderenabled: false,
    wmkf_reviewduereminderleaddays: 0,
    ...over,
  };
}

function message(over = {}) {
  return {
    id: 'msg-1',
    workflow_type: REVIEWER_RESPOND_WORKFLOW,
    source_record_id: SUG,
    request_id: REQ,
    pd_systemuser_id: PD,
    pd_name: 'Dr. PD',
    pd_email: 'pd@keck.org',
    subject: 'Reminder subject',
    body_text: 'Dear Dr. Reviewer,\n\nPlease respond.\n\nDr. PD',
    to_recipients: JSON.stringify(['rev@example.org']),
    cc_recipients: JSON.stringify([]),
    dynamics_email_id: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mintAndStore.mockResolvedValue({ url: 'https://reviews.example/external/review/jwt' });
  getSuggestionByIdWithSelect.mockResolvedValue(suggestionRow());
  getReviewerByIdWithSelect.mockResolvedValue({
    wmkf_potentialreviewersid: 'person-1',
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'rev@example.org',
  });
  getRequestById.mockResolvedValue(requestRow());
});

describe('checkEligibility (respond)', () => {
  test('past-due, live token, no marker → eligible with fresh row+request ctx', async () => {
    const verdict = await respond.checkEligibility(message());
    expect(verdict.eligible).toBe(true);
    expect(verdict.ctx.row.wmkf_appreviewersuggestionid).toBe(SUG);
    expect(verdict.ctx.request.akoya_requestid).toBe(REQ);
  });

  test('a refusal predicate (declined) stops the row', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(suggestionRow({ wmkf_declined: true }));
    const verdict = await respond.checkEligibility(message());
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('ineligible');
  });

  test('a marker with NO transport state stops the row (someone else reminded them)', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_respondremindersentat: isoDaysAgo(1) }),
    );
    const verdict = await respond.checkEligibility(message());
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('already_reminded');
  });

  test('a marker WITH our activity recorded proceeds — we are completing our own send', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_respondremindersentat: isoDaysAgo(1) }),
    );
    const verdict = await respond.checkEligibility(message({ dynamics_email_id: 'act-1' }));
    expect(verdict.eligible).toBe(true);
  });

  test('a marker on a row that CLAIMED (crash after the claim PATCH) resumes — the marker is our own, not a stop', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_respondremindersentat: isoDaysAgo(1) }),
    );
    const verdict = await respond.checkEligibility(
      message({ claim_committed_at: isoDaysAgo(1) }),
    );
    expect(verdict.eligible).toBe(true);
  });

  test('a failed mint claim without a fresh marker does not arm the expired-token exemption', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_externaltokenexpires: isoDaysAgo(1) }),
    );
    const verdict = await respond.checkEligibility(
      message({ claim_committed_at: isoDaysAgo(1) }),
    );
    expect(verdict).toEqual({ stop: true, reason: 'token_expired' });
  });

  test('an expired-token claim resumes only when the fresh marker proves the rotation is ours', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_externaltokenexpires: isoDaysAgo(1) }),
    );
    const unproved = await respond.checkEligibility(
      message({ claim_committed_at: isoDaysAgo(1) }),
    );
    expect(unproved).toEqual({ stop: true, reason: 'token_expired' });

    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({
        wmkf_respondremindersentat: isoDaysAgo(1),
        wmkf_externaltokenexpires: isoDaysAgo(1),
      }),
    );
    const verdict = await respond.checkEligibility(
      message({ claim_committed_at: isoDaysAgo(1) }),
    );
    expect(verdict.eligible).toBe(true);
  });

  test('a queued row stops when the reviewer current email differs from its frozen recipient', async () => {
    getReviewerByIdWithSelect.mockResolvedValue({
      wmkf_potentialreviewersid: 'person-1',
      wmkf_emailaddress: 'corrected@example.org',
    });
    const verdict = await respond.checkEligibility(message());
    expect(verdict).toEqual({ stop: true, reason: 'recipient_changed' });
  });

  test('recipient revalidation matches the frozen address case-insensitively', async () => {
    getReviewerByIdWithSelect.mockResolvedValue({
      wmkf_potentialreviewersid: 'person-1',
      wmkf_emailaddress: 'REV@EXAMPLE.ORG',
    });
    const unchanged = await respond.checkEligibility(message());
    expect(unchanged.eligible).toBe(true);
    expect(getReviewerByIdWithSelect).toHaveBeenCalledWith('person-1', {
      select: 'wmkf_potentialreviewersid,wmkf_name,wmkf_emailaddress',
    });

    const extraRecipient = await respond.checkEligibility(message({
      to_recipients: ['rev@example.org', 'unexpected@example.org'],
    }));
    expect(extraRecipient).toEqual({ stop: true, reason: 'recipient_changed' });

    getReviewerByIdWithSelect.mockResolvedValue({
      wmkf_potentialreviewersid: 'person-1',
      wmkf_emailaddress: 'different@example.org',
    });
    const changedControl = await respond.checkEligibility(message());
    expect(changedControl).toEqual({ stop: true, reason: 'recipient_changed' });
  });

  test('a queued row fails closed when the reviewer current email is unresolvable', async () => {
    getReviewerByIdWithSelect.mockResolvedValue(null);
    const verdict = await respond.checkEligibility(message());
    expect(verdict).toEqual({ stop: true, reason: 'recipient_changed' });
  });

  test('an existing Dynamics activity bypasses recipient revalidation without weakening the queued-row gate', async () => {
    getReviewerByIdWithSelect.mockResolvedValue({
      wmkf_potentialreviewersid: 'person-1',
      wmkf_emailaddress: 'corrected@example.org',
    });
    const queued = await respond.checkEligibility(message());
    expect(queued).toEqual({ stop: true, reason: 'recipient_changed' });

    const existingActivity = await respond.checkEligibility(
      message({ dynamics_email_id: 'act-1' }),
    );
    expect(existingActivity.eligible).toBe(true);
    expect(getReviewerByIdWithSelect).toHaveBeenCalledTimes(1);
  });

  test('an owned claim never overrides hard refusals — a declined reviewer stays stopped', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_respondremindersentat: isoDaysAgo(1), wmkf_declined: true }),
    );
    const verdict = await respond.checkEligibility(
      message({ claim_committed_at: isoDaysAgo(1) }),
    );
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('ineligible');
  });

  test('reminder config off stops the row (the sweep revives it on re-enable)', async () => {
    getRequestById.mockResolvedValue(requestRow({ wmkf_respondreminderenabled: false }));
    const verdict = await respond.checkEligibility(message());
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('reminder_config_off');
  });

  test('a recomputed FUTURE send time defers to exactly that time (config drift moves the row)', async () => {
    // Invite only 1d old with a 7-day offset → send time 6d out.
    const sentAt = isoDaysAgo(1);
    getSuggestionByIdWithSelect.mockResolvedValue(suggestionRow({ wmkf_emailsentat: sentAt }));
    const verdict = await respond.checkEligibility(message());
    expect(verdict.defer).toBeInstanceOf(Date);
    expect(verdict.defer.getTime()).toBe(Date.parse(sentAt) + 7 * DAY);
  });

  test('force (PD send-now) overrides the timing defer but not hard eligibility', async () => {
    const sentAt = isoDaysAgo(1); // send time 6d out → would defer
    getSuggestionByIdWithSelect.mockResolvedValue(suggestionRow({ wmkf_emailsentat: sentAt }));
    const forced = await respond.checkEligibility(message(), { force: true });
    expect(forced.eligible).toBe(true);
    // Hard eligibility still wins under force: a declined reviewer stays stopped.
    getSuggestionByIdWithSelect.mockResolvedValue(suggestionRow({ wmkf_declined: true }));
    const declined = await respond.checkEligibility(message(), { force: true });
    expect(declined.stop).toBe(true);
  });

  test('an expired token stops the row (offer window closed; revive on re-invite)', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(
      suggestionRow({ wmkf_externaltokenexpires: isoDaysAgo(1) }),
    );
    const verdict = await respond.checkEligibility(message());
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('token_expired');
  });

  test('a transient suggestion read failure propagates (retryable, never a stop)', async () => {
    getSuggestionByIdWithSelect.mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));
    await expect(respond.checkEligibility(message())).rejects.toThrow('503');
  });

  test('a vanished suggestion (404) stops the row', async () => {
    getSuggestionByIdWithSelect.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const verdict = await respond.checkEligibility(message());
    expect(verdict.stop).toBe(true);
    expect(verdict.reason).toBe('source_not_found');
  });
});

describe('checkEligibility (review-due)', () => {
  function dueSuggestion(over = {}) {
    return suggestionRow({
      wmkf_accepted: true,
      wmkf_reviewstatus: 100000001, // materials sent
      ...over,
    });
  }
  function dueRequest(over = {}) {
    return requestRow({
      wmkf_reviewduedate: ymd(-1), // due yesterday → past → sendable
      wmkf_reviewduereminderenabled: true,
      ...over,
    });
  }

  test('accepted, materials sent, past due-minus-lead → eligible', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(dueSuggestion());
    getRequestById.mockResolvedValue(dueRequest());
    const verdict = await reviewdue.checkEligibility(message({ workflow_type: REVIEWER_REVIEWDUE_WORKFLOW }));
    expect(verdict.eligible).toBe(true);
  });

  test('a due-date extension defers to the recomputed time instead of sending on the stale date', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(dueSuggestion({ wmkf_reviewduedateoverride: ymd(30) }));
    getRequestById.mockResolvedValue(dueRequest());
    const verdict = await reviewdue.checkEligibility(message({ workflow_type: REVIEWER_REVIEWDUE_WORKFLOW }));
    expect(verdict.defer).toBeInstanceOf(Date);
    expect(verdict.defer.getTime()).toBe(Date.parse(`${ymd(30)}T23:59:59Z`));
  });

  test('a submitted review stops the row', async () => {
    getSuggestionByIdWithSelect.mockResolvedValue(dueSuggestion({ wmkf_reviewreceivedat: isoDaysAgo(1) }));
    getRequestById.mockResolvedValue(dueRequest());
    const verdict = await reviewdue.checkEligibility(message({ workflow_type: REVIEWER_REVIEWDUE_WORKFLOW }));
    expect(verdict.stop).toBe(true);
  });
});

describe('buildActivityInput', () => {
  test('respond: ONE mintAndStore PATCH carries marker + If-Match; payload is PD-attributed, noFallback, token in body', async () => {
    const msg = message();
    const ctx = { row: suggestionRow(), request: requestRow() };
    const input = await respond.buildActivityInput(msg, ctx);
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({
      suggestionId: SUG,
      requestId: REQ,
      ifMatch: 'W/"100"',
      actingUserSystemId: PD,
      writeFields: { wmkf_respondremindersentat: expect.any(String) },
    }));
    expect(input).toMatchObject({
      subject: 'Reminder subject',
      from: 'pd@keck.org',
      to: ['rev@example.org'],
      regardingId: REQ,
      regardingType: 'akoya_request',
      actingUserSystemId: PD,
      noFallback: true,
    });
    expect(input.body).toContain('https://reviews.example/external/review/jwt');
    expect(input.body).toContain('Accept or decline');
    expect(input.body).toContain('This automated reminder was sent by the W. M. Keck Foundation');
    expect(input.body).toContain('pd@keck.org');
  });

  test('review-due: claim increments the reminder count from the fresh row', async () => {
    const msg = message({ workflow_type: REVIEWER_REVIEWDUE_WORKFLOW });
    const ctx = {
      row: suggestionRow({ wmkf_remindercount: 2, wmkf_accepted: true, wmkf_reviewstatus: 100000001 }),
      request: requestRow({ wmkf_reviewduedate: ymd(-1), wmkf_reviewduereminderenabled: true }),
    };
    const input = await reviewdue.buildActivityInput(msg, ctx);
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({
      writeFields: { wmkf_remindersentat: expect.any(String), wmkf_remindercount: 3 },
    }));
    expect(input.body).toContain('Open your review');
  });

  test('a missing fresh ETag refuses the claim (fail closed, retryable)', async () => {
    const { _etag, ...noEtag } = suggestionRow();
    await expect(respond.buildActivityInput(message(), { row: noEtag, request: requestRow() }))
      .rejects.toThrow('ETag');
    expect(mintAndStore).not.toHaveBeenCalled();
  });

  test('a 412 from the conditional claim propagates (retryable failure, no swallow)', async () => {
    mintAndStore.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));
    await expect(respond.buildActivityInput(message(), { row: suggestionRow(), request: requestRow() }))
      .rejects.toThrow('precondition failed');
  });
});

describe('computeReminderSendAtMs', () => {
  test('respond: emailSentAt + (offset − lead) days', () => {
    const row = suggestionRow({ wmkf_emailsentat: '2026-08-01T10:00:00Z' });
    const request = requestRow({ wmkf_respondoffsetdays: 7, wmkf_respondreminderleaddays: 2 });
    expect(computeReminderSendAtMs('respond', row, request))
      .toBe(Date.parse('2026-08-01T10:00:00Z') + 5 * DAY);
  });

  test('review-due: end-of-day due date minus lead; override wins', () => {
    const row = suggestionRow({ wmkf_reviewduedateoverride: '2026-09-20' });
    const request = requestRow({
      wmkf_reviewduedate: '2026-09-10',
      wmkf_reviewduereminderenabled: true,
      wmkf_reviewduereminderleaddays: 3,
    });
    expect(computeReminderSendAtMs('reviewdue', row, request))
      .toBe(Date.parse('2026-09-20T23:59:59Z') - 3 * DAY);
  });

  test('disabled or incomplete config yields null for both kinds', () => {
    expect(computeReminderSendAtMs('respond', suggestionRow(), requestRow({ wmkf_respondreminderenabled: false }))).toBeNull();
    expect(computeReminderSendAtMs('respond', suggestionRow({ wmkf_emailsentat: null }), requestRow())).toBeNull();
    expect(computeReminderSendAtMs('reviewdue', suggestionRow(), requestRow())).toBeNull();
  });
});
