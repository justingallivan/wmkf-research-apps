/** @jest-environment node */
// Stage 4 slice 3: the presentation-video split tick, with an in-memory split row, a fake Sandbox adapter and fake Graph.
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));
// The cut script is built in another worktree; its two exports are all the worker needs.
jest.mock('../../lib/services/meeting-tracker-recordings/presentation-video-cut-script.js',
  () => ({ CUT_SCRIPT_PY: 'PY_SOURCE', CUT_SCRIPT_VERSION: 'cut-test-1' }), { virtual: true });

import {
  runPresentationVideoSplitTick, readPresentationVideoSplitConfig, _resetOrphanSweepForTests, FFMPEG_TARBALL_SHA256,
} from '../../lib/services/meeting-tracker-recordings/presentation-video-split-worker.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const COPY = '55555555-5555-4555-8555-555555555555';
const REV = '66666666-6666-4666-8666-666666666666';
const NAME = `s4-${ID}`;
const WORK = '/vercel/sandbox/work';
const PROCESSING = ['queued', 'cutting', 'uploading'];
const notFound = () => Object.assign(new Error('nf'), { response: { status: 404 } });
const json = value => Buffer.from(JSON.stringify(value));
const GOOD_RECEIPT = { ok: true, scriptVersion: 'cut-test-1', cutMs: 5000, outputSize: 777, outputQuickXorHash: 'QXOUT', framesKept: 250, samplesKept: 240000 };

