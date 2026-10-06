import { prepareSiteVisitStageAutomatically, startSiteVisitStage } from '../../lib/services/pre-site-visit/site-visit-transition-service.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_ACTOR_ID = '55555555-5555-4555-8555-555555555555';

function createHarness({ lifecycle = REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT } = {}) {
  const request = {
    akoya_requestid: REQUEST_ID,
    _wmkf_currentpresitevisit_value: ARTIFACT_ID,
  };
  const row = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: lifecycle,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointsiteid: 'site-id',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/pre-site.docx',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: 'file-etag-1',
    wmkf_sharepointfolderpath: 'Requests/1002379/Artifacts/Pre-Site Visit',
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_filesize: 1234,
    wmkf_sharepointlastmodified: '2026-08-17T20:00:00Z',
    _etag: 'row-etag-1',
  };
  const metadata = {
    siteId: 'site-id',
    driveId: 'drive-id',
    id: 'item-id',
    name: '1002379 Pre-Site Visit.docx',
    size: 1250,
    webUrl: 'https://sharepoint.test/pre-site.docx',
    eTag: 'file-etag-2',
    versionId: '2.0',
    lastModified: '2026-08-17T21:00:00Z',
    mimeType: PRE_SITE_VISIT_CONTRACT.contentType,
  };
  const dependencies = {
    getRequest: jest.fn().mockImplementation(async () => ({ ...request })),
    findByRequest: jest.fn().mockImplementation(async () => ({ records: [{ ...row }] })),
    updateDocument: jest.fn().mockImplementation(async (id, patch, options) => {
      expect(id).toBe(ARTIFACT_ID);
      expect(options.ifMatch).toBe('row-etag-1');
      Object.assign(row, patch, { _etag: 'row-etag-2' });
      const actorBind = patch['wmkf_MilestoneCreatedBy@odata.bind'];
      if (actorBind) row._wmkf_milestonecreatedby_value = actorBind.match(/\(([^)]+)\)/)?.[1];
    }),
    getFileMetadataById: jest.fn().mockImplementation(async () => ({ ...metadata })),
    downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('valid-docx') }),
    hashDocx: jest.fn().mockResolvedValue('gdc1:handoff-hash'),
    now: jest.fn().mockReturnValue(new Date('2026-08-17T21:05:00Z')),
    resolveActor: jest.fn().mockResolvedValue({
      schemaReady: false,
      actorId: null,
      reason: 'schema-not-ready',
    }),
    recordActorNotCaptured: jest.fn().mockResolvedValue({ id: 1 }),
  };
  return { row, metadata, dependencies };
}

test('promotes the current Ready draft and records one stable SharePoint milestone', async () => {
  const harness = createHarness();
  const result = await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: ACTOR_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({
    reused: false,
    artifact: {
      artifactId: ARTIFACT_ID,
      lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      file: { itemId: 'item-id', versionId: '2.0' },
      milestone: {
        versionId: '2.0',
        contentHash: 'gdc1:handoff-hash',
        createdAt: '2026-08-17T21:05:00.000Z',
      },
    },
  });
  expect(harness.dependencies.getFileMetadataById).toHaveBeenCalledTimes(2);
  expect(harness.dependencies.downloadFile).toHaveBeenCalledWith('drive-id', 'item-id');
  expect(harness.dependencies.updateDocument).toHaveBeenCalledWith(
    ARTIFACT_ID,
    expect.objectContaining({
      wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      wmkf_milestoneversionid: '2.0',
      wmkf_milestonecontenthash: 'gdc1:handoff-hash',
      wmkf_milestonecreatedat: '2026-08-17T21:05:00.000Z',
      wmkf_sharepointitemid: 'item-id',
    }),
    {
      ifMatch: 'row-etag-1',
      actingUserSystemId: ACTOR_ID,
    },
  );
});

const AUTO_CONFIG = {
  active: true,
  guardedReopenSchemaReady: true,
  programIds: ['bbbbbbbb-0000-4000-8000-000000000001'],
  cycleCodes: ['D26'],
  requestStatuses: ['Phase II Pending'],
};

