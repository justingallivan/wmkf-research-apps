/**
 * Reviewer reminder sweeps (Phase 3; LEDGER MODE since the reviewer
 * cron-reminders slice) — eligibility gating, ledger-row creation with frozen
 * send times, posture freezing (review-all override / reviewer VIP flags),
 * and row reconciliation (revive / reassign / refresh). Delivery itself is
 * covered by the scheduled-email-service and reviewer-reminder-workflows
 * suites; the sweeps must never send or touch Dataverse markers.
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
const createOrGetScheduledEmail = jest.fn();
const reviveStoppedScheduledEmail = jest.fn();
const reassignScheduledEmail = jest.fn();
const refreshUntouchedScheduledEmail = jest.fn();
const filterVipFlaggedReviewers = jest.fn();
jest.mock('../../lib/services/scheduled-email-store', () => ({
  createOrGetScheduledEmail: (...a) => createOrGetScheduledEmail(...a),
  reviveStoppedScheduledEmail: (...a) => reviveStoppedScheduledEmail(...a),
  reassignScheduledEmail: (...a) => reassignScheduledEmail(...a),
  refreshUntouchedScheduledEmail: (...a) => refreshUntouchedScheduledEmail(...a),
  filterVipFlaggedReviewers: (...a) => filterVipFlaggedReviewers(...a),
}));
const getEmailAutomationPreferenceForSystemUser = jest.fn();
jest.mock('../../lib/services/email-automation-preferences', () => ({
  getEmailAutomationPreferenceForSystemUser: (...a) => getEmailAutomationPreferenceForSystemUser(...a),
}));
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
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => {
  // queryAllSuggestions / patchFields are thin DynamicsService passthroughs
  // (data-access-layer conversion, Stages 3-6) — forward through the
  // ALSO-mocked dynamics-service module so the existing assertions on
  // DynamicsService.queryAllRecords/updateRecord below still see these calls.
  const { DynamicsService } = jest.requireMock('../../lib/services/dynamics-service');
  return {
    notExcludedFilter: () => 'wmkf_applicantdisposition ne 100000001',
    // Mirror the real adapter fragment so the eligibility-clause assertions below
    // test the actual OData the sweeps emit (T2 fix).
    selectedAndNotRevokedFilter: () => 'wmkf_selected eq true and (wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null)',
    queryAllSuggestions: (options) => DynamicsService.queryAllRecords('wmkf_appreviewersuggestions', options),
    patchFields: (id, payload, opts = {}) => DynamicsService.updateRecord('wmkf_appreviewersuggestions', id, payload, opts),
  };
});

const { sweepRespondReminders, sweepReviewDueReminders } = require('../../lib/services/reviewer-reminder-sweep');

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
    _etag: 'W/"100"',
    ...over,
  };
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
  // Default: creation succeeds — echo the input as a freshly inserted row
  // (same id ⇒ the sweep counts it as created).
  createOrGetScheduledEmail.mockImplementation(async (input) => ({
    ...input,
    status: 'scheduled',
    pd_systemuser_id: input.pdSystemUserId,
  }));
  reviveStoppedScheduledEmail.mockResolvedValue(null);
  reassignScheduledEmail.mockResolvedValue(null);
  refreshUntouchedScheduledEmail.mockResolvedValue(null);
  filterVipFlaggedReviewers.mockResolvedValue(new Set());
  getEmailAutomationPreferenceForSystemUser.mockResolvedValue(null);
});

/** The sweeps must NEVER send or claim — delivery belongs to the due worker. */
function expectNoDirectSendOrClaim() {
  expect(createAndSendEmail).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(updateRecord).not.toHaveBeenCalled();
}

