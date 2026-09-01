/** @jest-environment node */

import {
  buildStaffingOperationPlan,
  executeStaffingOperationPlan,
  parseArgs,
} from '../../scripts/manage-final-writeup-staffing-config.mjs';

const REVISION = 'W/"7"';
const V1 = {
  version: 1,
  programs: [{
    grantProgramId: '10000000-0000-4000-8000-000000000001',
    reviewerIds: ['20000000-0000-4000-8000-000000000001'],
  }],
};
const V2 = {
  version: 2,
  personas: [{
    reviewerId: '20000000-0000-4000-8000-000000000001',
    roles: [],
  }],
  programs: V1.programs,
};

test('CLI is dry-run by default and requires an explicit ETag for execution', () => {
  expect(parseArgs(['node', 'script', '--mode=upgrade'])).toMatchObject({
    mode: 'upgrade',
    execute: false,
    expectedRevision: null,
  });
  expect(() => parseArgs(['node', 'script', '--mode=upgrade', '--execute']))
    .toThrow(/requires --expected-revision/);
  expect(() => parseArgs(['node', 'script', '--mode=repair']))
    .toThrow(/requires --input/);
});

test('upgrade uses only the validated Admin v2 draft from a stored v1 row', async () => {
  const getRawSetting = jest.fn();
  const validateConfig = jest.fn((value) => value);
  const plan = await buildStaffingOperationPlan({
    mode: 'upgrade',
    getAdminState: jest.fn(async () => ({
      migrationRequired: true,
      storedVersion: 1,
      revision: REVISION,
      config: V2,
    })),
    getRawSetting,
    validateConfig,
  });
  expect(plan).toEqual({ mode: 'upgrade', currentRevision: REVISION, config: V2 });
  expect(validateConfig).toHaveBeenCalledWith(V2, { writableOnly: true });
  expect(getRawSetting).not.toHaveBeenCalled();
});

test('repair plans from the raw ETag without parsing the current malformed value', async () => {
  const getAdminState = jest.fn();
  const plan = await buildStaffingOperationPlan({
    mode: 'repair',
    inputConfig: V1,
    getAdminState,
    getRawSetting: jest.fn(async () => ({
      found: true,
      value: '{malformed',
      revision: REVISION,
    })),
    validateConfig: jest.fn((value) => value),
  });
  expect(plan).toEqual({ mode: 'repair', currentRevision: REVISION, config: V1 });
  expect(getAdminState).not.toHaveBeenCalled();
});

test('dry run never calls either writer and execute routes upgrade versus repair explicitly', async () => {
  const publishUpgrade = jest.fn(async () => ({ storedVersion: 2 }));
  const replaceByRevision = jest.fn(async () => ({ config: V1, revision: 'W/"8"' }));
  const plan = { mode: 'upgrade', currentRevision: REVISION, config: V2 };

  await expect(executeStaffingOperationPlan({
    plan,
    execute: false,
    expectedRevision: null,
    publishUpgrade,
    replaceByRevision,
  })).resolves.toMatchObject({ executed: false, mode: 'upgrade' });
  expect(publishUpgrade).not.toHaveBeenCalled();
  expect(replaceByRevision).not.toHaveBeenCalled();

  await executeStaffingOperationPlan({
    plan,
    execute: true,
    expectedRevision: REVISION,
    publishUpgrade,
    replaceByRevision,
  });
  expect(publishUpgrade).toHaveBeenCalledWith(V2, REVISION);
  expect(replaceByRevision).not.toHaveBeenCalled();

  await executeStaffingOperationPlan({
    plan: { mode: 'repair', currentRevision: REVISION, config: V1 },
    execute: true,
    expectedRevision: REVISION,
    publishUpgrade,
    replaceByRevision,
  });
  expect(replaceByRevision).toHaveBeenCalledWith(V1, REVISION);
});

test('execute refuses a stale operator-supplied revision before either writer', async () => {
  const publishUpgrade = jest.fn();
  const replaceByRevision = jest.fn();
  await expect(executeStaffingOperationPlan({
    plan: { mode: 'upgrade', currentRevision: REVISION, config: V2 },
    execute: true,
    expectedRevision: 'W/"6"',
    publishUpgrade,
    replaceByRevision,
  })).rejects.toThrow(/does not match/);
  expect(publishUpgrade).not.toHaveBeenCalled();
  expect(replaceByRevision).not.toHaveBeenCalled();
});
