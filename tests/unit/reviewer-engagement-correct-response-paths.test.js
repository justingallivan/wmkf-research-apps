/** @jest-environment node */

/**
 * Stage 3D: `lib/services/reviewer-finder/my-candidates-service.js` delegates
 * its per-suggestion lifecycle-correction branch to the new
 * `lib/services/reviewer-engagement/correct-response.js` module (a
 * partial-file extraction — bulk-by-request, restore, manual-invite-sent,
 * and person/researcher edits stay in the old module).
 *
 * `MyCandidatesError` lives in the neutral leaf `reviewer-engagement/errors.js`
 * (Stage 3D correction round: `correct-response.js` no longer defines the
 * class, so `my-candidates-service.js` doesn't have to import that module's
 * adapter/token-lifecycle dependencies just to get the error). Reference
 * identity (`toBe`) holds between the leaf and the old file's re-export;
 * `correct-response.js` imports the same binding internally (not
 * re-exported), proven instead by `instanceof` on an error it actually
 * throws. And `patchMyCandidates` must actually CALL the new module's
 * `correctResponse` for the lifecycle branch — not reimplement it inline —
 * so a future inlining regression goes red here, not silently.
 */

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const SYS = 'u-1';

function source(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_reviewstatus: null,
    wmkf_reviewreceivedat: null,
    wmkf_completedat: null,
    wmkf_applicantdisposition: null,
    _etag: 'W/"correction-1"',
    ...overrides,
  };
}

const updateLifecycle = jest.fn(async () => {
  throw Object.assign(new Error('precondition failed'), { status: 412 });
});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(async () => source()),
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
  MyCandidatesError: ErrorsLeafMyCandidatesError,
} = require('../../lib/services/reviewer-engagement/errors');
const {
  patchMyCandidates,
  MyCandidatesError: OldMyCandidatesError,
} = require('../../lib/services/reviewer-finder/my-candidates-service');

describe('reviewer-engagement correct-response compatibility paths', () => {
  it('exports the same MyCandidatesError class object from the neutral leaf and the old service', () => {
    // correct-response.js does not re-export the binding (it only imports it
    // internally to construct correctionError) — its identity is proven
    // below by the instanceof assertion on an error it actually throws.
    expect(OldMyCandidatesError).toBe(ErrorsLeafMyCandidatesError);
  });

  it('an error correctResponse throws directly is instanceof the errors.js class (proves the third, non-exported import path)', async () => {
    await expect(correctResponse({
      suggestionId: SUGGESTION_ID,
      lifecycle: { invited: true },
      authorizedRequestId: REQUEST_ID,
      actingUserSystemId: SYS,
    })).rejects.toBeInstanceOf(ErrorsLeafMyCandidatesError);
  });

  it('patchMyCandidates delegates the lifecycle branch to correctResponse with the exact args', async () => {
    correctResponse.mockClear();
    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, invited: true },
      actingUserSystemId: SYS,
      authorizedRequestId: REQUEST_ID,
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_conflict' } });

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
