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
  eraseDryRunChangeset,
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

test('dry-run erasure uses one conditional changeset and never targets source entities', async () => {
  const round = { wmkf_proposalrankingroundid: ROUND_ID, wmkf_snapshotjson: '{"dryRun":true}', '@odata.etag': ETAG };
  const coordinator = { wmkf_proposalrankingcycleid: CYCLE_ID, wmkf_activeroundid: ROUND_ID, '@odata.etag': ETAG };
  const list = { wmkf_proposalrankinglistid: '10000000-0000-4000-8000-000000000003', wmkf_roundid: ROUND_ID, '@odata.etag': ETAG };
  await eraseDryRunChangeset(round, [list], { wmkf_state: 100000001 }, coordinator, { wmkf_activeroundid: null });
  expect(executeChangeset).toHaveBeenCalledTimes(1);
  expect(executeChangeset.mock.calls[0][1]).toEqual([
    { method: 'PATCH', url: `wmkf_proposalrankingrounds(${ROUND_ID})`, ifMatch: ETAG, body: { wmkf_state: 100000001 } },
    { method: 'DELETE', url: `wmkf_proposalrankinglists(${list.wmkf_proposalrankinglistid})`, ifMatch: ETAG },
    { method: 'PATCH', url: `wmkf_proposalrankingcycles(${CYCLE_ID})`, ifMatch: ETAG, body: { wmkf_activeroundid: null } },
  ]);
  executeChangeset.mockClear();
  await expect(eraseDryRunChangeset(round, [{ ...list, wmkf_roundid: CYCLE_ID }], {}, coordinator, {})).rejects.toThrow('belong to this dry run');
  await expect(eraseDryRunChangeset({ ...round, wmkf_snapshotjson: '{}' }, [list], {}, coordinator, {})).rejects.toThrow('active dry run');
  await expect(eraseDryRunChangeset(round, [{ ...list, '@odata.etag': null }], {}, coordinator, {})).rejects.toThrow('current revision');
  expect(executeChangeset).not.toHaveBeenCalled();
});