function world(over = {}) {
  const w = {
    order: [], storeCalls: [], events: [], logs: [], boxes: {}, commands: {}, files: {}, policies: [], created: [], cancelled: [],
    snapshots: {}, deleteFails: false, tagged: [], uncleaned: [], nowMs: Date.UTC(2026, 9, 10, 12, 30, 0), cmdSeq: 0,
    copy: { state: 'copied', sharepoint_drive_id: 'drv', sharepoint_item_id: 'itm' },
    metas: { 'drv/itm': { id: 'itm', eTag: 'etag1', quickXorHash: 'qx', size: 1000 } },
    boundary: { revisionId: REV, presentationEnd: { endMs: 5000 } },
    row: {
      id: ID, request_id: REQ, state: 'queued', source_copy_id: COPY, source_drive_id: 'drv', source_item_id: 'itm', source_etag: 'etag1',
      source_quickxor_hash: 'qx', source_size: 1000, transcript_revision_id: REV, presentation_end_ms: 5000, sandbox_name: null,
      sandbox_command_id: null, verification_receipt: null, upload_url_ciphertext: null, lease_token: null, failure_code: null,
      sandbox_cleaned_at: null, cleanup_attempts: 0, cleanup_receipt: null, usage: null,
    },
    access: { valid: true, mode: 'on', requestId: null },
    tarball: Buffer.from('tar'),
    ...over,
  };
  const row = () => w.row;
  const fenced = ({ id, leaseToken }) => row().id === id && row().lease_token === leaseToken && leaseToken != null;
  const rec = (name, fn) => async args => { w.storeCalls.push([name, args]); return fn(args); };
  const terminal = (state, extra) => args => {
    if (!fenced(args) || !PROCESSING.includes(row().state)) return null;
    Object.assign(row(), { state, upload_url_ciphertext: null, lease_token: null, ...extra(args) });
    return { id: row().id };
  };
  const store = {
    claimPresentationVideoSplitWork: rec('claim', async ({ accessRequestId }) => {
      if (!PROCESSING.includes(row().state) || row().lease_token || (accessRequestId && accessRequestId !== row().request_id)) return null;
      row().lease_token = 'tok-' + (w.order.length + 1);
      return { row: { ...row() }, leaseToken: row().lease_token };
    }),
    renewPresentationVideoSplitLease: rec('renew', async args => (fenced(args) && args.states.includes(row().state) ? { state: row().state } : null)),
    releasePresentationVideoSplitLease: rec('release', async args => { if (row().lease_token === args.leaseToken) row().lease_token = null; return {}; }),
    deferPresentationVideoSplitAttempt: rec('defer', async args => { if (fenced(args)) row().lease_token = null; return { id: ID }; }),
    recordPresentationVideoSandboxName: rec('name', async args => (fenced(args) && row().state === 'queued' ? Object.assign(row(), { sandbox_name: args.sandboxName }) : null)),
    recordPresentationVideoSandboxCreated: rec('created', async () => ({ id: ID })),
    recordPresentationVideoCutStarted: rec('cutStarted', async args => (fenced(args) && row().state === 'queued' ? Object.assign(row(), { state: 'cutting', sandbox_command_id: args.commandId }) : null)),
    recordPresentationVideoCutReceiptAndUploadStarted: rec('uploadStarted', async args => (fenced(args) && row().state === 'cutting'
      ? Object.assign(row(), { state: 'uploading', verification_receipt: args.verificationReceipt, upload_url_ciphertext: args.uploadUrlCiphertext, sandbox_command_id: args.commandId }) : null)),
    markPresentationVideoSplitReview: rec('review', async args => (fenced(args) && row().state === 'uploading'
      ? Object.assign(row(), { state: 'review', upload_url_ciphertext: null, lease_token: null, output_item_id: args.outputItemId, output_drive_id: args.outputDriveId, output_etag: args.outputEtag, output_size: args.outputSize, output_quickxor_hash: args.outputQuickXorHash }) : null)),
    failPresentationVideoSplit: rec('fail', terminal('failed', a => ({ failure_code: a.failureCode }))),
    supersedePresentationVideoSplit: rec('supersede', terminal('superseded', a => ({ failure_code: a.failureCode }))),
    getPresentationVideoSourceCopy: rec('sourceCopy', async () => w.copy),
    claimPresentationVideoSplitRecovery: rec('recovery', async ({ accessMode, testRequestId, maxAgeSeconds }) => {
      const r = row();
      if (!PROCESSING.includes(r.state) || r.lease_token) return [];
      const withdrawn = accessMode === 'off' || (accessMode === 'test' && r.request_id !== testRequestId);
      const expired = w.nowMs - (r.sandbox_created_ms ?? r.created_ms ?? w.nowMs) > maxAgeSeconds * 1000;  // never updated_at (Codex slice 3 round 2)
      if (!withdrawn && !expired) return [];
      r.lease_token = 'rec-tok';
      return [{ row: { ...r }, leaseToken: 'rec-tok', reason: withdrawn ? 'access_withdrawn' : 'processor_expired' }];
    }),
    claimPresentationVideoSplitCleanup: rec('claimCleanup', async () => {
      const r = row();
      if (!r.sandbox_name || r.sandbox_cleaned_at || PROCESSING.includes(r.state)) return [];
      r.cleanup_attempts = w.attemptsOverride ?? r.cleanup_attempts + 1;
      return [{ id: r.id, request_id: r.request_id, sandbox_name: r.sandbox_name, cleanup_attempts: r.cleanup_attempts }];
    }),
    recordPresentationVideoSandboxUsage: rec('usage', async args => { w.order.push('usage'); row().usage = args; return { id: ID }; }),
    markPresentationVideoSandboxCleaned: rec('cleaned', async args => { row().sandbox_cleaned_at = 'now'; row().cleanup_receipt = args.cleanupReceipt; return { id: ID }; }),
    listUncleanedPresentationVideoSandboxNames: rec('listUncleaned', async () => w.uncleaned),
  };
  const box = name => w.boxes[name];
  const sandbox = {
    appTag: 'wmkf-stage4',
    create: async args => { w.created.push(args); w.boxes[args.name] = { status: 'running' }; return { handle: args.name, persistent: w.persistent ?? false }; },
    get: async name => { w.order.push('get'); return box(name) ? { handle: name, status: box(name).status } : null; },
    writeFiles: async (sbx, files) => { w.written = files; },
    updateNetworkPolicy: async (sbx, policy) => { w.policies.push(policy); },
    readFileToBuffer: async (sbx, path) => w.files[path] ?? null,
    runDetached: async (sbx, spec) => { const id = `cmd-${++w.cmdSeq}`; w.commands[id] = { exitCode: null, spec }; w.lastDetached = spec; return id; },
    run: async (sbx, spec) => { w.installSpec = spec; return w.installExit ?? 0; },
    commandState: async (sbx, id) => ({ exitCode: w.commands[id].exitCode }),
    stopAndReadUsage: async sbx => { w.order.push('stop'); return { activeCpuMs: 1000, provisionedMs: 5000, vcpus: 2 }; },
    listSnapshots: async sbx => w.snapshots[sbx.handle] || [],
    deleteSnapshot: async snapshot => { w.order.push('deleteSnapshot'); snapshot.deleted = true; },
    deleteSandbox: async sbx => { w.order.push('delete'); if (w.deleteFails) throw new Error('delete failed'); delete w.boxes[sbx.handle]; },
    listTagged: async () => w.tagged,
  };
  const deps = {
    now: () => w.nowMs,
    log: line => w.logs.push(line),
    recordEvent: event => { w.events.push(event); return Promise.resolve(); },
    access: () => w.access,
    requestAllowed: () => true,
    config: () => ({ sandboxTimeoutMs: 10_800_000, vcpus: 2, leaseSeconds: 600 }),
    envTag: () => 'test',
    uploadSecret: () => 'x'.repeat(32),
    cutScript: { py: 'PY_SOURCE', version: 'cut-test-1' },
    readFfmpegTarball: async () => { if (!w.tarball) throw Object.assign(new Error('x'), { code: 'presentation_video_ffmpeg_unavailable' }); return w.tarball; },
    sandbox,
    ...store,
    getRequest: async () => ({ akoya_requestnum: '1002912' }),
    getSharePointBuckets: async () => [{ source: 'dynamics', library: 'akoya_request', folder: 'Requests/1002912/' }],
    ensureFolderPath: async (library, folder) => { w.folder = folder; },
    readConfirmedBoundary: async () => w.boundary,
    getFileMetadataById: async (drive, item) => w.metas[`${drive}/${item}`] ?? null,
    resolveMediaDownloadUrl: async () => ({ eTag: w.mediaEtag ?? 'etag1', downloadUrl: 'https://dl.example.net/file?sig=SECRET' }),
    createBrowserUploadSession: async (library, folder, filename) => { w.filename = filename; return { driveId: 'updrv', uploadUrl: 'https://up.example.com/s?tok=SECRET2', expiresAt: '2026-10-11T00:00:00Z' }; },
    cancelBrowserUploadSession: async url => { w.cancelled.push(url); return { outcome: 'cancelled' }; },
    sealUploadUrl: () => 'SEALED',
    openUploadUrl: () => 'https://up.example.com/s?tok=SECRET2',
  };
  // A fake that throws ConfigFault shape is not possible here (class is private), so ffmpeg-missing uses the real reader path.
  w.deps = deps;
  w.tick = () => runPresentationVideoSplitTick({}, w.deps);
  w.setCommand = (id, exitCode) => { w.commands[id].exitCode = exitCode; };
  return w;
}

