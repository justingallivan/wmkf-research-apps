/**
 * @jest-environment node
 */

import {
  buildTestRequestAdminPreview,
  createStrictTestRequestSourceDependencies,
  discoverTestRequestSourceDocuments,
  hydrateTestRequestSourceDocument,
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
    fields: {
      ...Object.fromEntries(Object.entries(specs).map(([field, [type, extra = {}]]) => [field, {
        createable: true,
        requiredLevel: 'None',
        type,
        ...(field === 'akoya_applicantid' ? { lookupTarget: 'accounts' } : {}),
        ...extra,
      }])),
      ownerid: { createable: true, requiredLevel: 'SystemRequired', type: 'Owner' },
      owneridtype: { createable: true, requiredLevel: 'SystemRequired', type: 'EntityName' },
    },
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
    getSharePointTargetInfo: jest.fn(() => ({
      key: 'akoyago-shared',
      scope: 'shared',
      registered: true,
      hostname: 'appriver3651007194.sharepoint.com',
      pathname: '/sites/akoyago',
    })),
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

test.each([
  ['production target', { deployment: 'local', target: 'production', hostname: 'wmkf.crm.dynamics.com' }],
  ['unknown target', { deployment: 'local', target: 'unknown', hostname: 'unlisted.crm.dynamics.com' }],
])('fails closed for a %s on both service entry points before reads', async (_label, target) => {
  const deps = dependencies({ getTargetInfo: jest.fn(() => target) });

  await expect(loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps))
    .rejects.toMatchObject({ code: 'test_request_preview_sandbox_required' });
  await expect(buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps)).rejects.toMatchObject({ code: 'test_request_preview_sandbox_required' });
  expect(deps.findRequestByNumber).not.toHaveBeenCalled();
  expect(deps.getRequestById).not.toHaveBeenCalled();
  expect(deps.getRequestSharePointBuckets).not.toHaveBeenCalled();
});

test('fails closed for an unregistered SharePoint site before reading a Request', async () => {
  const deps = dependencies({
    getSharePointTargetInfo: jest.fn(() => ({
      key: null,
      scope: 'unknown',
      registered: false,
      hostname: 'appriver3651007194.sharepoint.com',
      pathname: '/sites/unreviewed',
    })),
  });

  await expect(loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps))
    .rejects.toMatchObject({ code: 'test_request_preview_sharepoint_target_required' });
  expect(deps.findRequestByNumber).not.toHaveBeenCalled();
  expect(deps.getRequestSharePointBuckets).not.toHaveBeenCalled();
});

test.each([
  'https://wmkf.crm.dynamics.com',
  'https://unlisted.crm.dynamics.com',
  'not-a-url',
])('the real target resolver rejects %s before default dependency reads', async (dynamicsUrl) => {
  const originalDynamicsUrl = process.env.DYNAMICS_URL;
  const originalVercelEnv = process.env.VERCEL_ENV;
  process.env.DYNAMICS_URL = dynamicsUrl;
  process.env.VERCEL_ENV = 'preview';
  try {
    await expect(loadTestRequestPreviewSource({ requestNumber: '1002001' }))
      .rejects.toMatchObject({ code: 'test_request_preview_sandbox_required' });
  } finally {
    if (originalDynamicsUrl === undefined) delete process.env.DYNAMICS_URL;
    else process.env.DYNAMICS_URL = originalDynamicsUrl;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  }
});

