/** @jest-environment node */

const findById = jest.fn();
const updateLifecycle = jest.fn();
const applyStaffReviewerWithdrawal = jest.fn();
const applyStaffReviewerRelease = jest.fn();
const cancelReviewerAcceptanceJobsForSuggestion = jest.fn();
const createAndSendEmail = jest.fn();
const getHonorariumCancellationState = jest.fn();
const getRequestById = jest.fn();
const readRequiredEmailDefaults = jest.fn();
const getSystemUserById = jest.fn();
const getPotentialReviewerById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  updateLifecycle: (...args) => updateLifecycle(...args),
  applyStaffReviewerWithdrawal: (...args) => applyStaffReviewerWithdrawal(...args),
  applyStaffReviewerRelease: (...args) => applyStaffReviewerRelease(...args),
  REVIEW_STATUS_MAP: {
    accepted: 100000000,
    materials_sent: 100000001,
    under_review: 100000002,
  },
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getRequestById(...args),
  getHonorariumCancellationState: (...args) => getHonorariumCancellationState(...args),
}));
jest.mock('../../lib/dataverse/adapters/system-user', () => ({
  getById: (...args) => getSystemUserById(...args),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getByIdWithSelect: (...args) => getPotentialReviewerById(...args),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => 'Program Director'),
}));
jest.mock('../../lib/services/email-defaults', () => ({
  readRequiredEmailDefaults: (...args) => readRequiredEmailDefaults(...args),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { createAndSendEmail: (...args) => createAndSendEmail(...args) },
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  cancelReviewerAcceptanceJobsForSuggestion: (...args) =>
    cancelReviewerAcceptanceJobsForSuggestion(...args),
}));

const {
  renderAcceptedReleasePreviews,
  transitionReviewersTerminal,
} = require('../../lib/services/review-manager/terminal-transition-service');

const REQUEST = '11111111-1111-4111-8111-111111111111';
const SUGGESTION = '22222222-2222-4222-8222-222222222222';
const SECOND = '33333333-3333-4333-8333-333333333333';

function row(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION,
    _wmkf_request_value: REQUEST,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_reviewstatus: 100000001,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    _wmkf_honorariumrequest_value: null,
    _wmkf_potentialreviewer_value: '55555555-5555-4555-8555-555555555555',
    wmkf_notes: null,
    _etag: 'W/"7"',
    ...overrides,
  };
}

const args = (overrides = {}) => ({
  requestId: REQUEST,
  suggestionIds: [SUGGESTION],
  terminalStatus: 'withdrew',
  actingUserSystemId: 'staff-1',
  ...overrides,
});

const acceptedReleaseArgs = (overrides = {}) => args({
  terminalStatus: 'released',
  releaseReason: 'sufficient_reviews_received',
  sendEmail: true,
  overrides: {
    [SUGGESTION]: {
      expectedNotes: '',
      subject: 'Thank you',
      bodyText: 'Thank you.',
      to: 'reviewer@example.org',
      from: 'pd@example.org',
      senderId: 'pd-1',
    },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(row());
  updateLifecycle.mockResolvedValue(undefined);
  applyStaffReviewerWithdrawal.mockResolvedValue(undefined);
  applyStaffReviewerRelease.mockResolvedValue(undefined);
  cancelReviewerAcceptanceJobsForSuggestion.mockResolvedValue([]);
  createAndSendEmail.mockResolvedValue({ sent: true });
  getHonorariumCancellationState.mockResolvedValue(null);
  getRequestById.mockImplementation(async (id) => ({
    akoya_requestid: id,
    akoya_title: 'Proposal',
    _wmkf_programdirector_value: 'pd-1',
  }));
  getSystemUserById.mockResolvedValue({
    systemuserid: 'pd-1',
    internalemailaddress: 'pd@example.org',
    isdisabled: false,
  });
  getPotentialReviewerById.mockResolvedValue({
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'reviewer@example.org',
  });
  readRequiredEmailDefaults.mockResolvedValue({
    ok: true,
    values: {
      'email.reviewer_release.subject': 'Thank you',
      'email.reviewer_release.body': '{{greeting}} — {{proposalClause}} — {{signature}}',
    },
  });
});

test('release preview blocks an authorized honorarium before loading email defaults', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: honorariumId,
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: true,
    akoya_paid: 0,
    _etag: 'W/"12"',
  });

  const result = await renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  });

  expect(result.drafts).toEqual([{
    suggestionId: SUGGESTION,
    status: 'honorarium_authorized',
    expectedNotes: '',
    existingNotes: '',
  }]);
  expect(readRequiredEmailDefaults).not.toHaveBeenCalled();
});

