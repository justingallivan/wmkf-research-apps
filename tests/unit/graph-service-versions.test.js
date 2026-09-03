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

function itemResponse(currentVersionId = '9.0') {
  return response(200, {
    id: 'item',
    file: { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    publication: { versionId: currentVersionId },
  });
}

function nextLink(token) {
  return `https://graph.microsoft.com/v1.0/drives/drive/items/item/versions?$skiptoken=${token}`;
}

/**
 * Route mock responses by URL SHAPE rather than call order.
 *
 * Order-coupled `mockResolvedValueOnce` chains encode the implementation's exact
 * request sequence, so reordering calls — as moving the current-version fetch
 * ahead of pagination did — breaks every fixture at once and hides whether the
 * behaviour actually regressed. Routing by URL keeps each test asserting what it
 * means to assert.
 *
 * `pages` entries may be a response, or a function (to throw, or to advance a
 * clock before responding).
 */
function routeGraph({ item, current, pages = [] }) {
  let pageIndex = 0;
  global.fetch = jest.fn(async (url) => {
    if (url.includes('$select=id,file,publication')) return item;
    if (/\/versions\/[^/?]+$/.test(url)) {
      if (typeof current === 'function') return current();
      return current;
    }
    const page = pages[pageIndex];
    pageIndex += 1;
    if (typeof page === 'function') return page();
    if (page === undefined) throw new Error(`unexpected version page request: ${url}`);
    return page;
  });
}

afterEach(() => {
  GraphService.clearCaches();
  jest.restoreAllMocks();
  global.fetch = setupFetch;
});

it('downloads an exact historical version through a pre-authenticated redirect without forwarding auth', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const bytes = Buffer.from('historical-word');
  global.fetch = jest.fn(async (url, options) => {
    if (String(url).startsWith('https://graph.microsoft.com/')) {
      return {
        ok: false,
        status: 302,
        headers: { get: (name) => (name.toLowerCase() === 'location' ? 'https://download.test/version' : null) },
        text: jest.fn(async () => ''),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: jest.fn(() => null) },
      arrayBuffer: jest.fn(async () => bytes),
      text: jest.fn(async () => ''),
    };
  });

  await expect(GraphService.downloadFileVersion('drive/id', 'item/id', '2.0')).resolves.toEqual(bytes);
  expect(global.fetch.mock.calls[0][0]).toContain('/drives/drive%2Fid/items/item%2Fid/versions/2.0/content');
  expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
  expect(global.fetch.mock.calls[1][1].headers).toBeUndefined();
});

it('reads one exact version identity from Graph', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200, {
    id: '2.0',
    size: 123,
    lastModifiedDateTime: '2026-08-02T00:00:00Z',
    lastModifiedBy: { user: { displayName: 'Editor' } },
  }));

  await expect(GraphService.getFileVersionMetadata('drive/id', 'item/id', '2.0')).resolves.toEqual({
    versionId: '2.0',
    size: 123,
    lastModified: '2026-08-02T00:00:00Z',
    lastModifiedBy: 'Editor',
  });
  expect(global.fetch.mock.calls[0][0]).toContain('/drives/drive%2Fid/items/item%2Fid/versions/2.0');
});

it('restores a historical version through the v1.0 restoreVersion endpoint', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(204));

  await expect(GraphService.restoreFileVersion('drive/id', 'item/id', '2.0')).resolves.toBeUndefined();
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/drives/drive%2Fid/items/item%2Fid/versions/2.0/restoreVersion'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }),
  );
});

it('fails closed when Graph returns an undocumented success shape for version restore', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(200));

  await expect(GraphService.restoreFileVersion('drive', 'item', '2.0'))
    .rejects.toMatchObject({ code: 'graph_restore_unexpected_status' });
});

it('can make a path upload create-only instead of replacing an existing file', async () => {
  jest.spyOn(GraphService, 'getSiteId').mockResolvedValue('site');
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(201, {
    id: 'new-item',
    name: 'snapshot.docx',
    size: 5,
    webUrl: 'https://sharepoint.test/snapshot',
    eTag: 'etag',
    cTag: 'ctag',
    lastModifiedDateTime: '2026-08-30T20:00:00Z',
  }));

  await GraphService.uploadFile(
    'akoya_request',
    'Request/Board Milestones',
    'snapshot.docx',
    Buffer.from('bytes'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { conflictBehavior: 'fail' },
  );

  expect(global.fetch.mock.calls[0][0]).toContain('@microsoft.graph.conflictBehavior=fail');
});

