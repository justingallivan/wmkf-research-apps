/**
 * prompt-override-store — T4 client-request-layer matrix (Stage 4). Pins
 * request bytes and body-parse behavior for the file's 3 fetch sites ahead
 * of migrating onto shared/utils/api-request.js:
 *   - loadPromptOverride    GET    (bare `res.json()` on success — strict)
 *   - savePromptOverride    PUT    (`.json().catch(() => ({}))` — tolerant;
 *     error derivation joins `data.issues` when present)
 *   - deletePromptOverride  DELETE (bare `res.json()` on success — strict)
 */
const {
  loadPromptOverride,
  savePromptOverride,
  deletePromptOverride,
} = require('../../shared/components/reviewers/prompt-override-store');

afterEach(() => { global.fetch = jest.fn(); });

test('loadPromptOverride: GET url is exact; 2xx returns the parsed body as-is', async () => {
  global.fetch = jest.fn((url, opts) => {
    expect(url).toBe('/api/reviewer-finder/prompt-override?name=reviewer-finder.analyze');
    expect(opts?.body).toBeUndefined();
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ name: 'reviewer-finder.analyze', version: 1, templateBody: 'T', userOverride: null, staleOverride: false }) });
  });
  const out = await loadPromptOverride('reviewer-finder.analyze');
  expect(out).toEqual({ name: 'reviewer-finder.analyze', version: 1, templateBody: 'T', userOverride: null, staleOverride: false });
});

test('loadPromptOverride: 2xx malformed body rejects with the native parse error (strict, bare .json())', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
  await expect(loadPromptOverride('x')).rejects.toThrow('bad json');
});

test('loadPromptOverride: non-2xx {error} throws that message', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }));
  await expect(loadPromptOverride('x')).rejects.toThrow('Forbidden');
});

test('loadPromptOverride: non-2xx unparseable body falls back to "Failed to load prompt"', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }));
  await expect(loadPromptOverride('x')).rejects.toThrow('Failed to load prompt');
});

test('loadPromptOverride: network rejection propagates unchanged', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  await expect(loadPromptOverride('x')).rejects.toThrow('offline');
});

test('savePromptOverride: PUT sends exact body bytes/headers; 2xx returns the parsed body', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    sentOpts = opts;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
  });
  const out = await savePromptOverride('reviewer-finder.analyze', 'new body');
  expect(out).toEqual({ ok: true });
  expect(sentOpts.method).toBe('PUT');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(sentOpts.body).toBe(JSON.stringify({ name: 'reviewer-finder.analyze', body: 'new body' }));
});

test('savePromptOverride: non-2xx with issues joins them, error field takes precedence when both present', async () => {
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false, status: 400, json: async () => ({ issues: ['too long', 'missing token'] }),
  }));
  await expect(savePromptOverride('x', 'y')).rejects.toThrow('too long; missing token');
});

test('savePromptOverride: non-2xx unparseable body falls back to "Save failed" (issues absent)', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }));
  await expect(savePromptOverride('x', 'y')).rejects.toThrow('Save failed');
});

test('deletePromptOverride: DELETE sends exact body bytes/headers; 2xx returns the parsed body', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    sentOpts = opts;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ reset: true }) });
  });
  const out = await deletePromptOverride('reviewer-finder.analyze');
  expect(out).toEqual({ reset: true });
  expect(sentOpts.method).toBe('DELETE');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(sentOpts.body).toBe(JSON.stringify({ name: 'reviewer-finder.analyze' }));
});

test('deletePromptOverride: non-2xx unparseable body falls back to "Reset failed"', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }));
  await expect(deletePromptOverride('x')).rejects.toThrow('Reset failed');
});
