/**
 * probe-request-file-inventory.mjs — READ-ONLY, listing only (no downloads).
 * Inventories the SharePoint files attached to Research requests
 * (RESEARCH_PROGRAM_IDS: S&E and Medical Research; all statuses) created in a
 * window, newest first, across each request's buckets:
 * Dynamics-tracked folders plus the RequestArchive1/2/3 libraries. It is the
 * baseline for a derived, legible file layer; it changes nothing.
 *
 *   node scripts/probe-request-file-inventory.mjs --out-dir=<dir outside the repo> \
 *     [--from=2026-01-01] [--to=2026-12-31] [--by=created|meeting] [--limit=25]
 *
 * --by=meeting windows on wmkf_meetingdate instead of createdon: use it for
 * history, where migrated rows may carry the migration date as createdon (and
 * note it skips requests with no meeting date).
 *
 * Writes <out-dir>/files.csv (one row per file) and <out-dir>/requests.csv (one
 * row per request, with its test-request flag and any listing error), appended
 * as it goes, then prints a
 * summary: requests/files by year, extensions, subfolders and filename shapes.
 *
 * Unlike probe-research-proposal-file-inventory.mjs, a listing problem is never
 * read as "no files": only a missing archive folder is expected; truncation,
 * depth limits, throttling, auth errors and an unresolvable parent library
 * (instead of the helper's silent akoya_request fallback) are recorded per request.
 * Known gaps: listFiles does not select createdDateTime/createdBy, and the
 * request query stops at the 5,000-row cap (narrow the window if it trips).
 *
 * Filenames can include people's names: keep the output out of the repo.
 */

import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const OUT_DIR = arg('out-dir');
if (!OUT_DIR) { console.error('--out-dir=<directory outside the repo> is required'); process.exit(2); }
if (path.resolve(OUT_DIR).startsWith(process.cwd() + path.sep)) { console.error('--out-dir must be outside the repo'); process.exit(2); }
const FROM = arg('from') || '2026-01-01';
const TO = arg('to') || '2026-12-31';
const BY = arg('by') === 'meeting' ? 'wmkf_meetingdate' : 'createdon';
const windowFilter = BY === 'createdon'
  ? `createdon ge ${FROM}T00:00:00Z and createdon le ${TO}T23:59:59Z`
  : `wmkf_meetingdate ge ${FROM} and wmkf_meetingdate le ${TO}`;
const LIMIT = arg('limit') ? Number(arg('limit')) : null;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { RESEARCH_PROGRAM_IDS } = await import('../shared/config/researchPrograms.js');
enterDynamicsBypassForScript('probe-request-file-inventory');

const LIST_OPTIONS = { recursive: true, maxDepth: 8, maxFiles: 5000, failOnTruncation: true, failOnDepthLimit: true, totalTimeoutMs: 180_000 };
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn(); } catch (err) {
      if (!TRANSIENT.has(err.status) || attempt >= 4) throw err;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    }
  }
}

