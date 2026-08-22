import {
  buildPreSiteVisitIdentity,
  buildPreSiteVisitInputSnapshot,
  generatePreSiteVisitArtifact,
  getPreSiteVisitArtifactStatus,
  projectPreSiteVisitArtifact,
  projectReopenHistory,
  SECTION_FIELDS,
} from '../../lib/services/pre-site-visit/artifact-service.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';
import {
  PROMPT_OUTPUT_SCHEMA,
  PROMPT_VARIABLES,
  REQUIRED_SYSTEM_ASSERTIONS,
  USER_PROMPT_TEMPLATE,
} from '../../shared/config/prompts/pre-site-visit-proposal-core.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const PROMPT_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_ID = '55555555-5555-4555-8555-555555555555';

const proposalCore = Object.freeze({
  executiveSummary: 'Executive summary.',
  impactOverview: 'Impact overview.',
  methodologyOverview: 'Methodology overview.',
  personnelOverview: 'Personnel overview.',
  keckFundingRationale: 'Keck rationale.',
  backgroundAndImpact: 'Background and impact.',
  detailedMethodology: 'Detailed methodology.',
  personnelDetails: 'Personnel details.',
});

function inputFixture(overrides = {}) {
  return {
    context: {
      requestId: REQUEST_ID,
      requestNumber: '1002379',
      cycleCode: 'D26',
      projectTitle: 'A test project',
      applicantInstitution: 'Applicant University',
      projectPeriod: { startDate: '2027-01-01', endDate: '2029-12-31' },
      personnel: [
        { name: 'Ada Principal', role: 'Principal Investigator' },
        { name: 'Casey Collaborator', role: 'Co-Principal Investigator' },
      ],
      documentFields: {
        institutionName: 'Applicant University',
        cityState: 'Atlanta, GA',
        internalProgram: 'Medical Research',
        projectTitle: 'A test project',
        meetingDate: 'December 2026',
        requestedAmount: '$900,000',
        programDirector: 'Pat Director',
        invitedAmount: '$1,000,000',
        totalProjectBudget: '$3,500,000',
      },
      ...overrides.context,
    },
    proposalNarrative: {
      filename: 'ProposalNarrative_1002379.pdf',
      text: 'Narrative text '.repeat(20),
      siteId: 'site-id',
      driveId: 'drive-id',
      itemId: 'narrative-item',
      versionId: '1.0',
      contentHash: 'a'.repeat(64),
      ...overrides.proposalNarrative,
    },
  };
}

function promptFixture(variableNames = [
  'request_context_json',
  'proposal_text',
]) {
  return {
    wmkf_ai_promptid: PROMPT_ID,
    wmkf_ai_promptname: PRE_SITE_VISIT_CONTRACT.promptName,
    wmkf_promptversion: 4,
    wmkf_ai_promptvariables: variableNames.length === PROMPT_VARIABLES.variables.length
      && variableNames.every((name, index) => name === PROMPT_VARIABLES.variables[index].name)
      ? JSON.stringify(PROMPT_VARIABLES)
      : JSON.stringify({ variables: variableNames.map((name) => ({ name })) }),
    wmkf_ai_promptoutputschema: JSON.stringify(PROMPT_OUTPUT_SCHEMA),
    wmkf_ai_promptbody: USER_PROMPT_TEMPLATE,
    wmkf_ai_systemprompt: REQUIRED_SYSTEM_ASSERTIONS.join('\n'),
  };
}

test('institution changes alter the immutable Pre-Site artifact identity', () => {
  const formalInputs = inputFixture();
  const akaInputs = inputFixture({
    context: {
      ...formalInputs.context,
      applicantInstitution: 'Applicant U',
      documentFields: {
        ...formalInputs.context.documentFields,
        institutionName: 'Applicant U',
      },
    },
  });
  const promptIdentity = {
    promptId: PROMPT_ID,
    promptName: PRE_SITE_VISIT_CONTRACT.promptName,
    promptVersion: 4,
  };

  const formal = buildPreSiteVisitIdentity({
    requestId: REQUEST_ID,
    inputSnapshot: buildPreSiteVisitInputSnapshot(formalInputs),
    promptIdentity,
  });
  const aka = buildPreSiteVisitIdentity({
    requestId: REQUEST_ID,
    inputSnapshot: buildPreSiteVisitInputSnapshot(akaInputs),
    promptIdentity,
  });

  expect(aka.inputFingerprint).not.toBe(formal.inputFingerprint);
  expect(aka.generationKey).not.toBe(formal.generationKey);
});

