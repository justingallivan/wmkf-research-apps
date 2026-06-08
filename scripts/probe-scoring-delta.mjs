/**
 * Read-only probe: quantify the reviewer-ranking delta introduced by the
 * provenance-DTO migration (Session 232) on REAL candidates.
 *
 * It runs the production analyze → discover pipeline for one or more real
 * requests (no writes beyond the analyze LLM telemetry row, same as
 * validate-reviewer-analyze.mjs), then scores every surfaced candidate under:
 *   - OLD scoring (pre-Codex): +25 for isClaudeSuggestion; multi-source via
 *     Set([source, verificationSource]); i.e. the candidate's Codex-added
 *     `sources[]` array is stripped so the Set branch fires as it did before.
 *   - NEW scoring (post-Codex): the live scoreRelevance() as it stands now
 *     (grounded-provenance bonus only; multi-source via the populated sources[]).
 *
 * Prints, per request: candidates ranked OLD vs NEW, per-candidate delta + track,
 * and any rank-order crossovers (a Track-A candidate dropping below a Track-B one
 * it previously outranked). Keyword bonus is the REAL proposal-keyword bonus
 * (identical old↔new, so it never affects the delta — only absolute order).
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-scoring-delta.mjs --request 1002959 [--request 1002896 ...]
 *   flags: --reviewer-count N (default 12), --temperature T (default 0.3)
 */
