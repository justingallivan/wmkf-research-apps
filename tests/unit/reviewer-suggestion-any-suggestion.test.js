/**
 * @jest-environment node
 *
 * reviewer-suggestion adapter — `existsAnySuggestionForRequests` (J27 read
 * model, plan C1). Its own query: selected or not, not-excluded only, never
 * the rollup's selected/declined filter, chunked at 25.
 */
const queryAllRecords = jest.fn();
jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: { queryAllRecords: (...a) => queryAllRecords(...a) },
}));

import { existsAnySuggestionForRequests, findForRollup } from '../../lib/dataverse/adapters/reviewer-suggestion';

const id = (n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;

beforeEach(() => { jest.clearAllMocks(); queryAllRecords.mockResolvedValue({ records: [] }); });

test('filters on request and the not-excluded disposition only, selecting the request lookup', async () => {
  queryAllRecords.mockResolvedValue({ records: [{ _wmkf_request_value: id(1).toUpperCase() }, { _wmkf_request_value: null }] });
  const found = await existsAnySuggestionForRequests([id(1), id(2), 'not-a-guid']);
  expect(queryAllRecords).toHaveBeenCalledTimes(1);
  const [entitySet, options] = queryAllRecords.mock.calls[0];
  expect(entitySet).toBe('wmkf_appreviewersuggestions');
  expect(options.select).toBe('_wmkf_request_value');
  expect(options.filter).toBe(`(_wmkf_request_value eq ${id(1)} or _wmkf_request_value eq ${id(2)}) and (wmkf_applicantdisposition eq null or wmkf_applicantdisposition ne 100000001)`);
  expect(options.filter).not.toContain('wmkf_selected');
  expect([...found]).toEqual([id(1)]);
});

test('chunks at 25 and skips the query for an empty list', async () => {
  await existsAnySuggestionForRequests(Array.from({ length: 51 }, (_, i) => id(i + 1)));
  expect(queryAllRecords).toHaveBeenCalledTimes(3);
  queryAllRecords.mockClear();
  expect(await existsAnySuggestionForRequests([])).toEqual(new Set());
  expect(queryAllRecords).not.toHaveBeenCalled();
});

test('a capped or paged batch is refused rather than read as absence', async () => {
  queryAllRecords.mockResolvedValue({ records: [{ _wmkf_request_value: id(1) }], capped: true });
  await expect(existsAnySuggestionForRequests([id(1), id(2)])).rejects.toThrow('incomplete');
  queryAllRecords.mockResolvedValue({ records: [], hasMore: true });
  await expect(existsAnySuggestionForRequests([id(1)])).rejects.toThrow('incomplete');
});

test('the rollup query is untouched: it still restricts to selected or declined rows', async () => {
  await findForRollup(`_wmkf_request_value eq ${id(1)}`);
  expect(queryAllRecords.mock.calls[0][1].filter).toContain('wmkf_selected eq true or wmkf_declined eq true');
});

test('with concurrency, chunks run together and a capped chunk still refuses the whole read', async () => {
  let inFlight = 0;
  let peak = 0;
  queryAllRecords.mockImplementation(async (_set, options) => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    const first = /eq ([0-9a-f-]+)/.exec(options.filter)[1];
    return { records: [{ _wmkf_request_value: first }] };
  });
  const ids = Array.from({ length: 100 }, (_, i) => id(i + 1));
  const found = await existsAnySuggestionForRequests(ids, { concurrency: 4 });
  expect(queryAllRecords).toHaveBeenCalledTimes(4);
  expect(peak).toBe(4);
  expect([...found]).toEqual([id(1), id(26), id(51), id(76)]);

  queryAllRecords.mockReset().mockResolvedValueOnce({ records: [] }).mockResolvedValueOnce({ records: [], capped: true }).mockResolvedValue({ records: [] });
  await expect(existsAnySuggestionForRequests(ids, { concurrency: 4 })).rejects.toThrow('incomplete');
});

test('without the option the chunks run one at a time', async () => {
  let inFlight = 0;
  let peak = 0;
  queryAllRecords.mockImplementation(async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1;
    return { records: [] };
  });
  await existsAnySuggestionForRequests(Array.from({ length: 75 }, (_, i) => id(i + 1)));
  expect(peak).toBe(1);
});
