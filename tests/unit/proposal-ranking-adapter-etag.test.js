jest.mock('../../lib/services/dynamics-service.js', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(),
    getRecord: jest.fn(),
  },
}));
jest.mock('../../lib/services/dynamics/changeset.js', () => ({
  executeChangeset: jest.fn(async (_service, operations) => operations),
}));

import { DynamicsService } from '../../lib/services/dynamics-service.js';
import { executeChangeset } from '../../lib/services/dynamics/changeset.js';
import { processAnnotations } from '../../lib/services/dynamics/annotations.js';
import {
  findCycleCoordinator,
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