function createAutomaticHarness({ requestPatch = {}, rowPatch = {}, eventPatch = {}, commitError = null } = {}) {
  const request = {
    akoya_requestid: REQUEST_ID,
    _wmkf_currentpresitevisit_value: ARTIFACT_ID,
    _wmkf_grantprogram_value: AUTO_CONFIG.programIds[0],
    wmkf_meetingdate: '2026-12-10T00:00:00Z',
    akoya_requeststatus: 'Phase II Pending',
    _etag: 'request-etag-1',
    ...requestPatch,
  };
  const row = {
    wmkf_requestdocumentid: ARTIFACT_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_artifacttype: REQUEST_DOCUMENT_ARTIFACT_TYPE.PRE_SITE_VISIT,
    wmkf_operationstatus: REQUEST_DOCUMENT_OPERATION_STATUS.READY,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT,
    wmkf_contenttype: PRE_SITE_VISIT_CONTRACT.contentType,
    wmkf_sharepointsiteid: 'site-id',
    wmkf_sharepointdriveid: 'drive-id',
    wmkf_sharepointitemid: 'item-id',
    wmkf_sharepointweburl: 'https://sharepoint.test/pre-site.docx',
    wmkf_sharepointversionid: '1.0',
    wmkf_sharepointetag: 'file-etag-1',
    wmkf_filename: '1002379 Pre-Site Visit.docx',
    wmkf_filesize: 1234,
    _etag: 'row-etag-1',
    ...rowPatch,
  };
  const event = {
    activityid: '77777777-7777-4777-8777-777777777777',
    _regardingobjectid_value: REQUEST_ID,
    scheduledend: '2026-12-01T18:00:00.000Z',
    modifiedon: '2026-11-01T12:00:00.000Z',
    statecode: 10,
    statuscode: 11,
    _etag: 'event-etag-1',
    ...eventPatch,
  };
  const metadata = {
    siteId: 'site-id', driveId: 'drive-id', id: 'item-id',
    name: '1002379 Pre-Site Visit.docx', size: 1234,
    webUrl: 'https://sharepoint.test/pre-site.docx',
    eTag: 'file-etag-2', versionId: '2.0',
    lastModified: '2026-12-01T18:05:00Z',
    mimeType: PRE_SITE_VISIT_CONTRACT.contentType,
  };
  const dependencies = {
    getRequest: jest.fn(async () => ({ ...request })),
    getSiteVisit: jest.fn(async () => ({ ...event })),
    findByRequest: jest.fn(async () => ({ records: [{ ...row }] })),
    getFileMetadataById: jest.fn(async () => ({ ...metadata })),
    downloadFile: jest.fn(async () => ({ buffer: Buffer.from('valid-docx') })),
    hashDocx: jest.fn(async () => 'gdc1:auto-handoff'),
    now: jest.fn(() => new Date('2026-12-02T00:00:00Z')),
    commitChangeset: jest.fn(async (operations) => {
      if (commitError) throw commitError;
      Object.assign(row, operations[2].body, { _etag: 'row-etag-2' });
      return { ok: true };
    }),
  };
  return { request, row, event, metadata, dependencies };
}

it('automatically promotes the same Word item under request, schedule, and correction fences without human review attribution', async () => {
  const h = createAutomaticHarness();
  const result = await prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    siteVisitId: h.event.activityid,
    scheduledEnd: '2026-12-01T18:00:00Z',
    eventModifiedOn: '2026-11-01T12:00:00Z',
    stateCode: 10,
    statusCode: 11,
    eligibility: AUTO_CONFIG,
  }, h.dependencies);
  expect(result.artifact.lifecycleState).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW);
  expect(h.dependencies.commitChangeset).toHaveBeenCalledTimes(1);
  const operations = h.dependencies.commitChangeset.mock.calls[0][0];
  expect(operations).toHaveLength(3);
  expect(operations[0]).toMatchObject({ key: h.event.activityid, body: { statecode: 10, statuscode: 11 }, ifMatch: 'event-etag-1' });
  expect(operations[0].body).not.toHaveProperty('scheduledend');
  expect(operations[1].body['wmkf_CurrentPreSiteVisit@odata.bind']).toContain(ARTIFACT_ID);
  expect(operations[2].body).toMatchObject({
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: 'gdc1:auto-handoff',
  });
  expect(operations[2].body).not.toHaveProperty('wmkf_GroupReviewStartedAt');
  expect(operations[2].body).not.toHaveProperty('wmkf_LeadershipReviewStartedAt');
  expect(h.row.wmkf_sharepointitemid).toBe('item-id');
});

