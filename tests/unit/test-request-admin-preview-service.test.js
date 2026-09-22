/**
 * @jest-environment node
 */

import {
  buildTestRequestAdminPreview,
  loadTestRequestPreviewSource,
} from '../../lib/services/test-requests/admin-preview-service';

const SOURCE_ID = '11111111-1111-4111-8111-111111111111';
const DESTINATION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const FOUNDATION_ID = '44444444-4444-4444-8444-444444444444';

const source = {
  akoya_requestid: SOURCE_ID,
  akoya_requestnum: '1002001',
  akoya_title: 'Source title',
  akoya_purpose: 'Source purpose',
  akoya_request: 125000,
  akoya_fiscalyear: 'December 2026',
  akoya_requesttype: 99,
  wmkf_meetingdate: '2026-12-04',
  _akoya_applicantid_value: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  _akoya_applicantid_value_formatted: 'Live University',
};

function compilerMetadata() {
  const specs = {
    akoya_requestid: ['Uniqueidentifier'],
    akoya_applicantid: ['Lookup'],
    akoya_title: ['String', { maxLength: 200 }],
    akoya_purpose: ['Memo', { maxLength: 100000 }],
    akoya_request: ['Money', { minValue: 0, maxValue: 1000000000 }],
    akoya_fiscalyear: ['String', { maxLength: 80 }],
    akoya_requesttype: ['Picklist'],
    wmkf_meetingdate: ['DateTime'],
    wmkf_istestrequest: ['Boolean'],
    wmkf_testcreationrunid: ['String', { maxLength: 100 }],
    wmkf_respondreminderenabled: ['Boolean'],
    wmkf_reviewduereminderenabled: ['Boolean'],
  };
  return {
    entity: 'akoya_request',
    fields: Object.fromEntries(Object.entries(specs).map(([field, [type, extra = {}]]) => [field, {
      createable: true,
      requiredLevel: 'None',
      type,
      ...(field === 'akoya_applicantid' ? { lookupTarget: 'accounts' } : {}),
      ...extra,
    }])),
  };
}

function dependencies(overrides = {}) {
  const bytes = Buffer.from('preview-pdf');
  const metadata = {
    id: 'graph-item-1',
    name: 'ProjectDescription.pdf',
    size: bytes.length,
    mimeType: 'application/pdf',
    eTag: 'etag-1',
    versionId: '1.0',
  };
  let randomIndex = 0;
  return {
    getTargetInfo: jest.fn(() => ({ deployment: 'local', target: 'sandbox', hostname: 'orgd9e66399.crm.dynamics.com' })),
    getRequestById: jest.fn(async () => source),
    findRequestByNumber: jest.fn(async () => ({ records: [source] })),
    getRequestSharePointBuckets: jest.fn(async () => [{ library: 'akoya_request', folder: '1002001_ROOT', source: 'dynamics' }]),
    listFiles: jest.fn(async () => [{
      id: 'graph-item-1',
      name: 'ProjectDescription.pdf',
      folder: '1002001_ROOT/Phase I',
      size: bytes.length,
      mimeType: 'application/pdf',
      lastModified: '2026-09-20T10:00:00Z',
    }]),
    getDriveId: jest.fn(async () => 'drive-1'),
    getFileMetadataById: jest.fn(async () => metadata),
    downloadFile: jest.fn(async () => ({
      buffer: bytes,
      filename: metadata.name,
      mimeType: metadata.mimeType,
      size: metadata.size,
    })),
    loadCompilerMetadata: jest.fn(async () => compilerMetadata()),
    loadGrantRequestType: jest.fn(async () => 100000000),
    findFoundation: jest.fn(async () => ({ records: [{ accountid: FOUNDATION_ID, name: 'W. M. Keck Foundation' }] })),
    randomUUID: jest.fn(() => [DESTINATION_ID, RUN_ID][randomIndex++]),
    ...overrides,
  };
}

test('fails closed from a production deployment before reading a Request or SharePoint', async () => {
  const deps = dependencies({
    getTargetInfo: jest.fn(() => ({ deployment: 'production', target: 'sandbox', hostname: 'orgd9e66399.crm.dynamics.com' })),
  });

  await expect(loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps)).rejects.toMatchObject({
    httpStatus: 503,
    code: 'test_request_preview_sandbox_required',
  });
  expect(deps.findRequestByNumber).not.toHaveBeenCalled();
  expect(deps.getRequestSharePointBuckets).not.toHaveBeenCalled();
});

