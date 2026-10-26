/**
 * report-request-file-multi-library.mjs — OFFLINE. Lists Research requests
 * whose files sit in more than one SharePoint library (`akoya_request`, shown
 * as "Request" in SharePoint, and RequestArchive1–3), from the CSVs written by
 * probe-request-file-inventory.mjs. For cleaning up requests left with two
 * document locations after the GMS migration. Reads local CSVs only; prints no
 * filenames (they can name people).
 *
 *   node scripts/report-request-file-multi-library.mjs --in=<inventory dir> [--out=<csv outside the repo>]
 *
 * Per request: files per library, whether each library was reached through a
 * Dynamics document location or only by probing the archive's standard folder,
 * and how many filenames appear in more than one library (likely copies).
 * Test requests are left out; runs are de-duplicated on request_id and item_id.
 */

import fs from 'fs';
import path from 'path';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const IN = arg('in');
const OUT = arg('out');
if (!IN) { console.error('--in=<inventory directory> is required'); process.exit(2); }
if (OUT && path.resolve(OUT).startsWith(process.cwd() + path.sep)) { console.error('--out must be outside the repo'); process.exit(2); }

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
const seenItems = new Set();
const filesByRequest = new Map();
for (const run of fs.readdirSync(IN, { withFileTypes: true }).filter((d) => d.isDirectory())) {
  const dir = path.join(IN, run.name);
  if (!fs.existsSync(path.join(dir, 'files.csv'))) continue;
  for (const r of parseCsv(fs.readFileSync(path.join(dir, 'requests.csv'), 'utf8'))) requests.set(r.request_id, r);
  for (const f of parseCsv(fs.readFileSync(path.join(dir, 'files.csv'), 'utf8'))) {
    const key = `${f.request_id}|${f.item_id}`;
    if (seenItems.has(key)) continue;
    seenItems.add(key);
    if (!filesByRequest.has(f.request_id)) filesByRequest.set(f.request_id, []);
    filesByRequest.get(f.request_id).push(f);
  }
}

const out = [];
for (const [requestId, files] of filesByRequest) {
  const req = requests.get(requestId);
  if (!req || req.is_test === 'true') continue;
  const libs = new Map();
  for (const f of files) {
    const l = libs.get(f.library) || { files: 0, sources: new Set(), names: new Set() };
    l.files += 1; l.sources.add(f.source); l.names.add(f.name.toLowerCase());
    libs.set(f.library, l);
  }
  if (libs.size < 2) continue;
  const nameCounts = new Map();
  for (const l of libs.values()) for (const n of l.names) nameCounts.set(n, (nameCounts.get(n) || 0) + 1);
  out.push({
    request_num: req.request_num,
    meeting_year: String(req.meeting_date || '').slice(0, 4),
    created_year: String(req.created_on || '').slice(0, 4),
    status: req.status,
    libraries: [...libs.keys()].sort().join(' + '),
    files_by_library: [...libs].sort().map(([k, v]) => `${k}:${v.files} (${[...v.sources].sort().join('/')})`).join('; '),
    total_files: files.length,
    names_in_both: [...nameCounts.values()].filter((n) => n > 1).length,
  });
}
out.sort((a, b) => a.meeting_year.localeCompare(b.meeting_year) || String(a.request_num).localeCompare(String(b.request_num)));

const byPair = new Map();
const byYear = new Map();
for (const r of out) {
  byPair.set(r.libraries, (byPair.get(r.libraries) || 0) + 1);
  const y = r.meeting_year || 'none';
  byYear.set(y, (byYear.get(y) || 0) + 1);
}
console.log(`${out.length} non-test requests have files in more than one library (of ${filesByRequest.size} requests with files).`);
console.log('\nBy library combination:');
for (const [k, v] of [...byPair].sort((a, b) => b[1] - a[1])) console.log(`  ${v}\t${k}`);
console.log('\nBy meeting year:');
for (const [k, v] of [...byYear].sort()) console.log(`  ${k}\t${v}`);
console.log(`\n${out.filter((r) => r.names_in_both > 0).length} of them share at least one filename across libraries (likely copies).`);

if (OUT) {
  const cols = Object.keys(out[0] || { request_num: '' });
  const esc = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  fs.writeFileSync(OUT, [cols.join(','), ...out.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
  console.log(`Wrote ${out.length} rows to ${OUT}`);
}
