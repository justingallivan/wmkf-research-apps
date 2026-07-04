/**
 * @jest-environment node
 *
 * Characterization coverage for fetchReviewerRollup (lib/services/reviewer-rollup.js)
 * — golden-path DTO shape (per-request counts) and one failure/empty path — written
 * BEFORE converting its raw DynamicsService.queryAllRecords call to the
 * reviewer-suggestion adapter (data-access-layer migration, Stage 3-6 conversion).
 */
import { jest } from '@jest/globals';
import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { fetchReviewerRollup, emptyCounts } from '../../lib/services/reviewer-rollup.js';
import { RESPONSE_TYPE_MAP } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const REQUEST_A = '11111111-1111-4111-8111-111111111111';
const REQUEST_B = '22222222-2222-4222-8222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('fetchReviewerRollup (characterization)', () => {
  test('returns {} without calling Dataverse when requestIds is empty', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords');
    const out = await fetchReviewerRollup([]);
    expect(out).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  test('golden path: aggregates counts per request from the queried rows', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_request_value: REQUEST_A, wmkf_invited: true, wmkf_accepted: true, wmkf_declined: false, wmkf_emailsentat: '2026-01-01', wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_reviewstatus: 100000004 },
        { _wmkf_request_value: REQUEST_A, wmkf_invited: true, wmkf_accepted: false, wmkf_declined: true, wmkf_emailsentat: '2026-01-01', wmkf_responsetype: RESPONSE_TYPE_MAP.declined, wmkf_reviewstatus: null },
        { _wmkf_request_value: REQUEST_B, wmkf_invited: false, wmkf_accepted: false, wmkf_declined: false, wmkf_emailsentat: null, wmkf_responsetype: null, wmkf_reviewstatus: null },
      ],
    });

    const out = await fetchReviewerRollup([REQUEST_A, REQUEST_B]);

    expect(out[REQUEST_A]).toEqual({ candidates: 2, invited: 2, accepted: 1, declined: 1, held: 0, completed: 1 });
    expect(out[REQUEST_B]).toEqual({ ...emptyCounts(), candidates: 1 });

    // Byte-mirror guard: entity set, select list, and filter shape (OR-chain +
    // selected-only + not-excluded) must survive the adapter conversion unchanged.
    expect(spy).toHaveBeenCalledTimes(1);
    const [entitySet, opts] = spy.mock.calls[0];
    expect(entitySet).toBe('wmkf_appreviewersuggestions');
    expect(opts.select).toBe('_wmkf_request_value,wmkf_invited,wmkf_accepted,wmkf_declined,wmkf_emailsentat,wmkf_responsetype,wmkf_reviewstatus');
    expect(opts.filter).toContain(`_wmkf_request_value eq ${REQUEST_A}`);
    expect(opts.filter).toContain(`_wmkf_request_value eq ${REQUEST_B}`);
    expect(opts.filter).toContain('wmkf_selected eq true');
  });

  test('chunks requestIds at 25 per OR-chain call', async () => {
    const ids = Array.from({ length: 30 }, (_, i) => `3333333${i.toString().padStart(1, '0')}-0000-4000-8000-000000000000`);
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await fetchReviewerRollup(ids);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
