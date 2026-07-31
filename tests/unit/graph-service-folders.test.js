/**
 * @jest-environment node
 */

import { GraphService } from '../../lib/services/graph-service.js';

const setupFetch = global.fetch;

function response(status, body = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn(async () => body),
    text: jest.fn(async () => JSON.stringify(body)),
    headers: { get: jest.fn(() => null) },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = setupFetch;
});

it('creates only missing folder segments under the existing request folder', async () => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      id: 'request-folder',
      name: '1003001_REQUEST',
      folder: {},
    }))
    .mockResolvedValueOnce(response(404))
    .mockResolvedValueOnce(response(201, {
      id: 'artifacts-folder',
      name: 'Artifacts',
      folder: {},
    }))
    .mockResolvedValueOnce(response(404))
    .mockResolvedValueOnce(response(201, {
      id: 'initial-folder',
      name: 'Initial Assessment',
      folder: {},
    }));

  const result = await GraphService.ensureFolderPath(
    'akoya_request',
    '1003001_REQUEST/Artifacts/Initial Assessment',
  );

  expect(result).toEqual({
    siteId: 'site',
    driveId: 'drive',
    id: 'initial-folder',
    path: '1003001_REQUEST/Artifacts/Initial Assessment',
  });
  const posts = global.fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[0][1].body)).toMatchObject({ name: 'Artifacts', folder: {} });
  expect(JSON.parse(posts[1][1].body)).toMatchObject({ name: 'Initial Assessment', folder: {} });
  expect(posts[1][0]).toContain('/items/artifacts-folder/children');
});

it('fails closed when a path segment is a file', async () => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, {
    id: 'not-a-folder',
    name: '1003001_REQUEST',
    file: { mimeType: 'text/plain' },
  }));

  await expect(GraphService.ensureFolderPath(
    'akoya_request',
    '1003001_REQUEST/Artifacts/Initial Assessment',
  )).rejects.toThrow('exists but is not a folder');
});

it('reuses a supplied site id when resolving a drive', async () => {
  const siteSpy = jest.spyOn(GraphService, 'getSiteId');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, {
    value: [{
      id: 'drive-from-site',
      name: 'Request',
      webUrl: 'https://example.sharepoint.com/akoya_request',
    }],
  }));

  await expect(GraphService.getDriveId('akoya_request', { siteId: 'known-site' }))
    .resolves.toBe('drive-from-site');
  expect(siteSpy).not.toHaveBeenCalled();
  expect(global.fetch.mock.calls[0][0]).toContain('/sites/known-site/drives');
});

it('reads current file metadata by encoded stable drive and item identity', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, {
    id: 'item/id',
    name: 'Current Assessment.docx',
    size: 125,
    webUrl: 'https://example.sharepoint.com/current',
    eTag: '"current-etag"',
    cTag: '"current-ctag"',
    lastModifiedDateTime: '2026-07-31T01:33:55Z',
    file: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    publication: { versionId: '2.0' },
    parentReference: { driveId: 'drive/id' },
  }));

  await expect(GraphService.getFileMetadataById(
    'drive/id',
    'item/id',
    { siteId: 'site' },
  )).resolves.toEqual({
    siteId: 'site',
    driveId: 'drive/id',
    id: 'item/id',
    name: 'Current Assessment.docx',
    size: 125,
    webUrl: 'https://example.sharepoint.com/current',
    eTag: '"current-etag"',
    versionId: '2.0',
    lastModified: '2026-07-31T01:33:55Z',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    parentReference: { driveId: 'drive/id' },
  });
  expect(global.fetch.mock.calls[0][0]).toContain('/drives/drive%2Fid/items/item%2Fid');
});

it('returns null when a stable Graph item no longer exists', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(404));

  await expect(GraphService.getFileMetadataById('drive', 'missing-item'))
    .resolves.toBeNull();
});