test('a guarded reopen cycle prevents later generation from rediscovering the preserved row', () => {
  const inputSnapshot = buildPreSiteVisitInputSnapshot(inputFixture());
  const promptIdentity = {
    promptId: PROMPT_ID,
    promptName: PRE_SITE_VISIT_CONTRACT.promptName,
    promptVersion: 4,
  };
  const original = buildPreSiteVisitIdentity({
    requestId: REQUEST_ID,
    inputSnapshot,
    promptIdentity,
  });
  const reopened = buildPreSiteVisitIdentity({
    requestId: REQUEST_ID,
    inputSnapshot,
    promptIdentity,
    reopenCycleId: '66666666-6666-4666-8666-666666666666',
  });

  expect(reopened.inputFingerprint).toBe(original.inputFingerprint);
  expect(reopened.generationKey).not.toBe(original.generationKey);
});

test('reopen history projects durable actor, reason, source, and milestone evidence', () => {
  const source = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: 'gdc1:handoff',
    wmkf_milestonecreatedat: '2026-08-20T12:00:00Z',
  };
  const successor = {
    ...source,
    wmkf_requestdocumentid: '77777777-7777-4777-8777-777777777777',
    _wmkf_sourcedocument_value: ARTIFACT_ID,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_reopencycleid: '66666666-6666-4666-8666-666666666666',
    wmkf_reopenreasoncode: 'accidental_handoff',
    wmkf_reopenreasonnote: 'The handoff happened too early.',
    _createdby_value: '88888888-8888-4888-8888-888888888888',
    _createdby_value_formatted: 'Test Admin',
    createdon: '2026-08-22T12:00:00Z',
  };

  expect(projectReopenHistory([source, successor])).toEqual([expect.objectContaining({
    artifactId: successor.wmkf_requestdocumentid,
    outcome: 'completed',
    correction: expect.objectContaining({
      cycleId: successor.wmkf_reopencycleid,
      actorName: 'Test Admin',
      reasonCode: 'accidental_handoff',
    }),
    source: expect.objectContaining({
      artifactId: ARTIFACT_ID,
      milestone: expect.objectContaining({ versionId: '2.0' }),
    }),
  })]);
});

test('reopen history marks a retained expired copy as cleanup reconciliation work', () => {
  const row = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_reopencycleid: '66666666-6666-4666-8666-666666666666',
    wmkf_reopenreasoncode: 'accidental_handoff',
    wmkf_reopenreasonnote: 'The claim expired before activation.',
    wmkf_orphancleanupjson: JSON.stringify([{
      driveId: 'expired-drive',
      itemId: 'expired-item',
      reason: 'expired_reopen_attempt_retained',
    }]),
  };

  expect(projectReopenHistory([row])).toEqual([
    expect.objectContaining({
      outcome: 'needs_reconciliation',
      cleanupRequired: [expect.objectContaining({
        driveId: 'expired-drive',
        itemId: 'expired-item',
      })],
    }),
  ]);
});

test('a regenerated descendant carries the cycle without claiming its generator as reopen actor', () => {
  const descendant = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_reopencycleid: '66666666-6666-4666-8666-666666666666',
    wmkf_reopenreasoncode: null,
    _createdby_value: '88888888-8888-4888-8888-888888888888',
    _createdby_value_formatted: 'Later Generator',
    createdon: '2026-08-22T13:00:00Z',
  };

  expect(projectPreSiteVisitArtifact(descendant).correction).toMatchObject({
    cycleId: descendant.wmkf_reopencycleid,
    reasonCode: null,
    actorId: null,
    actorName: null,
    createdAt: null,
  });
});

