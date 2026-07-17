/**
 * probe-grounded-origination — test the "we never ask a source the question we
 * actually want" hypothesis for reviewer-finder ORIGINATION (recall).
 *
 * The current pipeline originates candidates two ways, NEITHER of which asks a
 * data source a person-level question:
 *   - Track A (PART 2 suggestions): Claude NAMES people from memory. Grounded
 *     only when later verified; the unverified tail is BARRED_PARAMETRIC.
 *   - Track B (PART 3 queries): Claude writes KEYWORD strings → PubMed/arXiv/etc.
 *     answer "which PAPERS match?" → people are reconstructed from one minted
 *     author slot per paper (QUERY_SEED). Pub-count = query-hit concentration.
 * The bibliography is never resolved to authors (provenance kind CITED_REFERENCE
 * + source reference_list are DEFINED but never minted — discovery-service.js:771).
 *
 * This probe adds the two GROUNDED, person-level lanes the redesign proposes and
 * measures, on a real request, how much they'd change origination:
 *   G1  OpenAlex author-aggregation over the SAME analyze facets (queries held
 *       constant) — group_by=authorships.author.id over the WHOLE matching
 *       corpus, ranked by real in-topic recent (≤5yr) output. Asks "who are the
 *       active authors on X?" directly.
 *   G2  Reference-DOI resolution — extract DOIs from the proposal text, resolve
 *       each to its real authors via OpenAlex. The PI's own curated map.
 *
 * Then it compares against the current pipeline's surfaced+ranked list, bucketed
 * by PROVENANCE ORIGIN (the "disease metric": what % of surfaced candidates trace
 * to a keyword/parametric GUESS vs a grounded pointer), and reports how many real,
 * in-topic-active authors the grounded lanes surface that the current pipeline
 * MISSES entirely (the recall gap).
 *
 * READ-ONLY w.r.t. live data. Same side-effect profile as smoke-discover-
 * dispositions: 2 paid LLM calls + api_usage_log rows; NO reviewer/grant/roster/
 * Dataverse writes. The only things sent to public scholarly APIs are (a) the
 * analyze keyword queries — which Track B already sends to PubMed/arXiv in prod —
 * and (b) public reference DOIs. No applicant identity, no raw proposal text leaves
 * the box.
 *
 * BLINDED SNIFF-TEST MODE (--blinded-sheet <dir>): in addition to the stdout
 * diagnostic, emits a per-request human-judgment harness for the origination
 * experiment (REVIEWER_FINDER_ORIGINATION_PLAN.md §3): a source-BLINDED, NAME-ONLY
 * candidate slate written to <dir>/<request>.sheet.md, plus a hidden arm-membership
 * key to <dir>/<request>.key.json. Three arms, deduped + shuffled under neutral IDs:
 *   A = current pipeline (Track A + Track B, ranked)
 *   B = grounded retrieval (G1 OpenAlex author-aggregation + G2 cited-author)
 *   C = applicant's recommended reviewers (Dataverse wmkf_potentialreviewer1..5)
 * Dataverse PI/Co-PIs + applicant-excluded names are dropped from arms A/B (self/COI;
 * never from C). NO per-candidate context is shown — name resolution from a bare name
 * is unreliable and would leak arm B (which is id-grounded by construction); the judge
 * resolves unrecognized names on demand. The judge sees only the sheet; the coordinator
 * rejoins arms via the key after judgment. This writes LOCAL files only — still NO
 * Dataverse/Postgres-roster writes. Keep <dir> out of git.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-grounded-origination.mjs --request <num|GUID>
 *       [--file-key "lib::folder::name"] [--list-files] [--reviewer-count N]
 *       [--years 5] [--per-facet 25] [--max-dois 80]
 *       [--blinded-sheet <dir>] [--arm1-cap 20] [--g1-top 15]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || '';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const OA = 'https://api.openalex.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { reviewerCount: 12, years: 5, perFacet: 25, maxDois: 80, arm1Cap: 20, g1Top: 15 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.request = next();
    else if (a === '--file-key') (out.fileKeys = out.fileKeys || []).push(next());
    else if (a === '--list-files') out.listFiles = true;
    else if (a === '--reviewer-count') out.reviewerCount = parseInt(next(), 10) || 12;
    else if (a === '--years') out.years = parseInt(next(), 10) || 5;
    else if (a === '--per-facet') out.perFacet = parseInt(next(), 10) || 25;
    else if (a === '--max-dois') out.maxDois = parseInt(next(), 10) || 80;
    else if (a === '--blinded-sheet') out.blindedSheet = next();
    else if (a === '--arm1-cap') out.arm1Cap = parseInt(next(), 10) || 20;
    else if (a === '--g1-top') out.g1Top = parseInt(next(), 10) || 15;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}
if ((args.help || !args.request) && isCliEntrypoint()) {
  console.log('Usage: node scripts/probe-grounded-origination.mjs --request <num|GUID> [--file-key "..."] [--list-files] [--reviewer-count N] [--years 5] [--per-facet 25] [--max-dois 80]');
  process.exit(args.help ? 0 : 2);
}

export function buildGroundedOriginationAnalyzeOptions({ args: runArgs, requestContext, onProgress = () => {} }) {
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

// ── proposal-file classification (mirror of smoke-discover-dispositions) ──
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

async function jget(url) {
  try {
    const requestUrl = new URL(url);
    if (requestUrl.hostname === 'api.openalex.org' && OPENALEX_API_KEY) {
      requestUrl.searchParams.set('api_key', OPENALEX_API_KEY);
    }
    const userAgent = MAILTO ? `wmkf-probe (mailto:${MAILTO})` : 'wmkf-probe';
    const r = await fetch(requestUrl, { headers: { 'User-Agent': userAgent } });
    if (!r.ok) return { __err: r.status };
    return await r.json();
  } catch (e) { return { __err: e.message }; }
}

const cleanName = (n) => String(n || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();

// ── G1: OpenAlex author-aggregation over a facet (person-level question) ──
// NOTE: per-page caps the number of group_by buckets returned (verified live:
// per-page=1 → 1 bucket, per-page=200 → 57). Use 200 (OpenAlex max) so the
// aggregation sees the whole author distribution, not just the top author.
async function aggregateAuthors(facet, fromDate, perFacet) {
  const filter = `title_and_abstract.search:${encodeURIComponent(facet)},from_publication_date:${fromDate}`;
  const url = `${OA}/works?filter=${filter}&group_by=authorships.author.id&per-page=200&mailto=${MAILTO}`;
  const j = await jget(url);
  if (j.__err) return { facet, err: j.__err, corpus: 0, authors: [] };
  const corpus = j.meta?.count || 0;
  const authors = (j.group_by || []).slice(0, perFacet).map((g) => ({
    id: g.key, name: g.key_display_name, count: g.count,
  }));
  return { facet, corpus, authors };
}

// ── G2: resolve a proposal DOI to its real authors (identity-anchored) ──
const DOI_RE = /10\.\d{4,9}\/[^\s"'<>)\]}]+/gi;
function extractDois(text) {
  const raw = (text.match(DOI_RE) || []).map((d) => d.replace(/[.,;:)\]}>]+$/, '').toLowerCase());
  return Array.from(new Set(raw));
}
async function resolveDoiAuthors(doi) {
  const url = `${OA}/works?filter=doi:${encodeURIComponent(doi)}&per-page=1&mailto=${MAILTO}`;
  const j = await jget(url);
  if (j.__err) return { doi, err: j.__err, authors: [] };
  const w = j.results?.[0];
  if (!w) return { doi, miss: true, authors: [] };
  const authors = (w.authorships || []).map((a, i) => ({
    id: a.author?.id, name: a.author?.display_name, position: a.author_position || (i === 0 ? 'first' : 'middle'),
  })).filter((a) => a.id);
  return { doi, title: w.title, authors };
}

// Per-candidate context (affiliation/topics) is deliberately NOT shown on the
// blinded sheet: reliable identity resolution from a free-text name is the hard
// reviewer-identity problem (famous names collide with prolific homonyms), and
// arm-B candidates carry correct OpenAlex ids by construction while arm-A/C names
// don't — so any context column would be systematically fuller for the grounded
// arm and leak it. The sheet shows NAME ONLY; the judge resolves anyone they don't
// recognize on demand (correct ORCID/PubMed dossier) before finalizing.

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Dataverse applicant context (ground truth for the blinded sniff test) ──
// One READ-ONLY getRecord on the request. processAnnotations() turns each
// `_<lookup>_value@…FormattedValue` into `_<lookup>_value_formatted`, so a single
// $select of the lookup *_value fields hands back display names with no extra
// round trips. Yields: PI + Co-PIs (self/COI exclusion), applicant institution
// (institution-COI tag), applicant recommended reviewers (Arm C ground truth),
// and the free-text excluded-reviewer list (dropped from the slate).
async function loadApplicantContext(DynamicsService, requestId) {
  const slotVals = (p, n) => Array.from({ length: n }, (_, i) => `_${p}${i + 1}_value`);
  const select = [
    '_wmkf_projectleader_value',
    ...slotVals('wmkf_copi', 5),
    '_akoya_applicantid_value',
    ...slotVals('wmkf_potentialreviewer', 5),
    'wmkf_excludedreviewers',
  ].join(',');
  const r = await DynamicsService.getRecord('akoya_requests', requestId, { select });
  const fmt = (k) => r[`${k}_formatted`] || null;
  const pi = fmt('_wmkf_projectleader_value');
  const coPis = [1, 2, 3, 4, 5].map((n) => fmt(`_wmkf_copi${n}_value`)).filter(Boolean);
  const institution = fmt('_akoya_applicantid_value');
  const recommended = [1, 2, 3, 4, 5].map((n) => fmt(`_wmkf_potentialreviewer${n}_value`)).filter(Boolean);
  const excludedText = (r.wmkf_excludedreviewers || '').trim();
  const excludedNames = excludedText
    ? excludedText.split(/[\n;,]|\band\b/i).map((s) => cleanName(s)).filter((s) => s.length > 2)
    : [];
  return { pi, coPis, institution, recommended, excludedText, excludedNames };
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
  const { provenanceKindOf, buildReviewerProvenance } = await import('../lib/utils/reviewer-provenance.js');
  const { loadReviewerRequestContext } = await import('../lib/services/reviewer-request-context.js');

  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set (.env.local).'); process.exit(2); }

  // 1. Resolve request (READ-ONLY)
  enterDynamicsBypassForScript('probe-grounded-origination');
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
  const line = '─'.repeat(78);
  console.log('━'.repeat(78));
  console.log(`REQUEST  ${rec.akoya_requestnum}  ·  ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(78));

  // Applicant ground truth (only needed for the blinded sniff-test sheet).
  const applicant = args.blindedSheet ? await loadApplicantContext(DynamicsService, requestId) : null;
  if (applicant) {
    console.log(`APPLICANT CONTEXT (Dataverse) · institution: ${applicant.institution || '—'}`);
    console.log(`  PI: ${applicant.pi || '—'} · Co-PIs: ${applicant.coPis.join(', ') || '—'}`);
    console.log(`  recommended reviewers (Arm C): ${applicant.recommended.join(', ') || '— (none on record)'}`);
    console.log(`  excluded reviewers: ${applicant.excludedNames.join(', ') || '—'}`);
  }

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
  // File selection: one or more explicit --file-key(s) → download + CONCATENATE in
  // the order given; else the single best-guess proposal. Concatenation faithfully
  // reconstructs cycles whose proposal context was split across documents (J26:
  // 1-page summary carrying the PEER GROUPS + 2-page description with the ideas) —
  // the document model is cycle-coupled (see project-reviewer-finder-proposal-doc-context).
  let pickedFiles;
  if (args.fileKeys?.length) {
    pickedFiles = args.fileKeys.map((k) => {
      const f = allFiles.find((af) => fileKeyOf(af) === k);
      if (!f) { console.error(`No file matching --file-key "${k}". Use --list-files.`); process.exit(2); }
      return f;
    });
  } else {
    const best = pickProposalBestGuess(allFiles);
    if (!best) { console.error('No proposal file. Use --list-files / --file-key.'); process.exit(2); }
    pickedFiles = [best];
  }
  async function parseFileText(f) {
    const dl = await GraphService.downloadFileByPath(f.library, f.folder, f.name);
    if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(f.name)) {
      return (await (await import('pdf-parse')).default(dl.buffer)).text;
    }
    return dl.buffer.toString('utf8');
  }
  const parts = [];
  for (const f of pickedFiles) {
    console.log(`PROPOSAL  ${fileKeyOf(f)}`);
    parts.push((await parseFileText(f)) || '');
  }
  const text = parts.join('\n\n===== DOCUMENT BREAK =====\n\n');
  if (!text || text.trim().length < 100) { console.error('Proposal text too short.'); process.exit(2); }
  console.log(`PARSED    ${text.length.toLocaleString()} chars${pickedFiles.length > 1 ? ` (${pickedFiles.length} docs concatenated)` : ''}\n`);

  // 3. Analyze (real LLM) — gives PART 1 keywords, PART 3 queries, PART 2 suggestions.
  await loadModelOverrides();
  console.log('Analyzing proposal (real LLM)…');
  const analysis = await ClaudeReviewerService.analyzeProposal(
    text,
    process.env.CLAUDE_API_KEY,
    buildGroundedOriginationAnalyzeOptions({ args, requestContext }),
  );
  if (!analysis.success) { console.error('Analyze failed:', analysis); process.exit(1); }
  const proposalAuthors = deriveProposalAuthorNames(analysis.proposalInfo);

  // 4. Current pipeline (real DB/scholarly APIs) + replicate route post-discover sequence.
  console.log('Discovering — CURRENT pipeline (Track A + Track B)…');
  const discovery = await DiscoveryService.discover(analysis, {
    searchPubmed: true, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true, onProgress: () => process.stdout.write('.'),
  });
  process.stdout.write('\n');
  let verified = discovery.verified;
  const authorInstitution = analysis.proposalInfo?.authorInstitution;
  if (proposalAuthors.length) verified = DeduplicationService.filterProposalAuthors(verified, proposalAuthors).filtered;
  if (authorInstitution) verified = DeduplicationService.markInstitutionCOI(verified, authorInstitution);
  let discovered = discovery.discovered;
  if (discovered.length) {
    discovered = await ClaudeReviewerService.generateDiscoveredReasoning(analysis.proposalInfo, discovered, process.env.CLAUDE_API_KEY, () => {}, null, {});
    discovered = discovered.map((c) => (c.isRelevant === false ? { ...c, aiFlaggedNotRelevant: true } : c));
  }
  const keywords = analysis.proposalInfo?.keywords?.split(',').map((k) => k.trim()).filter(Boolean) || [];
  const ranked = DiscoveryService.rankAllCandidates({ verified, discovered }, keywords);

  // ── DISEASE METRIC: bucket the current surfaced list by provenance origin ──
  const kindOf = (c) => { try { return provenanceKindOf(c); } catch { return 'unknown'; } };
  const seedOf = (c) => { try { return buildReviewerProvenance(c).seedRole; } catch { return 'unknown'; } };
  const GUESS_KINDS = new Set(['barred_parametric']);
  const KEYWORD_SEED = 'query_seed';
  const byKind = {}; const bySeed = {};
  let guessOrigin = 0; let groundedOrigin = 0;
  for (const c of ranked) {
    const k = kindOf(c); const s = seedOf(c);
    byKind[k] = (byKind[k] || 0) + 1;
    bySeed[s] = (bySeed[s] || 0) + 1;
    // "Guess-derived" = no grounded pointer to THIS person: barred parametric, OR a
    // literature-retrieved row whose ONLY origin is a keyword crawl (query_seed).
    if (GUESS_KINDS.has(k) || s === KEYWORD_SEED) guessOrigin += 1; else groundedOrigin += 1;
  }

  console.log(`${line}\nCURRENT PIPELINE — ${ranked.length} surfaced (${verified.length} verified · ${discovered.length} discovered)\n${line}`);
  console.log('  provenance KIND:');
  for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`     ${k.padEnd(22)} ${n}`);
  console.log('  seed ROLE:');
  for (const [s, n] of Object.entries(bySeed).sort((a, b) => b[1] - a[1])) console.log(`     ${s.padEnd(22)} ${n}`);
  const pct = (x) => (ranked.length ? Math.round((100 * x) / ranked.length) : 0);
  console.log(`\n  ► DISEASE METRIC: ${guessOrigin}/${ranked.length} (${pct(guessOrigin)}%) of surfaced candidates trace to a GUESS`);
  console.log(`    (keyword-crawl query_seed or barred parametric) · ${groundedOrigin}/${ranked.length} (${pct(groundedOrigin)}%) grounded-pointer.`);

  // ── G1: OpenAlex author-aggregation over the SAME analyze facets ──
  const today = new Date();
  const fromDate = `${today.getFullYear() - args.years}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const facets = Array.from(new Set([
    ...(analysis.searchQueries?.pubmed || []),
    ...(analysis.searchQueries?.arxiv || []),
    ...(analysis.searchQueries?.biorxiv || []),
    ...(analysis.searchQueries?.chemrxiv || []),
  ].map((q) => String(q || '').trim()).filter(Boolean)));
  console.log(`\n${line}\nGROUNDED LANE G1 — OpenAlex author-aggregation (≥${fromDate}) over ${facets.length} analyze facets\n${line}`);
  const g1AuthorsById = new Map(); // id -> {id, name, total, facets:Set}
  for (const facet of facets) {
    const r = await aggregateAuthors(facet, fromDate, args.perFacet);
    await sleep(120);
    if (r.err) { console.log(`  ✗ "${facet}" — err ${r.err}`); continue; }
    console.log(`  • "${facet}" — corpus ${r.corpus} works · top ${r.authors.length} authors`);
    for (const a of r.authors) {
      if (!a.id) continue;
      const e = g1AuthorsById.get(a.id) || { id: a.id, name: a.name, total: 0, facets: new Set() };
      e.total += a.count; e.facets.add(facet); g1AuthorsById.set(a.id, e);
    }
  }
  const g1Authors = [...g1AuthorsById.values()].sort((a, b) => b.facets.size - a.facets.size || b.total - a.total);
  console.log(`  → ${g1Authors.length} distinct in-topic-active authors across facets (identity-resolved, ranked by in-topic recent output).`);
  console.log('  top by facet-spread then output:');
  g1Authors.slice(0, 20).forEach((a) => console.log(`     [${a.facets.size}f · ${String(a.total).padStart(3)}w] ${a.name}`));

  // ── G2: reference-DOI resolution ──
  const dois = extractDois(text);
  console.log(`\n${line}\nGROUNDED LANE G2 — reference-DOI resolution\n${line}`);
  console.log(`  extracted ${dois.length} distinct DOIs from proposal text`);
  if (dois.length === 0) {
    // Distinguish "no DOIs in this proposal" from a parse/regex failure: report
    // whether a bibliography section + non-DOI citation markers are even present.
    const hasBib = /\b(references|bibliography|works cited|literature cited)\b/i.test(text);
    const bracketCites = (text.match(/\[\d{1,3}\]/g) || []).length;
    const doiLiteral = (text.match(/\bdoi\b/gi) || []).length;
    console.log(`  ⓘ G2 diagnostics — bibliography heading: ${hasBib ? 'present' : 'ABSENT'} · "[n]" cite markers: ${bracketCites} · literal "doi": ${doiLiteral}`);
    console.log('    (0 DOIs + present bibliography ⇒ author-year/numeric citations, no inline DOIs — the lane needs title/Crossref resolution, not DOI regex.)');
  }
  const doiCap = Math.min(dois.length, args.maxDois);
  if (dois.length > doiCap) console.log(`  ⚠ capping resolution at ${doiCap}/${dois.length} (--max-dois); ${dois.length - doiCap} NOT resolved this run`);
  const g2AuthorsById = new Map(); // id -> {id, name, doiCount, anyFirstLast}
  let resolved = 0; let missed = 0;
  for (const doi of dois.slice(0, doiCap)) {
    const r = await resolveDoiAuthors(doi);
    await sleep(120);
    if (r.err || r.miss) { missed += 1; continue; }
    resolved += 1;
    for (const a of r.authors) {
      const e = g2AuthorsById.get(a.id) || { id: a.id, name: a.name, doiCount: 0, anchor: false };
      e.doiCount += 1; if (a.position === 'first' || a.position === 'last') e.anchor = true; g2AuthorsById.set(a.id, e);
    }
  }
  const isProposalAuthor = (name) => proposalAuthors.some((pa) => DeduplicationService.areNamesSimilar(pa, name));
  const g2Authors = [...g2AuthorsById.values()]
    .filter((a) => !isProposalAuthor(a.name)) // drop self-citations (the PIs themselves)
    .sort((a, b) => b.doiCount - a.doiCount);
  console.log(`  resolved ${resolved}/${doiCap} DOIs (${missed} unresolved/not-in-OpenAlex) → ${g2Authors.length} distinct cited authors (self-citations dropped).`);
  console.log('  top cited authors (by # cited works):');
  g2Authors.slice(0, 15).forEach((a) => console.log(`     [${String(a.doiCount).padStart(2)} works${a.anchor ? ' · first/last' : ''}] ${a.name}`));

  // ── RECALL GAP: grounded-lane authors the CURRENT pipeline MISSES ──
  const inCurrent = (name) => ranked.some((c) => DeduplicationService.areNamesSimilar(name, c.name));
  // Top-N by the existing (facet-spread desc, then in-topic output desc) sort — a
  // representative slate. Multi-facet-only was too strict in fields where facets
  // are disjoint (it hid obvious single-facet leaders), so it under-reported the gap.
  const G1_N = 30;
  const G1_TOP = g1Authors.slice(0, G1_N);
  const g1MultiFacet = G1_TOP.filter((a) => a.facets.size >= 2).length;
  const g1Missed = G1_TOP.filter((a) => !inCurrent(a.name));
  const g2Strong = g2Authors.filter((a) => a.doiCount >= 2 || a.anchor);
  const g2Missed = g2Strong.filter((a) => !inCurrent(a.name));
  console.log(`\n${line}\nRECALL GAP — grounded, in-topic-active authors the CURRENT pipeline never surfaced\n${line}`);
  console.log(`  G1 (top ${G1_TOP.length} by spread+output; ${g1MultiFacet} span ≥2 facets): ${g1Missed.length}/${G1_TOP.length} ABSENT from current pipeline`);
  g1Missed.slice(0, 25).forEach((a) => console.log(`     ✗ ${a.name}  (${a.facets.size} facets, ${a.total}w)`));
  console.log(`  G2 (≥2 cited works or first/last author): ${g2Missed.length}/${g2Strong.length} ABSENT from current pipeline`);
  g2Missed.slice(0, 20).forEach((a) => console.log(`     ✗ ${a.name}  (${a.doiCount} cited works${a.anchor ? ', anchor' : ''})`));

  // ── BLINDED SNIFF-TEST SHEET + HIDDEN KEY ──
  if (args.blindedSheet) {
    console.log(`\n${line}\nBLINDED SNIFF-TEST — building source-blinded slate (arm 1 ∪ arm 2 ∪ arm C)\n${line}`);
    // Arm 1 = current pipeline's surfaced+ranked slate (capped). Arm 2 = grounded
    // G1 (top by spread+output) + G2 strong (≥2 cited works or first/last author).
    // Arm C = applicant's recommended reviewers from Dataverse (ground truth).
    const arm1 = ranked.slice(0, args.arm1Cap).map((c) => ({ name: cleanName(c.name), id: null, arms: ['A'] }));
    const arm2 = [
      ...g1Authors.slice(0, args.g1Top).map((a) => ({ name: cleanName(a.name), id: a.id, arms: ['B'] })),
      ...g2Authors.filter((a) => a.doiCount >= 2 || a.anchor).map((a) => ({ name: cleanName(a.name), id: a.id, arms: ['B'] })),
    ];
    const armC = (applicant?.recommended || []).map((n) => ({ name: cleanName(n), id: null, arms: ['C'] }));
    // Slate exclusion (COI/self) = LLM-derived proposal authors ∪ Dataverse PI/Co-PIs
    // ∪ applicant-excluded names. Applied to origination arms only — Arm C (the
    // applicant's own picks) is never dropped.
    const exclusionNames = [
      ...proposalAuthors,
      ...(applicant ? [applicant.pi, ...applicant.coPis, ...applicant.excludedNames] : []),
    ].filter(Boolean);
    const isExcludedName = (name) => exclusionNames.some((x) => DeduplicationService.areNamesSimilar(x, name));
    // Merge by name similarity; a person in multiple arms keeps every membership
    // (an Arm-A or Arm-B candidate that also lands in Arm C is the recall signal).
    const unified = [];
    const addCand = (c) => {
      if (!c.name) return;
      if (!c.arms.includes('C') && isExcludedName(c.name)) return; // drop self/COI from origination arms
      const hit = unified.find((u) => DeduplicationService.areNamesSimilar(u.name, c.name));
      if (hit) { c.arms.forEach((a) => { if (!hit.arms.includes(a)) hit.arms.push(a); }); if (!hit.id && c.id) hit.id = c.id; return; }
      unified.push({ name: c.name, id: c.id || null, arms: [...c.arms] });
    };
    [...arm1, ...arm2, ...armC].forEach(addCand);
    console.log(`  ${unified.length} distinct candidates (arm1 ${arm1.length} ∪ arm2 ${arm2.length} ∪ armC ${armC.length}, deduped, ${exclusionNames.length} self/COI/excluded names removed from origination arms)`);
    shuffleInPlace(unified);
    const reqNum = rec.akoya_requestnum;
    unified.forEach((c, i) => { c.blindId = `${reqNum}-${String(i + 1).padStart(2, '0')}`; });

    mkdirSync(args.blindedSheet, { recursive: true });
    const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    // Name-only sheet: arm/source hidden, NO context column (context can't be
    // resolved reliably from a name and would leak the grounded arm — see helper
    // note above). The judge resolves unrecognized names on demand.
    const rows = unified.map((c) => `| ${c.blindId} | ${esc(c.name)} | ☐ |`).join('\n');
    const sheet = `# Blinded reviewer sniff-test — Request ${reqNum}: ${rec.akoya_title || '(untitled)'}

For each candidate below, judge from the proposal context: **would you have picked this person as a potential reviewer for THIS proposal?**
Mark the last column **pick** or **no** (or fill the ☐). Source/arm is deliberately hidden.

No affiliation/field is shown — reliable identity resolution from a name alone is unreliable and would leak the arm. For any name you don't recognize, ask for a dossier (ORCID/PubMed) before deciding.

| ID | Name | Would pick? |
|----|------|-------------|
${rows}

**Coverage call:** could you staff a review panel from this slate? **yes / no** — and if no, what's missing?
`;
    const key = {
      request: reqNum,
      title: rec.akoya_title || null,
      arm1Cap: args.arm1Cap,
      g1Top: args.g1Top,
      applicant: applicant
        ? { institution: applicant.institution, pi: applicant.pi, coPis: applicant.coPis, recommended: applicant.recommended, excluded: applicant.excludedNames }
        : null,
      counts: { arm1: arm1.length, arm2: arm2.length, armC: armC.length, unified: unified.length },
      candidates: unified.map((c) => ({ blindId: c.blindId, name: c.name, arms: c.arms, oaId: c.id || null })),
    };
    const sheetPath = `${args.blindedSheet}/${reqNum}.sheet.md`;
    const keyPath = `${args.blindedSheet}/${reqNum}.key.json`;
    writeFileSync(sheetPath, sheet);
    writeFileSync(keyPath, `${JSON.stringify(key, null, 2)}\n`);
    const has = (c, a) => c.arms.includes(a);
    const cTotal = unified.filter((c) => has(c, 'C')).length;
    const cByA = unified.filter((c) => has(c, 'C') && has(c, 'A')).length;
    const cByB = unified.filter((c) => has(c, 'C') && has(c, 'B')).length;
    const abOverlap = unified.filter((c) => has(c, 'A') && has(c, 'B')).length;
    console.log(`  overlap — A∩B: ${abOverlap} · applicant-recommended(C) re-surfaced by A: ${cByA}/${cTotal} · by B: ${cByB}/${cTotal}`);
    console.log(`  ✎ blinded sheet → ${sheetPath}`);
    console.log(`  🔒 hidden key   → ${keyPath}   (do NOT show the judge until after judgment)`);
  }

  console.log(`\n${line}`);
  console.log('Read-only w.r.t. live data: no reviewer/grant/roster/Dataverse writes. LLM telemetry rows written as in prod.');
  console.log('Interpretation: high DISEASE % + large RECALL GAP ⇒ origination is the diseased layer and the');
  console.log('grounded person-level lanes recover candidates the keyword/parametric origination cannot.');
  console.log(line);
}

if (isCliEntrypoint()) {
  main().catch((err) => { console.error('\nprobe-grounded-origination failed:', err.stack || err.message); process.exit(1); });
}
