import {
  buildFinalWriteupGenerationKey,
  getFinalWriteupStatus,
  startFinalWriteup,
} from '../../lib/services/final-writeup/transition-service.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const FINAL_ID = '33333333-3333-4333-8333-333333333333';
const COMPETING_ID = '66666666-6666-4666-8666-666666666666';
const LEAD_PD_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';

function createHarness({ actorId = LEAD_PD_ID, schemaReady = true } = {}) {
  const request = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002379',
    _wmkf_programdirector_value: LEAD_PD_ID,
    _wmkf_currentpresitevisit_value: SOURCE_ID,
    _wmkf_currentfinalwriteup_value: null,
    _etag: 'request-etag-1',
  };
  const source = {
    wmkf_requestdocumentid: SOURCE_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_generationkey: 'source-generation',
    wmkf_cyclecode: '2026-FALL',
    wmkf_inputfingerprint: 'source-input',
    wmkf_renderinputfingerprint: 'source-render',
    wmkf_producer: 'request-workbench',
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointsiteid: 'site-id',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/site-visit.docx',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: 'file-etag-1',
    wmkf_sharepointfolderpath: 'Requests/1002379/Artifacts/Pre-Site Visit',
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_filesize: 1200,
    wmkf_sharepointlastmodified: '2026-08-30T18:00:00Z',
    _etag: 'source-etag-1',
  };
  const rows = [source];
  const metadata = {
    siteId: 'site-id',
    driveId: 'drive-id',
    id: 'item-id',
    name: '1002379 Pre-Site Visit.docx',
    size: 1300,
    webUrl: 'https://sharepoint.test/site-visit.docx',
    eTag: 'file-etag-2',
    versionId: '2.0',
    lastModified: '2026-08-30T19:00:00Z',
    mimeType: PRE_SITE_VISIT_CONTRACT.contentType,
  };
  const dependencies = {
    schemaReady: jest.fn().mockReturnValue(schemaReady),
    getRequest: jest.fn().mockImplementation(async () => ({ ...request })),
    findByRequest: jest.fn().mockImplementation(async () => ({
      records: rows.map((row) => ({ ...row })),
    })),
    findByGenerationKey: jest.fn().mockImplementation(async (key) => ({
      records: rows.filter((row) => row.wmkf_generationkey === key).map((row) => ({ ...row })),
    })),
    createDocument: jest.fn().mockImplementation(async (payload) => {
      rows.push({
        ...payload,
        wmkf_requestdocumentid: FINAL_ID,
        _wmkf_request_value: REQUEST_ID,
        _wmkf_sourcedocument_value: SOURCE_ID,
        createdon: '2026-08-30T19:05:00Z',
        modifiedon: '2026-08-30T19:05:00Z',
        _etag: 'final-etag-1',
      });
      return { id: FINAL_ID };
    }),
    updateDocument: jest.fn().mockImplementation(async (id, patch) => {
      const row = rows.find((candidate) => candidate.wmkf_requestdocumentid === id);
      Object.assign(row, patch, { modifiedon: '2026-08-30T19:06:00Z', _etag: 'final-etag-2' });
    }),
    commitChangeset: jest.fn().mockImplementation(async (operations) => {
      const sourcePatch = operations[0].body;
      const finalPatch = operations[1].body;
      const requestPatch = operations[2].body;
      const final = rows.find((row) => row.wmkf_requestdocumentid === FINAL_ID);
      Object.assign(source, sourcePatch, { _etag: 'source-etag-2' });
      Object.assign(final, finalPatch, {
        _wmkf_groupreviewstartedby_value: actorId,
        _etag: 'final-etag-3',
      });
      request._wmkf_currentfinalwriteup_value = requestPatch['wmkf_CurrentFinalWriteup@odata.bind']
        .match(/\(([^)]+)\)/)[1];
      request._etag = 'request-etag-2';
      return { ok: true, operations: [] };
    }),
    getFileMetadataById: jest.fn().mockImplementation(async () => ({ ...metadata })),
    downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('valid-docx') }),
    hashDocx: jest.fn().mockResolvedValue('gdc1:final-source-hash'),
    newClaimToken: jest.fn().mockReturnValue('claim-token'),
    now: jest.fn().mockReturnValue(new Date('2026-08-30T19:05:00Z')),
    resolveActor: jest.fn().mockResolvedValue({
      schemaReady: false,
      actorId: null,
      reason: 'schema-not-ready',
    }),
  };
  return { request, source, rows, metadata, dependencies, actorId };
}

