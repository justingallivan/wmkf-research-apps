/** @jest-environment node */

/**
 * Stage 3D: `lib/services/reviewer-finder/my-candidates-service.js` delegates
 * its per-suggestion lifecycle-correction branch to the new
 * `lib/services/reviewer-engagement/correct-response.js` module (a
 * partial-file extraction — bulk-by-request, restore, manual-invite-sent,
 * and person/researcher edits stay in the old module).
 *
 * `MyCandidatesError` must resolve to the exact same class object across
 * both import paths (reference identity, `instanceof`). And
 * `patchMyCandidates` must actually CALL the new module's `correctResponse`
 * for the lifecycle branch — not reimplement it inline — so a future
 * inlining regression goes red here, not silently.
 */

const updateLifecycle = jest.fn(async () => {
  throw new Error('adapter rejected the write');
});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  updateLifecycle: (...a) => updateLifecycle(...a),
  bulkUpdateByRequest: jest.fn(),
  restore: jest.fn(),
  softDelete: jest.fn(),
}));

jest.mock('../../lib/services/reviewer-engagement/correct-response', () => {
  const actual = jest.requireActual('../../lib/services/reviewer-engagement/correct-response');
  return {
    __esModule: true,
    ...actual,
    correctResponse: jest.fn(actual.correctResponse),
  };
});

const { correctResponse } = require('../../lib/services/reviewer-engagement/correct-response');
const {
  MyCandidatesError: NewMyCandidatesError,
} = jest.requireActual('../../lib/services/reviewer-engagement/correct-response');
const {
  patchMyCandidates,
  MyCandidatesError: OldMyCandidatesError,
} = require('../../lib/services/reviewer-finder/my-candidates-service');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const SYS = 'u-1';

describe('reviewer-engagement correct-response compatibility paths', () => {
  it('exports the same MyCandidatesError class from both paths', () => {
    expect(OldMyCandidatesError).toBe(NewMyCandidatesError);
  });

  it('patchMyCandidates delegates the lifecycle branch to correctResponse with the exact args', async () => {
    correctResponse.mockClear();
    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, invited: true },
      actingUserSystemId: SYS,
      authorizedRequestId: REQUEST_ID,
    })).rejects.toThrow();

    expect(correctResponse).toHaveBeenCalledTimes(1);
    expect(correctResponse).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      lifecycle: { invited: true },
      authorizedRequestId: REQUEST_ID,
      actingUserSystemId: SYS,
    });
  });

  it('an error thrown by the new-path correctResponse is instanceof the old path\'s error class', async () => {
    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, invited: true },
      actingUserSystemId: SYS,
      authorizedRequestId: 'not-a-guid',
    })).rejects.toBeInstanceOf(OldMyCandidatesError);
  });
});