async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row cap; narrow --from/--to.`); process.exit(1); }
  return result.records;
}

const PROGRAM_LABELS = { [RESEARCH_PROGRAM_IDS[0]]: 'S&E', [RESEARCH_PROGRAM_IDS[1]]: 'MR' };

let requests = await readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,createdon,wmkf_meetingdate,akoya_requeststatus,_akoya_programid_value,wmkf_istestrequest',
  filter: `(${RESEARCH_PROGRAM_IDS.map((id) => `_akoya_programid_value eq ${id}`).join(' or ')}) and ${windowFilter}`,
});
requests.sort((a, b) => String(b[BY]).localeCompare(String(a[BY])));
if (LIMIT) requests = requests.slice(0, LIMIT);
console.log(`\n${requests.length} Research requests with ${BY} ${FROM}..${TO}${LIMIT ? ` (limit ${LIMIT})` : ''}.\n`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const filesPath = path.join(OUT_DIR, 'files.csv');
const requestsPath = path.join(OUT_DIR, 'requests.csv');
fs.writeFileSync(filesPath, 'request_id,request_num,year,library,source,subfolder,name,extension,size,last_modified,mime_type,item_id\n');
fs.writeFileSync(requestsPath, 'request_id,request_num,created_on,meeting_date,status,program,is_test,libraries,file_count,total_bytes,error\n');

const stats = { byYear: {}, ext: {}, subfolder: {}, shape: {}, errors: 0, empty: 0, tests: 0 };
const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };
const shapeOf = (name, requestNum) => name
  .replace(new RegExp(String(requestNum), 'g'), '{REQ}')
  .replace(/[0-9A-F]{32}/gi, '{GUID}')
  .replace(/\d+/g, '#')
  .toLowerCase();

const started = Date.now();
let n = 0;
for (const r of requests) {
  n += 1;
  const year = String(r[BY] || '').slice(0, 4);
  const libraries = new Set();
  const errors = [];
  let fileCount = 0;
  let totalBytes = 0;
  const lines = [];
  try {
    const buckets = await withRetry(() => getRequestSharePointBuckets(r.akoya_requestid, r.akoya_requestnum, { requireCompleteResults: true, requireResolvedParents: true }));
    for (const b of buckets) {
      let listed;
      try {
        listed = await withRetry(() => GraphService.listFiles(b.library, b.folder, LIST_OPTIONS));
      } catch (err) {
        if (err.code === 'graph_folder_not_found' && b.source === 'archive') continue;
        errors.push(`${b.library}: ${String(err.message || err).slice(0, 160)}`);
        continue;
      }
      if (listed.length) libraries.add(b.library);
      for (const f of listed) {
        const sub = f.folder === b.folder ? '' : f.folder.slice(b.folder.length + 1);
        const ext = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
        fileCount += 1;
        totalBytes += f.size || 0;
        bump(stats.ext, ext || '(none)');
        bump(stats.subfolder, sub ? sub.replace(/\d+/g, '#') : '(root)');
        bump(stats.shape, shapeOf(f.name, r.akoya_requestnum));
        lines.push([r.akoya_requestid, r.akoya_requestnum, year, b.library, b.source, sub, f.name, ext, f.size, f.lastModified, f.mimeType, f.id].map(esc).join(','));
      }
    }
  } catch (err) {
    errors.push(`buckets: ${String(err.message || err).slice(0, 160)}`);
  }
  if (lines.length) fs.appendFileSync(filesPath, `${lines.join('\n')}\n`);
  fs.appendFileSync(requestsPath, `${[r.akoya_requestid, r.akoya_requestnum, r.createdon, r.wmkf_meetingdate, r.akoya_requeststatus, PROGRAM_LABELS[String(r._akoya_programid_value).toLowerCase()] || '', r.wmkf_istestrequest === true ? 'yes' : '', [...libraries].join(' '), fileCount, totalBytes, errors.join(' | ')].map(esc).join(',')}\n`);
  const y = (stats.byYear[year] ||= { requests: 0, files: 0, bytes: 0, empty: 0, errors: 0 });
  y.requests += 1; y.files += fileCount; y.bytes += totalBytes;
  if (r.wmkf_istestrequest === true) stats.tests += 1;
  if (errors.length) { y.errors += 1; stats.errors += 1; } else if (!fileCount) { y.empty += 1; stats.empty += 1; }
  if (n % 25 === 0) console.log(`  ${n}/${requests.length}  (${Math.round((Date.now() - started) / 1000)}s)`);
}

const top = (map, k) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, k);
console.log(`\nBy ${BY} year: requests, files, GB, requests with no files, requests with listing errors`);
for (const [y, s] of Object.entries(stats.byYear).sort()) {
  console.log(`  ${y}  ${String(s.requests).padStart(6)}  ${String(s.files).padStart(7)}  ${(s.bytes / 1e9).toFixed(2).padStart(7)}  ${String(s.empty).padStart(5)}  ${String(s.errors).padStart(5)}`);
}
console.log('\nExtensions:'); for (const [k, v] of top(stats.ext, 20)) console.log(`  ${String(v).padStart(7)}  ${k}`);
console.log('\nSubfolders (digits as #):'); for (const [k, v] of top(stats.subfolder, 25)) console.log(`  ${String(v).padStart(7)}  ${k}`);
console.log('\nFilename shapes (request number {REQ}, digits #):'); for (const [k, v] of top(stats.shape, 40)) console.log(`  ${String(v).padStart(7)}  ${k}`);
console.log(`\nRequests with listing errors: ${stats.errors}; with no files: ${stats.empty}; flagged test requests: ${stats.tests}; elapsed ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`Wrote ${filesPath}\nWrote ${requestsPath}\n`);