describe('sweepRespondReminders', () => {
  test('respond query filters to selected, not-revoked reviewers (T2) with null-safe revoked syntax', async () => {
    queryAllRecords.mockResolvedValue({ records: [] });
    await sweepRespondReminders();
    const options = queryAllRecords.mock.calls[0][1];
    // The eligibility guard IS the query filter: a revoked/deselected row is never
    // returned to the JS sweep, so re-minting can't reactivate its link.
    expect(options.filter).toContain('wmkf_selected eq true');
    expect(options.filter).toContain('wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null');
    // Null-safe form only: a bare `ne true` would drop every never-revoked (null) row.
    expect(options.filter).not.toMatch(/wmkf_externaltokenrevoked\s+ne\s+true/);
  });

  test('eligible candidate: creates the ledger row (frozen draft, send time, PD identity); never sends or claims', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.created).toBe(1);
    expect(r.sent).toBe(0);
    expectNoDirectSendOrClaim();
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(input.workflowType).toBe('reviewer_respond_reminder');
    expect(input.sourceRecordId).toBe(SUG);
    expect(input.requestId).toBe(REQ);
    expect(input.deliverableId).toBeNull();
    expect(input.pdSystemUserId).toBe(PD);
    expect(input.pdEmail).toBe('pd@keck.org');
    expect(input.toRecipients).toEqual(['rev@example.org']);
    expect(input.approvalRequired).toBe(false);
    expect(input.subject).toBe(RESPOND_SUBJECT);
    // 8d-old invite, offset 7, lead 0 → send time already past (backlog sends next due run).
    expect(Date.parse(input.scheduledSendAt)).toBeLessThan(Date.now());
    expect(input.bodyText).toContain('Dear Dr. Reviewer,');
    expect(input.bodyText).toContain('the proposal “A Proposal”');
    expect(input.bodyText).toContain('Dr. PD');
  });

  test('default read is applied to respond reminder subject and body', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === RESPOND_SUBJECT_KEY) return { found: true, value: 'Custom respond subject' };
      if (key === RESPOND_BODY_KEY) return {
        found: true,
        value: 'Hello [Reviewer Name]\n\nReview [proposal title clause].\n\nSigned,\n[Program Director signature]',
      };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.created).toBe(1);
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(input.subject).toBe('Custom respond subject');
    expect(input.bodyText).toContain('Hello Dr. Reviewer');
    expect(input.bodyText).toContain('Review the proposal “A Proposal”.');
    expect(input.bodyText).toContain('Dr. PD');
  });

  test('blank respond default skips before claim and alerts admins', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === RESPOND_SUBJECT_KEY) return { found: true, value: '   ' };
      if (key === RESPOND_BODY_KEY) return { found: true, value: RESPOND_BODY };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.skippedMisconfigured).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_default_misconfigured',
      emailAdmins: true,
      autoResolveKey: `email-default-misconfigured:${RESPOND_SUBJECT_KEY}`,
    }));
    expect(notify.mock.invocationCallOrder[0]).toBeLessThan(queryAllRecords.mock.invocationCallOrder[0]);
  });

  test('unavailable respond default skips before claim and alerts admins', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === RESPOND_SUBJECT_KEY) throw new Error('Dynamics 503');
      if (key === RESPOND_BODY_KEY) return { found: true, value: RESPOND_BODY };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.skippedMisconfigured).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_default_misconfigured',
      emailAdmins: true,
      autoResolveKey: `email-default-misconfigured:${RESPOND_SUBJECT_KEY}`,
      metadata: expect.objectContaining({ reason: 'unavailable' }),
    }));
  });

  test('a query row without an ETag still gets its ledger row (the delivery claim authorizes from a fresh read)', async () => {
    const { _etag, ...noEtag } = respondCandidate();
    queryAllRecords.mockResolvedValue({ records: [noEtag] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.created).toBe(1);
    expectNoDirectSendOrClaim();
  });

  test('maxBatch bounds ledger-row upserts per run', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => respondCandidate({ wmkf_appreviewersuggestionid: `id-${i}` }));
    queryAllRecords.mockResolvedValue({ records: rows });
    installReads();
    const r = await sweepRespondReminders({ maxBatch: 2 });
    expect(createOrGetScheduledEmail).toHaveBeenCalledTimes(2);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(3);
  });

  test('missing reviewer email → skipped, no claim or send', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ reviewerEmail: null });
    const r = await sweepRespondReminders();
    expect(r.created).toBe(0);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
    expectNoDirectSendOrClaim();
  });

  test('disabled per request → skipped, no claim or send', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ request: requestConfig({ wmkf_respondreminderenabled: false }) });
    const r = await sweepRespondReminders();
    expect(r.created).toBe(0);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
    expectNoDirectSendOrClaim();
  });

  test('a future deadline still creates the row NOW, frozen with its future send time (early visibility)', async () => {
    // emailSentAt 1d ago, offset 7, lead 0 → send time 6d in the future.
    const sentAt = isoDaysAgo(1);
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_emailsentat: sentAt })] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.created).toBe(1);
    expectNoDirectSendOrClaim();
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(Date.parse(input.scheduledSendAt)).toBe(Date.parse(sentAt) + 7 * DAY);
  });

  test('expired token → skipped (offer window closed)', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_externaltokenexpires: isoDaysAgo(1) })] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.created).toBe(0);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
    expectNoDirectSendOrClaim();
  });

  test('lead days shift the frozen send time earlier', async () => {
    // emailSentAt 1d ago, offset 7, lead 7 → send time = emailSentAt (offset − lead = 0).
    const sentAt = isoDaysAgo(1);
    queryAllRecords.mockResolvedValue({ records: [respondCandidate({ wmkf_emailsentat: sentAt })] });
    installReads({ request: requestConfig({ wmkf_respondreminderleaddays: 7 }) });
    const r = await sweepRespondReminders();
    expect(r.created).toBe(1);
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(Date.parse(input.scheduledSendAt)).toBe(Date.parse(sentAt));
  });

  test('disabled PD (no sender) → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ pdDisabled: true });
    const r = await sweepRespondReminders();
    expect(r.created).toBe(0);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
    expectNoDirectSendOrClaim();
  });

  test('dryRun: counts eligible but never claims or sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders({ dryRun: true });
    expect(r.eligible).toBe(1);
    expect(r.created).toBe(0);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
    expectNoDirectSendOrClaim();
  });

  test('an existing stopped never-transported row is revived from current state', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    createOrGetScheduledEmail.mockResolvedValueOnce({ id: 'other-id', status: 'stopped', pd_systemuser_id: PD });
    reviveStoppedScheduledEmail.mockResolvedValueOnce({ id: 'other-id', status: 'scheduled' });
    const r = await sweepRespondReminders();
    expect(r.revived).toBe(1);
    expect(reviveStoppedScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({ sourceRecordId: SUG }));
    expectNoDirectSendOrClaim();
  });

  test('an existing unsent row under a different PD is rebuilt via reassign', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    createOrGetScheduledEmail.mockResolvedValueOnce({ id: 'other-id', status: 'scheduled', pd_systemuser_id: 'former-pd' });
    reassignScheduledEmail.mockResolvedValueOnce({ id: 'other-id' });
    const r = await sweepRespondReminders();
    expect(r.reassigned).toBe(1);
    expect(refreshUntouchedScheduledEmail).not.toHaveBeenCalled();
  });

  test('an existing same-PD unsent row gets an untouched-draft refresh', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    createOrGetScheduledEmail.mockResolvedValueOnce({ id: 'other-id', status: 'scheduled', pd_systemuser_id: PD });
    refreshUntouchedScheduledEmail.mockResolvedValueOnce({ id: 'other-id' });
    const r = await sweepRespondReminders();
    expect(r.refreshed).toBe(1);
    expect(reassignScheduledEmail).not.toHaveBeenCalled();
  });

  test('a VIP-flagged reviewer freezes approval_required at creation', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    filterVipFlaggedReviewers.mockResolvedValueOnce(new Set([PERSON]));
    await sweepRespondReminders();
    expect(filterVipFlaggedReviewers).toHaveBeenCalledWith(PD, [PERSON]);
    expect(createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({ approvalRequired: true }));
  });

  test('the review-all override freezes approval_required without consulting VIP flags', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    getEmailAutomationPreferenceForSystemUser.mockResolvedValueOnce({ reviewAll: true });
    await sweepRespondReminders();
    expect(createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({ approvalRequired: true }));
    expect(filterVipFlaggedReviewers).not.toHaveBeenCalled();
  });

  test('a posture read failure fails closed: no row is created', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    getEmailAutomationPreferenceForSystemUser.mockRejectedValueOnce(new Error('pg down'));
    const r = await sweepRespondReminders();
    expect(r.preferenceFailed).toBe(1);
    expect(createOrGetScheduledEmail).not.toHaveBeenCalled();
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
      _etag: 'W/"200"',
      ...over,
    };
  }

  test('eligible: creates the review-due ledger row with the due-date send time; never sends or claims', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.created).toBe(1);
    expectNoDirectSendOrClaim();
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(input.workflowType).toBe('reviewer_reviewdue_reminder');
    expect(input.sourceRecordId).toBe(SUG);
    expect(input.deliverableId).toBeNull();
    expect(input.subject).toBe(REVIEW_DUE_SUBJECT);
    expect(input.bodyText).toContain('Dear Dr. Reviewer,');
    expect(input.bodyText).toContain('Your review is due by');
  });

  test('per-reviewer override controls the frozen send time and the rendered date', async () => {
    const override = ymdDaysFromNow(10);
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate({
      wmkf_reviewduedateoverride: override,
    })] });
    installReads({ request: reviewDueRequest({
      wmkf_reviewduedate: ymdDaysFromNow(60),
      wmkf_reviewduereminderleaddays: 40,
    }) });

    const r = await sweepReviewDueReminders();

    expect(r.created).toBe(1);
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(Date.parse(input.scheduledSendAt)).toBe(Date.parse(`${override}T23:59:59Z`) - 40 * DAY);
    expect(input.bodyText).toContain(
      new Date(`${override}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
    );
  });

  test('a later per-reviewer override freezes the LATER send time (row still created early)', async () => {
    const override = ymdDaysFromNow(30);
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate({
      wmkf_reviewduedateoverride: override,
    })] });
    installReads({ request: reviewDueRequest({
      wmkf_reviewduedate: ymdDaysFromNow(10),
      wmkf_reviewduereminderleaddays: 20,
    }) });

    const r = await sweepReviewDueReminders();

    expect(r.created).toBe(1);
    expectNoDirectSendOrClaim();
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(Date.parse(input.scheduledSendAt)).toBe(Date.parse(`${override}T23:59:59Z`) - 20 * DAY);
  });

  test('candidate query allowlists materials_sent/under_review and excludes both terminal values', async () => {
    queryAllRecords.mockResolvedValue({ records: [] });
    await sweepReviewDueReminders();
    const options = queryAllRecords.mock.calls[0][1];
    expect(options.filter).toContain('wmkf_reviewstatus eq 100000001');
    expect(options.filter).toContain('wmkf_reviewstatus eq 100000002');
    expect(options.filter).not.toContain('100000005');
    expect(options.filter).not.toContain('100000006');
  });

  test('review-due query filters to selected, not-revoked reviewers (T2) with null-safe revoked syntax', async () => {
    queryAllRecords.mockResolvedValue({ records: [] });
    await sweepReviewDueReminders();
    const options = queryAllRecords.mock.calls[0][1];
    // The eligibility guard IS the query filter: a revoked/deselected row is never
    // returned to the JS sweep, so re-minting can't reactivate its link.
    expect(options.filter).toContain('wmkf_selected eq true');
    expect(options.filter).toContain('wmkf_externaltokenrevoked eq false or wmkf_externaltokenrevoked eq null');
    // Null-safe form only: a bare `ne true` would drop every never-revoked (null) row.
    expect(options.filter).not.toMatch(/wmkf_externaltokenrevoked\s+ne\s+true/);
  });

  test('default read is applied to review-due reminder subject and body', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: 'Custom review due subject' };
      if (key === REVIEW_DUE_BODY_KEY) return {
        found: true,
        value: 'Review due for [Reviewer Name]: [proposal title clause] by [review due date]\n\n[Program Director signature]',
      };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.created).toBe(1);
    const input = createOrGetScheduledEmail.mock.calls[0][0];
    expect(input.subject).toBe('Custom review due subject');
    expect(input.bodyText).toContain('Review due for Dr. Reviewer: the proposal “A Proposal” by');
    expect(input.bodyText).toContain('Dr. PD');
  });

  test('blank review-due default skips before claim and alerts admins', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: REVIEW_DUE_SUBJECT };
      if (key === REVIEW_DUE_BODY_KEY) return { found: true, value: '' };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.skippedMisconfigured).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_default_misconfigured',
      emailAdmins: true,
      autoResolveKey: `email-default-misconfigured:${REVIEW_DUE_BODY_KEY}`,
      metadata: expect.objectContaining({ reason: 'blank' }),
    }));
  });

  test('unavailable review-due default skips before claim and alerts admins', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: REVIEW_DUE_SUBJECT };
      if (key === REVIEW_DUE_BODY_KEY) throw new Error('Dynamics 503');
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.skippedMisconfigured).toBe(1);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email_default_misconfigured',
      emailAdmins: true,
      autoResolveKey: `email-default-misconfigured:${REVIEW_DUE_BODY_KEY}`,
      metadata: expect.objectContaining({ reason: 'unavailable' }),
    }));
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