test('loads a server-derived source summary and opaque allowlisted inventory', async () => {
  const deps = dependencies();
  const result = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);

  expect(result).toMatchObject({
    success: true,
    mode: 'read-only',
    executionEnabled: false,
    environment: {
      target: 'sandbox',
      sharePoint: { key: 'akoyago-shared', scope: 'shared' },
    },
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
  expect(deps.getRequestSharePointBuckets).toHaveBeenCalledWith(SOURCE_ID, '1002001');
});

test('strict source export discovery aborts when parent resolution fails', async () => {
  const parentFailure = new Error('parent lookup failed');
  const deps = dependencies({
    getRequestSharePointBuckets: jest.fn(async (_requestId, _requestNumber, options) => {
      if (options?.requireResolvedParents) throw parentFailure;
      return [];
    }),
  });
  const strictDependencies = createStrictTestRequestSourceDependencies(deps);

  await expect(discoverTestRequestSourceDocuments(source, strictDependencies)).rejects.toBe(parentFailure);
  expect(deps.getRequestSharePointBuckets).toHaveBeenCalledWith(SOURCE_ID, '1002001', {
    requireResolvedParents: true,
    requireCompleteResults: true,
  });
});

test('source hydration carries durable Graph drive and registered site identity', async () => {
  const deps = dependencies();
  const inventory = await discoverTestRequestSourceDocuments(source, deps);
  const hydrated = await hydrateTestRequestSourceDocument(inventory.documents[0], deps);

  expect(hydrated).toMatchObject({
    driveId: 'drive-1',
    graphItemId: 'graph-item-1',
    sharePointSite: {
      key: 'akoyago-shared',
      hostname: 'appriver3651007194.sharepoint.com',
      pathname: '/sites/akoyago',
    },
  });
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
  expect(result.preview.filePlan.previewFiles).toEqual([]);
  expect(result.preview.preview.files).toEqual([
    expect.objectContaining({ operation: 'blocked', source: expect.objectContaining({ id: documentId }) }),
  ]);
  expect(result.preview.blockers).toContainEqual(expect.objectContaining({
    code: 'FILE_POLICY_APPROVAL_REQUIRED',
    scope: 'files',
  }));
  expect(result.preview.blockers).not.toContainEqual(expect.objectContaining({
    code: 'SYSTEM_REQUIRED_UNRESOLVED',
  }));
  expect(result.preview.preview.request.authoritative).toBe(false);
  expect(result.preview.preview.request).not.toHaveProperty('body');
  expect(result.preview.preview.request.fields).toEqual(expect.arrayContaining([
    { field: 'akoya_applicantid', value: 'W. M. Keck Foundation' },
    { field: 'akoya_title', value: 'TEST: Preview fixture' },
    { field: 'akoya_requesttype', value: 100000000 },
    { field: 'wmkf_istestrequest', value: true },
    { field: 'wmkf_testcreationrunid', value: RUN_ID },
  ]));
  expect(JSON.stringify(result.preview.preview.request)).not.toContain(DESTINATION_ID);
  expect(JSON.stringify(result.preview.preview.request)).not.toContain(FOUNDATION_ID);
  expect(result.preview.preview.files[0].source).toEqual({
    id: documentId,
    kind: 'projectDescription',
    name: 'ProjectDescription.pdf',
    folder: 'Phase I',
  });
  expect(JSON.stringify(result.preview)).not.toContain('drive-1');
  const publicResult = JSON.stringify(result);
  expect(publicResult).not.toContain('etag-1');
  expect(publicResult).not.toContain('contentHash');
  expect(publicResult).not.toContain('1002001_GUID/Phase I');
});

test('uses the re-resolved source cycle when the browser omits date overrides', async () => {
  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Preview fixture',
  }, dependencies());
  expect(result.preview.preview.request.fields).toEqual(expect.arrayContaining([
    { field: 'akoya_fiscalyear', value: 'December 2026' },
    { field: 'wmkf_meetingdate', value: '2026-12-04' },
  ]));
  expect(result.preview.blockers).not.toContainEqual(expect.objectContaining({ code: 'INPUT_INVALID' }));
});

test('turns a truncated SharePoint inventory into an explicit blocker', async () => {
  const error = Object.assign(new Error('bounded inventory'), { code: 'graph_file_list_truncated' });
  const deps = dependencies({ listFiles: jest.fn(async () => { throw error; }) });
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  expect(loaded.documents).toEqual([]);
  expect(loaded.inventoryErrors).toEqual([{ source: 'dynamics', code: 'SOURCE_BUCKET_TRUNCATED' }]);

  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps);
  expect(result.preview.blockers).toContainEqual(expect.objectContaining({
    code: 'SOURCE_INVENTORY_INCOMPLETE',
    detail: expect.stringContaining('bounded inventory limit'),
  }));
});

test('preserves transport failures instead of converting them to source-not-found', async () => {
  const transportError = new Error('transport unavailable');
  const deps = dependencies({ getRequestById: jest.fn(async () => { throw transportError; }) });
  await expect(buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps)).rejects.toBe(transportError);
});

test('maps a missing source Request to the typed 404 contract', async () => {
  const missing = Object.assign(new Error('dataverse failed (404)'), { status: 404 });
  const deps = dependencies({ getRequestById: jest.fn(async () => { throw missing; }) });
  await expect(buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps)).rejects.toMatchObject({ code: 'test_request_source_not_found', httpStatus: 404 });
});

test('rejects ambiguous request-number matches explicitly', async () => {
  const deps = dependencies({ findRequestByNumber: jest.fn(async () => ({ records: [source, { ...source }] })) });
  await expect(loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps))
    .rejects.toMatchObject({ code: 'test_request_source_ambiguous', httpStatus: 409 });
});

test('rejects MIME drift before downloading selected bytes', async () => {
  const deps = dependencies();
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  deps.getFileMetadataById.mockResolvedValueOnce({
    id: 'graph-item-1',
    name: 'ProjectDescription.pdf',
    size: Buffer.byteLength('preview-pdf'),
    mimeType: 'text/html',
    eTag: 'etag-1',
    versionId: null,
  });

  await expect(buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [loaded.documents[0].id],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps)).rejects.toMatchObject({ code: 'test_request_preview_source_changed' });
  expect(deps.downloadFile).not.toHaveBeenCalled();
});

test('accepts an eTag without conflating it with a missing publication version', async () => {
  const deps = dependencies();
  const loaded = await loadTestRequestPreviewSource({ requestNumber: '1002001' }, deps);
  const metadataWithoutPublicationVersion = {
    id: 'graph-item-1',
    name: 'ProjectDescription.pdf',
    size: Buffer.byteLength('preview-pdf'),
    mimeType: 'application/pdf',
    eTag: 'etag-only',
    versionId: null,
  };
  deps.getFileMetadataById.mockResolvedValue(metadataWithoutPublicationVersion);
  const result = await buildTestRequestAdminPreview({
    sourceRequestId: SOURCE_ID,
    selectedDocumentIds: [loaded.documents[0].id],
    testLabel: 'Preview fixture',
    fiscalYear: 'December 2027',
    meetingDate: '2027-12-03',
  }, deps);

  expect(result.preview.preview.files[0].source).not.toHaveProperty('eTag');
  expect(result.preview.preview.files[0].source).not.toHaveProperty('versionId');
  expect(result.preview.filePlan.previewFiles).toEqual([]);
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
