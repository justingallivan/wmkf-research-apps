/** @jest-environment node */

import {
  FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
  getFinalWriteupMatrixAudienceAdminState,
  resolveFinalWriteupMatrixAudiences,
  validateFinalWriteupMatrixAudienceConfig,
  writeFinalWriteupMatrixAudienceConfig,
} from '../../lib/services/final-writeup/matrix-audience-service.js';

const RESEARCH_ID = '10000000-0000-4000-8000-000000000001';
const SOCAL_ID = '10000000-0000-4000-8000-000000000002';
const ADA_ID = '20000000-0000-4000-8000-000000000001';
const ANNELI_ID = '20000000-0000-4000-8000-000000000002';
const SASKIA_ID = '20000000-0000-4000-8000-000000000003';

function config() {
  return {
    version: 1,
    programs: [
      { grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] },
      { grantProgramId: SOCAL_ID, reviewerIds: [ANNELI_ID, SASKIA_ID] },
    ],
  };
}

function harness(stored = null) {
  const dependencies = {
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
        { systemuserid: ADA_ID, fullname: 'Ada Reviewer', isdisabled: false },
        { systemuserid: ANNELI_ID, fullname: 'Anneli Stone', isdisabled: false },
        { systemuserid: SASKIA_ID, fullname: 'Saskia Pallais', isdisabled: false },
      ],
      totalCount: 3,
      hasMore: false,
    })),
  };
  return dependencies;
}

test('absent setting preserves the role-backed matrix until first publication', async () => {
  const dependencies = harness();
  const result = await resolveFinalWriteupMatrixAudiences(dependencies);

  expect(result.mode).toBe('role-default');
  expect(result.fallbackReviewers.map((reviewer) => reviewer.name)).toEqual([
    'Ada Reviewer',
    'Anneli Stone',
    'Saskia Pallais',
  ]);
  expect(result.programs).toEqual([]);
  expect(dependencies.listGrantPrograms).not.toHaveBeenCalled();
});

test('configured audiences resolve stable reviewer ids to live role names', async () => {
  const dependencies = harness(config());
  const result = await resolveFinalWriteupMatrixAudiences(dependencies);

  expect(result.mode).toBe('configured');
  expect(result.programs).toEqual([
    {
      grantProgramId: RESEARCH_ID,
      reviewers: [{ reviewerId: ADA_ID, name: 'Ada Reviewer', initials: 'AR' }],
    },
    {
      grantProgramId: SOCAL_ID,
      reviewers: [
        { reviewerId: ANNELI_ID, name: 'Anneli Stone', initials: 'AS' },
        { reviewerId: SASKIA_ID, name: 'Saskia Pallais', initials: 'SP' },
      ],
    },
  ]);
});

test('configured audience fails closed when the setting row has no revision', async () => {
  const dependencies = harness(config());
  dependencies.getSettingStrict.mockResolvedValue({
    found: true,
    value: JSON.stringify(config()),
    revision: null,
  });

  await expect(resolveFinalWriteupMatrixAudiences(dependencies)).rejects.toMatchObject({
    httpStatus: 503,
    body: { code: 'final_writeup_matrix_audience_revision_unavailable' },
  });
});

test('configured audience fails closed when a saved reviewer leaves the exact role', async () => {
  const dependencies = harness(config());
  dependencies.listReviewers.mockResolvedValue({
    records: [{ systemuserid: ADA_ID, fullname: 'Ada Reviewer', isdisabled: false }],
    totalCount: 1,
    hasMore: false,
  });

  await expect(resolveFinalWriteupMatrixAudiences(dependencies)).rejects.toMatchObject({
    httpStatus: 503,
    body: {
      code: 'final_writeup_matrix_audience_reviewer_stale',
      staleReviewerIds: [ANNELI_ID, SASKIA_ID],
    },
  });
});

