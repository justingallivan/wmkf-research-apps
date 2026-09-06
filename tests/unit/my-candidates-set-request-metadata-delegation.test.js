/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/reviewer-finder/my-candidates-service.js
 * (Reviewer Lifecycle Stage 3K).
 *
 * Mocks the adapter's `setRequestMetadata` as its OWN jest.fn (independent
 * of `bulkUpdateByRequest`) so this suite pins the CALL SHAPE only: the
 * bulk-by-request branch calls `setRequestMetadata` exactly once, with the
 * proposal id, the whitelisted updates object, and the acting user, and
 * never calls `bulkUpdateByRequest` directly. This must go red if
 * `patchMyCandidates` reimplements the bulk write inline (or calls
 * `bulkUpdateByRequest` directly) while keeping the import.
 */

jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  getById: jest.fn(),
  findByRequestNumber: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true,
  queryAccounts: jest.fn(async () => ({ records: [] })),
}));
const setRequestMetadata = jest.fn(async () => 3);
const bulkUpdateByRequest = jest.fn(async () => 0);
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: jest.fn(async () => []),
  findRemovedByRequest: jest.fn(async () => []),
  findByPD: jest.fn(async () => ({ suggestions: [], requestById: {} })),
  aggregateReviewHistory: jest.fn(async () => ({})),
  findById: jest.fn(),
  updateLifecycle: jest.fn(async () => {}),
  restore: jest.fn(async () => {}),
  softDelete: jest.fn(async () => {}),
  bulkUpdateByRequest: (...a) => bulkUpdateByRequest(...a),
  setRequestMetadata: (...a) => setRequestMetadata(...a),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: { 100000000: 'accepted', 100000001: 'declined' },
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: jest.fn(async () => ({ records: [] })),
  getById: jest.fn(),
  update: jest.fn(),
  clearEmailForEdit: jest.fn(),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  ensureToken: jest.fn(),
  buildExternalUrl: jest.fn(),
}));
jest.mock('../../lib/services/external-token', () => ({
  hashToken: jest.fn(),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn(() => null) }));

const { patchMyCandidates, MyCandidatesError } = require('../../lib/services/reviewer-finder/my-candidates-service');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SYS = 'u-1';

beforeEach(() => {
  jest.clearAllMocks();
  setRequestMetadata.mockResolvedValue(3);
});

describe('patchMyCandidates delegates the bulk-by-request write to setRequestMetadata', () => {
  test('calls setRequestMetadata once with (proposalId, { grantCycleCode }, { actingUserSystemId }); bulkUpdateByRequest never called', async () => {
    const out = await patchMyCandidates({
      body: { proposalId: REQUEST_ID, grantCycleCode: 'J26' },
      actingUserSystemId: SYS,
    });

    expect(setRequestMetadata).toHaveBeenCalledTimes(1);
    expect(setRequestMetadata).toHaveBeenCalledWith(
      REQUEST_ID,
      { grantCycleCode: 'J26' },
      { actingUserSystemId: SYS },
    );
    expect(bulkUpdateByRequest).not.toHaveBeenCalled();
    expect(out).toEqual({
      success: true,
      message: 'Proposal updated',
      updated: { proposalId: REQUEST_ID, grantCycleCode: 'J26', suggestionsUpdated: 3 },
    });
  });

  test('rejected PI/institution fields still 400 before any adapter call', async () => {
    const err = await patchMyCandidates({
      body: { proposalId: REQUEST_ID, proposalAuthors: 'X', grantCycleCode: 'J26' },
      actingUserSystemId: SYS,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MyCandidatesError);
    expect(err.httpStatus).toBe(400);
    expect(setRequestMetadata).not.toHaveBeenCalled();
    expect(bulkUpdateByRequest).not.toHaveBeenCalled();
  });

  test('empty updates still 400 before any adapter call', async () => {
    const err = await patchMyCandidates({
      body: { proposalId: REQUEST_ID },
      actingUserSystemId: SYS,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MyCandidatesError);
    expect(err.httpStatus).toBe(400);
    expect(setRequestMetadata).not.toHaveBeenCalled();
    expect(bulkUpdateByRequest).not.toHaveBeenCalled();
  });
});