it('uses an asserted site/drive pair without re-resolving upload identity', async () => {
  const getSiteId = jest.spyOn(GraphService, 'getSiteId');
  const getDriveId = jest.spyOn(GraphService, 'getDriveId');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(201, {
    id: 'new-item', name: 'snapshot.docx', size: 5,
  }));

  const result = await GraphService.uploadFile(
    'akoya_request',
    'Request/Board Milestones',
    'snapshot.docx',
    Buffer.from('bytes'),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { conflictBehavior: 'fail', siteId: 'asserted-site', driveId: 'asserted-drive' },
  );

  expect(result).toMatchObject({ siteId: 'asserted-site', driveId: 'asserted-drive' });
  expect(getSiteId).not.toHaveBeenCalled();
  expect(getDriveId).not.toHaveBeenCalled();
  expect(global.fetch.mock.calls[0][0]).toContain('/drives/asserted-drive/');
});

it('rejects a partial asserted identity before a path read or upload', async () => {
  jest.spyOn(GraphService, 'getAccessToken');

  await expect(GraphService.getFileMetadataByPath(
    'akoya_request', 'Request/Reviews', 'review.docx', { siteId: 'site-only' },
  )).rejects.toThrow('siteId and driveId must be supplied together');
  await expect(GraphService.uploadFile(
    'akoya_request', 'Request/Reviews', 'review.docx', Buffer.from('bytes'),
    undefined, { driveId: 'drive-only' },
  )).rejects.toThrow('siteId and driveId must be supplied together');

  expect(GraphService.getAccessToken).not.toHaveBeenCalled();
});

it('downloads Graph PDF conversion bytes from the frozen Word item', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const bytes = Buffer.from('%PDF-test');
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: jest.fn(() => null) },
    arrayBuffer: jest.fn(async () => bytes),
    text: jest.fn(async () => ''),
  }));

  await expect(GraphService.downloadFileAsPdf('drive', 'word-item')).resolves.toEqual(bytes);
  expect(global.fetch.mock.calls[0][0]).toBe(
    'https://graph.microsoft.com/v1.0/drives/drive/items/word-item/content?format=pdf',
  );
});

it('marks the authoritative current version even when a page reports it late', async () => {
  routeGraph({
    item: itemResponse('4.0'),
    current: response(200, { id: '4.0', lastModifiedBy: { user: { displayName: 'Later Page Editor' } } }),
    pages: [
      response(200, {
        value: [
          { id: '3.0', lastModifiedDateTime: '2026-08-03T00:00:00Z' },
          { id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' },
        ],
        '@odata.nextLink': nextLink('page2'),
      }),
      response(200, {
        value: [
          { id: '4.0', lastModifiedBy: { user: { displayName: 'Later Page Editor' } } },
          { id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' },
        ],
      }),
    ],
  });
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 2 });

  expect(result.versions).toEqual([
    expect.objectContaining({ versionId: '4.0', isCurrent: true, lastModifiedBy: 'Later Page Editor' }),
    expect.objectContaining({ versionId: '3.0', isCurrent: false }),
  ]);
  // The page copy of 4.0 must not produce a duplicate row.
  expect(result.versions.filter((v) => v.versionId === '4.0')).toHaveLength(1);
  expect(result.hasMore).toBe(true);
  expect(result.limit).toBe(2);
});

it('stops after the page cap and still reports the authoritative current version', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  let page = 0;
  routeGraph({
    item: itemResponse('9.0'),
    current: response(200, { id: '9.0', lastModifiedBy: { user: { displayName: 'Authoritative Current Editor' } } }),
    pages: Array.from({ length: 6 }, () => () => {
      page += 1;
      return response(200, {
        value: [{ id: `${page}.0`, lastModifiedDateTime: `2026-08-0${page}T00:00:00Z` }],
        '@odata.nextLink': nextLink(`page${page}`),
      });
    }),
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 2 });

  // item metadata + current version + MAX_VERSION_PAGES list pages.
  expect(global.fetch).toHaveBeenCalledTimes(5);
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

  routeGraph({
    item: itemResponse('3.0'),
    current: response(200, { id: '3.0', lastModifiedBy: { user: { displayName: 'Real Editor' } } }),
    pages: [() => {
      clock += 29_500;
      return response(200, {
        value: [{ id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      });
    }],
  });

  // The whole read must NOT fail: discarding page one would leave the most-edited
  // documents with no audit trail at all.
  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions[0]).toMatchObject({ versionId: '3.0', isCurrent: true, lastModifiedBy: 'Real Editor' });
  expect(result.hasMore).toBe(true);
  Date.now = realNow;
});

