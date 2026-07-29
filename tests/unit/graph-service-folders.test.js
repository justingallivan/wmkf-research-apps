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
