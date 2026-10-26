/**
 * pilot-request-file-content.mjs — content pilot for the Research request file
 * corpus (docs/plans/RESEARCH_REQUEST_FILE_CORPUS_PLAN_2026-10-25.md, owner
 * decision 2). Downloads and extracts text for a small past-weighted sample of
 * requests so the plan's assumptions (conversion, scanned PDFs, templates,
 * missed Read documents behind filename rules) can be measured. Never writes to
 * SharePoint or Dataverse; makes no model calls.
 *
 *   node scripts/pilot-request-file-content.mjs --in=<inventory dir> --out-dir=<dir outside the repo> [--plan]
 *     [--years=2018,2019,2021] [--recent=0]
 *
 * --plan is OFFLINE: it selects the sample from the inventory CSVs (see
 * report-request-file-rule-coverage.mjs), writes sample.csv and prints the
 * bound. Without --plan it also downloads from Production SharePoint through
 * GraphService (no Dataverse access) and writes, appending so a rerun resumes:
 *   manifest.csv  one row per selected file: rule result, method, outcome, chars
 *   heads.csv     the first ~400 normalized characters of each extracted text
 *   text/<item_id>.txt  extracted text (named by Graph item id; filenames can
 *                 include people's names and stay in the manifest only)
 *
 * Sample: non-test requests with files and no listing error; 10 each with a
 * meeting year of 1995, 2005, 2012, 2017 and 2020, and 5 with a meeting date
 * from 2025 on, taken at an even stride through request numbers. --years
 * replaces the meeting years and --recent the recent count (the held-out
 * 2018–2021 sample, owner-approved 2026-10-25, uses --years=2018,2019,2021
 * --recent=0). Every file of
 * a sampled request is pulled (not just rule-matched Read files, so the pilot
 * can measure what the rules missed) except PowerPoint, which is deferred, up
 * to 40 files per request and 25 MB per file; each skip is recorded.
 *
 * Routing: .pdf and .docx download as-is (pdf-parse, mammoth); .doc, .rtf,
 * .xls and .xlsx convert through Graph ?format=pdf (convertibility is what the
 * pilot measures); .txt reads as UTF-8; .htm/.html strip tags locally.
 */

import fs from 'fs';
import path from 'path';
import { classifyByFilename } from '../lib/services/request-file-corpus/filename-rules.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const IN = arg('in');
const OUT_DIR = arg('out-dir');
const PLAN_ONLY = process.argv.includes('--plan');
if (!IN || !OUT_DIR) { console.error('--in=<inventory dir> and --out-dir=<dir outside the repo> are required'); process.exit(2); }
if (path.resolve(OUT_DIR).startsWith(process.cwd() + path.sep)) { console.error('--out-dir must be outside the repo'); process.exit(2); }

const YEARS = arg('years') ? arg('years').split(',') : ['1995', '2005', '2012', '2017', '2020'];
const PER_YEAR = 10;
const RECENT_FROM = '2025-01-01';
const RECENT_COUNT = arg('recent') !== undefined ? Number(arg('recent')) : 5;
if (YEARS.some((y) => !/^\d{4}$/.test(y)) || !Number.isInteger(RECENT_COUNT) || RECENT_COUNT < 0) { console.error('--years takes four-digit years; --recent a whole number'); process.exit(2); }
const MAX_FILES_PER_REQUEST = 40;
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const HEAD_CHARS = 400;
const PRIORITY_ORDER = ['read', 'uncertain', 'type-only', 'already-legible'];

function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.filter((r) => r.length === header.length).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const requests = new Map();
const filesByRequest = new Map();
for (const run of fs.readdirSync(IN).filter((d) => fs.existsSync(path.join(IN, d, 'files.csv')))) {
  for (const r of parseCsv(fs.readFileSync(path.join(IN, run, 'requests.csv'), 'utf8'))) requests.set(r.request_id, r);
  for (const f of parseCsv(fs.readFileSync(path.join(IN, run, 'files.csv'), 'utf8'))) {
    const list = filesByRequest.get(f.request_id) || new Map();
    list.set(f.item_id, f);
    filesByRequest.set(f.request_id, list);
  }
}

