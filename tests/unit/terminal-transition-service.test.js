/** @jest-environment node */

const findById = jest.fn();
const updateLifecycle = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
  updateLifecycle: (...args) => updateLifecycle(...args),
  REVIEW_STATUS_MAP: {
    accepted: 100000000,
    materials_sent: 100000001,
    under_review: 100000002,
  },
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
    wmkf_reviewstatus: 100000001,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
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
});

test('eligible row transitions with the ETag from the fresh read', async () => {
  const result = await transitionReviewersTerminal(args());
  expect(result).toEqual({
    ok: true,
    transitioned: 1,
    results: [{ suggestionId: SUGGESTION, status: 'transitioned', terminalStatus: 'withdrew' }],
  });
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    // The magic link is revoked in the SAME atomic ETag-guarded write that ends
    // the engagement — the portal must fail closed at the token, not rely on
    // every downstream surface re-deriving terminality.
    { reviewStatus: 'withdrew', externalTokenRevoked: true },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test('accepted row with a persisted null review status transitions', async () => {
  findById.mockResolvedValue(row({ wmkf_reviewstatus: null }));

  const result = await transitionReviewersTerminal(args());

  expect(result.transitioned).toBe(1);
  expect(result.results).toEqual([
    { suggestionId: SUGGESTION, status: 'transitioned', terminalStatus: 'withdrew' },
  ]);
  expect(updateLifecycle).toHaveBeenCalledWith(
    SUGGESTION,
    { reviewStatus: 'withdrew', externalTokenRevoked: true },
    { actingUserSystemId: 'staff-1', ifMatch: 'W/"7"' },
  );
});

test.each([
  ['pre-accept row', { wmkf_accepted: false }, 'not_accepted'],
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
});

test('race: concurrent ETag-guarded submission wins and terminal transition never overwrites it', async () => {
  const durable = row();
  findById.mockResolvedValue({ ...durable });
  updateLifecycle.mockImplementation(async (_id, _patch, options) => {
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
});
