/**
 * @jest-environment node
 */

import { GraphService } from '../../lib/services/graph-service.js';

function graphResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function graphErrorResponse(status, body) {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

beforeEach(() => {
  jest.restoreAllMocks();
  global.fetch = jest.fn();
  jest.spyOn(GraphService, 'getDriveId').mockResolvedValue('drive');
  jest.spyOn(GraphService, 'getAccessToken').mockResolvedValue('token');
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('follows bounded Graph children pagination', async () => {
  const nextLink = 'https://graph.microsoft.com/v1.0/drives/drive/root:/root:/children?$skiptoken=next';
  global.fetch
    .mockResolvedValueOnce(graphResponse({
      value: [{ id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } }],
      '@odata.nextLink': nextLink,
    }))
    .mockResolvedValueOnce(graphResponse({
      value: [{ id: 'two', name: 'two.pdf', size: 2, file: { mimeType: 'application/pdf' } }],
    }));

  await expect(GraphService.listFiles('akoya_request', 'root', { maxFiles: 3 }))
    .resolves.toEqual([
      expect.objectContaining({ id: 'one', folder: 'root' }),
      expect.objectContaining({ id: 'two', folder: 'root' }),
    ]);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

test('accepts Graph id-addressed children continuations for the same drive', async () => {
  const nextLink = 'https://graph.microsoft.com/v1.0/drives/drive/items/folder-item/children?$skiptoken=next';
  global.fetch
    .mockResolvedValueOnce(graphResponse({ value: [], '@odata.nextLink': nextLink }))
    .mockResolvedValueOnce(graphResponse({
      value: [{ id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } }],
    }));

  await expect(GraphService.listFiles('akoya_request', 'root'))
    .resolves.toEqual([expect.objectContaining({ id: 'one', folder: 'root' })]);
});

test('fails loud when a strict inventory exceeds maxFiles', async () => {
  global.fetch.mockResolvedValueOnce(graphResponse({
    value: [
      { id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } },
      { id: 'two', name: 'two.pdf', size: 2, file: { mimeType: 'application/pdf' } },
    ],
  }));

  await expect(GraphService.listFiles('akoya_request', 'root', {
    maxFiles: 1,
    failOnTruncation: true,
  })).rejects.toMatchObject({ code: 'graph_file_list_truncated' });
});

test('marks a Graph itemNotFound 404 from folder listing as a folder-level miss', async () => {
  global.fetch.mockResolvedValueOnce(graphErrorResponse(404, {
    error: { code: 'itemNotFound', message: 'The resource could not be found.' },
  }));

  await expect(GraphService.listFiles('akoya_request', 'missing-folder')).rejects.toMatchObject({
    status: 404,
    code: 'graph_folder_not_found',
    dataverseCode: 'itemNotFound',
  });
});

test('does not mark a missing child folder mid-walk as a folder-level miss', async () => {
  global.fetch
    .mockResolvedValueOnce(graphResponse({
      value: [
        { id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } },
        { id: 'sub', name: 'Phase I', folder: { childCount: 1 } },
      ],
    }))
    .mockResolvedValueOnce(graphErrorResponse(404, {
      error: { code: 'itemNotFound', message: 'The resource could not be found.' },
    }));

  let thrown;
  try {
    await GraphService.listFiles('akoya_request', 'root', { recursive: true, maxDepth: 3 });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ status: 404, dataverseCode: 'itemNotFound' });
  expect(thrown).not.toHaveProperty('code');
});

test('does not mark another Graph 404 code as a folder-level miss', async () => {
  global.fetch.mockResolvedValueOnce(graphErrorResponse(404, {
    error: { code: 'resourceNotFound', message: 'Another resource was unavailable.' },
  }));

  let thrown;
  try {
    await GraphService.listFiles('akoya_request', 'missing-folder');
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({
    status: 404,
    dataverseCode: 'resourceNotFound',
  });
  expect(thrown).not.toHaveProperty('code');
});

test('preserves bounded partial results for non-strict callers', async () => {
  global.fetch.mockResolvedValueOnce(graphResponse({
    value: [
      { id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } },
      { id: 'two', name: 'two.pdf', size: 2, file: { mimeType: 'application/pdf' } },
    ],
  }));

  await expect(GraphService.listFiles('akoya_request', 'root', { maxFiles: 1 }))
    .resolves.toEqual([expect.objectContaining({ id: 'one' })]);
});

test('does not report strict truncation when the only remaining child folder is empty', async () => {
  global.fetch
    .mockResolvedValueOnce(graphResponse({
      value: [
        { id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } },
        { id: 'empty-folder', name: 'Empty', folder: { childCount: 0 } },
      ],
    }))
    .mockResolvedValueOnce(graphResponse({ value: [] }));

  await expect(GraphService.listFiles('akoya_request', 'root', {
    recursive: true,
    maxFiles: 1,
    failOnTruncation: true,
  })).resolves.toEqual([expect.objectContaining({ id: 'one' })]);
});

test('does not report strict truncation for an empty final continuation page', async () => {
  const nextLink = 'https://graph.microsoft.com/v1.0/drives/drive/items/folder-item/children?$skiptoken=empty';
  global.fetch
    .mockResolvedValueOnce(graphResponse({
      value: [{ id: 'one', name: 'one.pdf', size: 1, file: { mimeType: 'application/pdf' } }],
      '@odata.nextLink': nextLink,
    }))
    .mockResolvedValueOnce(graphResponse({ value: [] }));

  await expect(GraphService.listFiles('akoya_request', 'root', {
    maxFiles: 1,
    failOnTruncation: true,
  })).resolves.toEqual([expect.objectContaining({ id: 'one' })]);
});

