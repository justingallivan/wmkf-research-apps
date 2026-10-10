/** @jest-environment node */
// Adapter-level: the SDK module is mocked with 3.4.0's real shapes (listSnapshots yields plain metadata, no delete()).
const snapshotDelete = jest.fn(async () => {});
const snapshotGet = jest.fn(async () => ({ delete: snapshotDelete }));
jest.mock('@vercel/sandbox', () => ({ Sandbox: {}, Snapshot: { get: (...args) => snapshotGet(...args) } }));

import { presentationVideoSandboxAdapter as adapter } from '../../lib/services/meeting-tracker-recordings/presentation-video-sandbox.js';

const metadata = { id: 'snap_abc', sourceSessionId: 's1', region: 'iad1', status: 'created', sizeBytes: 10, createdAt: 1 };
beforeEach(() => jest.clearAllMocks());

test('listSnapshots drains every page of plain metadata', async () => {
  const pages = [metadata, { ...metadata, id: 'snap_def' }];
  const paginator = { async *[Symbol.asyncIterator]() { for (const item of pages) yield item; } };
  const items = await adapter.listSnapshots({ handle: { listSnapshots: async () => paginator } });
  expect(items.map(item => item.id)).toEqual(['snap_abc', 'snap_def']);
  expect(items[0].delete).toBeUndefined();
});

test('deleteSnapshot resolves Snapshot.get by id, then deletes that instance', async () => {
  await adapter.deleteSnapshot(metadata);
  expect(snapshotGet).toHaveBeenCalledWith({ snapshotId: 'snap_abc' });
  expect(snapshotDelete).toHaveBeenCalledTimes(1);
});

test('a 404 from get or delete means gone; other errors propagate', async () => {
  snapshotGet.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
  await expect(adapter.deleteSnapshot(metadata)).resolves.toBeUndefined();
  snapshotDelete.mockRejectedValueOnce(Object.assign(new Error('nf'), { response: { status: 404 } }));
  await expect(adapter.deleteSnapshot(metadata)).resolves.toBeUndefined();
  snapshotGet.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
  await expect(adapter.deleteSnapshot(metadata)).rejects.toThrow('boom');
});

test('deleteSandbox also asks the API to delete orphan snapshots', async () => {
  const del = jest.fn(async () => {});
  await adapter.deleteSandbox({ handle: { delete: del } });
  expect(del).toHaveBeenCalledWith({ deleteOrphanSnapshots: true });
});