function createHarness({ mutatePersistedDraft = false, currentPointerRow = null } = {}) {
  let row = null;
  const prior = currentPointerRow ? { ...currentPointerRow } : null;
  const request = {
    akoya_requestid: REQUEST_ID,
    _wmkf_currentpresitevisit_value: prior?.wmkf_requestdocumentid || null,
    _etag: 'request-1',
  };
  let etag = 1;
  let uploaded = null;

  function applyDocumentPatch(target, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'wmkf_AIPrompt@odata.bind') {
        target._wmkf_aiprompt_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else if (key === 'wmkf_AIRun@odata.bind') {
        target._wmkf_airun_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else {
        target[key] = value;
      }
    }
    target._etag = `row-${++etag}`;
    target.modifiedon = new Date().toISOString();
  }

  const dependencies = {
    loadInputs: jest.fn().mockResolvedValue(inputFixture()),
    getCurrentPrompt: jest.fn().mockResolvedValue(promptFixture()),
    runProposalCore: jest.fn().mockResolvedValue({
      proposalCore,
      runId: RUN_ID,
      meta: {
        promptId: PROMPT_ID,
        promptName: PRE_SITE_VISIT_CONTRACT.promptName,
        promptVersion: 4,
        modelUsed: 'claude-opus-test',
      },
    }),
    renderDocx: jest.fn().mockImplementation(async ({ proposalCore: renderedCore }) => {
      if (mutatePersistedDraft) {
        expect(renderedCore.executiveSummary).toBe('Dataverse read-back summary.');
      }
      return Buffer.from('rendered-docx');
    }),
    hashDocx: jest.fn().mockResolvedValue('gdc1:governed-hash'),
    getRequest: jest.fn().mockImplementation(async () => ({ ...request })),
    getBuckets: jest.fn().mockResolvedValue([{
      source: 'dynamics',
      library: 'akoya_request',
      folder: 'Requests/1002379',
    }]),
    findByGenerationKey: jest.fn().mockImplementation(async () => ({
      records: row ? [{ ...row }] : [],
    })),
    findByRequest: jest.fn().mockImplementation(async () => ({
      records: [
        ...(row ? [{ ...row }] : []),
        ...(prior ? [{ ...prior }] : []),
      ],
    })),
    createDocument: jest.fn().mockImplementation(async (payload) => {
      row = {
        ...payload,
        wmkf_requestdocumentid: ARTIFACT_ID,
        _wmkf_request_value: REQUEST_ID,
        _wmkf_aiprompt_value: PROMPT_ID,
        _etag: `row-${etag}`,
        createdon: new Date().toISOString(),
        modifiedon: new Date().toISOString(),
      };
      delete row['wmkf_Request@odata.bind'];
      delete row['wmkf_AIPrompt@odata.bind'];
      return ARTIFACT_ID;
    }),
    updateDocument: jest.fn().mockImplementation(async (id, patch, options) => {
      expect(id).toBe(ARTIFACT_ID);
      expect(options.ifMatch).toBe(row._etag);
      applyDocumentPatch(row, patch);
      if (mutatePersistedDraft && patch.wmkf_presiteproposalcorejson) {
        row[SECTION_FIELDS.executiveSummary] = 'Dataverse read-back summary.';
      }
    }),
    commitChangeset: jest.fn().mockImplementation(async (operations) => {
      for (const operation of operations) {
        if (operation.entitySet === 'wmkf_requestdocuments') {
          applyDocumentPatch(row, operation.body);
        } else if (operation.entitySet === 'akoya_requests') {
          request._wmkf_currentpresitevisit_value = operation.body[
            'wmkf_CurrentPreSiteVisit@odata.bind'
          ].match(/\(([^)]+)\)/)?.[1];
          request._etag = 'request-2';
        }
      }
    }),
    ensureFolderPath: jest.fn().mockResolvedValue(undefined),
    uploadFile: jest.fn().mockImplementation(async () => {
      uploaded = {
        siteId: 'site-id',
        driveId: 'drive-id',
        id: 'uploaded-item',
        webUrl: 'https://sharepoint.test/pre-site.docx',
        versionId: '1.0',
        eTag: 'file-etag',
        size: 1234,
        lastModified: '2026-08-17T12:00:00Z',
        name: row.wmkf_filename,
      };
      return uploaded;
    }),
    getFileMetadataByPath: jest.fn().mockImplementation(async () => uploaded),
    downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('normalized-docx') }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    newClaimToken: jest.fn().mockReturnValue(CLAIM_ID),
    isGuardedReopenSchemaReady: jest.fn().mockReturnValue(true),
  };

  return {
    dependencies,
    get row() { return row; },
    setRow(value) { row = value; },
    get request() { return request; },
    get uploaded() { return uploaded; },
    get currentPointerRow() { return prior; },
  };
}

