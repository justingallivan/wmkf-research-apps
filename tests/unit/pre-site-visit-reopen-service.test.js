import {
  buildReopenGenerationKey,
  reopenPreSiteVisit,
} from '../../lib/services/pre-site-visit/reopen-service.js';
import {
  PRE_SITE_REOPEN_REASON,
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222222';
const SUCCESSOR_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const SOURCE_HASH = 'gdc1:handoff-hash';

function input(overrides = {}) {
  return {
    requestId: REQUEST_ID,
    expectedArtifactId: SOURCE_ID,
    clientOperationId: OPERATION_ID,
    requestNumber: '1002379',
    reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    reasonNote: 'The handoff was started before the visit was ready.',
    ...overrides,
  };
}

function sourceRow(overrides = {}) {
  return {
    wmkf_requestdocumentid: SOURCE_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_name: '1002379 Pre-Site Visit',
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_generationkey: 'original-generation-key',
    wmkf_cyclecode: 'D26',
    wmkf_inputfingerprint: 'input-fingerprint',
    wmkf_renderinputfingerprint: 'render-fingerprint',
    wmkf_templateid: 'template-id',
    wmkf_templateversion: '1',
    wmkf_promptname: PRE_SITE_VISIT_CONTRACT.promptName,
    wmkf_promptversion: 4,
    wmkf_sharepointsiteid: 'source-site',
    wmkf_sharepointdriveid: 'source-drive',
    wmkf_sharepointitemid: 'source-item',
    wmkf_sharepointfolderpath: 'Requests/1002379',
    wmkf_sharepointweburl: 'https://sharepoint.test/source.docx',
    wmkf_sharepointversionid: '2.0',
    wmkf_sharepointetag: 'source-etag',
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_filesize: 12,
    wmkf_sharepointlastmodified: '2026-08-20T12:00:00Z',
    wmkf_contenthash: SOURCE_HASH,
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: SOURCE_HASH,
    wmkf_milestonecreatedat: '2026-08-20T12:01:00Z',
    wmkf_attemptcount: 1,
    _etag: 'source-row-1',
    createdon: '2026-08-20T10:00:00Z',
    modifiedon: '2026-08-20T12:01:00Z',
    ...overrides,
  };
}

function createHarness() {
  const request = {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1002379',
    _wmkf_currentpresitevisit_value: SOURCE_ID,
    _wmkf_currentfinalwriteup_value: null,
    _etag: 'request-row-1',
  };
  const rows = [sourceRow()];
  const sourceBytes = Buffer.from('exact-milestone-bytes');
  const targetBytes = Buffer.from('exact-milestone-bytes');
  const sourceMetadata = {
    siteId: 'source-site',
    driveId: 'source-drive',
    id: 'source-item',
    name: '1002379 Pre-Site Visit.docx',
    versionId: '2.0',
    eTag: 'source-etag',
    lastModified: '2026-08-20T12:00:00Z',
    size: sourceBytes.length,
    webUrl: 'https://sharepoint.test/source.docx',
  };
  let targetMetadata = null;
  let etag = 1;
  let createAfterApplyFailure = null;
  let commitFailure = null;
  let commitAfterApplyFailure = null;

  function clone(value) {
    return value === null || value === undefined
      ? value
      : JSON.parse(JSON.stringify(value));
  }

  function patchRow(row, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'wmkf_Request@odata.bind') {
        row._wmkf_request_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else if (key === 'wmkf_SourceDocument@odata.bind') {
        row._wmkf_sourcedocument_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else if (key === 'wmkf_AIPrompt@odata.bind') {
        row._wmkf_aiprompt_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else if (key === 'wmkf_AIRun@odata.bind') {
        row._wmkf_airun_value = value.match(/\(([^)]+)\)/)?.[1] || null;
      } else {
        row[key] = value;
      }
    }
    row._etag = `row-${++etag}`;
    row.modifiedon = '2026-08-22T12:00:00Z';
  }

  const dependencies = {
    getRequest: jest.fn().mockImplementation(async () => clone(request)),
    findByRequest: jest.fn().mockImplementation(async () => ({ records: clone(rows) })),
    findByGenerationKey: jest.fn().mockImplementation(async (generationKey) => ({
      records: clone(rows.filter((row) => row.wmkf_generationkey === generationKey)),
    })),
    createDocument: jest.fn().mockImplementation(async (payload) => {
      const row = {
        wmkf_requestdocumentid: SUCCESSOR_ID,
        _createdby_value: ACTOR_ID,
        _createdby_value_formatted: 'Test Admin',
        createdon: '2026-08-22T11:00:00Z',
        modifiedon: '2026-08-22T11:00:00Z',
        _etag: `row-${++etag}`,
      };
      patchRow(row, payload);
      rows.push(row);
      if (createAfterApplyFailure) {
        const error = createAfterApplyFailure;
        createAfterApplyFailure = null;
        throw error;
      }
      return SUCCESSOR_ID;
    }),
    updateDocument: jest.fn().mockImplementation(async (id, patch, options = {}) => {
      const row = rows.find((candidate) => candidate.wmkf_requestdocumentid === id);
      if (!row) throw new Error('row not found');
      if (options.ifMatch && options.ifMatch !== row._etag) {
        throw Object.assign(new Error('412 precondition failed'), { status: 412 });
      }
      patchRow(row, patch);
    }),
    commitChangeset: jest.fn().mockImplementation(async (operations) => {
      if (commitFailure) {
        const error = commitFailure;
        commitFailure = null;
        throw error;
      }
      for (const operation of operations) {
        if (operation.entitySet === 'wmkf_requestdocuments') {
          const row = rows.find((candidate) => candidate.wmkf_requestdocumentid === operation.key);
          patchRow(row, operation.body);
        } else if (operation.entitySet === 'akoya_requests') {
          request._wmkf_currentpresitevisit_value = operation.body[
            'wmkf_CurrentPreSiteVisit@odata.bind'
          ].match(/\(([^)]+)\)/)?.[1] || null;
          request._etag = `request-row-${++etag}`;
        }
      }
      if (commitAfterApplyFailure) {
        const error = commitAfterApplyFailure;
        commitAfterApplyFailure = null;
        throw error;
      }
    }),
    ensureFolderPath: jest.fn().mockResolvedValue(undefined),
    getFileMetadataById: jest.fn().mockImplementation(async (driveId, itemId) => {
      if (driveId === sourceMetadata.driveId && itemId === sourceMetadata.id) {
        return clone(sourceMetadata);
      }
      if (targetMetadata && driveId === targetMetadata.driveId && itemId === targetMetadata.id) {
        return clone(targetMetadata);
      }
      return null;
    }),
    getFileMetadataByPath: jest.fn().mockImplementation(async () => clone(targetMetadata)),
    downloadFile: jest.fn().mockImplementation(async (driveId, itemId) => ({
      buffer: driveId === sourceMetadata.driveId && itemId === sourceMetadata.id
        ? sourceBytes
        : targetBytes,
    })),
    uploadFile: jest.fn().mockImplementation(async (_library, _folder, fileName) => {
      targetMetadata = {
        siteId: 'target-site',
        driveId: 'target-drive',
        id: 'target-item',
        name: fileName,
        versionId: '1.0',
        eTag: 'target-etag',
        lastModified: '2026-08-22T11:00:00Z',
        size: targetBytes.length,
        webUrl: 'https://sharepoint.test/reopened.docx',
      };
      return clone(targetMetadata);
    }),
    hashDocx: jest.fn().mockResolvedValue(SOURCE_HASH),
    newClaimToken: jest.fn().mockReturnValue('claim-token'),
    now: jest.fn().mockReturnValue(new Date('2026-08-22T12:00:00Z')),
    isGuardedReopenSchemaReady: jest.fn().mockReturnValue(true),
  };

  return {
    dependencies,
    request,
    rows,
    sourceMetadata,
    setCreateAfterApplyFailure(error) { createAfterApplyFailure = error; },
    setCommitFailure(error) { commitFailure = error; },
    setCommitAfterApplyFailure(error) { commitAfterApplyFailure = error; },
  };
}

