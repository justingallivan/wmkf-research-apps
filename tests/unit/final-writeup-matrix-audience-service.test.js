/** @jest-environment node */

import {
  FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
  getFinalWriteupMatrixAudienceAdminState,
  getFinalWriteupPersonaRuntimeState,
  replaceFinalWriteupMatrixAudienceConfigByRevision,
  resolveFinalWriteupMatrixAudiences,
  validateFinalWriteupMatrixAudienceConfig,
  writeFinalWriteupMatrixAudienceConfig,
} from '../../lib/services/final-writeup/matrix-audience-service.js';

const RESEARCH_ID = '10000000-0000-4000-8000-000000000001';
const SOCAL_ID = '10000000-0000-4000-8000-000000000002';
const ALLISON_ID = '975a6b00-4ff7-ee11-a1fd-000d3a341fd9';
const ANNELI_ID = '10b0de0d-4ff7-ee11-a1fd-000d3a3621c7';
const SASKIA_ID = '4ff27133-2316-f011-998a-6045bd02b4cc';

function v1Config() {
  return {
    version: 1,
    programs: [
      { grantProgramId: RESEARCH_ID, reviewerIds: [ALLISON_ID] },
      { grantProgramId: SOCAL_ID, reviewerIds: [ANNELI_ID, SASKIA_ID] },
    ],
  };
}

function v2Config() {
  return {
    version: 2,
    personas: [
      { reviewerId: ALLISON_ID, roles: ['leadership'] },
      { reviewerId: ANNELI_ID, roles: ['program-director'] },
      { reviewerId: SASKIA_ID, roles: [] },
    ],
    programs: v1Config().programs,
  };
}

function harness(stored = null) {
  return {
    getSettingStrict: jest.fn(async () => (
      stored === null
        ? { found: false, value: null, revision: null }
        : { found: true, value: JSON.stringify(stored), revision: 'W/"1"' }
    )),
    setSettingIfUnchanged: jest.fn(async () => true),
    listGrantPrograms: jest.fn(async () => ({
      records: [
        { wmkf_grantprogramid: RESEARCH_ID, wmkf_name: 'Research', statecode: 0 },
        { wmkf_grantprogramid: SOCAL_ID, wmkf_name: 'Southern California', statecode: 0 },
      ],
      totalCount: 2,
      hasMore: false,
    })),
    listReviewers: jest.fn(async () => ({
      records: [
        { systemuserid: ALLISON_ID, fullname: 'Allison Keller', isdisabled: false },
        { systemuserid: ANNELI_ID, fullname: 'Anneli Stone', isdisabled: false },
        { systemuserid: SASKIA_ID, fullname: 'Saskia Pallais', isdisabled: false },
      ],
      totalCount: 3,
      hasMore: false,
    })),
  };
}

test('absent setting preserves the exact role-backed matrix fallback', async () => {
  const dependencies = harness();
  await expect(resolveFinalWriteupMatrixAudiences(dependencies)).resolves.toEqual({
    mode: 'role-default',
    fallbackReviewers: [
      { reviewerId: ALLISON_ID, name: 'Allison Keller', initials: 'AK' },
      { reviewerId: ANNELI_ID, name: 'Anneli Stone', initials: 'AS' },
      { reviewerId: SASKIA_ID, name: 'Saskia Pallais', initials: 'SP' },
    ],
    programs: [],
  });
  expect(dependencies.listGrantPrograms).not.toHaveBeenCalled();
});

