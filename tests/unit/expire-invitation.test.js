/**
 * @jest-environment node
 *
 * Direct unit tests for lib/services/reviewer-engagement/expire-invitation.js
 * (Reviewer Lifecycle Stage 3E). expireInvitation is exercised through its
 * exported contract with mocked reviewer-suggestion and grant-request
 * adapters — the new-path implementation test the plan requires. 412 and
 * not-found propagate (the sweep's own catch owns classifying them as
 * skipped); this suite asserts only that expireInvitation does not swallow
 * them, and the existing sweep suite (tests/unit/reviewer-suggestion-sweep.test.js)
 * still shows the sweep counting them as skipped end-to-end.
 */

const getByIdWithSelect = jest.fn();
const expireInvitationResponse = jest.fn();
const isExcluded = jest.fn(() => false);
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  getByIdWithSelect: (...a) => getByIdWithSelect(...a),
  expireInvitationResponse: (...a) => expireInvitationResponse(...a),
  isExcluded: (...a) => isExcluded(...a),
}));

const queryRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryRequests: (...a) => queryRequests(...a),
}));

const { expireInvitation } = require('../../lib/services/reviewer-engagement/expire-invitation.js');
const { isPastCutoff } = require('../../lib/utils/past-cutoff.js');

const SUGGESTION_ID = 'sug-1';
const REQUEST_ID = 'req-1';
const ETAG = 'W/"fresh-1"';
const CUTOFF_ISO = '2026-06-01T00:00:00.000Z';
const NOW_ISO = '2026-09-05T12:00:00.000Z';
const OLD_MEETING_DATE = '2020-02-01';
const FUTURE_MEETING_DATE = '2030-02-01';

function suggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    ...overrides,
  };
}

function pendingRow(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_selected: true,
    wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
    _wmkf_request_value: REQUEST_ID,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_responsereceivedat: null,
    wmkf_reviewreceivedat: null,
    wmkf_reviewstatus: null,
    wmkf_completedat: null,
    wmkf_withdrawnsufficientat: null,
    wmkf_applicantdisposition: null,
    _etag: ETAG,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  isExcluded.mockReturnValue(false);
  getByIdWithSelect.mockResolvedValue(pendingRow());
  queryRequests.mockResolvedValue({
    records: [{ akoya_requestid: REQUEST_ID, wmkf_meetingdate: OLD_MEETING_DATE }],
  });
  expireInvitationResponse.mockResolvedValue({});
});

describe('isPastCutoff', () => {
  it('is true for a meeting date before the cutoff', () => {
    expect(isPastCutoff(OLD_MEETING_DATE, CUTOFF_ISO)).toBe(true);
  });
  it('is false for a meeting date after the cutoff', () => {
    expect(isPastCutoff(FUTURE_MEETING_DATE, CUTOFF_ISO)).toBe(false);
  });
  it('is false for a missing meeting date', () => {
    expect(isPastCutoff(null, CUTOFF_ISO)).toBe(false);
  });
});

describe('expireInvitation', () => {
  it('skips when the fresh row is no longer a pending invitation', async () => {
    getByIdWithSelect.mockResolvedValue(pendingRow({ wmkf_reviewstatus: 100000002 }));
    const result = await expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    });
    expect(result).toEqual({ outcome: 'skipped' });
    expect(expireInvitationResponse).not.toHaveBeenCalled();
  });

  it('skips on a request-binding mismatch between discovery and the fresh read', async () => {
    getByIdWithSelect.mockResolvedValue(pendingRow({ _wmkf_request_value: 'different-request' }));
    const result = await expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    });
    expect(result).toEqual({ outcome: 'skipped' });
    expect(expireInvitationResponse).not.toHaveBeenCalled();
  });

  it.each([undefined, null, '', '  ', 'no-quotes', '*'])(
    'skips for a missing or malformed _etag (%p)',
    async (etag) => {
      getByIdWithSelect.mockResolvedValue(pendingRow({ _etag: etag }));
      const result = await expireInvitation({
        suggestion: suggestion(),
        cutoffIso: CUTOFF_ISO,
        nowIso: NOW_ISO,
        actingUserSystemId: 'staff-1',
      });
      expect(result).toEqual({ outcome: 'skipped' });
      expect(expireInvitationResponse).not.toHaveBeenCalled();
    },
  );

  it('skips when the revalidated parent meeting date is not past cutoff', async () => {
    queryRequests.mockResolvedValue({
      records: [{ akoya_requestid: REQUEST_ID, wmkf_meetingdate: FUTURE_MEETING_DATE }],
    });
    const result = await expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    });
    expect(result).toEqual({ outcome: 'skipped' });
    expect(expireInvitationResponse).not.toHaveBeenCalled();
  });

  it('sweeps: calls expireInvitationResponse with the suggestion id, nowIso, and options', async () => {
    const result = await expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    });
    expect(result).toEqual({ outcome: 'swept' });
    // Stage 7 moved the no_response/nowIso payload construction into the
    // adapter op itself (expireInvitationResponse); this suite pins only the
    // call shape the service makes, not the payload fields, which are
    // covered by the op's own suite
    // (tests/unit/reviewer-suggestion-receipt-ops.test.js).
    expect(expireInvitationResponse).toHaveBeenCalledWith(
      SUGGESTION_ID,
      NOW_ISO,
      { actingUserSystemId: 'staff-1', ifMatch: ETAG },
    );
  });

  it('propagates a 412 from expireInvitationResponse (does not classify it as skipped)', async () => {
    const conflict = Object.assign(new Error('conflict'), { status: 412 });
    expireInvitationResponse.mockRejectedValue(conflict);
    await expect(expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    })).rejects.toBe(conflict);
  });

  it('propagates a not-found from the fresh read (does not classify it as skipped)', async () => {
    const notFound = Object.assign(new Error('not found'), { status: 404 });
    getByIdWithSelect.mockRejectedValue(notFound);
    await expect(expireInvitation({
      suggestion: suggestion(),
      cutoffIso: CUTOFF_ISO,
      nowIso: NOW_ISO,
      actingUserSystemId: 'staff-1',
    })).rejects.toBe(notFound);
  });
});
