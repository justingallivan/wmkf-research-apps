/**
 * @jest-environment node
 *
 * reviewer-suggestion.aggregateReviewHistory — cross-request "how often / last
 * reviewed" derivation. Counts received reviews per person (wmkf_reviewreceivedat),
 * batched + filtered to received-only.
 */

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { aggregateReviewHistory } from '../../lib/dataverse/adapters/reviewer-suggestion.js';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

afterEach(() => jest.restoreAllMocks());

describe('aggregateReviewHistory', () => {
  it('counts received reviews per person and keeps the latest date', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({
      records: [
        { _wmkf_potentialreviewer_value: A, wmkf_reviewreceivedat: '2024-03-01T00:00:00Z' },
        { _wmkf_potentialreviewer_value: A, wmkf_reviewreceivedat: '2025-09-15T00:00:00Z' },
        { _wmkf_potentialreviewer_value: B, wmkf_reviewreceivedat: '2025-01-10T00:00:00Z' },
      ],
    });

    const out = await aggregateReviewHistory([A, B]);

    expect(out[A]).toEqual({ reviewCount: 2, lastReviewAt: '2025-09-15T00:00:00Z' });
    expect(out[B]).toEqual({ reviewCount: 1, lastReviewAt: '2025-01-10T00:00:00Z' });

    // received-only filter + the person OR-chain
    const [, opts] = spy.mock.calls[0];
    expect(opts.filter).toContain('wmkf_reviewreceivedat ne null');
    expect(opts.filter).toContain(`_wmkf_potentialreviewer_value eq ${A}`);
    expect(opts.filter).toContain(`_wmkf_potentialreviewer_value eq ${B}`);
  });

  it('returns {} for empty / no valid GUIDs without querying', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords');
    expect(await aggregateReviewHistory([])).toEqual({});
    expect(await aggregateReviewHistory(['not-a-guid'])).toEqual({});
    expect(spy).not.toHaveBeenCalled();
  });

  it('dedupes ids and drops non-GUIDs before querying', async () => {
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await aggregateReviewHistory([A, A, 'bogus']);
    const [, opts] = spy.mock.calls[0];
    const occurrences = (opts.filter.match(new RegExp(A, 'g')) || []).length;
    expect(occurrences).toBe(1);
    expect(opts.filter).not.toContain('bogus');
  });

  it('chunks ids at 25 per OR-chain call: first call gets ids 0-24 in order, second gets id 25', async () => {
    const ids = Array.from({ length: 26 }, (_, i) =>
      `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`);
    const spy = jest.spyOn(DynamicsService, 'queryAllRecords').mockResolvedValue({ records: [] });
    await aggregateReviewHistory(ids);
    expect(spy).toHaveBeenCalledTimes(2);
    const firstFilter = spy.mock.calls[0][1].filter;
    const secondFilter = spy.mock.calls[1][1].filter;
    const firstOrChain = firstFilter.slice(firstFilter.indexOf('(') + 1, firstFilter.indexOf(')'));
    const secondOrChain = secondFilter.slice(secondFilter.indexOf('(') + 1, secondFilter.indexOf(')'));
    expect(firstOrChain.split(' or ')).toEqual(
      ids.slice(0, 25).map((id) => `_wmkf_potentialreviewer_value eq ${id}`),
    );
    expect(secondOrChain.split(' or ')).toEqual(
      ids.slice(25).map((id) => `_wmkf_potentialreviewer_value eq ${id}`),
    );
  });
});