test('version 1 remains readable and Admin returns a v2 migration draft without changing programs', async () => {
  const dependencies = harness(v1Config());
  const matrix = await resolveFinalWriteupMatrixAudiences(dependencies);
  expect(matrix.programs).toEqual([
    {
      grantProgramId: RESEARCH_ID,
      reviewers: [{ reviewerId: ALLISON_ID, name: 'Allison Keller', initials: 'AK' }],
    },
    {
      grantProgramId: SOCAL_ID,
      reviewers: [
        { reviewerId: ANNELI_ID, name: 'Anneli Stone', initials: 'AS' },
        { reviewerId: SASKIA_ID, name: 'Saskia Pallais', initials: 'SP' },
      ],
    },
  ]);

  const admin = await getFinalWriteupMatrixAudienceAdminState(dependencies);
  expect(admin).toMatchObject({
    configured: true,
    storedVersion: 1,
    migrationRequired: true,
    revision: 'W/"1"',
    config: {
      version: 2,
      programs: validateFinalWriteupMatrixAudienceConfig(v1Config()).programs,
    },
    unassignedReviewerIds: [],
  });
  expect(admin.config.personas).toEqual([
    { reviewerId: ANNELI_ID, roles: ['program-director'] },
    { reviewerId: SASKIA_ID, roles: ['program-director'] },
    { reviewerId: ALLISON_ID, roles: ['leadership'] },
  ].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)));
});

test('configured state fails closed when the setting row has no revision', async () => {
  const dependencies = harness(v1Config());
  dependencies.getSettingStrict.mockResolvedValue({
    found: true,
    value: JSON.stringify(v1Config()),
    revision: null,
  });
  await expect(resolveFinalWriteupMatrixAudiences(dependencies)).rejects.toMatchObject({
    httpStatus: 503,
    body: { code: 'final_writeup_staffing_revision_unavailable' },
  });
});

test('runtime matrix prunes departed reviewers and inactive programs with explicit warnings', async () => {
  const dependencies = harness(v2Config());
  dependencies.listReviewers.mockResolvedValue({
    records: [{ systemuserid: ALLISON_ID, fullname: 'Allison Keller', isdisabled: false }],
    totalCount: 1,
    hasMore: false,
  });
  dependencies.listGrantPrograms.mockResolvedValue({
    records: [{ wmkf_grantprogramid: RESEARCH_ID, wmkf_name: 'Research', statecode: 0 }],
    totalCount: 1,
    hasMore: false,
  });

  const result = await resolveFinalWriteupMatrixAudiences(dependencies);
  expect(result.programs).toEqual([{
    grantProgramId: RESEARCH_ID,
    reviewers: [{ reviewerId: ALLISON_ID, name: 'Allison Keller', initials: 'AK' }],
  }]);
  expect(result.warnings).toEqual({
    staleReferences: {
      grantProgramIds: [SOCAL_ID],
      reviewerIds: [ANNELI_ID, SASKIA_ID],
    },
  });
});

test('persona runtime state prunes stale assignments and keeps the current roster explicit', async () => {
  const dependencies = harness(v2Config());
  dependencies.listReviewers.mockResolvedValue({
    records: [
      { systemuserid: ALLISON_ID, fullname: 'Allison Keller', isdisabled: false },
      { systemuserid: SASKIA_ID, fullname: 'Saskia Pallais', isdisabled: false },
    ],
    totalCount: 2,
    hasMore: false,
  });
  await expect(getFinalWriteupPersonaRuntimeState(dependencies)).resolves.toEqual({
    version: 2,
    assignments: [
      { reviewerId: SASKIA_ID, roles: [] },
      { reviewerId: ALLISON_ID, roles: ['leadership'] },
    ].sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
    reviewerIds: [ALLISON_ID, SASKIA_ID],
    warnings: ['final_writeup_persona_stale_assignments_pruned'],
  });
});

test('publish accepts explicit no-lens, requires complete roster coverage, and rejects v1 writes', async () => {
  const dependencies = harness(v1Config());
  await expect(writeFinalWriteupMatrixAudienceConfig(
    v1Config(),
    'W/"1"',
    7,
    dependencies,
  )).rejects.toMatchObject({
    httpStatus: 400,
    body: { code: 'final_writeup_staffing_config_rejected' },
  });

  const incomplete = v2Config();
  incomplete.personas = incomplete.personas.filter((item) => item.reviewerId !== SASKIA_ID);
  await expect(writeFinalWriteupMatrixAudienceConfig(
    incomplete,
    'W/"1"',
    7,
    dependencies,
  )).rejects.toMatchObject({
    httpStatus: 409,
    body: {
      code: 'final_writeup_staffing_roster_incomplete',
      unassignedReviewerIds: [SASKIA_ID],
    },
  });
  expect(dependencies.setSettingIfUnchanged).not.toHaveBeenCalled();
});

