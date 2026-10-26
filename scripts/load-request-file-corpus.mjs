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
 * request's existing rows. --resume reuses a run id and skips requests already
 * listed in it. --reclassify recomputes labels from stored names after the
 * filename rules change, without listing SharePoint. One load at a time
 * (Postgres advisory lock).
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
const counts = { requestsOk: 0, requestsError: 0, filesSeen: 0 };
const errors = [];
const owner = new Map(); // drive|item -> request id, within this run
let status = 'failed';
try {
  await store.startRun(client, { runId, scope: { from: FROM, to: TO, limit: LIMIT }, rulesVersion: RULES_VERSION });
  const done = RESUME ? await store.listedInRun(client, runId) : new Set();
  console.log(`Run ${runId} (${RULES_VERSION})${done.size ? `; resuming, ${done.size} requests already listed` : ''}.`);
  const started = Date.now();
  let n = 0;
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
      const clash = listing.files.find((f) => owner.has(`${f.driveId}|${f.itemId}`) && owner.get(`${f.driveId}|${f.itemId}`) !== request.requestId);
      if (clash) failure = `file ${clash.itemId} also listed under request ${owner.get(`${clash.driveId}|${clash.itemId}`)} in this run`;
    }
    if (failure) {
      await store.saveRequestError(client, { request, error: failure, runId });
      counts.requestsError += 1;
      errors.push({ requestNum: String(request.requestNum), error: failure.slice(0, 300) });
    } else {
      for (const f of listing.files) owner.set(`${f.driveId}|${f.itemId}`, request.requestId);
      await store.saveRequestListing(client, { request, files: listing.files, runId, rulesVersion: RULES_VERSION });
      counts.requestsOk += 1;
      counts.filesSeen += listing.files.length;
    }
    if (n % 25 === 0) console.log(`  ${n}/${work.length} requests, ${counts.filesSeen} files, ${counts.requestsError} errors (${Math.round((Date.now() - started) / 1000)}s)`);
  }
  status = 'completed';
} finally {
  await store.finishRun(client, { runId, status, counts, errors }).catch((e) => console.error(`Could not finish run row: ${e.message}`));
  await client.end();
}
console.log(`\nRun ${runId} ${status}: ${counts.requestsOk} requests listed, ${counts.filesSeen} files, ${counts.requestsError} errors.`);
for (const e of errors.slice(0, 20)) console.log(`  ${e.requestNum}: ${e.error}`);
if (errors.length > 20) console.log(`  … ${errors.length - 20} more in request_corpus_runs.errors`);