test('release preview reports the safe honorarium disposition and prepares email copy', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: honorariumId,
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: false,
    akoya_paid: 0,
    _etag: 'W/"12"',
  });

  const result = await renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  });

  expect(result.drafts[0]).toMatchObject({
    suggestionId: SUGGESTION,
    status: 'ok',
    honorariumDisposition: 'will_withdraw',
    to: 'reviewer@example.org',
    from: 'pd@example.org',
  });
});

test('release preview reports no_pd before loading email defaults', async () => {
  getSystemUserById.mockResolvedValue({
    systemuserid: 'pd-1',
    internalemailaddress: 'pd@example.org',
    isdisabled: true,
  });

  const result = await renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  });

  expect(result.drafts[0]).toMatchObject({ suggestionId: SUGGESTION, status: 'no_pd' });
  expect(readRequiredEmailDefaults).not.toHaveBeenCalled();
});

test('release preview reports no_email before loading email defaults', async () => {
  getPotentialReviewerById.mockResolvedValue({
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: null,
  });

  const result = await renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  });

  expect(result.drafts[0]).toMatchObject({ suggestionId: SUGGESTION, status: 'no_email' });
  expect(readRequiredEmailDefaults).not.toHaveBeenCalled();
});

test('release preview reports defaults_unavailable when required copy is missing', async () => {
  readRequiredEmailDefaults.mockResolvedValue({ ok: false, values: {} });

  const result = await renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  });

  expect(result.drafts[0]).toMatchObject({
    suggestionId: SUGGESTION,
    status: 'defaults_unavailable',
  });
});

test('transient request-read failures remain service failures instead of false 404s', async () => {
  getRequestById.mockRejectedValue(new Error('Dataverse unavailable'));

  await expect(renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  })).rejects.toThrow('Dataverse unavailable');
});

test('transient suggestion-read failures remain preview failures instead of false not-found results', async () => {
  findById.mockRejectedValue(new Error('Suggestion read unavailable'));

  await expect(renderAcceptedReleasePreviews({
    requestId: REQUEST,
    suggestionIds: [SUGGESTION],
  })).rejects.toThrow('Suggestion read unavailable');
});

test('eligible staff-recorded withdrawal corrects response state with the fresh ETag', async () => {
  const result = await transitionReviewersTerminal(args());
  expect(result).toEqual({
    ok: true,
    transitioned: 1,
    results: [{
      suggestionId: SUGGESTION,
      status: 'transitioned',
      terminalStatus: 'withdrew',
      honorariumDeleted: false,
      acceptanceJobsCancelled: 0,
    }],
  });
  expect(applyStaffReviewerWithdrawal).toHaveBeenCalledWith(
    SUGGESTION,
    {
      actingUserSystemId: 'staff-1',
      ifMatch: 'W/"7"',
      deleteHonorariumRequestId: null,
    },
  );
  expect(cancelReviewerAcceptanceJobsForSuggestion).toHaveBeenCalledWith(
    SUGGESTION,
    'program_director_recorded_reviewer_withdrawal',
  );
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('accepted row with a persisted null review status transitions', async () => {
  findById.mockResolvedValue(row({ wmkf_reviewstatus: null }));

  const result = await transitionReviewersTerminal(args());

  expect(result.transitioned).toBe(1);
  expect(result.results).toEqual([
    {
      suggestionId: SUGGESTION,
      status: 'transitioned',
      terminalStatus: 'withdrew',
      honorariumDeleted: false,
      acceptanceJobsCancelled: 0,
    },
  ]);
  expect(applyStaffReviewerWithdrawal).toHaveBeenCalledWith(
    SUGGESTION,
    {
      actingUserSystemId: 'staff-1',
      ifMatch: 'W/"7"',
      deleteHonorariumRequestId: null,
    },
  );
});

test('staff-recorded withdrawal deletes the exact linked honorarium and reports it', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  cancelReviewerAcceptanceJobsForSuggestion.mockResolvedValue([{ id: 9 }]);

  const result = await transitionReviewersTerminal(args());

  expect(applyStaffReviewerWithdrawal).toHaveBeenCalledWith(
    SUGGESTION,
    {
      actingUserSystemId: 'staff-1',
      ifMatch: 'W/"7"',
      deleteHonorariumRequestId: honorariumId,
    },
  );
  expect(result.results[0]).toMatchObject({
    suggestionId: SUGGESTION,
    status: 'transitioned',
    terminalStatus: 'withdrew',
    honorariumDeleted: true,
    acceptanceJobsCancelled: 1,
  });
});

test('a post-commit job-cancellation failure is reported without disguising the successful withdrawal', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  cancelReviewerAcceptanceJobsForSuggestion.mockRejectedValue(new Error('Postgres unavailable'));

  const result = await transitionReviewersTerminal(args());

  expect(result.transitioned).toBe(1);
  expect(result.results[0]).toMatchObject({
    suggestionId: SUGGESTION,
    status: 'transitioned',
    terminalStatus: 'withdrew',
    honorariumDeleted: false,
    warning: 'acceptance_job_cancellation_failed',
  });
  expect(result.results[0]).not.toHaveProperty('acceptanceJobsCancelled');
  expect(warning).toHaveBeenCalled();
  warning.mockRestore();
});