const eligible = [...requests.values()].filter((r) => r.is_test !== 'yes' && !r.error && filesByRequest.get(r.request_id)?.size);
const stride = (list, k) => {
  const sorted = [...list].sort((a, b) => Number(a.request_num) - Number(b.request_num));
  if (sorted.length <= k) return sorted;
  return Array.from({ length: k }, (_, i) => sorted[Math.floor((i * sorted.length) / k)]);
};
const sample = [
  ...YEARS.flatMap((y) => stride(eligible.filter((r) => (r.meeting_date || '').startsWith(y)), PER_YEAR).map((r) => ({ ...r, cohort: y }))),
  ...(RECENT_COUNT ? stride(eligible.filter((r) => (r.meeting_date || '') >= RECENT_FROM), RECENT_COUNT).map((r) => ({ ...r, cohort: 'recent' })) : []),
];

const extOf = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const METHOD = { pdf: 'download-pdf', docx: 'download-docx', doc: 'graph-pdf', rtf: 'graph-pdf', xls: 'graph-pdf', xlsx: 'graph-pdf', txt: 'download-txt', htm: 'download-html', html: 'download-html' };

const selected = [];
for (const r of sample) {
  const files = [...filesByRequest.get(r.request_id).values()]
    .map((f) => ({ f, rule: classifyByFilename({ name: f.name, subfolder: f.subfolder }) }))
    .sort((a, b) => PRIORITY_ORDER.indexOf(a.rule.priority) - PRIORITY_ORDER.indexOf(b.rule.priority) || a.f.name.localeCompare(b.f.name));
  let taken = 0;
  for (const { f, rule } of files) {
    const ext = extOf(f.name);
    let skip = '';
    if (rule.priority === 'deferred') skip = 'deferred';
    else if (!METHOD[ext]) skip = 'unsupported-extension';
    else if (Number(f.size) > MAX_BYTES) skip = 'over-size-cap';
    else if (taken >= MAX_FILES_PER_REQUEST) skip = 'over-request-cap';
    if (!skip) taken += 1;
    selected.push({ r, f, rule, ext, method: skip ? '' : METHOD[ext], skip });
  }
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
fs.writeFileSync(path.join(OUT_DIR, 'sample.csv'), [
  'cohort,request_num,meeting_date,status,program,file_count,method',
  ...sample.map((r) => [r.cohort, r.request_num, r.meeting_date, r.status, r.program, r.file_count, `even stride by request_num, ${r.cohort === 'recent' ? `${RECENT_COUNT} from meeting >= ${RECENT_FROM}` : `${PER_YEAR} per meeting year`}`].map(esc).join(',')),
].join('\n') + '\n');

const toPull = selected.filter((s) => !s.skip);
const bump = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };
const plan = {};
for (const s of selected) {
  const p = (plan[s.r.cohort] ||= { requests: new Set(), pull: 0, bytes: 0, skips: {} });
  p.requests.add(s.r.request_num);
  if (s.skip) bump(p.skips, s.skip); else { p.pull += 1; p.bytes += Number(s.f.size) || 0; }
}
console.log(`\nSample: ${sample.length} requests, ${toPull.length} files to pull (${(toPull.reduce((t, s) => t + (Number(s.f.size) || 0), 0) / 1e6).toFixed(0)} MB).`);
for (const [cohort, p] of Object.entries(plan)) {
  console.log(`  ${cohort.padEnd(7)} ${String(p.requests.size).padStart(3)} requests  ${String(p.pull).padStart(4)} files  ${(p.bytes / 1e6).toFixed(0).padStart(5)} MB  skips: ${Object.entries(p.skips).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`);
}
for (const y of [...YEARS, ...(RECENT_COUNT ? ['recent'] : [])]) if (!plan[y]) console.log(`  ${y}: no eligible requests`);
if (PLAN_ONLY) { console.log(`\nWrote ${path.join(OUT_DIR, 'sample.csv')} (plan only; nothing downloaded).`); process.exit(0); }

// ---- download and extract (Production SharePoint, read-only) ----
try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const { GraphService } = await import('../lib/services/graph-service.js');
const { default: pdf } = await import('pdf-parse');
const { default: mammoth } = await import('mammoth');

