/** @jest-environment node */
const queryAllRecords = jest.fn();
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { queryAllRecords: (...a) => queryAllRecords(...a) },
}));

import { findSummariesByRequests } from '../../lib/dataverse/adapters/site-visit.js';

const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const ids = Array.from({ length: 75 }, (_, i) => id(i + 1));

function tracking() {
  const seen = { peak: 0, inFlight: 0, call: 0 };
  queryAllRecords.mockImplementation(async () => {
    const n = seen.call++;
    seen.inFlight += 1; seen.peak = Math.max(seen.peak, seen.inFlight);
    await new Promise((resolve) => setTimeout(resolve, (3 - n) * 2));
    seen.inFlight -= 1;
    return { records: [{ chunk: n }], totalCount: 1, capped: n === 1 };
  });
  return seen;
}

beforeEach(() => queryAllRecords.mockReset());

test('without the option the three chunks run one at a time', async () => {
  const seen = tracking();
  const result = await findSummariesByRequests(ids);
  expect(seen.peak).toBe(1);
  expect(result.records.map((row) => row.chunk)).toEqual([0, 1, 2]);
});

test('with concurrency the chunks run together, in chunk order, keeping the capped flag', async () => {
  const seen = tracking();
  const result = await findSummariesByRequests(ids, { concurrency: 4 });
  expect(seen.peak).toBe(3);
  expect(result.records.map((row) => row.chunk)).toEqual([0, 1, 2]);
  expect(result).toMatchObject({ totalCount: 3, capped: true, hasMore: true });
});