test('creates one append-only Draft successor and atomically preserves the Review milestone', async () => {
  const harness = createHarness();
  const result = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );

  expect(result).toMatchObject({ reused: false, recovered: false, inProgress: false });
  expect(result.artifact).toMatchObject({
    artifactId: SUCCESSOR_ID,
    operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    correction: {
      cycleId: OPERATION_ID,
      reasonCode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
      sourceArtifactId: SOURCE_ID,
      actorId: ACTOR_ID,
    },
  });
  expect(harness.rows[0]).toMatchObject({
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED,
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: SOURCE_HASH,
  });
  expect(harness.rows[1]).toMatchObject({
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_sourceversionid: '2.0',
    wmkf_sourcecontenthash: SOURCE_HASH,
    wmkf_reopencycleid: OPERATION_ID,
  });
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SUCCESSOR_ID);
  expect(harness.dependencies.commitChangeset).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ key: SOURCE_ID, ifMatch: expect.any(String) }),
      expect.objectContaining({ key: SUCCESSOR_ID, ifMatch: expect.any(String) }),
      expect.objectContaining({ key: REQUEST_ID, ifMatch: expect.any(String) }),
    ]),
    { actingUserSystemId: ACTOR_ID },
  );
});

test('an exact client operation retry returns the same successor without a second copy', async () => {
  const harness = createHarness();
  await reopenPreSiteVisit(input(), { actingUserSystemId: ACTOR_ID }, harness.dependencies);
  const calls = {
    create: harness.dependencies.createDocument.mock.calls.length,
    upload: harness.dependencies.uploadFile.mock.calls.length,
    commit: harness.dependencies.commitChangeset.mock.calls.length,
    download: harness.dependencies.downloadFile.mock.calls.length,
  };

  const retry = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );

  expect(retry).toMatchObject({
    reused: true,
    recovered: false,
    artifact: { artifactId: SUCCESSOR_ID },
  });
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(calls.create);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(calls.upload);
  expect(harness.dependencies.commitChangeset).toHaveBeenCalledTimes(calls.commit);
  expect(harness.dependencies.downloadFile).toHaveBeenCalledTimes(calls.download);
});

