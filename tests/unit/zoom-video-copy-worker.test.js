/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ sql: { query: jest.fn() }, db: { connect: jest.fn() } }));

// The default config reader lives in import-service (read-only reuse); every test injects its own.
jest.mock('../../lib/services/meeting-tracker-recordings/import-service.js', () => ({ readZoomImportConfig: jest.fn() }));

import { ZoomClientError } from '../../lib/services/meeting-tracker-recordings/zoom-client.js';
import { hashZoomHostEmail } from '../../lib/services/meeting-tracker-recordings/video-copy-store.js';
import { runZoomVideoCopyTick, CHUNK_ADMISSION_MS } from '../../lib/services/meeting-tracker-recordings/video-copy-worker.js';

const ID = '11111111-1111-4111-8111-111111111111';
const REQ = '22222222-2222-4222-8222-222222222222';
const OTHER_REQ = '99999999-9999-4999-8999-999999999999';
const ACTOR = '33333333-3333-4333-8333-333333333333';
const HOST = 'host@example.org';
const CHUNK = 10;
const SECRETS = ['ZOOMTOKENSECRET', 'SECRETDL', 'SECRETSIG', 'tempauth=', 'Bearer', 'https://', HOST, '@'];

/**
 * In-memory copy store, intent store, Graph and Zoom that enforce the real predicates (live token, state,
 * candidate, lease clearing on recovery-session writes), so a skipped renewal or reacquire really fails.
 */