beforeEach(() => _resetOrphanSweepForTests());

async function toCutting(w) {
  expect((await w.tick()).outcome).toBe('cut_started');
  expect(w.row.state).toBe('cutting');
}
async function toUploading(w) {
  await toCutting(w);
  w.files[`${WORK}/receipt.json`] = json(GOOD_RECEIPT);
  w.setCommand('cmd-1', 0);
  expect((await w.tick()).outcome).toBe('upload_started');
}

describe('happy path', () => {
  test('queued -> cutting -> uploading -> review over several ticks, then cleanup', async () => {
    const w = world();
    const first = await w.tick();
    expect(first).toMatchObject({ outcome: 'cut_started', splitId: ID });
    expect(w.created[0]).toMatchObject({ name: NAME, vcpus: 2, timeoutMs: 10_800_000, tags: { app: 'wmkf-stage4', split: ID, env: 'test' } });
    // The name is on the row before the Sandbox exists.
    const names = w.storeCalls.map(([n]) => n);
    expect(names.indexOf('name')).toBeLessThan(names.indexOf('created'));
    expect(w.written.map(f => f.path)).toEqual(['/vercel/sandbox/cut.py', '/vercel/sandbox/ffmpeg.tar.xz']);
    expect(w.installSpec.env).toMatchObject({ FFMPEG_SHA256: FFMPEG_TARBALL_SHA256, FFMPEG_DIR: '/vercel/sandbox/ffmpeg', INSTALL_RECEIPT: '/vercel/sandbox/install.json' });
    expect(w.policies[0]).toEqual({ allow: ['dl.example.net'] });
    expect(w.lastDetached.env).toMatchObject({ SOURCE_SIZE: '1000', CUT_MS: '5000', FFMPEG_BIN_DIR: '/vercel/sandbox/ffmpeg/bin', WORK_DIR: WORK });
    expect(w.row).toMatchObject({ state: 'cutting', sandbox_command_id: 'cmd-1', lease_token: null });

    expect((await w.tick()).outcome).toBe('polling');
    expect(w.row.lease_token).toBeNull();

    w.files[`${WORK}/receipt.json`] = json(GOOD_RECEIPT);
    w.setCommand('cmd-1', 0);
    expect((await w.tick()).outcome).toBe('upload_started');
    expect(w.folder).toBe('Requests/1002912/Post Site Visit Materials');
    expect(w.filename).toBe(`1002912-Presentation-Video-${ID}.mp4`);
    expect(w.policies[1]).toEqual({ allow: ['up.example.com'] });
    expect(w.row).toMatchObject({ state: 'uploading', upload_url_ciphertext: 'SEALED', sandbox_command_id: 'cmd-2' });
    expect(w.row.verification_receipt).toMatchObject({ outputSize: 777, uploadDriveId: 'updrv' });

    expect((await w.tick()).outcome).toBe('polling');
    w.files[`${WORK}/upload.json`] = json({ ok: true, itemId: 'out1', size: 777, httpStatus: 201 });
    w.metas['updrv/out1'] = { id: 'out1', eTag: 'oe', quickXorHash: 'QXOUT', size: 777 };
    w.setCommand('cmd-2', 0);
    expect((await w.tick()).outcome).toBe('review');
    expect(w.row).toMatchObject({ state: 'review', upload_url_ciphertext: null, lease_token: null, output_item_id: 'out1', output_drive_id: 'updrv', output_size: 777, output_quickxor_hash: 'QXOUT' });

    // Review is out of processing: the next tick cleans the Sandbox (stop, usage, delete, then confirm absence).
    w.order.length = 0;
    expect((await w.tick()).outcome).toBe('idle');
    expect(w.order).toEqual(['get', 'stop', 'usage', 'delete', 'get']);
    expect(w.row.sandbox_cleaned_at).toBe('now');
    expect(w.row.usage).toEqual({ id: ID, activeCpuMs: 1000, provisionedMs: 5000, vcpus: 2 });
  });

  test('no URL reaches a log line, an event or a store call', async () => {
    const w = world();
    await toUploading(w);
    w.files[`${WORK}/upload.json`] = json({ ok: true, itemId: 'out1', size: 777 });
    w.metas['updrv/out1'] = { id: 'out1', eTag: 'oe', quickXorHash: 'WRONG', size: 777 };
    w.setCommand('cmd-2', 0);
    expect((await w.tick()).outcome).toBe('failed');
    await w.tick();
    const text = JSON.stringify([w.logs, w.events, w.storeCalls]);
    expect(text).not.toContain('https://');
    expect(text).not.toContain('SECRET');
    expect(w.storeCalls.length).toBeGreaterThan(5);
  });
});

