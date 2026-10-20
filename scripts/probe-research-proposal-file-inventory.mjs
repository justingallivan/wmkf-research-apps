/**
 * probe-research-proposal-file-inventory.mjs — READ-ONLY, listing only (no
 * downloads). For every awarded Research request (same scope as
 * probe-research-pi-orcid-coverage.mjs) it lists the request's SharePoint
 * buckets (Dynamics-tracked folders plus the RequestArchive1/2/3 libraries
 * holding migrated content) and classifies files by name, to show per meeting
 * year where co-PI identities and institutions are most likely recorded.
 * Biosketches are the main target: they state each person's institution, and
 * their filenames often carry the person's name.
 *
 * Categories (first match wins): report, biosketch, compiled proposal,
 * narrative, application/cover form, personnel, budget, other.
 *
 *   node scripts/probe-research-proposal-file-inventory.mjs --out=<csv> [--from=2016-10-19] [--to=2026-12-31]
 *
 * The CSV lists filenames, which can include people's names: keep it out of
 * the repo.
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
const FROM = arg('from') || '2016-10-19';
const TO = arg('to') || '2026-12-31';

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
enterDynamicsBypassForScript('probe-research-proposal-file-inventory');

const AWARDED = ['Approved', 'Active', 'Closed'];
const CATEGORIES = [
  ['report', /report|fullreport|progress|interim|final narrative/i],
  ['biosketch', /bio\s*-?\s*sketch|biographical|curriculum\s*vitae|(^|[^a-z])(bios?|cv|resume)([^a-z]|$)/i],
  ['proposal', /_proposal\.(pdf|docx?)$|\bproposal\b.*\.(pdf)$/i],
  ['narrative', /narrative|project\s*description|research\s*plan/i],
  ['application', /application|phase\s*(i{1,2}|1|2)\b|cover|face\s*page|summary\s*page/i],
  ['personnel', /personnel|key\s*people|team|investigators|co-?pi/i],
  ['budget', /budget|financial|expense/i],
];
const category = (name) => CATEGORIES.find(([, re]) => re.test(name))?.[0] || 'other';

async function readAll(entitySet, options) {
  const result = await DynamicsService.queryAllRecords(entitySet, options);
  if (result.capped) { console.error(`${entitySet} read hit the 5,000-row export cap.`); process.exit(1); }
  return result.records;
}

const programs = await readAll('akoya_programs', { filter: 'akoya_programid ne null' });
const programName = (p) => p.akoya_name ?? p.akoya_programname ?? p.akoya_program
  ?? Object.entries(p).find(([k, v]) => /name$/.test(k) && !k.startsWith('_') && typeof v === 'string')?.[1] ?? '';
const research = programs.filter((p) => /research/i.test(programName(p)) && !/reviewer/i.test(programName(p)));
const requests = await readAll('akoya_requests', {
  select: 'akoya_requestid,akoya_requestnum,wmkf_meetingdate',
  filter: `(${research.map((p) => `_akoya_programid_value eq ${p.akoya_programid}`).join(' or ')}) and (${AWARDED.map((s) => `akoya_requeststatus eq '${s}'`).join(' or ')}) and wmkf_meetingdate ge ${FROM} and wmkf_meetingdate le ${TO}`,
});
requests.sort((a, b) => String(a.wmkf_meetingdate).localeCompare(String(b.wmkf_meetingdate)));
console.log(`\n${requests.length} awarded Research requests with meeting dates ${FROM}..${TO}.\n`);

const rows = [];
let n = 0;
for (const r of requests) {
  n += 1;
  const row = { year: (r.wmkf_meetingdate || '').slice(0, 4), cycle: (r.wmkf_meetingdate || '').slice(0, 7), requestNum: r.akoya_requestnum, libraries: new Set(), counts: {}, names: {}, error: '' };
  try {
    const buckets = await getRequestSharePointBuckets(r.akoya_requestid, r.akoya_requestnum);
    for (const b of buckets) {
      let listed = [];
      try { listed = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch { continue; }
      if (listed.length) row.libraries.add(b.library);
      for (const f of listed) {
        const c = category(f.name);
        row.counts[c] = (row.counts[c] || 0) + 1;
        if (['biosketch', 'proposal', 'personnel', 'application'].includes(c)) (row.names[c] ||= []).push(f.name);
      }
    }
  } catch (err) { row.error = String(err.message || err).slice(0, 150); }
  rows.push(row);
  if (n % 25 === 0) console.log(`  ${n}/${requests.length}`);
}

console.log('\nBy meeting year: requests, and how many have each kind of file (biosketch files per request in brackets)');
console.log('  year  requests  any-files  biosketch  [avg]  compiled-proposal  narrative  application  personnel');
for (const y of [...new Set(rows.map((r) => r.year))].sort()) {
  const ys = rows.filter((r) => r.year === y);
  const has = (c) => ys.filter((r) => r.counts[c]).length;
  const bios = ys.filter((r) => r.counts.biosketch);
  const avg = bios.length ? (bios.reduce((s, r) => s + r.counts.biosketch, 0) / bios.length).toFixed(1) : '-';
  const any = ys.filter((r) => Object.keys(r.counts).length).length;
  console.log(`  ${y}  ${String(ys.length).padStart(8)}  ${String(any).padStart(9)}  ${String(has('biosketch')).padStart(9)}  ${String(avg).padStart(5)}  ${String(has('proposal')).padStart(17)}  ${String(has('narrative')).padStart(9)}  ${String(has('application')).padStart(11)}  ${String(has('personnel')).padStart(9)}`);
}
const errors = rows.filter((r) => r.error).length;
if (errors) console.log(`\nRequests with a lookup error: ${errors}`);

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cats = [...CATEGORIES.map(([c]) => c), 'other'];
const lines = [['year', 'cycle', 'request_num', 'libraries', ...cats.map((c) => `n_${c}`), 'biosketch_files', 'proposal_files', 'application_files', 'personnel_files', 'error'].join(',')];
for (const r of rows) {
  lines.push([r.year, r.cycle, r.requestNum, [...r.libraries].join(' '), ...cats.map((c) => r.counts[c] || 0),
    (r.names.biosketch || []).join(' | '), (r.names.proposal || []).join(' | '), (r.names.application || []).join(' | '), (r.names.personnel || []).join(' | '), r.error].map(esc).join(','));
}
fs.writeFileSync(OUT, `${lines.join('\n')}\n`);
console.log(`\nWrote ${OUT}\n`);
