/** @jest-environment node */

import * as graphServiceModule from '../../lib/services/graph-service.js';
import { GraphService, SHAREPOINT_CANONICAL_SITE_URL } from '../../lib/services/graph-service.js';

const originalFetch = global.fetch;
const METHODS = {
  getAccessToken: [0, true],
  buildHeaders: [1, false],
  getSiteId: [0, true],
  getDriveId: [1, true],
  listFiles: [2, true],
  getFileMetadataById: [2, true],
  listFileVersions: [2, true],
  getFileVersionMetadata: [3, true],
  restoreFileVersion: [3, true],
  downloadFile: [2, true],
  downloadFileVersion: [3, true],
  downloadFileAsPdf: [2, true],
  downloadFileByPath: [3, true],
  getFileMetadataByPath: [3, true],
  ensureFolderPath: [2, true],
  searchFiles: [1, true],
  uploadFile: [4, true],
  uploadFileLarge: [4, true],
  replaceFileContent: [3, true],
  deleteFile: [2, true],
  clearCaches: [0, false],
};

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
  GraphService.clearCaches();
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

beforeEach(() => {
  global.fetch = jest.fn(() => { throw new Error('unexpected network in public-contract fixture'); });
});

test('keeps the named export, canonical URL, own static surface, arity, and sync/async split', () => {
  expect(SHAREPOINT_CANONICAL_SITE_URL).toBe('https://appriver3651007194.sharepoint.com/sites/akoyaGO');
  expect(Object.keys(graphServiceModule).sort()).toEqual(['GraphService', 'SHAREPOINT_CANONICAL_SITE_URL']);
  expect(Object.keys(METHODS)).toHaveLength(21);
  expect(Object.getOwnPropertyNames(GraphService)
    .filter(name => !['length', 'name', 'prototype'].includes(name)).sort())
    .toEqual(Object.keys(METHODS).sort());
  for (const [name, [arity, isAsync]] of Object.entries(METHODS)) {
    expect(GraphService[name]).toHaveLength(arity);
    expect(GraphService[name].constructor.name === 'AsyncFunction').toBe(isAsync);
  }
});

test('keeps representative public headers and stable metadata DTO keys', async () => {
  expect(GraphService.buildHeaders('token')).toEqual({
    Authorization: 'Bearer token',
    Accept: 'application/json',
  });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200, {
    id: 'item', name: 'doc.docx', size: 9, webUrl: 'https://sp/doc', eTag: 'etag', cTag: 'ctag',
    lastModifiedDateTime: '2026-09-19T00:00:00Z', file: { mimeType: 'application/msword' },
    publication: { versionId: '4.0' }, parentReference: { driveId: 'drive' },
  }));
  await expect(GraphService.getFileMetadataById('drive', 'item', { siteId: 'site' })).resolves.toEqual({
    siteId: 'site', driveId: 'drive', id: 'item', name: 'doc.docx', size: 9,
    webUrl: 'https://sp/doc', eTag: 'etag', versionId: '4.0', lastModified: '2026-09-19T00:00:00Z',
    mimeType: 'application/msword', parentReference: { driveId: 'drive' },
  });
});

test('retains async rejection versus synchronous helper behavior', async () => {
  const rejection = GraphService.getFileMetadataById('', 'item');
  expect(rejection).toBeInstanceOf(Promise);
  await expect(rejection).rejects.toThrow('driveId required');
  expect(() => GraphService.buildHeaders('')).not.toThrow();
});

test('forwards to the receiver so subclasses and spies observe internal dispatch', async () => {
  class Receiver extends GraphService {}
  const upload = jest.fn().mockResolvedValue({ id: 'simple' });
  Receiver.uploadFile = upload;
  await expect(Receiver.uploadFileLarge(
    'akoya_request', 'Folder', 'small.pdf', Buffer.from('bytes'), 'application/pdf', { conflictBehavior: 'fail' },
  )).resolves.toEqual({ id: 'simple' });
  expect(upload).toHaveBeenCalledWith(
    'akoya_request', 'Folder', 'small.pdf', expect.any(Buffer), 'application/pdf', { conflictBehavior: 'fail' },
  );

  const getDriveId = jest.fn().mockResolvedValue('drive');
  const download = jest.fn().mockResolvedValue({ buffer: Buffer.from('bytes') });
  Receiver.getDriveId = getDriveId;
  Receiver.downloadFile = download;
  Receiver.getAccessToken = jest.fn().mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200, { id: 'item', name: 'doc.pdf', file: {} }));
  await expect(Receiver.downloadFileByPath('akoya_request', 'Folder', 'doc.pdf'))
    .resolves.toEqual({ buffer: Buffer.from('bytes') });
  expect(download).toHaveBeenCalledWith('drive', 'item');
});

test('destructures options once and keeps supplied identity semantics', async () => {
  const getAccessToken = jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200, {
    value: [{ id: 'drive', name: 'Request', webUrl: 'https://tenant/akoya_request' }],
  }));
  let reads = 0;
  const options = {};
  Object.defineProperty(options, 'siteId', { get: () => { reads += 1; return 'supplied-site'; } });
  await expect(GraphService.getDriveId('akoya_request', options)).resolves.toBe('drive');
  expect(reads).toBe(1);
  expect(getAccessToken).toHaveBeenCalledTimes(1);
  expect(global.fetch.mock.calls[0][0]).toContain('/sites/supplied-site/drives');
});

test('preserves options defaults, null rejection, and getter failures at the public boundary', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200, {
    value: [{ id: 'drive', name: 'Request', webUrl: 'https://tenant/akoya_request' }],
  }));
  await expect(GraphService.getDriveId('akoya_request')).resolves.toBe('drive');
  GraphService.clearCaches();
  await expect(GraphService.getDriveId('akoya_request', undefined)).resolves.toBe('drive');
  await expect(GraphService.getDriveId('akoya_request', null)).rejects.toThrow(TypeError);
  await expect(GraphService.listFiles('akoya_request', 'Folder', null)).rejects.toThrow(TypeError);
  await expect(GraphService.uploadFile('akoya_request', 'Folder', 'x.txt', Buffer.from('x'), 'text/plain', null))
    .rejects.toThrow(TypeError);
  const throwingOptions = {};
  Object.defineProperty(throwingOptions, 'siteId', { get: () => { throw new Error('site getter failed'); } });
  await expect(GraphService.getDriveId('akoya_request', throwingOptions)).rejects.toThrow('site getter failed');
});
