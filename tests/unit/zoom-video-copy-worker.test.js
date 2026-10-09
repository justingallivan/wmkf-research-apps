/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));

// The default config reader lives in import-service (read-only reuse); every test injects its own.
jest.mock('../../lib/services/meeting-tracker-recordings/import-service.js', () => ({ readZoomImportConfig: jest.fn() }));

import { ZoomClientError } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import { runZoomVideoCopyTick, CHUNK_ADMISSION_MS } from '../../lib/services/meeting-tracker-recordings/video-copy-worker.js';
import {
  ID, REQ, OTHER_REQ, CHUNK, SECRETS, makeWorld, logText,
} from '../helpers/zoom-video-copy-world.js';

describe('happy path', () => {
  test('creates the session, pumps three chunks from Graph, records the candidate and moves to registering', async () => {
    const w = makeWorld({ size: 25 });
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.puts).toEqual([{ start: 0, length: 10 }, { start: 10, length: 10 }, { start: 20, length: 5 }]);
    expect(w.counts.create).toBe(1);
    expect(w.counts.list).toBe(1);
    expect(w.counts.resolve).toBe(1);
    expect(w.copy).toMatchObject({ state: 'registering', sharepoint_drive_id: 'drive1', sharepoint_item_id: 'item1', bytes_confirmed: 25 });
    expect(w.intent).toMatchObject({ state: 'uploaded', candidate_item_id: 'item1' });
    expect(w.copy.lease_token).toBeNull();
    expect(w.intent.lease_token).toBeNull();
    expect(w.maxBuffered).toBeLessThanOrEqual(CHUNK);
    // the bearer reaches the resolver only; range reads get a URL and byte window, nothing else
    expect(Object.keys(w.rangeArgs[0].args).sort()).toEqual(['deadlineMs', 'end', 'start', 'total']);
    const line = w.logs[0];
    expect(line).toMatchObject({ event: 'zoom_video_copy_tick', outcome: 'registering', fromState: 'queued', toState: 'registering', chunks: 3 });
    expect(line.expirationDateTime).toMatch(/^\d{4}-/);
  });

  test('registering records Graph quickXorHash for the exact item (decision 6)', async () => {
    const w = makeWorld({ size: 25 });
    w.graph.quickXorHash = 'QUICKXORHASHQUICKXORHASH123=';
    expect((await w.tick()).outcome).toBe('registering');
    expect(w.copy.sharepoint_quickxor_hash).toBe('QUICKXORHASHQUICKXORHASH123=');
  });

  test('a failed hash read records no hash, logs a code and still registers', async () => {
    const w = makeWorld({ size: 25 });
    // The candidate check reads the item first (resolveStableMp4Path); only the later hash read fails.
    const stable = w.deps.getFileMetadataById;
    const failing = jest.fn()
      .mockImplementationOnce(stable)
      .mockImplementation(async () => { const error = new Error('graph down'); error.code = 'graph_unavailable'; throw error; });
    expect((await w.tick({}, { getFileMetadataById: failing })).outcome).toBe('registering');
    expect(failing).toHaveBeenLastCalledWith('drive1', 'item1', { siteId: 'site1' });
    expect(w.copy).toMatchObject({ state: 'registering', sharepoint_item_id: 'item1', sharepoint_quickxor_hash: null });
    expect(w.logs).toContainEqual(expect.objectContaining({ event: 'zoom_video_copy_hash_unavailable', code: 'graph_unavailable' }));
  });

  test('I2 is recorded before the copy moves queued to copying, and the session is never created twice', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(0, { copy: 'queued' });
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.counts.create).toBe(0);
    expect(w.copy.session_create_attempts).toBe(0);
  });
});