describe('failures and supersedes', () => {
  test('a still-running command releases the lease and changes nothing', async () => {
    const w = world();
    await toCutting(w);
    const before = { ...w.row };
    expect((await w.tick()).outcome).toBe('polling');
    expect(w.row).toEqual({ ...before, lease_token: null });
  });

  test('a missing Sandbox while cutting fails processor_lost', async () => {
    const w = world();
    await toCutting(w);
    delete w.boxes[NAME];
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'processor_lost' });
    expect(w.row).toMatchObject({ state: 'failed', failure_code: 'processor_lost', lease_token: null });
  });

  test('a stopped Sandbox with an unfinished command is terminal and never probed', async () => {
    const w = world();
    await toCutting(w);
    w.boxes[NAME].status = 'stopped';
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_sandbox_stopped' });
  });

  test('cut exit 3 fails with the receipt code; any other non-zero exit is a crash', async () => {
    const w = world();
    await toCutting(w);
    w.files[`${WORK}/receipt.json`] = json({ ok: false, code: 'unsupported_timeline' });
    w.setCommand('cmd-1', 3);
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'unsupported_timeline' });
    const crashed = world();
    await toCutting(crashed);
    crashed.setCommand('cmd-1', 137);
    expect(await crashed.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_cut_crashed' });
  });

  test.each([
    ['wrong script version', { ...GOOD_RECEIPT, scriptVersion: 'old' }],
    ['cut ms differs from the frozen end', { ...GOOD_RECEIPT, cutMs: 4999 }],
    ['empty output', { ...GOOD_RECEIPT, outputSize: 0 }],
    ['no hash', { ...GOOD_RECEIPT, outputQuickXorHash: undefined }],
    ['not ok', { ...GOOD_RECEIPT, ok: false }],
  ])('invalid receipt (%s) fails and starts no upload', async (_label, receipt) => {
    const w = world();
    await toCutting(w);
    w.files[`${WORK}/receipt.json`] = json(receipt);
    w.setCommand('cmd-1', 0);
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_receipt_invalid' });
    expect(w.policies).toHaveLength(1);
    expect(w.filename).toBeUndefined();
  });

  test('install exit 3 fails with the install receipt code', async () => {
    const w = world({ installExit: 3, files: { '/vercel/sandbox/install.json': json({ ok: false, code: 'ffmpeg_hash_mismatch' }) } });
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'ffmpeg_hash_mismatch' });
    expect(w.row.state).toBe('failed');
  });

  test('a persistent Sandbox is refused', async () => {
    const w = world({ persistent: true });
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_sandbox_persistent' });
  });

  test('output size or hash mismatch fails, with the uploaded item id on the alert only', async () => {
    const w = world();
    await toUploading(w);
    w.files[`${WORK}/upload.json`] = json({ ok: true, itemId: 'out1', size: 777 });
    w.metas['updrv/out1'] = { id: 'out1', eTag: 'oe', quickXorHash: 'QXOUT', size: 778 };
    w.setCommand('cmd-2', 0);
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_output_mismatch' });
    expect(w.row.output_item_id).toBeUndefined();
    expect(w.events.at(-1).metadata).toMatchObject({ outputItemId: 'out1' });
    // A null hash from Graph is also a mismatch: the check is exact, not best effort.
    const w2 = world();
    await toUploading(w2);
    w2.files[`${WORK}/upload.json`] = json({ ok: true, itemId: 'out1', size: 777 });
    w2.metas['updrv/out1'] = { id: 'out1', eTag: 'oe', quickXorHash: null, size: 777 };
    w2.setCommand('cmd-2', 0);
    expect(await w2.tick()).toMatchObject({ code: 'presentation_video_output_mismatch' });
  });

  test('upload exit 3 cancels the unsealed session, then fails', async () => {
    const w = world();
    await toUploading(w);
    w.setCommand('cmd-2', 3);
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_upload_failed' });
    expect(w.cancelled).toEqual(['https://up.example.com/s?tok=SECRET2']);
    expect(w.row.upload_url_ciphertext).toBeNull();
  });

  test('a changed transcript revision or end supersedes before any Sandbox exists', async () => {
    const w = world({ boundary: { revisionId: REV, presentationEnd: { endMs: 5001 } } });
    expect(await w.tick()).toMatchObject({ outcome: 'superseded', code: 'presentation_video_transcript_changed' });
    expect(w.created).toHaveLength(0);
    expect(w.row).toMatchObject({ state: 'superseded', failure_code: 'presentation_video_transcript_changed', lease_token: null });
    const gone = world({ boundary: null });
    expect(await gone.tick()).toMatchObject({ outcome: 'superseded', code: 'presentation_video_transcript_changed' });
  });

  test.each([
    ['eTag changed', w => { w.metas['drv/itm'].eTag = 'etag2'; }],
    ['quickXorHash changed', w => { w.metas['drv/itm'].quickXorHash = 'other'; }],
    ['item gone', w => { delete w.metas['drv/itm']; }],
    ['copy row no longer copied', w => { w.copy = { ...w.copy, state: 'failed' }; }],
    ['download eTag differs at resolve time', w => { w.mediaEtag = 'etag9'; }],
  ])('source %s supersedes', async (_label, mutate) => {
    const w = world();
    mutate(w);
    expect(await w.tick()).toMatchObject({ outcome: 'superseded', code: 'presentation_video_source_changed' });
  });

  test('revalidation runs again before the upload phase', async () => {
    const w = world();
    await toCutting(w);
    w.metas['drv/itm'].eTag = 'changed-mid-cut';
    expect(await w.tick()).toMatchObject({ outcome: 'superseded', code: 'presentation_video_source_changed' });
  });

  test('a queued row that already names a Sandbox fails processor_lost and creates nothing', async () => {
    const w = world();
    w.row.sandbox_name = NAME;
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'processor_lost' });
    expect(w.created).toHaveLength(0);
  });

  test('an error after the Sandbox is named fails the split (no named queued row is left)', async () => {
    const w = world();
    w.deps.sandbox = { ...w.deps.sandbox, updateNetworkPolicy: async () => { throw new Error('boom'); } };
    expect(await w.tick()).toMatchObject({ outcome: 'failed', code: 'presentation_video_start_failed' });
  });
});