const TRANSIENT = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function withRetry(fn) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn(); } catch (err) {
      if (!TRANSIENT.has(err.status) || attempt >= 4) throw err;
      await sleep(Math.min(30_000, 2_000 * 2 ** attempt));
    }
  }
}
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timed out`)), ms)),
]);

const driveIds = new Map();
const driveIdOf = async (library) => {
  if (!driveIds.has(library)) driveIds.set(library, await withRetry(() => GraphService.getDriveId(library)));
  return driveIds.get(library);
};

const decodeEntities = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
async function extract(s) {
  const driveId = await driveIdOf(s.f.library);
  if (s.method === 'graph-pdf') {
    const buffer = await withRetry(() => GraphService.downloadFileAsPdf(driveId, s.f.item_id, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS }));
    const data = await withTimeout(pdf(buffer), 60_000, 'pdf-parse');
    return { text: data.text || '', pages: data.numpages, bytes: buffer.length };
  }
  const { buffer } = await withRetry(() => GraphService.downloadFile(driveId, s.f.item_id, { maxBytes: MAX_BYTES }));
  if (s.method === 'download-pdf') {
    const data = await withTimeout(pdf(buffer), 60_000, 'pdf-parse');
    return { text: data.text || '', pages: data.numpages, bytes: buffer.length };
  }
  if (s.method === 'download-docx') {
    const result = await withTimeout(mammoth.extractRawText({ buffer }), 60_000, 'mammoth');
    return { text: result.value || '', pages: '', bytes: buffer.length };
  }
  const raw = buffer.toString('utf8');
  if (s.method === 'download-html') {
    return { text: decodeEntities(raw.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')), pages: '', bytes: buffer.length };
  }
  return { text: raw, pages: '', bytes: buffer.length };
}

const outcomeOf = (text, pages) => {
  const chars = text.replace(/\s+/g, '').length;
  if (!chars) return 'empty';
  if (pages && chars / pages < 100) return 'sparse-text';
  return 'ok';
};

const manifestPath = path.join(OUT_DIR, 'manifest.csv');
const headsPath = path.join(OUT_DIR, 'heads.csv');
fs.mkdirSync(path.join(OUT_DIR, 'text'), { recursive: true });
const done = new Set();
if (fs.existsSync(manifestPath)) {
  for (const row of parseCsv(fs.readFileSync(manifestPath, 'utf8'))) if (row.outcome !== 'error') done.add(row.item_id);
} else {
  fs.writeFileSync(manifestPath, 'cohort,request_num,item_id,library,subfolder,name,ext,size,rule_type,rule_priority,rule_id,method,outcome,pages,chars,error\n');
  fs.writeFileSync(headsPath, 'cohort,request_num,item_id,rule_type,rule_priority,outcome,head\n');
}

const tally = {};
let n = 0;
const started = Date.now();
for (const s of selected) {
  if (done.has(s.f.item_id)) continue;
  n += 1;
  let outcome = s.skip || '';
  let pages = '';
  let chars = '';
  let error = '';
  let text = '';
  if (!s.skip) {
    try {
      ({ text, pages } = await extract(s));
      text = text.replace(/\u0000/g, '');
      chars = text.length;
      outcome = outcomeOf(text, pages);
      fs.writeFileSync(path.join(OUT_DIR, 'text', `${s.f.item_id}.txt`), text);
      const head = text.replace(/\s+/g, ' ').trim().slice(0, HEAD_CHARS);
      fs.appendFileSync(headsPath, [s.r.cohort, s.r.request_num, s.f.item_id, s.rule.type, s.rule.priority, outcome, head].map(esc).join(',') + '\n');
    } catch (err) {
      outcome = 'error';
      error = `${err.status || ''} ${String(err.message || err)}`.trim().slice(0, 200);
    }
  }
  fs.appendFileSync(manifestPath, [s.r.cohort, s.r.request_num, s.f.item_id, s.f.library, s.f.subfolder, s.f.name, s.ext, s.f.size, s.rule.type, s.rule.priority, s.rule.ruleId, s.method, outcome, pages, chars, error].map(esc).join(',') + '\n');
  bump((tally[s.r.cohort] ||= {}), `${s.rule.priority}:${outcome}`);
  if (n % 25 === 0) console.log(`  ${n} files processed (${Math.round((Date.now() - started) / 1000)}s)`);
}

console.log(`\nProcessed ${n} files in ${Math.round((Date.now() - started) / 1000)}s (earlier runs' rows skipped).`);
for (const [cohort, t] of Object.entries(tally)) {
  console.log(`  ${cohort.padEnd(7)} ${Object.entries(t).sort().map(([k, v]) => `${k} ${v}`).join(', ')}`);
}
console.log(`\nWrote ${manifestPath}, ${headsPath} and text/ under ${OUT_DIR}.`);
