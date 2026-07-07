/**
 * trace-reviewer-provenance — answer "are the Claude/proposal-named suggestions hitting,
 * or getting clobbered?" by running the REAL analyze -> DiscoveryService.discover() pipeline
 * for a request and logging, per candidate: track (A=Claude / B=discovered), raw SOURCE,
 * provenance kind, UI group, and verified/unverified disposition. Plus a clobber check:
 * proposal_named suggestions that landed in `unverified` AND have a same-name twin in
 * `discovered` (Track-B arxiv/pubmed) — the dedup gap at discover() lines 232-238.
 *
 * Read-only except the analyze LLM call + scholarly API lookups (public names only).
 * Mirrors the user's physics flow: PubMed deselected (so the ORCID spine runs on Track A).
 *
 * Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/trace-reviewer-provenance.mjs \
 *   --request 1002794 [--reviewer-count 12] [--pubmed]
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
function loadEnvLocal() { try { const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); for (const l of env.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); } } catch {} }
loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const args = (() => { const o = { request: null, reviewerCount: 12, pubmed: false }; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i] === '--request') o.request = a[++i]; else if (a[i] === '--reviewer-count') o.reviewerCount = parseInt(a[++i], 10) || 12; else if (a[i] === '--pubmed') o.pubmed = true; } return o; })();
if (!args.request && isCliEntrypoint()) { console.log('Usage: --request <requestNum|guid> [--reviewer-count N] [--pubmed]'); process.exit(2); }

export function buildTraceAnalyzeOptions({ args: runArgs, requestContext }) {
  return {
    reviewerCount: runArgs.reviewerCount,
    temperature: 0.3,
    excludedNames: [],
    userProfileId: null,
    requestContext,
  };
}

function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}

// proposal-file helpers (copied from eval-orcid-spine-constrained.mjs)
const SEP = '(?:^|[\\s_\\-])', SEP_END = '(?:[\\s_\\-]|$)'; const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');
function classifyFile(name) { const n = (name || '').toLowerCase(); if (wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n)) return 'other'; const hasNarr = /project[\s_\-]*(narrative|description)/i.test(n); const isFront = /cover[\s_\-]*(page|sheet|letter)/i.test(n) || /face[\s_\-]*page/i.test(n) || /title[\s_\-]*page/i.test(n) || /signature[\s_\-]*page/i.test(n) || /application[\s_\-]*form/i.test(n); if (isFront && !hasNarr) return 'other'; if (hasNarr || wordRe('phase[\\s_]?ii').test(n) || wordRe('proposal').test(n) || wordRe('application').test(n)) return 'proposal'; return 'other'; }
function pickProposal(files) { const p = files.filter((f) => f.classification === 'proposal'); if (!p.length) return null; const t1 = p.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name)); const t2 = p.filter((f) => /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i.test(f.name)); const ext = (n) => (n.toLowerCase().endsWith('.pdf') ? 0 : n.toLowerCase().endsWith('.docx') ? 1 : 2); const s = (a) => a.slice().sort((x, y) => ext(x.name) - ext(y.name)); return (t1.length ? s(t1) : t2.length ? s(t2) : s(p))[0]; }

async function main() {
  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set'); process.exit(2); }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  const { DiscoveryService } = await import('../lib/services/discovery-service.js');
  const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
  const { loadReviewerRequestContext } = await import('../lib/services/reviewer-request-context.js');
  const prov = await import('../lib/utils/reviewer-provenance.js');
  enterDynamicsBypassForScript('trace-reviewer-provenance'); await loadModelOverrides();

  // 1. Resolve request + load proposal text
  const reqArg = args.request;
  let rec;
  if (GUID_RE.test(reqArg)) rec = await DynamicsService.getRecord('akoya_requests', reqArg, { select: 'akoya_requestid,akoya_requestnum,akoya_title' });
  else { const { records } = await DynamicsService.queryRecords('akoya_requests', { select: 'akoya_requestid,akoya_requestnum,akoya_title', filter: `akoya_requestnum eq '${reqArg}'`, top: 1 }); rec = records?.[0]; }
  if (!rec) { console.error(`req ${reqArg}: not found`); process.exit(1); }
  const requestContext = await loadReviewerRequestContext(rec.akoya_requestid);

  const buckets = await getRequestSharePointBuckets(rec.akoya_requestid, rec.akoya_requestnum); const seen = new Set(); const files = [];
  for (const b of buckets) { let raw = []; try { raw = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch {} for (const f of raw) { const folder = f.folder || b.folder; const k = `${b.library}::${folder}::${f.name}`; if (seen.has(k)) continue; seen.add(k); files.push({ name: f.name, library: b.library, folder, classification: classifyFile(f.name) }); } }
  const picked = pickProposal(files); if (!picked) { console.error(`req ${rec.akoya_requestnum}: no proposal`); process.exit(1); }
  const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
  let text = null;
  if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)) { const pp = (await import('pdf-parse')).default; text = (await pp(dl.buffer)).text; } else if (/\.txt$/i.test(picked.name)) text = dl.buffer.toString('utf8');
  if (!text || text.trim().length < 100) { console.error(`req ${rec.akoya_requestnum}: text too short`); process.exit(1); }

  // 2. Analyze
  const analysis = await ClaudeReviewerService.analyzeProposal(
    text,
    process.env.CLAUDE_API_KEY,
    buildTraceAnalyzeOptions({ args, requestContext }),
  );
  if (!analysis?.success) { console.error(`analyze failed: ${analysis?.status}`); process.exit(1); }
  const field = analysis.proposalInfo?.primaryResearchArea || '';
  const suggestions = analysis.reviewerSuggestions || [];

  console.log(`\n${'='.repeat(90)}`);
  console.log(`REQUEST ${rec.akoya_requestnum} — ${field}`);
  console.log(`proposal file: ${picked.name}`);
  console.log(`searchPubmed=${args.pubmed}  searchArxiv=true (spine runs on Track A when pubmed off)`);
  console.log('='.repeat(90));

  // 3. Track A input: what did Claude generate, and what SOURCE did each carry?
  console.log(`\n--- TRACK A INPUT: ${suggestions.length} Claude suggestions ---`);
  const srcCounts = {};
  for (const s of suggestions) {
    const raw = (s.source || '(none)').trim();
    srcCounts[raw] = (srcCounts[raw] || 0) + 1;
    console.log(`  • ${s.name.padEnd(28)} SOURCE="${raw}"  inst="${s.suggestedInstitution || '-'}"`);
  }
  console.log(`  SOURCE histogram: ${JSON.stringify(srcCounts)}`);
  const proposalNamed = suggestions.filter((s) => /^mentioned in proposal$/i.test((s.source || '').trim()));
  console.log(`  => proposal_named suggestions: ${proposalNamed.length}  [${proposalNamed.map((s) => s.name).join(', ') || 'none'}]`);

  // 4. Run the REAL discover pipeline
  const results = await DiscoveryService.discover(analysis, {
    searchPubmed: args.pubmed, searchArxiv: true, searchBiorxiv: true, searchChemrxiv: true,
    onProgress: () => {},
  });

  const dump = (label, arr) => {
    console.log(`\n--- ${label}: ${arr.length} ---`);
    for (const c of arr) {
      let group = '?', plabel = '?';
      try { group = prov.provenanceGroupOf(c); } catch {}
      try { plabel = prov.provenanceLabelForCandidate(c); } catch {}
      console.log(`  • ${(c.name || '?').padEnd(28)} kind=${c.provenance?.kind || c.provenanceKind || '-'} src=${c.source || '-'} vStatus=${c.verificationStatus || '-'} idStatus=${c.identityStatus || '-'} group=${group} label="${plabel}"`);
    }
  };
  console.log(`\n${'#'.repeat(90)}\nDISCOVER OUTPUT  stats=${JSON.stringify(results.stats)}\n${'#'.repeat(90)}`);
  dump('TRACK A verified (selectable)', results.verified);
  dump('TRACK A unverified (needs-review/read-only)', results.unverified);
  dump('TRACK B discovered (arxiv/pubmed)', results.discovered);

  // 5. Clobber check: proposal_named that did NOT end up verified, and whether a
  //    same-name Track-B candidate surfaced in `discovered` (shadowing it).
  console.log(`\n${'='.repeat(90)}\nCLOBBER / LOSS ANALYSIS\n${'='.repeat(90)}`);
  const verifiedNames = results.verified.map((v) => v.name);
  for (const s of proposalNamed) {
    const inVerified = results.verified.find((v) => DeduplicationService.areNamesSimilar(v.name, s.name));
    const inUnverified = results.unverified.find((v) => DeduplicationService.areNamesSimilar(v.name, s.name));
    const twinInDiscovered = results.discovered.find((d) => DeduplicationService.areNamesSimilar(d.name, s.name));
    let verdict;
    if (inVerified) verdict = `VERIFIED+SELECTABLE as ${inVerified.provenance?.kind || inVerified.provenanceKind}`;
    else if (inUnverified && twinInDiscovered) verdict = `CLOBBERED: stranded in unverified, shadowed by Track-B "${twinInDiscovered.source}" twin`;
    else if (inUnverified) verdict = `STRANDED in unverified (needs-review), no Track-B twin`;
    else if (twinInDiscovered) verdict = `RELABELED: only appears as Track-B "${twinInDiscovered.source}" (proposal provenance lost)`;
    else verdict = `MISSING: not in any output bucket`;
    console.log(`  • ${s.name.padEnd(28)} ${verdict}`);
  }

  // 6. Group histogram across everything the UI would render
  const all = [...results.verified, ...results.unverified, ...results.discovered];
  const groupHist = {};
  for (const c of all) { let g = '?'; try { g = prov.provenanceGroupOf(c); } catch {} groupHist[g] = (groupHist[g] || 0) + 1; }
  console.log(`\nUI GROUP histogram (all buckets): ${JSON.stringify(groupHist)}`);
  console.log(`(The user saw ONLY "literature_retrieved". Compare.)`);
}
if (isCliEntrypoint()) main().catch((e) => { console.error('\nfailed:', e.stack || e.message); process.exit(1); });