describe('budget', () => {
  test('a chunk is admitted only while the plan margin remains and every GET starts inside it', async () => {
    const w = makeWorld({ size: 100 });
    w.ms = { list: 500, resolve: 500, get: 15_000, put: 15_000 };
    const result = await w.tick();
    expect(result.outcome).toBe('budget_yield');
    expect(w.puts.map(p => p.start)).toEqual([0, 10, 20]);
    expect(w.remainingAtGet.every(remaining => remaining >= CHUNK_ADMISSION_MS)).toBe(true);
    expect(w.copy).toMatchObject({ state: 'copying', bytes_confirmed: 30 });
    expect(w.copy.lease_token).toBeNull();
    expect(w.intent.lease_token).toBeNull();
    expect(CHUNK_ADMISSION_MS).toBe(190_000);
  });

  test('a tick that starts under the margin makes no remote write', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(0);
    const result = await w.tick({ deadlineMs: w.t + 100_000 });
    expect(result.outcome).toBe('budget_yield');
    expect(w.counts.put).toBe(0);
    expect(w.counts.get).toBe(0);
  });
});

describe('resume and loss', () => {
  test('resumes from Graph nextExpectedRanges whether the database is behind or ahead', async () => {
    for (const confirmed of [30, 70]) {
      const w = makeWorld({ size: 100 });
      w.seedSession(50);
      w.copy.bytes_confirmed = confirmed;
      await w.tick({ deadlineMs: w.t + 400_000 }); // 400 s leaves room for five chunks
      expect(w.puts[0].start).toBe(50);
    }
  });

  test('a 404 status marks the session uncertain and never restarts or creates', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(30);
    w.graph.sessions.clear();
    w.graph.lossStatus = 404;
    const result = await w.tick();
    expect(result.outcome).toBe('uncertain');
    expect(w.counts.create).toBe(0);
    expect(w.copy).toMatchObject({ state: 'copying', session_restarts: 0, uncertain_checks: 1 });
    expect(w.copy.next_attempt_at).toBeGreaterThan(w.t);
    expect(w.intent).toMatchObject({ state: 'failed', last_error: 'retry_status_unknown' });
    expect(w.sleeps).toEqual([0, 2_000, 8_000].filter(Boolean));
  });

  test('a 410 with every path check absent restarts at byte 0, re-claims I1 and pumps the fresh session', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(10);
    w.graph.sessions.clear();
    w.graph.lossStatus = 410;
    const claimsBefore = w.counts.claimPump;
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.counts.create).toBe(1);
    expect(w.copy.session_restarts).toBe(1);
    expect(w.puts.map(p => p.start)).toEqual([0, 10, 20]);
    expect(w.counts.claimPump - claimsBefore).toBe(2); // initial claim and the reacquire after the recovery-session write
    expect(w.logs[0].restarts).toBe(1);
  });

  test('a PUT that answers 410 is session loss, not a transient Graph error', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    const url = [...w.graph.sessions.keys()][0];
    let first = true;
    const deps = {
      putUploadSessionChunk: async (...args) => {
        if (first) { first = false; w.graph.sessions.delete(url); }
        return w.deps.putUploadSessionChunk(...args);
      },
    };
    const result = await w.tick({ deadlineMs: w.t + 400_000 }, deps);
    expect(w.copy.session_restarts).toBe(1);
    expect(w.counts.create).toBe(1);
    expect(['registering', 'budget_yield']).toContain(result.outcome);
  });

  test('restart counter caps: the third loss fails the copy in the same write and creates nothing', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(10);
    w.graph.sessions.clear();
    w.copy.session_restarts = 2;
    const result = await w.tick();
    expect(result.outcome).toBe('failed');
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_session_expired', session_restarts: 3 });
    expect(w.counts.create).toBe(0);
  });

  test('uncertain counter caps at three with its named code', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(10);
    w.graph.sessions.clear();
    w.graph.lossStatus = 404;
    w.copy.uncertain_checks = 2;
    const result = await w.tick();
    expect(result.outcome).toBe('failed');
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_session_uncertain', uncertain_checks: 3 });
  });

  test('a failed intent with a readable session is restored to initiated and its lease reacquired before pumping', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(10);
    w.intent.state = 'failed';
    w.intent.last_error = 'retry_status_unknown';
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.puts[0].start).toBe(10);
    expect(w.counts.claimPump).toBe(2);
  });

  test('a session whose exact item is already complete goes straight to bytes complete', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(25);
    w.graph.item = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: 25, eTag: 'e1', versionId: '1', cTag: 'c1' };
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.counts.put).toBe(0);
    expect(w.counts.list).toBe(0);
  });

  test('a partial item before any session is a path conflict and creates nothing', async () => {
    const w = makeWorld({ size: 25 });
    w.graph.partialItem = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: 5, eTag: 'e', versionId: '1' };
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_path_conflict' });
    expect(w.counts.create).toBe(0);
  });
});