describe('ffmpeg configuration fault (real reader)', () => {
  test('missing env defers, never fails and never names a Sandbox', async () => {
    const saved = { p: process.env.PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME, t: process.env.UPLOADS_BLOB_RW_TOKEN };
    delete process.env.PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME;
    delete process.env.UPLOADS_BLOB_RW_TOKEN;
    try {
      const w = world();
      delete w.deps.readFfmpegTarball;
      const deps = { ...w.deps };
      delete deps.readFfmpegTarball;
      const result = await runPresentationVideoSplitTick({}, deps);
      expect(result).toMatchObject({ outcome: 'deferred', code: 'presentation_video_ffmpeg_unavailable' });
      expect(w.row).toMatchObject({ state: 'queued', sandbox_name: null, lease_token: null });
      expect(w.storeCalls.map(([n]) => n)).toContain('defer');
      expect(w.events.at(-1)).toMatchObject({ eventType: 'presentation_video_config_fault' });
    } finally {
      if (saved.p !== undefined) process.env.PRESENTATION_VIDEO_FFMPEG_BLOB_PATHNAME = saved.p;
      if (saved.t !== undefined) process.env.UPLOADS_BLOB_RW_TOKEN = saved.t;
    }
  });
});

describe('access', () => {
  test('off or invalid claims nothing (cleanup still runs)', async () => {
    for (const access of [{ valid: true, mode: 'off', requestId: null }, { valid: false, mode: 'off', requestId: null }]) {
      const w = world({ access });
      expect((await w.tick()).outcome).toBe('access_off');
      expect(w.storeCalls.map(([n]) => n)).not.toContain('claim');
    }
  });

  test('test mode restricts the claim to that request', async () => {
    const w = world({ access: { valid: true, mode: 'test', requestId: '99999999-9999-4999-8999-999999999999' } });
    w.row.state = 'review';
    expect((await w.tick()).outcome).toBe('idle');
    expect(w.storeCalls.find(([n]) => n === 'claim')[1]).toMatchObject({ accessRequestId: '99999999-9999-4999-8999-999999999999', leaseSeconds: 600 });
    expect(w.row.state).toBe('review');
  });
});

