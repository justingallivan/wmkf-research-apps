/** @jest-environment node */
const queryRecords = jest.fn();
const countRecords = jest.fn();
const aggregateRecords = jest.fn();

jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    resolveEntitySetName: jest.fn(async () => 'akoya_requests'),
    queryRecords: (...args) => queryRecords(...args),
    countRecords: (...args) => countRecords(...args),
    aggregateRecords: (...args) => aggregateRecords(...args),
  },
}));
jest.mock('../../lib/services/dynamics-explorer/tool-errors', () => ({
  validateEffectiveODataCall: jest.fn(async () => ({})),
  validatorReject: jest.fn((value) => value),
}));

import { executeTool } from '../../lib/services/dynamics-explorer/tool-executor.js';

const RUN = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  delete process.env.TEST_REQUEST_ISOLATION;
  jest.clearAllMocks();
  queryRecords.mockResolvedValue({ records: [{ akoya_requestnum: '1001' }], totalCount: 1 });
  countRecords.mockResolvedValue(1);
  aggregateRecords.mockResolvedValue({ results: [] });
});

afterEach(() => { delete process.env.TEST_REQUEST_ISOLATION; });

test('query_records preserves the old select/DTO off and emits only a derived badge on', async () => {
  const input = { table_name: 'akoya_request', select: 'akoya_requestnum', filter: "akoya_requestnum eq '1001'" };
  const off = await executeTool('query_records', input, jest.fn(), 1);
  expect(queryRecords.mock.calls[0][1].select).toBe('akoya_requestnum');
  expect(off.records[0]).toEqual({ akoya_requestnum: '1001' });

  process.env.TEST_REQUEST_ISOLATION = 'on';
  queryRecords.mockResolvedValue({
    records: [{ akoya_requestnum: '1001', wmkf_istestrequest: true, wmkf_testcreationrunid: RUN }],
    totalCount: 1,
  });
  const on = await executeTool('query_records', input, jest.fn(), 1);
  expect(queryRecords.mock.calls[1][1].select).toContain('wmkf_istestrequest,wmkf_testcreationrunid');
  expect(on.records[0]).toEqual({ akoya_requestnum: '1001', isTestRequest: true });
});

test.each(['count_records', 'aggregate'])('%s adds the ordinary-only filter only for request tables when on', async (tool) => {
  const input = {
    table_name: 'akoya_requests', filter: 'statecode eq 0',
    ...(tool === 'aggregate' ? { field: 'akoya_requestid', operation: 'count' } : {}),
  };
  await executeTool(tool, input, jest.fn(), 1);
  const offFilter = tool === 'count_records' ? countRecords.mock.calls[0][1] : aggregateRecords.mock.calls[0][1].filter;
  expect(offFilter).not.toContain('wmkf_istestrequest');

  process.env.TEST_REQUEST_ISOLATION = 'on';
  await executeTool(tool, input, jest.fn(), 1);
  const onFilter = tool === 'count_records' ? countRecords.mock.calls[1][1] : aggregateRecords.mock.calls[1][1].filter;
  expect(onFilter).toContain('wmkf_istestrequest');
});
