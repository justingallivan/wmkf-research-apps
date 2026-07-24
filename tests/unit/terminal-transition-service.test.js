/** @jest-environment node */

const findById = jest.fn();
const updateLifecycle = jest.fn();
const applyStaffReviewerWithdrawal = jest.fn();
const cancelReviewerAcceptanceJobsForSuggestion = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  updateLifecycle: (...args) => updateLifecycle(...args),
  applyStaffReviewerWithdrawal: (...args) => applyStaffReviewerWithdrawal(...args),
  REVIEW_STATUS_MAP: {
    accepted: 100000000,
    materials_sent: 100000001,
    under_review: 100000002,
  },
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  cancelReviewerAcceptanceJobsForSuggestion: (...args) =>
    cancelReviewerAcceptanceJobsForSuggestion(...args),
}));

const { transitionReviewersTerminal } = require('../../lib/services/review-manager/terminal-transition-service');

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

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue(row());
  updateLifecycle.mockResolvedValue(undefined);
  applyStaffReviewerWithdrawal.mockResolvedValue(undefined);
  cancelReviewerAcceptanceJobsForSuggestion.mockResolvedValue([]);
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
  const result = await transitionReviewersTerminal(args({ suggestionIds: [SUGGESTION, SECOND], terminalStatus: 'released' }));
  expect(result.transitioned).toBe(1);
  expect(result.results).toEqual([
    { suggestionId: SUGGESTION, status: 'transitioned', terminalStatus: 'released' },
    { suggestionId: SECOND, status: 'completed' },
  ]);
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { reviewStatus: 'released', externalTokenRevoked: true },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
  expect(applyStaffReviewerWithdrawal).not.toHaveBeenCalled();
  expect(cancelReviewerAcceptanceJobsForSuggestion).not.toHaveBeenCalled();
});
