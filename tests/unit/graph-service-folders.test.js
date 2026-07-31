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
  GraphService.clearCaches();
  jest.restoreAllMocks();
  jest.useRealTimers();
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

it('keeps cold token acquisition inside the file-metadata deadline', async () => {
  jest.useFakeTimers();
  GraphService.clearCaches();
  const originalCredentials = {
    DYNAMICS_TENANT_ID: process.env.DYNAMICS_TENANT_ID,
    DYNAMICS_CLIENT_ID: process.env.DYNAMICS_CLIENT_ID,
    DYNAMICS_CLIENT_SECRET: process.env.DYNAMICS_CLIENT_SECRET,
  };
  Object.assign(process.env, {
    DYNAMICS_TENANT_ID: 'tenant',
    DYNAMICS_CLIENT_ID: 'client',
    DYNAMICS_CLIENT_SECRET: 'secret',
  });
  global.fetch = jest.fn(() => new Promise((resolve) => {
    setTimeout(() => resolve(response(200, {
      access_token: 'eventual-token',
      expires_in: 3600,
    })), 50);
  }));

  try {
    const metadata = GraphService.getFileMetadataById(
      'drive',
      'item',
      { timeoutMs: 25 },
    );
    const rejection = expect(metadata).rejects.toMatchObject({
      noResponse: true,
      isTransient: true,
    });
    await jest.advanceTimersByTimeAsync(25);

    await rejection;
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(25);
  } finally {
    for (const [key, value] of Object.entries(originalCredentials)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

it('lets concurrent token callers keep independent wait deadlines', async () => {
  jest.useFakeTimers();
  GraphService.clearCaches();
  const originalCredentials = {
    DYNAMICS_TENANT_ID: process.env.DYNAMICS_TENANT_ID,
    DYNAMICS_CLIENT_ID: process.env.DYNAMICS_CLIENT_ID,
    DYNAMICS_CLIENT_SECRET: process.env.DYNAMICS_CLIENT_SECRET,
  };
  Object.assign(process.env, {
    DYNAMICS_TENANT_ID: 'tenant',
    DYNAMICS_CLIENT_ID: 'client',
    DYNAMICS_CLIENT_SECRET: 'secret',
  });
  global.fetch = jest.fn(() => new Promise((resolve) => {
    setTimeout(() => resolve(response(200, {
      access_token: 'shared-token',
      expires_in: 3600,
    })), 15);
  }));

  try {
    const shortWait = GraphService.getAccessToken({ timeoutMs: 10 });
    const longWait = GraphService.getAccessToken({ timeoutMs: 30 });
    const shortRejection = expect(shortWait).rejects.toMatchObject({
      noResponse: true,
      isTransient: true,
    });

    await jest.advanceTimersByTimeAsync(10);
    await shortRejection;
    await jest.advanceTimersByTimeAsync(5);

    await expect(longWait).resolves.toBe('shared-token');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  } finally {
    for (const [key, value] of Object.entries(originalCredentials)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

it('returns null when a stable Graph item no longer exists', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(404));

  await expect(GraphService.getFileMetadataById('drive', 'missing-item'))
    .resolves.toBeNull();
});

it('does not present a Graph content tag as a SharePoint version', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, {
    id: 'item',
    name: 'Assessment.docx',
    size: 125,
    webUrl: 'https://example.sharepoint.com/current',
    eTag: '"current-etag"',
    cTag: '"content-tag-not-a-version"',
    lastModifiedDateTime: '2026-07-31T01:33:55Z',
    file: {
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
  }));

  await expect(GraphService.getFileMetadataById('drive', 'item'))
    .resolves.toMatchObject({ versionId: null });
});

it.each([
  [{
    id: 'item',
    name: 'Folder',
    webUrl: 'https://example.sharepoint.com/folder',
    folder: { childCount: 1 },
  }, 'item'],
  [{
    id: 'different-item',
    name: 'Assessment.docx',
    webUrl: 'https://example.sharepoint.com/current',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  }, 'item'],
])('fails closed when stable metadata does not identify the expected file', async (body, itemId) => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, body));

  await expect(GraphService.getFileMetadataById('drive', itemId))
    .rejects.toMatchObject({ code: 'graph_file_identity_mismatch' });
});
