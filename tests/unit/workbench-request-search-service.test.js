/**
 * @jest-environment node
 */

const searchRequests = jest.fn();
const findByIds = jest.fn();
const queryRequests = jest.fn();
const aggregateRequests = jest.fn();
const searchDirectoryByName = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  searchRequests: (...args) => searchRequests(...args),
  findByIds: (...args) => findByIds(...args),
  queryRequests: (...args) => queryRequests(...args),
  aggregateRequests: (...args) => aggregateRequests(...args),
}));
jest.mock('../../lib/dataverse/adapters/contact.js', () => ({
  searchDirectoryByName: (...args) => searchDirectoryByName(...args),
}));

import {
  loadRequestSearchOptions,
  searchWorkbenchRequests,
  REQUEST_SEARCH_MAX_RESULTS,
  REQUEST_SEARCH_OPTIONS_AGGREGATES,
  REQUEST_SEARCH_ORDER,
  REQUEST_SEARCH_PROJECT_LEADER_ORDER,
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
  aggregateRequests.mockResolvedValue({ results: [] });
  searchDirectoryByName.mockResolvedValue([]);
  searchRequests.mockResolvedValue({ results: [], totalCount: 0 });
  findByIds.mockResolvedValue({ records: [] });
  queryRequests.mockResolvedValue({ records: [], totalCount: 0, hasMore: false });
});

test('loads grouped live cycles/statuses and sorts them for the filters', async () => {
  aggregateRequests
    .mockResolvedValueOnce({
      results: [
        { akoya_fiscalyear: 'June 2026' },
        { akoya_fiscalyear: 'December 2025' },
        { akoya_fiscalyear: 'December 2026' },
        { akoya_fiscalyear: 'June 2026' },
        { akoya_fiscalyear: null },
      ],
    })
    .mockResolvedValueOnce({
      results: [
        { akoya_requeststatus: 'Phase II Pending' },
        { akoya_requeststatus: 'Active' },
        { akoya_requeststatus: 'Active' },
      ],
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
  expect(aggregateRequests).toHaveBeenNthCalledWith(1, REQUEST_SEARCH_OPTIONS_AGGREGATES.cycles);
  expect(aggregateRequests).toHaveBeenNthCalledWith(2, REQUEST_SEARCH_OPTIONS_AGGREGATES.statuses);
});

test('propagates a rejected guarded aggregate without returning partial options', async () => {
  aggregateRequests.mockRejectedValueOnce(new Error('Access denied'));
  await expect(loadRequestSearchOptions()).rejects.toThrow('Access denied');
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
    top: 100,
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
    top: 100,
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

test('text search hydrates bounded chunks and pages the stable ranked hit set', async () => {
  const ids = Array.from({ length: 84 }, (_, index) => `id-${String(index).padStart(4, '0')}`);
  searchRequests.mockResolvedValue({
    results: ids.map((objectId) => ({ objectId })),
    totalCount: 84,
  });
  findByIds.mockImplementation(async (idChunk) => ({
    records: idChunk.map((id) => requestRow(id)),
  }));

  const body = await searchWorkbenchRequests({ query: 'university', offset: 25 });

  expect(searchRequests).toHaveBeenCalledWith('university', {
    top: 100,
    orderby: REQUEST_SEARCH_ORDER,
  });
  expect(findByIds).toHaveBeenNthCalledWith(1, ids.slice(0, 50), {
    select: REQUEST_SEARCH_SELECT,
    top: 50,
  });
  expect(findByIds).toHaveBeenNthCalledWith(2, ids.slice(50), {
    select: REQUEST_SEARCH_SELECT,
    top: 34,
  });
  expect(body).toMatchObject({
    offset: 25,
    returnedCount: 25,
    hasMore: true,
    nextOffset: 50,
    capped: false,
  });
});

test('unions true project-leader name matches ahead of indexed request-text matches', async () => {
  const piRequest = '11111111-1111-1111-1111-111111111111';
  const indexedRequest = '22222222-2222-2222-2222-222222222222';
  const contactId = '33333333-3333-3333-3333-333333333333';
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId, fullname: 'Cynthia Reinhart-King' }]);
  searchRequests.mockResolvedValue({
    results: [{ objectId: indexedRequest }],
    totalCount: 1,
  });
  queryRequests.mockResolvedValue({
    records: [requestRow(piRequest, { _wmkf_projectleader_value_formatted: 'Cynthia Reinhart-King' })],
    totalCount: 1,
    hasMore: false,
  });
  findByIds.mockResolvedValue({ records: [requestRow(indexedRequest)] });

  const body = await searchWorkbenchRequests({
    query: 'Cynthia Reinhart-King',
    cycle: 'June 2020',
    status: 'Closed',
  });

  expect(searchDirectoryByName).toHaveBeenCalledWith('Cynthia Reinhart-King', { top: 26 });
  expect(queryRequests).toHaveBeenCalledWith({
    select: REQUEST_SEARCH_SELECT,
    filter: "(_wmkf_projectleader_value eq 33333333-3333-3333-3333-333333333333) and akoya_fiscalyear eq 'June 2020' and akoya_requeststatus eq 'Closed'",
    orderby: REQUEST_SEARCH_PROJECT_LEADER_ORDER,
    top: 100,
  });
  expect(body).toMatchObject({
    totalCount: 2,
    returnedCount: 2,
    hasMore: false,
  });
  expect(body.results.map((row) => row.requestId)).toEqual([piRequest, indexedRequest]);
});

test('deduplicates a project-leader match already present in indexed search results', async () => {
  const requestId = '11111111-1111-1111-1111-111111111111';
  const contactId = '33333333-3333-3333-3333-333333333333';
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId }]);
  searchRequests.mockResolvedValue({ results: [{ objectId: requestId }], totalCount: 1 });
  queryRequests.mockResolvedValue({
    records: [requestRow(requestId)],
    totalCount: 1,
    hasMore: false,
  });
  findByIds.mockResolvedValue({ records: [requestRow(requestId)] });

  const body = await searchWorkbenchRequests({ query: 'Ada Lovelace' });

  expect(body).toMatchObject({ totalCount: 1, returnedCount: 1, hasMore: false });
});