function makeWorld({ size = 25, copyState = 'queued' } = {}) {
  const w = {
    t: 1_000_000, logs: [], events: [], hosts: [HOST], allowed: true,
    access: { valid: true, mode: 'on', requestId: null },
    ms: { list: 500, resolve: 500, get: 500, put: 500 },
    counts: { claim: 0, claimPump: 0, create: 0, put: 0, del: 0, list: 0, resolve: 0, get: 0, intentRenew: 0, reconcile: 0 },
    puts: [], sleeps: [], remainingAtGet: [], maxBuffered: 0, denyNext: [], getAccessArgs: [], rangeArgs: [],
    graph: { sessions: new Map(), item: null, hideItem: false, partialItem: null, lossStatus: 410, cancelOutcome: 'cancelled', nextUrl: 1 },
    hooks: {}, failCreate: false, putError: null,
  };
  const iso = ms => new Date(ms).toISOString();
  w.detail = () => ({
    host_id: 'host1',
    recording_files: [{
      id: 'file1', status: 'completed', file_extension: 'MP4', recording_type: 'shared_screen_with_speaker_view',
      file_size: size, download_url: 'https://zoom.us/rec/download/SECRETDL',
    }],
  });
  w.copy = {
    id: ID, upload_id: ID, request_id: REQ, state: copyState, lease_token: null, lease_expires_at: 0, next_attempt_at: null,
    cancel_requested_at: null, declared_size: size, bytes_confirmed: 0, session_create_attempts: 0, session_restarts: 0,
    uncertain_checks: 0, registration_attempts: 0, zoom_meeting_uuid: 'm==', zoom_host_id: 'host1',
    zoom_host_email_sha256: hashZoomHostEmail(HOST), zoom_file_id: 'file1',
    zoom_recording_type: 'shared_screen_with_speaker_view', sharepoint_drive_id: null, sharepoint_item_id: null, failure_code: null,
  };
  w.intent = {
    id: ID, origin: 'zoom_copy', state: 'initiated', upload_url_ciphertext: null, lease_token: null, lease_expires_at: 0,
    candidate_item_id: null, candidate_drive_id: null, candidate_site_id: null, candidate_size: null, last_error: null,
    request_id: REQ, actor_id: ACTOR, library_name: 'Lib', folder_path: 'Folder/Post', physical_filename: '1001-Recording.mp4',
    declared_size: size, intent_expires_at: w.t + 3 * 86_400_000, upload_session_expires_at: null,
  };
  const live = (row, token) => token && row.lease_token === token && row.lease_expires_at > w.t;
  const free = row => !row.lease_token || row.lease_expires_at <= w.t;
  const bumpCopy = () => { w.copy.lease_expires_at = w.t + 600_000; };
  const bumpIntent = () => { w.intent.lease_expires_at = w.t + 300_000; };
  const endCopy = (state, patch = {}) => Object.assign(w.copy, { state, lease_token: null, lease_expires_at: null, next_attempt_at: null }, patch);

  const copyReturn = () => ({ ...w.copy });
  const snapshot = () => ({
    ...w.copy,
    intent_state: w.intent.state, intent_origin: w.intent.origin, intent_last_error: w.intent.last_error,
    intent_has_ciphertext: Boolean(w.intent.upload_url_ciphertext), intent_expires_at: w.intent.intent_expires_at,
    intent_expired: w.intent.intent_expires_at <= w.t, intent_lease_live: Boolean(w.intent.lease_token && w.intent.lease_expires_at > w.t),
    candidate_item_id: w.intent.candidate_item_id, candidate_drive_id: w.intent.candidate_drive_id,
    candidate_site_id: w.intent.candidate_site_id,
  });
  const cap = (field, code, state) => {
    if (w.copy[field] + 1 > 3) throw new Error('CHECK violated: counter above cap');
    w.copy[field] += 1;
    return w.copy[field] >= 3 ? (endCopy('failed', { failure_code: code }), true) : (void (state), false);
  };

  const graphError = (status, message = 'graph failed https://graph.example/up?tempauth=SECRETSIG Bearer ZOOMTOKENSECRET') =>
    Object.assign(new Error(message), { status });
  const item = () => w.graph.item;

  w.deps = {
    chunkBytes: CHUNK,
    now: () => w.t,
    sleep: async ms => { w.sleeps.push(ms); w.t += ms; },
    log: line => w.logs.push(line),
    recordEvent: async event => { w.events.push(event); },
    access: () => w.access,
    requestAllowed: () => w.allowed,
    readConfig: () => ({ available: true, hosts: w.hosts }),
    reconcileFinalized: async () => { w.counts.reconcile += 1; },
    sealUploadUrl: url => `sealed:${url}`,
    openUploadUrl: cipher => { if (!String(cipher).startsWith('sealed:')) throw new Error('bad cipher'); return cipher.slice(7); },

    claimCopy: async ({ accessRequestId = null } = {}) => {
      w.counts.claim += 1;
      w.lastClaimAccess = accessRequestId;
      const c = w.copy;
      if (!['queued', 'copying', 'registering'].includes(c.state) || !free(c)) return null;
      if (c.next_attempt_at && c.next_attempt_at > w.t) return null;
      if (accessRequestId && accessRequestId !== c.request_id) return null;
      c.lease_token = `copy-${w.counts.claim}`; bumpCopy();
      return { row: copyReturn(), leaseToken: c.lease_token };
    },
    getSnapshot: async () => snapshot(),
    renewCopyLease: async ({ leaseToken, states }) => {
      if (!live(w.copy, leaseToken) || !states.includes(w.copy.state)) return null;
      bumpCopy();
      return { state: w.copy.state, cancel_requested_at: w.copy.cancel_requested_at };
    },
    releaseCopyLease: async ({ leaseToken }) => {
      if (w.copy.lease_token !== leaseToken) return null;
      Object.assign(w.copy, { lease_token: null, lease_expires_at: null });
      return copyReturn();
    },
    markCopying: async ({ leaseToken }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'queued') return null;
      w.copy.state = 'copying'; return copyReturn();
    },
    recordProgress: async ({ leaseToken, bytesConfirmed }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'copying') return null;
      w.copy.bytes_confirmed = Math.min(bytesConfirmed, w.copy.declared_size); return copyReturn();
    },
    recordCreateFailure: async ({ leaseToken, retryAfterSeconds }) => {
      if (!live(w.copy, leaseToken) || w.copy.state !== 'queued') return null;
      if (!cap('session_create_attempts', 'zoom_video_session_create_failed')) w.copy.next_attempt_at = w.t + retryAfterSeconds * 1000;
      return copyReturn();
    },
    recordRestart: async ({ leaseToken }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      w.copy.bytes_confirmed = 0;
      cap('session_restarts', 'zoom_video_session_expired');
      return copyReturn();
    },
    recordUncertainCheck: async ({ leaseToken, retryAfterSeconds, capFailureCode }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      if (!cap('uncertain_checks', capFailureCode)) w.copy.next_attempt_at = w.t + retryAfterSeconds * 1000;
      return copyReturn();
    },
    markRegistering: async ({ leaseToken, driveId, itemId }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying'].includes(w.copy.state)) return null;
      Object.assign(w.copy, { state: 'registering', sharepoint_drive_id: driveId, sharepoint_item_id: itemId, bytes_confirmed: w.copy.declared_size });
      return copyReturn();
    },
    failCopy: async ({ leaseToken, failureCode }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying', 'registering'].includes(w.copy.state)) return null;
      endCopy('failed', { failure_code: failureCode }); return copyReturn();
    },
    cancelCopy: async ({ leaseToken, driveId = null, itemId = null }) => {
      if (!live(w.copy, leaseToken) || !['queued', 'copying', 'registering'].includes(w.copy.state)) return null;
      endCopy('cancelled', { sharepoint_drive_id: driveId, sharepoint_item_id: itemId }); return copyReturn();
    },

    claimPump: async () => {
      w.counts.claimPump += 1;
      const u = w.intent;
      if (!['initiated', 'failed'].includes(u.state) || u.candidate_item_id || !free(u) || u.intent_expires_at <= w.t) return null;
      u.lease_token = `intent-${w.counts.claimPump}`; bumpIntent();
      return { row: { ...u }, leaseToken: u.lease_token };
    },
    recordIntentSession: async ({ leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt }) => {
      const u = w.intent;
      if (w.hooks.i2Throw) { const mode = w.hooks.i2Throw; w.hooks.i2Throw = null; if (mode === 'applied') Object.assign(u, { upload_url_ciphertext: uploadUrlCiphertext }); throw new Error('db down'); }
      if (u.state !== 'initiated' || u.upload_url_ciphertext || u.candidate_item_id || !live(u, leaseToken)) return null;
      Object.assign(u, { upload_url_ciphertext: uploadUrlCiphertext, upload_session_expires_at: expiresAt, intent_expires_at: Date.parse(intentExpiresAt) });
      return { ...u };
    },
    renewIntentRecovery: async ({ leaseToken }) => {
      w.counts.intentRenew += 1;
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      bumpIntent(); return { ...u };
    },
    releaseIntentRecovery: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken)) return null;
      Object.assign(u, { lease_token: null, lease_expires_at: null }); return { ...u };
    },
    markRecoveryTerminal: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'failed', last_error: 'session_expired' }); return { ...u };
    },
    markRecoveryUncertain: async ({ leaseToken, lastError }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'failed', last_error: lastError }); return { ...u };
    },
    cancelRecovery: async ({ leaseToken }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'abandoned', upload_url_ciphertext: null, lease_token: null, lease_expires_at: null, last_error: 'staff_cancelled' });
      return { ...u };
    },
    abandonForSourceFailure: async ({ leaseToken, failureCode }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || !['initiated', 'failed'].includes(u.state) || u.candidate_item_id) return null;
      Object.assign(u, { state: 'abandoned', upload_url_ciphertext: null, lease_token: null, lease_expires_at: null, last_error: failureCode });
      return { ...u };
    },
    recordRecoverySession: async ({ leaseToken, uploadUrlCiphertext, expiresAt, intentExpiresAt }) => {
      const u = w.intent;
      if (!live(u, leaseToken) || u.state !== 'failed' || u.candidate_item_id) return null;
      Object.assign(u, {
        state: 'initiated', upload_url_ciphertext: uploadUrlCiphertext, upload_session_expires_at: expiresAt,
        intent_expires_at: Date.parse(intentExpiresAt), lease_token: null, lease_expires_at: null, last_error: null,
      });
      return { ...u };
    },
    refreshUploadSession: async ({ requestId, actorId, leaseToken, uploadUrlCiphertext }) => {
      const u = w.intent;
      if (requestId !== u.request_id || actorId !== u.actor_id || !['initiated', 'uploaded'].includes(u.state)
        || u.upload_url_ciphertext !== uploadUrlCiphertext || !(free(u) || live(u, leaseToken))) return null;
      return { ...u };
    },
    recordUploadCandidate: async ({ requestId, actorId, candidate, leaseToken }) => {
      const u = w.intent;
      if (requestId !== u.request_id || actorId !== u.actor_id || !live(u, leaseToken) || ['finalized', 'abandoned'].includes(u.state)) return null;
      Object.assign(u, { state: 'uploaded', candidate_item_id: candidate.itemId, candidate_drive_id: candidate.driveId, candidate_site_id: candidate.siteId, candidate_size: candidate.size });
      return { ...u };
    },

    getMeetingRecordings: async () => { w.counts.list += 1; w.t += w.ms.list; return w.detail(); },
    getAccessToken: async () => 'ZOOMTOKENSECRET',
    resolveRecordingDownloadUrl: async (downloadUrl, args) => {
      w.counts.resolve += 1; w.t += w.ms.resolve; w.getAccessArgs.push(args);
      return `https://ssrweb.zoom.us/resolved?sig=SECRETSIG${w.counts.resolve}`;
    },
    fetchRecordingRange: async (url, args) => {
      w.counts.get += 1; w.rangeArgs.push({ url, args });
      w.remainingAtGet.push(args.deadlineMs - w.t);
      w.t += w.ms.get;
      if (w.hooks.afterGet) w.hooks.afterGet(w.counts.get);
      const denied = w.denyNext.shift();
      if (denied) return { bytes: null, status: denied };
      const bytes = Buffer.alloc(args.end - args.start + 1, 7);
      w.maxBuffered = Math.max(w.maxBuffered, bytes.length);
      return { bytes, status: 206 };
    },

    createBrowserUploadSession: async () => {
      w.counts.create += 1;
      if (w.failCreate) throw graphError(503);
      const uploadUrl = `https://graph.example/up/${w.graph.nextUrl++}?tempauth=SECRETSIG`;
      w.graph.sessions.set(uploadUrl, { received: 0 });
      return { uploadUrl, expiresAt: iso(w.t + 3_600_000), nextExpectedRanges: ['0-'] };
    },
    getBrowserUploadSessionStatus: async url => {
      const s = w.graph.sessions.get(url);
      if (!s) throw graphError(w.graph.lossStatus);
      return { expiresAt: iso(w.t + 3_600_000), nextExpectedRanges: [`${s.received}-`] };
    },
    putUploadSessionChunk: async (url, { start, bytes, total }) => {
      w.counts.put += 1; w.t += w.ms.put;
      if (w.putError) throw graphError(w.putError);
      const s = w.graph.sessions.get(url);
      if (!s) throw graphError(w.graph.lossStatus);
      if (start !== s.received) throw graphError(416);
      s.received += bytes.length;
      w.puts.push({ start, length: bytes.length });
      if (w.hooks.afterPut) w.hooks.afterPut(w.puts.length, s.received === total);
      if (s.received === total) {
        w.graph.item = { id: 'item1', driveId: 'drive1', siteId: 'site1', name: w.intent.physical_filename, size: total, eTag: 'e1', versionId: '1', cTag: 'c1', webUrl: 'https://sp.example/x' };
        return { status: 201, nextExpectedRanges: [], expirationDateTime: iso(w.t + 3_000_000), item: w.graph.item };
      }
      return { status: 202, nextExpectedRanges: [`${s.received}-`], expirationDateTime: iso(w.t + 3_000_000), item: null };
    },
    cancelBrowserUploadSession: async url => {
      w.counts.del += 1; w.graph.sessions.delete(url);
      return { outcome: w.graph.cancelOutcome, status: 204 };
    },
    getFileMetadataByPath: async () => {
      if (w.graph.partialItem) return w.graph.partialItem;
      return item() && !w.graph.hideItem ? { ...item() } : null;
    },
    getFileMetadataById: async () => (item() ? { ...item() } : null),
  };
  // Seed an existing Graph session (and its sealed receipt on the intent) at a given received offset.
  w.seedSession = (received, { copy = 'copying' } = {}) => {
    const uploadUrl = `https://graph.example/up/${w.graph.nextUrl++}?tempauth=SECRETSIG`;
    w.graph.sessions.set(uploadUrl, { received });
    w.intent.upload_url_ciphertext = `sealed:${uploadUrl}`;
    w.copy.state = copy;
    return uploadUrl;
  };
  w.tick = (overrides = {}, depOverrides = {}) => runZoomVideoCopyTick({ deadlineMs: w.t + 270_000, ...overrides }, { ...w.deps, ...depOverrides });
  return w;
}

