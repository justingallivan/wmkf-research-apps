/**
 * probe-research-proposal-docs-coverage.mjs — READ-ONLY feasibility probe for
 * recovering co-PIs (and their institutions) on older Research awards from
 * the proposal documents in SharePoint.
 *
 * Dataverse records no co-PIs on awarded Research requests before 2024, so
 * any recovery has to come from documents. Per sampled awarded Research
 * request (same scope as probe-research-pi-orcid-coverage.mjs) this:
 *   1. resolves its SharePoint buckets (Dynamics-tracked folders plus the
 *      RequestArchive1/2/3 libraries that hold migrated content) via
 *      getRequestSharePointBuckets, and lists files recursively;
 *   2. picks proposal-like documents (filename hints, else the largest PDFs);
 *   3. downloads up to --docs per request and measures extractable text per
 *      PDF page: text (>= 200 chars/page), scan (< 50), or mixed — so the
 *      year where applications switch from scans to text PDFs shows up;
 *   4. counts co-PI / co-investigator mentions and keeps a short snippet.
 *
 * Reads only: Dataverse (requests, document locations) and Microsoft Graph
 * (SharePoint listing and downloads). Downloads stay in memory.
 *
 *   node scripts/probe-research-proposal-docs-coverage.mjs --out=<csv> [--per-year=6] [--docs=3] [--from=2016-10-19]
 *
 * The CSV names files and quotes short snippets that can include people's
 * names: keep it out of the repo.
 */

import fs from 'fs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const OUT = arg('out');
if (!OUT) { console.error('--out=<csv path outside the repo> is required'); process.exit(2); }
const PER_YEAR = Number(arg('per-year') || 6);
const DOCS = Number(arg('docs') || 3);
const FROM = arg('from') || '2016-10-19';
const MAX_BYTES = 40 * 1024 * 1024;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { extractTextFromBuffer } = await import('../lib/utils/file-loader.js');
const { default: pdf } = await import('pdf-parse');
enterDynamicsBypassForScript('probe-research-proposal-docs-coverage');

const AWARDED = ['Approved', 'Active', 'Closed'];
const PROPOSAL_HINT = /proposal|application|phase\s*(i{1,2}|1|2)\b|narrative|full|submission|concept/i;
const COPI = /co-?\s?principal\s+investigator|co-?\s?investigator|\bco-?PIs?\b/gi;

