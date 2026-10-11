/** @jest-environment node */
import {
  ZoomClientError, getMeetingAttendance, getAccessToken, resetZoomTokenCache, listHostRecordings, getMeetingRecordings,
  downloadRecordingFile, encodeMeetingUuid, resolveRecordingDownloadUrl, fetchRecordingRange,
} from '../../lib/services/meeting-tracker-recordings/zoom-client.js';

const SECRET = 'client-secret-value';
const TOKEN = 'zoom-access-token-value';
const ENV_KEYS = ['ZOOM_S2S_ACCOUNT_ID', 'ZOOM_S2S_CLIENT_ID', 'ZOOM_S2S_CLIENT_SECRET'];
let saved;
let fetchMock;

function headers(map = {}) { return { get: name => map[String(name).toLowerCase()] ?? null }; }
function jsonRes(body, status = 200) { return { ok: status >= 200 && status < 300, status, headers: headers({ 'content-type': 'application/json' }), json: async () => body, body: null }; }
function streamRes(chunks, { status = 200, type = 'audio/mp4', extra = {} } = {}) {
  const queue = chunks.map(c => new Uint8Array(Buffer.from(c)));
  return { ok: status >= 200 && status < 300, status, headers: headers({ 'content-type': type, ...extra }), json: async () => { throw new Error('not json'); },
    body: { getReader: () => ({ read: async () => (queue.length ? { done: false, value: queue.shift() } : { done: true }), cancel: jest.fn(async () => {}) }) } };
}
function redirect(location, status = 302) { return { ok: false, status, headers: headers({ location }), json: async () => ({}), body: null }; }
const tokenRes = (expiresIn = 3600) => jsonRes({ access_token: TOKEN, expires_in: expiresIn });

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.ZOOM_S2S_ACCOUNT_ID = 'acct'; process.env.ZOOM_S2S_CLIENT_ID = 'cid'; process.env.ZOOM_S2S_CLIENT_SECRET = SECRET;
  resetZoomTokenCache();
  fetchMock = jest.fn();
  global.fetch = fetchMock;
});
afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } jest.useRealTimers(); });

async function rejection(promise) { try { await promise; } catch (error) { return error; } throw new Error('expected rejection'); }
function expectNoLeak(error) {
  const text = `${error.message} ${error.code} ${JSON.stringify(error)}`;
  for (const secret of [TOKEN, SECRET, 'ssrweb', 'https://', 'evil.example', '/rec/download', 'Bearer', 'cid:']) expect(text).not.toContain(secret);
  expect(error.message).toBe(error.code);
}