test.each([
  ['pre-accept row', { wmkf_accepted: false }, 'not_accepted'],
  ['already-declined row', { wmkf_accepted: false, wmkf_declined: true }, 'already_declined'],
  ['review-received row', { wmkf_reviewreceivedat: '2026-07-22T10:00:00Z' }, 'review_received'],
  ['completed row', { wmkf_completedat: '2026-07-22T10:00:00Z' }, 'completed'],
  ['already-withdrew row', { wmkf_reviewstatus: 100000005 }, 'already_terminal'],
  ['already-released row', { wmkf_reviewstatus: 100000006 }, 'already_terminal'],
  ['out-of-range source', { wmkf_reviewstatus: 100000003 }, 'invalid_source'],
  ['missing source field', { wmkf_reviewstatus: undefined }, 'invalid_source'],
  ['missing ETag', { _etag: null }, 'missing_etag'],
])('rejects %s explicitly', async (_label, overrides, expectedStatus) => {
  findById.mockResolvedValue(row(overrides));
  const result = await transitionReviewersTerminal(args());
  expect(result.transitioned).toBe(0);
  expect(result.results).toEqual([{ suggestionId: SUGGESTION, status: expectedStatus }]);
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(applyStaffReviewerWithdrawal).not.toHaveBeenCalled();
});

test('race: concurrent ETag-guarded submission wins and terminal transition never overwrites it', async () => {
  const durable = row();
  findById.mockResolvedValue({ ...durable });
  applyStaffReviewerWithdrawal.mockImplementation(async (_id, options) => {
    // The review-submission changeset commits after the service read and changes
    // the row ETag before the terminal PATCH reaches Dataverse.
    durable.wmkf_reviewreceivedat = '2026-07-22T10:00:00Z';
    durable.wmkf_reviewstatus = 100000003;
    durable._etag = 'W/"8"';
    if (options.ifMatch !== durable._etag) {
      const error = new Error('Dataverse update failed (412 Precondition Failed)');
      error.status = 412;
      throw error;
    }
  });

  const result = await transitionReviewersTerminal(args());
  expect(result.results[0].status).toBe('changed_skipped');
  expect(durable.wmkf_reviewstatus).toBe(100000003);
  expect(durable.wmkf_reviewreceivedat).toBe('2026-07-22T10:00:00Z');
});

test('partial failure keeps successful row identifiers and failed row retryable', async () => {
  findById.mockImplementation(async (id) => (
    id === SUGGESTION
      ? row()
      : row({ wmkf_appreviewersuggestionid: SECOND, wmkf_completedat: '2026-07-22T10:00:00Z' })
  ));
  const result = await transitionReviewersTerminal(args({
    suggestionIds: [SUGGESTION, SECOND],
    terminalStatus: 'released',
    releaseReason: 'sufficient_reviews_received',
    sendEmail: false,
    internalNotes: { [SUGGESTION]: 'Overdue after reminders.' },
    overrides: {
      [SUGGESTION]: { expectedNotes: '' },
      [SECOND]: { expectedNotes: '' },
    },
  }));
  expect(result.transitioned).toBe(1);
  expect(result.results).toEqual([
    {
      suggestionId: SUGGESTION,
      status: 'released_no_email_by_choice',
      terminalStatus: 'released',
      releaseReason: 'sufficient_reviews_received',
      reviewOutcome: 'not_received',
      honorariumCancelled: false,
      honorariumAlreadyWithdrawn: false,
      acceptanceJobsCancelled: 0,
    },
    { suggestionId: SECOND, status: 'completed' },
  ]);
  expect(applyStaffReviewerRelease).toHaveBeenCalledWith(
    SUGGESTION,
    {
      actingUserSystemId: 'staff-1',
      ifMatch: 'W/"7"',
      notes: 'Overdue after reminders.',
      cancelHonorarium: null,
    },
  );
  expect(applyStaffReviewerWithdrawal).not.toHaveBeenCalled();
  expect(cancelReviewerAcceptanceJobsForSuggestion).toHaveBeenCalledWith(
    SUGGESTION,
    'program_director_released_reviewer_sufficient_reviews',
  );
});

