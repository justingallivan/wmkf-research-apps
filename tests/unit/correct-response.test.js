/**
 * @jest-environment node
 *
 * Direct unit tests for lib/services/reviewer-engagement/correct-response.js
 * (Reviewer Lifecycle Stage 3D). Exercises the implementation directly
 * (adapter/ensureToken mocked), separate from
 * tests/unit/my-candidates-service.test.js's characterization of the same
 * contract through patchMyCandidates.
 */

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  updateLifecycle: jest.fn(),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  __esModule: true,
  ensureToken: jest.fn(),
  buildExternalUrl: jest.fn(),
}));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { ensureToken } = require('../../lib/external/token-lifecycle');
const { correctResponse } = require('../../lib/services/reviewer-engagement/correct-response');

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

function correct(lifecycle, args = {}) {
  return correctResponse({
    suggestionId: SUGGESTION_ID,
    lifecycle,
    authorizedRequestId: REQUEST_ID,
    actingUserSystemId: SYS,
    ...args,
  });
}

beforeEach(() => {
  suggestionAdapter.findById.mockReset().mockResolvedValue(source());
  suggestionAdapter.updateLifecycle.mockReset().mockResolvedValue(undefined);
  ensureToken.mockReset().mockResolvedValue(undefined);
});

describe('correctResponse', () => {
  test.each([null, undefined, ''])('missing authorized request → 400 correction_missing_authorized_request (%s)', async (authorizedRequestId) => {
    await expect(correct({ invited: true }, { authorizedRequestId }))
      .rejects.toMatchObject({ httpStatus: 400, body: { code: 'correction_missing_authorized_request' } });
    expect(suggestionAdapter.findById).not.toHaveBeenCalled();
  });

  test('row not found → 404 correction_not_found', async () => {
    suggestionAdapter.findById.mockResolvedValueOnce(null);
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 404, body: { code: 'correction_not_found' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('applicant-excluded row → 409 correction_excluded', async () => {
    suggestionAdapter.findById.mockResolvedValue(source({ wmkf_applicantdisposition: 100000001 }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_excluded' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('request moved → 409 correction_request_changed', async () => {
    suggestionAdapter.findById.mockResolvedValue(source({ _wmkf_request_value: '22222222-2222-2222-2222-222222222222' }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_request_changed' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('closed engagement row → 409 correction_closed', async () => {
    suggestionAdapter.findById.mockResolvedValue(source({ wmkf_reviewstatus: 100000004 }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_closed' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('unverifiable source state → 409 correction_state_unavailable', async () => {
    suggestionAdapter.findById.mockResolvedValue(source({ wmkf_reviewstatus: '100000000' }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_state_unavailable' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test.each([undefined, null, '', '*', 'W/""', ' W/"1"', 'unquoted', 123])('missing/malformed _etag → 409 correction_version_unavailable (%s)', async (_etag) => {
    suggestionAdapter.findById.mockResolvedValue(source({ _etag }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_version_unavailable' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('adapter 412 → 409 correction_conflict', async () => {
    suggestionAdapter.updateLifecycle.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
    await expect(correct({ invited: true }))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_conflict' } });
    expect(ensureToken).not.toHaveBeenCalled();
  });

  test('happy path calls updateLifecycle with the current ETag', async () => {
    await correct({ accepted: true, invited: true });
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID,
      { accepted: true, invited: true },
      { actingUserSystemId: SYS, ifMatch: 'W/"correction-1"' },
    );
  });

  test('accepted: true mints a token after the lifecycle write commits', async () => {
    await correct({ accepted: true });
    expect(ensureToken).toHaveBeenCalledWith(SUGGESTION_ID, { actingUserSystemId: SYS });
  });

  test('a throwing ensureToken does not fail the call', async () => {
    ensureToken.mockRejectedValueOnce(new Error('mint unavailable'));
    await expect(correct({ accepted: true })).resolves.toBeUndefined();
  });

  test.each([undefined, false])('accepted %s never calls ensureToken', async (accepted) => {
    await correct({ accepted, invited: true });
    expect(ensureToken).not.toHaveBeenCalled();
  });

  test('the token follow-up runs only after updateLifecycle resolves', async () => {
    const order = [];
    let releaseUpdate;
    suggestionAdapter.updateLifecycle.mockImplementationOnce(() => new Promise((resolve) => {
      releaseUpdate = () => { order.push('updateLifecycle'); resolve(undefined); };
    }));
    ensureToken.mockImplementationOnce(async () => { order.push('ensureToken'); });

    const pending = correct({ accepted: true });
    // Give any wrongly-ordered microtask a chance to run before releasing the write.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual([]);
    expect(ensureToken).not.toHaveBeenCalled();

    releaseUpdate();
    await pending;
    expect(order).toEqual(['updateLifecycle', 'ensureToken']);
  });
});
