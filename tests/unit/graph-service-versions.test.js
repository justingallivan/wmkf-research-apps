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
  global.fetch = setupFetch;
});

it('finds the authoritative current version on a later Graph page before truncating', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(200, {
      id: 'item',
      file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
      publication: { versionId: '4.0' },
    }))
    .mockResolvedValueOnce(response(200, {
      value: [
        { id: '3.0', lastModifiedDateTime: '2026-08-03T00:00:00Z' },
        { id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' },
      ],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
    }))
    .mockResolvedValueOnce(response(200, {
      value: [
        {
          id: '4.0',
          lastModifiedBy: { user: { displayName: 'Later Page Editor' } },
        },
        { id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' },
      ],
    }));

  await expect(GraphService.listFileVersions('drive', 'item', { limit: 2 }))
    .resolves.toMatchObject({
      versions: [
        {
          versionId: '4.0',
          isCurrent: true,
          lastModifiedBy: 'Later Page Editor',
        },
        { versionId: '3.0', isCurrent: false },
      ],
      hasMore: true,
      limit: 2,
    });
  expect(global.fetch).toHaveBeenCalledTimes(3);
  expect(global.fetch.mock.calls[0][0]).toContain('?$select=id,file,publication');
  expect(global.fetch.mock.calls[2][0]).toContain('$skiptoken=page2');
});
