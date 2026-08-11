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

it('stops after the page cap instead of walking an unbounded version history', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  // Every page advertises a DISTINCT next page, so only the cap can end this —
  // an identical nextLink would be caught by the repeat-link guard instead and
  // would not exercise the bound.
  let page = 0;
  global.fetch = jest.fn()
    .mockResolvedValueOnce(itemResponse())
    .mockImplementation(async () => {
      page += 1;
      return response(200, {
        value: [{ id: `${page}.0`, lastModifiedDateTime: `2026-08-0${page}T00:00:00Z` }],
        '@odata.nextLink': `https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=page${page}`,
      });
    });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 2 });

  // 1 item metadata call + MAX_VERSION_PAGES version pages.
  expect(global.fetch).toHaveBeenCalledTimes(4);
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