test('configured audience fails closed when a saved Grant Program is no longer active', async () => {
  const dependencies = harness(config());
  dependencies.listGrantPrograms.mockResolvedValue({
    records: [{ wmkf_grantprogramid: RESEARCH_ID, wmkf_name: 'Research', statecode: 0 }],
    totalCount: 1,
    hasMore: false,
  });

  await expect(resolveFinalWriteupMatrixAudiences(dependencies)).rejects.toMatchObject({
    httpStatus: 503,
    body: {
      code: 'final_writeup_matrix_audience_program_stale',
      staleGrantProgramIds: [SOCAL_ID],
    },
  });
});

test('admin state returns live catalogs and explicit stale references for repair', async () => {
  const dependencies = harness(config());
  dependencies.listReviewers.mockResolvedValue({
    records: [
      { systemuserid: ADA_ID, fullname: 'Ada Reviewer', isdisabled: false },
      { systemuserid: ANNELI_ID, fullname: 'Anneli Stone', isdisabled: false },
    ],
    totalCount: 2,
    hasMore: false,
  });
  const result = await getFinalWriteupMatrixAudienceAdminState(dependencies);

  expect(result.configured).toBe(true);
  expect(result.programs.map((program) => program.name)).toEqual(['Research', 'Southern California']);
  expect(result.staleReferences).toEqual({ grantProgramIds: [], reviewerIds: [SASKIA_ID] });
});

test('save rejects unknown program or role references before the Dataverse write', async () => {
  const dependencies = harness();
  const unknownProgram = '10000000-0000-4000-8000-000000000099';
  await expect(writeFinalWriteupMatrixAudienceConfig({
    version: 1,
    programs: [{ grantProgramId: unknownProgram, reviewerIds: [ADA_ID] }],
  }, null, 7, dependencies)).rejects.toMatchObject({
    httpStatus: 409,
    body: {
      code: 'final_writeup_matrix_audience_reference_invalid',
      staleReferences: { grantProgramIds: [unknownProgram], reviewerIds: [] },
    },
  });
  expect(dependencies.setSettingIfUnchanged).not.toHaveBeenCalled();
});

test('save replaces the one versioned setting and rereads the published state', async () => {
  const dependencies = harness();
  const next = config();
  dependencies.setSettingIfUnchanged.mockImplementation(async (_key, value) => {
    dependencies.getSettingStrict.mockResolvedValue({ found: true, value, revision: 'W/"2"' });
    return true;
  });
  const result = await writeFinalWriteupMatrixAudienceConfig(next, null, 7, dependencies);

  expect(dependencies.setSettingIfUnchanged).toHaveBeenCalledWith(
    FINAL_WRITEUP_MATRIX_AUDIENCE_SETTING_KEY,
    JSON.stringify(validateFinalWriteupMatrixAudienceConfig(next)),
    null,
    7,
  );
  expect(result.configured).toBe(true);
  expect(result.revision).toBe('W/"2"');
  expect(result.config).toEqual(validateFinalWriteupMatrixAudienceConfig(next));
});

test('save maps a stale setting revision to an explicit admin conflict', async () => {
  const dependencies = harness(config());
  dependencies.setSettingIfUnchanged.mockRejectedValue(Object.assign(new Error('stale'), {
    code: 'setting_conflict',
    status: 409,
  }));

  await expect(writeFinalWriteupMatrixAudienceConfig(
    config(),
    'W/"1"',
    7,
    dependencies,
  )).rejects.toMatchObject({
    httpStatus: 409,
    body: { code: 'final_writeup_matrix_audience_revision_conflict' },
  });
});

test('validator rejects duplicate programs, duplicate reviewers, and empty audiences', () => {
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    version: 1,
    programs: [],
  })).toThrow(/at least one Grant Program/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    version: 1,
    programs: [
      { grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID] },
      { grantProgramId: RESEARCH_ID, reviewerIds: [ANNELI_ID] },
    ],
  })).toThrow(/Duplicate Grant Program/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    version: 1,
    programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [ADA_ID, ADA_ID] }],
  })).toThrow(/Duplicate reviewer/);
  expect(() => validateFinalWriteupMatrixAudienceConfig({
    version: 1,
    programs: [{ grantProgramId: RESEARCH_ID, reviewerIds: [] }],
  })).toThrow(/at least one reviewer/);
});
