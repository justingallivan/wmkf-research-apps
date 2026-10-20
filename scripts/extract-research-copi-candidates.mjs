/**
 * extract-research-copi-candidates.mjs — READ-ONLY on Dataverse/SharePoint;
 * PAID model calls (owner-approved 2026-10-19: Haiku 5.5, estimated < $1).
 *
 * Recovers co-PIs on older awarded Research requests (Dataverse records none
 * before 2024) from proposal documents. Per grant listed in the inventory CSV
 * (probe-research-proposal-file-inventory.mjs) within --from-year..--to-year:
 *   1. finds its biosketch files (and narrative/application files; for
 *      2016–2017 the compiled proposal) in SharePoint and extracts text;
 *   2. asks the model, through lib/services/llm-client.js with the documents
 *      fenced by wrapUntrustedContent, for every person with a biosketch:
 *      name, title, department, email, whether they are the PI, whether they
 *      are faculty-level, and whether the narrative/application names them as
 *      a co-PI or co-investigator;
 *   3. resolves each email domain to an institution via ROR (domain only);
 *   4. decides co-PIs without human review: if the documents name
 *      co-investigators, those people (rule c); otherwise faculty-level people
 *      who are not the PI (rule a).
 * Output: one CSV row per person. Nothing is written to Dataverse.
 *
 *   node scripts/extract-research-copi-candidates.mjs --inventory=<csv> --out=<csv>
 *        [--from-year=2017] [--to-year=2023] [--limit=N] [--max-usd=2]
 *
 * The CSV holds names, titles and work emails: keep it out of the repo.
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
const INVENTORY = arg('inventory');
const OUT = arg('out');
if (!INVENTORY || !OUT) { console.error('--inventory=<csv> and --out=<csv outside the repo> are required'); process.exit(2); }
const FROM_YEAR = arg('from-year') || '2017';
const TO_YEAR = arg('to-year') || '2023';
const LIMIT = Number(arg('limit')) || Infinity;
const MAX_USD = Number(arg('max-usd') || 2);
const MODEL = 'claude-haiku-5-5';
// $ per million tokens, from lib/utils/model-pricing.js (Haiku 5.5, prompts under 100K tokens).
const PRICE_IN = 0.10; const PRICE_OUT = 0.50;
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_DOC_CHARS = 120000;

const { DynamicsService } = await import('../lib/services/dynamics-service.js');
const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
const { extractTextFromBuffer } = await import('../lib/utils/file-loader.js');
const { createLLMClient } = await import('../lib/services/llm-client.js');
const { wrapUntrustedContent, buildUntrustedContentPreamble, DATA_CLASSES } = await import('../lib/utils/ai-payload-boundary.js');
const odata = await import('../lib/dataverse/core/odata.js');
enterDynamicsBypassForScript('extract-research-copi-candidates');
const llm = createLLMClient({ model: MODEL, timeoutMs: 120000 });

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

// Email domain → institution via ROR v2 (domain only); same rule as
// scripts/match-orcid-backfill-candidates.mjs.
const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|mac|aol|protonmail|comcast|msn)\./;
const domainCache = new Map();
async function rorForDomain(domain) {
  if (!domain || FREEMAIL.test(domain)) return null;
  if (domainCache.has(domain)) return domainCache.get(domain);
  let result = null;
  const labels = domain.split('.');
  for (let k = 0; k <= labels.length - 2 && !result; k++) {
    const d = labels.slice(k).join('.');
    try {
      const res = await fetch(`https://api.ror.org/v2/organizations?query.advanced=${encodeURIComponent(`domains:${d}`)}`);
      if (!res.ok) break;
      const exact = ((await res.json()).items || []).filter((it) => (it.domains || []).includes(d));
      const parents = exact.filter((it) => (it.relationships || []).some((r) => r.type === 'child'));
      const pick = parents.length === 1 ? parents[0] : exact.length === 1 ? exact[0] : null;
      if (pick) result = { ror: String(pick.id).replace(/^https?:\/\/ror\.org\//, ''), name: (pick.names || []).find((n) => n.types.includes('ror_display'))?.value || '' };
    } catch { break; }
  }
  domainCache.set(domain, result);
  return result;
}

const SYSTEM = (nonces) => [
  buildUntrustedContentPreamble(nonces),
  '',
  'You extract the research team from grant proposal documents for the W. M. Keck Foundation.',
  'Return ONLY a JSON object, no prose, with this shape:',
  '{"people":[{"name":"","title":"","department":"","email":"","is_pi":false,"faculty_level":false,"named_coinvestigator":false,"evidence":""}],"documents_name_coinvestigators":false}',
  'Rules:',
  '- Include every person who has a biosketch, CV or bio in the documents, once each.',
  '- name: the person\'s full name as written. title: their current position title. email: as written, or "".',
  '- is_pi: true only for the principal investigator (lead PI) of this proposal.',
  '- faculty_level: true for independent investigators (professor of any rank, investigator, staff/research scientist leading work, center or lab director); false for postdocs, students, technicians, research associates, managers and administrators.',
  '- named_coinvestigator: true only if the narrative, application or a biosketch heading explicitly calls this person a co-PI, co-principal investigator or co-investigator of THIS proposal.',
  '- documents_name_coinvestigators: true if the documents explicitly identify any co-PI/co-investigator by name.',
  '- evidence: up to 15 words quoted from the documents supporting named_coinvestigator, else "".',
].join('\n');

function parseJson(text) {
  const s = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
  const start = s.indexOf('{'); const end = s.lastIndexOf('}');
  return JSON.parse(s.slice(start, end + 1));
}

const inv = parseCsv(fs.readFileSync(INVENTORY, 'utf8'))
  .filter((r) => r.year >= FROM_YEAR && r.year <= TO_YEAR && (r.biosketch_files || r.proposal_files));
console.log(`\n${inv.length} grants with biosketch or compiled-proposal files in ${FROM_YEAR}..${TO_YEAR}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}.\n`);

let tokensIn = 0; let tokensOut = 0;
const cost = () => (tokensIn * PRICE_IN + tokensOut * PRICE_OUT) / 1e6;
const driveIds = new Map();
const out = [];
let done = 0;
for (const r of inv) {
  if (done >= LIMIT) break;
  if (cost() > MAX_USD) { console.log(`Stopping: estimated cost $${cost().toFixed(3)} passed --max-usd=${MAX_USD}.`); break; }
  done += 1;
  const base = { year: r.year, requestNum: r.request_num };
  try {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum,_akoya_applicantid_value,_wmkf_projectleader_value',
      filter: odata.eq('akoya_requestnum', r.request_num),
      top: 2,
    });
    if (records.length !== 1) throw new Error(`request lookup returned ${records.length} rows`);
    const req = records[0];
    base.applicant = req._akoya_applicantid_value_formatted || '';
    base.piOnRecord = req._wmkf_projectleader_value_formatted || '';
    const buckets = await getRequestSharePointBuckets(req.akoya_requestid, r.request_num);
    const files = [];
    for (const b of buckets) {
      try { for (const f of await GraphService.listFiles(b.library, b.folder, { recursive: true })) files.push({ ...f, library: b.library }); } catch { /* speculative archive bucket */ }
    }
    const wanted = new Set([...(r.biosketch_files ? r.biosketch_files.split(' | ') : []), ...(r.biosketch_files ? [] : r.proposal_files.split(' | ').slice(0, 1))]);
    const narrative = files.filter((f) => /narrative|application|phase\s*(i{1,2}|1|2)\b/i.test(f.name) && !/report/i.test(f.name) && /\.(pdf|docx?)$/i.test(f.name))
      .sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 1);
    const docs = [...files.filter((f) => wanted.has(f.name)).slice(0, 3), ...narrative.filter((f) => !wanted.has(f.name))];
    if (!docs.length) throw new Error('no documents found');
    const wrapped = [];
    for (const f of docs) {
      if ((f.size || 0) > MAX_BYTES) continue;
      if (!driveIds.has(f.library)) driveIds.set(f.library, await GraphService.getDriveId(f.library));
      const { buffer } = await GraphService.downloadFile(driveIds.get(f.library), f.id, { maxBytes: MAX_BYTES });
      const text = await extractTextFromBuffer(buffer, f.name, f.mimeType);
      if (text.trim().length < 200) continue;
      wrapped.push(wrapUntrustedContent({ text, source: 'extract-research-copi-candidates', dataClass: DATA_CLASSES.PROPOSAL_TEXT, maxChars: MAX_DOC_CHARS, label: f.name }));
    }
    if (!wrapped.length) throw new Error('no readable document text');
    base.sources = docs.map((f) => f.name).join(' | ');
    let parsed = null;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      const res = await llm.complete({
        system: SYSTEM(wrapped.map((w) => w.nonce)),
        messages: [{ role: 'user', content: `Proposal ${r.request_num}. Applicant institution on record: ${base.applicant || 'unknown'}.\n\n${wrapped.map((w) => w.text).join('\n\n')}` }],
        maxTokens: 3000,
        temperature: 0,
      });
      tokensIn += res.usage?.inputTokens || 0;
      tokensOut += res.usage?.outputTokens || 0;
      try { parsed = parseJson(res.text || ''); } catch { parsed = null; }
    }
    if (!parsed?.people) throw new Error('model did not return parseable JSON');
    const named = Boolean(parsed.documents_name_coinvestigators);
    for (const p of parsed.people) {
      const email = String(p.email || '').trim().toLowerCase();
      const inst = await rorForDomain(email.split('@')[1] || '');
      const isCoPI = !p.is_pi && (named ? Boolean(p.named_coinvestigator) : Boolean(p.faculty_level));
      out.push({
        ...base, name: p.name, title: p.title, department: p.department, email,
        institution: inst?.name || '', ror: inst?.ror || '',
        isPI: Boolean(p.is_pi), facultyLevel: Boolean(p.faculty_level), namedCoInvestigator: Boolean(p.named_coinvestigator),
        decision: p.is_pi ? 'PI' : isCoPI ? 'co-PI' : 'other',
        rule: p.is_pi ? '' : named ? 'c: named in documents' : 'a: faculty-level',
        evidence: p.evidence || '',
      });
    }
    const people = out.filter((o) => o.requestNum === r.request_num);
    console.log(`  ${r.year} ${r.request_num}: ${people.length} people, ${people.filter((o) => o.decision === 'co-PI').length} co-PI (${named ? 'rule c' : 'rule a'}) — $${cost().toFixed(3)} so far`);
  } catch (err) {
    out.push({ ...base, decision: 'error', evidence: String(err.message || err).slice(0, 150) });
    console.log(`  ${r.year} ${r.request_num}: ERROR ${String(err.message || err).slice(0, 120)}`);
  }
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const cols = ['year', 'requestNum', 'applicant', 'piOnRecord', 'name', 'title', 'department', 'email', 'institution', 'ror', 'isPI', 'facultyLevel', 'namedCoInvestigator', 'decision', 'rule', 'evidence', 'sources'];
fs.writeFileSync(OUT, `${[cols.join(','), ...out.map((o) => cols.map((c) => esc(o[c])).join(','))].join('\n')}\n`);
const coPIs = out.filter((o) => o.decision === 'co-PI');
console.log(`\nGrants processed: ${done}. People: ${out.filter((o) => o.name).length}. Co-PIs: ${coPIs.length} (with institution from email: ${coPIs.filter((o) => o.institution).length}). Errors: ${out.filter((o) => o.decision === 'error').length}.`);
console.log(`Model usage: ${tokensIn} input + ${tokensOut} output tokens ≈ $${cost().toFixed(3)} (${MODEL}).`);
console.log(`Wrote ${OUT}\n`);