describe('access token', () => {
  test('is fetched with Basic auth, cached, and refreshed 60 s before expiry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-08T00:00:00Z'));
    fetchMock.mockResolvedValue(tokenRes(3600));
    expect(await getAccessToken()).toBe(TOKEN);
    expect(await getAccessToken()).toBe(TOKEN);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acct');
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`cid:${SECRET}`).toString('base64')}`);
    jest.setSystemTime(new Date('2026-10-08T00:58:59Z'));
    await getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    jest.setSystemTime(new Date('2026-10-08T00:59:01Z'));
    await getAccessToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('missing credentials fail before any request', async () => {
    delete process.env.ZOOM_S2S_CLIENT_SECRET;
    const error = await rejection(getAccessToken());
    expect(error).toBeInstanceOf(ZoomClientError);
    expect(error.code).toBe('zoom_not_configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('a rejected token request maps to zoom_auth_failed without echoing the body', async () => {
    fetchMock.mockResolvedValue(jsonRes({ reason: `bad ${SECRET}` }, 401));
    const error = await rejection(getAccessToken());
    expect(error.code).toBe('zoom_auth_failed');
    expectNoLeak(error);
  });
});

describe('listHostRecordings', () => {
  test('splits a 90-day range into windows of at most 30 days, follows next_page_token, de-duplicates by uuid', async () => {
    const calls = [];
    fetchMock.mockImplementation(async (url) => {
      if (String(url).startsWith('https://zoom.us/oauth')) return tokenRes();
      calls.push(new URL(url));
      const q = new URL(url).searchParams;
      if (q.get('next_page_token') === 'p2') return jsonRes({ meetings: [{ uuid: 'b' }, { uuid: 'a' }] });
      return jsonRes({ meetings: [{ uuid: 'a' }], next_page_token: calls.length === 1 ? 'p2' : '' });
    });
    const to = new Date('2026-10-08T00:00:00Z');
    const from = new Date(to.getTime() - 90 * 86_400_000);
    const meetings = await listHostRecordings('wmk-library@wmkeck.org', { from, to });
    expect(meetings.map(m => m.uuid).sort()).toEqual(['a', 'b']);
    expect(calls.every(u => u.pathname === '/v2/users/wmk-library%40wmkeck.org/recordings')).toBe(true);
    expect(calls.some(u => u.searchParams.get('next_page_token') === 'p2')).toBe(true);
    const windows = new Set(calls.map(u => `${u.searchParams.get('from')}..${u.searchParams.get('to')}`));
    expect(windows.size).toBeGreaterThanOrEqual(3);
    for (const w of windows) {
      const [a, b] = w.split('..').map(d => Date.parse(d));
      expect((b - a) / 86_400_000).toBeLessThanOrEqual(30);
    }
  });

  test('a never-ending page chain fails closed', async () => {
    fetchMock.mockImplementation(async (url) => (String(url).startsWith('https://zoom.us/oauth') ? tokenRes()
      : jsonRes({ meetings: [], next_page_token: 'again' })));
    const error = await rejection(listHostRecordings('h@x.org', { from: new Date('2026-10-01'), to: new Date('2026-10-08') }));
    expect(error.code).toBe('zoom_unavailable');
  });
});

describe('getMeetingRecordings', () => {
  test('double-encodes UUIDs containing a slash, single-encodes others', async () => {
    expect(encodeMeetingUuid('/abc==')).toBe('%252Fabc%253D%253D');
    expect(encodeMeetingUuid('ab//c')).toBe('ab%252F%252Fc');
    expect(encodeMeetingUuid('abc/def==')).toBe('abc%252Fdef%253D%253D');
    fetchMock.mockImplementation(async (url) => (String(url).startsWith('https://zoom.us/oauth') ? tokenRes() : jsonRes({ host_id: 'h' })));
    await getMeetingRecordings('/abc==');
    expect(fetchMock.mock.calls.at(-1)[0]).toBe('https://api.zoom.us/v2/meetings/%252Fabc%253D%253D/recordings');
  });

  test('rejects control characters and over-long uuids before any request', async () => {
    for (const bad of ['a\nb', 'x'.repeat(201), '', 5]) expect((await rejection(getMeetingRecordings(bad))).code).toBe('zoom_not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('Zoom error 4711 maps to zoom_scope_missing and the message never carries Zoom text', async () => {
    fetchMock.mockImplementation(async (url) => (String(url).startsWith('https://zoom.us/oauth') ? tokenRes()
      : jsonRes({ code: 4711, message: `scope missing ${TOKEN} https://ssrweb.zoom.us/download/x` }, 401)));
    const error = await rejection(getMeetingRecordings('uuid'));
    expect(error.code).toBe('zoom_scope_missing');
    expect(error.message).toBe('zoom_scope_missing');
    expectNoLeak(error);
  });

  test.each([[404, 'zoom_not_found'], [429, 'zoom_rate_limited'], [500, 'zoom_unavailable'], [401, 'zoom_auth_failed']])(
    'HTTP %i maps to %s', async (status, code) => {
      fetchMock.mockImplementation(async (url) => (String(url).startsWith('https://zoom.us/oauth') ? tokenRes() : jsonRes({}, status)));
      expect((await rejection(getMeetingRecordings('uuid'))).code).toBe(code);
    });
});

