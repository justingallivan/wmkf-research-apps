/** @jest-environment node */
const queryRecords = jest.fn();
const searchRecords = jest.fn();
const findByIds = jest.fn();

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryRecords: (...args) => queryRecords(...args),
    searchRecords: (...args) => searchRecords(...args),
  },
}));
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  findByIds: (...args) => findByIds(...args),
}));

import { findReportsDue, searchRecords as searchExplorerRecords } from '../../lib/services/dynamics-explorer/tools/composite.js';
import { getRelated } from '../../lib/services/dynamics-explorer/tools/get-related.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  queryRecords.mockResolvedValue({ records: [], totalCount: 0 });
  searchRecords.mockResolvedValue({ results: [], totalCount: 0, queryContext: {} });
  findByIds.mockResolvedValue({ records: [] });
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('find_reports_due preserves its historical filter off and qualifies the ordinary predicate on', async () => {
  const input = { date_from: '2026-01-01', date_to: '2026-02-01', include_inactive: false };
  await findReportsDue(input);
  expect(queryRecords.mock.calls[0][1].filter).not.toContain('wmkf_istestrequest');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  await findReportsDue(input);
  expect(queryRecords.mock.calls[1][1].filter).toContain('akoya_requestlookup/wmkf_istestrequest');
  expect(queryRecords.mock.calls[1][1].filter).toContain('akoya_requestlookup/wmkf_testcreationrunid');
});

test('generic Search performs no marker read off and adds only a TEST signal to request hits on', async () => {
  const result = {
    results: [{
      entity: 'akoya_request',
      objectId: REQUEST_ID,
      attributes: { akoya_requestnum: '1001', akoya_applicantidname: 'Example', akoya_title: 'Project' },
      highlights: {},
    }],
    totalCount: 1,
    queryContext: {},
  };
  searchRecords.mockResolvedValue(result);

  const off = await searchExplorerRecords({ search: 'Project', entities: ['akoya_request'], top: 20 });
  expect(findByIds).not.toHaveBeenCalled();
  expect(off.results).toContain('Req 1001 | Example');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  findByIds.mockResolvedValue({
    records: [{ akoya_requestid: REQUEST_ID, wmkf_istestrequest: true, wmkf_testcreationrunid: RUN_ID }],
  });
  const on = await searchExplorerRecords({ search: 'Project', entities: ['akoya_request'], top: 20 });
  expect(findByIds).toHaveBeenCalledWith([REQUEST_ID], {
    select: 'akoya_requestid,wmkf_istestrequest,wmkf_testcreationrunid',
    top: 1,
  });
  expect(on.results).toContain('Req 1001 | TEST | Example');
  expect(on.results).not.toContain('wmkf_istestrequest');
  expect(on.results).not.toContain(RUN_ID);
});

test('generic Search fails closed instead of showing an unclassified request without a badge', async () => {
  process.env.TEST_REQUEST_ISOLATION = 'on';
  searchRecords.mockResolvedValue({
    results: [{ entity: 'akoya_request', objectId: REQUEST_ID, attributes: {}, highlights: {} }],
    totalCount: 1,
    queryContext: {},
  });
  findByIds.mockResolvedValue({ records: [] });
  await expect(searchExplorerRecords({ search: 'missing', entities: ['akoya_request'], top: 20 }))
    .rejects.toThrow('Could not classify every request returned by Dataverse Search.');
});

test('get_related request lists add marker projections and only the TEST signal when on', async () => {
  const row = {
    akoya_requestnum: '1001',
    akoya_requeststatus: 'Active',
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: RUN_ID,
  };
  queryRecords.mockResolvedValue({ records: [row], totalCount: 1 });
  const input = { source_type: 'account', source_id: REQUEST_ID, target_type: 'requests' };

  const off = await getRelated(input);
  expect(queryRecords.mock.calls[0][1].select).not.toContain('wmkf_istestrequest');
  expect(off.requests).not.toContain('TEST');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  const on = await getRelated(input);
  expect(queryRecords.mock.calls[1][1].select).toContain('wmkf_istestrequest,wmkf_testcreationrunid');
  expect(on.requests).toContain('Req 1001 | TEST');
  expect(on.requests).not.toContain(RUN_ID);
});

test('get_related report lists preserve the old filter off and exclude via the parent request on', async () => {
  const input = { source_type: 'request', source_id: REQUEST_ID, target_type: 'reports' };
  await getRelated(input);
  expect(queryRecords.mock.calls[0][1].filter).not.toContain('wmkf_istestrequest');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  await getRelated(input);
  expect(queryRecords.mock.calls[1][1].filter).toContain('akoya_requestlookup/wmkf_istestrequest');
});
