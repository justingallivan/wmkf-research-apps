#!/usr/bin/env node
/** Operator-only bounded driver. Dry-run unless --execute; no admission or credential issuance.
 * Pins the existing Preview and job. A different trial requires reviewed pin changes.
 * Run --help for the private config shape. Never give worker credentials to flow owners.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const BASE = 'https://wmkfresearchapps-n7hku44p8-justin-gallivans-projects.vercel.app';
const JOB = '7e68cdfe-4dda-47f1-9163-7a3dc4b517f5';
const CUTOFF = Date.parse('2026-11-18T19:30:00Z');
const PROGRESS = new Set(['snapshot_saved', 'target_captured', 'validated', 'audit_delivered', 'published', 'succeeded']);
const LOCK = path.join(os.homedir(), '.wmkf-pa-worker-n7hku44p8.receipt');
function fail(code) { throw new Error(code); }
function validate(config) {
  if (!config || config.baseUrl !== BASE || config.jobId !== JOB
    || !Number.isInteger(config.serverBudgetMs) || config.serverBudgetMs < 1000 || config.serverBudgetMs > 300000
    || config.budgetVerified !== true) fail('invalid_driver_config');
  for (const key of ['cronSecret', 'statusToken', 'cookie']) {
    if (typeof config[key] !== 'string' || config[key].length < 20 || /[\r\n]/.test(config[key])) fail('invalid_driver_credentials');
  }
  if (!/^_vercel_jwt=[^;\s]+$/.test(config.cookie)) fail('invalid_driver_cookie');
  return Object.freeze({ ...config });
}
function inspect(body) {
  const job = body?.job;
  if (!job || job.jobId !== JOB || !Number.isSafeInteger(job.version) || job.version < 1
    || !Array.isArray(job.tasks) || job.tasks.length !== 1
    || job.tasks[0].taskKey !== 'preflight.short-title') fail('unexpected_job_status');
  const task = job.tasks[0];
  if (job.state === 'succeeded' && job.pollAfterSeconds === null
    && task.generationState === 'validated' && task.writebackState === 'applied' && task.errorCode === null) return 'succeeded';
  if (!['queued', 'running'].includes(job.state) || job.pollAfterSeconds !== 5
    || !['queued', 'dispatching', 'response_saved', 'validated'].includes(task.generationState)
    || task.writebackState !== 'pending' || task.errorCode !== null) fail('job_requires_operator');
  return 'active';
}
async function run(config, { execute = false, fetchImpl = global.fetch, now = Date.now,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), lockPath = LOCK } = {}) {
  const c = validate(config);
  if (!execute) return { state: 'dry_run', jobId: JOB, maxTicks: 8, maxElapsedMs: 600000 };
  const started = now();
  const end = Math.min(started + 600000, CUTOFF);
  if (end <= started) fail('driver_window_expired');
  // Retained even after success or a crash. An operator must diagnose before removing.
  // A single deterministic path prevents cooperating processes in this user account overlapping.
  let fd;
  try { fd = fs.openSync(lockPath, 'wx', 0o600); }
  catch { fail('driver_receipt_exists_or_unavailable'); }
  let ticks = 0;
  const record = (state) => {
    fs.writeSync(fd, `${JSON.stringify({ at: new Date(now()).toISOString(), jobId: JOB, ticks, state })}\n`);
    fs.fsyncSync(fd);
  };
  async function request(route, method, token) {
    const timeout = c.serverBudgetMs + 10000;
    if (now() + timeout > end) fail('driver_time_budget_exhausted');
    let response, body;
    try {
      response = await fetchImpl(`${BASE}${route}`, { method, redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, cookie: c.cookie }, signal: AbortSignal.timeout(timeout) });
      if (response.status !== 200) fail('http_failure');
      body = await response.json();
    } catch { fail('transport_or_response_uncertain'); }
    if (now() >= end) fail('driver_time_budget_exhausted');
    return body;
  }
  const status = async () => inspect(await request(`/api/automation/prompt-jobs/${JOB}`, 'GET', c.statusToken));
  try {
    record('started');
    while (true) {
      if (await status() === 'succeeded') { record('succeeded'); return { state: 'succeeded', jobId: JOB, ticks }; }
      if (ticks >= 8) fail('driver_tick_budget_exhausted');
      // Write and flush intent before every physical POST. Lost responses stop, never retry.
      ticks += 1;
      record('tick_intent');
      const result = await request('/api/cron/drain-machine-prompt-jobs', 'POST', c.cronSecret);
      if (!result || Object.keys(result).length !== 1 || !PROGRESS.has(result.stage)) fail('worker_requires_operator');
      record(result.stage);
      await sleep(5000);
      // Always verify status after publication; an HTTP 200 or stage alone isn't success.
    }
  } catch (error) {
    // Emit fixed codes only; never serialize response bodies or transport errors.
    const safe = new Set(['driver_time_budget_exhausted', 'driver_tick_budget_exhausted',
      'unexpected_job_status', 'job_requires_operator', 'transport_or_response_uncertain', 'worker_requires_operator']);
    const code = safe.has(error?.message) ? error.message : 'driver_failed';
    try { record(code); } catch { /* Existing receipt still prevents a blind restart. */ }
    fail(code);
  } finally { fs.closeSync(fd); }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/run-pa-sandbox-worker.cjs PRIVATE_CONFIG.json [--execute]\nDefault: dry-run (no network). Private JSON: baseUrl, jobId, serverBudgetMs, budgetVerified:true, cronSecret, statusToken, cookie. Budget must be verified from deployed configuration. Live execution needs separate approval. Retained receipt: ' + LOCK);
    return;
  }
  if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--execute')) fail('invalid_arguments');
  let config;
  try {
    const info = fs.lstatSync(args[0]);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid()) fail('private_file_required');
    config = JSON.parse(fs.readFileSync(args[0], 'utf8'));
  } catch { fail('private_config_unavailable'); }
  console.log(JSON.stringify(await run(config, { execute: args[1] === '--execute' })));
}
module.exports = { run, validate, inspect, BASE, JOB };
if (require.main === module) main().catch(() => {
  console.error('Worker driver stopped. Inspect the local receipt; do not retry after an uncertain outcome.');
  process.exitCode = 1;
});