test.each([
  ['missing reviewed override', {}, { overrides: {} }, 'invalid_override'],
  ['changed internal notes', { wmkf_notes: 'Changed on server' }, {}, 'notes_changed'],
  ['non-string internal note', {}, { internalNotes: { [SUGGESTION]: { text: 'invalid' } } }, 'invalid_note'],
  ['oversized internal note', {}, { internalNotes: { [SUGGESTION]: 'x'.repeat(2001) } }, 'invalid_note'],
  ['changed sender identity', {}, {
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '', subject: 'Thank you', bodyText: 'Thank you.',
        to: 'reviewer@example.org', from: 'pd@example.org', senderId: 'pd-2',
      },
    },
  }, 'sender_changed'],
  ['changed sender address', {}, {
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '', subject: 'Thank you', bodyText: 'Thank you.',
        to: 'reviewer@example.org', from: 'other-pd@example.org', senderId: 'pd-1',
      },
    },
  }, 'sender_changed'],
  ['changed recipient', {}, {
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '', subject: 'Thank you', bodyText: 'Thank you.',
        to: 'other@example.org', from: 'pd@example.org', senderId: 'pd-1',
      },
    },
  }, 'recipient_changed'],
  ['blank subject', {}, {
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '', subject: ' ', bodyText: 'Thank you.',
        to: 'reviewer@example.org', from: 'pd@example.org', senderId: 'pd-1',
      },
    },
  }, 'invalid_override'],
  ['blank body', {}, {
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '', subject: 'Thank you', bodyText: ' ',
        to: 'reviewer@example.org', from: 'pd@example.org', senderId: 'pd-1',
      },
    },
  }, 'invalid_override'],
])('release fails closed for %s', async (_label, rowOverrides, argumentOverrides, expectedStatus) => {
  findById.mockResolvedValue(row(rowOverrides));

  const result = await transitionReviewersTerminal(acceptedReleaseArgs(argumentOverrides));

  expect(result.results).toEqual([{ suggestionId: SUGGESTION, status: expectedStatus }]);
  expect(applyStaffReviewerRelease).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('release with sendEmail true rejects a fresh reviewer record with no email before writing', async () => {
  getPotentialReviewerById.mockResolvedValue({
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: null,
  });

  const result = await transitionReviewersTerminal(acceptedReleaseArgs({
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '',
        subject: 'Thank you',
        bodyText: 'Thank you.',
        to: '',
        from: 'pd@example.org',
        senderId: 'pd-1',
      },
    },
  }));

  expect(result.results).toEqual([{ suggestionId: SUGGESTION, status: 'recipient_changed' }]);
  expect(applyStaffReviewerRelease).not.toHaveBeenCalled();
  expect(createAndSendEmail).not.toHaveBeenCalled();
});

test('release atomically withdraws an open unpaid honorarium and sends reviewed copy', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: honorariumId,
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: false,
    akoya_paid: 0,
    _etag: 'W/"12"',
  });

  const result = await transitionReviewersTerminal(args({
    terminalStatus: 'released',
    releaseReason: 'sufficient_reviews_received',
    sendEmail: true,
    internalNotes: { [SUGGESTION]: 'Overdue after reminders.' },
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '',
        subject: 'Thank you',
        bodyText: 'Thank you for your willingness to help.',
        to: 'reviewer@example.org',
        from: 'pd@example.org',
        senderId: 'pd-1',
      },
    },
  }));

  expect(applyStaffReviewerRelease).toHaveBeenCalledWith(SUGGESTION, expect.objectContaining({
    cancelHonorarium: { id: honorariumId, ifMatch: 'W/"12"' },
  }));
  expect(createAndSendEmail).toHaveBeenCalledWith(expect.objectContaining({
    subject: 'Thank you',
    to: 'reviewer@example.org',
    actingUserSystemId: 'pd-1',
  }));
  expect(result.results[0]).toMatchObject({
    status: 'released_emailed',
    honorariumCancelled: true,
    reviewOutcome: 'not_received',
  });
});