test('paginates the merged PI and indexed result set without duplicates', async () => {
  const contactId = '33333333-3333-3333-3333-333333333333';
  const piRows = Array.from({ length: 3 }, (_, index) => requestRow(
    `10000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
  ));
  const indexedIds = Array.from({ length: 30 }, (_, index) => (
    `20000000-0000-0000-0000-${String(index).padStart(12, '0')}`
  ));
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId }]);
  searchRequests.mockResolvedValue({
    results: indexedIds.map((objectId) => ({ objectId })),
    totalCount: indexedIds.length,
  });
  queryRequests.mockResolvedValue({ records: piRows, totalCount: piRows.length, hasMore: false });
  findByIds.mockImplementation(async (ids) => ({ records: ids.map((id) => requestRow(id)) }));

  const first = await searchWorkbenchRequests({ query: 'Ada', offset: 0 });
  const second = await searchWorkbenchRequests({ query: 'Ada', offset: 25 });

  expect(first.results).toHaveLength(25);
  expect(first.nextOffset).toBe(25);
  expect(second.results).toHaveLength(8);
  expect(second.nextOffset).toBeNull();
  expect(new Set([...first.results, ...second.results].map((row) => row.requestId))).toHaveProperty('size', 33);
});

test('reports a capped result set when the disjoint PI and indexed union exceeds 100', async () => {
  const contactId = '33333333-3333-3333-3333-333333333333';
  const piRows = Array.from({ length: 75 }, (_, index) => requestRow(
    `10000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
  ));
  const indexedIds = Array.from({ length: 50 }, (_, index) => (
    `20000000-0000-0000-0000-${String(index).padStart(12, '0')}`
  ));
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId }]);
  searchRequests.mockResolvedValue({
    results: indexedIds.map((objectId) => ({ objectId })),
    totalCount: indexedIds.length,
  });
  queryRequests.mockResolvedValue({ records: piRows, totalCount: piRows.length, hasMore: false });
  findByIds.mockImplementation(async (ids) => ({ records: ids.map((id) => requestRow(id)) }));

  const fourthPage = await searchWorkbenchRequests({ query: 'Ada', offset: 75 });

  expect(fourthPage).toMatchObject({
    totalCount: 125,
    returnedCount: 25,
    hasMore: false,
    nextOffset: null,
    capped: true,
  });
});