describe('cleanup sweep', () => {
  const failedRow = over => {
    const w = world(over);
    Object.assign(w.row, { state: 'failed', failure_code: 'x', sandbox_name: NAME });
    w.boxes[NAME] = { status: 'running' };
    return w;
  };

  test('a processing row is never cleaned, even with its lease released', async () => {
    const w = world();
    await toCutting(w);
    w.order.length = 0;
    await w.tick();
    expect(w.order).not.toContain('delete');
    expect(w.row.sandbox_cleaned_at).toBeNull();
  });

  test('stop, then usage persisted, then delete, then a second get confirms absence', async () => {
    const w = failedRow();
    await w.tick();
    expect(w.order).toEqual(['get', 'stop', 'usage', 'delete', 'get']);
    expect(w.row).toMatchObject({ sandbox_cleaned_at: 'now', cleanup_receipt: { existed: true, snapshotsDeleted: 0 } });
  });

  test('a 404 counts as already gone and is marked cleaned without usage', async () => {
    const w = failedRow();
    delete w.boxes[NAME];
    await w.tick();
    expect(w.order).toEqual(['get']);
    expect(w.row).toMatchObject({ sandbox_cleaned_at: 'now', cleanup_receipt: { existed: false } });
  });

  test('a snapshot is deleted and alerted before the Sandbox is deleted', async () => {
    const snap = {};
    const w = failedRow({ snapshots: { [NAME]: [snap] } });
    await w.tick();
    expect(snap.deleted).toBe(true);
    expect(w.order.indexOf('deleteSnapshot')).toBeLessThan(w.order.indexOf('delete'));
    expect(w.events.map(e => e.eventType)).toContain('presentation_video_snapshot_deleted');
    expect(w.row.cleanup_receipt.snapshotsDeleted).toBe(1);
  });

  test('a failed delete is not marked cleaned and is retried; a Sandbox still present after delete is not cleaned either', async () => {
    const w = failedRow({ deleteFails: true });
    await w.tick();
    expect(w.row.sandbox_cleaned_at).toBeNull();
    expect(w.row.usage).not.toBeNull();
    w.deleteFails = false;
    await w.tick();
    expect(w.row.sandbox_cleaned_at).toBe('now');
    const stuck = failedRow();
    stuck.deps.sandbox.deleteSandbox = async () => { stuck.order.push('delete'); };
    await stuck.tick();
    expect(stuck.row.sandbox_cleaned_at).toBeNull();
  });

  test('after 10 failed attempts every further failure alerts', async () => {
    const w = failedRow({ deleteFails: true, attemptsOverride: 10 });
    await w.tick();
    expect(w.events.at(-1)).toMatchObject({ eventType: 'presentation_video_cleanup_failing', severity: 'error', metadata: { attempts: 10 } });
    const early = failedRow({ deleteFails: true, attemptsOverride: 3 });
    await early.tick();
    expect(early.events).toHaveLength(0);
  });
});

