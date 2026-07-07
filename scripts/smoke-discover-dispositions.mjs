/**
 * Read-only LIVE smoke for the S238 discover-disposition fixes:
 *   1. Track-B `<3`-publication candidates are SURFACED with `lowPublicationCount`
 *      (not silently dropped) — `DiscoveryService.partitionByPublicationBar`.
 *   2. Reasoning-pass off-topic candidates are tagged `aiFlaggedNotRelevant`, kept,
 *      and sorted LAST by `rankAllCandidates` (not hard-dropped).
 *   3. Coauthor COI is GRADED (`coauthorCOIStrength` 'likely' vs 'possible').
 *
 * It mirrors the production /api/reviewer-finder/discover ROUTE orchestration (the
 * tagging + down-rank live in the route, not the service) WITHOUT its writes:
 *   - resolve request + download/parse the proposal (READ-ONLY Dynamics + Graph),
 *   - analyzeProposal (real LLM),
 *   - DiscoveryService.discover (real PubMed/arXiv/bioRxiv/chemRxiv/OpenAlex/ORCID),
 *   - replicate the route's post-discover sequence: proposal-author filter,
 *     institution-COI mark, coauthor-COI grading, discovered-reasoning (real LLM),
 *     aiFlaggedNotRelevant tag, rankAllCandidates.
 *
 * NOT side-effect-free: 2 real paid LLM calls + api_usage_log telemetry rows, same
 * as production. NO reviewer/grant/roster/Dataverse state is written (save-candidates
 * is never called). .env.local points at PROD (every call here is a read).
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/smoke-discover-dispositions.mjs --request <num|GUID>
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/smoke-discover-dispositions.mjs --request 1002852 --file-key "lib::folder::name"
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
      }
    }
  } catch { /* env may already be exported */ }
}
loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const out = { reviewerCount: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.request = next();
    else if (a === '--file-key') out.fileKey = next();
    else if (a === '--list-files') out.listFiles = true;
    else if (a === '--reviewer-count') out.reviewerCount = parseInt(next(), 10) || 12;
    else if (a === '--compare-file') out.compareFile = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}
if ((args.help || !args.request) && isCliEntrypoint()) {
  console.log('Usage: node scripts/smoke-discover-dispositions.mjs --request <num|GUID> [--list-files] [--file-key "lib::folder::name"] [--reviewer-count N]');
  process.exit(args.help ? 0 : 2);
}

export function buildSmokeDiscoverDispositionsAnalyzeOptions({ args: runArgs, requestContext, onProgress = () => {} }) {
  return {
    reviewerCount: runArgs.reviewerCount,
    temperature: 0.3,
    excludedNames: [],
    userProfileId: null,
    requestContext,
    onProgress,
  };
}

const fileKeyOf = (f) => `${f.library}::${f.folder}::${f.name}`;

// Mirror of grant-reporting classifyFile + load-proposal pickProposalBestGuess
// (kept in sync with validate-reviewer-analyze.mjs).
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