describe('Graph failures', () => {
  test('a failed PUT ends the tick without DELETE or a state change', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(0);
    w.putError = 503;
    const result = await w.tick();
    expect(result.outcome).toBe('transient');
    expect(w.counts.del).toBe(0);
    expect(w.copy.state).toBe('copying');
    expect(w.copy.lease_token).toBeNull();
    expect(w.intent.lease_token).toBeNull();
  });

  test('a PUT whose response body timed out (no-response error) releases both leases with no state change', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(0);
    const world = w;
    let puts = 0;
    const result = await world.tick(undefined, {
      putUploadSessionChunk: async () => { puts += 1; throw Object.assign(new Error('Graph response body timed out'), { serviceName: 'graph', noResponse: true }); },
    });
    expect(puts).toBe(1);
    expect(result.outcome).toBe('transient');
    expect(world.counts.del).toBe(0);
    expect(world.copy.state).toBe('copying');
    expect(world.copy.lease_token).toBeNull();
    expect(world.intent.lease_token).toBeNull();
  });

  describe('a Graph response body that stalls after the headers', () => {
    const realFetch = global.fetch;
    afterEach(() => { global.fetch = realFetch; jest.dontMock('../../lib/services/graph/constants.js'); });
    const stalled = (status) => async (_url, init) => new Response(new ReadableStream({
      start(c) { init.signal.addEventListener('abort', () => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }); },
    }), { status });

    test('a stalled session-status read releases both leases with no state change', async () => {
      const w = makeWorld({ size: 25 });
      w.seedSession(0);
      const { getBrowserUploadSessionStatus } = await import('../../lib/services/graph/upload-session.js');
      global.fetch = jest.fn(stalled(200));
      const result = await w.tick(undefined, {
        getBrowserUploadSessionStatus: (url) => getBrowserUploadSessionStatus(null, url, { timeoutMs: 30 }),
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(result.outcome).toBe('transient');
      expect(w.counts.del).toBe(0);
      expect(w.copy.state).toBe('copying');
      expect(w.copy.lease_token).toBeNull();
      expect(w.intent.lease_token).toBeNull();
    });

    test('a stalled create-session read releases both leases with no state change', async () => {
      const w = makeWorld({ size: 25 });
      jest.resetModules();
      jest.doMock('../../lib/services/graph/constants.js', () => ({ ...jest.requireActual('../../lib/services/graph/constants.js'), API_TIMEOUT: 30 }));
      const { createBrowserUploadSession } = await import('../../lib/services/graph/upload-session.js');
      const { ALLOWED_LIBRARIES } = jest.requireActual('../../lib/services/graph/constants.js');
      const svc = { getSiteId: async () => 'site', getDriveId: async () => 'drive', getAccessToken: async () => 'tok', buildHeaders: () => ({}) };
      global.fetch = jest.fn(stalled(200));
      const result = await w.tick(undefined, {
        createBrowserUploadSession: (_lib, folder, name, opts) => createBrowserUploadSession(svc, [...ALLOWED_LIBRARIES][0], folder, name, opts),
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
      // a create failure is the worker's own counted, retryable outcome (see the create-failure cap test)
      expect(result.outcome).toBe('session_create_failed');
      expect(w.copy).toMatchObject({ state: 'queued', session_create_attempts: 1 });
      expect(w.counts.put).toBe(0);
      expect(w.counts.del).toBe(0);
      expect(w.copy.lease_token).toBeNull();
      expect(w.intent.lease_token).toBeNull();
    });
  });

  test('a mismatched next range after a PUT is uncertain, not progress', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    const deps = {
      putUploadSessionChunk: async (...args) => { const r = await w.deps.putUploadSessionChunk(...args); return { ...r, nextExpectedRanges: ['5-'] }; },
    };
    const result = await w.tick({}, deps);
    expect(result.outcome).toBe('uncertain');
    expect(w.copy.bytes_confirmed).toBe(0);
  });

  test('absent after the final PUT retries through uncertain_checks and caps with zoom_video_upload_uncertain', async () => {
    const w = makeWorld({ size: 10 });
    w.graph.hideItem = true;
    w.seedSession(0);
    let result = await w.tick();
    expect(result.outcome).toBe('uncertain');
    expect(w.copy).toMatchObject({ state: 'copying', uncertain_checks: 1 });
    expect(w.intent.state).toBe('initiated');
    // the next attempt re-sends the final chunk to a fresh session and is again absent; the third check caps
    w.copy.uncertain_checks = 2;
    w.copy.next_attempt_at = null;
    w.seedSession(0);
    result = await w.tick();
    expect(result.outcome).toBe('failed');
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_upload_uncertain', uncertain_checks: 3 });
  });

  test('a failed intent without a ciphertext runs the 0/2/8 s path checks, creates through the recovery-session writer and reacquires I1', async () => {
    const w = makeWorld({ size: 25 });
    w.intent.state = 'failed';
    w.intent.last_error = 'retry_status_unknown';
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.sleeps).toEqual([2_000, 8_000]);
    expect(w.counts.create).toBe(1);
    expect(w.counts.claimPump).toBe(2);
    expect(w.puts).toHaveLength(3);
    expect(w.copy.session_create_attempts).toBe(0);
  });

  test('a create failure counts an attempt on a queued row and caps at three', async () => {
    const w = makeWorld({ size: 25 });
    w.failCreate = true;
    let result = await w.tick();
    expect(result.outcome).toBe('session_create_failed');
    expect(w.copy).toMatchObject({ state: 'queued', session_create_attempts: 1 });
    w.copy.session_create_attempts = 2;
    w.t += 120_000;
    result = await w.tick();
    expect(result.outcome).toBe('failed');
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_video_session_create_failed' });
  });

  test('an ambiguous I2 whose receipt is present is repaired, not failed, and never DELETEs the session', async () => {
    const w = makeWorld({ size: 25 });
    w.hooks.i2Throw = 'applied';
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.counts.create).toBe(1);
    expect(w.counts.del).toBe(0);
    expect(w.copy.session_create_attempts).toBe(0);
  });

  test('an ambiguous I2 proven unrecorded cancels the unrecorded session and counts the attempt', async () => {
    const w = makeWorld({ size: 25 });
    w.hooks.i2Throw = 'not-applied';
    const result = await w.tick();
    expect(result.outcome).toBe('session_create_failed');
    expect(w.counts.del).toBe(1);
    expect(w.copy.session_create_attempts).toBe(1);
  });

  test('an ambiguous I2 with an unreadable readback retains the session and never DELETEs', async () => {
    const w = makeWorld({ size: 25 });
    w.hooks.i2Throw = 'applied';
    let reads = 0;
    const deps = { getSnapshot: async () => { reads += 1; if (reads > 1) throw new Error('db down'); return w.deps.getSnapshot(); } };
    const result = await w.tick({}, deps);
    expect(result.outcome).toBe('transient');
    expect(w.counts.del).toBe(0);
    expect(w.copy.session_create_attempts).toBe(0);
  });
});

