/**
 * eval-orcid-spine-sweep — measure OpenAlex+ORCID identity reliability across the
 * REAL suggested-reviewer population (strata 1+2 of the ORCID-spine shadow-run).
 *
 * For a sample of real requests it runs the production Stage-1 `analyze` (names
 * only — no PubMed/discover), then for each suggested reviewer probes OpenAlex and
 * ORCID-direct and classifies the identity signal. The point is NOT "did it find an
 * ORCID" but the harder cells:
 *   - collision risk      : OpenAlex `count` (how many authors share the name)
 *   - cross-source agree   : does OpenAlex's inline ORCID == ORCID-direct's top ORCID
 *   - no-ORCID recall gap  : neither source yields an ORCID (the fallback population)
 *   - CONFLICT (dangerous) : the two sources return DIFFERENT ORCIDs for the name
 *   - affiliation sanity   : OpenAlex last-known-institution vs Claude's claimed one
 *
 * Ground truth is a PROXY (cross-source agreement + affiliation), not a labeled
 * benchmark — enough to surface failure RATES and the dangerous "confidently-wrong"
 * cell. Read-only except the analyze LLM call (one api_usage_log row per request,
 * same as validate-reviewer-analyze). Only public reviewer names go to the
 * scholarly APIs; proposal text goes only to Claude.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/eval-orcid-spine-sweep.mjs \
 *     --requests 1002794,1002896,1002959,1003005,1003020,1003024,1003075 [--reviewer-count 12]
 */
import { readFileSync } from 'node:fs';
function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
    }
  } catch {}
}
loadEnvLocal();

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || ''; // polite pool only if a real mailbox is configured
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = { requests: [], reviewerCount: 12 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]; const next = () => argv[++i];
    if (a === '--requests') out.requests = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--reviewer-count') out.reviewerCount = parseInt(next(), 10) || 12;
    else if (a === '--help') out.help = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (args.help || args.requests.length === 0) {
  console.log('Usage: --requests <n1,n2,...> [--reviewer-count N]'); process.exit(args.help ? 0 : 2);
}

// ---- proposal-file helpers (from validate-reviewer-analyze.mjs) ----
const SEP = '(?:^|[\\s_\\-])', SEP_END = '(?:[\\s_\\-]|$)';
const wordRe = (w) => new RegExp(`${SEP}${w}${SEP_END}`, 'i');
function classifyFile(name) {
  const n = (name || '').toLowerCase();
  if (wordRe('phase[\\s_]?i').test(n) && !wordRe('phase[\\s_]?ii').test(n)) return 'other';
  const hasNarrative = /project[\s_\-]*(narrative|description)/i.test(n);
  const isFront = /cover[\s_\-]*(page|sheet|letter)/i.test(n) || /face[\s_\-]*page/i.test(n) || /title[\s_\-]*page/i.test(n) || /signature[\s_\-]*page/i.test(n) || /application[\s_\-]*form/i.test(n);
  if (isFront && !hasNarrative) return 'other';
  if (hasNarrative || wordRe('phase[\\s_]?ii').test(n) || wordRe('proposal').test(n) || wordRe('application').test(n)) return 'proposal';
  return 'other';
}
function pickProposal(files) {
  const props = files.filter((f) => f.classification === 'proposal');
  if (!props.length) return null;
  const t1 = props.filter((f) => /project[\s_\-]*(narrative|description)/i.test(f.name));
  const t2 = props.filter((f) => /(?:^|[\s_\-])phase[\s_]?ii(?:[\s_\-]|$)/i.test(f.name));
  const ext = (n) => (n.toLowerCase().endsWith('.pdf') ? 0 : n.toLowerCase().endsWith('.docx') ? 1 : 2);
  const sort = (a) => a.slice().sort((x, y) => ext(x.name) - ext(y.name));
  return (t1.length ? sort(t1) : t2.length ? sort(t2) : sort(props))[0];
}

// ---- identity probes ----
const clean = (n) => (n || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
const fam = (n) => clean(n).split(' ').slice(-1)[0];
const giv = (n) => clean(n).split(' ').slice(0, -1).join(' ');
const normOrcid = (x) => (x ? String(x).match(/(\d{4}-\d{4}-\d{4}-[\dX]{4})/)?.[1] || null : null);
async function jget(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) return { __err: r.status }; return await r.json(); } catch (e) { return { __err: e.message }; } }