test('source version drift blocks before any Dataverse or SharePoint mutation', async () => {
  const harness = createHarness();
  harness.sourceMetadata.versionId = '3.0';

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_source_changed', httpStatus: 409 });
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('a downstream derived artifact blocks reopening before file access', async () => {
  const harness = createHarness();
  harness.rows.push({
    ...sourceRow({
      wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
      _wmkf_sourcedocument_value: SOURCE_ID,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    }),
  });

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_downstream_exists' });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
});

test('a competing Pre-Site generation blocks reopen before file access or mutation', async () => {
  const harness = createHarness();
  harness.rows.push(sourceRow({
    wmkf_requestdocumentid: '66666666-6666-4666-8666-666666666666',
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'competing-generation-key',
    wmkf_claimtoken: 'competing-claim',
  }));

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_generation_in_progress' });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.createDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('a retained failed attempt does not block a new audited reopen operation', async () => {
  const harness = createHarness();
  const failedId = '66666666-6666-4666-8666-666666666666';
  harness.rows.push(sourceRow({
    wmkf_requestdocumentid: failedId,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_generationkey: 'failed-reopen-generation-key',
    wmkf_claimtoken: null,
    wmkf_reopencycleid: '77777777-7777-4777-8777-777777777777',
    wmkf_reopenreasoncode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
    wmkf_reopenreasonnote: 'The earlier guarded reopen failed during its copy.',
  }));

  const result = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );

  expect(result).toMatchObject({
    inProgress: false,
    artifact: { artifactId: SUCCESSOR_ID },
  });
  expect(harness.rows.find((row) => row.wmkf_requestdocumentid === failedId))
    .toMatchObject({ wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED });
  expect(harness.rows).toHaveLength(3);
});

test('schema interlock fails closed before reading Dataverse', async () => {
  const harness = createHarness();
  harness.dependencies.isGuardedReopenSchemaReady.mockReturnValue(false);

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_schema_not_ready', httpStatus: 503 });
  expect(harness.dependencies.getRequest).not.toHaveBeenCalled();
  expect(harness.dependencies.findByRequest).not.toHaveBeenCalled();
});

test('an atomic transition conflict leaves the preserved Review row and pointer unchanged', async () => {
  const harness = createHarness();
  harness.setCommitFailure(Object.assign(new Error('412 precondition failed'), { status: 412 }));

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_transition_conflict' });
  expect(harness.rows[0].wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SOURCE_ID);
  expect(harness.rows[1].wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
});

test('retry after post-upload failure recovers the same item without uploading again', async () => {
  const harness = createHarness();
  harness.setCommitFailure(new Error('Dataverse response lost'));
  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ httpStatus: 500 });
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);

  const retry = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );
  expect(retry).toMatchObject({ recovered: true, artifact: { artifactId: SUCCESSOR_ID } });
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
});

test('retry after an ambiguous create retains and reclaims exactly one successor row', async () => {
  const harness = createHarness();
  harness.setCreateAfterApplyFailure(new Error('response lost after create'));

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ httpStatus: 500 });
  expect(harness.rows).toHaveLength(2);
  expect(harness.rows[1].wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();

  const retry = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );
  expect(retry.artifact.artifactId).toBe(SUCCESSOR_ID);
  expect(harness.rows).toHaveLength(2);
  expect(harness.dependencies.createDocument).toHaveBeenCalledTimes(1);
  expect(harness.dependencies.uploadFile).toHaveBeenCalledTimes(1);
});