import { readFileSync } from 'node:fs';

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
  const out = { requests: [], reviewerCount: 12, temperature: 0.3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.requests.push(next());
    else if (a === '--reviewer-count') out.reviewerCount = parseInt(next(), 10) || 12;
    else if (a === '--temperature') out.temperature = parseFloat(next());
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (args.help || args.requests.length === 0) {
  console.log('Usage: node scripts/probe-scoring-delta.mjs --request <num|GUID> [--request <num> ...] [--reviewer-count N] [--temperature T]');
  process.exit(args.help ? 0 : 2);
}

// ── proposal-file helpers (copied from validate-reviewer-analyze.mjs) ──
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
  if (isProposal) return 'proposal';
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

// ── scoring: replicate recency + keyword exactly; OLD vs NEW differ only in
//    bonus predicate + multi-source branch ──
const YEARS_LOOKBACK = 5;
function recentPublicationCount(r) {
  if (Number.isFinite(r.publicationCount5yr)) return r.publicationCount5yr;
  const pubs = Array.isArray(r.publications) ? r.publications : [];
  if (pubs.length === 0) return 0;
  const cutoff = new Date().getFullYear() - YEARS_LOOKBACK;
  return pubs.filter((p) => (Number(p && p.year) || 0) >= cutoff).length;
}
function recencyPts(r) { return Math.min(35, 7 * Math.min(Math.max(0, recentPublicationCount(r)), 5)); }
function affiliationPts(r) { return (r.primaryAffiliation || r.affiliation) ? 10 : 0; }
function keywordPts(r, proposalKeywords) {
  const ck = r.keywords || r.expertiseAreas;
  if (proposalKeywords.length > 0 && Array.isArray(ck)) {
    const matching = proposalKeywords.filter((kw) => ck.some((rk) =>
      rk.toLowerCase().includes(kw.toLowerCase()) || kw.toLowerCase().includes(rk.toLowerCase())));
    return Math.min(matching.length * 3, 10);
  }
  return 0;
}
function oldScore(r, kw) {
  let s = 0;
  if (r.claudeSuggested || r.isClaudeSuggestion || r.source === 'claude_suggestion') s += 25;
  s += recencyPts(r);
  s += affiliationPts(r);
  // OLD multi-source: candidate had NO sources[] array → Set([source, verificationSource]).
  const sourceCount = new Set([r.source, r.verificationSource].filter(Boolean)).size || 1;
  s += Math.min(sourceCount * 5, 10);
  s += keywordPts(r, kw);
  return s;
}

async function runRequest(requestArg, ctx) {
  const { DynamicsService, GraphService, getRequestSharePointBuckets, loadModelOverrides, ClaudeReviewerService, DiscoveryService, scoreRelevance } = ctx;
  const select = 'akoya_requestid,akoya_requestnum,akoya_title';
  let rec;
  if (GUID_RE.test(requestArg)) rec = await DynamicsService.getRecord('akoya_requests', requestArg, { select });
  else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', { select, filter: `akoya_requestnum eq '${String(requestArg).replace(/'/g, "''")}'`, top: 1 });
    if (!records?.length) { console.error(`No request ${requestArg}`); return; }
    rec = records[0];
  }
  const requestId = rec.akoya_requestid;
  console.log('\n' + '━'.repeat(90));
  console.log(`REQUEST ${rec.akoya_requestnum} — ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(90));

  // download + parse proposal
  const buckets = await getRequestSharePointBuckets(requestId, rec.akoya_requestnum);
  const seen = new Set(); const allFiles = [];
  for (const b of buckets) {
    let raw = [];
    try { raw = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch { /* skip */ }
    for (const f of raw) {
      const folder = f.folder || b.folder; const key = `${b.library}::${folder}::${f.name}`;
      if (seen.has(key)) continue; seen.add(key);
      allFiles.push({ name: f.name, library: b.library, folder, classification: classifyFile(f.name) });
    }
  }
  const picked = pickProposalBestGuess(allFiles);
  if (!picked) { console.error('  No proposal file found; skipping.'); return; }
  const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  const isPdf = (dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name);
  let text;
  if (isPdf) { const pdfParse = (await import('pdf-parse')).default; text = (await pdfParse(dl.buffer)).text; }
  else if (/\.txt$/i.test(picked.name)) text = dl.buffer.toString('utf8');
  else { console.error(`  Proposal not PDF/text (${dl.mimeType}); skipping.`); return; }
  if (!text || text.trim().length < 100) { console.error('  Proposal text too short; skipping.'); return; }

  // analyze
  await loadModelOverrides();
  const analysis = await ClaudeReviewerService.analyzeProposal(text, process.env.CLAUDE_API_KEY, {
    reviewerCount: args.reviewerCount, temperature: args.temperature, excludedNames: [], userProfileId: null,
  });
  if (!analysis.success) { console.error('  Analyze failed:', analysis.status || analysis); return; }
  const proposalKeywords = (analysis.proposalInfo?.keywords || '').split(',').map((k) => k.trim()).filter(Boolean);

  // discover (Track A verify + Track B pubmed)
  const dr = await DiscoveryService.discover(analysis, { searchPubmed: true, searchArxiv: false, searchBiorxiv: true, searchChemrxiv: false });
  const candidates = [
    ...dr.verified.map((c) => ({ ...c, _track: 'A(verified)' })),
    ...dr.discovered.map((c) => ({ ...c, _track: 'B(discovered)' })),
  ];
  if (candidates.length === 0) { console.error('  0 candidates surfaced; skipping.'); return; }

  // score both ways
  const scored = candidates.map((c) => {
    const newS = scoreRelevance(c, proposalKeywords);
    const oldClone = { ...c }; delete oldClone.sources; // reconstruct pre-Codex shape
    const oldS = oldScore(oldClone, proposalKeywords);
    return { name: c.name, track: c._track, oldS, newS, delta: newS - oldS };
  });

  const byOld = [...scored].sort((a, b) => b.oldS - a.oldS);
  const byNew = [...scored].sort((a, b) => b.newS - a.newS);
  const oldRank = new Map(byOld.map((s, i) => [s.name, i + 1]));
  const newRank = new Map(byNew.map((s, i) => [s.name, i + 1]));

  console.log(`  keywords: ${proposalKeywords.join(', ') || '(none)'}`);
  console.log(`  candidates: ${candidates.length} (${dr.verified.length} Track-A, ${dr.discovered.length} Track-B)\n`);
  console.log('  OLD-rank → NEW-rank  | track          | oldScore newScore  Δ   | name');
  console.log('  ' + '-'.repeat(86));
  for (const s of byOld) {
    const or = oldRank.get(s.name), nr = newRank.get(s.name);
    const moved = nr > or ? `↓${nr - or}` : nr < or ? `↑${or - nr}` : ' =';
    console.log(`  #${String(or).padStart(2)} → #${String(nr).padStart(2)} ${moved.padStart(4)} | ${s.track.padEnd(14)} | ${String(s.oldS).padStart(7)} ${String(s.newS).padStart(7)}  ${String(s.delta).padStart(4)} | ${s.name}`);
  }

  // crossovers: an A candidate that drops below a B candidate it used to outrank
  let crossovers = 0;
  for (const a of scored.filter((s) => s.track.startsWith('A'))) {
    for (const b of scored.filter((s) => s.track.startsWith('B'))) {
      if (a.oldS > b.oldS && a.newS < b.newS) crossovers += 1;
    }
  }
  console.log(`\n  Track-A→B crossovers (A used to outrank B, now ranks below): ${crossovers}`);
  return { num: rec.akoya_requestnum, scored, crossovers };
}

async function main() {
  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set.'); process.exit(2); }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  const { DiscoveryService } = await import('../lib/services/discovery-service.js');
  const { scoreRelevance } = await import('../lib/utils/relevance-score.js');
  enterDynamicsBypassForScript('probe-scoring-delta');
  const ctx = { DynamicsService, GraphService, getRequestSharePointBuckets, loadModelOverrides, ClaudeReviewerService, DiscoveryService, scoreRelevance };

  const results = [];
  for (const r of args.requests) {
    try { const res = await runRequest(r, ctx); if (res) results.push(res); }
    catch (e) { console.error(`  request ${r} failed: ${e.message}`); }
  }

  // overall summary
  console.log('\n' + '═'.repeat(90));
  console.log('SUMMARY');
  console.log('═'.repeat(90));
  const all = results.flatMap((r) => r.scored);
  const aCands = all.filter((s) => s.track.startsWith('A'));
  const bCands = all.filter((s) => s.track.startsWith('B'));
  const deltas = aCands.map((s) => s.delta);
  const uniqueDeltas = [...new Set(deltas)].sort((a, b) => a - b);
  console.log(`  requests scored : ${results.length}`);
  console.log(`  Track-A candidates: ${aCands.length} — delta values seen: ${uniqueDeltas.join(', ') || '(none)'}`);
  console.log(`  Track-B candidates: ${bCands.length} — delta values seen: ${[...new Set(bCands.map((s) => s.delta))].join(', ') || '(none)'}`);
  console.log(`  total Track-A→B crossovers: ${results.reduce((n, r) => n + r.crossovers, 0)}`);
}
main().catch((e) => { console.error('\nprobe-scoring-delta failed:', e.message); process.exit(1); });
