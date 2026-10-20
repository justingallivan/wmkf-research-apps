/**
 * verify-research-copi-roles.mjs — READ-ONLY on Dataverse/SharePoint; PAID
 * model calls (owner-approved 2026-10-20: option 3, Haiku 5.5, estimated
 * about $0.50, capped by --max-usd).
 *
 * Stage B of docs/plans/RESEARCH_INSTITUTION_AT_AWARD_BACKFILL_PLAN_2026-10-20.md.
 * The first extraction (extract-research-copi-candidates.mjs) fell back to
 * "rule a" on grants whose documents named no co-investigator: every
 * faculty-level non-PI with a biosketch was called a co-PI. This script takes
 * a second, evidence-only look at those grants. Per grant it reads the
 * biosketches, the narrative/application, and the budget, budget
 * justification and personnel files, and asks the model, for each non-PI
 * person the first pass found, whether the documents state their role and
 * whether the budget lists them with effort, with a quote and its file.
 * scripts/lib/research-copi-roles.mjs then decides; a quote must really be in
 * the cited document:
 *   co-PI        stated co-PI / co-investigator role, verified quote
 *   budget-only  faculty-level, verified budgeted effort, no stated role
 *   not co-PI    anything else
 * Output: one CSV row per person. Nothing is written to Dataverse.
 *
 *   node scripts/verify-research-copi-roles.mjs --candidates=<research-copi-candidates.csv> --out=<csv>
 *        [--limit=N] [--max-usd=2] [--request=<num,num>]
 *
 * The CSV holds names and quotes from proposals: keep it out of the repo.
 */

import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { normalizeForQuote, isBudgetFile, decideRole } from './lib/research-copi-roles.mjs';

try {
  const env = fs.readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const CANDIDATES = arg('candidates');
const OUT = arg('out');
if (!CANDIDATES || !OUT) { console.error('--candidates=<csv> and --out=<csv outside the repo> are required'); process.exit(2); }
const repoAbs = path.resolve('.');
if (path.resolve(OUT).startsWith(`${repoAbs}${path.sep}`)) { console.error('--out must be outside the repository.'); process.exit(2); }
const LIMIT = Number(arg('limit')) || Infinity;
const MAX_USD = Number(arg('max-usd') || 2);
const ONLY = arg('request') ? new Set(arg('request').split(',')) : null;
const MODEL = 'claude-haiku-5-5';
// $ per million tokens, from lib/utils/model-pricing.js (Haiku 5.5, prompts under 100K tokens).
const PRICE_IN = 0.10; const PRICE_OUT = 0.50;
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_DOC_CHARS = 80000;
const MAX_DOCS = 7;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { extractTextFromBuffer } = await import('../lib/utils/file-loader.js');
const { createLLMClient } = await import('../lib/services/llm-client.js');
const { wrapUntrustedContent, buildUntrustedContentPreamble, DATA_CLASSES } = await import('../lib/utils/ai-payload-boundary.js');
const odata = await import('../lib/dataverse/core/odata.js');
enterDynamicsBypassForScript('verify-research-copi-roles');
const llm = createLLMClient({ model: MODEL, timeoutMs: 180000 });

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

async function xlsxText(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const lines = [];
  wb.eachSheet((ws) => ws.eachRow((r) => lines.push(r.values.slice(1).map((v) => (v && typeof v === 'object' ? (v.result ?? v.text ?? '') : v ?? '')).join(' | '))));
  return lines.join('\n');
}

const SYSTEM = (nonces) => [
  buildUntrustedContentPreamble(nonces),
  '',
  'You check grant proposal documents for the W. M. Keck Foundation to find each listed person\'s stated role on THIS proposal.',
  'Report only what the documents say. Do not infer a role from seniority, a biosketch alone, or authorship.',
  'Return ONLY a JSON object, no prose:',
  '{"people":[{"name":"","role_stated":"none","role_quote":"","role_source":"","in_budget":false,"budget_effort":"","budget_quote":"","budget_source":""}]}',
  'One entry per listed person, using the name exactly as listed. Rules:',
  '- role_stated: one of "co-pi", "co-investigator", "senior/key personnel", "collaborator", "consultant", "postdoc/student/staff", "other", "none".',
  '  "co-pi" covers co-PI, co-principal investigator and multiple-PI; "co-investigator" covers co-I and co-investigator.',
  '  Use "none" unless a document explicitly states the role for this proposal (e.g. "Role: Co-Investigator", "Dr. X (co-PI)").',
  '- role_quote: 6 to 25 words copied EXACTLY from the document that states the role, else "". role_source: that document\'s label exactly as given in its header, else "".',
  '- in_budget: true only if a budget, budget justification or personnel document lists this person.',
  '- budget_effort: their stated effort, months or percent (e.g. "1 summer month", "10%"), else "".',
  '- budget_quote / budget_source: 6 to 25 words copied EXACTLY from that budget document and its label, else "".',
].join('\n');

function parseJson(text) {
  const s = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  return JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1));
}

const candidates = parseCsv(fs.readFileSync(CANDIDATES, 'utf8'));
const ruleAGrants = [...new Set(candidates.filter((c) => c.rule.startsWith('a')).map((c) => c.requestNum))]
  .filter((g) => !ONLY || ONLY.has(g));
console.log(`\n${ruleAGrants.length} rule-a grants to re-check${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}.\n`);

