/**
 * Read-only validation harness for the reviewer-finder ANALYZE prompt (S229 work;
 * updated S254 for the POTENTIAL_CONCERNS retirement — Chunk 2b).
 *
 * Purpose: run the *production* Stage-1 analyze prompt against a REAL request's
 * FULL proposal narrative (not the abstract) and print the ranked reviewer
 * suggestions + reasoning, so we can eyeball:
 *   - ranking favors currently-active / mid-career experts over field founders
 *     (eyeball SENIORITY across the list),
 *   - REASONING stays fitness-only — no COI/conflict text. The POTENTIAL_CONCERNS
 *     amber advisory was RETIRED (S254): the model should emit NO conflict output;
 *     COI is screened deterministically server-side. The parser drops any lingering
 *     POTENTIAL_CONCERNS the live prompt still emits before its prod reseed, so this
 *     harness can no longer observe that field — the REASONING-no-COI check below is
 *     the surviving signal.
 *
 * Why full proposal, not abstract: production feeds the whole proposal narrative
 * (load-proposal.js → analyze.js parses the full PDF). The thin title+abstract+PI
 * shape was the ABANDONED Perplexity reviewer-agent experiment — don't re-use it
 * here or the test under-samples what the prompt actually sees in production.
 *
 * Mirrors the production path WITHOUT its writes:
 *   - resolves the request + finds/downloads the proposal doc from SharePoint
 *     (READ-ONLY: Dynamics getRecord/query + Graph list/download),
 *   - parses the PDF text LOCALLY (so it never uploads to Vercel Blob, unlike
 *     the load-proposal route),
 *   - calls ClaudeReviewerService.analyzeProposal directly (no save-candidates,
 *     no Find-roster PG write, no Dataverse reviewer write).
 *
 * NOT fully side-effect-free: the LLM call is real + paid, and LLMClient fires a
 * fire-and-forget INSERT into Postgres `api_usage_log` (billing telemetry, same
 * as every production LLM call). No reviewer/grant state is written.
 *
 * .env.local points at PROD Dataverse/SharePoint — but every call here is a read.
 *
 * Usage (the --import loader lets raw node resolve the app's extensionless imports):
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs --request <num|GUID>
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs --request 1002836 --list-files
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/validate-reviewer-analyze.mjs --request 1002836 \
 *        --file-key "Documents::Active/1002836::Project Narrative.pdf"
 *
 * Flags:
 *   --request <n|guid>   (required) akoya_requestnum or request GUID
 *   --list-files         list the request's SharePoint files (with classification) and exit
 *   --file-key "a::b::c" pick a specific file ("library::folder::name") instead of best-guess
 *   --reviewer-count N   suggestions to request (default 12)
 *   --temperature T      analyze temperature (default 0.3)
 *   --excluded "A, B"    comma-separated names to exclude
 */
import { readFileSync } from 'node:fs';

// Load .env.local into process.env (quote-stripped, no override) — same pattern
// as scripts/probe-perplexity-reviewer-agent.mjs / reset-request-reviewers.mjs.
function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch { /* env may already be exported in the shell */ }
}
loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────── arg parsing ─────────
function parseArgs(argv) {
  const out = { reviewerCount: 12, temperature: 0.3, excluded: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.request = next();
    else if (a === '--file-key') out.fileKey = next();
    else if (a === '--list-files') out.listFiles = true;
    else if (a === '--reviewer-count') out.reviewerCount = parseInt(next(), 10) || 12;
    else if (a === '--temperature') out.temperature = parseFloat(next());
    else if (a === '--excluded') out.excluded = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.request) {
  console.log('Usage: node scripts/validate-reviewer-analyze.mjs --request <num|GUID> [--list-files] [--file-key "lib::folder::name"] [--reviewer-count N] [--temperature T] [--excluded "A, B"]');
  process.exit(args.help ? 0 : 2);
}

// ───────── helpers ─────────
function fileKeyOf(f) {
  return `${f.library}::${f.folder}::${f.name}`;
}

// Inlined from pages/api/grant-reporting/lookup-grant.js `classifyFile` (that
// route module can't be imported here — it uses extensionless imports raw node
// ESM won't resolve). Keep in sync if the classifier changes.
const SEP = '(?:^|[\\s_\\-])';
const SEP_END = '(?:[\\s_\\-]|$)';
const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');
function classifyFile(name) {
  const n = (name || '').toLowerCase();
  const isPhaseI = wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n);
  if (isPhaseI) return 'other';
  const hasNarrative = /project[\s_\-]*(narrative|description)/i.test(n);
  const isFrontMatter =
    /cover[\s_\-]*(page|sheet|letter)/i.test(n) ||
    /face[\s_\-]*page/i.test(n) ||
    /title[\s_\-]*page/i.test(n) ||
    /signature[\s_\-]*page/i.test(n) ||
    /application[\s_\-]*form/i.test(n);
  if (isFrontMatter && !hasNarrative) return 'other';
  const isProposal =
    hasNarrative ||
    wordRe('phase[\\s_]?ii').test(n) ||
    wordRe('proposal').test(n) ||
    wordRe('application').test(n);
  const isReport =
    wordRe('report').test(n) ||
    wordRe('annual').test(n) ||
    wordRe('interim').test(n) ||
    wordRe('progress').test(n) ||
    /final[\s_\-]+(report|narrative|summary)/i.test(n);
  if (isProposal) return 'proposal';
  if (isReport) return 'report';
  return 'other';
}

