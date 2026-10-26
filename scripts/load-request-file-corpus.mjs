/**
 * load-request-file-corpus.mjs — OWNER-RUN. Fills the Research request file
 * corpus index (migration 090) from a fresh strict listing:
 * docs/plans/RESEARCH_REQUEST_FILE_CORPUS_INDEX_BUILD_PLAN_2026-10-25.md.
 * Reads Production Dataverse (needs DATAVERSE_ALLOW_PROD_READS=yes) and
 * SharePoint through Graph; writes only the request_corpus_* tables in the
 * database POSTGRES_URL names (printed by hostname before anything is written).
 * Never writes SharePoint or Dataverse.
 *
 *   node scripts/load-request-file-corpus.mjs --plan [--from=2018] [--to=2026]
 *   node scripts/load-request-file-corpus.mjs [--from=2018] [--to=2026] [--limit=N] [--resume=<run id>]
 *   node scripts/load-request-file-corpus.mjs --reclassify
 *
 * --plan reads Dataverse only and prints request counts per meeting year; it
 * does not touch Graph or Postgres. A load lists each request newest meeting
 * year first and saves it in its own transaction; a listing error keeps that
 * request's existing rows. --resume reuses a run id (it stops unless --from,
 * --to, --limit and the filename rules match the run) and skips requests
 * already listed in it; run totals are recomputed from the stored rows, and
 * the same-run duplicate-file check reads stored rows too. --reclassify
 * recomputes labels from stored names after the filename rules change,
 * without listing SharePoint. One load at a time (Postgres advisory lock).
 */

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const PLAN = process.argv.includes('--plan');
const RECLASSIFY = process.argv.includes('--reclassify');
const FROM = Number(arg('from') || 2018);
const TO = Number(arg('to') || new Date().getUTCFullYear());
const LIMIT = arg('limit') ? Number(arg('limit')) : null;
const RESUME = arg('resume') || null;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!Number.isInteger(FROM) || !Number.isInteger(TO) || FROM < 2018 || TO < FROM) {
  console.error('--from/--to are meeting years, 2018 or later (earlier years are parked).'); process.exit(2);
}
if (LIMIT !== null && (!Number.isInteger(LIMIT) || LIMIT < 1)) { console.error('--limit must be a positive whole number'); process.exit(2); }
if (RESUME && !GUID.test(RESUME)) { console.error('--resume takes a run id (UUID)'); process.exit(2); }

const rulesPath = path.resolve('lib/services/request-file-corpus/filename-rules.js');
const RULES_VERSION = `filename-rules:${crypto.createHash('sha256').update(fs.readFileSync(rulesPath)).digest('hex').slice(0, 12)}`;

const { default: pg } = await import('pg');
const store = await import('../lib/services/request-file-corpus/index-store.js');

async function connect() {
  const url = process.env.POSTGRES_URL;
  if (!url) { console.error('POSTGRES_URL is not set.'); process.exit(2); }
  console.log(`Postgres target: ${new URL(url).hostname}`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS locked', [store.LOCK_KEY]);
  if (!rows[0].locked) { console.error('Another corpus load holds the lock; stopping.'); await client.end(); process.exit(1); }
  return client;
}

if (RECLASSIFY) {
  const client = await connect();
  try {
    const updated = await store.reclassify(client, RULES_VERSION);
    console.log(`Reclassified ${updated} file rows to ${RULES_VERSION}.`);
  } finally { await client.end(); }
  process.exit(0);
}

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { RESEARCH_PROGRAM_IDS } = await import('../shared/config/researchPrograms.js');
const { listRequestFiles } = await import('../lib/services/request-file-corpus/listing.js');
enterDynamicsBypassForScript('load-request-file-corpus');

const PROGRAM_LABELS = { [RESEARCH_PROGRAM_IDS[0].toLowerCase()]: 'S&E', [RESEARCH_PROGRAM_IDS[1].toLowerCase()]: 'MR' };
const programFilter = `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')})`;

const requests = [];
for (let year = TO; year >= FROM; year -= 1) {
  const result = await DynamicsService.queryAllRecords('akoya_requests', {
    select: 'akoya_requestid,akoya_requestnum,createdon,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,wmkf_istestrequest',
    filter: `${programFilter} and wmkf_meetingdate ge ${year}-01-01 and wmkf_meetingdate le ${year}-12-31`,
  });
  if (result.capped) { console.error(`Meeting year ${year} hit the 5,000-row cap; stopping.`); process.exit(1); }
  const rows = result.records.sort((a, b) => String(b.wmkf_meetingdate).localeCompare(String(a.wmkf_meetingdate)));
  console.log(`  ${year}: ${rows.length} requests (${rows.filter((r) => r.wmkf_istestrequest === true).length} test)`);
  requests.push(...rows);
}
console.log(`${requests.length} Research requests with meeting years ${FROM}–${TO}.`);
if (PLAN) { console.log('Plan only: nothing listed or written.'); process.exit(0); }

const work = LIMIT ? requests.slice(0, LIMIT) : requests;
const client = await connect();
const runId = RESUME || crypto.randomUUID();
let status = 'failed';
let totals = null;
try {
  await store.startRun(client, { runId, scope: { from: FROM, to: TO, limit: LIMIT }, rulesVersion: RULES_VERSION, resume: Boolean(RESUME) });
  const done = RESUME ? await store.listedInRun(client, runId) : new Set();
  console.log(`Run ${runId} (${RULES_VERSION})${done.size ? `; resuming, ${done.size} requests already listed` : ''}.`);
  const started = Date.now();
  let n = 0;
  let listed = 0;
  let files = 0;
  let failed = 0;
  for (const r of work) {
    n += 1;
    if (done.has(r.akoya_requestid)) continue;
    const request = {
      requestId: r.akoya_requestid,
      requestNum: r.akoya_requestnum,
      program: PROGRAM_LABELS[String(r._akoya_programid_value).toLowerCase()] || 'other',
      meetingDate: r.wmkf_meetingdate || null,
      createdOn: r.createdon || null,
      status: r.akoya_requeststatus ?? null,
      isTest: r.wmkf_istestrequest === true,
    };
    const listing = await listRequestFiles({ requestId: request.requestId, requestNum: request.requestNum });
    let failure = listing.error;
    if (!failure) {
      const saved = await store.saveRequestListing(client, { request, files: listing.files, runId, rulesVersion: RULES_VERSION });
      failure = saved.conflict;
      if (!failure) { listed += 1; files += listing.files.length; }
    }
    if (failure) {
      await store.saveRequestError(client, { request, error: failure, runId });
      failed += 1;
    }
    if (n % 25 === 0) console.log(`  ${n}/${work.length} requests: ${listed} listed, ${files} files, ${failed} errors this invocation (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  status = 'completed';
} finally {
  totals = await store.finishRun(client, { runId, status }).catch((e) => { console.error(`Could not finish run row: ${e.message}`); return null; });
  await client.end();
}
if (totals) {
  console.log(`\nRun ${runId} ${status} (whole run): ${totals.requests_ok} requests listed, ${totals.files_seen} files, ${totals.requests_error} errors.`);
  for (const e of totals.errors.slice(0, 20)) console.log(`  ${e.requestNum}: ${e.error}`);
  if (totals.errors.length > 20) console.log(`  … ${totals.errors.length - 20} more in request_corpus_runs.errors`);
}