let tokensIn = 0; let tokensOut = 0;
const cost = () => (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
const driveIds = new Map();
const out = [];
let done = 0;
for (const g of ruleAGrants) {
  if (done >= LIMIT) break;
  if (cost() > MAX_USD) { console.log(`Stopping: estimated cost $${cost().toFixed(3)} passed --max-usd=${MAX_USD}.`); break; }
  done += 1;
  const people = candidates.filter((c) => c.requestNum === g && c.decision !== 'PI' && c.decision !== 'error' && c.name);
  const base = (c) => ({ year: c.year, requestNum: g, name: c.name, email: c.email, title: c.title, institution: c.institution, institutionSource: c.institutionSource, firstPass: c.decision, facultyLevel: c.facultyLevel });
  try {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum,_wmkf_projectleader_value',
      filter: odata.eq('akoya_requestnum', g),
      top: 2,
    });
    if (records.length !== 1) throw new Error(`request lookup returned ${records.length} rows`);
    const req = records[0];
    const files = [];
    for (const b of await getRequestSharePointBuckets(req.akoya_requestid, g)) {
      try { for (const f of await GraphService.listFiles(b.library, b.folder, { recursive: true })) files.push({ ...f, library: b.library }); } catch { /* speculative archive bucket */ }
    }
    const firstPassSources = new Set(candidates.filter((c) => c.requestNum === g).flatMap((c) => (c.sources || '').split(' | ')).filter(Boolean));
    const budget = files.filter((f) => isBudgetFile(f.name)).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 3);
    const prior = files.filter((f) => firstPassSources.has(f.name) && !budget.includes(f));
    const docs = [...budget, ...prior].slice(0, MAX_DOCS);
    if (!docs.length) throw new Error('no documents found');
    const wrapped = []; const docTexts = new Map();
    for (const f of docs) {
      if ((f.size || 0) > MAX_BYTES) continue;
      if (!driveIds.has(f.library)) driveIds.set(f.library, await GraphService.getDriveId(f.library));
      let text = '';
      try {
        const { buffer } = await GraphService.downloadFile(driveIds.get(f.library), f.id, { maxBytes: MAX_BYTES });
        text = /\.xlsx$/i.test(f.name) ? await xlsxText(buffer) : await extractTextFromBuffer(buffer, f.name, f.mimeType);
      } catch { continue; }
      if (text.trim().length < 100) continue;
      // Key by the label exactly as the model sees it: wrapUntrustedContent strips " [ ] from labels.
      docTexts.set(String(f.name).replace(/["[\]]/g, ''), normalizeForQuote(text));
      wrapped.push(wrapUntrustedContent({ text, source: 'verify-research-copi-roles', dataClass: DATA_CLASSES.PROPOSAL_TEXT, maxChars: MAX_DOC_CHARS, label: f.name }));
    }
    if (!wrapped.length) throw new Error('no readable document text');
    let parsed = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const res = await llm.complete({
        system: SYSTEM(wrapped.map((w) => w.nonce)),
        messages: [{ role: 'user', content: `Proposal ${g}. Lead PI on record: ${req._wmkf_projectleader_value_formatted || 'unknown'}.\nListed people:\n${people.map((p) => `- ${p.name}${p.title ? ` (${p.title})` : ''}`).join('\n')}\n\n${wrapped.map((w) => w.text).join('\n\n')}` }],
        maxTokens: 6000,
        temperature: 0,
      });
      tokensIn += res.usage?.inputTokens || 0;
      tokensOut += res.usage?.outputTokens || 0;
      try { parsed = parseJson(res.text || ''); } catch { parsed = null; }
    }
    if (!parsed?.people) throw new Error('model did not return parseable JSON');
    const byName = new Map(parsed.people.map((p) => [String(p.name || '').trim().toLowerCase(), p]));
    for (const c of people) {
      const p = byName.get(c.name.trim().toLowerCase()) || {};
      const { decision, basis } = decideRole(p, c.facultyLevel === 'true', docTexts);
      out.push({
        ...base(c), decision, basis,
        roleStated: p.role_stated || '', roleQuote: p.role_quote || '', roleSource: p.role_source || '',
        inBudget: Boolean(p.in_budget), budgetEffort: p.budget_effort || '', budgetQuote: p.budget_quote || '', budgetSource: p.budget_source || '',
        documents: docs.map((f) => f.name).join(' | '),
      });
    }
    const mine = out.filter((o) => o.requestNum === g);
    console.log(`  ${g}: ${people.length} people — ${mine.filter((o) => o.decision === 'co-PI').length} co-PI, ${mine.filter((o) => o.decision === 'budget-only').length} budget-only (${budget.length} budget files) — $${cost().toFixed(3)} so far`);
  } catch (err) {
    for (const c of people) out.push({ ...base(c), decision: 'error', basis: String(err.message || err).slice(0, 150) });
    console.log(`  ${g}: ERROR ${String(err.message || err).slice(0, 120)}`);
  }
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['year', 'requestNum', 'name', 'email', 'title', 'institution', 'institutionSource', 'firstPass', 'facultyLevel', 'decision', 'basis',
  'roleStated', 'roleQuote', 'roleSource', 'inBudget', 'budgetEffort', 'budgetQuote', 'budgetSource', 'documents'];
fs.writeFileSync(OUT, `${[cols.join(','), ...out.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n')}\n`);
const n = (d) => out.filter((o) => o.decision === d).length;
console.log(`\nPeople re-checked: ${out.length} on ${done} grants. co-PI ${n('co-PI')}, budget-only ${n('budget-only')}, not co-PI ${n('not co-PI')}, error ${n('error')}.`);
console.log(`Tokens in ${tokensIn}, out ${tokensOut}; estimated cost $${cost().toFixed(3)}.`);
console.log(`Wrote ${OUT}`);
