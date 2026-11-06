/** @jest-environment node */

import { saveFirstCut } from '../../lib/services/workbench/first-cut-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { getUserRole } from '../../lib/utils/auth';

jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: jest.fn(),
  updateById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/operations-grant-cycle', () => ({
  linkedCycleExpand: () => 'wmkf_GrantCycle($select=wmkf_cyclecode)',
  linkedCycleCode: (row) => row.wmkf_GrantCycle?.wmkf_cyclecode,
}));
jest.mock('../../lib/utils/auth', () => ({ getUserRole: jest.fn() }));

const requestId = '11111111-1111-1111-1111-111111111111';
const callerSystemId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const version = 'W/"123"';
const input = { requestId, callerSystemId, version, profileId: 7, decision: 'yes' };
const row = {
  akoya_requestid: requestId,
  _wmkf_programdirector_value: callerSystemId.toUpperCase(),
  wmkf_phaseistatus: null,
  wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
  '@odata.etag': version,
};

beforeEach(() => {
  jest.resetAllMocks();
  getById.mockResolvedValue(row);
  getUserRole.mockResolvedValue('read_only');
});

test.each([
  [null, 'yes', 100000004],
  [100000000, 'no', 100000005],
  [100000004, 'no', 100000005],
  [100000005, 'yes', 100000004],
])('lead PD may edit from %s to %s', async (current, decision, status) => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: current });
  await expect(saveFirstCut({ ...input, decision })).resolves.toEqual({ success: true });
  expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_phaseistatus: status }, {
    ifMatch: version, actingUserSystemId: callerSystemId,
  });
});

test.each([707510005, 707510006, 100000003, 100000002, 707510004, 100000001, 707510001, 707510002, 707510003, 682090001, 999])(
  'refuses locked or unknown status %s', async (status) => {
    getById.mockResolvedValue({ ...row, wmkf_phaseistatus: status });
    await expect(saveFirstCut(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(updateById).not.toHaveBeenCalled();
  },
);

test('superuser can edit an unassigned request; other staff cannot', async () => {
  getById.mockResolvedValue({ ...row, _wmkf_programdirector_value: null });
  await expect(saveFirstCut(input)).rejects.toMatchObject({ httpStatus: 403 });
  expect(updateById).not.toHaveBeenCalled();
  getUserRole.mockResolvedValue('superuser');
  await expect(saveFirstCut(input)).resolves.toEqual({ success: true });
});

test.each([
  { wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } },
  { wmkf_GrantCycle: null },
  { '@odata.etag': 'W/"124"' },
  { '@odata.etag': undefined },
])('rejects an ineligible cycle or stale/missing version: %o', async (changes) => {
  getById.mockResolvedValue({ ...row, ...changes });
  await expect(saveFirstCut(input)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
});

test('maps a concurrent Dataverse edit to a conflict without retrying', async () => {
  updateById.mockRejectedValue({ status: 412 });
  await expect(saveFirstCut(input)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('saving the same decision skips the PATCH', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000004 });
  await expect(saveFirstCut(input)).resolves.toEqual({ success: true });
  expect(updateById).not.toHaveBeenCalled();
});
