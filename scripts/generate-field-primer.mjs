// Generate a field primer for a proposal and write it as markdown.
//
// Two input modes:
//   --request <num|GUID>   pull the real proposal PDF from SharePoint (READ-ONLY),
//                          extract text, generate. [--file-key "lib::folder::name"]
//                          [--list-files] to inspect the bucket first.
//   --text <proposal.txt>  read proposal text from a local file.
//
// Requires the field-primer.generate row seeded in Dataverse
// (scripts/seed-field-primer-prompt.js --execute). Makes a live (paid) Claude call
// via the Executor; run unsandboxed. Output is written to tmp/ (gitignored —
// proposal content + named experts stay local).
//
// Usage:
//   node scripts/generate-field-primer.mjs --request 1002878 [--focus "..."]
//   node scripts/generate-field-primer.mjs --text tmp/sample-proposal.txt
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

for (const envFile of ['.env', '.env.local']) {
  try {
    const c = readFileSync(resolve(process.cwd(), envFile), 'utf8');
    for (const line of c.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const has = (name) => argv.includes(name);
const textFile = arg('--text');
const request = arg('--request');
const fileKey = arg('--file-key');
const listFiles = has('--list-files');
const focus = arg('--focus') || undefined;

if (!textFile && !request) {
  console.error('Usage: node scripts/generate-field-primer.mjs (--request <num|GUID> [--file-key K] [--list-files] | --text <file>) [--focus "..."]');
  process.exit(2);
}

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fileKeyOf = (f) => `${f.library}::${f.folder}::${f.name}`;

// Proposal-file classification (mirror of probe-grounded-origination / smoke-discover).
const SEP = '(?:^|[\\s_\\-])';
const SEP_END = '(?:[\\s_\\-]|$)';
const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');
function classifyFile(name) {
  const n = (name || '').toLowerCase();
  const isPhaseI = wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n);
  if (isPhaseI) return 'other';
  const hasNarrative = /project[\s_\-]*(narrative|description)/i.test(n);
  const isFrontMatter =
    /cover[\s_\-]*(page|sheet|letter)/i.test(n) || /face[\s_\-]*page/i.test(n) ||
    /title[\s_\-]*page/i.test(n) || /signature[\s_\-]*page/i.test(n) || /application[\s_\-]*form/i.test(n);
  if (isFrontMatter && !hasNarrative) return 'other';
  const isProposal = hasNarrative || wordRe('phase[\\s_]?ii').test(n) || wordRe('proposal').test(n) || wordRe('application').test(n);
  const isReport = wordRe('report').test(n) || wordRe('annual').test(n) || wordRe('interim').test(n) || wordRe('progress').test(n) || /final[\s_\-]+(report|narrative|summary)/i.test(n);
  if (isProposal) return 'proposal';
  if (isReport) return 'report';
  return 'other';
}
function pickProposalBestGuess(files) {
  const proposals = files.filter((f) => f.classification === 'proposal');
  if (proposals.length === 0) return null;
  const tier1 = proposals.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name));
  const phaseIIRe = /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i;
  const tier2 = proposals.filter((f) => phaseIIRe.test(f.name));
  const extScore = (n) => { const s = n.toLowerCase(); if (s.endsWith('.pdf')) return 0; if (s.endsWith('.docx')) return 1; return 2; };
  const sortByExt = (arr) => arr.slice().sort((a, b) => extScore(a.name) - extScore(b.name));
  if (tier1.length > 0) return sortByExt(tier1)[0];
  if (tier2.length > 0) return sortByExt(tier2)[0];
  return sortByExt(proposals)[0];
}

const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
enterDynamicsBypassForScript('generate-field-primer');
const { generateFieldPrimer, groundPrimerExperts, renderPrimerMarkdown } = await import('../lib/services/field-primer-service.js');

let proposalText;
let title;
let slug = 'out';

if (textFile) {
  proposalText = readFileSync(resolve(process.cwd(), textFile), 'utf8');
} else {
  // --request mode: resolve request → SharePoint buckets → pick + download proposal.
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');

  const select = 'akoya_requestid,akoya_requestnum,akoya_title';
  let rec;
  if (GUID_RE.test(request)) {
    rec = await DynamicsService.getRecord('akoya_requests', request, { select });
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select, filter: `akoya_requestnum eq '${String(request).replace(/'/g, "''")}'`, top: 1,
    });
    if (!records?.length) { console.error(`No akoya_request '${request}'.`); process.exit(2); }
    rec = records[0];
  }
  const requestId = rec.akoya_requestid;
  title = rec.akoya_title || `Request ${rec.akoya_requestnum}`;
  slug = rec.akoya_requestnum || requestId;
  console.log(`REQUEST ${rec.akoya_requestnum} · ${title}`);

  const buckets = await getRequestSharePointBuckets(requestId, rec.akoya_requestnum);
  const bucketResults = await Promise.all(buckets.map(async (b) => {
    try { return { ...b, files: await GraphService.listFiles(b.library, b.folder, { recursive: true }) }; }
    catch (err) { return { ...b, files: [], error: err.message }; }
  }));
  const seen = new Set(); const allFiles = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const folder = f.folder || bucket.folder; const key = `${bucket.library}::${folder}::${f.name}`;
      if (seen.has(key)) continue; seen.add(key);
      allFiles.push({ name: f.name, library: bucket.library, folder, classification: classifyFile(f.name) });
    }
  }
  if (listFiles) {
    allFiles.forEach((f) => console.log(`  [${f.classification.padEnd(9)}] ${fileKeyOf(f)}`));
    process.exit(0);
  }
  let picked;
  if (fileKey) {
    picked = allFiles.find((af) => fileKeyOf(af) === fileKey);
    if (!picked) { console.error(`No file matching --file-key "${fileKey}". Use --list-files.`); process.exit(2); }
  } else {
    picked = pickProposalBestGuess(allFiles);
    if (!picked) { console.error('No proposal file found. Use --list-files / --file-key.'); process.exit(2); }
  }
  console.log(`PROPOSAL ${fileKeyOf(picked)}`);
  const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  proposalText = (dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)
    ? (await (await import('pdf-parse')).default(dl.buffer)).text
    : dl.buffer.toString('utf8');
  console.log(`PARSED   ${(proposalText || '').length.toLocaleString()} chars`);
}

if (!proposalText || proposalText.trim().length < 100) {
  console.error('Proposal text too short / empty.');
  process.exit(2);
}

const t0 = Date.now();
const { primer, runId, model } = await generateFieldPrimer({ proposalText, focus, runSource: 'Vercel Test' });

if (!has('--no-ground') && Array.isArray(primer.experts) && primer.experts.length) {
  console.log(`Grounding ${primer.experts.length} experts against OpenAlex…`);
  try { primer.experts = await groundPrimerExperts(primer.experts); }
  catch (e) { console.warn(`  grounding failed (${e.message}); leaving experts ungrounded`); }
}

const md = renderPrimerMarkdown(primer, { title });

mkdirSync('tmp', { recursive: true });
const outPath = `tmp/field-primer-${slug}-${runId || 'out'}.md`;
writeFileSync(outPath, md);

console.log(`✓ primer generated in ${((Date.now() - t0) / 1000).toFixed(1)}s (model=${model}, run=${runId})`);
console.log(`  → ${outPath}`);