test('generation cannot replace a draft that becomes the Site Visit workspace in flight', async () => {
  const harness = createHarness({
    currentPointerRow: {
      wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
      _wmkf_request_value: REQUEST_ID,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_filename: '1002379 Pre-Site Visit prior.docx',
      _etag: 'prior-1',
      createdon: '2026-08-21T12:00:00Z',
    },
  });
  const upload = harness.dependencies.uploadFile.getMockImplementation();
  harness.dependencies.uploadFile.mockImplementationOnce(async (...args) => {
    const metadata = await upload(...args);
    harness.currentPointerRow.wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
    harness.currentPointerRow._etag = 'prior-2';
    return metadata;
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_regeneration_locked', httpStatus: 409 });

  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
  expect(harness.request._wmkf_currentpresitevisit_value)
    .toBe(harness.currentPointerRow.wmkf_requestdocumentid);
  expect(harness.currentPointerRow.wmkf_lifecyclestate)
    .toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
});

test('generation cannot supersede a newer guarded-reopen correction cycle', async () => {
  const originalCycle = '66666666-6666-4666-8666-666666666666';
  const newerCycle = '77777777-7777-4777-8777-777777777777';
  const harness = createHarness({
    currentPointerRow: {
      wmkf_requestdocumentid: '88888888-8888-4888-8888-888888888888',
      _wmkf_request_value: REQUEST_ID,
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
      wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_reopencycleid: originalCycle,
      wmkf_filename: '1002379 Pre-Site Visit correction.docx',
      _etag: 'correction-1',
      createdon: '2026-08-21T12:00:00Z',
    },
  });
  const upload = harness.dependencies.uploadFile.getMockImplementation();
  harness.dependencies.uploadFile.mockImplementationOnce(async (...args) => {
    const metadata = await upload(...args);
    harness.currentPointerRow.wmkf_reopencycleid = newerCycle;
    harness.currentPointerRow._etag = 'correction-2';
    return metadata;
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({
    code: 'pre_site_visit_correction_cycle_changed',
    httpStatus: 409,
  });

  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument.mock.calls[0][0])
    .toHaveProperty('wmkf_reopencycleid', originalCycle);
  expect(harness.request._wmkf_currentpresitevisit_value)
    .toBe(harness.currentPointerRow.wmkf_requestdocumentid);
  expect(harness.currentPointerRow.wmkf_reopencycleid).toBe(newerCycle);
});

test('flag-off generation omits the Wave 20 correction-cycle property from its create payload', async () => {
  const harness = createHarness();
  harness.dependencies.isGuardedReopenSchemaReady.mockReturnValue(false);

  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);

  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.createDocument.mock.calls[0][0])
    .not.toHaveProperty('wmkf_reopencycleid');
});

test('missing exact source identity stops before claim, Claude, render, or upload', async () => {
  const harness = createHarness();
  harness.dependencies.loadInputs.mockResolvedValueOnce(inputFixture({
    proposalNarrative: { versionId: null },
  }));

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_source_identity_incomplete' });

  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
  expect(harness.dependencies.renderDocx).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
});

test('legacy prompt with a bibliography variable stops before claim or Claude', async () => {
  const harness = createHarness();
  harness.dependencies.getCurrentPrompt.mockResolvedValueOnce(promptFixture([
    'request_context_json',
    'proposal_text',
    'proposal_bibliography',
  ]));

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_prompt_not_ready', httpStatus: 409 });

  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
});

test('a current prompt with the retired 700-character schema stops before claim or Claude', async () => {
  const harness = createHarness();
  const staleSchema = JSON.parse(JSON.stringify(PROMPT_OUTPUT_SCHEMA));
  staleSchema.jsonSchema.properties.proposalCore.properties.executiveSummary.maxLength = 700;
  staleSchema.validationSchema.fields.proposalCore.fields.executiveSummary.maxLength = 700;
  harness.dependencies.getCurrentPrompt.mockResolvedValueOnce({
    ...promptFixture(),
    wmkf_ai_promptoutputschema: JSON.stringify(staleSchema),
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_prompt_not_ready', httpStatus: 409 });

  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
});

test('persists eight sections and snapshots, renders the Dataverse read-back, then activates', async () => {
  const harness = createHarness();
  const result = await generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(result).toMatchObject({
    reused: false,
    recovered: false,
    artifact: {
      artifactId: ARTIFACT_ID,
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      file: { itemId: 'uploaded-item' },
      provenance: { runId: RUN_ID, promptId: PROMPT_ID },
    },
  });
  expect(harness.row.wmkf_presiteproposalcorejson).toContain('"schemaVersion":3');
  expect(harness.row.wmkf_presiteinputsnapshotjson).not.toContain('Narrative text');
  expect(harness.row.wmkf_presiteinputsnapshotjson).toContain('ProposalNarrative_1002379.pdf');
  expect(harness.row.wmkf_renderinputfingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(ARTIFACT_ID);
  expect(harness.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
});

test('fails closed when named fields diverge from the audited proposal-core envelope', async () => {
  const harness = createHarness({ mutatePersistedDraft: true });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({
    code: 'pre_site_visit_core_reconciliation_required',
    httpStatus: 409,
  });
  expect(harness.dependencies.renderDocx).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
});

test('identical Ready retry does not rerun Claude, render, or upload', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  const firstCounts = {
    prompt: harness.dependencies.runProposalCore.mock.calls.length,
    render: harness.dependencies.renderDocx.mock.calls.length,
    upload: harness.dependencies.uploadFile.mock.calls.length,
  };

  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);

  expect(retry.reused).toBe(true);
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(firstCounts.prompt);
  expect(harness.dependencies.renderDocx).toHaveBeenCalledTimes(firstCounts.render);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(firstCounts.upload);
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(1);
});

test('read-only status returns the current Ready artifact without generation side effects', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  const sideEffectCounts = {
    create: harness.dependencies.createDocument.mock.calls.length,
    update: harness.dependencies.updateDocument.mock.calls.length,
    run: harness.dependencies.runProposalCore.mock.calls.length,
    render: harness.dependencies.renderDocx.mock.calls.length,
    upload: harness.dependencies.uploadFile.mock.calls.length,
  };

  const status = await getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(status).toMatchObject({
    currentArtifact: {
      artifactId: ARTIFACT_ID,
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    },
    pendingArtifact: null,
  });
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(sideEffectCounts.create);
  expect(harness.dependencies.updateDocument).toHaveBeenCalledTimes(sideEffectCounts.update);
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(sideEffectCounts.run);
  expect(harness.dependencies.renderDocx).toHaveBeenCalledTimes(sideEffectCounts.render);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(sideEffectCounts.upload);
});

test('schema-v2 proposal cores remain readable and derive available warnings', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  harness.row.wmkf_presiteproposalcorejson = JSON.stringify({
    schemaVersion: 2,
    proposalCore,
  });

  const status = await getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(status.currentArtifact.warnings).toEqual(expect.arrayContaining([
    expect.objectContaining({ code: 'personnel_name_not_matched' }),
  ]));
  expect(status.currentArtifact.warnings)
    .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'proposal_input_truncated' })]));
});