test('Wave 24 strict mode rejects an unverified actor before Graph or Dataverse writes', async () => {
  const harness = createHarness();
  harness.dependencies.resolveActor.mockRejectedValue(Object.assign(
    new Error('identity unavailable'),
    { httpStatus: 403, code: 'request_document_actor_unavailable' },
  ));

  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    httpStatus: 403,
    code: 'request_document_actor_unavailable',
  });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('moves the same stable Word item into one Ready/Review Final row atomically', async () => {
  const harness = createHarness();
  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({
    reused: false,
    inProgress: false,
    artifact: {
      artifactId: FINAL_ID,
      sourceArtifactId: SOURCE_ID,
      operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
      lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      file: { driveId: 'drive-id', itemId: 'item-id', versionId: '2.0' },
      groupReview: {
        startedAt: '2026-08-30T19:05:00.000Z',
        startedById: LEAD_PD_ID,
      },
    },
  });
  expect(harness.dependencies.createDocument).toHaveBeenCalledWith(
    expect.objectContaining({
      wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
      wmkf_sourceversionid: '2.0',
      wmkf_sourcecontenthash: 'gdc1:final-source-hash',
      wmkf_sharepointdriveid: 'drive-id',
      wmkf_sharepointitemid: 'item-id',
      'wmkf_SourceDocument@odata.bind': `/wmkf_requestdocuments(${SOURCE_ID})`,
    }),
    expect.objectContaining({
      actingUserSystemId: LEAD_PD_ID,
      actorPolicy: 'required',
      actorContext: expect.objectContaining({
        operation: 'final-writeup-claim',
        requestId: REQUEST_ID,
      }),
    }),
  );
  expect(harness.dependencies.commitChangeset).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        body: { wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL },
      }),
      expect.objectContaining({
        body: expect.objectContaining({
          wmkf_groupreviewstartedat: '2026-08-30T19:05:00.000Z',
          'wmkf_GroupReviewStartedBy@odata.bind': `/systemusers(${LEAD_PD_ID})`,
        }),
      }),
      expect.objectContaining({
        body: {
          'wmkf_CurrentFinalWriteup@odata.bind': `/wmkf_requestdocuments(${FINAL_ID})`,
        },
      }),
    ]),
    { actingUserSystemId: LEAD_PD_ID },
  );
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SOURCE_ID);
  expect(harness.request._wmkf_currentfinalwriteup_value).toBe(FINAL_ID);
  expect(harness.source.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL);
});

test('an exact retry reuses the committed Final row without Graph or writes', async () => {
  const harness = createHarness();
  const input = {
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  };
  await startFinalWriteup(input, harness.dependencies);
  jest.clearAllMocks();

  const result = await startFinalWriteup(input, harness.dependencies);

  expect(result).toMatchObject({ reused: true, inProgress: false });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.downloadFile).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('fails closed for a non-lead non-superuser before SharePoint work', async () => {
  const harness = createHarness({ actorId: OTHER_USER_ID });

  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: OTHER_USER_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'final_writeup_forbidden',
    httpStatus: 403,
  });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
});

test('a superuser may transition when the request has no lead PD', async () => {
  const harness = createHarness({ actorId: OTHER_USER_ID });
  harness.request._wmkf_programdirector_value = null;

  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: true,
    actingUserSystemId: OTHER_USER_ID,
  }, harness.dependencies);

  expect(result.artifact.groupReview.startedById).toBe(OTHER_USER_ID);
});

test('missing actor identity fails closed even for a superuser', async () => {
  const harness = createHarness();
  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: true,
    actingUserSystemId: null,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'final_writeup_actor_required',
    httpStatus: 403,
  });
  expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
});

