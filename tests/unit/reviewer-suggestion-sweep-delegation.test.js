/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/reviewer-suggestion-sweep.js
 * (Reviewer Lifecycle Stage 3E correction round, Codex round 1 medium).
 *
 * Mocks the EXTRACTED module (`reviewer-engagement/expire-invitation`)
 * wholesale (`isPastCutoff` is unmocked — it lives in lib/utils/past-cutoff.js — since the sweep's
 * own discovery pass still calls it) and drives the legacy caller
 * (`sweepStaleInvites`) to pin: it calls `expireInvitation` once per
 * eligible row with exactly `{ suggestion, cutoffIso, nowIso,
 * actingUserSystemId }`, and maps `{outcome:'swept'}` -> swept++,
 * `{outcome:'skipped'}` -> skipped++, a thrown 412 or record-not-found ->
 * skipped++ with no `errors` entry, and any other throw -> one `errors[]`
 * entry. This must go red if `sweepStaleInvites` reimplements the per-row
 * body inline while keeping the import.
 */

const actualExpireInvitation = jest.requireActual('../../lib/services/reviewer-engagement/expire-invitation.js');
const expireInvitation = jest.fn();
jest.mock('../../lib/services/reviewer-engagement/expire-invitation.js', () => ({
  __esModule: true,
  expireInvitation: (...a) => expireInvitation(...a),
}));

const queryAllSuggestions = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion.js', () => ({
  notExcludedFilter: () => 'notExcludedFilterStub',
  queryAllSuggestions: (...a) => queryAllSuggestions(...a),
}));

const queryRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  queryRequests: (...a) => queryRequests(...a),
}));

const { sweepStaleInvites } = require('../../lib/services/reviewer-suggestion-sweep.js');

const NOW = new Date('2026-09-06T12:00:00.000Z');
const PAST_MEETING_DATE = '2020-02-01';

function candidateRow(id, requestId) {
  return {
    wmkf_appreviewersuggestionid: id,
    wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
    _wmkf_request_value: requestId,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers().setSystemTime(NOW);
  // Sanity: isPastCutoff now lives in lib/utils/past-cutoff.js (unmocked), so
  // the sweep's own discovery-pass filtering runs the real helper.
  expect(typeof actualExpireInvitation.expireInvitation).toBe('function');
});
afterEach(() => {
  jest.useRealTimers();
});

describe('sweepStaleInvites delegates the per-row expire body to expireInvitation', () => {
  test('calls expireInvitation once per eligible row and maps every outcome/error shape', async () => {
    const rows = [
      candidateRow('A', 'R1'), // swept
      candidateRow('B', 'R2'), // skipped
      candidateRow('C', 'R3'), // 412 -> skipped, no errors entry
      candidateRow('D', 'R4'), // not-found -> skipped, no errors entry
      candidateRow('E', 'R5'), // other throw -> errors[]
    ];
    queryAllSuggestions.mockResolvedValue({ records: rows });
    queryRequests.mockResolvedValue({
      records: ['R1', 'R2', 'R3', 'R4', 'R5'].map((id) => ({
        akoya_requestid: id,
        wmkf_meetingdate: PAST_MEETING_DATE,
      })),
    });

    const notFound = Object.assign(new Error('not found'), {
      serviceName: 'dataverse',
      status: 404,
      dataverseCode: '0x80040217',
    });
    const conflict = Object.assign(new Error('conflict'), { status: 412 });
    const genericError = new Error('boom');

    expireInvitation.mockImplementation(async ({ suggestion }) => {
      switch (suggestion.wmkf_appreviewersuggestionid) {
        case 'A': return { outcome: 'swept' };
        case 'B': return { outcome: 'skipped' };
        case 'C': throw conflict;
        case 'D': throw notFound;
        case 'E': throw genericError;
        default: throw new Error(`unexpected row ${suggestion.wmkf_appreviewersuggestionid}`);
      }
    });

    const result = await sweepStaleInvites({ actingUserSystemId: 'staff-1' });

    expect(expireInvitation).toHaveBeenCalledTimes(5);
    const expectedCommonArgs = {
      cutoffIso: NOW.toISOString(),
      nowIso: NOW.toISOString(),
      actingUserSystemId: 'staff-1',
    };
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      expect(expireInvitation).toHaveBeenCalledWith({
        suggestion: rows.find((r) => r.wmkf_appreviewersuggestionid === id),
        ...expectedCommonArgs,
      });
    }

    expect(result.swept).toBe(1);
    expect(result.skipped).toBe(3); // B (explicit skip), C (412), D (not-found)
    expect(result.errors).toEqual([{ id: 'E', message: 'boom' }]);
    expect(result.scanned).toBe(5);
    expect(result.eligible).toBe(5);
  });
});
