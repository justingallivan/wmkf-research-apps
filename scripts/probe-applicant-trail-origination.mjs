/**
 * probe-applicant-trail-origination — test the Tier-3 "applicant publication
 * trail" origination path for SPARSE proposals (no bibliography this cycle).
 *
 * See docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md (Tier 3 + §5.6
 * work-graph expansion). The probe in scripts/probe-grounded-origination.mjs
 * showed 2/3 Phase I proposals have ZERO inline DOIs, so Tiers 1–2 are mostly
 * empty and Tier 3 is the de-facto spine. This tests whether it carries.
 *
 * Idea: the proposal may cite nothing, but the PI always has a publication
 * record. Resolve the PI → their recent works → the works THEY cite
 * (referenced_works = a synthesized bibliography) → those authors = the
 * surrounding field. Subtract the PI's own collaboration neighborhood (COI).
 * People are only ever derived from real OpenAlex works — the LLM names nobody.
 *
 * READ-ONLY. 1 paid LLM call per request (analyze, to extract PI + institution +
 * co-investigators) + free public OpenAlex calls. With --compare, also runs the
 * current discovery pipeline (more LLM calls) for overlap. No writes.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-applicant-trail-origination.mjs --request <num|GUID>
 *       [--file-key "lib::folder::name"] [--list-files] [--years 5] [--max-refs 200] [--compare]
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
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || 'justingallivan@me.com';
const OA = 'https://api.openalex.org';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { reviewerCount: 12, years: 5, maxRefs: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.request = next();
    else if (a === '--file-key') out.fileKey = next();
    else if (a === '--list-files') out.listFiles = true;
    else if (a === '--years') out.years = parseInt(next(), 10) || 5;
    else if (a === '--max-refs') out.maxRefs = parseInt(next(), 10) || 200;
    else if (a === '--compare') out.compare = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.request) {
  console.log('Usage: node scripts/probe-applicant-trail-origination.mjs --request <num|GUID> [--file-key "..."] [--list-files] [--years 5] [--max-refs 200] [--compare]');
  process.exit(args.help ? 0 : 2);
}

const fileKeyOf = (f) => `${f.library}::${f.folder}::${f.name}`;
const shortId = (id) => String(id || '').split('/').pop();
const clean = (n) => String(n || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 2);
function tokenOverlap(a, b) {
  const A = new Set(tokens(a)); const B = tokens(b);
  if (!A.size || !B.length) return 0;
  const hit = B.filter((t) => A.has(t)).length;
  return hit / Math.min(A.size, B.length);
}

// ── proposal-file classification (mirror of the other reviewer probes) ──
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
    const r = await fetch(url, { headers: { 'User-Agent': `wmkf-probe (mailto:${MAILTO})` } });
    if (!r.ok) return { __err: r.status };
    return await r.json();
  } catch (e) { return { __err: e.message }; }
}

// ── PI name parsing + forename gate (verify-fail-dangerous guard) ──
function piNameParts(name) {
  const parts = clean(name).split(/\s+/).filter(Boolean);
  if (!parts.length) return { forename: '', surname: '' };
  return { forename: parts[0], surname: parts[parts.length - 1] };
}
function nameMatches(piName, candName) {
  const a = piNameParts(piName); const b = piNameParts(candName);
  if (!a.surname || !b.surname) return false;
  if (a.surname.toLowerCase() !== b.surname.toLowerCase()) return false;
  const af = a.forename.toLowerCase().replace(/\.$/, '');
  const bf = b.forename.toLowerCase().replace(/\.$/, '');
  if (!af || !bf || af[0] !== bf[0]) return false;          // forename-initial gate: Wen != Yanping
  if (af.length > 1 && bf.length > 1) return af === bf;      // both full words → must be equal
  return true;                                               // one side is an initial sharing the first letter
}
// Drop Claude's institution hedges/parentheticals — a parametric "(Wayne State, based on
// known affiliation…)" guess is NOT cover-page ground truth and must not anchor resolution.
function cleanInstitution(inst) {
  if (!inst) return null;
  const s = String(inst).replace(/\([^)]*\)/g, '').trim();
  if (!s || /not specified|not stated|not explicitly|unknown|^n\/?a$|^none$/i.test(s)) return null;
  return s;
}

// ── Tier 3 step 1: resolve PI → OpenAlex author (the namesake-hazard step) ──
async function resolvePiAuthor(name, institution) {
  const instClean = cleanInstitution(institution);
  const j = await jget(`${OA}/authors?search=${encodeURIComponent(clean(name))}&per-page=25&mailto=${MAILTO}`);
  if (j.__err) return { err: j.__err };
  // Hard forename+surname gate FIRST — only same-name people are even eligible.
  const gated = (j.results || []).filter((r) => nameMatches(name, r.display_name)).map((r) => {
    const inst = (r.last_known_institutions || []).map((i) => i.display_name).join(' ');
    const instMatch = instClean ? tokenOverlap(instClean, inst) : 0;
    const score = (instMatch >= 0.34 ? 3 : 0) + (r.orcid ? 1 : 0) + Math.log10((r.works_count || 0) + 1);
    return { id: r.id, name: r.display_name, orcid: r.orcid, works: r.works_count, inst, instMatch, score };
  }).sort((a, b) => b.score - a.score);
  const best = gated[0]; const runner = gated[1];
  // Confident ONLY when we can actually disambiguate: an institution anchor matches,
  // or there is exactly one name-gated candidate. Works_count/ORCID alone do NOT
  // disambiguate among many same-name people without an anchor → abstain.
  const confident = !!best && ((instClean && best.instMatch >= 0.34) || gated.length === 1);
  return { best, runner, confident, gatedCount: gated.length, instClean, searched: (j.results || []).length };
}

async function piRecentWorks(authorId, fromDate) {
  const works = [];
  let cursor = '*';
  for (let page = 0; page < 3 && cursor; page += 1) {
    const url = `${OA}/works?filter=author.id:${shortId(authorId)},from_publication_date:${fromDate}`
      + `&select=id,title,publication_year,authorships,referenced_works&per-page=200&cursor=${cursor}&mailto=${MAILTO}`;
    const j = await jget(url);
    if (j.__err) break;
    works.push(...(j.results || []));
    cursor = j.meta?.next_cursor || null;
    if (!j.results?.length) break;
    await sleep(120);
  }
  return works;
}

async function resolveWork(workId) {
  const j = await jget(`${OA}/works/${shortId(workId)}?select=id,title,publication_year,authorships&mailto=${MAILTO}`);
  if (j.__err) return null;
  return j;
}

async function main() {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  const { deriveProposalAuthorNames } = await import('../lib/utils/proposal-authors.js');

  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set (.env.local).'); process.exit(2); }

  // 1. Resolve request + proposal (READ-ONLY) — same loader as the other probes.
  enterDynamicsBypassForScript('probe-applicant-trail-origination');
  let rec;
  if (GUID_RE.test(args.request)) {
    rec = await DynamicsService.getRecord('akoya_requests', args.request, { select: 'akoya_requestid,akoya_requestnum,akoya_title' });
  } else {
    const { records } = await DynamicsService.queryRecords('akoya_requests', {
      select: 'akoya_requestid,akoya_requestnum,akoya_title', filter: `akoya_requestnum eq '${String(args.request).replace(/'/g, "''")}'`, top: 1,
    });
    if (!records?.length) { console.error(`No akoya_request '${args.request}'.`); process.exit(2); }
    rec = records[0];
  }
  const line = '─'.repeat(78);
  console.log('━'.repeat(78));
  console.log(`REQUEST  ${rec.akoya_requestnum}  ·  ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(78));

  const buckets = await getRequestSharePointBuckets(rec.akoya_requestid, rec.akoya_requestnum);
  const bucketResults = await Promise.all(buckets.map(async (b) => {
    try { return { ...b, files: await GraphService.listFiles(b.library, b.folder, { recursive: true }) }; }
    catch { return { ...b, files: [] }; }
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
  const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  let text;
  if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)) {
    text = (await (await import('pdf-parse')).default(dl.buffer)).text;
  } else { text = dl.buffer.toString('utf8'); }
  if (!text || text.trim().length < 100) { console.error('Proposal text too short.'); process.exit(2); }

  // 2. Analyze (real LLM) — only to extract PI + institution + co-investigators.
  await loadModelOverrides();
  console.log('Analyzing proposal (real LLM, for PI + institution only)…');
  const analysis = await ClaudeReviewerService.analyzeProposal(text, process.env.CLAUDE_API_KEY, {
    reviewerCount: args.reviewerCount, temperature: 0.3, excludedNames: [], userProfileId: null, onProgress: () => {},
  });
  if (!analysis.success) { console.error('Analyze failed:', analysis); process.exit(1); }
  const pi = analysis.proposalInfo?.principalInvestigator || analysis.proposalInfo?.proposalAuthors;
  const institution = analysis.proposalInfo?.authorInstitution;
  const proposalAuthors = deriveProposalAuthorNames(analysis.proposalInfo); // PI + co-investigators
  console.log(`PI: ${pi || '(none extracted)'}  ·  Institution: ${institution || '(none)'}\n`);
  if (!pi) { console.error('No PI extracted — Tier 3 cannot start.'); process.exit(1); }

  // ── Tier 3 step 1: resolve PI ──
  const fromDate = (() => { const d = new Date(); return `${d.getFullYear() - args.years}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  console.log(`${line}\nSTEP 1 — resolve PI → OpenAlex author (namesake-hazard step)\n${line}`);
  const piRes = await resolvePiAuthor(pi, institution);
  if (piRes.err) { console.error(`  PI author search failed (${piRes.err}).`); process.exit(1); }
  console.log(`  cleaned institution anchor: ${piRes.instClean || '(none usable — cover page did not state it)'}`);
  console.log(`  name-gated candidates (forename+surname match): ${piRes.gatedCount} of ${piRes.searched} searched`);
  if (!piRes.best) {
    console.log('\n  ► ABSTAIN — no OpenAlex author passes the forename+surname gate. Tier 3 yields nothing safely for this proposal.');
    process.exit(0);
  }
  const b = piRes.best;
  console.log(`  best: ${b.name}  [${shortId(b.id)}]  works=${b.works}  orcid=${b.orcid ? 'Y' : '.'}  inst="${(b.inst || '—').slice(0, 60)}" (match ${(b.instMatch * 100).toFixed(0)}%)`);
  if (piRes.runner) console.log(`  runner-up: ${piRes.runner.name} works=${piRes.runner.works} inst-match ${(piRes.runner.instMatch * 100).toFixed(0)}%`);
  if (!piRes.confident) {
    console.log(`\n  ► ABSTAIN — cannot disambiguate ${piRes.gatedCount} same-name candidates without an institution anchor or in-hand ORCID.`);
    console.log('    This is the correct fail-closed behavior (strategy §8). Tier 3 cannot safely carry this proposal;');
    console.log('    it must fall through to peer-group / topic tiers. (A common-name PI with no stated institution.)');
    process.exit(0);
  }
  console.log('  confidence: CONFIDENT (institution-anchored, or a unique name match)');

  // ── Tier 3 step 2: PI recent works ──
  const piWorks = await piRecentWorks(b.id, fromDate);
  console.log(`\n${line}\nSTEP 2 — PI recent works (≥${fromDate}): ${piWorks.length}\n${line}`);
  if (!piWorks.length) { console.log('  No recent PI works — Tier 3 yields nothing for this proposal.'); process.exit(0); }

  // ── COI set: PI + co-authors (collaboration neighborhood) + named co-investigators ──
  const coiIds = new Set([shortId(b.id)]);
  const coAuthorNames = new Set();
  for (const w of piWorks) {
    for (const a of (w.authorships || [])) {
      const aid = shortId(a.author?.id);
      if (aid && aid !== shortId(b.id)) { coiIds.add(aid); coAuthorNames.add(a.author?.display_name); }
    }
  }
  console.log(`  COI exclusion set: PI + ${coiIds.size - 1} co-authors (collaboration neighborhood) + ${proposalAuthors.length} proposal-named`);

  // ── Tier 3 step 3: outward expansion = the works the PI cites (synthesized bibliography) ──
  const refIds = [];
  const refSeen = new Set();
  // Prioritize references of the MOST RECENT PI works first (most likely on-topic for a continuing line).
  const piWorksByRecency = piWorks.slice().sort((a, b2) => (b2.publication_year || 0) - (a.publication_year || 0));
  for (const w of piWorksByRecency) {
    for (const rid of (w.referenced_works || [])) {
      const s = shortId(rid);
      if (!refSeen.has(s)) { refSeen.add(s); refIds.push(s); }
    }
  }
  const cap = Math.min(refIds.length, args.maxRefs);
  console.log(`\n${line}\nSTEP 3 — synthesized bibliography: ${refIds.length} distinct works the PI cites\n${line}`);
  if (refIds.length > cap) console.log(`  ⚠ resolving ${cap}/${refIds.length} (--max-refs); ${refIds.length - cap} NOT resolved this run`);

  // ── Tier 3 step 4: resolve referenced works → authors, tally field experts (minus COI) ──
  const experts = new Map(); // id -> {id, name, freq, recentYear, recentTitle}
  const anchorTitles = [];
  let resolved = 0;
  for (const rid of refIds.slice(0, cap)) {
    const w = await resolveWork(rid);
    await sleep(80);
    if (!w) continue;
    resolved += 1;
    if (anchorTitles.length < 12 && w.title) anchorTitles.push(`(${w.publication_year || '?'}) ${w.title}`);
    for (const a of (w.authorships || [])) {
      const aid = shortId(a.author?.id);
      if (!aid || coiIds.has(aid)) continue; // drop COI (PI + collaborators)
      const e = experts.get(aid) || { id: aid, name: a.author?.display_name, freq: 0, recentYear: 0, recentTitle: '' };
      e.freq += 1;
      if ((w.publication_year || 0) > e.recentYear) { e.recentYear = w.publication_year || 0; e.recentTitle = w.title || ''; }
      experts.set(aid, e);
    }
  }
  // Rank: cited across multiple PI works (freq) then recency.
  const ranked = [...experts.values()].sort((a, b2) => b2.freq - a.freq || b2.recentYear - a.recentYear);

  console.log(`  resolved ${resolved}/${cap} cited works → ${ranked.length} distinct non-COI field authors`);
  console.log('\n  sample of synthesized-bibliography ANCHOR titles (judge: do these match THIS proposal?):');
  anchorTitles.forEach((t) => console.log(`     • ${t.slice(0, 96)}`));

  console.log(`\n${line}\nTIER-3 FIELD EXPERTS (grounded, COI-clean) — top 25 by cite-frequency then recency\n${line}`);
  ranked.slice(0, 25).forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. [${String(e.freq).padStart(2)}× · ${e.recentYear || '?'}] ${e.name}`));

  // ── Optional: overlap vs the CURRENT keyword pipeline (extra LLM calls) ──
  if (args.compare) {
    const { DiscoveryService } = await import('../lib/services/discovery-service.js');
    const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
    console.log(`\n${line}\nOVERLAP vs CURRENT keyword pipeline (running real discovery…)\n${line}`);
    const discovery = await DiscoveryService.discover(analysis, { searchPubmed: true, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true, onProgress: () => {} });
    const pool = [...discovery.verified, ...discovery.discovered].map((c) => c.name);
    const top = ranked.slice(0, 25);
    const inPool = top.filter((e) => pool.some((n) => DeduplicationService.areNamesSimilar(n, e.name)));
    console.log(`  ${inPool.length}/${top.length} of Tier-3 top-25 are ALSO in the current pool (${pool.length} candidates).`);
    console.log(`  ⇒ ${top.length - inPool.length}/${top.length} are NEW grounded experts the keyword pipeline missed.`);
  }

  console.log(`\n${line}`);
  console.log('Read-only: no reviewer/grant/roster/Dataverse writes. People derived ONLY from real OpenAlex works (LLM named nobody).');
  console.log('Watch-outs: (1) PI-resolution confidence above — a wrong PI poisons everything; (2) anchor titles — if they');
  console.log('do not match the proposal, the PI pivoted topics and the trail is off-field; (3) references skew to foundational');
  console.log('work, so recency-weighting matters for active-vs-emeritus.');
  console.log(line);
}

main().catch((err) => { console.error('\nprobe-applicant-trail-origination failed:', err.stack || err.message); process.exit(1); });
