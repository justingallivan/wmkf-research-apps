/** @jest-environment node */

// These bridges deliberately use the real GraphService facade and mock only
// persistence/external HTTP seams. Consumer suites that mock GraphService prove
// their own policies; these three checks prove the facade DTO/error handoff.
jest.mock('../../lib/dataverse/adapters/grant-request.js', () => ({
  getById: jest.fn(),
  findByIds: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/request-document.js', () => ({
  findByRequest: jest.fn(),
  findByGenerationKey: jest.fn(),
}));

import * as grantRequestAdapter from '../../lib/dataverse/adapters/grant-request.js';
import * as requestDocumentAdapter from '../../lib/dataverse/adapters/request-document.js';
import { GraphService } from '../../lib/services/graph-service.js';
import { listInitialAssessmentArtifactVersions } from '../../lib/services/initial-assessment/artifact-reader.js';
import { finalizeMaterialUpload } from '../../lib/services/site-visit-materials/contributor-service.js';
import { searchDocuments } from '../../lib/services/dynamics-explorer/tools/documents.js';

const originalFetch = global.fetch;
const requestId = '11111111-1111-4111-8111-111111111111';
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj');

function response(status, body = {}, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(name => headers[String(name).toLowerCase()] ?? null) },
  };
}

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  jest.clearAllMocks();
  global.fetch = originalFetch;
});

test('real facade partial version salvage reaches the Initial Assessment caller DTO', async () => {
  const artifactId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  grantRequestAdapter.getById.mockResolvedValue({
    akoya_requestid: requestId,
    _wmkf_currentinitialassessment_value: artifactId,
  });
  requestDocumentAdapter.findByRequest.mockResolvedValue({ records: [{
    wmkf_requestdocumentid: artifactId,
    _wmkf_request_value: requestId,
    wmkf_artifacttype: 100000000,
    wmkf_operationstatus: 100000001,
    wmkf_lifecyclestate: 100000000,
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'item',
    wmkf_sharepointsiteid: 'site',
  }] });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn(async url => {
    if (!String(url).includes('/drives/drive/items/item')) throw new Error(`unexpected Graph URL: ${url}`);
    const call = global.fetch.mock.calls.length;
    if (call === 1) return response(200, { id: 'item', file: {}, publication: { versionId: '2.0' } });
    if (call === 2) return response(200, { id: '2.0', lastModifiedBy: { user: { displayName: 'Editor' } } });
    if (call === 3) return response(200, {
      value: [{ id: '1.0', lastModifiedDateTime: '2026-09-18T00:00:00Z' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=next',
    });
    return response(503, { error: 'continuation unavailable' });
  });

  await expect(listInitialAssessmentArtifactVersions({ requestId, limit: 20 })).resolves.toMatchObject({
    success: true,
    status: 'current',
    hasMore: true,
    versions: [expect.objectContaining({ versionId: '2.0', isCurrent: true }), expect.objectContaining({ versionId: '1.0' })],
  });
  expect(global.fetch).toHaveBeenCalledTimes(4);
});

test('real facade upload identity reaches the contributor candidate and registry fields', async () => {
  const created = [];
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  const dependencies = {
    otherUploadsEnabled: () => true,
    getRequest: jest.fn().mockResolvedValue({ akoya_requestid: requestId, akoya_requestnum: '1003001', wmkf_meetingdate: '2026-10-01' }),
    getUploadMaxMb: jest.fn().mockResolvedValue({ maxMb: 100 }),
    scanEnabled: () => false,
    acquireSlotLease: jest.fn().mockResolvedValue({ leaseToken: 'lease' }),
    findDocumentByGenerationKey: jest.fn().mockResolvedValue({ records: [] }),
    findDocumentsByRequest: jest.fn().mockResolvedValue({ records: [] }),
    getSharePointBuckets: jest.fn().mockResolvedValue([{ source: 'dynamics', library: 'akoya_request', folder: '1003001_REQUEST' }]),
    ensureFolderPath: jest.fn().mockResolvedValue({}),
    uploadFile: (...args) => GraphService.uploadFile(...args),
    recordPortalUploadCandidate: jest.fn().mockResolvedValue(undefined),
    createDocument: jest.fn().mockImplementation(async payload => { created.push(payload); return { wmkf_requestdocumentid: 'registry-row' }; }),
    releaseSlotLease: jest.fn().mockResolvedValue(undefined),
    randomUUID: () => 'claim-token',
    now: () => new Date('2026-09-19T00:00:00Z'),
  };
  global.fetch = jest.fn(async (url, init = {}) => {
    if (init.method !== 'PUT' || !String(url).includes('/drives/drive/root:/')) {
      throw new Error(`unexpected Graph URL: ${url}`);
    }
    return response(201, {
      id: 'graph-item', name: '1003001 Presentation.pdf', size: 4,
      webUrl: 'https://sharepoint.test/item', publication: { versionId: '3.0' },
    });
  });
  const result = await finalizeMaterialUpload({
    collection: { id: 'collection', request_id: requestId, checklist: [{ key: 'presentation_pdf', waived: false }] },
    slotKey: 'presentation_pdf',
    file: { filename: 'slides.pdf', buffer: PDF, sha256: 'hash' },
    stagingId: 'staging',
    leaseToken: 'claim-lease',
  }, dependencies);
  expect(result).toMatchObject({ ok: true, artifactId: 'registry-row' });
  expect(dependencies.recordPortalUploadCandidate).toHaveBeenCalledWith(expect.objectContaining({
    candidate: expect.objectContaining({ driveId: 'drive', itemId: 'graph-item', versionId: '3.0' }),
  }));
  expect(created[0]).toMatchObject({
    wmkf_sharepointdriveid: 'drive',
    wmkf_sharepointitemid: 'graph-item',
    wmkf_sharepointversionid: '3.0',
    wmkf_sharepointweburl: 'https://sharepoint.test/item',
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('real facade throttle errors reach Explorer as incomplete with retry guidance', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn(async (url) => {
    if (!String(url).endsWith('/search/query')) throw new Error(`unexpected Graph URL: ${url}`);
    return response(429, { error: 'tenant throttled' }, { 'retry-after': '60' });
  });
  const result = await searchDocuments({ query: 'budget', library: 'akoya_request' }, {});
  expect(result).toMatchObject({ searchCount: 0, incomplete: true, retryAfterMs: 60_000 });
  expect(result.error).toContain('SharePoint search service throttled or timed out');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
