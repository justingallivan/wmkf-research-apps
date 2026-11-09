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

test('the rollup query is untouched: it still restricts to selected or declined rows', async () => {
  await findForRollup(`_wmkf_request_value eq ${id(1)}`);
  expect(queryAllRecords.mock.calls[0][1].filter).toContain('wmkf_selected eq true or wmkf_declined eq true');
});