describe('Zoom failures', () => {
  test('a 403 from the resolved URL re-resolves exactly once and continues', async () => {
    const w = makeWorld({ size: 25 });
    w.denyNext = [403];
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.counts.resolve).toBe(2);
    expect(w.counts.list).toBe(2);
    expect(w.puts).toHaveLength(3);
  });

  test('a second denial on the same chunk is terminal zoom_download_denied and cancels the session', async () => {
    const w = makeWorld({ size: 25 });
    w.denyNext = [403, 403, 403, 403];
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_download_denied' });
    expect(w.counts.resolve).toBe(2);
    expect(w.counts.put).toBe(0);
    expect(w.counts.del).toBe(1);
    expect(w.copy).toMatchObject({ state: 'failed', failure_code: 'zoom_download_denied' });
    expect(w.intent).toMatchObject({ state: 'abandoned', last_error: 'zoom_download_denied' });
  });

  test('the re-resolve allowance resets after each successful chunk', async () => {
    const w = makeWorld({ size: 25 });
    let n = 0;
    const deps = {
      fetchRecordingRange: async (url, args) => {
        n += 1;
        if (n === 1 || n === 3) { w.counts.get += 1; return { bytes: null, status: 410 }; }
        return w.deps.fetchRecordingRange(url, args);
      },
    };
    const result = await w.tick({}, deps);
    expect(result.outcome).toBe('registering');
    expect(w.counts.resolve).toBe(3);
  });

  test('a 200 to a ranged GET is terminal zoom_range_unsupported with zero bytes PUT', async () => {
    const w = makeWorld({ size: 25 });
    const deps = { fetchRecordingRange: async () => { throw new ZoomClientError('zoom_range_unsupported'); } };
    const result = await w.tick({}, deps);
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_range_unsupported' });
    expect(w.counts.put).toBe(0);
  });

  test('429 and 5xx from Zoom end the tick with no state change', async () => {
    const w = makeWorld({ size: 25 });
    const deps = { fetchRecordingRange: async () => { throw new ZoomClientError('zoom_rate_limited'); } };
    const result = await w.tick({}, deps);
    expect(result.outcome).toBe('transient');
    expect(w.copy.state).toBe('copying');
    expect(w.copy.lease_token).toBeNull();
  });

  test('a changed file size, id or host fails the copy before any byte moves', async () => {
    for (const mutate of [d => { d.recording_files[0].file_size = 99; }, d => { d.recording_files[0].id = 'other'; }, d => { d.host_id = 'host2'; }]) {
      const w = makeWorld({ size: 25 });
      const detail = w.detail;
      w.deps.getMeetingRecordings = async () => { const d = detail(); mutate(d); return d; };
      const result = await w.tick();
      expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_recording_changed' });
      expect(w.counts.put).toBe(0);
      expect(w.copy.state).toBe('failed');
    }
  });
});