test('deduplicates overlap before deciding whether the merged result set is capped', async () => {
  const contactId = '33333333-3333-3333-3333-333333333333';
  const indexedIds = Array.from({ length: 100 }, (_, index) => (
    `20000000-0000-0000-0000-${String(index).padStart(12, '0')}`
  ));
  const piRows = [
    requestRow(indexedIds[0]),
    requestRow('10000000-0000-0000-0000-000000000001'),
  ];
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId }]);
  searchRequests.mockResolvedValue({
    results: indexedIds.map((objectId) => ({ objectId })),
    totalCount: indexedIds.length,
  });
  queryRequests.mockResolvedValue({ records: piRows, totalCount: piRows.length, hasMore: false });
  findByIds.mockImplementation(async (ids) => ({ records: ids.map((id) => requestRow(id)) }));

  const body = await searchWorkbenchRequests({ query: 'Ada' });

  expect(body).toMatchObject({ totalCount: 101, returnedCount: 25, capped: true });
  expect(body.results[0].requestId).toBe(indexedIds[0]);
  expect(body.results[1].requestId).toBe(piRows[1].akoya_requestid);
});

test('does not report a cap when a PI row overlaps an exact 100-result indexed set', async () => {
  const contactId = '33333333-3333-3333-3333-333333333333';
  const indexedIds = Array.from({ length: 100 }, (_, index) => (
    `20000000-0000-0000-0000-${String(index).padStart(12, '0')}`
  ));
  searchDirectoryByName.mockResolvedValue([{ contactid: contactId }]);
  searchRequests.mockResolvedValue({
    results: indexedIds.map((objectId) => ({ objectId })),
    totalCount: indexedIds.length,
  });
  queryRequests.mockResolvedValue({
    records: [requestRow(indexedIds[0])],
    totalCount: 1,
    hasMore: false,
  });
  findByIds.mockImplementation(async (ids) => ({ records: ids.map((id) => requestRow(id)) }));

  const body = await searchWorkbenchRequests({ query: 'Ada' });

  expect(body).toMatchObject({ totalCount: 100, returnedCount: 25, capped: false });
});

test('discloses when project-leader contact candidates exceed the bounded 25-contact join', async () => {
  const contacts = Array.from({ length: 26 }, (_, index) => ({
    contactid: `30000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
  }));
  searchDirectoryByName.mockResolvedValue(contacts);
  queryRequests.mockResolvedValue({ records: [], totalCount: 0, hasMore: false });

  const body = await searchWorkbenchRequests({ query: 'Smith' });

  expect(searchDirectoryByName).toHaveBeenCalledWith('Smith', { top: 26 });
  const query = queryRequests.mock.calls[0][0];
  expect(query.filter).toContain(contacts[24].contactid);
  expect(query.filter).not.toContain(contacts[25].contactid);
  expect(body).toMatchObject({ totalCount: 0, returnedCount: 0, capped: true });
});

test('uses the hydrated page size when Search returns a negative total count sentinel', async () => {
  const id = '11111111-1111-1111-1111-111111111111';
  searchRequests.mockResolvedValue({ results: [{ objectId: id }], totalCount: -1 });
  findByIds.mockResolvedValue({ records: [requestRow(id)] });

  const body = await searchWorkbenchRequests({ query: 'university' });

  expect(body).toMatchObject({ totalCount: 1, returnedCount: 1, hasMore: false });
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