describe('orphan sweep', () => {
  test('deletes only an own-environment tagged Sandbox with no uncleaned row, and runs once', async () => {
    const w = world({
      access: { valid: true, mode: 'off', requestId: null },
      row: { id: ID, request_id: REQ, state: 'review', sandbox_name: null, sandbox_cleaned_at: null, lease_token: null },
      tagged: [{ name: 's4-known', tags: { env: 'test' } }, { name: 's4-orphan', tags: { env: 'test' } }, { name: 's4-other-env', tags: { env: 'production' } }],
      uncleaned: ['s4-known'],
      boxes: { 's4-known': { status: 'running' }, 's4-orphan': { status: 'running' }, 's4-other-env': { status: 'running' } },
    });
    await w.tick();
    expect(Object.keys(w.boxes).sort()).toEqual(['s4-known', 's4-other-env']);
    expect(w.events.map(e => e.eventType)).toEqual(['presentation_video_orphan_sandbox_cleaned']);
    w.boxes['s4-orphan'] = { status: 'running' };
    await w.tick(); // minute 30, already run in this instance: not due again
    expect(w.boxes['s4-orphan']).toBeDefined();
    // At minute 0, over 55 minutes later, it runs again.
    w.nowMs = Date.UTC(2026, 9, 10, 14, 0, 0);
    await w.tick();
    expect(w.boxes['s4-orphan']).toBeUndefined();
  });
});

