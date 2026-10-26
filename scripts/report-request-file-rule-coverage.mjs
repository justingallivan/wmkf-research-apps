/**
 * report-request-file-rule-coverage.mjs — OFFLINE. Applies the corpus filename
 * rules (lib/services/request-file-corpus/filename-rules.js) to the CSVs written
 * by probe-request-file-inventory.mjs and reports, per era, how many non-test
 * files each priority bucket receives and the most common filename shapes left
 * `uncertain`. Reads local CSVs only; no Dataverse or Graph access.
 *
 *   node scripts/report-request-file-rule-coverage.mjs --in=<inventory dir> [--out=<csv outside the repo>]
 *
 * <inventory dir> holds one subfolder per run, each with files.csv and
 * requests.csv; runs are de-duplicated on request_id and item_id.
 * Eras (plan "Four eras"): 4 = created 2026 with a meeting date from 2026-07;
 * otherwise by meeting year (created year when absent): 1 ≤ 2015, 2 = 2016–2021,
 * 3 = 2022 on.
 */

import fs from 'fs';
import path from 'path';
import { classifyByFilename, phaseOf } from '../lib/services/request-file-corpus/filename-rules.js';

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
const files = new Map();
for (const run of fs.readdirSync(IN).filter((d) => fs.existsSync(path.join(IN, d, 'files.csv')))) {
  for (const r of parseCsv(fs.readFileSync(path.join(IN, run, 'requests.csv'), 'utf8'))) requests.set(r.request_id, r);
  for (const f of parseCsv(fs.readFileSync(path.join(IN, run, 'files.csv'), 'utf8'))) files.set(f.item_id, f);
}

function eraOf(r) {
  const meeting = (r.meeting_date || '').slice(0, 7);
  const created = (r.created_on || '').slice(0, 4);
  if (created === '2026' && meeting >= '2026-07') return 4;
  const year = Number((meeting || created).slice(0, 4));
  if (year <= 2015) return 1;
  if (year <= 2021) return 2;
  return 3;
}

const shapeOf = (name, requestNum) => name.toLowerCase()
  .split(String(requestNum)).join('{req}')
  .replace(/[0-9a-f]{32}/g, '{guid}')
  .replace(/\d+/g, '#');

const BUCKETS = ['read', 'already-legible', 'type-only', 'uncertain'];
const byEra = {};
const out = OUT ? ['era,request_num,item_id,subfolder,name,type,priority,rule_id,phase'] : null;
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

for (const f of files.values()) {
  const r = requests.get(f.request_id);
  if (!r || r.is_test === 'yes') continue;
  const era = eraOf(r);
  const result = classifyByFilename({ name: f.name, subfolder: f.subfolder });
  const e = (byEra[era] ||= { total: 0, buckets: {}, types: {}, rules: {}, uncertain: {} });
  e.total += 1;
  e.buckets[result.priority] = (e.buckets[result.priority] || 0) + 1;
  e.types[result.type] = (e.types[result.type] || 0) + 1;
  e.rules[result.ruleId || '(none)'] = (e.rules[result.ruleId || '(none)'] || 0) + 1;
  if (result.priority === 'uncertain') {
    const key = `${result.ruleId || '-'}  ${f.subfolder ? `${f.subfolder.split('/')[0]}/` : ''}${shapeOf(f.name, r.request_num)}`;
    e.uncertain[key] = (e.uncertain[key] || 0) + 1;
  }
  if (out) out.push([era, r.request_num, f.item_id, f.subfolder, f.name, result.type, result.priority, result.ruleId, phaseOf(f)].map(esc).join(','));
}

const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
const top = (map, k) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, k);
for (const era of Object.keys(byEra).sort()) {
  const e = byEra[era];
  console.log(`\n=== Era ${era}: ${e.total} non-test files`);
  console.log(`  ${BUCKETS.map((b) => `${b} ${e.buckets[b] || 0} (${pct(e.buckets[b] || 0, e.total)})`).join(' | ')}`);
  console.log(`  types: ${top(e.types, 30).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  console.log('  top uncertain shapes:');
  for (const [k, n] of top(e.uncertain, 25)) console.log(`    ${String(n).padStart(6)}  ${k}`);
}
if (out) { fs.writeFileSync(OUT, `${out.join('\n')}\n`); console.log(`\nWrote ${OUT}`); }