// Mirror of pickProposalBestGuess in pages/api/reviewer-finder/load-proposal.js —
// keep in sync if that tiering changes (Project Narrative/Description → Phase II → any proposal; PDF preferred).
function pickProposalBestGuess(files) {
  const proposals = files.filter((f) => f.classification === 'proposal');
  if (proposals.length === 0) return null;
  const tier1 = proposals.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name));
  const phaseIIRe = /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i;
  const tier2 = proposals.filter((f) => phaseIIRe.test(f.name));
  const extScore = (n) => {
    const s = n.toLowerCase();
    if (s.endsWith('.pdf')) return 0;
    if (s.endsWith('.docx')) return 1;
    return 2;
  };
  const sortByExt = (arr) => arr.slice().sort((a, b) => extScore(a.name) - extScore(b.name));
  if (tier1.length > 0) return sortByExt(tier1)[0];
  if (tier2.length > 0) return sortByExt(tier2)[0];
  return sortByExt(proposals)[0];
}

function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

async function main() {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');

  if (!process.env.CLAUDE_API_KEY) {
    console.error('CLAUDE_API_KEY not set (check .env.local).');
    process.exit(2);
  }

  // ── 1. Resolve request (READ-ONLY) ──
  enterDynamicsBypassForScript('validate-reviewer-analyze');
  const select = 'akoya_requestid,akoya_requestnum,akoya_title';
  let rec;
  if (GUID_RE.test(args.request)) {
    rec = await DynamicsService.getRecord('akoya_requests', args.request, { select });
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select,
      filter: `akoya_requestnum eq '${String(args.request).replace(/'/g, "''")}'`,
      top: 1,
    });
    if (!records || records.length === 0) {
      console.error(`No akoya_request found with akoya_requestnum '${args.request}'.`);
      process.exit(2);
    }
    rec = records[0];
  }
  const requestId = rec.akoya_requestid;
  const requestNumber = rec.akoya_requestnum;
  console.log('━'.repeat(72));
  console.log(`REQUEST  ${requestNumber}  (${requestId})`);
  console.log(`TITLE    ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(72));

  // ── 2. List SharePoint files (READ-ONLY) ──
  const buckets = await getRequestSharePointBuckets(requestId, requestNumber);
  const bucketResults = await Promise.all(
    buckets.map(async (b) => {
      try {
        const raw = await GraphService.listFiles(b.library, b.folder, { recursive: true });
        return { ...b, files: raw, error: null };
      } catch (err) {
        return { ...b, files: [], error: err.message };
      }
    }),
  );
  const seen = new Set();
  const allFiles = [];
  for (const bucket of bucketResults) {
    for (const f of bucket.files) {
      const folder = f.folder || bucket.folder;
      const key = `${bucket.library}::${folder}::${f.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      allFiles.push({ name: f.name, size: f.size, library: bucket.library, folder, classification: classifyFile(f.name) });
    }
  }

  if (allFiles.length === 0) {
    console.error('No SharePoint files found for this request.');
    bucketResults.forEach((b) => b.error && console.error(`  bucket ${b.library}/${b.folder}: ${b.error}`));
    process.exit(2);
  }

  if (args.listFiles) {
    console.log(`\n${allFiles.length} file(s):`);
    for (const f of allFiles) {
      console.log(`  [${f.classification.padEnd(9)}] ${fileKeyOf(f)}`);
    }
    return;
  }

  // ── 3. Pick + download the proposal (READ-ONLY) ──
  let picked;
  if (args.fileKey) {
    picked = allFiles.find((f) => fileKeyOf(f) === args.fileKey);
    if (!picked) {
      console.error(`fileKey not found: ${args.fileKey}\nUse --list-files to see available keys.`);
      process.exit(2);
    }
  } else {
    picked = pickProposalBestGuess(allFiles);
    if (!picked) {
      console.error('No proposal-classified file found. Pass --file-key (see --list-files).');
      process.exit(2);
    }
  }
  console.log(`\nPROPOSAL FILE  ${fileKeyOf(picked)}`);

  const downloaded = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  const isPdf = (downloaded.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name);
  let text;
  if (isPdf) {
    const pdfParse = (await import('pdf-parse')).default;
    const parsed = await pdfParse(downloaded.buffer);
    text = parsed.text;
  } else if (/\.txt$/i.test(picked.name) || (downloaded.mimeType || '').startsWith('text/')) {
    text = downloaded.buffer.toString('utf8');
  } else {
    console.error(`Picked file is not a PDF or text (${downloaded.mimeType}); analyze only handles those. Pass --file-key pointing at a PDF (see --list-files).`);
    process.exit(2);
  }
  if (!text || text.trim().length < 100) {
    console.error(`Extracted proposal text is too short (${text ? text.trim().length : 0} chars).`);
    process.exit(2);
  }
  console.log(`EXTRACTED      ${text.length.toLocaleString()} chars of proposal text (parsed locally — no Blob upload)`);

  // ── 4. Run the production analyze prompt (LLM call + telemetry row only) ──
  await loadModelOverrides(); // warm tier aliases before the model resolves (same as analyze.js)
  console.log(`\nRunning analyze prompt — model ${ClaudeReviewerService.MODEL}, reviewerCount ${args.reviewerCount}, temp ${args.temperature}${args.excluded.length ? `, excluding ${args.excluded.length}` : ''}…\n`);

  const result = await ClaudeReviewerService.analyzeProposal(text, process.env.CLAUDE_API_KEY, {
    reviewerCount: args.reviewerCount,
    temperature: args.temperature,
    excludedNames: args.excluded,
    userProfileId: null, // script context → admin Dataverse default → code fallback (no per-user override)
    onProgress: (p) => {
      if (p.status === 'prompt_resolved' || p.status === 'fallback' || p.status === 'payload_boundary') {
        console.log(`  · ${p.message}`);
      }
    },
  });

  if (!result.success) {
    console.error('Analyze failed:', result);
    process.exit(1);
  }

  // ── 5. Print results for eyeballing ──
  const pInfo = result.proposalInfo || {};
  console.log('\n' + '═'.repeat(72));
  console.log('PROPOSAL (as the model extracted it)');
  console.log('═'.repeat(72));
  console.log(`  PI            ${pInfo.principalInvestigator || pInfo.proposalAuthors || '(none)'}`);
  console.log(`  Co-Is         ${pInfo.coInvestigators || '(none)'}`);
  console.log(`  Institution   ${pInfo.authorInstitution || '(none)'}`);
  console.log(`  Primary area  ${pInfo.primaryResearchArea || '(none)'}`);

  const sugg = result.reviewerSuggestions || [];
  console.log('\n' + '═'.repeat(72));
  console.log(`REVIEWER SUGGESTIONS  (${sugg.length} total)`);
  console.log('═'.repeat(72));
  sugg.forEach((s, i) => {
    console.log(`\n${String(i + 1).padStart(2)}. ${s.name || '(no name)'}`);
    if (s.suggestedInstitution) console.log(`    Institution : ${s.suggestedInstitution}`);
    if (s.seniorityEstimate) console.log(`    Seniority   : ${s.seniorityEstimate}`);
    if (s.expertiseAreas?.length) console.log(`    Expertise   : ${s.expertiseAreas.join(', ')}`);
    if (s.reasoning) console.log(`    Reasoning   : ${trunc(s.reasoning, 600)}`);
  });

  // Quick eyeball aids for the post-S254 invariants.
  console.log('\n' + '═'.repeat(72));
  console.log('EYEBALL SUMMARY');
  console.log('═'.repeat(72));
  const seniority = {};
  for (const s of sugg) {
    const k = (s.seniorityEstimate || 'unspecified').trim();
    seniority[k] = (seniority[k] || 0) + 1;
  }
  console.log('  Seniority distribution (recency check — want active/mid-career, not all founders):');
  for (const [k, n] of Object.entries(seniority)) console.log(`    ${n}×  ${k}`);
  const reasoningWithConcernWords = sugg.filter((s) => /conflict|co-?author|coi|same institution|collaborat/i.test(s.reasoning || ''));
  console.log(`  REASONING fields mentioning conflict/COI words (must be ~0 — the model emits NO conflict output; COI is screened server-side): ${reasoningWithConcernWords.length}`);
  if (reasoningWithConcernWords.length) {
    reasoningWithConcernWords.forEach((s) => console.log(`    ⚠️  ${s.name}: "${trunc(s.reasoning, 160)}"`));
  }

  const prov = result.promptProvenance || {};
  console.log(`\n  Prompt source: ${prov.source}${prov.version != null ? ` v${prov.version}` : ''}${prov.overrideUsed ? ' (per-user override)' : ''}`);
  console.log(`  Model: ${result.model}${result.usedFallback ? ' (fallback)' : ''}`);
  console.log('\n(Read-only: no reviewer/grant/Blob writes. One api_usage_log telemetry row written by the LLM call.)');
}

main().catch((err) => {
  console.error('\nvalidate-reviewer-analyze failed:', err.message);
  process.exit(1);
});
