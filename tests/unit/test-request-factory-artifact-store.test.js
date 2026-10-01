/**
 * Factory artifact store: server-minted pathnames, create-only writes, capped
 * digest-checked reads, and the maintenance sweep rules.
 *
 * @jest-environment node
 */
import { jest } from '@jest/globals';
import {
  createFactoryArtifactStore, sweepFactoryArtifacts, artifactDigest, draftPathname, runPathname,
} from '../../lib/services/test-requests/factory-artifact-store.js';
import { deriveActorId } from '../../lib/services/test-requests/admin-run-identity.js';

const ACTOR = deriveActorId(5);
const OTHER_ACTOR = deriveActorId(6);
const DRAFT = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const RUN2 = '33333333-3333-4333-8333-333333333333';
const ENV = { FACTORY_BLOB_RW_TOKEN: 'fake-token', TEST_REQUEST_LEDGER_URL: 'fake-ledger-url' };
const HOUR = 3600_000;

function fakeBlob(initial = {}) {
  const objects = new Map(Object.entries(initial)); // pathname -> { text, uploadedAt }
  const calls = { put: [], get: [], del: [], list: [] };
  const blob = {
    async put(pathname, bytes, options) {
      calls.put.push({ pathname, options });
      if (objects.has(pathname) && !options.allowOverwrite) throw new Error('Vercel Blob: This blob already exists, use `allowOverwrite: true`');
      objects.set(pathname, { text: Buffer.from(bytes).toString('utf8'), uploadedAt: new Date() });
      return { pathname };
    },
    async get(pathname, options) {
      calls.get.push({ pathname, options });
      const hit = objects.get(pathname);
      if (!hit) return null;
      const bytes = Buffer.from(hit.text, 'utf8');
      return { stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) };
    },
    async del(pathname) {
      calls.del.push(pathname);
      if (!objects.has(pathname)) throw Object.assign(new Error('Vercel Blob: The requested blob does not exist (not found)'), { name: 'BlobNotFoundError' });
      objects.delete(pathname);
    },
    async list({ prefix, limit }) {
      calls.list.push({ prefix, limit });
      const blobs = [...objects.entries()].filter(([p]) => p.startsWith(prefix)).slice(0, limit)
        .map(([pathname, { text, uploadedAt }]) => ({ pathname, uploadedAt, size: text.length }));
      return { blobs, hasMore: false };
    },
  };
  return { blob, objects, calls };
}

const aged = (hours, value = {}) => ({ text: JSON.stringify(value), uploadedAt: new Date(Date.now() - hours * HOUR) });

describe('pathnames are server-minted and bound', () => {
  test('draft and run paths embed target, actor and ids', () => {
    expect(draftPathname('sandbox', ACTOR, DRAFT)).toBe(`sandbox/drafts/${ACTOR}/${DRAFT}/bundle.json`);
    expect(runPathname('production', RUN, 'manifest')).toBe(`production/runs/${RUN}/manifest.json`);
  });

  test('a non-GUID id, a bad target, a non-actor and an unknown file are refused', () => {
    expect(() => draftPathname('sandbox', ACTOR, '../etc/passwd')).toThrow(/GUID/);
    expect(() => runPathname('sandbox', 'not-a-guid', 'bundle')).toThrow(/GUID/);
    expect(() => runPathname('staging', RUN, 'bundle')).toThrow(/sandbox or production/);
    expect(() => runPathname('sandbox', RUN, 'secrets')).toThrow(/Unknown run artifact/);
    expect(() => draftPathname('sandbox', 'user:abc', DRAFT)).toThrow(/Factory actor/);
  });

  test('the store only touches paths its own minters produce', async () => {
    const { blob, calls } = fakeBlob();
    const store = createFactoryArtifactStore({ env: ENV, blob });
    for (const bad of ['sandbox/runs/x/bundle.json', '../x', `sandbox/runs/${RUN}/other.json`, 'cycle-dossier/a.json']) {
      await expect(store.putCreateOnly(bad, {})).rejects.toThrow(/Unrecognized/);
      await expect(store.read(bad)).rejects.toThrow(/Unrecognized/);
      await expect(store.del(bad)).rejects.toThrow(/Unrecognized/);
    }
    expect(calls.put).toHaveLength(0);
    expect(calls.del).toHaveLength(0);
  });
});

