/**
 * report-request-file-template-coverage.mjs — OFFLINE. Applies the corpus
 * template signatures (lib/services/request-file-corpus/template-signatures.js)
 * to the text written by pilot-request-file-content.mjs and reports, per
 * cohort: how many filename-`uncertain` documents a signature decides, how
 * often a signature agrees with a filename rule that already typed the file,
 * every disagreement (marking where content overrides a Type-only filename
 * label), and the openings of documents still undecided. Reads
 * local files only; no Graph, Dataverse or model access.
 *
 *   node scripts/report-request-file-template-coverage.mjs --pilot=<pilot output dir> [--cohorts=2020,recent]
 *
 * Output quotes document openings, which can name people: run it locally and
 * keep any saved output out of the repo.
 */

import fs from 'fs';
import path from 'path';
import { classifyByContent, resolveClassification } from '../lib/services/request-file-corpus/template-signatures.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const PILOT = arg('pilot');
const COHORTS = arg('cohorts') ? new Set(arg('cohorts').split(',')) : null;
if (!PILOT) { console.error('--pilot=<pilot output dir> is required'); process.exit(2); }

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

const byCohort = {};
const disagreements = [];
const undecided = {};
const opening = (text) => text.replace(/\s+/g, ' ').trim().slice(0, 110);

for (const row of parseCsv(fs.readFileSync(path.join(PILOT, 'manifest.csv'), 'utf8'))) {
  if (COHORTS && !COHORTS.has(row.cohort)) continue;
  if (row.outcome !== 'ok' && row.outcome !== 'sparse-text') continue;
  const textPath = path.join(PILOT, 'text', `${row.item_id}.txt`);
  if (!fs.existsSync(textPath)) continue;
  const text = fs.readFileSync(textPath, 'utf8');
  const content = classifyByContent(text);
  const c = (byCohort[row.cohort] ||= { uncertain: 0, decided: 0, typed: 0, matched: 0, agree: 0, templates: {} });
  if (content) c.templates[content.templateId] = (c.templates[content.templateId] || 0) + 1;
  if (row.rule_priority === 'uncertain') {
    c.uncertain += 1;
    if (content) c.decided += 1;
    else (undecided[row.cohort] ||= []).push(`[${row.ext}] ${opening(text)}`);
  } else {
    c.typed += 1;
    if (content) {
      c.matched += 1;
      if (content.type === row.rule_type) c.agree += 1;
      else disagreements.push(`${row.cohort}${resolveClassification({ type: row.rule_type, priority: row.rule_priority, ruleId: row.rule_id }, content).source.startsWith('template:') ? ' [content wins]' : ''} filename ${row.rule_type} (${row.rule_id}) vs content ${content.type} (${content.templateId}): ${opening(text)}`);
    }
  }
}

for (const [cohort, c] of Object.entries(byCohort)) {
  console.log(`\n=== ${cohort}`);
  console.log(`  filename-uncertain with text: ${c.uncertain}; decided by a signature: ${c.decided}`);
  console.log(`  filename-typed with text: ${c.typed}; a signature matched: ${c.matched}; same type: ${c.agree}`);
  console.log(`  signatures: ${Object.entries(c.templates).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ') || '-'}`);
}
console.log(`\n=== Disagreements (${disagreements.length})`);
for (const d of disagreements) console.log(`  ${d}`);
for (const [cohort, list] of Object.entries(undecided)) {
  console.log(`\n=== Still undecided: ${cohort} (${list.length})`);
  for (const line of list) console.log(`  ${line}`);
}
