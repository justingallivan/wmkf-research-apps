/** @jest-environment node */

import { saveScoring, saveChairsRecommendation } from '../../lib/services/workbench/scoring-service';
import { getById, updateById } from '../../lib/dataverse/adapters/grant-request';
import { processAnnotations } from '../../lib/services/dynamics/annotations';
import { getUserRole } from '../../lib/utils/auth';

import { j27ChairsRecommendationEnabled, j27IntegrityTarget, j27ChairsRecommendationRehearsalRequestId } from '../../lib/utils/j27-integrity-readiness';
import { isJ27SandboxFactoryRequest } from '../../lib/services/workbench/j27-integrity-jobs';
import { scheduleJ27IntegrityScreen, confirmJ27IntegrityDecision } from '../../lib/services/workbench/j27-integrity-dispatch';

jest.mock('../../lib/utils/j27-integrity-readiness', () => ({
  j27ChairsRecommendationEnabled: jest.fn(), j27IntegrityTarget: jest.fn(), j27ChairsRecommendationRehearsalRequestId: jest.fn(), j27IntegritySimulationRequestIds: () => [],
}));
jest.mock('../../lib/services/workbench/j27-integrity-jobs', () => ({
  isJ27SandboxFactoryRequest: jest.fn(),
}));
jest.mock('../../lib/services/workbench/j27-integrity-dispatch', () => ({
  scheduleJ27IntegrityScreen: jest.fn(), confirmJ27IntegrityDecision: jest.fn(),
}));

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
const row = processAnnotations({
  akoya_requestid: requestId,
  _wmkf_programdirector_value: callerSystemId.toUpperCase(),
  wmkf_phaseistatus: null,
  wmkf_GrantCycle: { wmkf_cyclecode: 'J27' },
  '@odata.etag': version,
});

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
  await expect(saveScoring({ ...input, decision })).resolves.toEqual({ success: true });
  expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_phaseistatus: status }, {
    ifMatch: version, actingUserSystemId: callerSystemId,
  });
});

