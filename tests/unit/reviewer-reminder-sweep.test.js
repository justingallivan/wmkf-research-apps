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
    updateLifecycle: (id, updates, opts = {}) => DynamicsService.updateRecord(
      'wmkf_appreviewersuggestions',
      id,
      {
        ...(updates.reminderSentAt === undefined ? {} : { wmkf_remindersentat: updates.reminderSentAt }),
        ...(updates.reminderCount === undefined ? {} : { wmkf_remindercount: updates.reminderCount }),
      },
      opts,
    ),
  };
});

const {
  sendOneReminder,
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
});

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

  test('eligible candidate: claims the marker + token in one ETag-guarded PATCH, then sends', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(1);
    // Marker + token land in the single mintAndStore PATCH, bound to the query row's
    // ETag (atomic-write fix): a concurrent revoke/deselect 412s the whole write.
    expect(mintAndStore).toHaveBeenCalledTimes(1);
    expect(mintAndStore).toHaveBeenCalledWith(expect.objectContaining({
      suggestionId: SUG,
      ifMatch: 'W/"100"',
      writeFields: expect.objectContaining({ wmkf_respondremindersentat: expect.any(String) }),
    }));
    // No separate marker PATCH any more — the claim rides in the mint.
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).toHaveBeenCalledTimes(1);
    // Claim-before-send ordering: the atomic marker+token write must precede the send,
    // so a crash mid-op can never send without first claiming.
    expect(mintAndStore.mock.invocationCallOrder[0]).toBeLessThan(createAndSendEmail.mock.invocationCallOrder[0]);
    // Sent from the PD; respond reminder is the "accept or decline" subject.
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.from).toBe('pd@keck.org');
    expect(email.to).toBe('rev@example.org');
    expect(email.subject).toBe(RESPOND_SUBJECT);
    expect(email.body).toContain('Dear Dr. Reviewer,');
    expect(email.body).toContain('the proposal “A Proposal”');
    expect(email.body).toContain('Dr. PD');
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
    expect(r.sent).toBe(1);
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.subject).toBe('Custom respond subject');
    expect(email.body).toContain('Hello Dr. Reviewer');
    expect(email.body).toContain('Review the proposal “A Proposal”.');
    expect(email.body).toContain('Dr. PD');
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

  test('missing _etag → fail closed (claimFailed, no claim write, no send)', async () => {
    const { _etag, ...noEtag } = respondCandidate();
    queryAllRecords.mockResolvedValue({ records: [noEtag] });
    installReads();
    const r = await sweepRespondReminders();
    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('maxBatch bounds CLAIMS even when sends fail (no mass suppression)', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => respondCandidate({ wmkf_appreviewersuggestionid: `id-${i}`, _etag: `W/"${i}"` }));
    queryAllRecords.mockResolvedValue({ records: rows });
    installReads();
    createAndSendEmail.mockRejectedValue(new Error('SMTP down')); // every send fails
    const r = await sweepRespondReminders({ maxBatch: 2 });
    // Only 2 rows may be claimed despite all sends failing — the rest are deferred.
    // The claim now rides in the atomic mintAndStore PATCH, so it bounds the claims.
    expect(mintAndStore).toHaveBeenCalledTimes(2);
    expect(r.sendFailed).toBe(2);
    expect(r.sent).toBe(0);
    expect(r.skipped).toBe(3);
  });

  test('missing reviewer email → skipped, no claim or send', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads({ reviewerEmail: null });
    const r = await sweepRespondReminders();
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
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

  test('concurrent revoke/deselect (412 on the atomic marker+token PATCH) → claimFailed, no send, no reactivation', async () => {
    // Regression for the Codex P1 race: a staff revoke or deselect that lands after
    // the sweep query but before the write must 412 the atomic mint (which would
    // otherwise clear wmkf_externaltokenrevoked back to false). Verifies no email is
    // sent and no marker is stamped.
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    mintAndStore.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    const r = await sweepRespondReminders();
    expect(r.claimFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(createAndSendEmail).not.toHaveBeenCalled();
    expect(updateRecord).not.toHaveBeenCalled();
  });

  test('send fails after a successful atomic claim → at-most-once (sendFailed, marker stays)', async () => {
    queryAllRecords.mockResolvedValue({ records: [respondCandidate()] });
    installReads();
    createAndSendEmail.mockRejectedValueOnce(new Error('SMTP down'));
    const r = await sweepRespondReminders();
    expect(mintAndStore).toHaveBeenCalledTimes(1); // atomic marker+token PATCH landed
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
      wmkf_externaltokenhash: 'stored-token-hash',
      wmkf_externaltokenexpires: new Date(Date.now() + 120 * DAY).toISOString(),
      wmkf_externaltokenrevoked: false,
      _etag: 'W/"200"',
      ...over,
    };
  }

  test('eligible: claims wmkf_remindersentat (+count) without rotating token authority, then sends a link-free reminder', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });
    const r = await sweepReviewDueReminders();
    expect(r.sent).toBe(1);
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(updateRecord).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUG,
      expect.objectContaining({ wmkf_remindersentat: expect.any(String), wmkf_remindercount: 1 }),
      { actingUserSystemId: null, ifMatch: 'W/"200"' },
    );
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.subject).toBe(REVIEW_DUE_SUBJECT);
    expect(email.body).toContain('Dear Dr. Reviewer,');
    expect(email.body).toContain('Your review is due by');
    expect(email.body).toContain('original review materials email');
    expect(email.body).toContain('If you have already submitted');
    expect(email.body).not.toContain('/external/review/');
    expect(email.body).not.toContain('secure link below');
  });

  test('a configured reviewer URL fails before the fire-once marker is claimed', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return { found: true, value: REVIEW_DUE_SUBJECT };
      if (key === REVIEW_DUE_BODY_KEY) return {
        found: true,
        value: 'Continue here: https://reviews.example.org/external/review/token.value.sig',
      };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });

    const r = await sweepReviewDueReminders();

    expect(r.prepareFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('a reviewer URL in the configured subject fails before the fire-once marker is claimed', async () => {
    getSettingStrict.mockImplementation(async (key) => {
      if (key === REVIEW_DUE_SUBJECT_KEY) return {
        found: true,
        value: 'Continue here: https://reviews.example.org/external/review/token.value.sig',
      };
      if (key === REVIEW_DUE_BODY_KEY) return { found: true, value: REVIEW_DUE_BODY };
      throw new Error(`unexpected setting ${key}`);
    });
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest() });

    const r = await sweepReviewDueReminders();

    expect(r.prepareFailed).toBe(1);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('per-reviewer override controls eligibility and rendered date without minting a token', async () => {
    const override = ymdDaysFromNow(10);
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate({
      wmkf_reviewduedateoverride: override,
    })] });
    installReads({ request: reviewDueRequest({
      wmkf_reviewduedate: ymdDaysFromNow(60),
      wmkf_reviewduereminderleaddays: 40,
    }) });

    const r = await sweepReviewDueReminders();

    expect(r.sent).toBe(1);
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail.mock.calls[0][0].body).toContain(
      new Date(`${override}T12:00:00Z`).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
      }),
    );
  });

  test('a later per-reviewer override defers a reminder that the request date would send', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate({
      wmkf_reviewduedateoverride: ymdDaysFromNow(30),
    })] });
    installReads({ request: reviewDueRequest({
      wmkf_reviewduedate: ymdDaysFromNow(10),
      wmkf_reviewduereminderleaddays: 20,
    }) });

    const r = await sweepReviewDueReminders();

    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(mintAndStore).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
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
    expect(r.sent).toBe(1);
    const email = createAndSendEmail.mock.calls[0][0];
    expect(email.subject).toBe('Custom review due subject');
    expect(email.body).toContain('Review due for Dr. Reviewer: the proposal “A Proposal” by');
    expect(email.body).toContain('Dr. PD');
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
    expect(r.blocked.due_date_missing).toBe(1);
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['token_revoked', { wmkf_externaltokenrevoked: true }, {}],
    ['token_not_minted', { wmkf_externaltokenhash: '  ' }, {}],
    ['token_invalid_data', { wmkf_externaltokenexpires: null }, {}],
    ['token_expired', { wmkf_externaltokenexpires: isoDaysAgo(1) }, {}],
    ['token_insufficient_window', { wmkf_externaltokenexpires: new Date(Date.now() + 5 * DAY).toISOString() }, {
      wmkf_reviewduedate: ymdDaysFromNow(10),
      wmkf_reviewduereminderleaddays: 20,
    }],
  ])('%s is counted as a block, not a sweep error, before claim/send', async (reason, rowOver, requestOver) => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate(rowOver)] });
    installReads({ request: reviewDueRequest(requestOver) });

    const r = await sweepReviewDueReminders();

    expect(r.blocked[reason]).toBe(1);
    expect(r.errors).toEqual([]);
    expect(r.sent).toBe(0);
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createAndSendEmail).not.toHaveBeenCalled();
  });

  test('due date still beyond the lead window → skipped', async () => {
    queryAllRecords.mockResolvedValue({ records: [reviewDueCandidate()] });
    installReads({ request: reviewDueRequest({ wmkf_reviewduedate: ymdDaysFromNow(30), wmkf_reviewduereminderleaddays: 3 }) });
    const r = await sweepReviewDueReminders();
    expect(r.sent).toBe(0);
  });
});

test('unknown reminder kind fails before any marker or token write', async () => {
  const result = {
    sent: 0,
    skipped: 0,
    prepareFailed: 0,
    claimFailed: 0,
    sendFailed: 0,
    errors: [],
  };

  await sendOneReminder({
    kind: 'unexpected',
    row: { wmkf_appreviewersuggestionid: SUG, _etag: 'W/"1"' },
    request: requestConfig({ wmkf_reviewduedate: ymdDaysFromNow(-1) }),
    pd: { internalemailaddress: 'pd@keck.org', systemuserid: PD },
    reviewer: { wmkf_emailaddress: 'rev@example.org' },
    result,
  });

  expect(result).toMatchObject({ prepareFailed: 1, refusalReason: 'invalid_kind' });
  expect(updateRecord).not.toHaveBeenCalled();
  expect(mintAndStore).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});
