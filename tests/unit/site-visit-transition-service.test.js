import { startSiteVisitStage } from '../../lib/services/pre-site-visit/site-visit-transition-service.js';
import {
  PRE_SITE_VISIT_CONTRACT,
  REQUEST_DOCUMENT_ARTIFACT_TYPE,
  REQUEST_DOCUMENT_LIFECYCLE_STATE,
  REQUEST_DOCUMENT_OPERATION_STATUS,
} from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ARTIFACT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ARTIFACT_ID = '33333333-3333-4333-8333-333333333333';

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
    }),
    getFileMetadataById: jest.fn().mockImplementation(async () => ({ ...metadata })),
    downloadFile: jest.fn().mockResolvedValue({ buffer: Buffer.from('valid-docx') }),
    hashDocx: jest.fn().mockResolvedValue('gdc1:handoff-hash'),
    now: jest.fn().mockReturnValue(new Date('2026-08-17T21:05:00Z')),
  };
  return { row, metadata, dependencies };
}

test('promotes the current Ready draft and records one stable SharePoint milestone', async () => {
  const harness = createHarness();
  const result = await startSiteVisitStage({
    requestId: REQUEST_ID,
    expectedArtifactId: ARTIFACT_ID,
    actingUserSystemId: '44444444-4444-4444-8444-444444444444',
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
      actingUserSystemId: '44444444-4444-4444-8444-444444444444',
    },
  );
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
