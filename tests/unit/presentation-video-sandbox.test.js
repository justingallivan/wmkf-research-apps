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

describe('commandState (live 2026-10-10: the non-waiting GET kept exitCode null after the command exited)', () => {
  const box = command => ({ handle: { getCommand: jest.fn(async () => command) } });

  test('a finished command whose non-waiting exitCode is null reports the waited exit code', async () => {
    const command = { exitCode: null, wait: jest.fn(async () => ({ exitCode: 0 })) };
    expect(await adapter.commandState(box(command), 'cmd-1')).toEqual({ exitCode: 0 });
    expect(command.wait).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) });
  });

  test('a non-zero waited exit code is reported as is', async () => {
    const command = { exitCode: null, wait: jest.fn(async () => ({ exitCode: 3 })) };
    expect(await adapter.commandState(box(command), 'cmd-1')).toEqual({ exitCode: 3 });
  });

  test('an exit code on the non-waiting GET is used without waiting', async () => {
    const command = { exitCode: 0, wait: jest.fn() };
    expect(await adapter.commandState(box(command), 'cmd-1')).toEqual({ exitCode: 0 });
    expect(command.wait).not.toHaveBeenCalled();
  });

  test('a still-running command: the bounded wait aborts and the state is running (null)', async () => {
    const command = { exitCode: null, wait: jest.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) };
    expect(await adapter.commandState(box(command), 'cmd-1', 20)).toEqual({ exitCode: null });
  });

  test('a wait error that is not the abort propagates', async () => {
    const command = { exitCode: null, wait: jest.fn(async () => { throw Object.assign(new Error('boom'), { response: { status: 500 } }); }) };
    await expect(adapter.commandState(box(command), 'cmd-1')).rejects.toThrow('boom');
  });
});