test('schema-v3 warnings project consistently on completion and Ready reuse', async () => {
  const harness = createHarness();
  harness.dependencies.runProposalCore.mockResolvedValueOnce({
    proposalCore: {
      ...proposalCore,
      executiveSummary: 'Long but usable. '.repeat(60),
    },
    diagnostics: [{
      code: 'proposal_input_truncated',
      originalChars: 120000,
      transmittedChars: 100000,
    }],
    runId: RUN_ID,
    meta: {
      promptId: PROMPT_ID,
      promptName: PRE_SITE_VISIT_CONTRACT.promptName,
      promptVersion: 4,
    },
  });

  const first = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);

  for (const result of [first, retry]) {
    expect(result.artifact.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'section_over_target', section: 'executiveSummary' }),
      expect.objectContaining({ code: 'proposal_input_truncated', originalChars: 120000 }),
    ]));
  }
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
});

test('read-only status exposes an in-progress replacement alongside the current artifact', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  const current = { ...harness.row };
  const pending = {
    ...current,
    wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    createdon: new Date(Date.parse(current.createdon) + 60_000).toISOString(),
  };
  harness.dependencies.findByRequest.mockResolvedValueOnce({ records: [pending, current] });

  const status = await getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(status.currentArtifact.artifactId).toBe(ARTIFACT_ID);
  expect(status.pendingArtifact).toMatchObject({
    artifactId: pending.wmkf_requestdocumentid,
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
  });
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
});

