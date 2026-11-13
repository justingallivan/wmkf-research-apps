/** @jest-environment node */
import { workbenchPhaseReleaseAdmitted } from '../../lib/utils/workbench-phase-release.js';
import { resolveDiscoveryScope, resolveWorkbenchProgramScope } from '../../lib/services/workbench/program-scope-service.js';
import { buildDiscoveryFilter, buildVisibilityFilter } from '../../shared/config/workbenchVisibility.js';

jest.mock('../../lib/dataverse/adapters/operations-grant-cycle.js', () => ({
  ...jest.requireActual('../../lib/dataverse/adapters/operations-grant-cycle.js'),
  linkedCycleExpand: () => 'wmkf_GrantCycle($select=wmkf_cyclecode)',
}));

const RESEARCH = '11111111-1111-4111-8111-111111111111';
const catalog = () => jest.fn(async () => ({ records: [{ wmkf_grantprogramid: RESEARCH, wmkf_name: 'Research' }] }));

function withEnv(vars, fn) {
  const env = jest.replaceProperty(process, 'env', { ...process.env, ...vars });
  return Promise.resolve().then(fn).finally(() => env.restore());
}

test('off only in a Production deployment, unless the switch is the literal on', async () => {
  await withEnv({ VERCEL_ENV: 'production', WORKBENCH_PHASE_RELEASE: undefined }, () => expect(workbenchPhaseReleaseAdmitted()).toBe(false));
  await withEnv({ VERCEL_ENV: 'production', WORKBENCH_PHASE_RELEASE: 'true' }, () => expect(workbenchPhaseReleaseAdmitted()).toBe(false));
  await withEnv({ VERCEL_ENV: 'production', WORKBENCH_PHASE_RELEASE: 'on' }, () => expect(workbenchPhaseReleaseAdmitted()).toBe(true));
  await withEnv({ VERCEL_ENV: 'preview' }, () => expect(workbenchPhaseReleaseAdmitted()).toBe(true));
  await withEnv({ VERCEL_ENV: undefined }, () => expect(workbenchPhaseReleaseAdmitted()).toBe(true));
});

test('merge-dark discovery: no catalog read and an empty scope, so every consumer builds main\'s filter', async () => {
  await withEnv({ VERCEL_ENV: 'production' }, async () => {
    const listPrograms = catalog();
    const scope = await resolveDiscoveryScope({ listPrograms });
    expect(scope).toEqual({ readinessOnlyProgramIds: [] });
    expect(listPrograms).not.toHaveBeenCalled();
    expect(buildDiscoveryFilter(false, scope)).toBe(`(${buildVisibilityFilter(false)})`);

    const programScope = await resolveWorkbenchProgramScope({ dependencies: { listPrograms: catalog(), queryAssignedRequests: jest.fn(async () => ({ records: [] })) } });
    expect(programScope.discoveryScope).toEqual({ readinessOnlyProgramIds: [] });
  });
});

test('admitted, discovery resolves Research; a failed catalog read falls back to the empty scope', async () => {
  await withEnv({ VERCEL_ENV: 'production', WORKBENCH_PHASE_RELEASE: 'on' }, async () => {
    expect(await resolveDiscoveryScope({ listPrograms: catalog() })).toEqual({ readinessOnlyProgramIds: [RESEARCH] });
    const programScope = await resolveWorkbenchProgramScope({ dependencies: { listPrograms: catalog(), queryAssignedRequests: jest.fn(async () => ({ records: [] })) } });
    expect(programScope.discoveryScope).toEqual({ readinessOnlyProgramIds: [RESEARCH] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(await resolveDiscoveryScope({ listPrograms: jest.fn(async () => { throw new Error('catalog down'); }) })).toEqual({ readinessOnlyProgramIds: [] });
    } finally {
      warn.mockRestore();
    }
  });
});