describe('host recheck and kill switch', () => {
  test('a host removed before the tick fails the copy with no Zoom call and no Graph write', async () => {
    const w = makeWorld({ size: 25 });
    w.hosts = ['someone-else@example.org'];
    const result = await w.tick();
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_host_not_approved' });
    expect(w.counts).toMatchObject({ list: 0, resolve: 0, get: 0, create: 0, put: 0, del: 0 });
    expect(w.intent).toMatchObject({ state: 'abandoned', last_error: 'zoom_video_host_not_approved' });
  });

  test('a host removed mid-copy stops before the next write and does not DELETE the session', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    w.hooks.afterPut = count => { if (count === 1) w.hosts = []; };
    const result = await w.tick({ deadlineMs: w.t + 400_000 });
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_host_not_approved' });
    expect(w.counts.put).toBe(1);
    expect(w.counts.del).toBe(0);
  });

  test('a removed Zoom config pauses instead of failing', async () => {
    const w = makeWorld({ size: 25 });
    const result = await w.tick({}, { readConfig: () => ({ available: false, hosts: [] }) });
    expect(result.outcome).toBe('paused');
    expect(w.copy.state).toBe('queued');
    expect(w.counts.create).toBe(0);
  });

  test('kill switch off claims nothing but still runs reconcile-finalized', async () => {
    const w = makeWorld();
    w.access = { valid: true, mode: 'off', requestId: null };
    expect(await w.tick({}, { reconcileFinalized: async () => { w.counts.reconcile += 1; } })).toEqual({ outcome: 'access_off' });
    expect(w.counts.claim).toBe(0);
    expect(w.counts.reconcile).toBe(1);
    w.access = { valid: false, mode: 'off', requestId: null };
    expect((await w.tick()).outcome).toBe('access_off');
    expect(w.counts.claim).toBe(0);
  });

  test('test:<other GUID> claims only that request', async () => {
    const w = makeWorld();
    w.access = { valid: true, mode: 'test', requestId: OTHER_REQ };
    expect((await w.tick()).outcome).toBe('idle');
    expect(w.lastClaimAccess).toBe(OTHER_REQ);
    expect(w.copy.lease_token).toBeNull();
  });

  test('access denied mid-tick pauses and releases both leases', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    let calls = 0;
    const result = await w.tick({ deadlineMs: w.t + 400_000 }, { requestAllowed: () => { calls += 1; return calls < 6; } });
    expect(result.outcome).toBe('paused');
    expect(w.copy.lease_token).toBeNull();
    expect(w.intent.lease_token).toBeNull();
  });
});