test('loads a server-derived source summary and opaque allowlisted inventory', async () => {
  const deps = dependencies();
  const result = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);

  expect(result).toMatchObject({
    success: true,
    mode: 'read-only',
    executionEnabled: false,
    source: {
      requestId: SOURCE_ID,
      requestNumber: '1002001',
      applicant: 'Live University',
    },
    filePolicy: { approved: false },
  });
  expect(result.documents).toEqual([
    expect.objectContaining({
      kind: 'projectDescription',
      copyMode: 'copy',
      folder: 'Phase I',
    }),
  ]);
  expect(result.documents[0].id).not.toContain('graph-item-1');
  expect(result.documents[0]).not.toHaveProperty('library');
  expect(result.documents[0]).not.toHaveProperty('graphItemId');
  expect(deps.getFileMetadataById).not.toHaveBeenCalled();
  expect(deps.downloadFile).not.toHaveBeenCalled();
});

test('re-resolves and hashes the selected file, but strips every executable payload while policy is unapproved', async () => {
  const deps = dependencies();
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  const documentId = loaded.documents[0].id;
  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [documentId],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps);

  expect(deps.getRequestById).toHaveBeenCalledWith(SOURCE_ID);
  expect(deps.getFileMetadataById).toHaveBeenCalledTimes(2);
  expect(deps.downloadFile).toHaveBeenCalledWith('drive-1', 'graph-item-1');
  expect(result.executionEnabled).toBe(false);
  expect(result.preview.planReady).toBe(false);
  expect(result.preview.executionReady).toBe(false);
  expect(result.preview.requestPlan.createBody).toBeNull();
  expect(result.preview.filePlan.plannedFiles).toEqual([]);
  expect(result.preview.preview.files).toEqual([
    expect.objectContaining({ operation: 'blocked', source: expect.objectContaining({ id: documentId }) }),
  ]);
  expect(result.preview.blockers).toContainEqual(expect.objectContaining({
    code: 'FILE_POLICY_APPROVAL_REQUIRED',
    scope: 'files',
  }));
  expect(result.preview.preview.request).toMatchObject({
    authoritative: false,
    body: {
      akoya_requestid: DESTINATION_ID,
      'akoya_applicantid@odata.bind': `/accounts(${FOUNDATION_ID})`,
      akoya_title: 'TEST: Preview fixture',
      akoya_requesttype: 100000000,
      wmkf_istestrequest: true,
      wmkf_testcreationrunid: RUN_ID,
      wmkf_respondreminderenabled: false,
      wmkf_reviewduereminderenabled: false,
    },
  });
});

test('unknown browser inventory IDs stay blocked and are never sent to Graph', async () => {
  const deps = dependencies();
  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: ['not-in-the-server-inventory'],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps);

  expect(deps.getDriveId).not.toHaveBeenCalled();
  expect(deps.downloadFile).not.toHaveBeenCalled();
  expect(result.preview.blockers).toContainEqual(expect.objectContaining({
    code: 'FILE_SELECTION_UNKNOWN',
    scope: 'files',
  }));
  expect(result.preview.requestPlan.createBody).toBeNull();
});

test('duplicate browser selections are blocked after hashing each source version only once', async () => {
  const deps = dependencies();
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  const documentId = loaded.documents[0].id;
  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [documentId, documentId],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps);

  expect(deps.downloadFile).toHaveBeenCalledTimes(1);
  expect(result.preview.blockers).toContainEqual(expect.objectContaining({
    code: 'FILE_SELECTION_DUPLICATE',
    scope: 'files',
  }));
  expect(result.preview.requestPlan.createBody).toBeNull();
});

test('a source version change during hashing returns a stale-source conflict', async () => {
  const deps = dependencies();
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  deps.getFileMetadataById
    .mockResolvedValueOnce({
      id: 'graph-item-1', name: 'ProjectDescription.pdf', size: Buffer.byteLength('preview-pdf'),
      mimeType: 'application/pdf', eTag: 'etag-1', versionId: '1.0',
    })
    .mockResolvedValueOnce({
      id: 'graph-item-1', name: 'ProjectDescription.pdf', size: Buffer.byteLength('preview-pdf'),
      mimeType: 'application/pdf', eTag: 'etag-2', versionId: '2.0',
    });

  await expect(buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [loaded.documents[0].id],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'test_request_preview_source_changed',
  });
});