describe('putCreateOnly / read / del', () => {
  test('writes private create-only with the dedicated token; a second write is refused with factory_artifact_exists and nothing is overwritten', async () => {
    const { blob, calls, objects } = fakeBlob();
    const store = createFactoryArtifactStore({ env: ENV, blob });
    const path = runPathname('sandbox', RUN, 'manifest');
    await store.putCreateOnly(path, { v: 1 });
    expect(calls.put[0].options).toMatchObject({
      access: 'private', token: 'fake-token', addRandomSuffix: false, allowOverwrite: false,
    });
    await expect(store.putCreateOnly(path, { v: 2 })).rejects.toMatchObject({ code: 'factory_artifact_exists', httpStatus: 409 });
    expect(JSON.parse(objects.get(path).text)).toEqual({ v: 1 });
  });

  test('any other put error is surfaced as-is and never read back as success', async () => {
    const { blob, calls } = fakeBlob();
    blob.put = async () => { throw new Error('network reset'); };
    const store = createFactoryArtifactStore({ env: ENV, blob });
    await expect(store.putCreateOnly(runPathname('sandbox', RUN, 'bundle'), { v: 1 })).rejects.toThrow('network reset');
    expect(calls.get).toHaveLength(0);
  });

  test('a missing token is a 503 before any Blob call', async () => {
    const { blob, calls } = fakeBlob();
    const store = createFactoryArtifactStore({ env: {}, blob });
    await expect(store.putCreateOnly(runPathname('sandbox', RUN, 'bundle'), {})).rejects.toMatchObject({ code: 'factory_store_unconfigured', httpStatus: 503 });
    expect(calls.put).toHaveLength(0);
  });

  test('read returns the value, checks the digest, caps size, and returns null for a missing object', async () => {
    const value = { a: [1, 2, 3] };
    const path = runPathname('sandbox', RUN, 'bundle');
    const { blob } = fakeBlob({ [path]: aged(0, value) });
    const store = createFactoryArtifactStore({ env: ENV, blob });
    expect((await store.read(path, { expectedSha256: artifactDigest(value) })).value).toEqual(value);
    await expect(store.read(path, { expectedSha256: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'factory_artifact_digest_mismatch' });
    await expect(store.read(path, { maxBytes: 3 })).rejects.toMatchObject({ code: 'factory_artifact_too_large' });
    expect(await store.read(runPathname('sandbox', RUN2, 'bundle'))).toBeNull();
  });

  test('del tolerates a missing object', async () => {
    const { blob } = fakeBlob();
    const store = createFactoryArtifactStore({ env: ENV, blob });
    await expect(store.del(runPathname('sandbox', RUN, 'bundle'))).resolves.toBeUndefined();
  });

  test('list is bounded and only takes known prefixes', async () => {
    const { blob, calls } = fakeBlob({
      [runPathname('sandbox', RUN, 'bundle')]: aged(0), [runPathname('sandbox', RUN2, 'bundle')]: aged(0),
    });
    const store = createFactoryArtifactStore({ env: ENV, blob });
    expect(await store.list('sandbox/runs/', { limit: 1 })).toHaveLength(1);
    expect(calls.list[0].limit).toBe(1);
    await expect(store.list('sandbox/', { limit: 5 })).rejects.toThrow(/prefix/);
  });
});

describe('sweepFactoryArtifacts', () => {
  const bundlePath = (run) => runPathname('sandbox', run, 'bundle');
  const manifestPath = (run) => runPathname('sandbox', run, 'manifest');
  const sweep = (blob, rows, extra = {}) => {
    const db = { query: jest.fn(async (text, params) => ({ rows: rows(text, params) })), end: jest.fn() };
    return { db, promise: sweepFactoryArtifacts({ env: ENV, blob, ledgerDb: db, target: 'sandbox', ...extra }) };
  };
  const runRow = (runId, status) => ({ run_id: runId, status, actor_id: ACTOR });
  const ledgerHas = (map) => (text, params) => (map[params?.[0]] ? [runRow(params[0], map[params[0]])] : []);

  test('deletes a ready run\'s artifacts and keeps prepared, creating and needs_attention runs', async () => {
    const third = '44444444-4444-4444-8444-444444444444';
    const fourth = '55555555-5555-4555-8555-555555555555';
    const { blob, objects } = fakeBlob();
    for (const run of [RUN, RUN2, third, fourth]) {
      objects.set(bundlePath(run), aged(48));
      objects.set(manifestPath(run), aged(48));
    }
    const { promise } = sweep(blob, ledgerHas({
      [RUN]: 'ready', [RUN2]: 'prepared', [third]: 'creating', [fourth]: 'needs_attention',
    }));
    const stats = await promise;
    expect(stats.deleted).toBe(2);
    expect(objects.has(bundlePath(RUN))).toBe(false);
    for (const run of [RUN2, third, fourth]) {
      expect(objects.has(bundlePath(run))).toBe(true);
      expect(objects.has(manifestPath(run))).toBe(true);
    }
  });

  test('a run with no ledger row is deleted only when every object is older than 24 h', async () => {
    const { blob, objects } = fakeBlob();
    objects.set(bundlePath(RUN), aged(30));
    objects.set(manifestPath(RUN), aged(30));
    objects.set(bundlePath(RUN2), aged(30));
    objects.set(manifestPath(RUN2), aged(1)); // one young object protects the group
    const { promise } = sweep(blob, () => []);
    await promise;
    expect(objects.has(bundlePath(RUN))).toBe(false);
    expect(objects.has(manifestPath(RUN))).toBe(false);
    expect(objects.has(bundlePath(RUN2))).toBe(true);
    expect(objects.has(manifestPath(RUN2))).toBe(true);
  });

  test('never deletes by age alone: an old object of a resumable run stays', async () => {
    const { blob, objects } = fakeBlob({ [bundlePath(RUN)]: aged(500), [manifestPath(RUN)]: aged(500) });
    await sweep(blob, ledgerHas({ [RUN]: 'creating' })).promise;
    expect(objects.size).toBe(2);
  });

  test('skips a run on a ledger read error and reports it as an error', async () => {
    const { blob, objects, calls } = fakeBlob({ [bundlePath(RUN)]: aged(48), [manifestPath(RUN)]: aged(48) });
    const { promise } = sweep(blob, () => { throw new Error('ledger down'); });
    const stats = await promise;
    expect(stats.errors).toBe(1);
    expect(objects.size).toBe(2);
    expect(calls.del).toHaveLength(0);
  });

  test('tolerates objects that vanish between listing and delete (overlapping sweeps)', async () => {
    const { blob, objects } = fakeBlob({ [bundlePath(RUN)]: aged(48), [manifestPath(RUN)]: aged(48) });
    const realDel = blob.del;
    blob.del = async (pathname, options) => { objects.delete(pathname); return realDel(pathname, options); };
    const stats = await sweep(blob, ledgerHas({ [RUN]: 'ready' })).promise;
    expect(stats.errors).toBe(0);
    expect(stats.deleted).toBe(2);
  });

  test('deletes drafts older than 6 h and keeps fresher ones, without a ledger read', async () => {
    const oldDraft = draftPathname('sandbox', ACTOR, DRAFT);
    const newDraft = draftPathname('sandbox', OTHER_ACTOR, '66666666-6666-4666-8666-666666666666');
    const { blob, objects } = fakeBlob({ [oldDraft]: aged(7), [newDraft]: aged(5) });
    const { db, promise } = sweep(blob, () => []);
    await promise;
    expect(objects.has(oldDraft)).toBe(false);
    expect(objects.has(newDraft)).toBe(true);
    expect(db.query).not.toHaveBeenCalled();
  });

  test('is skipped when the ledger URL or the Blob token is unset', async () => {
    const { blob, calls } = fakeBlob({ [bundlePath(RUN)]: aged(48) });
    for (const env of [{ FACTORY_BLOB_RW_TOKEN: 'x' }, { TEST_REQUEST_LEDGER_URL: 'x' }, {}]) {
      expect(await sweepFactoryArtifacts({ env, blob, target: 'sandbox' })).toEqual({ skipped: 'unconfigured', deleted: 0 });
    }
    expect(calls.list).toHaveLength(0);
  });

  test('lists at most 200 objects per invocation', async () => {
    const { blob, calls } = fakeBlob();
    await sweep(blob, () => []).promise;
    expect(calls.list.map((c) => c.limit).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(200);
  });
});

describe('scripts/factory-artifacts-download.mjs', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  let script;
  beforeAll(async () => { script = await import('../../scripts/factory-artifacts-download.mjs'); });

  test('parseArgs validates the run GUID, target and absolute --out', () => {
    const ok = script.parseArgs([`--run=${RUN.toUpperCase()}`, '--target=sandbox', '--out=/tmp/x']);
    expect(ok).toEqual({ run: RUN, target: 'sandbox', out: '/tmp/x' });
    expect(() => script.parseArgs(['--run=nope', '--target=sandbox', '--out=/tmp/x'])).toThrow(/GUID/);
    expect(() => script.parseArgs([`--run=${RUN}`, '--target=staging', '--out=/tmp/x'])).toThrow(/target/);
    expect(() => script.parseArgs([`--run=${RUN}`, '--target=sandbox', '--out=rel'])).toThrow(/absolute/);
    expect(() => script.parseArgs([`--run=${RUN}`, '--target=sandbox', '--out=/tmp/x', '--extra'])).toThrow(/Unknown/);
  });

  test('writes both files create-only (0600), prints no text, and refuses an existing file', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-dl-'));
    const dest = path.join(out, 'run');
    const seen = [];
    const get = async (pathname, options) => {
      seen.push({ pathname, options });
      const bytes = Buffer.from(JSON.stringify({ secret: 'source text', pathname }));
      return { stream: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } }) };
    };
    const written = await script.downloadArtifacts({ run: RUN, target: 'sandbox', out: dest }, { env: ENV, get });
    expect(seen.map((s) => s.pathname)).toEqual([`sandbox/runs/${RUN}/manifest.json`, `sandbox/runs/${RUN}/bundle.json`]);
    expect(seen.every((s) => s.options.token === 'fake-token' && s.options.access === 'private')).toBe(true);
    expect(JSON.stringify(written)).not.toContain('source text');
    expect(fs.statSync(path.join(dest, 'bundle.json')).mode & 0o777).toBe(0o600);
    await expect(script.downloadArtifacts({ run: RUN, target: 'sandbox', out: dest }, { env: ENV, get })).rejects.toThrow(/EEXIST/);
    await expect(script.downloadArtifacts({ run: RUN, target: 'sandbox', out: dest }, { env: {}, get })).rejects.toThrow(/FACTORY_BLOB_RW_TOKEN/);
    fs.rmSync(out, { recursive: true, force: true });
  });
});
