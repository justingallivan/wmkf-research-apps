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

function itemResponse(currentVersionId = '9.0') {
  return response(200, {
    id: 'item',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    publication: { versionId: currentVersionId },
  });
}

it('stops after the page cap and fetches an unobserved authoritative current version directly', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const currentEntry = {
    id: '9.0',
    lastModifiedBy: { user: { displayName: 'Authoritative Current Editor' } },
  };
  const versionPages = [
    response(200, {
      value: [{ id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
    }),
    response(200, {
      value: [{ id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page3',
    }),
    response(200, {
      value: [{ id: '3.0', lastModifiedDateTime: '2026-08-03T00:00:00Z' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page4',
    }),
    response(200, { value: [currentEntry] }),
  ];
  let listPage = 0;
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse())
    .mockImplementation(async (url) => {
      if (url.endsWith('/versions/9.0')) {
        return response(200, currentEntry);
      }
      const page = versionPages[listPage];
      listPage += 1;
      return page;
    });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 2 });

  // 1 item metadata call + MAX_VERSION_PAGES list pages + 1 direct current lookup.
  expect(global.fetch).toHaveBeenCalledTimes(5);
  expect(global.fetch.mock.calls.some(([url]) => url.includes('$skiptoken=page4'))).toBe(false);
  expect(result.versions[0]).toMatchObject({
    versionId: '9.0',
    isCurrent: true,
    lastModifiedBy: 'Authoritative Current Editor',
  });
  expect(result.hasMore).toBe(true);
});

it('returns the pages already fetched when the time budget runs out mid-pagination', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const realNow = Date.now;
  let clock = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => clock);

  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse('3.0'))
    .mockImplementationOnce(async () => {
      // The first page succeeds, then the caller's budget is effectively gone.
      clock += 29_500;
      return response(200, {
        value: [
          { id: '3.0', lastModifiedBy: { user: { displayName: 'Real Editor' } } },
          { id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' },
        ],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
      });
    });

  // The whole read must NOT fail: discarding page one would leave the most-edited
  // documents with no audit trail at all.
  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions[0]).toMatchObject({ versionId: '3.0', isCurrent: true, lastModifiedBy: 'Real Editor' });
  expect(result.hasMore).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  Date.now = realNow;
});

it('returns page one as truncated when a continuation fetch is rejected', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse('1.0'))
    .mockResolvedValueOnce(response(200, {
      value: [{
        id: '1.0',
        lastModifiedBy: { user: { displayName: 'Page One Editor' } },
      }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
    }))
    .mockRejectedValueOnce(new TypeError('network unavailable'));

  await expect(GraphService.listFileVersions('drive', 'item', { limit: 20 }))
    .resolves.toMatchObject({
      versions: [{
        versionId: '1.0',
        isCurrent: true,
        lastModifiedBy: 'Page One Editor',
      }],
      hasMore: true,
    });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

it('returns page one as truncated when a continuation responds 503', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse('1.0'))
    .mockResolvedValueOnce(response(200, {
      value: [{
        id: '1.0',
        lastModifiedBy: { user: { displayName: 'Page One Editor' } },
      }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
    }))
    .mockResolvedValueOnce(response(503, { error: 'temporarily unavailable' }));

  await expect(GraphService.listFileVersions('drive', 'item', { limit: 20 }))
    .resolves.toMatchObject({
      versions: [{
        versionId: '1.0',
        isCurrent: true,
        lastModifiedBy: 'Page One Editor',
      }],
      hasMore: true,
    });
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

it('reports no more versions after fully exhausting multiple pages under the limit', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse('2.0'))
    .mockResolvedValueOnce(response(200, {
      value: [{ id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page2',
    }))
    .mockResolvedValueOnce(response(200, {
      value: [{
        id: '2.0',
        lastModifiedDateTime: '2026-08-02T00:00:00Z',
        lastModifiedBy: { user: { displayName: 'Current Editor' } },
      }],
    }));

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions).toHaveLength(2);
  expect(result.versions[0]).toMatchObject({
    versionId: '2.0',
    isCurrent: true,
    lastModifiedBy: 'Current Editor',
  });
  expect(result.hasMore).toBe(false);
  expect(global.fetch).toHaveBeenCalledTimes(3);
});

it('reports more versions when the page cap stops a scan under the result limit', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  let page = 0;
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse('1.0'))
    .mockImplementation(async () => {
      page += 1;
      return response(200, {
        value: [{ id: `${page}.0`, lastModifiedDateTime: `2026-08-0${page}T00:00:00Z` }],
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page${page}`,
      });
    });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions).toHaveLength(3);
  expect(result.hasMore).toBe(true);
  expect(global.fetch).toHaveBeenCalledTimes(4);
});