test('read-only status ignores an older failed attempt after a newer Ready draft', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  const current = { ...harness.row, createdon: '2026-08-17T20:00:00Z' };
  const olderFailed = {
    ...current,
    wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_sharepointitemid: null,
    wmkf_sharepointweburl: null,
    createdon: '2026-08-17T19:00:00Z',
  };
  harness.dependencies.findByRequest.mockResolvedValueOnce({ records: [current, olderFailed] });

  const status = await getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(status.currentArtifact.artifactId).toBe(ARTIFACT_ID);
  expect(status.pendingArtifact).toBeNull();
});

test('read-only status fails closed when a Ready Word row has no current pointer', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  harness.request._wmkf_currentpresitevisit_value = null;

  await expect(getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_pointer_missing', httpStatus: 409 });
});

test('bibliography metadata does not change the PSV generation identity', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  harness.dependencies.loadInputs.mockResolvedValueOnce({
    ...inputFixture(),
    proposalBibliography: {
      filename: 'ProposalBibliography_1002379.pdf',
      versionId: 'changed-bibliography-version',
      contentHash: 'b'.repeat(64),
    },
  });

  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);

  expect(retry.reused).toBe(true);
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
});

test('failed upload retry reuses persisted Claude output and remains retryable', async () => {
  const harness = createHarness();
  harness.dependencies.uploadFile
    .mockRejectedValueOnce(new Error('Graph upload unavailable'))
    .mockImplementationOnce(async () => ({
      siteId: 'site-id',
      driveId: 'drive-id',
      id: 'retry-item',
      webUrl: 'https://sharepoint.test/retry.docx',
      versionId: '1.0',
      eTag: 'retry-etag',
      size: 1234,
      lastModified: '2026-08-17T12:00:00Z',
      name: harness.row.wmkf_filename,
    }));

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ httpStatus: 500 });
  expect(harness.row.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  expect(harness.row._wmkf_airun_value).toBe(RUN_ID);

  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  expect(retry.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(2);
});

test('failed Executor audit can retry instead of becoming an incomplete-draft dead end', async () => {
  const harness = createHarness();
  const promptError = Object.assign(new Error('Claude unavailable'), { runId: RUN_ID });
  harness.dependencies.runProposalCore.mockRejectedValueOnce(promptError);

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ httpStatus: 500 });
  expect(harness.row._wmkf_airun_value).toBe(RUN_ID);
  expect(harness.row.wmkf_presiteproposalcorejson).toBeUndefined();

  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  expect(retry.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.READY);
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(2);
});