test('publish rejects unknown program or role references before the Dataverse write', async () => {
  const dependencies = harness(v1Config());
  const next = v2Config();
  next.programs[0].grantProgramId = '10000000-0000-4000-8000-000000000099';
  await expect(writeFinalWriteupMatrixAudienceConfig(
    next,
    'W/"1"',
    7,
    dependencies,
  )).rejects.toMatchObject({
    httpStatus: 409,
    body: {
      code: 'final_writeup_staffing_reference_invalid',
      staleReferences: {
        grantProgramIds: ['10000000-0000-4000-8000-000000000099'],
        reviewerIds: [],
      },
    },
  });
  expect(dependencies.setSettingIfUnchanged).not.toHaveBeenCalled();
});

test('publish atomically replaces the setting and rereads the v2 state', async () => {
  const dependencies = harness(v1Config());
  const next = v2Config();
  dependencies.setSettingIfUnchanged.mockImplementation(async (_key, value) => {
    dependencies.getSettingStrict.mockResolvedValue({ found: true, value, revision: 'W/"2"' });
    return true;
  });
  const result = await writeFinalWriteupMatrixAudienceConfig(next, 'W/"1"', 7, dependencies);
  const canonical = validateFinalWriteupMatrixAudienceConfig(next, { writableOnly: true });
  expect(dependencies.setSettingIfUnchanged).toHaveBeenCalledWith(
    FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
    JSON.stringify(canonical),
    'W/"1"',
    7,
  );
  expect(result).toMatchObject({
    configured: true,
    storedVersion: 2,
    migrationRequired: false,
    revision: 'W/"2"',
    config: canonical,
  });
});

test('publish maps stale setting revisions to an actionable conflict', async () => {
  const dependencies = harness(v1Config());
  dependencies.setSettingIfUnchanged.mockRejectedValue(Object.assign(new Error('stale'), {
    code: 'setting_conflict',
    status: 409,
  }));
  await expect(writeFinalWriteupMatrixAudienceConfig(
    v2Config(),
    'W/"1"',
    7,
    dependencies,
  )).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'final_writeup_staffing_revision_conflict' },
  });
});

test('repair replaces malformed stored JSON by exact ETag without parsing it first', async () => {
  const dependencies = harness();
  let value = '{malformed';
  let revision = 'W/"broken"';
  dependencies.getSettingStrict.mockImplementation(async () => ({
    found: true,
    value,
    revision,
  }));
  dependencies.setSettingIfUnchanged.mockImplementation(async (_key, nextValue, expectedRevision) => {
    expect(expectedRevision).toBe('W/"broken"');
    value = nextValue;
    revision = 'W/"repaired"';
    return true;
  });

  await expect(replaceFinalWriteupMatrixAudienceConfigByRevision(
    v1Config(),
    'W/"broken"',
    null,
    dependencies,
  )).resolves.toEqual({
    config: validateFinalWriteupMatrixAudienceConfig(v1Config()),
    revision: 'W/"repaired"',
  });
  expect(dependencies.getSettingStrict).toHaveBeenCalledTimes(1);
});

test('validator rejects unknown keys, duplicates, empty audiences, and unknown roles', () => {
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    version: 2,
    personas: [],
    programs: [],
  })).toThrow(/at least one Grant Program/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    ...v2Config(),
    extra: true,
  })).toThrow(/missing or unknown fields/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    ...v2Config(),
    personas: [
      { reviewerId: ALLISON_ID, roles: ['leadership'] },
      { reviewerId: ALLISON_ID, roles: [] },
    ],
  })).toThrow(/Duplicate staff assignment/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    ...v2Config(),
    personas: [{ reviewerId: ALLISON_ID, roles: ['executive'] }],
  })).toThrow(/Unknown Final Writeup responsibility/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    ...v2Config(),
    programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [] }],
  })).toThrow(/at least one reviewer/);
});