test.each([707510005, 707510006, 100000003, 100000002, 707510004, 100000001, 707510001, 707510002, 707510003, 682090001, 999])(
  'refuses locked or unknown status %s', async (status) => {
    getById.mockResolvedValue({ ...row, wmkf_phaseistatus: status });
    await expect(saveScoring(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(updateById).not.toHaveBeenCalled();
  },
);

test('superuser can edit an unassigned request; other staff cannot', async () => {
  getById.mockResolvedValue({ ...row, _wmkf_programdirector_value: null });
  await expect(saveScoring(input)).rejects.toMatchObject({ httpStatus: 403 });
  expect(updateById).not.toHaveBeenCalled();
  getUserRole.mockResolvedValue('superuser');
  await expect(saveScoring(input)).resolves.toEqual({ success: true });
});

test.each([
  { wmkf_GrantCycle: { wmkf_cyclecode: 'D26' } },
  { wmkf_GrantCycle: null },
  { _etag: 'W/"124"' },
  { _etag: undefined },
])('rejects an ineligible cycle or stale/missing version: %o', async (changes) => {
  getById.mockResolvedValue({ ...row, ...changes });
  await expect(saveScoring(input)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).not.toHaveBeenCalled();
});

test('maps a concurrent Dataverse edit to a conflict without retrying', async () => {
  updateById.mockRejectedValue({ status: 412 });
  await expect(saveScoring(input)).rejects.toMatchObject({ httpStatus: 409 });
  expect(updateById).toHaveBeenCalledTimes(1);
});

test('saving the same decision skips the PATCH', async () => {
  getById.mockResolvedValue({ ...row, wmkf_phaseistatus: 100000004 });
  await expect(saveScoring(input)).resolves.toEqual({ success: true });
  expect(updateById).not.toHaveBeenCalled();
});

describe('sandbox recommendation to Chairs', () => {
  const target = 'orgd9e66399.crm.dynamics.com';
  const runId = '11111111-1111-4111-8111-222222222222';
  const factoryRow = { ...row, wmkf_phaseistatus: 100000004, wmkf_istestrequest: true, wmkf_testcreationrunid: runId };
  const previousUrl = process.env.DYNAMICS_URL;

  beforeEach(() => {
    process.env.DYNAMICS_URL = `https://${target}`;
    j27ChairsRecommendationEnabled.mockReturnValue(true);
    j27IntegrityTarget.mockReturnValue(target);
    isJ27SandboxFactoryRequest.mockResolvedValue(true);
    scheduleJ27IntegrityScreen.mockResolvedValue('started');
    confirmJ27IntegrityDecision.mockResolvedValue('scheduled');
    getById.mockResolvedValue(factoryRow);
  });

  afterEach(() => {
    if (previousUrl === undefined) delete process.env.DYNAMICS_URL;
    else process.env.DYNAMICS_URL = previousUrl;
  });

  test('reserves background work, saves Yes and confirms only after the conditional write', async () => {
    let finishWrite;
    updateById.mockImplementation(() => new Promise(resolve => { finishWrite = resolve; }));
    const save = saveChairsRecommendation(input);
    await new Promise(resolve => setImmediate(resolve));
    expect(scheduleJ27IntegrityScreen).toHaveBeenCalledWith({ target, requestId, profileId: 7, version });
    expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_phaseistatus: 707510005 }, {
      ifMatch: version, actingUserSystemId: callerSystemId,
    });
    expect(confirmJ27IntegrityDecision).not.toHaveBeenCalled();
    finishWrite();
    await expect(save).resolves.toEqual({ success: true, automaticScreen: 'scheduled' });
    expect(confirmJ27IntegrityDecision).toHaveBeenCalledWith({ target, requestId, profileId: 7, version });
  });

  test('a failed conditional write cannot authorize paid work', async () => {
    updateById.mockRejectedValue({ status: 412 });
    await expect(saveChairsRecommendation(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(confirmJ27IntegrityDecision).not.toHaveBeenCalled();
  });

  test('a dispatch outage still allows the meeting decision to save', async () => {
    scheduleJ27IntegrityScreen.mockResolvedValue('unconfirmed');
    await expect(saveChairsRecommendation(input)).resolves.toEqual({ success: true, automaticScreen: 'unconfirmed' });
    expect(updateById).toHaveBeenCalled();
    expect(confirmJ27IntegrityDecision).not.toHaveBeenCalled();
  });

  test('a lost screen confirmation reports a saved decision separately', async () => {
    confirmJ27IntegrityDecision.mockResolvedValue('unconfirmed');
    await expect(saveChairsRecommendation(input)).resolves.toEqual({ success: true, automaticScreen: 'unconfirmed' });
  });

  test('No saves in the same field without dispatch and repeat Yes does no work', async () => {
    await expect(saveChairsRecommendation({ ...input, decision: 'no' })).resolves.toEqual({ success: true });
    expect(updateById).toHaveBeenCalledWith(requestId, { wmkf_phaseistatus: 707510006 }, expect.any(Object));
    updateById.mockClear();
    getById.mockResolvedValue({ ...factoryRow, wmkf_phaseistatus: 707510005 });
    await expect(saveChairsRecommendation(input)).resolves.toEqual({ success: true });
    expect(updateById).not.toHaveBeenCalled();
    expect(scheduleJ27IntegrityScreen).not.toHaveBeenCalled();
  });

  test('dropdown-only Preview accepts exactly the configured request without Factory or screening access', async () => {
    j27ChairsRecommendationRehearsalRequestId.mockReturnValue(requestId);
    j27IntegrityTarget.mockReturnValue(null);
    getById.mockResolvedValue({ ...factoryRow, wmkf_istestrequest: null, wmkf_testcreationrunid: null });
    await expect(saveChairsRecommendation(input)).resolves.toEqual({ success: true });
    expect(isJ27SandboxFactoryRequest).not.toHaveBeenCalled();
    expect(scheduleJ27IntegrityScreen).not.toHaveBeenCalled();
    updateById.mockClear();
    await expect(saveChairsRecommendation({ ...input, requestId: runId })).rejects.toMatchObject({ httpStatus: 403 });
    expect(updateById).not.toHaveBeenCalled();
  });

  test('rejects an ordinary, wrong-host or unscored record before enqueueing', async () => {
    isJ27SandboxFactoryRequest.mockResolvedValueOnce(false);
    await expect(saveChairsRecommendation(input)).rejects.toMatchObject({ httpStatus: 409 });
    getById.mockResolvedValue({ ...factoryRow, wmkf_phaseistatus: 100000005 });
    await expect(saveChairsRecommendation(input)).rejects.toMatchObject({ httpStatus: 409 });
    expect(scheduleJ27IntegrityScreen).not.toHaveBeenCalled();
    expect(updateById).not.toHaveBeenCalled();
  });
});

// The step belongs to every cycle from J27 on, not to the cycle named J27.
test.each(['D27', 'J28'])('a later cycle (%s) is scored like J27', async (code) => {
  getById.mockResolvedValue({ ...row, wmkf_GrantCycle: { wmkf_cyclecode: code } });
  await expect(saveScoring(input)).resolves.toEqual({ success: true });
});
