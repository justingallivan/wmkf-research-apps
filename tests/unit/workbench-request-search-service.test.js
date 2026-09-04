/**
 * @jest-environment node
 */

const searchRequests = jest.fn();
const findByIds = jest.fn();
const queryRequests = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  searchRequests: (...args) => searchRequests(...args),
  findByIds: (...args) => findByIds(...args),
  queryRequests: (...args) => queryRequests(...args),
}));

const fetchXmlAll = jest.fn();
jest.mock('../../lib/services/dataverse-export/fetch-client.js', () => ({
  fetchXmlAll: (...args) => fetchXmlAll(...args),
}));

import {
  loadRequestSearchOptions,
  searchWorkbenchRequests,
  REQUEST_SEARCH_MAX_RESULTS,
  REQUEST_SEARCH_OPTIONS_FETCH,
  REQUEST_SEARCH_ORDER,
  REQUEST_SEARCH_SELECT,
} from '../../lib/services/workbench/request-search-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const requestRow = (id, over = {}) => ({
  akoya_requestid: id,
  akoya_requestnum: `100${id.slice(-4)}`,
  akoya_title: `Title ${id}`,
  akoya_fiscalyear: 'December 2026',
  wmkf_meetingdate: '2026-12-10',
  akoya_requeststatus: 'Phase II Pending',
  wmkf_organizationname: 'Example University',
  _wmkf_projectleader_value_formatted: 'Dr. Example',
  _akoya_programid_value_formatted: 'Medical Research',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  fetchXmlAll.mockResolvedValue({ rows: [], capped: false, truncatedByBudget: false });
  searchRequests.mockResolvedValue({ results: [], totalCount: 0 });
  findByIds.mockResolvedValue({ records: [] });
  queryRequests.mockResolvedValue({ records: [], totalCount: 0, hasMore: false });
});

test('loads distinct live cycles/statuses and sorts them for the filters', async () => {
  fetchXmlAll
    .mockResolvedValueOnce({
      rows: [
        { akoya_fiscalyear: 'June 2026' },
        { akoya_fiscalyear: 'December 2025' },
        { akoya_fiscalyear: 'December 2026' },
        { akoya_fiscalyear: 'June 2026' },
        { akoya_fiscalyear: null },
      ],
      capped: false,
      truncatedByBudget: false,
    })
    .mockResolvedValueOnce({
      rows: [
        { akoya_requeststatus: 'Phase II Pending' },
        { akoya_requeststatus: 'Active' },
        { akoya_requeststatus: 'Active' },
      ],
      capped: false,
      truncatedByBudget: false,
    });

  await expect(loadRequestSearchOptions()).resolves.toEqual({
    success: true,
    cycles: [
      { value: 'December 2026', label: 'December 2026' },
      { value: 'June 2026', label: 'June 2026' },
      { value: 'December 2025', label: 'December 2025' },
    ],
    statuses: ['Active', 'Phase II Pending'],
  });
  expect(fetchXmlAll).toHaveBeenNthCalledWith(
    1,
    'akoya_requests',
    REQUEST_SEARCH_OPTIONS_FETCH.cycles,
    { hardCapRows: 500 },
  );
  expect(fetchXmlAll).toHaveBeenNthCalledWith(
    2,
    'akoya_requests',
    REQUEST_SEARCH_OPTIONS_FETCH.statuses,
    { hardCapRows: 500 },
  );
});

test('fails loud when either live option query is truncated', async () => {
  fetchXmlAll
    .mockResolvedValueOnce({ rows: [], capped: true, truncatedByBudget: false })
    .mockResolvedValueOnce({ rows: [], capped: false, truncatedByBudget: false });
  await expect(loadRequestSearchOptions()).rejects.toMatchObject({
    httpStatus: 503,
    message: 'Request search options were incomplete. Please try again.',
  });
});