it('keeps salvaged pages when the budget is gone and the current version was not on page one', async () => {
  // The interaction that broke the previous design: the scan stopped BECAUSE the
  // budget was spent, and the current-version fetch then inherited that spent
  // budget and threw, destroying the salvaged rows. Fetching the current entry
  // FIRST means nothing it does can endanger rows that do not exist yet.
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  const realNow = Date.now;
  let clock = realNow.call(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => clock);

  routeGraph({
    item: itemResponse('9.0'),
    current: response(200, { id: '9.0', lastModifiedBy: { user: { displayName: 'Authoritative Current Editor' } } }),
    pages: [() => {
      clock += 29_500;
      return response(200, {
        value: [{ id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      });
    }],
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions).toEqual([
    expect.objectContaining({ versionId: '9.0', isCurrent: true, lastModifiedBy: 'Authoritative Current Editor' }),
    expect.objectContaining({ versionId: '1.0', isCurrent: false }),
  ]);
  expect(result.hasMore).toBe(true);
  Date.now = realNow;
});

it('returns page one as truncated when a continuation fetch is rejected', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  routeGraph({
    item: itemResponse('1.0'),
    current: response(200, { id: '1.0', lastModifiedBy: { user: { displayName: 'Page One Editor' } } }),
    pages: [
      response(200, {
        value: [{ id: '0.9', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      }),
      () => { throw new TypeError('network unavailable'); },
    ],
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions[0]).toMatchObject({ versionId: '1.0', isCurrent: true, lastModifiedBy: 'Page One Editor' });
  expect(result.hasMore).toBe(true);
});

it('returns page one as truncated when a continuation responds 503', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  routeGraph({
    item: itemResponse('1.0'),
    current: response(200, { id: '1.0', lastModifiedBy: { user: { displayName: 'Page One Editor' } } }),
    pages: [
      response(200, {
        value: [{ id: '0.9', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      }),
      response(503, { error: 'temporarily unavailable' }),
    ],
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions[0]).toMatchObject({ versionId: '1.0', isCurrent: true, lastModifiedBy: 'Page One Editor' });
  expect(result.hasMore).toBe(true);
});

it('does not report a missing file when a continuation page 404s', async () => {
  // Item metadata already proved the item exists, so a versions-endpoint 404 must
  // not return null — the caller maps null to `missing`, which would tell staff
  // the registered file could not be found mid-read.
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  routeGraph({
    item: itemResponse('2.0'),
    current: response(200, { id: '2.0', lastModifiedBy: { user: { displayName: 'Editor' } } }),
    pages: [
      response(200, {
        value: [{ id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      }),
      response(404, { error: 'not found' }),
    ],
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result).not.toBeNull();
  expect(result.versions.map((v) => v.versionId)).toEqual(['2.0', '1.0']);
  expect(result.hasMore).toBe(true);
});

it('still reports a missing file when item metadata itself 404s', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  global.fetch = jest.fn().mockResolvedValue(response(404, { error: 'gone' }));

  await expect(GraphService.listFileVersions('drive', 'item', { limit: 20 })).resolves.toBeNull();
});

it('fails loud when the FIRST versions page 404s, rather than claiming the file is missing', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  routeGraph({
    item: itemResponse('2.0'),
    current: response(200, { id: '2.0' }),
    pages: [response(404, { error: 'not found' })],
  });

  await expect(GraphService.listFileVersions('drive', 'item', { limit: 20 })).rejects.toThrow();
});

it('reports no more versions after fully exhausting multiple pages under the limit', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  routeGraph({
    item: itemResponse('2.0'),
    current: response(200, {
      id: '2.0',
      lastModifiedDateTime: '2026-08-02T00:00:00Z',
      lastModifiedBy: { user: { displayName: 'Current Editor' } },
    }),
    pages: [
      response(200, {
        value: [{ id: '1.0', lastModifiedDateTime: '2026-08-01T00:00:00Z' }],
        '@odata.nextLink': nextLink('page2'),
      }),
      response(200, { value: [{ id: '2.0', lastModifiedDateTime: '2026-08-02T00:00:00Z' }] }),
    ],
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  expect(result.versions).toHaveLength(2);
  expect(result.versions[0]).toMatchObject({
    versionId: '2.0',
    isCurrent: true,
    lastModifiedBy: 'Current Editor',
  });
  // Every page was consumed and the total is under the cap: claiming more exist
  // would be a false statement about the record.
  expect(result.hasMore).toBe(false);
});

it('reports more versions when the page cap stops a scan under the result limit', async () => {
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
  let page = 0;
  routeGraph({
    item: itemResponse('1.0'),
    current: response(200, { id: '1.0' }),
    pages: Array.from({ length: 6 }, () => () => {
      page += 1;
      return response(200, {
        value: [{ id: `0.${page}`, lastModifiedDateTime: `2026-08-0${page}T00:00:00Z` }],
        '@odata.nextLink': nextLink(`page${page}`),
      });
    }),
  });

  const result = await GraphService.listFileVersions('drive', 'item', { limit: 20 });

  // Current entry + 3 capped pages, well under the limit — so hasMore must come
  // from the early stop, not from the cap discarding rows.
  expect(result.versions).toHaveLength(4);
  expect(result.hasMore).toBe(true);
});