test.each([
  ['whitespace-only content', { executiveSummary: '  \n\t ' }, 'pre_site_visit_prompt_empty_section'],
  ['literal reserved token', { executiveSummary: 'Text [[DV:ProjectTitle]]' }, 'pre_site_visit_prompt_reserved_token'],
])('%s never becomes a reusable persisted core', async (_label, coreOverride, code) => {
  const harness = createHarness();
  harness.dependencies.runProposalCore.mockResolvedValueOnce({
    proposalCore: { ...proposalCore, ...coreOverride },
    runId: RUN_ID,
    meta: {
      promptId: PROMPT_ID,
      promptName: PRE_SITE_VISIT_CONTRACT.promptName,
      promptVersion: 4,
    },
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code });
  expect(harness.row.wmkf_presiteproposalcorejson).toBeUndefined();
  expect(harness.row.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  expect(harness.row.wmkf_lasterrorcode).toBe(code);

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_retry_requires_change' });
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
});

test.each([
  'pre_site_visit_draft_incomplete',
  'pre_site_visit_snapshot_mismatch',
])('%s blocks an unchanged retry before claim or Claude', async (code) => {
  const harness = createHarness();
  const inputs = inputFixture();
  const inputSnapshot = buildPreSiteVisitInputSnapshot(inputs);
  const identity = buildPreSiteVisitIdentity({
    requestId: REQUEST_ID,
    inputSnapshot,
    promptIdentity: {
      promptId: PROMPT_ID,
      promptName: PRE_SITE_VISIT_CONTRACT.promptName,
      promptVersion: 4,
    },
  });
  harness.setRow({
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: identity.generationKey,
    wmkf_inputfingerprint: identity.inputFingerprint,
    wmkf_lasterrorcode: code,
    wmkf_lasterrormessage: 'Persisted draft state requires reconciliation.',
    wmkf_lastfailedat: '2026-08-18T12:00:00Z',
    _etag: 'row-1',
    createdon: '2026-08-18T12:00:00Z',
    modifiedon: '2026-08-18T12:00:00Z',
  });

  await expect(getPreSiteVisitArtifactStatus(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).resolves.toMatchObject({ pendingArtifact: { retryable: false } });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_retry_requires_change' });
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
});

test('post-upload finalization retry recovers the same item without Claude or a second upload', async () => {
  const harness = createHarness();
  harness.dependencies.commitChangeset.mockImplementationOnce(async () => {
    throw new Error('Dataverse response lost');
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ httpStatus: 500 });
  expect(harness.row.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  expect(harness.uploaded).not.toBeNull();

  const retry = await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  expect(retry).toMatchObject({ reused: true, recovered: true });
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.downloadFile).toHaveBeenCalledTimes(1);
});

test('prompt race marks the claimed row Failed before render or upload', async () => {
  const harness = createHarness();
  harness.dependencies.runProposalCore.mockResolvedValueOnce({
    proposalCore,
    runId: RUN_ID,
    meta: {
      promptId: PROMPT_ID,
      promptName: PRE_SITE_VISIT_CONTRACT.promptName,
      promptVersion: 5,
    },
  });

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_prompt_changed' });
  expect(harness.row.wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  expect(harness.row._wmkf_airun_value).toBe(RUN_ID);
  expect(harness.dependencies.renderDocx).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
});

test('unknown artifact type fails closed instead of falling through as reusable', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  harness.row.wmkf_artifacttype = REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP;

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_visit_pointer_invalid', httpStatus: 409 });
  expect(harness.dependencies.runProposalCore).toHaveBeenCalledTimes(1);
});

test('Site Visit promotion locks regeneration before inputs, prompt, Claude, render, or upload', async () => {
  const harness = createHarness();
  await generatePreSiteVisitArtifact({ requestId: REQUEST_ID }, harness.dependencies);
  harness.row.wmkf_lifecyclestate = REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW;
  jest.clearAllMocks();

  await expect(generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  )).rejects.toMatchObject({
    code: 'pre_site_visit_regeneration_locked',
    httpStatus: 409,
  });

  expect(harness.dependencies.loadInputs).not.toHaveBeenCalled();
  expect(harness.dependencies.getCurrentPrompt).not.toHaveBeenCalled();
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.renderDocx).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
});


test('alternate-key create race returns the winning claim without a second Claude call', async () => {
  const harness = createHarness();
  harness.dependencies.createDocument.mockImplementationOnce(async (payload) => {
    harness.setRow({
      ...payload,
      wmkf_requestdocumentid: ARTIFACT_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_aiprompt_value: PROMPT_ID,
      wmkf_claimtoken: '66666666-6666-4666-8666-666666666666',
      _etag: 'winner-row',
      createdon: new Date().toISOString(),
      modifiedon: new Date().toISOString(),
    });
    const error = new Error('alternate key duplicate');
    error.status = 409;
    throw error;
  });

  const result = await generatePreSiteVisitArtifact(
    { requestId: REQUEST_ID },
    harness.dependencies,
  );

  expect(result).toMatchObject({ reused: true, recovered: false });
  expect(result.artifact.operationStatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING);
  expect(harness.dependencies.runProposalCore).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
});