async function openalex(name) {
  const j = await jget(`https://api.openalex.org/authors?search=${encodeURIComponent(clean(name))}&per_page=3${MAILTO ? `&mailto=${MAILTO}` : ''}`);
  if (j.__err) return { err: j.__err };
  const top = j.results?.[0];
  const inst = top?.last_known_institutions?.[0]?.display_name || top?.last_known_institution?.display_name || null;
  return { count: j.meta?.count || 0, works: top?.works_count ?? null, orcid: normOrcid(top?.orcid), inst, display: top?.display_name || null };
}
async function orcidDirect(name) {
  const q = `family-name:${encodeURIComponent(fam(name))}+AND+given-names:${encodeURIComponent(giv(name) || fam(name))}`;
  const j = await jget(`https://pub.orcid.org/v3.0/expanded-search/?q=${q}&rows=3`, { headers: { Accept: 'application/json' } });
  if (j.__err) return { err: j.__err };
  const top = j['expanded-result']?.[0];
  return { numFound: j['num-found'] || 0, orcid: normOrcid(top?.['orcid-id']), inst: top?.['institution-name']?.[0] || null };
}

function classify({ oa, od }) {
  const oaOrcid = oa.orcid, odOrcid = od.orcid;
  if (oaOrcid && odOrcid) return oaOrcid === odOrcid ? 'AGREE' : 'CONFLICT';
  if (oaOrcid || odOrcid) return 'ONE_ORCID';
  return 'NO_ORCID';
}
function instMatch(claimed, found) {
  if (!claimed || !found) return null;
  const norm = (s) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\b(university|the|of|college|institute|for|center|centre|department|dept)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const c = norm(claimed), f = norm(found);
  if (!c || !f) return null;
  const ct = new Set(c.split(' ').filter((t) => t.length >= 4));
  return [...ct].some((t) => f.includes(t));
}