test('optionally excludes only UUID staging folders beneath Site Visit materials folders', async () => {
  const stagingId = '123e4567-e89b-12d3-a456-426614174000';
  const root = 'Grant Documents';
  global.fetch.mockImplementation(async (url) => {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('/root:/Grant%20Documents:/children')) {
      return graphResponse({ value: [
        { id: 'normal', name: 'proposal.pdf', size: 10, file: { mimeType: 'application/pdf' } },
        { id: 'slides', name: 'Site Visit - Slides', folder: { childCount: 2 } },
        { id: 'bios', name: 'Site Visit - Participant Bios', folder: { childCount: 1 } },
        { id: 'other', name: 'Site Visit - Other', folder: { childCount: 1 } },
        { id: 'portalish', name: 'portal-archive', folder: { childCount: 1 } },
        { id: 'unrelated', name: 'Unrelated', folder: { childCount: 1 } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/Site%20Visit%20-%20Slides:/children')) {
      return graphResponse({ value: [
        { id: 'stage', name: `portal-${stagingId}`, folder: { childCount: 1 } },
        { id: 'ordinary', name: 'portal-archive', folder: { childCount: 1 } },
        { id: 'slide', name: 'presentation.pdf', size: 20, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/Site%20Visit%20-%20Participant%20Bios:/children')) {
      return graphResponse({ value: [
        { id: 'bio-stage', name: `portal-${stagingId}`, folder: { childCount: 1 } },
        { id: 'bio', name: 'bios.pdf', size: 30, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/Site%20Visit%20-%20Other:/children')) {
      return graphResponse({ value: [
        { id: 'other-stage', name: `portal-${stagingId}`, folder: { childCount: 1 } },
        { id: 'other-file', name: 'notes.pdf', size: 40, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/Site%20Visit%20-%20Slides/portal-archive:/children')) {
      return graphResponse({ value: [
        { id: 'archive-file', name: 'archive.pdf', size: 50, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/portal-archive:/children')) {
      return graphResponse({ value: [
        { id: 'root-archive-file', name: 'archive-root.pdf', size: 55, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith('/root:/Grant%20Documents/Unrelated:/children')) {
      return graphResponse({ value: [
        { id: 'unrelated-stage', name: `portal-${stagingId}`, folder: { childCount: 1 } },
      ] });
    }
    if (pathname.endsWith(`/root:/Grant%20Documents/Unrelated/portal-${stagingId}:/children`)) {
      return graphResponse({ value: [
        { id: 'unrelated-file', name: 'unrelated.pdf', size: 56, file: { mimeType: 'application/pdf' } },
      ] });
    }
    if (pathname.endsWith(`/root:/Grant%20Documents/Site%20Visit%20-%20Slides/portal-${stagingId}:/children`)) {
      return graphResponse({ value: [
        { id: 'staged-file', name: 'new-upload.pdf', size: 60, file: { mimeType: 'application/pdf' } },
      ] });
    }
    throw new Error(`Unexpected Graph listing path: ${pathname}`);
  });

  const files = await GraphService.listFiles('akoya_request', root, {
    recursive: true,
    excludeApplicantMaterialsBackgroundUploads: true,
  });

  expect(files.map((file) => file.id)).toEqual([
    'normal', 'slide', 'archive-file', 'bio', 'other-file', 'root-archive-file', 'unrelated-file',
  ]);
  expect(global.fetch.mock.calls.some(([url]) => (
    String(url).includes(`/Site%20Visit%20-`) && String(url).includes(`/portal-${stagingId}:`)
  ))).toBe(false);
});

test('keeps staging folders in the legacy recursive inventory unless exclusion is opted into', async () => {
  const stagingId = '123e4567-e89b-12d3-a456-426614174000';
  global.fetch
    .mockResolvedValueOnce(graphResponse({ value: [
      { id: 'slides', name: 'Site Visit - Slides', folder: { childCount: 1 } },
    ] }))
    .mockResolvedValueOnce(graphResponse({ value: [
      { id: 'stage', name: `portal-${stagingId}`, folder: { childCount: 1 } },
    ] }))
    .mockResolvedValueOnce(graphResponse({ value: [
      { id: 'staged-file', name: 'new-upload.pdf', size: 60, file: { mimeType: 'application/pdf' } },
    ] }));

  await expect(GraphService.listFiles('akoya_request', 'Grant Documents', { recursive: true }))
    .resolves.toEqual([expect.objectContaining({ id: 'staged-file' })]);
});

test('rejects a Graph children nextLink outside the requested drive path', async () => {
  global.fetch.mockResolvedValueOnce(graphResponse({
    value: [],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/other/root:/root:/children?$skiptoken=next',
  }));

  await expect(GraphService.listFiles('akoya_request', 'root'))
    .rejects.toThrow('unexpected nextLink');
});

test('rejects a path-addressed continuation for a different folder in the same drive', async () => {
  global.fetch.mockResolvedValueOnce(graphResponse({
    value: [],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/drive/root:/other:/children?$skiptoken=next',
  }));

  await expect(GraphService.listFiles('akoya_request', 'root'))
    .rejects.toThrow('unexpected nextLink');
});