async function main() {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  const { DiscoveryService } = await import('../lib/services/discovery-service.js');
  const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
  const { deriveProposalAuthorNames } = await import('../lib/utils/proposal-authors.js');
  const { loadReviewerRequestContext } = await import('../lib/services/reviewer-request-context.js');

  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set (.env.local).'); process.exit(2); }

  // 1. Resolve request (READ-ONLY)
  enterDynamicsBypassForScript('smoke-discover-dispositions');
  const select = 'akoya_requestid,akoya_requestnum,akoya_title';
  let rec;
  if (GUID_RE.test(args.request)) {
    rec = await DynamicsService.getRecord('akoya_requests', args.request, { select });
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select, filter: `akoya_requestnum eq '${String(args.request).replace(/'/g, "''")}'`, top: 1,
    });
    if (!records?.length) { console.error(`No akoya_request '${args.request}'.`); process.exit(2); }
    rec = records[0];
  }
  const requestId = rec.akoya_requestid;
  const requestContext = await loadReviewerRequestContext(requestId);
  console.log('━'.repeat(76));
  console.log(`REQUEST  ${rec.akoya_requestnum}  ·  ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(76));

  // 2. List + pick + download proposal (READ-ONLY)
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
  if (args.listFiles) { allFiles.forEach((f) => console.log(`  [${f.classification.padEnd(9)}] ${fileKeyOf(f)}`)); return; }
  const picked = args.fileKey ? allFiles.find((f) => fileKeyOf(f) === args.fileKey) : pickProposalBestGuess(allFiles);
  if (!picked) { console.error('No proposal file. Use --list-files / --file-key.'); process.exit(2); }
  console.log(`PROPOSAL  ${fileKeyOf(picked)}`);
  const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  let text;
  if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)) {
    text = (await (await import('pdf-parse')).default(dl.buffer)).text;
  } else { text = dl.buffer.toString('utf8'); }
  if (!text || text.trim().length < 100) { console.error('Proposal text too short.'); process.exit(2); }
  console.log(`PARSED    ${text.length.toLocaleString()} chars (local parse — no Blob upload)\n`);

  // 3. Analyze (real LLM)
  await loadModelOverrides();
  const log = (p) => { if (['prompt_resolved', 'fallback', 'identity_resolving', 'coi_check', 'discovery'].includes(p.status) || p.stage === 'filtering') process.stdout.write('.'); };
  console.log('Analyzing proposal…');
  const analysis = await ClaudeReviewerService.analyzeProposal(
    text,
    process.env.CLAUDE_API_KEY,
    buildSmokeDiscoverDispositionsAnalyzeOptions({ args, requestContext }),
  );
  if (!analysis.success) { console.error('Analyze failed:', analysis); process.exit(1); }

  // 4. Discover (real DB/scholarly APIs) — Fix #1 (low-pub partition) happens here.
  console.log('Discovering (PubMed/arXiv/bioRxiv/chemRxiv/OpenAlex/ORCID)…');
  const discovery = await DiscoveryService.discover(analysis, {
    searchPubmed: true, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true, onProgress: log,
  });
  process.stdout.write('\n');

  // 5. Replicate the route's post-discover sequence (no writes).
  const proposalAuthors = deriveProposalAuthorNames(analysis.proposalInfo);
  const authorInstitution = analysis.proposalInfo?.authorInstitution;
  let verified = discovery.verified;
  if (proposalAuthors.length) verified = DeduplicationService.filterProposalAuthors(verified, proposalAuthors).filtered;
  if (authorInstitution) verified = DeduplicationService.markInstitutionCOI(verified, authorInstitution);
  // Fix #3 — coauthor-COI grading.
  if (proposalAuthors.length && verified.length) {
    console.log('Checking coauthor COI (graded)…');
    verified = await DiscoveryService.checkCoauthorshipsForCandidates(verified, proposalAuthors, () => {});
  }
  // Fix #2 — discovered reasoning (real LLM) sets isRelevant; tag + down-rank.
  let discovered = discovery.discovered;
  if (discovered.length) {
    console.log('Generating discovered reasoning (real LLM)…');
    discovered = await ClaudeReviewerService.generateDiscoveredReasoning(analysis.proposalInfo, discovered, process.env.CLAUDE_API_KEY, () => {}, null, {});
    discovered = discovered.map((c) => (c.isRelevant === false ? { ...c, aiFlaggedNotRelevant: true } : c));
  }
  const keywords = analysis.proposalInfo?.keywords?.split(',').map((k) => k.trim()).filter(Boolean) || [];
  const ranked = DiscoveryService.rankAllCandidates({ verified, discovered }, keywords);

  // 6. Report — one section per fix.
  const line = '─'.repeat(76);
  const trunc = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
  console.log(`\n${line}\nRESULTS: ${verified.length} verified · ${discovered.length} discovered · ${ranked.length} ranked\n${line}`);

  // Fix #1
  const lowPub = [...verified, ...discovered].filter((c) => c.lowPublicationCount);
  console.log(`\n■ FIX #1 — low-publication candidates SURFACED (not dropped): ${lowPub.length}`);
  if (lowPub.length) lowPub.forEach((c) => console.log(`    • ${c.name} — ${c.lowPublicationCountFound} pub(s) found, lowPublicationCount=${c.lowPublicationCount}`));
  else console.log('    (none under the bar this run — fix is exercised only when a candidate has <3 pubs)');

  // Fix #2
  const flagged = ranked.filter((c) => c.aiFlaggedNotRelevant);
  console.log(`\n■ FIX #2 — AI-flagged-off-topic SURFACED + ranked last: ${flagged.length}`);
  if (flagged.length) {
    flagged.forEach((c) => console.log(`    • ${c.name}`));
    const positions = flagged.map((c) => ranked.indexOf(c));
    const firstFlaggedPos = Math.min(...positions);
    const lastUnflaggedPos = ranked.reduce((acc, c, i) => (c.aiFlaggedNotRelevant ? acc : i), -1);
    const orderOk = firstFlaggedPos > lastUnflaggedPos;
    console.log(`    ranked-last check: all flagged appear after all unflagged → ${orderOk ? 'PASS ✓' : 'FAIL ✗'}`);
  } else {
    console.log('    (Claude marked none off-topic this run — fix is exercised only when isRelevant=No)');
  }

  // Fix #3
  const graded = [...verified, ...discovered].filter((c) => c.coauthorCOIStrength);
  console.log(`\n■ FIX #3 — graded coauthor COI: ${graded.length} candidate(s) with a strength`);
  if (graded.length) {
    graded.forEach((c) => console.log(`    • ${c.name} — ${c.coauthorCOIStrength.toUpperCase()} (max ${c.coauthorMaxWithOneAuthor} w/ one author, ${c.coauthorSharedPaperTotal} total)`));
    const anyPossible = graded.some((c) => c.coauthorCOIStrength === 'possible');
    const anyLikely = graded.some((c) => c.coauthorCOIStrength === 'likely');
    console.log(`    grades present: ${anyLikely ? "'likely' " : ''}${anyPossible ? "'possible'" : ''}`.trim() || '    (only one tier this run)');
  } else {
    console.log('    (no coauthor overlaps with proposal authors this run)');
  }

  // ── Lane attribution + roster/ranked dump (S238 recall investigation) ──
  // In the combined ranked list, isClaudeSuggestion===true marks the Track-A / spine
  // lane (Claude-suggested, identity-verified) and false marks the Track-B keyword
  // discovery lane. This is the exact distinction the production "Literature-retrieved"
  // group blurs (it folds spine-verified Claude suggestions in with DB discoveries).
  const laneOf = (c) => (c.isClaudeSuggestion ? 'A' : 'B'); // A = Track-A/spine, B = Track-B keyword
  const idOf = (c) => c.identityStatus || c.verificationStatus || (c.verified ? 'verified' : 'unresolved');
  const flagsOf = (c) => {
    const t = [];
    if (c.lowPublicationCount) t.push(`low-pub(${c.lowPublicationCountFound})`);
    if (c.aiFlaggedNotRelevant) t.push('off-topic');
    if (c.coauthorCOIStrength) t.push(`COI:${c.coauthorCOIStrength}`);
    return t.length ? t.join(',') : '—';
  };

  const trackA = ranked.filter((c) => c.isClaudeSuggestion);
  console.log(`\n${line}\nVERIFIED / TRACK-A (spine-verified Claude suggestions) — ${trackA.length}\n${line}`);
  trackA.forEach((c) => console.log(`  [${idOf(c).padEnd(10)}] ${c.name}  ·  ${(Array.isArray(c.sources) ? c.sources.join('+') : c.source) || '—'}  ·  ${flagsOf(c)}`));

  console.log(`\n${line}\nFULL RANKED LIST (${ranked.length}) — pos · lane · identity · flags · name\n${line}`);
  ranked.forEach((c, i) => console.log(`  ${String(i + 1).padStart(3)}. ${laneOf(c)} · ${idOf(c).padEnd(10)} · ${flagsOf(c).padEnd(22)} · ${c.name}`));

  // ── Overlap vs a known reviewer set (e.g. a prior production run) ──
  if (args.compareFile) {
    const compareNames = readFileSync(args.compareFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
    console.log(`\n${line}\nOVERLAP vs ${args.compareFile} (${compareNames.length} names)\n${line}`);
    const buckets = { 'TRACK-A (clean slate)': [], 'TRACK-B clean': [], 'TRACK-B weak tail (low-pub/off-topic)': [], ABSENT: [] };
    for (const name of compareNames) {
      const matches = ranked.filter((c) => DeduplicationService.areNamesSimilar(name, c.name));
      if (matches.length === 0) { buckets.ABSENT.push(`${name}`); continue; }
      // Prefer the strongest match (Track-A, then clean Track-B, then weak).
      const best = matches.sort((a, b) => {
        const score = (c) => (c.isClaudeSuggestion ? 3 : 0) + (!c.lowPublicationCount && !c.aiFlaggedNotRelevant ? 1 : 0);
        return score(b) - score(a);
      })[0];
      const pos = ranked.indexOf(best) + 1;
      const tag = `${name}  →  matched "${best.name}" (rank ${pos}, ${idOf(best)}, ${flagsOf(best)})`;
      if (best.isClaudeSuggestion) buckets['TRACK-A (clean slate)'].push(tag);
      else if (!best.lowPublicationCount && !best.aiFlaggedNotRelevant) buckets['TRACK-B clean'].push(tag);
      else buckets['TRACK-B weak tail (low-pub/off-topic)'].push(tag);
    }
    for (const [bucket, items] of Object.entries(buckets)) {
      console.log(`\n  ▸ ${bucket}: ${items.length}`);
      items.forEach((t) => console.log(`      • ${t}`));
    }
    const surfaced = compareNames.length - buckets.ABSENT.length;
    console.log(`\n  SUMMARY: ${surfaced}/${compareNames.length} surfaced anywhere · ${buckets['TRACK-A (clean slate)'].length + buckets['TRACK-B clean'].length} on a clean slate · ${buckets.ABSENT.length} absent`);
  }

  console.log(`\n${line}`);
  console.log('Read-only: no reviewer/grant/roster/Dataverse writes. LLM telemetry rows written as in prod.');
  console.log(line);
}

if (isCliEntrypoint()) {
  main().catch((err) => { console.error('\nsmoke-discover-dispositions failed:', err.stack || err.message); process.exit(1); });
}
