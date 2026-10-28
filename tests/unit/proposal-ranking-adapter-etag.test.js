jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(),
    getRecord: jest.fn(),
  },
}));
jest.mock('../../lib/services/dynamics/changeset.js', () => ({
  executeChangeset: jest.fn(async (_service, operations) => operations),
}));

jest.mock('../../lib/services/dynamics/http.js', () => ({ fetchWithTimeout: jest.fn() }));
import { queryAllRecords } from '../../lib/services/dynamics/read-ops.js';
import { fetchWithTimeout } from '../../lib/services/dynamics/http.js';

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { executeChangeset } from '../../lib/services/dynamics/changeset.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations.js';
import {
  findCycleCoordinator,
  listSavedRankingCycles,
  listRoundRows,
  patchRoundAndList,
  readRound,
} from '../../lib/dataverse/adapters/proposal-ranking.js';

const CYCLE_ID = '10000000-0000-4000-8000-000000000001';
const ROUND_ID = '10000000-0000-4000-8000-000000000002';
const ETAG = 'W/"rowversion-17"';

beforeEach(() => jest.clearAllMocks());

test('ranking adapter restores the ETag shape removed by DynamicsService annotations processing', async () => {
  const processed = (row) => processAnnotations({ ...row, '@odata.etag': ETAG });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [processed({ wmkf_proposalrankingcycleid: CYCLE_ID })] });
  const coordinator = await findCycleCoordinator('D99');
  expect(coordinator['@odata.etag']).toBe(ETAG);

  DynamicsService.getRecord.mockResolvedValue(processed({ wmkf_proposalrankingroundid: ROUND_ID }));
  const round = await readRound(ROUND_ID);
  expect(round['@odata.etag']).toBe(ETAG);

  DynamicsService.queryAllRecords.mockResolvedValue({ records: [processed({
    wmkf_proposalrankinglistid: '10000000-0000-4000-8000-000000000003',
    wmkf_listkey: 'meeting:se',
  })] });
  const [list] = await listRoundRows(ROUND_ID);
  expect(list['@odata.etag']).toBe(ETAG);

  await patchRoundAndList(round, list, { wmkf_lastoperationkind: 'save' }, { wmkf_version: 2 });
  const operations = executeChangeset.mock.calls[0][1];
  expect(operations.map((operation) => operation.ifMatch)).toEqual([ETAG, ETAG]);
});


test('saved-cycle discovery reads only coordinator fields and refuses incomplete pagination', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [
    { wmkf_cyclecode: 'D20', wmkf_activeroundid: ROUND_ID },
    { wmkf_cyclecode: 'J20', wmkf_activeroundid: null },
  ] });
  expect(await listSavedRankingCycles()).toEqual(['D20']);
  expect(DynamicsService.queryAllRecords).toHaveBeenCalledWith(expect.any(String), {
    select: 'wmkf_cyclecode,wmkf_activeroundid',
    filter: 'wmkf_activeroundid ne null',
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], capped: true });
  await expect(listSavedRankingCycles()).rejects.toThrow(/complete Dataverse result/);
});


test('saved-cycle discovery satisfies the real paginated reader filter requirement without writing', async () => {
  const originalUrl = process.env.DYNAMICS_URL;
  process.env.DYNAMICS_URL = 'https://ranking.example.invalid';
  const svc = {
    resolveLogicalName: jest.fn(() => 'wmkf_proposalrankingcycle'),
    checkRestriction: jest.fn(),
    getAccessToken: jest.fn(async () => 'fixture-token'),
    processAnnotations: row => row,
  };
  const nextLink = 'https://ranking.example.invalid/api/data/v9.2/wmkf_proposalrankingcycles?page=2';
  fetchWithTimeout.mockResolvedValueOnce({ ok: true, json: async () => ({
    value: [{ wmkf_cyclecode: 'D20', wmkf_activeroundid: ROUND_ID }],
    '@odata.nextLink': nextLink,
  }) }).mockResolvedValueOnce({ ok: true, json: async () => ({
    value: [{ wmkf_cyclecode: 'D26', wmkf_activeroundid: ROUND_ID }],
  }) });
  DynamicsService.queryAllRecords.mockImplementationOnce((entity, options) => queryAllRecords(svc, entity, options));
  try {
    await expect(listSavedRankingCycles()).resolves.toEqual(['D20', 'D26']);
    const request = new URL(fetchWithTimeout.mock.calls[0][0]);
    expect(request.searchParams.get('$filter')).toBe('wmkf_activeroundid ne null');
    expect(request.searchParams.get('$select')).toBe('wmkf_cyclecode,wmkf_activeroundid');
    expect(fetchWithTimeout.mock.calls[1][0]).toBe(nextLink);
    expect(svc.checkRestriction).toHaveBeenCalledWith('wmkf_proposalrankingcycle', 'wmkf_cyclecode,wmkf_activeroundid', undefined);
    expect(executeChangeset).not.toHaveBeenCalled();
  } finally {
    if (originalUrl === undefined) delete process.env.DYNAMICS_URL;
    else process.env.DYNAMICS_URL = originalUrl;
  }
});