test('text search applies escaped server filters, hydrates rows, and preserves relevance order', async () => {
  const first = '11111111-1111-1111-1111-111111111111';
  const second = '22222222-2222-2222-2222-222222222222';
  searchRequests.mockResolvedValue({
    results: [{ objectId: second }, { objectId: first }],
    totalCount: 2,
  });
  findByIds.mockResolvedValue({
    records: [
      requestRow(first, {
        wmkf_organizationname: null,
        _akoya_applicantid_value_formatted: 'Applicant fallback',
        _wmkf_projectleader_value_formatted: null,
        _wmkf_researchleader_value_formatted: 'Research leader fallback',
      }),
      requestRow(second),
    ],
  });

  const body = await searchWorkbenchRequests({
    query: 'regeneration',
    cycle: 'December 2026',
    status: "Director's Review",
    offset: 0,
  });

  expect(searchRequests).toHaveBeenCalledWith('regeneration', {
    top: 25,
    skip: 0,
    orderby: REQUEST_SEARCH_ORDER,
    filter: "akoya_request:(akoya_fiscalyear eq 'December 2026' and akoya_requeststatus eq 'Director''s Review')",
  });
  expect(findByIds).toHaveBeenCalledWith([second, first], {
    select: REQUEST_SEARCH_SELECT,
    top: 2,
  });
  expect(body.results.map((row) => row.requestId)).toEqual([second, first]);
  expect(body.results[1]).toMatchObject({
    institution: 'Applicant fallback',
    projectLeader: 'Research leader fallback',
    cycleCode: 'D26',
  });
  expect(body.unavailableCount).toBe(0);
  expect(body.nextOffset).toBeNull();
});

test('escapes Dataverse Search operators in user text before querying', async () => {
  await searchWorkbenchRequests({ query: 'Smith-Jones / UCLA + C\\C: lab?' });

  expect(searchRequests).toHaveBeenCalledWith('Smith\\-Jones \\/ UCLA \\+ C\\\\C\\: lab\\?', {
    top: 25,
    skip: 0,
    orderby: REQUEST_SEARCH_ORDER,
  });
});

test('fails before Dataverse when escaping would exceed the legacy 100-character limit', async () => {
  await expect(searchWorkbenchRequests({ query: '-'.repeat(60) })).rejects.toMatchObject({
    httpStatus: 400,
    message: 'Search term has too much punctuation. Shorten it and try again.',
  });
  expect(searchRequests).not.toHaveBeenCalled();
});

test('deduplicates search hits and reports indexed requests that cannot be hydrated', async () => {
  const available = '11111111-1111-1111-1111-111111111111';
  const stale = '22222222-2222-2222-2222-222222222222';
  searchRequests.mockResolvedValue({
    results: [{ objectId: available }, { objectId: available }, { objectId: stale }],
    totalCount: 3,
  });
  findByIds.mockResolvedValue({ records: [requestRow(available)] });

  const body = await searchWorkbenchRequests({ query: 'university' });

  expect(findByIds).toHaveBeenCalledWith([available, stale], {
    select: REQUEST_SEARCH_SELECT,
    top: 2,
  });
  expect(body.results).toHaveLength(1);
  expect(body.unavailableCount).toBe(1);
  expect(body.hasMore).toBe(false);
});

test('text search uses native stable paging and advances by indexed hits', async () => {
  const ids = Array.from({ length: 25 }, (_, index) => `id-${String(index).padStart(4, '0')}`);
  searchRequests.mockResolvedValue({
    results: ids.map((objectId) => ({ objectId })),
    totalCount: 84,
  });
  findByIds.mockResolvedValue({ records: ids.map((id) => requestRow(id)) });

  const body = await searchWorkbenchRequests({ query: 'university', offset: 25 });

  expect(searchRequests).toHaveBeenCalledWith('university', {
    top: 25,
    skip: 25,
    orderby: REQUEST_SEARCH_ORDER,
  });
  expect(body).toMatchObject({
    offset: 25,
    returnedCount: 25,
    hasMore: true,
    nextOffset: 50,
    capped: false,
  });
});

test('filter-only search stays bounded and reports the 100-result ceiling honestly', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => requestRow(`id-${String(index).padStart(4, '0')}`));
  queryRequests.mockResolvedValue({ records: rows, totalCount: 137, hasMore: true });

  const body = await searchWorkbenchRequests({
    query: '',
    cycle: 'June 2026',
    status: '',
    offset: 25,
  });

  expect(queryRequests).toHaveBeenCalledWith({
    select: REQUEST_SEARCH_SELECT,
    filter: "akoya_fiscalyear eq 'June 2026'",
    orderby: 'akoya_requestnum desc',
    top: 100,
  });
  expect(body.results).toHaveLength(25);
  expect(body).toMatchObject({
    totalCount: 137,
    returnedCount: 25,
    hasMore: true,
    nextOffset: 50,
    capped: true,
  });
});

test('refuses the unfiltered complement before any Dataverse read', async () => {
  const error = await searchWorkbenchRequests({ query: '', cycle: '', status: '' }).catch((e) => e);
  expect(error).toBeInstanceOf(ServiceHttpError);
  expect(error.httpStatus).toBe(400);
  expect(searchRequests).not.toHaveBeenCalled();
  expect(queryRequests).not.toHaveBeenCalled();
});