test('authorized honorarium fails closed before the reviewer transition', async () => {
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: '44444444-4444-4444-8444-444444444444' }));
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: '44444444-4444-4444-8444-444444444444',
    akoya_requeststatus: 'Pending',
    wmkf_authorizationtoremitpaymentflag: true,
    akoya_paid: 0,
    _etag: 'W/"12"',
  });
  const result = await transitionReviewersTerminal(args({
    terminalStatus: 'released',
    releaseReason: 'sufficient_reviews_received',
    sendEmail: false,
    overrides: { [SUGGESTION]: { expectedNotes: '' } },
  }));
  expect(result.results).toEqual([{ suggestionId: SUGGESTION, status: 'honorarium_authorized' }]);
  expect(applyStaffReviewerRelease).not.toHaveBeenCalled();
});

test('release fails closed when the linked honorarium cannot be reread', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockRejectedValue(new Error('Dataverse unavailable'));

  const result = await transitionReviewersTerminal(acceptedReleaseArgs({ sendEmail: false }));

  expect(result.results).toEqual([{
    suggestionId: SUGGESTION,
    status: 'honorarium_read_failed',
  }]);
  expect(applyStaffReviewerRelease).not.toHaveBeenCalled();
});

test('release preserves an already-withdrawn linked honorarium', async () => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockResolvedValue({
    akoya_requestid: honorariumId,
    akoya_requeststatus: 'Withdrawn',
    wmkf_authorizationtoremitpaymentflag: false,
    akoya_paid: 0,
    _etag: 'W/"12"',
  });

  const result = await transitionReviewersTerminal(acceptedReleaseArgs({ sendEmail: false }));

  expect(applyStaffReviewerRelease).toHaveBeenCalledWith(SUGGESTION, expect.objectContaining({
    cancelHonorarium: null,
  }));
  expect(result.results[0]).toMatchObject({
    status: 'released_no_email_by_choice',
    honorariumCancelled: false,
    honorariumAlreadyWithdrawn: true,
  });
});

test.each([
  ['paid', { akoya_requeststatus: 'Pending', wmkf_authorizationtoremitpaymentflag: false, akoya_paid: 1, _etag: 'W/"12"' }, 'honorarium_paid'],
  ['not open', { akoya_requeststatus: 'Approved', wmkf_authorizationtoremitpaymentflag: false, akoya_paid: 0, _etag: 'W/"12"' }, 'honorarium_not_open'],
  ['missing ETag', { akoya_requeststatus: 'Pending', wmkf_authorizationtoremitpaymentflag: false, akoya_paid: 0, _etag: null }, 'honorarium_missing_etag'],
])('release fails closed when the honorarium is %s', async (_label, honorarium, expectedStatus) => {
  const honorariumId = '44444444-4444-4444-8444-444444444444';
  findById.mockResolvedValue(row({ _wmkf_honorariumrequest_value: honorariumId }));
  getHonorariumCancellationState.mockResolvedValue({ akoya_requestid: honorariumId, ...honorarium });

  const result = await transitionReviewersTerminal(args({
    terminalStatus: 'released',
    releaseReason: 'sufficient_reviews_received',
    sendEmail: false,
    overrides: { [SUGGESTION]: { expectedNotes: '' } },
  }));

  expect(result.results).toEqual([{ suggestionId: SUGGESTION, status: expectedStatus }]);
  expect(applyStaffReviewerRelease).not.toHaveBeenCalled();
});

test.each([
  ['provably failed', Object.assign(new Error('create failed'), { dispatched: false }), 'released_email_failed'],
  ['uncertain', new Error('send response lost'), 'released_email_unconfirmed'],
])('release reports a %s email outcome after the state commit', async (_label, emailError, expectedStatus) => {
  createAndSendEmail.mockRejectedValue(emailError);

  const result = await transitionReviewersTerminal(args({
    terminalStatus: 'released',
    releaseReason: 'sufficient_reviews_received',
    sendEmail: true,
    overrides: {
      [SUGGESTION]: {
        expectedNotes: '',
        subject: 'Thank you',
        bodyText: 'Thank you.',
        to: 'reviewer@example.org',
        from: 'pd@example.org',
        senderId: 'pd-1',
      },
    },
  }));

  expect(applyStaffReviewerRelease).toHaveBeenCalledTimes(1);
  expect(result.transitioned).toBe(1);
  expect(result.results[0].status).toBe(expectedStatus);
});
