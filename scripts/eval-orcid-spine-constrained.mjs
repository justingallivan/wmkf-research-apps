/**
 * eval-orcid-spine-constrained — measure whether CONSTRAINED author selection (top-N
 * + affiliation/topic match + abstain) beats naive name→top-1 for the ORCID spine.
 *
 * Per suggested reviewer: fetch OpenAlex top-10 author records (each with ORCID,
 * last-known institution, top concepts). Pick the record matching the proposal's
 * claimed affiliation and/or field/expertise; if NONE match, ABSTAIN. Then corroborate
 * the winner's ORCID against its INDEPENDENT ORCID employment record (not OpenAlex's
 * institution field) to reduce circularity.
 *
 * Compares two policies on the cell that matters — "confidently wrong":
 *   - NAIVE      : take OpenAlex rank-1 by name.
 *   - CONSTRAINED: select-by-match-or-abstain.
 * Outcome per name: CONFIRMED (match + independent ORCID-employment corroboration),
 *   PLAUSIBLE (aff/topic match, no independent corroboration), ABSTAIN (no match → unresolved).
 *
 * Ground truth is a PROXY: Claude's claimed institution + proposal field for selection,
 * ORCID employment for INDEPENDENT corroboration. Surfaces rates, not a labeled benchmark.
 * Read-only except the analyze LLM call. Only public names go to scholarly APIs.
 *
 * Usage: node --import ./scripts/lib/use-extensionless.mjs scripts/eval-orcid-spine-constrained.mjs \
 *   --requests 1002794,1002896,1002959,1003005,1003020,1003024,1003075
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
function loadEnvLocal() { try { const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); for (const l of env.split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); } } catch {} }
loadEnvLocal();
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || ''; // polite pool only if a real mailbox is configured
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const args = (() => { const o = { requests: [], reviewerCount: 12 }; const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) { if (a[i] === '--requests') o.requests = a[++i].split(',').map((s) => s.trim()).filter(Boolean); else if (a[i] === '--reviewer-count') o.reviewerCount = parseInt(a[++i], 10) || 12; } return o; })();
function isCliEntrypoint() {
  return import.meta.url === pathToFileURL(process.argv[1] || '').href;
}
if (!args.requests.length && isCliEntrypoint()) { console.log('Usage: --requests <n1,n2,...>'); process.exit(2); }

export function buildOrcidSpineConstrainedAnalyzeOptions({ args: runArgs, requestContext }) {
  return {
    reviewerCount: runArgs.reviewerCount,
    temperature: 0.3,
    excludedNames: [],
    userProfileId: null,
    requestContext,
  };
}

// proposal-file helpers
const SEP = '(?:^|[\\s_\\-])', SEP_END = '(?:[\\s_\\-]|$)'; const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');
function classifyFile(name) { const n = (name || '').toLowerCase(); if (wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n)) return 'other'; const hasNarr = /project[\s_\-]*(narrative|description)/i.test(n); const isFront = /cover[\s_\-]*(page|sheet|letter)/i.test(n) || /face[\s_\-]*page/i.test(n) || /title[\s_\-]*page/i.test(n) || /signature[\s_\-]*page/i.test(n) || /application[\s_\-]*form/i.test(n); if (isFront && !hasNarr) return 'other'; if (hasNarr || wordRe('phase[\\s_]?ii').test(n) || wordRe('proposal').test(n) || wordRe('application').test(n)) return 'proposal'; return 'other'; }
function pickProposal(files) { const p = files.filter((f) => f.classification === 'proposal'); if (!p.length) return null; const t1 = p.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name)); const t2 = p.filter((f) => /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i.test(f.name)); const ext = (n) => (n.toLowerCase().endsWith('.pdf') ? 0 : n.toLowerCase().endsWith('.docx') ? 1 : 2); const s = (a) => a.slice().sort((x, y) => ext(x.name) - ext(y.name)); return (t1.length ? s(t1) : t2.length ? s(t2) : s(p))[0]; }

const clean = (n) => (n || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
const fam = (n) => clean(n).split(' ').slice(-1)[0];
const giv = (n) => clean(n).split(' ').slice(0, -1).join(' ');
const normOrcid = (x) => (x ? String(x).match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/)?.[1] || null : null);
async function jget(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) return { __err: r.status }; return await r.json(); } catch (e) { return { __err: e.message }; } }
const STOP = new Set(['university', 'the', 'of', 'college', 'institute', 'for', 'center', 'centre', 'department', 'dept', 'school', 'national', 'research', 'science', 'sciences', 'and', 'laboratory', 'lab', 'medical', 'medicine', 'state']);
const toks = (s) => (s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((t) => t.length >= 4 && !STOP.has(t));
function tokenOverlap(a, b) { if (!a || !b) return false; const A = new Set(toks(a)); const B = toks(b); return B.some((t) => A.has(t)); }

async function openalexTopN(name) {
  const j = await jget(`https://api.openalex.org/authors?search=${encodeURIComponent(clean(name))}&per_page=10${MAILTO ? `&mailto=${MAILTO}` : ''}`);
  if (j.__err) return { err: j.__err };
  const recs = (j.results || []).map((r) => ({
    id: r.id, display: r.display_name, works: r.works_count ?? 0,
    orcid: normOrcid(r.orcid),
    inst: r.last_known_institutions?.[0]?.display_name || r.last_known_institution?.display_name || null,
    concepts: (r.x_concepts || []).filter((c) => c.score > 0.25 && c.level >= 0).map((c) => c.display_name).slice(0, 8).join(' '),
  }));
  return { count: j.meta?.count || 0, recs };
}
async function orcidEmploymentInsts(orcid) {
  if (!orcid) return [];
  const j = await jget(`https://pub.orcid.org/v3.0/${orcid}/employments`, { headers: { Accept: 'application/json' } });
  if (j.__err) return [];
  const groups = j['affiliation-group'] || [];
  const names = [];
  for (const g of groups) for (const s of (g.summaries || [])) { const o = s['employment-summary']?.organization?.name; if (o) names.push(o); }
  return names;
}

function selectConstrained(recs, claimedInst, fieldText) {
  let best = null;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const aff = claimedInst && r.inst ? tokenOverlap(claimedInst, r.inst) : false;
    const topic = fieldText && r.concepts ? tokenOverlap(fieldText, r.concepts) : false;
    if (!aff && !topic) continue;
    const score = (aff ? 2 : 0) + (topic ? 1 : 0) + Math.min(r.works / 1000, 0.5);
    if (!best || score > best.score) best = { rank: i + 1, rec: r, aff, topic, score };
  }
  return best; // null = abstain
}

async function main() {
  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set'); process.exit(2); }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  const { loadReviewerRequestContext } = await import('../lib/services/reviewer-request-context.js');
  enterDynamicsBypassForScript('eval-orcid-spine-constrained'); await loadModelOverrides();

  const rows = [];
  for (const reqArg of args.requests) {
    let rec;
    try { if (GUID_RE.test(reqArg)) rec = await DynamicsService.getRecord('akoya_requests', reqArg, { select: 'akoya_requestid,akoya_requestnum,akoya_title' }); else { const { records } = await DynamicsService.queryRecords('akoya_requests', { select: 'akoya_requestid,akoya_requestnum,akoya_title', filter: `akoya_requestnum eq '${reqArg}'`, top: 1 }); rec = records?.[0]; } } catch (e) { console.error(`req ${reqArg}: ${e.message}`); continue; }
    if (!rec) { console.error(`req ${reqArg}: not found`); continue; }
    let requestContext; try { requestContext = await loadReviewerRequestContext(rec.akoya_requestid); } catch (e) { console.error(`req ${rec.akoya_requestnum}: request context ${e.message}`); continue; }
    let text = null;
    try {
      const buckets = await getRequestSharePointBuckets(rec.akoya_requestid, rec.akoya_requestnum); const seen = new Set(); const files = [];
      for (const b of buckets) { let raw = []; try { raw = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch {} for (const f of raw) { const folder = f.folder || b.folder; const k = `${b.library}::${folder}::${f.name}`; if (seen.has(k)) continue; seen.add(k); files.push({ name: f.name, library: b.library, folder, classification: classifyFile(f.name) }); } }
      const picked = pickProposal(files); if (!picked) { console.error(`req ${rec.akoya_requestnum}: no proposal`); continue; }
      const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
      if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)) { const pp = (await import('pdf-parse')).default; text = (await pp(dl.buffer)).text; } else if (/\.txt$/i.test(picked.name)) text = dl.buffer.toString('utf8');
    } catch (e) { console.error(`req ${rec.akoya_requestnum}: ${e.message}`); continue; }
    if (!text || text.trim().length < 100) { console.error(`req ${rec.akoya_requestnum}: text too short`); continue; }
    let analysis; try { analysis = await ClaudeReviewerService.analyzeProposal(text, process.env.CLAUDE_API_KEY, buildOrcidSpineConstrainedAnalyzeOptions({ args, requestContext })); } catch (e) { console.error(`req ${rec.akoya_requestnum}: analyze ${e.message}`); continue; }
    if (!analysis?.success) { console.error(`req ${rec.akoya_requestnum}: analyze ${analysis?.status}`); continue; }
    const field = analysis.proposalInfo?.primaryResearchArea || '';
    console.log(`\n# ${rec.akoya_requestnum}  ${field}`);
    for (const s of (analysis.reviewerSuggestions || [])) {
      const fieldText = `${field} ${(Array.isArray(s.expertiseAreas) ? s.expertiseAreas.join(' ') : '')}`;
      const oa = await openalexTopN(s.name); await sleep(120);
      if (oa.err) { console.log(`  ! ${s.name}: oa err ${oa.err}`); continue; }
      const naive = oa.recs[0] || null;
      const naiveAff = naive && s.suggestedInstitution ? tokenOverlap(s.suggestedInstitution, naive.inst) : null;
      const sel = selectConstrained(oa.recs, s.suggestedInstitution, fieldText);
      let outcome, orcidCorrob = null, selOrcid = null, selInst = null, selRank = null;
      if (!sel) { outcome = 'ABSTAIN'; }
      else {
        selRank = sel.rank; selOrcid = sel.rec.orcid; selInst = sel.rec.inst;
        if (selOrcid) { const emp = await orcidEmploymentInsts(selOrcid); await sleep(120); orcidCorrob = (s.suggestedInstitution && emp.some((e) => tokenOverlap(s.suggestedInstitution, e))) || (selInst && emp.some((e) => tokenOverlap(selInst, e))); }
        outcome = (sel.aff && (orcidCorrob || sel.topic)) ? 'CONFIRMED' : 'PLAUSIBLE';
      }
      rows.push({ req: rec.akoya_requestnum, field, name: s.name, claimed: s.suggestedInstitution || null, count: oa.count, naiveAff, outcome, selRank, selInst, selOrcid, orcidCorrob });
      console.log(`  ${outcome.padEnd(9)} count=${String(oa.count).padStart(4)} naiveAff=${naiveAff === null ? '?' : naiveAff ? 'Y' : 'N'} selRank=${selRank ?? '-'} orcidCorrob=${orcidCorrob === null ? '-' : orcidCorrob ? 'Y' : 'N'}  ${s.name}  [sel:${selInst || '-'}]`);
    }
  }

  console.log('\n' + '='.repeat(80) + '\nSUMMARY: naive top-1 vs constrained selection\n' + '='.repeat(80));
  const n = rows.length; if (!n) { console.log('no rows'); return; }
  const c = (p) => rows.filter(p).length; const pct = (x) => `${Math.round((x / n) * 100)}%`;
  console.log(`names: ${n}`);
  console.log(`\nNAIVE top-1 affiliation (where claimed+found present):`);
  const naiveScored = rows.filter((r) => r.naiveAff !== null);
  console.log(`  match: ${naiveScored.filter((r) => r.naiveAff).length}/${naiveScored.length} (${Math.round(naiveScored.filter((r) => r.naiveAff).length / naiveScored.length * 100)}%)  → ${naiveScored.filter((r) => !r.naiveAff).length} naive-WRONG/uncorroborated`);
  console.log(`\nCONSTRAINED outcome:`);
  console.log(`  CONFIRMED (aff match + corroboration) : ${c((r) => r.outcome === 'CONFIRMED')} (${pct(c((r) => r.outcome === 'CONFIRMED'))})`);
  console.log(`  PLAUSIBLE (single weak match)         : ${c((r) => r.outcome === 'PLAUSIBLE')} (${pct(c((r) => r.outcome === 'PLAUSIBLE'))})`);
  console.log(`  ABSTAIN   (no record matched → unresolved): ${c((r) => r.outcome === 'ABSTAIN')} (${pct(c((r) => r.outcome === 'ABSTAIN'))})`);
  console.log(`\nDid constrained selection OVERRIDE naive top-1 (selRank>1)? ${c((r) => r.selRank && r.selRank > 1)}`);
  // The cell that matters: of naive-WRONG (naiveAff=N) cases, what did constrained do?
  const naiveWrong = rows.filter((r) => r.naiveAff === false);
  console.log(`\nOf ${naiveWrong.length} naive-WRONG (top-1 affiliation mismatch) cases, constrained selection:`);
  console.log(`  recovered (CONFIRMED/PLAUSIBLE via rank>1) : ${naiveWrong.filter((r) => r.outcome !== 'ABSTAIN' && r.selRank > 1).length}`);
  console.log(`  safely ABSTAINED (→ unresolved, not wrong) : ${naiveWrong.filter((r) => r.outcome === 'ABSTAIN').length}`);
  console.log(`  still asserted rank-1 match                : ${naiveWrong.filter((r) => r.outcome !== 'ABSTAIN' && r.selRank === 1).length}`);
  console.log(`\n(Confident-wrong shrinks if naive-wrong cases convert to ABSTAIN or rank>1 recovery.)`);
}
if (isCliEntrypoint()) {
  main().catch((e) => { console.error('\nfailed:', e.message); process.exit(1); });
}