describe('leases and dispatch', () => {
  test('a stale tick stops at its next fence after takeover and writes nothing more', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    w.hooks.afterPut = count => { if (count === 1) { w.copy.lease_token = 'someone-else'; w.copy.lease_expires_at = w.t + 600_000; } };
    const result = await w.tick({ deadlineMs: w.t + 400_000 });
    expect(result.outcome).toBe('lease_lost');
    expect(w.counts.put).toBe(1);
    expect(w.copy.lease_token).toBe('someone-else');
    expect(w.copy.bytes_confirmed).toBe(0);
  });

  test('a takeover or cancel that lands while the chunk is being read stops before the PUT', async () => {
    for (const interfere of [
      w => { w.copy.lease_token = 'someone-else'; w.copy.lease_expires_at = w.t + 600_000; },
      w => { w.copy.cancel_requested_at = new Date(w.t).toISOString(); },
    ]) {
      const w = makeWorld({ size: 100 });
      w.seedSession(0);
      w.hooks.afterGet = count => { if (count === 1) interfere(w); };
      const result = await w.tick({ deadlineMs: w.t + 400_000 });
      expect(w.counts.put).toBe(0);
      expect(['lease_lost', 'cancelled']).toContain(result.outcome);
    }
  });

  test('another live intent lease defers and nothing is pumped', async () => {
    const w = makeWorld({ size: 25 });
    w.intent.lease_token = 'cleanup'; w.intent.lease_expires_at = w.t + 100_000;
    expect((await w.tick()).outcome).toBe('deferred_intent_lease');
    expect(w.counts.put).toBe(0);
    expect(w.copy.lease_token).toBeNull();
  });

  test('an invalid tuple fails closed with an alert and no Graph write', async () => {
    const w = makeWorld({ size: 25, copyState: 'copying' });
    const result = await w.tick(); // copying + initiated + no ciphertext is invalid
    expect(result).toMatchObject({ outcome: 'failed', code: 'zoom_video_state_invalid' });
    expect(w.events).toHaveLength(1);
    expect(w.counts).toMatchObject({ create: 0, put: 0, del: 0 });
  });

  test('uploaded intent with a candidate replays queued to registering from the intent candidate', async () => {
    const w = makeWorld({ size: 25 });
    Object.assign(w.intent, { state: 'uploaded', candidate_item_id: 'item1', candidate_drive_id: 'drive1', candidate_site_id: 'site1' });
    const result = await w.tick();
    expect(result.outcome).toBe('registering');
    expect(w.copy).toMatchObject({ state: 'registering', sharepoint_drive_id: 'drive1', sharepoint_item_id: 'item1' });
    expect(w.counts.intentRenew).toBe(0);
  });
});