async function main() {
  if (!process.env.CLAUDE_API_KEY) { console.error('CLAUDE_API_KEY not set'); process.exit(2); }
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  const { GraphService } = await import('../lib/services/graph-service.js');
  const { getRequestSharePointBuckets } = await import('../lib/utils/sharepoint-buckets.js');
  const { loadModelOverrides } = await import('../lib/services/model-override-loader.js');
  const { ClaudeReviewerService } = await import('../lib/services/claude-reviewer-service.js');
  enterDynamicsBypassForScript('eval-orcid-spine-sweep');
  await loadModelOverrides();

  const allRows = [];
  for (const reqArg of args.requests) {
    let rec;
    try {
      if (GUID_RE.test(reqArg)) rec = await DynamicsService.getRecord('akoya_requests', reqArg, { select: 'akoya_requestid,akoya_requestnum,akoya_title' });
      else { const { records } = await DynamicsService.queryRecords('akoya_requests', { select: 'akoya_requestid,akoya_requestnum,akoya_title', filter: `akoya_requestnum eq '${reqArg}'`, top: 1 }); rec = records?.[0]; }
    } catch (e) { console.error(`req ${reqArg}: resolve error ${e.message}`); continue; }
    if (!rec) { console.error(`req ${reqArg}: not found`); continue; }

    // download + parse proposal
    let text = null;
    try {
      const buckets = await getRequestSharePointBuckets(rec.akoya_requestid, rec.akoya_requestnum);
      const seen = new Set(); const files = [];
      for (const b of buckets) { let raw = []; try { raw = await GraphService.listFiles(b.library, b.folder, { recursive: true }); } catch {} for (const f of raw) { const folder = f.folder || b.folder; const k = `${b.library}::${folder}::${f.name}`; if (seen.has(k)) continue; seen.add(k); files.push({ name: f.name, library: b.library, folder, classification: classifyFile(f.name) }); } }
      const picked = pickProposal(files);
      if (!picked) { console.error(`req ${rec.akoya_requestnum}: no proposal file — skip`); continue; }
      const dl = await GraphService.downloadFileByPath(picked.library, picked.folder, picked.name);
      if ((dl.mimeType || '').includes('pdf') || /\.pdf$/i.test(picked.name)) { const pp = (await import('pdf-parse')).default; text = (await pp(dl.buffer)).text; }
      else if (/\.txt$/i.test(picked.name)) text = dl.buffer.toString('utf8');
    } catch (e) { console.error(`req ${rec.akoya_requestnum}: download error ${e.message}`); continue; }
    if (!text || text.trim().length < 100) { console.error(`req ${rec.akoya_requestnum}: proposal text too short — skip`); continue; }

    let analysis;
    try { analysis = await ClaudeReviewerService.analyzeProposal(text, process.env.CLAUDE_API_KEY, { reviewerCount: args.reviewerCount, temperature: 0.3, excludedNames: [], userProfileId: null }); }
    catch (e) { console.error(`req ${rec.akoya_requestnum}: analyze error ${e.message}`); continue; }
    if (!analysis?.success) { console.error(`req ${rec.akoya_requestnum}: analyze ${analysis?.status || 'failed'} — skip`); continue; }
    const field = analysis.proposalInfo?.primaryResearchArea || '(unknown)';
    const suggestions = analysis.reviewerSuggestions || [];
    console.log(`\n# ${rec.akoya_requestnum}  field="${field}"  suggestions=${suggestions.length}`);

    for (const s of suggestions) {
      const oa = await openalex(s.name); await sleep(150);
      const od = await orcidDirect(s.name); await sleep(150);
      if (oa.err || od.err) { console.log(`  ! ${s.name}: probe error oa=${oa.err || '-'} od=${od.err || '-'}`); continue; }
      const cls = classify({ oa, od });
      const im = instMatch(s.suggestedInstitution, oa.inst);
      const row = { req: rec.akoya_requestnum, field, name: s.name, claimedInst: s.suggestedInstitution || null, oaCount: oa.count, oaWorks: oa.works, oaInst: oa.inst, oaOrcid: oa.orcid, odFound: od.numFound, odOrcid: od.orcid, cls, instMatch: im };
      allRows.push(row);
      console.log(`  ${cls.padEnd(9)} count=${String(oa.count).padStart(3)} works=${String(oa.works ?? '-').padStart(4)} instMatch=${im === null ? '?' : im ? 'Y' : 'N'}  ${s.name}  [oa:${oa.oaInst || oa.inst || '-'}]`);
    }
  }

  // ---- aggregate ----
  console.log('\n' + '='.repeat(80) + '\nSUMMARY\n' + '='.repeat(80));
  const n = allRows.length;
  if (!n) { console.log('no rows'); return; }
  const by = (pred) => allRows.filter(pred).length;
  const pct = (x) => `${Math.round((x / n) * 100)}%`;
  console.log(`names scored: ${n} across ${new Set(allRows.map((r) => r.req)).size} request(s)`);
  console.log(`\nIdentity signal:`);
  console.log(`  AGREE     (OA+ORCID-direct same ORCID) : ${by((r) => r.cls === 'AGREE')}  (${pct(by((r) => r.cls === 'AGREE'))})`);
  console.log(`  ONE_ORCID (only one source w/ ORCID)   : ${by((r) => r.cls === 'ONE_ORCID')}  (${pct(by((r) => r.cls === 'ONE_ORCID'))})`);
  console.log(`  NO_ORCID  (neither — fallback needed)  : ${by((r) => r.cls === 'NO_ORCID')}  (${pct(by((r) => r.cls === 'NO_ORCID'))})`);
  console.log(`  CONFLICT  (sources DIFFER — dangerous) : ${by((r) => r.cls === 'CONFLICT')}  (${pct(by((r) => r.cls === 'CONFLICT'))})`);
  const hi = allRows.filter((r) => r.oaCount >= 10);
  console.log(`\nCollision risk (OpenAlex name matches ≥10): ${hi.length} (${pct(hi.length)})`);
  console.log(`  of those, identity = AGREE: ${hi.filter((r) => r.cls === 'AGREE').length}; CONFLICT/NO_ORCID: ${hi.filter((r) => r.cls === 'CONFLICT' || r.cls === 'NO_ORCID').length}`);
  const withInst = allRows.filter((r) => r.instMatch !== null);
  console.log(`\nAffiliation sanity (OA inst vs Claude claimed, where both present, ${withInst.length} rows):`);
  console.log(`  match: ${withInst.filter((r) => r.instMatch).length}  mismatch: ${withInst.filter((r) => !r.instMatch).length}`);
  console.log(`\nBy field:`);
  for (const f of [...new Set(allRows.map((r) => r.field))]) {
    const rs = allRows.filter((r) => r.field === f);
    const orcidAny = rs.filter((r) => r.oaOrcid || r.odOrcid).length;
    console.log(`  ${String(rs.length).padStart(3)} | ORCID-any ${Math.round((orcidAny / rs.length) * 100)}% | NO_ORCID ${rs.filter((r) => r.cls === 'NO_ORCID').length} | CONFLICT ${rs.filter((r) => r.cls === 'CONFLICT').length} | ${f}`);
  }
  console.log(`\nDangerous cell (CONFLICT or high-collision-without-agreement):`);
  for (const r of allRows.filter((r) => r.cls === 'CONFLICT' || (r.oaCount >= 10 && r.cls !== 'AGREE'))) {
    console.log(`  ${r.name} (${r.field}) count=${r.oaCount} ${r.cls} oaOrcid=${r.oaOrcid || '-'} odOrcid=${r.odOrcid || '-'} oaInst="${r.oaInst || '-'}" claimed="${r.claimedInst || '-'}"`);
  }
}
main().catch((e) => { console.error('\neval-orcid-spine-sweep failed:', e.message); process.exit(1); });