describe('recovery pass', () => {
  const cuttingWorld = over => {
    const w = world(over);
    Object.assign(w.row, { state: 'cutting', sandbox_name: NAME, sandbox_command_id: 'cmd-1', upload_url_ciphertext: null });
    w.boxes[NAME] = { status: 'running' };
    w.commands['cmd-1'] = { exitCode: null };
    return w;
  };

  test('access turned off fails a stranded cutting row, and the same sweep cleans its Sandbox', async () => {
    const w = cuttingWorld({ access: { valid: true, mode: 'off', requestId: null } });
    expect((await w.tick()).outcome).toBe('access_off');
    expect(w.row).toMatchObject({ state: 'failed', failure_code: 'presentation_video_access_withdrawn', lease_token: null });
    expect(w.boxes[NAME]).toBeUndefined();
    expect(w.row.sandbox_cleaned_at).toBe('now');
  });

  test('an invalid flag value counts as off; a test flag narrowed to another request withdraws access', async () => {
    const bad = cuttingWorld({ access: { valid: false, mode: 'off', requestId: null } });
    await bad.tick();
    expect(bad.row.failure_code).toBe('presentation_video_access_withdrawn');
    const other = cuttingWorld({ access: { valid: true, mode: 'test', requestId: '99999999-9999-4999-8999-999999999999' } });
    await other.tick();
    expect(other.row).toMatchObject({ state: 'failed', failure_code: 'presentation_video_access_withdrawn' });
  });

  test('an uploading row is failed and its sealed upload session cancelled', async () => {
    const w = cuttingWorld({ access: { valid: true, mode: 'off', requestId: null } });
    Object.assign(w.row, { state: 'uploading', upload_url_ciphertext: 'SEALED' });
    await w.tick();
    expect(w.cancelled).toEqual(['https://up.example.com/s?tok=SECRET2']);
    expect(w.row.upload_url_ciphertext).toBeNull();
  });

  test('a healthy polled row (access on, recent) is untouched', async () => {
    const w = cuttingWorld();
    w.row.sandbox_created_ms = w.nowMs - 60_000;
    expect((await w.tick()).outcome).toBe('polling');
    expect(w.row.state).toBe('cutting');
  });

  test('a row whose Sandbox was created longer ago than the timeout plus 15 minutes fails processor_expired even with access on', async () => {
    const w = cuttingWorld();
    w.row.sandbox_created_ms = w.nowMs - (10_800_000 + 16 * 60_000);
    w.row.updated_ms = w.nowMs;                     // recent lease activity must not postpone expiry
    await w.tick();
    expect(w.row).toMatchObject({ state: 'failed', failure_code: 'presentation_video_processor_expired' });
    const fresh = cuttingWorld();
    fresh.row.sandbox_created_ms = fresh.nowMs - (10_800_000 + 14 * 60_000);
    expect((await fresh.tick()).outcome).toBe('polling');
  });

  test('persistent revalidation errors cannot postpone expiry: repeated failing ticks end in processor_expired and cleanup', async () => {
    const w = cuttingWorld();
    w.row.sandbox_created_ms = w.nowMs;
    w.deps.getFileMetadataById = async () => { throw Object.assign(new Error('forbidden'), { status: 403 }); };
    for (let minute = 0; minute < 200; minute += 1) {
      w.nowMs += 60_000;
      w.row.updated_ms = w.nowMs;                   // every claim/release refreshes updated_at
      await w.tick();
      if (w.row.state === 'failed') break;
    }
    expect(w.row).toMatchObject({ state: 'failed', failure_code: 'presentation_video_processor_expired' });
    await w.tick();
    expect(w.row.sandbox_cleaned_at).toBeTruthy();
  });
});

describe('config', () => {
  test('defaults, valid overrides, and invalid values with a warning', () => {
    const warn = jest.fn();
    expect(readPresentationVideoSplitConfig({}, warn)).toEqual({ sandboxTimeoutMs: 10_800_000, vcpus: 2, leaseSeconds: 600 });
    expect(readPresentationVideoSplitConfig({ PRESENTATION_VIDEO_SANDBOX_VCPUS: '4', PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS: '3600000' }, warn))
      .toMatchObject({ vcpus: 4, sandboxTimeoutMs: 3_600_000 });
    expect(warn).not.toHaveBeenCalled();
    expect(readPresentationVideoSplitConfig({ PRESENTATION_VIDEO_SANDBOX_VCPUS: '99', PRESENTATION_VIDEO_SANDBOX_TIMEOUT_MS: 'abc' }, warn))
      .toMatchObject({ vcpus: 2, sandboxTimeoutMs: 10_800_000 });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