it('permits only the exact Factory test identity at the automatic promotion fence', async () => {
  const expectedAppUserId = '88888888-0000-4000-8000-000000000001';
  const runId = '99999999-0000-4000-8000-000000000001';
  const scope = { requestId: REQUEST_ID, runId, expectedAppUserId };
  const h = createAutomaticHarness({ requestPatch: {
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: runId,
    _createdby_value: expectedAppUserId,
    _ownerid_value: expectedAppUserId,
  } });
  await prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: h.event.activityid,
    scheduledEnd: h.event.scheduledend, eventModifiedOn: h.event.modifiedon,
    stateCode: h.event.statecode, statusCode: h.event.statuscode,
    eligibility: { ...AUTO_CONFIG, factoryTestScope: scope },
  }, h.dependencies);
  expect(h.dependencies.commitChangeset).toHaveBeenCalledTimes(1);

  const changed = createAutomaticHarness({ requestPatch: {
    wmkf_istestrequest: true,
    wmkf_testcreationrunid: 'aaaaaaaa-0000-4000-8000-000000000001',
    _createdby_value: expectedAppUserId,
    _ownerid_value: expectedAppUserId,
  } });
  await expect(prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: changed.event.activityid,
    scheduledEnd: changed.event.scheduledend, eventModifiedOn: changed.event.modifiedon,
    stateCode: changed.event.statecode, statusCode: changed.event.statuscode,
    eligibility: { ...AUTO_CONFIG, factoryTestScope: scope },
  }, changed.dependencies)).rejects.toMatchObject({ code: 'site_visit_automation_fence_changed' });
  expect(changed.dependencies.commitChangeset).not.toHaveBeenCalled();
});

it('keeps the request and draft unchanged when the atomic event-status fence rejects', async () => {
  const h = createAutomaticHarness({ commitError: Object.assign(new Error('Dataverse 412'), { status: 412 }) });
  await expect(prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: h.event.activityid,
    scheduledEnd: h.event.scheduledend, eventModifiedOn: h.event.modifiedon,
    stateCode: h.event.statecode, statusCode: h.event.statuscode, eligibility: AUTO_CONFIG,
  }, h.dependencies)).rejects.toMatchObject({ status: 412 });
  const operations = h.dependencies.commitChangeset.mock.calls[0][0];
  expect(operations[0]).toMatchObject({
    method: 'PATCH', entitySet: 'wmkf_sitevisits', key: h.event.activityid,
    body: { statecode: 10, statuscode: 11 }, ifMatch: 'event-etag-1',
  });
  expect(operations[0].body).not.toHaveProperty('scheduledend');
  expect(h.request._wmkf_currentpresitevisit_value).toBe(ARTIFACT_ID);
  expect(h.row.wmkf_lifecyclestate).toBe(REQUEST_DOCUMENT_LIFECYCLE_STATE.DRAFT);
});

it('rejects a changed program at the fresh automatic-promotion fence', async () => {
  const h = createAutomaticHarness({ requestPatch: { _wmkf_grantprogram_value: '99999999-0000-4000-8000-000000000001' } });
  await expect(prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: h.event.activityid,
    scheduledEnd: h.event.scheduledend, eventModifiedOn: h.event.modifiedon,
    stateCode: 10, statusCode: 11, eligibility: AUTO_CONFIG,
  }, h.dependencies)).rejects.toMatchObject({ code: 'site_visit_automation_fence_changed' });
  expect(h.dependencies.commitChangeset).not.toHaveBeenCalled();
});

