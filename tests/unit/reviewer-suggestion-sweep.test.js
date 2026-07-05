/**
 * @jest-environment node
 *
 * Tests-before coverage (docs/DATA_ACCESS_LAYER_MIGRATION_PLAN.md Stages 3-6)
 * for lib/services/reviewer-suggestion-sweep.js ahead of converting its raw
 * DynamicsService calls to the reviewer-suggestion/grant-request adapters.
 * Captures CURRENT behavior: golden path (sweeps an eligible stale invite past
 * the meeting-date + grace cutoff) and one failure path (dry run makes no
 * writes).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { sweepStaleInvites } from '../../lib/services/reviewer-suggestion-sweep.js';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('sweepStaleInvites', () => {
  it('golden path: sweeps a stale invite whose request meeting date is past the cutoff', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
        _wmkf_request_value: REQUEST_ID,
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_responsetype: null,
      }],
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ akoya_requestid: REQUEST_ID, wmkf_meetingdate: '2020-02-01' }],
    });
    const updateSpy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    const result = await sweepStaleInvites({ actingUserSystemId: 'staff-1' });

    expect(result).toMatchObject({ scanned: 1, eligible: 1, swept: 1, skipped: 0, errors: [] });
    expect(updateSpy).toHaveBeenCalledWith(
      'wmkf_appreviewersuggestions',
      SUGGESTION_ID,
      expect.objectContaining({ wmkf_responsetype: 100000002 }),
      { actingUserSystemId: 'staff-1' },
    );
  });

  it('chunks distinct request ids at 25 per OR-filter query: first call gets ids 0-24 in order, second gets id 25', async () => {
    const requestIds = Array.from({ length: 26 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: requestIds.map((rid, i) => ({
        wmkf_appreviewersuggestionid: `s${i}`,
        wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
        _wmkf_request_value: rid,
        wmkf_accepted: false,
        wmkf_declined: false,
        wmkf_responsetype: null,
      })),
    });
    const qSpy = jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({ records: [] });

    await sweepStaleInvites({ actingUserSystemId: 'staff-1' });

    expect(qSpy).toHaveBeenCalledTimes(2);
    const firstFilter = qSpy.mock.calls[0][1].filter;
    const secondFilter = qSpy.mock.calls[1][1].filter;
    expect(firstFilter.split(' or ')).toEqual(
      requestIds.slice(0, 25).map((id) => `akoya_requestid eq ${id}`),
    );
    expect(secondFilter.split(' or ')).toEqual(
      requestIds.slice(25).map((id) => `akoya_requestid eq ${id}`),
    );
  });

  it('dry run: identifies eligible rows but writes nothing', async () => {
    jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [{
        wmkf_appreviewersuggestionid: SUGGESTION_ID,
        wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
        _wmkf_request_value: REQUEST_ID,
      }],
    });
    jest.spyOn(DynamicsService, 'queryRecords').mockResolvedValue({
      records: [{ akoya_requestid: REQUEST_ID, wmkf_meetingdate: '2020-02-01' }],
    });
    const updateSpy = jest.spyOn(DynamicsService, 'updateRecord').mockResolvedValue({});

    const result = await sweepStaleInvites({ dryRun: true });

    expect(result).toMatchObject({ eligible: 1, swept: 0, dryRun: true });
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
