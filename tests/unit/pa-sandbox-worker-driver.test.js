/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, BASE, JOB } = require('../../scripts/run-pa-sandbox-worker.cjs');
const config = () => ({ baseUrl: BASE, jobId: JOB, serverBudgetMs: 300000, budgetVerified: true,
  cronSecret: 'test-cron-credential-not-real', statusToken: 'test-status-credential-not-real', cookie: '_vercel_jwt=test-cookie-not-real' });
const view = (done = false) => ({ job: { jobId: JOB, version: 16, state: done ? 'succeeded' : 'running',
  pollAfterSeconds: done ? null : 5, tasks: [{ taskKey: 'preflight.short-title', generationState: done ? 'validated' : 'queued',
    writebackState: done ? 'applied' : 'pending', errorCode: null }] } });
const response = body => ({ status: 200, json: async () => body });
let dir, lockPath, deps;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-driver-test-')); lockPath = path.join(dir, 'receipt');
  deps = { execute: true, lockPath, now: () => Date.parse('2026-11-13T00:00:00Z'), sleep: jest.fn(async () => {}) };
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
test('default is network-free dry run without receipt', async () => {
  const fetchImpl = jest.fn();
  expect((await run(config(), { ...deps, execute: false, fetchImpl })).state).toBe('dry_run');
  expect(fetchImpl).not.toHaveBeenCalled(); expect(fs.existsSync(lockPath)).toBe(false);
});
test('completed fixture performs GET only and retains private restart guard', async () => {
  const fetchImpl = jest.fn(async () => response(view(true)));
  expect(await run(config(), { ...deps, fetchImpl })).toMatchObject({ state: 'succeeded', ticks: 0 });
  expect(fetchImpl).toHaveBeenCalledTimes(1); expect(fetchImpl.mock.calls[0][1].method).toBe('GET');
  expect(fs.statSync(lockPath).mode & 0o777).toBe(0o600);
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow('driver_receipt_exists');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('awaits each POST and verifies final status, separating auth credentials', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(view())).mockImplementationOnce(() => pending)
    .mockResolvedValueOnce(response(view(true)));
  const work = run(config(), { ...deps, fetchImpl });
  await new Promise(resolve => setImmediate(resolve));
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fs.readFileSync(lockPath, 'utf8')).toContain('tick_intent');
  release(response({ stage: 'published' }));
  expect((await work).ticks).toBe(1);
  expect(fetchImpl.mock.calls.map(x => x[1].method)).toEqual(['GET', 'POST', 'GET']);
  expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe(`Bearer ${config().statusToken}`);
  expect(fetchImpl.mock.calls[1][1].headers.authorization).toBe(`Bearer ${config().cronSecret}`);
  expect(fetchImpl.mock.calls.every(x => x[1].redirect === 'manual')).toBe(true);
});
test.each(['network', 'non200', 'invalid-json', 'unknown-stage'])('stops without retry on POST %s', async kind => {
  const fetchImpl = jest.fn().mockResolvedValueOnce(response(view())).mockImplementationOnce(async () => {
    if (kind === 'network') throw new Error('SECRET_TRANSPORT_DETAIL');
    if (kind === 'non200') return { status: 503 };
    if (kind === 'invalid-json') return { status: 200, json: async () => { throw new Error('SECRET_BODY'); } };
    return response({ stage: 'unknown' });
  });
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow(/uncertain|operator/);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(fs.readFileSync(lockPath, 'utf8')).not.toMatch(/SECRET|credential|cookie/);
});
test.each(['wrong-job', 'needs-attention', 'missing-task', 'false-success'])('status %s prevents POST', async kind => {
  const body = view(kind === 'false-success');
  if (kind === 'wrong-job') body.job.jobId = '00000000-0000-4000-8000-000000000000';
  if (kind === 'needs-attention') body.job.state = 'needs_attention';
  if (kind === 'missing-task') body.job.tasks = [];
  if (kind === 'false-success') body.job.tasks[0].writebackState = 'unknown';
  const fetchImpl = jest.fn(async () => response(body));
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test('tick cap stops repeated progress without admitting another job', async () => {
  const fetchImpl = jest.fn(async (_url, options) => response(options.method === 'GET' ? view() : { stage: 'validated' }));
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow('tick_budget');
  expect(fetchImpl.mock.calls.filter(x => x[1].method === 'POST')).toHaveLength(8);
});
test('elapsed budget reserves full request time; expiry makes no request', async () => {
  let clock = deps.now();
  const fetchImpl = jest.fn(async () => { clock += 310001; return response(view()); });
  await expect(run(config(), { ...deps, now: () => clock, fetchImpl })).rejects.toThrow('time_budget');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
test.each([{ baseUrl: 'https://example.com' }, { budgetVerified: false }, { serverBudgetMs: 0 }, { cookie: '_vercel_jwt=bad\r\nvalue' }])('invalid pins/budget/headers never reach network %j', async change => {
  const fetchImpl = jest.fn(); await expect(run({ ...config(), ...change }, { ...deps, fetchImpl })).rejects.toThrow();
  expect(fetchImpl).not.toHaveBeenCalled();
});
test('concurrent invocation cannot bypass retained user receipt', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const fetchImpl = jest.fn(() => pending);
  const first = run(config(), { ...deps, fetchImpl });
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow('driver_receipt_exists');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  release(response(view(true))); await first;
});
test('expired window refuses all network and creates no receipt', async () => {
  const fetchImpl = jest.fn();
  await expect(run(config(), { ...deps, now: () => Date.parse('2026-11-19T00:00:00Z'), fetchImpl })).rejects.toThrow('window_expired');
  expect(fetchImpl).not.toHaveBeenCalled(); expect(fs.existsSync(lockPath)).toBe(false);
});
test('HTTP status failure never proceeds to worker', async () => {
  const fetchImpl = jest.fn(async () => ({ status: 302 }));
  await expect(run(config(), { ...deps, fetchImpl })).rejects.toThrow('uncertain');
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});