test('an ambiguous successful changeset is accepted only after exact state reread', async () => {
  const harness = createHarness();
  harness.setCommitAfterApplyFailure(new Error('response lost after commit'));

  const result = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );
  expect(result).toMatchObject({
    reused: true,
    artifact: { artifactId: SUCCESSOR_ID },
  });
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SUCCESSOR_ID);
  expect(harness.rows[0].wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.SUPERSEDED);
});

test('a live concurrent lease returns in-progress without another claim or copy', async () => {
  const harness = createHarness();
  const generationKey = buildReopenGenerationKey({
    requestId: REQUEST_ID,
    source: harness.rows[0],
    clientOperationId: OPERATION_ID,
  });
  harness.rows.push({
    ...sourceRow({
      wmkf_requestdocumentid: SUCCESSOR_ID,
      _wmkf_sourcedocument_value: SOURCE_ID,
      wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING,
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
      wmkf_generationkey: generationKey,
      wmkf_claimtoken: 'other-claim',
      wmkf_reopencycleid: OPERATION_ID,
      wmkf_reopenreasoncode: PRE_SITE_REOPEN_REASON.ACCIDENTAL_HANDOFF,
      wmkf_reopenreasonnote: input().reasonNote,
      modifiedon: '2026-08-22T11:59:00Z',
    }),
  });

  const result = await reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  );
  expect(result).toMatchObject({ reused: true, inProgress: true });
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.uploadFile).not.toHaveBeenCalled();
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('source drift during copy preparation fails before the pointer changes', async () => {
  const harness = createHarness();
  let sourceReads = 0;
  harness.dependencies.getFileMetadataById.mockImplementation(async (driveId, itemId) => {
    if (driveId === harness.sourceMetadata.driveId && itemId === harness.sourceMetadata.id) {
      sourceReads += 1;
      return {
        ...harness.sourceMetadata,
        ...(sourceReads >= 3 ? { versionId: '3.0', eTag: 'changed-etag' } : {}),
      };
    }
    return {
      siteId: 'target-site',
      driveId: 'target-drive',
      id: 'target-item',
      name: harness.rows[1]?.wmkf_filename,
      versionId: '1.0',
      eTag: 'target-etag',
      lastModified: '2026-08-22T11:00:00Z',
      size: Buffer.from('exact-milestone-bytes').length,
      webUrl: 'https://sharepoint.test/reopened.docx',
    };
  });

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_source_changed' });
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SOURCE_ID);
  expect(harness.rows[0].wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
  expect(harness.rows[1].wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
});

test('target-copy drift after verification blocks activation and preserves the Review source', async () => {
  const harness = createHarness();
  const originalGetMetadata = harness.dependencies.getFileMetadataById.getMockImplementation();
  let targetReads = 0;
  harness.dependencies.getFileMetadataById.mockImplementation(async (driveId, itemId, options) => {
    const metadata = await originalGetMetadata(driveId, itemId, options);
    if (driveId === 'target-drive' && itemId === 'target-item') {
      targetReads += 1;
      if (targetReads >= 3) {
        return { ...metadata, versionId: '2.0', eTag: 'target-changed' };
      }
    }
    return metadata;
  });

  await expect(reopenPreSiteVisit(
    input(),
    { actingUserSystemId: ACTOR_ID },
    harness.dependencies,
  )).rejects.toMatchObject({ code: 'pre_site_reopen_copy_changed', httpStatus: 409 });
  expect(harness.dependencies.commitChangeset).not.toHaveBeenCalled();
  expect(harness.request._wmkf_currentpresitevisit_value).toBe(SOURCE_ID);
  expect(harness.rows[0].wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
  expect(harness.rows[1].wmkf_operationstatus).toBe(REQUEST_DOCUMENT_OPERATION_STATUS.FAILED);
});

test('the correction cycle salts later generated-draft identity', () => {
  const source = sourceRow();
  const first = buildReopenGenerationKey({
    requestId: REQUEST_ID,
    source,
    clientOperationId: OPERATION_ID,
  });
  const second = buildReopenGenerationKey({
    requestId: REQUEST_ID,
    source,
    clientOperationId: '77777777-7777-4777-8777-777777777777',
  });
  expect(second).not.toBe(first);
});
