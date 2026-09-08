/** @jest-environment node */

import {
  buildProgramScopeFilter,
  resolveWorkbenchProgramScope,
} from '../../lib/services/workbench/program-scope-service.js';

const RESEARCH = '11111111-1111-4111-8111-111111111111';
const SOCAL = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PD = '44444444-4444-4444-8444-444444444444';

function deps(records, assigned = []) {
  return {
    listPrograms: jest.fn(async () => ({ records })),
    queryAssignedRequests: jest.fn(async () => ({ records: assigned.map((id) => ({ _wmkf_grantprogram_value: id })) })),
  };
}

test('defaults to the one active program assigned to the signed-in PD', async () => {
  const dependencies = deps([
    { wmkf_grantprogramid: RESEARCH, wmkf_name: 'Research' },
    { wmkf_grantprogramid: SOCAL, wmkf_name: 'Southern California' },
  ], [SOCAL]);
  await expect(resolveWorkbenchProgramScope({ callerSystemId: PD, dependencies })).resolves.toMatchObject({
    programId: SOCAL,
    defaultProgramId: SOCAL,
    programName: 'Southern California',
  });
  expect(dependencies.queryAssignedRequests).toHaveBeenCalledWith(expect.stringContaining(`_wmkf_programdirector_value eq ${PD}`));
});

test('falls back to the live Research row when assignment is missing or ambiguous', async () => {
  const dependencies = deps([
    { wmkf_grantprogramid: RESEARCH, wmkf_name: 'Research' },
    { wmkf_grantprogramid: SOCAL, wmkf_name: 'Southern California' },
  ], [SOCAL, RESEARCH]);
  await expect(resolveWorkbenchProgramScope({ callerSystemId: PD, dependencies })).resolves.toMatchObject({
    programId: RESEARCH,
    defaultProgramId: RESEARCH,
  });
});

test('uses only the newest visible Workbench cycle for the PD default', async () => {
  const dependencies = deps([
    { wmkf_grantprogramid: RESEARCH, wmkf_name: 'Research' },
    { wmkf_grantprogramid: SOCAL, wmkf_name: 'Southern California' },
  ]);
  dependencies.queryAssignedRequests.mockResolvedValue({
    records: [
      { _wmkf_grantprogram_value: SOCAL, wmkf_meetingdate: '2025-12-11' },
      { _wmkf_grantprogram_value: RESEARCH, wmkf_meetingdate: '2026-06-04' },
    ],
  });
  await expect(resolveWorkbenchProgramScope({ callerSystemId: PD, dependencies })).resolves.toMatchObject({
    programId: RESEARCH,
    defaultProgramId: RESEARCH,
  });
});

test('rejects a client selection outside the active live catalog', async () => {
  const dependencies = deps([{ wmkf_grantprogramid: RESEARCH, wmkf_name: 'Research' }]);
  await expect(resolveWorkbenchProgramScope({ programId: OTHER, dependencies })).rejects.toMatchObject({ httpStatus: 400 });
});

test('composes only the broad lookup predicate', () => {
  expect(buildProgramScopeFilter(SOCAL)).toBe(`_wmkf_grantprogram_value eq ${SOCAL}`);
});