it('rejects a current correction epoch at the automatic-promotion fence', async () => {
  const h = createAutomaticHarness({ rowPatch: { wmkf_reopencycleid: 'reopen-2' } });
  await expect(prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: h.event.activityid,
    scheduledEnd: h.event.scheduledend, eventModifiedOn: h.event.modifiedon,
    stateCode: 10, statusCode: 11, eligibility: AUTO_CONFIG,
  }, h.dependencies)).rejects.toMatchObject({ code: 'site_visit_automation_fence_changed' });
  expect(h.dependencies.findByRequest).toHaveBeenCalledWith(REQUEST_ID, expect.objectContaining({ includeGuardedReopen: true }));
  expect(h.dependencies.commitChangeset).not.toHaveBeenCalled();
});

test('treats an exact completed Review milestone as an idempotent success', async () => {
  const harness = createHarness({ lifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW });
  Object.assign(harness.row, {
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: 'gdc1:handoff-hash',
    wmkf_milestonecreatedat: '2026-08-17T21:05:00Z',
  });

  const result = await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies);

  expect(result.reused).toBe(true);
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.downloadFile).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
  expect(harness.dependencies.resolveActor).not.toHaveBeenCalled();
});

test('readiness-era handoff binds a freshly resolved actor and requires actor presence', async () => {
  const harness = createHarness();
  harness.dependencies.resolveActor.mockResolvedValue({
    schemaReady: true,
    actorId: ACTOR_ID,
    reason: null,
  });

  await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: ACTOR_ID,
  }, harness.dependencies);

  expect(harness.dependencies.updateDocument).toHaveBeenCalledWith(
    ARTIFACT_ID,
    expect.objectContaining({
      'wmkf_MilestoneCreatedBy@odata.bind': `/systemusers(${ACTOR_ID})`,
    }),
    { ifMatch: 'row-etag-1', actingUserSystemId: ACTOR_ID },
  );
  expect(harness.dependencies.recordActorNotCaptured).not.toHaveBeenCalled();
});

test('a concurrent matching readiness-era commit may carry a different non-null actor', async () => {
  const harness = createHarness();
  harness.dependencies.resolveActor.mockResolvedValue({
    schemaReady: true,
    actorId: ACTOR_ID,
    reason: null,
  });
  harness.dependencies.updateDocument.mockImplementationOnce(async (_id, patch) => {
    Object.assign(harness.row, patch, {
      _wmkf_milestonecreatedby_value: OTHER_ACTOR_ID,
      _etag: 'row-etag-2',
    });
    throw new Error('connection closed after a concurrent commit');
  });

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: ACTOR_ID,
  }, harness.dependencies)).resolves.toMatchObject({ reused: true });
});

test('a readiness-era attributed attempt does not reconcile a matching milestone with no actor', async () => {
  const harness = createHarness();
  harness.dependencies.resolveActor.mockResolvedValue({
    schemaReady: true,
    actorId: ACTOR_ID,
    reason: null,
  });
  harness.dependencies.updateDocument.mockImplementationOnce(async (_id, patch) => {
    Object.assign(harness.row, patch, { _etag: 'row-etag-2' });
    delete harness.row['wmkf_MilestoneCreatedBy@odata.bind'];
    delete harness.row._wmkf_milestonecreatedby_value;
    throw new Error('connection closed after an incomplete commit');
  });

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: ACTOR_ID,
  }, harness.dependencies)).rejects.toThrow('connection closed after an incomplete commit');
});

test('approved availability-first handoff omits an invalid actor and records durable evidence', async () => {
  const harness = createHarness();
  harness.dependencies.resolveActor.mockResolvedValue({
    schemaReady: true,
    actorId: null,
    reason: 'disabled',
  });

  await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: ACTOR_ID,
  }, harness.dependencies);

  const [, patch, options] = harness.dependencies.updateDocument.mock.calls[0];
  expect(patch).not.toHaveProperty('wmkf_MilestoneCreatedBy@odata.bind');
  expect(options).toEqual({ ifMatch: 'row-etag-1' });
  expect(harness.dependencies.recordActorNotCaptured).toHaveBeenCalledWith(expect.objectContaining({
    reason: 'disabled',
    context: expect.objectContaining({
      operation: 'site-visit-handoff',
      requestId: REQUEST_ID,
      requestDocumentId: ARTIFACT_ID,
    }),
  }));
});