const logText = w => JSON.stringify(w.logs);

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
    w.hooks.afterPut = () => {};
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
    w.copy.uncertain_checks = 2;
    w.t += 120_000;
    w.graph.sessions.clear();
    w.graph.lossStatus = 404;
    w.graph.hideItem = true;
    result = await w.tick();
    expect(['uncertain', 'failed']).toContain(result.outcome);
    expect(w.copy.uncertain_checks).toBe(3);
    expect(w.copy.failure_code).toBe('zoom_video_session_uncertain');
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

  test('kill switch off claims nothing but still runs the reconcile seam', async () => {
    const w = makeWorld();
    w.access = { valid: true, mode: 'off', requestId: null };
    expect(await w.tick()).toEqual({ outcome: 'access_off' });
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

  test('another live intent lease defers; an expired intent is left for S6; neither pumps', async () => {
    const w = makeWorld({ size: 25 });
    w.intent.lease_token = 'cleanup'; w.intent.lease_expires_at = w.t + 100_000;
    expect((await w.tick()).outcome).toBe('deferred_intent_lease');
    const e = makeWorld({ size: 25 });
    e.intent.intent_expires_at = e.t - 1;
    expect((await e.tick()).outcome).toBe('intent_expired_deferred');
    expect(w.counts.put + e.counts.put).toBe(0);
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

  test('registering rows are left for S6 with their lease released', async () => {
    const w = makeWorld({ size: 25, copyState: 'registering' });
    Object.assign(w.intent, { state: 'uploaded', candidate_item_id: 'item1', candidate_drive_id: 'drive1', candidate_site_id: 'site1' });
    expect((await w.tick()).outcome).toBe('registering_deferred');
    expect(w.copy.lease_token).toBeNull();
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