describe('downloadRecordingFile', () => {
  const START = 'https://us02web.zoom.us/rec/download/abc';
  const opts = { maxBytes: 1000, expectedBytes: 5 };
  function route(handler) {
    fetchMock.mockImplementation(async (url, init) => (String(url).startsWith('https://zoom.us/oauth') ? tokenRes() : handler(String(url), init)));
  }
  const downloads = () => fetchMock.mock.calls.filter(([url]) => !String(url).startsWith('https://zoom.us/oauth'));

  test('follows zoom redirects manually, sends the bearer only on the first request, returns the bytes', async () => {
    route((url) => (url === START ? redirect('https://ssrweb.zoom.us/file/x') : streamRes(['he', 'llo'])));
    const buffer = await downloadRecordingFile(START, opts);
    expect(buffer.toString()).toBe('hello');
    const [first, second] = downloads();
    expect(first[1].redirect).toBe('manual');
    expect(first[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(second[1].headers.Authorization).toBeUndefined();
  });

  test('rejects a redirect to a non-zoom host before fetching it', async () => {
    route((url) => (url === START ? redirect('https://evil.example.com/steal') : streamRes(['hello'])));
    const error = await rejection(downloadRecordingFile(START, opts));
    expect(error.code).toBe('zoom_download_invalid');
    expect(downloads().map(([u]) => u)).toEqual([START]);
    expectNoLeak(error);
  });

  test.each([
    ['look-alike suffix host', 'https://evilzoom.us/x'],
    ['zoom.us.evil.com', 'https://zoom.us.evil.com/x'],
    ['http scheme', 'http://ssrweb.zoom.us/x'],
    ['non-443 port', 'https://ssrweb.zoom.us:8443/x'],
    ['URL credentials', 'https://user:pw@ssrweb.zoom.us/x'],
  ])('rejects a redirect to %s', async (_label, target) => {
    route((url) => (url === START ? redirect(target) : streamRes(['hello'])));
    expect((await rejection(downloadRecordingFile(START, opts))).code).toBe('zoom_download_invalid');
    expect(downloads()).toHaveLength(1);
  });

  test('rejects a non-zoom starting URL without fetching it', async () => {
    route(() => streamRes(['hello']));
    expect((await rejection(downloadRecordingFile('https://evil.example.com/x', opts))).code).toBe('zoom_download_invalid');
    expect(downloads()).toHaveLength(0);
  });

  test('allows exactly five redirects and rejects the sixth', async () => {
    let n = 0;
    route(() => redirect(`https://a${n += 1}.zoom.us/x`));
    expect((await rejection(downloadRecordingFile(START, opts))).code).toBe('zoom_download_invalid');
    expect(downloads()).toHaveLength(6);
  });

  test('rejects an HTML 200 (the unauthenticated sign-in page)', async () => {
    route(() => streamRes(['hello'], { type: 'text/html; charset=utf-8' }));
    expect((await rejection(downloadRecordingFile(START, opts))).code).toBe('zoom_download_invalid');
  });

  test('stops reading once the body exceeds maxBytes', async () => {
    route(() => streamRes(['aaaa', 'bbbb', 'cccc']));
    expect((await rejection(downloadRecordingFile(START, { maxBytes: 6, expectedBytes: 5 }))).code).toBe('zoom_download_invalid');
  });

  test('rejects a declared content-length over maxBytes without reading', async () => {
    route(() => streamRes(['hello'], { extra: { 'content-length': '5000' } }));
    expect((await rejection(downloadRecordingFile(START, opts))).code).toBe('zoom_download_invalid');
  });

  test.each([['short', ['hell']], ['long', ['hello!']]])('rejects a %s body whose byte count differs from expectedBytes', async (_l, chunks) => {
    route(() => streamRes(chunks));
    expect((await rejection(downloadRecordingFile(START, opts))).code).toBe('zoom_download_invalid');
  });

  test('refuses invalid size limits (fail closed)', async () => {
    route(() => streamRes(['hello']));
    for (const bad of [{ maxBytes: 10, expectedBytes: 11 }, { maxBytes: 10, expectedBytes: 0 }, { maxBytes: 10 }, { expectedBytes: 5 }]) {
      expect((await rejection(downloadRecordingFile(START, bad))).code).toBe('zoom_download_invalid');
    }
  });

  test('a failed download never carries the URL or token in the error', async () => {
    route(() => jsonRes({ message: `denied ${START}` }, 500));
    const error = await rejection(downloadRecordingFile(START, opts));
    expect(error.code).toBe('zoom_unavailable');
    expect(error.message).toBe('zoom_unavailable');
    expectNoLeak(error);
  });

  test('a network failure becomes zoom_unavailable without the cause', async () => {
    route(() => { throw new Error(`connect ECONNRESET ${START}`); });
    const error = await rejection(downloadRecordingFile(START, opts));
    expect(error.code).toBe('zoom_unavailable');
    expect(error.message).not.toContain('ECONNRESET');
  });
});

describe('resolveRecordingDownloadUrl', () => {
  const START = 'https://us02web.zoom.us/rec/download/abc';
  const FINAL = 'https://ssrweb.zoom.us/file/x?token=t';
  const calls = () => fetchMock.mock.calls;
  const ranged = (status, extra = {}) => ({ ok: status >= 200 && status < 300, status, headers: headers(extra), json: async () => ({}), body: null });

  test('follows redirects manually, bearer on hop 0 only, Range on every hop, returns the 206 URL', async () => {
    fetchMock.mockImplementation(async (url) => (String(url) === START ? redirect('https://us02web.zoom.us/hop2') : String(url).endsWith('/hop2') ? redirect(FINAL) : ranged(206)));
    expect(await resolveRecordingDownloadUrl(START, { bearer: TOKEN, deadlineMs: Date.now() + 60_000 })).toBe(FINAL);
    expect(calls()).toHaveLength(3);
    calls().forEach(([, init], i) => {
      expect(init.redirect).toBe('manual');
      expect(init.headers.Range).toBe('bytes=0-0');
      if (i === 0) expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      else expect(init.headers.Authorization).toBeUndefined();
    });
  });

  test('a 200 to the ranged request is terminal zoom_range_unsupported', async () => {
    fetchMock.mockResolvedValue(ranged(200));
    const error = await rejection(resolveRecordingDownloadUrl(START, { bearer: TOKEN }));
    expect(error.code).toBe('zoom_range_unsupported');
    expectNoLeak(error);
  });

  test.each([
    ['non-zoom host', 'https://evil.example.com/steal'],
    ['http scheme', 'http://ssrweb.zoom.us/x'],
    ['non-443 port', 'https://ssrweb.zoom.us:8443/x'],
    ['URL credentials', 'https://user:pw@ssrweb.zoom.us/x'],
  ])('rejects a redirect to %s before fetching it', async (_label, target) => {
    fetchMock.mockImplementation(async (url) => (String(url) === START ? redirect(target) : ranged(206)));
    expect((await rejection(resolveRecordingDownloadUrl(START, { bearer: TOKEN }))).code).toBe('zoom_download_invalid');
    expect(calls()).toHaveLength(1);
  });

  test('rejects a non-zoom starting URL without fetching, and a sixth redirect', async () => {
    expect((await rejection(resolveRecordingDownloadUrl('https://evil.example.com/x', { bearer: TOKEN }))).code).toBe('zoom_download_invalid');
    expect(calls()).toHaveLength(0);
    let n = 0;
    fetchMock.mockImplementation(async () => redirect(`https://a${n += 1}.zoom.us/x`));
    expect((await rejection(resolveRecordingDownloadUrl(START, { bearer: TOKEN }))).code).toBe('zoom_download_invalid');
    expect(calls()).toHaveLength(6);
  });

  test('a failure on a hop maps through mapFailure', async () => {
    fetchMock.mockResolvedValue(jsonRes({}, 404));
    expect((await rejection(resolveRecordingDownloadUrl(START, { bearer: TOKEN }))).code).toBe('zoom_not_found');
  });

  test('a deadline shorter than the 30 s budget wins; an exhausted deadline sends nothing', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(ranged(206));
    await resolveRecordingDownloadUrl(START, { bearer: TOKEN, deadlineMs: Date.now() + 5_000 });
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(5_000);
    timeout.mockClear();
    await resolveRecordingDownloadUrl(START, { bearer: TOKEN });
    expect(timeout.mock.calls[0][0]).toBeGreaterThan(5_000);
    fetchMock.mockClear();
    expect((await rejection(resolveRecordingDownloadUrl(START, { bearer: TOKEN, deadlineMs: Date.now() - 1 }))).code).toBe('zoom_unavailable');
    expect(calls()).toHaveLength(0);
    timeout.mockRestore();
  });
});

describe('fetchRecordingRange', () => {
  const URL_ = 'https://ssrweb.zoom.us/file/x?token=t';
  const range = { start: 10, end: 14, total: 100 };
  const ok = (body = ['hello'], extra = {}) => streamRes(body, { status: 206, type: 'video/mp4', extra: { 'content-range': 'bytes 10-14/100', ...extra } });

  test('returns the bytes with no bearer and the exact Range header', async () => {
    fetchMock.mockResolvedValue(ok(['he', 'llo']));
    const out = await fetchRecordingRange(URL_, { ...range, deadlineMs: Date.now() + 60_000 });
    expect(out.status).toBe(206);
    expect(out.bytes.toString()).toBe('hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init.headers).toEqual({ Range: 'bytes=10-14' });
    expect(init.redirect).toBe('manual');
  });

  test('a 200 to a ranged request is terminal zoom_range_unsupported', async () => {
    fetchMock.mockResolvedValue(streamRes(['hello'], { status: 200, type: 'video/mp4' }));
    expect((await rejection(fetchRecordingRange(URL_, range))).code).toBe('zoom_range_unsupported');
  });

  test.each([
    ['wrong Content-Range', ok(['hello'], { 'content-range': 'bytes 10-14/101' })],
    ['missing Content-Range', streamRes(['hello'], { status: 206, type: 'video/mp4' })],
    ['short body', ok(['hell'])],
    ['long body', ok(['hello!'])],
    ['text/html', streamRes(['hello'], { status: 206, type: 'text/html', extra: { 'content-range': 'bytes 10-14/100' } })],
  ])('rejects %s', async (_label, res) => {
    fetchMock.mockResolvedValue(res);
    const error = await rejection(fetchRecordingRange(URL_, range));
    expect(error.code).toBe('zoom_download_invalid');
    expectNoLeak(error);
  });

  test('rejects a redirect (never followed) and a non-zoom URL without fetching', async () => {
    fetchMock.mockResolvedValue(redirect('https://evil.example.com/steal'));
    expect((await rejection(fetchRecordingRange(URL_, range))).code).toBe('zoom_download_invalid');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    expect((await rejection(fetchRecordingRange('https://evil.example.com/x', range))).code).toBe('zoom_download_invalid');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test.each([401, 403, 404, 410])('%i is returned as a raw status for the caller to re-resolve', async (status) => {
    fetchMock.mockResolvedValue(jsonRes({ code: 4711 }, status));
    expect(await fetchRecordingRange(URL_, range)).toEqual({ bytes: null, status });
  });

  test.each([[429, 'zoom_rate_limited'], [500, 'zoom_unavailable'], [400, 'zoom_download_invalid']])('HTTP %i throws %s', async (status, code) => {
    fetchMock.mockResolvedValue(jsonRes({}, status));
    expect((await rejection(fetchRecordingRange(URL_, range))).code).toBe(code);
  });

  test('refuses invalid ranges and a network failure becomes zoom_unavailable', async () => {
    for (const bad of [{ start: -1, end: 4, total: 10 }, { start: 5, end: 4, total: 10 }, { start: 0, end: 10, total: 10 }, { start: 0, end: 1.5, total: 10 }, {}]) {
      expect((await rejection(fetchRecordingRange(URL_, bad))).code).toBe('zoom_download_invalid');
    }
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValue(new Error(`ECONNRESET ${URL_}`));
    expect((await rejection(fetchRecordingRange(URL_, range))).code).toBe('zoom_unavailable');
  });

  test('a deadline shorter than the 45 s budget wins; an exhausted deadline sends nothing', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue(ok());
    await fetchRecordingRange(URL_, { ...range, deadlineMs: Date.now() + 7_000 });
    expect(timeout.mock.calls[0][0]).toBeLessThanOrEqual(7_000);
    timeout.mockClear();
    fetchMock.mockResolvedValue(ok());
    await fetchRecordingRange(URL_, range);
    expect(timeout.mock.calls[0][0]).toBe(45_000);
    fetchMock.mockClear();
    expect((await rejection(fetchRecordingRange(URL_, { ...range, deadlineMs: Date.now() - 1 }))).code).toBe('zoom_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  test('the new codes carry HTTP statuses', () => {
    expect(new ZoomClientError('zoom_range_unsupported').httpStatus).toBe(502);
    expect(new ZoomClientError('zoom_download_denied').httpStatus).toBe(502);
  });
});


describe('attendance report pagination', () => {
  const participant = { name: 'Synthetic Person', status: 'in_meeting', join_time: '2026-10-09T16:00:00Z', leave_time: '2026-10-09T16:01:00Z', duration: 60, user_email: 'discard@example.test', user_id: 'discard' };
  test('uses report endpoint, encoded frozen occurrence, page size 300, and strips identity fields', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValueOnce(jsonRes({ participants: [participant], total_records: 2, next_page_token: 'next' }))
      .mockResolvedValueOnce(jsonRes({ participants: [participant], total_records: 2, next_page_token: '' }));
    const result = await getMeetingAttendance('/occurrence//==');
    expect(result.status).toBe('complete');
    expect(result.participants).toHaveLength(2);
    expect(result.participants[0]).not.toHaveProperty('user_email');
    expect(result.participants[0]).not.toHaveProperty('user_id');
    expect(fetchMock.mock.calls[1][0]).toContain('/v2/report/meetings/%252Foccurrence%252F%252F%253D%253D/participants?page_size=300');
    expect(fetchMock.mock.calls[2][0]).toContain('next_page_token=next');
  });
  test('marks truncated pages and count mismatch partial and bounds repeated tokens', async () => {
    fetchMock.mockResolvedValueOnce(tokenRes()).mockResolvedValue(jsonRes({ participants: [participant], total_records: 10, next_page_token: 'repeat' }));
    expect((await getMeetingAttendance('occurrence')).status).toBe('partial');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    fetchMock.mockResolvedValue(jsonRes({ participants: [participant], total_records: 2, next_page_token: '' }));
    expect((await getMeetingAttendance('occurrence')).status).toBe('partial');
  });
});