describe('cancel', () => {
  test('before bytes with a session: path check, DELETE, path checks at 0/2/8 s, abandonment, copy cancelled', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(30);
    w.copy.cancel_requested_at = new Date(w.t).toISOString();
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.counts.del).toBe(1);
    expect(w.counts.put).toBe(0);
    expect(w.sleeps).toEqual([2_000, 8_000]);
    expect(w.intent).toMatchObject({ state: 'abandoned', last_error: 'staff_cancelled', upload_url_ciphertext: null });
    expect(w.copy).toMatchObject({ state: 'cancelled', sharepoint_item_id: null });
    expect(w.copy.lease_token).toBeNull();
  });

  test('initiated without a ciphertext and an absent path cancels without DELETE', async () => {
    const w = makeWorld({ size: 25 });
    w.copy.cancel_requested_at = new Date(w.t).toISOString();
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.counts.del).toBe(0);
    expect(w.counts.create).toBe(0);
    expect(w.intent).toMatchObject({ state: 'abandoned', last_error: 'staff_cancelled' });
  });

  test('a DELETE that answers 404 alone never yields cancelled', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(30);
    w.copy.cancel_requested_at = new Date(w.t).toISOString();
    w.graph.cancelOutcome = 'gone';
    const result = await w.tick();
    expect(result.outcome).toBe('uncertain');
    expect(w.copy).toMatchObject({ state: 'copying', uncertain_checks: 1 });
    expect(w.intent).toMatchObject({ state: 'failed', last_error: 'cancel_status_unknown' });
  });

  test('a crash after abandonment replays cancelled with no intent renewal', async () => {
    const w = makeWorld({ size: 25 });
    Object.assign(w.intent, { state: 'abandoned', last_error: 'staff_cancelled' });
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.copy.state).toBe('cancelled');
    expect(w.counts.intentRenew).toBe(0);
    expect(w.counts.claimPump).toBe(0);
  });

  test('a complete item found while cancelling is recorded and the copy is cancelled with its identity', async () => {
    const w = makeWorld({ size: 25 });
    w.seedSession(25);
    w.graph.item = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: 25, eTag: 'e1', versionId: '1', cTag: 'c1' };
    w.copy.cancel_requested_at = new Date(w.t).toISOString();
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.counts.del).toBe(0);
    expect(w.copy).toMatchObject({ state: 'cancelled', sharepoint_drive_id: 'drive1', sharepoint_item_id: 'item1' });
    expect(w.intent).toMatchObject({ state: 'uploaded', candidate_item_id: 'item1' });
  });

  test('a flag set during the last chunk still lets the candidate land, then cancels with drive and item recorded', async () => {
    const w = makeWorld({ size: 25 });
    w.hooks.afterPut = (count, last) => { if (last) w.copy.cancel_requested_at = new Date(w.t).toISOString(); };
    const result = await w.tick();
    expect(result.outcome).toBe('cancelled');
    expect(w.intent).toMatchObject({ state: 'uploaded', candidate_item_id: 'item1' });
    expect(w.copy).toMatchObject({ state: 'cancelled', sharepoint_drive_id: 'drive1', sharepoint_item_id: 'item1' });
    expect(w.counts.del).toBe(0);
  });

  test('a flag seen between chunks diverts to the cancel sequence', async () => {
    const w = makeWorld({ size: 100 });
    w.seedSession(0);
    w.hooks.afterPut = count => { if (count === 1) w.copy.cancel_requested_at = new Date(w.t).toISOString(); };
    const result = await w.tick({ deadlineMs: w.t + 400_000 });
    expect(result.outcome).toBe('cancelled');
    expect(w.counts.put).toBe(1);
    expect(w.counts.del).toBe(1);
    expect(w.intent.state).toBe('abandoned');
  });
});

describe('logging', () => {
  test('log lines and results carry no URL, token, email or error message', async () => {
    const lines = [];
    const spy = jest.spyOn(console, 'log').mockImplementation(line => { lines.push(String(line)); });
    try {
      for (const setup of [
        w => { w.denyNext = [403, 403, 403, 403]; },
        w => { w.seedSession(0); w.putError = 503; },
        w => { w.failCreate = true; },
        w => { w.seedSession(10); w.graph.sessions.clear(); w.graph.lossStatus = 404; },
      ]) {
        const w = makeWorld({ size: 25 });
        setup(w);
        const { log, ...rest } = w.deps;
        const result = await runZoomVideoCopyTick({ deadlineMs: w.t + 270_000 }, rest);
        lines.push(JSON.stringify(result));
        lines.push(JSON.stringify(w.events));
      }
    } finally { spy.mockRestore(); }
    expect(lines.length).toBeGreaterThan(4);
    for (const line of lines) for (const secret of SECRETS) expect(line).not.toContain(secret);
    expect(logText(makeWorld())).not.toContain('SECRET');
  });
});
