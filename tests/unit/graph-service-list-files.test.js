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

test('rejects a Graph children nextLink outside the requested drive path', async () => {
  global.fetch.mockResolvedValueOnce(graphResponse({
    value: [],
    '@odata.nextLink': 'https://graph.microsoft.com/v1.0/drives/other/root:/root:/children?$skiptoken=next',
  }));

  await expect(GraphService.listFiles('akoya_request', 'root'))
    .rejects.toThrow('unexpected nextLink');
});
