/** @jest-environment node */
// Codex slice 6c-ii review round 2: the recursive walker must not silently
// decline to enter a folder at the maxDepth boundary when the caller asked
// for a complete inventory (`failOnDepthLimit`).
import { jest } from '@jest/globals';
import { listFiles } from '../../lib/services/graph/files.js';

const LIB = 'akoya_request';
const ROOT = 'R_1';

function jsonResponse(value) {
  return { ok: true, status: 200, json: async () => ({ value }), text: async () => '' };
}

/** A tree: root has one file and one folder per level down to `depthWithFolder`, with a file at every level. */
function installTree({ leafDepth }) {
  global.fetch = jest.fn(async (url) => {
    const path = decodeURIComponent(String(url).match(/root:\/(.*?):\/children/)[1]);
    const depth = path.split('/').length - 1;
    const items = [{ id: `f${depth}`, name: `file${depth}.pdf`, size: 1, file: { mimeType: 'application/pdf' } }];
    if (depth < leafDepth) items.push({ id: `d${depth + 1}`, name: `sub${depth + 1}`, folder: { childCount: 1 } });
    return jsonResponse(items);
  });
}

const svc = {
  getDriveId: async () => 'drive-1',
  getAccessToken: async () => 'token',
  buildHeaders: () => ({}),
};

describe('listFiles maxDepth boundary', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; });

  it('by default silently stops at maxDepth (files below the boundary are omitted)', async () => {
    installTree({ leafDepth: 4 });
    const files = await listFiles(svc, LIB, ROOT, { recursive: true, maxDepth: 2 });
    expect(files.map((f) => f.name)).toEqual(['file0.pdf', 'file1.pdf', 'file2.pdf']);
  });

  it('with failOnDepthLimit, a folder at the boundary the walk will not enter fails closed with graph_file_list_truncated', async () => {
    installTree({ leafDepth: 4 });
    await expect(listFiles(svc, LIB, ROOT, { recursive: true, maxDepth: 2, failOnDepthLimit: true }))
      .rejects.toMatchObject({ code: 'graph_file_list_truncated' });
  });

  it('with failOnDepthLimit, a tree that ends within maxDepth is listed completely', async () => {
    installTree({ leafDepth: 2 });
    const files = await listFiles(svc, LIB, ROOT, { recursive: true, maxDepth: 2, failOnDepthLimit: true });
    expect(files.map((f) => f.name)).toEqual(['file0.pdf', 'file1.pdf', 'file2.pdf']);
  });

  it('without recursion, failOnDepthLimit does not fire (the caller asked for one level only)', async () => {
    installTree({ leafDepth: 4 });
    const files = await listFiles(svc, LIB, ROOT, { recursive: false, failOnDepthLimit: true });
    expect(files.map((f) => f.name)).toEqual(['file0.pdf']);
  });
});
