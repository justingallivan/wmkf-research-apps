/**
 * probe-research-biosketch-pilot.mjs — READ-ONLY pilot for recovering co-PIs
 * and their institutions from biosketches on older Research awards.
 *
 * Reads the inventory CSV from probe-research-proposal-file-inventory.mjs,
 * picks a small spread of biosketch files (default: up to 2 per meeting year
 * 2018–2023 with exactly one biosketch-like file preferred) plus compiled
 * proposals from the 2017 text-PDF cycles, downloads each in memory, extracts
 * text, and writes one .txt per document to --out-dir, with a summary of
 * which biosketch format headings appear (NIH, NSF, other) and how many
 * person sections each file seems to contain.
 *
 * Reads only: Dataverse (request lookup, document locations) and Microsoft
 * Graph (SharePoint listing and downloads).
 *
 *   node scripts/probe-research-biosketch-pilot.mjs --inventory=<csv> --out-dir=<folder> [--per-year=2] [--proposals=2]
 *
 * The output folder holds full document text, including people's names and
 * employment histories: keep it out of the repo.
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
const INVENTORY = arg('inventory');
const OUT_DIR = arg('out-dir');
if (!INVENTORY || !OUT_DIR) { console.error('--inventory=<csv> and --out-dir=<folder outside the repo> are required'); process.exit(2); }
const PER_YEAR = Number(arg('per-year') || 2);
const PROPOSALS = Number(arg('proposals') || 2);
const MAX_BYTES = 40 * 1024 * 1024;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { extractTextFromBuffer } = await import('../lib/utils/file-loader.js');
const { default: pdf } = await import('pdf-parse');
const odata = await import('../lib/dataverse/core/odata.js');
enterDynamicsBypassForScript('probe-research-biosketch-pilot');

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])));
}

// Pick the sample: biosketch files for 2018–2023, compiled proposals for 2017.
const inv = parseCsv(fs.readFileSync(INVENTORY, 'utf8'));
const picks = [];
for (const y of ['2018', '2019', '2020', '2021', '2022', '2023']) {
  const withBio = inv.filter((r) => r.year === y && r.biosketch_files)
    .sort((a, b) => (a.biosketch_files.split(' | ').length - b.biosketch_files.split(' | ').length) || a.request_num.localeCompare(b.request_num));
  const step = Math.max(1, Math.floor(withBio.length / PER_YEAR));
  for (let k = 0; k < PER_YEAR && k * step < withBio.length; k++) {
    const r = withBio[k * step];
    picks.push({ year: y, requestNum: r.request_num, file: r.biosketch_files.split(' | ')[0], kind: 'biosketch' });
  }
}
const proposals2017 = inv.filter((r) => r.year === '2017' && r.proposal_files && r.cycle >= '2017-06').slice(0, PROPOSALS);
for (const r of proposals2017) picks.push({ year: r.year, requestNum: r.request_num, file: r.proposal_files.split(' | ')[0], kind: 'compiled-proposal' });
console.log(`\nPilot sample: ${picks.length} documents.\n`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const FORMATS = [
  ['NIH', /eRA\s+COMMONS|POSITION\s+TITLE|Personal\s+Statement/i],
  ['NSF', /Professional\s+Preparation|Appointments|Synergistic\s+Activities/i],
  ['generic', /Biographical\s+Sketch|Curriculum\s+Vitae|\bEducation\b/i],
];
const driveIds = new Map();
const summary = [];
for (const p of picks) {
  const rec = { ...p, pages: '', chars: 0, formats: '', sections: 0, error: '' };
  try {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum',
      filter: odata.eq('akoya_requestnum', p.requestNum),
      top: 2,
    });
    if (records.length !== 1) throw new Error(`request ${p.requestNum} lookup returned ${records.length} rows`);
    const buckets = await getRequestSharePointBuckets(records[0].akoya_requestid, p.requestNum);
    let file = null;
    for (const b of buckets) {
      let listed = [];
      try { listed = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch { continue; }
      const hit = listed.find((f) => f.name === p.file);
      if (hit) { file = { ...hit, library: b.library }; break; }
    }
    if (!file) throw new Error('file not found in buckets');
    if (!driveIds.has(file.library)) driveIds.set(file.library, await GraphService.getDriveId(file.library));
    const { buffer } = await GraphService.downloadFile(driveIds.get(file.library), file.id, { maxBytes: MAX_BYTES });
    let text;
    if (/\.pdf$/i.test(file.name)) {
      const parsed = await pdf(buffer);
      text = parsed.text || '';
      rec.pages = parsed.numpages || 0;
    } else text = await extractTextFromBuffer(buffer, file.name, file.mimeType);
    rec.chars = text.length;
    rec.formats = FORMATS.filter(([, re]) => re.test(text)).map(([f]) => f).join('+');
    rec.sections = (text.match(/BIOGRAPHICAL\s+SKETCH/gi) || []).length || (text.match(/NAME\s*:/g) || []).length;
    const base = `${p.year}_${p.requestNum}_${p.kind}`;
    fs.writeFileSync(path.join(OUT_DIR, `${base}.txt`), `# ${p.file}\n\n${text}`);
  } catch (err) { rec.error = String(err.message || err).slice(0, 150); }
  summary.push(rec);
  console.log(`  ${p.year} ${p.requestNum} ${p.kind.padEnd(17)} pages ${String(rec.pages).padStart(3)} chars ${String(rec.chars).padStart(7)} formats ${rec.formats || '-'} sections ${rec.sections}${rec.error ? ` ERROR ${rec.error}` : ''}`);
}
fs.writeFileSync(path.join(OUT_DIR, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nWrote ${summary.filter((s) => !s.error).length} text files and summary.json to ${OUT_DIR}\n`);