test('rejects a stale browser artifact before reading or writing SharePoint', async () => {
  const harness = createHarness();

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: OTHER_ARTIFACT_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'site_visit_stale_artifact',
    httpStatus: 409,
  });

  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.downloadFile).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
});

test('does not transition when the Word item changes during verification', async () => {
  const harness = createHarness();
  harness.dependencies.getFileMetadataById
    .mockResolvedValueOnce({ ...harness.metadata })
    .mockResolvedValueOnce({
      ...harness.metadata,
      versionId: '3.0',
      eTag: 'file-etag-3',
    });

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'site_visit_sharepoint_version_changed',
    httpStatus: 409,
    // Only the fields that moved, for the operator receipt; not in the staff body.
    diagnostic: `versionId ${JSON.stringify(harness.metadata.versionId)}->"3.0"; eTag ${JSON.stringify(harness.metadata.eTag)}->"file-etag-3"`,
    body: { error: expect.not.stringContaining('->'), code: 'site_visit_sharepoint_version_changed' },
  });

  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
});

test('maps an ETag collision to a retryable transition conflict', async () => {
  const harness = createHarness();
  harness.dependencies.updateDocument.mockRejectedValueOnce(
    Object.assign(new Error('Dataverse 412'), { status: 412 }),
  );

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'site_visit_transition_conflict',
    httpStatus: 409,
  });
});

test('confirms an ambiguous update failure by rereading the exact committed milestone', async () => {
  const harness = createHarness();
  harness.dependencies.updateDocument.mockImplementationOnce(async (id, patch) => {
    Object.assign(harness.row, patch, { _etag: 'row-etag-2' });
    throw new Error('connection closed after Dataverse accepted the update');
  });

  const result = await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies);

  expect(result).toMatchObject({
    reused: true,
    artifact: {
      artifactId: ARTIFACT_ID,
      lifecycleState: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
      milestone: {
        versionId: '2.0',
        contentHash: 'gdc1:handoff-hash',
      },
    },
  });
});

test('fails closed when Review is missing any handoff milestone field', async () => {
  const harness = createHarness({ lifecycle: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW });
  Object.assign(harness.row, {
    wmkf_milestoneversionid: '2.0',
    wmkf_milestonecontenthash: 'gdc1:handoff-hash',
    wmkf_milestonecreatedat: null,
  });

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'site_visit_milestone_incomplete',
    httpStatus: 409,
  });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
});

test('fails closed on an unknown lifecycle before SharePoint work', async () => {
  const harness = createHarness({ lifecycle: 999999999 });

  await expect(startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
  }, harness.dependencies)).rejects.toMatchObject({
    code: 'site_visit_state_unknown',
    httpStatus: 500,
  });
  expect(harness.dependencies.getFileMetadataById).not.toHaveBeenCalled();
  expect(harness.dependencies.updateDocument).not.toHaveBeenCalled();
});

it('rejects an excluded request number at the fresh automatic-promotion fence', async () => {
  const h = createAutomaticHarness({ requestPatch: { akoya_requestnum: '1003220' } });
  await expect(prepareSiteVisitStageAutomatically({
    requestId: REQUEST_ID, expectedArtifactId: ARTIFACT_ID, siteVisitId: h.event.activityid,
    scheduledEnd: h.event.scheduledend, eventModifiedOn: h.event.modifiedon,
    stateCode: 10, statusCode: 11, eligibility: { ...AUTO_CONFIG, excludedRequestNumbers: ['1003220'] },
  }, h.dependencies)).rejects.toMatchObject({ code: 'site_visit_automation_fence_changed' });
  expect(h.dependencies.commitChangeset).not.toHaveBeenCalled();
});