test('schema-off status and transition perform no Dataverse work', async () => {
  const harness = createHarness({ schemaReady: false });
  await expect(getFinalWriteupStatus({
    requestId: REQUEST_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies)).resolves.toEqual({
    available: false,
    phase: 'unavailable',
    canStart: false,
    artifact: null,
  });
  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'final_writeup_schema_not_ready',
    httpStatus: 503,
  });
  expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
});

test('does not create a Final row when Word changes during verification', async () => {
  const harness = createHarness();
  harness.dependencies.getFileMetadataById
    .mockResolvedValueOnce({ ...harness.metadata })
    .mockResolvedValueOnce({ ...harness.metadata, versionId: '3.0', eTag: 'file-etag-3' });

  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'final_writeup_source_changed',
    httpStatus: 409,
  });
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('confirms an ambiguous changeset response by rereading the exact committed state', async () => {
  const harness = createHarness();
  const commit = harness.dependencies.commitChangeset.getMockImplementation();
  harness.dependencies.commitChangeset.mockImplementationOnce(async (...args) => {
    await commit(...args);
    throw new Error('connection closed after Dataverse committed');
  });

  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({ reused: true, inProgress: false });
  expect(harness.request._wmkf_currentfinalwriteup_value).toBe(FINAL_ID);
  expect(harness.source.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL);
});

test('a rejected atomic activation leaves pointers and source lifecycle unchanged', async () => {
  const harness = createHarness();
  harness.dependencies.commitChangeset.mockRejectedValueOnce(
    Object.assign(new Error('Dataverse 412'), { status: 412 }),
  );

  await expect(startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'final_writeup_transition_conflict',
    httpStatus: 409,
  });
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SOURCE_ID);
  expect(harness.request._wmkf_currentfinalwriteup_value).toBeNull();
  expect(harness.source.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
  expect(harness.rows.find((row) => row.wmkf_requestdocumentid === FINAL_ID))
    .toMatchObject({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED });
});

test('a live deterministic claim returns in progress without a second write', async () => {
  const harness = createHarness();
  const verified = {
    metadata: harness.metadata,
    contentHash: 'gdc1:final-source-hash',
  };
  const key = buildFinalWriteupGenerationKey(REQUEST_ID, harness.source, verified);
  harness.rows.push({
    wmkf_requestdocumentid: FINAL_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: key,
    wmkf_claimtoken: 'other-claim',
    wmkf_sourceversionid: '2.0',
    wmkf_sourcecontenthash: 'gdc1:final-source-hash',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/site-visit.docx',
    modifiedon: '2026-08-30T19:05:00Z',
    _etag: 'final-etag-1',
  });

  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({ reused: true, inProgress: true });
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('a live claim for an older source version blocks a competing generation', async () => {
  const harness = createHarness();
  harness.rows.push({
    wmkf_requestdocumentid: COMPETING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'older-source-version',
    wmkf_claimtoken: 'other-claim',
    wmkf_sourceversionid: '1.0',
    wmkf_sourcecontenthash: 'gdc1:older-hash',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/site-visit.docx',
    modifiedon: '2026-08-30T19:05:00Z',
    _etag: 'competing-etag-1',
  });

  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({
    reused: true,
    inProgress: true,
    artifact: { artifactId: COMPETING_ID },
  });
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('an expired claim for an older source version is failed before the current generation starts', async () => {
  const harness = createHarness();
  harness.rows.push({
    wmkf_requestdocumentid: COMPETING_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.FINAL_WRITEUP,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'older-source-version',
    wmkf_claimtoken: 'expired-claim',
    wmkf_sourceversionid: '1.0',
    wmkf_sourcecontenthash: 'gdc1:older-hash',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/site-visit.docx',
    modifiedon: '2026-08-30T18:00:00Z',
    _etag: 'competing-etag-1',
  });

  const result = await startFinalWriteup({
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    isSuperuser: false,
    actingUserSystemId: LEAD_PD_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({ reused: false, inProgress: false });
  expect(harness.rows.find((row) => row.wmkf_requestdocumentid === COMPETING_ID))
    .toMatchObject({
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
      wmkf_lasterrorcode: 'final_writeup_claim_expired',
    });
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
});