// queryAllRecords stops at MAX_EXPORT_RECORDS (5,000); a truncated count would be wrong.
async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap.`); process.exit(1); }
  return result.records;
}

// 1. Awarded Research requests in the window, sampled evenly per meeting year.
const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
  ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
const requests = await readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate,createdon',
  filter: `(${research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ')}) and (${AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ')}) and wmkf_meetingdate ge ${FROM}`,
});
const byYear = new Map();
for (const r of requests) {
  const y = (r.wmkf_meetingdate || '').slice(0, 4);
  byYear.set(y, [...(byYear.get(y) || []), r]);
}
const sample = [];
for (const [y, list] of [...byYear.entries()].sort()) {
  list.sort((a, b) => String(a.akoya_requestnum).localeCompare(String(b.akoya_requestnum)));
  const step = Math.max(1, list.length / PER_YEAR);
  for (let k = 0; k < Math.min(PER_YEAR, list.length); k++) sample.push({ year: y, total: list.length, ...list[Math.floor(k * step)] });
}
console.log(`\n${requests.length} awarded Research requests since ${FROM}; sampling ${sample.length} (up to ${PER_YEAR}/year).\n`);

// 2–4. Per request: buckets → files → proposal-like docs → text density and co-PI mentions.
const driveIds = new Map();
async function driveId(library) {
  if (!driveIds.has(library)) driveIds.set(library, await GraphService.getDriveId(library));
  return driveIds.get(library);
}
const rows = [];
for (const r of sample) {
  const row = { year: r.year, requestNum: r.akoya_requestnum, buckets: '', files: 0, pdfs: 0, picked: [], error: '' };
  try {
    const buckets = await getRequestSharePointBuckets(r.akoya_requestid, r.akoya_requestnum);
    const files = [];
    const found = [];
    for (const b of buckets) {
      try {
        const listed = await GraphService.listFiles(b.library, b.folder, { recursive: true });
        if (listed.length) found.push(`${b.library}(${b.source}):${listed.length}`);
        for (const f of listed) files.push({ ...f, library: b.library });
      } catch { /* archive buckets are speculative; a miss is expected */ }
    }
    row.buckets = found.join(' ');
    row.files = files.length;
    const docs = files.filter((f) => /\.(pdf|docx?)$/i.test(f.name));
    row.pdfs = docs.filter((f) => /\.pdf$/i.test(f.name)).length;
    const hinted = docs.filter((f) => PROPOSAL_HINT.test(f.name));
    const pick = (hinted.length ? hinted : docs).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, DOCS);
    for (const f of pick) {
      const doc = { name: f.name, library: f.library, sizeKb: Math.round((f.size || 0) / 1024), pages: '', charsPerPage: '', kind: '', copi: 0, snippet: '' };
      try {
        if ((f.size || 0) > MAX_BYTES) { doc.kind = 'skipped-large'; row.picked.push(doc); continue; }
        const { buffer } = await GraphService.downloadFile(await driveId(f.library), f.id, { maxBytes: MAX_BYTES });
        let text = '';
        if (/\.pdf$/i.test(f.name)) {
          const parsed = await pdf(buffer);
          text = parsed.text || '';
          doc.pages = parsed.numpages || 0;
          const per = doc.pages ? Math.round(text.replace(/\s+/g, '').length / doc.pages) : 0;
          doc.charsPerPage = per;
          doc.kind = per >= 200 ? 'text' : per < 50 ? 'scan' : 'mixed';
        } else {
          text = await extractTextFromBuffer(buffer, f.name, f.mimeType);
          doc.kind = 'word';
        }
        const matches = [...text.matchAll(COPI)];
        doc.copi = matches.length;
        if (matches.length) {
          const at = matches[0].index;
          doc.snippet = text.slice(Math.max(0, at - 40), at + 160).replace(/\s+/g, ' ').trim();
        }
      } catch (err) { doc.kind = `error: ${String(err.message || err).slice(0, 80)}`; }
      row.picked.push(doc);
    }
  } catch (err) { row.error = String(err.message || err).slice(0, 150); }
  rows.push(row);
  const best = row.picked.map((d) => `${d.kind}${d.copi ? `/copi:${d.copi}` : ''}`).join(',');
  console.log(`  ${r.year} ${r.akoya_requestnum}: files ${row.files}, docs checked ${row.picked.length} [${best}]${row.error ? ` ERROR ${row.error}` : ''}`);
}

// Summary by meeting year.
console.log('\nBy meeting year (sampled requests):');
console.log('  year  sampled  any-files  text-doc  scan-only  co-PI-mentioned');
for (const y of [...new Set(rows.map((r) => r.year))].sort()) {
  const ys = rows.filter((r) => r.year === y);
  const hasText = (r) => r.picked.some((d) => d.kind === 'text' || d.kind === 'word' || d.kind === 'mixed');
  const scanOnly = (r) => r.picked.length && r.picked.every((d) => d.kind === 'scan');
  console.log(`  ${y}  ${String(ys.length).padStart(7)}  ${String(ys.filter((r) => r.files).length).padStart(9)}  ${String(ys.filter(hasText).length).padStart(8)}  ${String(ys.filter(scanOnly).length).padStart(9)}  ${String(ys.filter((r) => r.picked.some((d) => d.copi)).length).padStart(15)}`);
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const lines = ['year,request_num,files,pdfs,buckets,doc,library,size_kb,pages,chars_per_page,kind,copi_mentions,snippet,error'];
for (const r of rows) {
  const docs = r.picked.length ? r.picked : [{}];
  for (const d of docs) lines.push([r.year, r.requestNum, r.files, r.pdfs, r.buckets, d.name, d.library, d.sizeKb, d.pages, d.charsPerPage, d.kind, d.copi, d.snippet, r.error].map(esc).join(','));
}
fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`\nWrote ${OUT}\n`);
