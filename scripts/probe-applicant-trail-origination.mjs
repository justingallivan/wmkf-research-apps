/**
 * probe-applicant-trail-origination — test the Tier-3 "applicant publication
 * trail" origination path for SPARSE proposals (no bibliography this cycle).
 *
 * See docs/REVIEWER_FINDER_SPARSE_PROPOSAL_ANCHOR_STRATEGY.md (Tier 3 + §5.6).
 * The probe scripts/probe-grounded-origination.mjs showed 2/3 Phase I proposals
 * have ZERO inline DOIs, so Tiers 1–2 are mostly empty and Tier 3 is the de-facto
 * spine. This tests whether it carries.
 *
 * Identity is STRUCTURED, not inferred (S239, per Justin): the PI is the request's
 * Project Leader (`_wmkf_projectleader_value`), a Dataverse contact that already
 * carries `wmkf_orcid`. So PI→OpenAlex resolution is EXACT via ORCID — no LLM, no
 * namesake guessing. The earlier LLM-extract + fuzzy-match version misresolved
 * "Wen Li" → "Yanping Li"; the ORCID path removes that hazard entirely.
 *
 * Trail: PI → recent works → the works THEY cite (synthesized bibliography) →
 * those authors, minus the PI's co-author COI neighborhood. People are derived
 * ONLY from real OpenAlex works; nothing is invented.
 *
 * READ-ONLY. No LLM calls. Dynamics reads (request + contact) + public OpenAlex.
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-applicant-trail-origination.mjs --request <num|GUID>
 *       [--years 5] [--max-refs 200]
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
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || '';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const OA = 'https://api.openalex.org';
const FV = '@OData.Community.Display.V1.FormattedValue';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shortId = (id) => String(id || '').split('/').pop();

function parseArgs(argv) {
  const out = { years: 5, maxRefs: 200 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--request') out.request = next();
    else if (a === '--years') out.years = parseInt(next(), 10) || 5;
    else if (a === '--max-refs') out.maxRefs = parseInt(next(), 10) || 200;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.request) {
  console.log('Usage: node scripts/probe-applicant-trail-origination.mjs --request <num|GUID> [--years 5] [--max-refs 200]');
  process.exit(args.help ? 0 : 2);
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

const normOrcid = (o) => { const m = String(o || '').match(/\d{4}-\d{4}-\d{4}-\d{3}[\dxX]/); return m ? m[0] : null; };

// ORCID → exact OpenAlex author (the hard key; no namesake ambiguity).
async function orcidToAuthor(orcid) {
  const j = await jget(`${OA}/authors/https://orcid.org/${orcid}?mailto=${MAILTO}`);
  if (j.__err) return { err: j.__err };
  return {
    id: j.id, name: j.display_name, works: j.works_count,
    inst: (j.last_known_institutions || [])[0]?.display_name || null,
  };
}

// PI corpus from the ORCID record's OWN self-asserted works (authoritative,
// PI-curated) — NOT OpenAlex's author cluster, which merges same-name people for
// common names (verified live: Wen Li's OpenAlex cluster was a Yantai chemistry
// blob; his ORCID works list was 69 clean attosecond-physics papers).
async function orcidRecentDois(orcid, minYear) {
  try {
    const r = await fetch(`https://pub.orcid.org/v3.0/${orcid}/works`, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { err: r.status };
    const d = await r.json();
    const out = [];
    for (const g of (d.group || [])) {
      const s = (g['work-summary'] || [])[0] || {};
      const yr = parseInt(((s['publication-date'] || {}).year || {}).value, 10) || 0;
      if (yr && yr < minYear) continue;
      let doi = null;
      for (const eid of ((s['external-ids'] || {})['external-id'] || [])) {
        if (String(eid['external-id-type']).toLowerCase() === 'doi') {
          doi = String(eid['external-id-value']).toLowerCase().replace(/^https?:\/\/doi\.org\//, '');
          break;
        }
      }
      out.push({ title: (((s.title || {}).title || {}).value) || '', year: yr, doi });
    }
    return { works: out };
  } catch (e) { return { err: e.message }; }
}

async function workByDoi(doi) {
  const j = await jget(`${OA}/works?filter=doi:${encodeURIComponent(doi)}&select=id,title,publication_year,authorships,referenced_works&per-page=1&mailto=${MAILTO}`);
  if (j.__err) return null;
  return (j.results || [])[0] || null;
}

async function resolveWork(workId) {
  const j = await jget(`${OA}/works/${shortId(workId)}?select=id,title,publication_year,authorships&mailto=${MAILTO}`);
  if (j.__err) return null;
  return j;
}

async function main() {
  const { DynamicsService } = await import('../lib/services/dynamics-service.js');
  const { enterDynamicsBypassForScript } = await import('../lib/services/dynamics-context.js');
  enterDynamicsBypassForScript('probe-applicant-trail-origination');

  // 1. Request → Project Leader contact (STRUCTURED identity; no LLM).
  const select = 'akoya_requestid,akoya_requestnum,akoya_title,_wmkf_projectleader_value,_wmkf_researchleader_value';
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
  const line = '─'.repeat(78);
  console.log('━'.repeat(78));
  console.log(`REQUEST  ${rec.akoya_requestnum}  ·  ${rec.akoya_title || '(untitled)'}`);
  console.log('━'.repeat(78));

  const plId = rec._wmkf_projectleader_value || rec._wmkf_researchleader_value;
  if (!plId) { console.error('No Project Leader / Research Leader lookup on the request — cannot anchor Tier 3.'); process.exit(1); }
  const contact = await DynamicsService.getRecord('contacts', plId, {
    select: 'fullname,firstname,lastname,wmkf_orcid,emailaddress1',
  });
  const orcid = normOrcid(contact.wmkf_orcid);
  const emailDomain = (contact.emailaddress1 || '').split('@')[1] || null;
  console.log(`PI (Project Leader): ${contact.fullname}  ·  ORCID ${orcid || '(none on contact)'}  ·  ${contact.emailaddress1 || ''}`);

  // 2. ORCID → exact OpenAlex author.
  console.log(`\n${line}\nSTEP 1 — PI identity via ORCID (exact; the namesake hazard is gone)\n${line}`);
  if (!orcid) {
    console.log('  ► The contact carries no ORCID. Exact resolution unavailable; production would fall back to a');
    console.log('    name+institution match with abstention (the prior, weaker path). For this probe: stop.');
    process.exit(0);
  }
  const pi = await orcidToAuthor(orcid);
  if (pi.err || !pi.id) { console.error(`  ORCID ${orcid} did not resolve in OpenAlex (${pi.err || 'no record'}).`); process.exit(1); }
  console.log(`  ${orcid}  →  ${pi.name}  [${shortId(pi.id)}]  works=${pi.works}`);
  console.log(`  OpenAlex last-known institution: ${pi.inst || '?'}${emailDomain ? `   (contact email domain: ${emailDomain})` : ''}`);
  if (pi.inst && emailDomain && !pi.inst.toLowerCase().split(/\s+/).some((t) => emailDomain.includes(t.slice(0, 5)))) {
    console.log('  ⚠ OpenAlex institution disagrees with the contact email domain — OpenAlex affiliation is often stale;');
    console.log('    identity is still exact (ORCID), but sanity-check the anchor titles below for on-topic-ness.');
  }

  // 3. PI corpus — from ORCID's OWN works list (authoritative; dodges OpenAlex merges).
  const minYear = new Date().getFullYear() - args.years;
  const od = await orcidRecentDois(orcid, minYear);
  if (od.err) { console.error(`  ORCID works fetch failed (${od.err}).`); process.exit(1); }
  const withDoi = (od.works || []).filter((w) => w.doi);
  console.log(`\n${line}\nSTEP 2 — PI corpus from ORCID works (≥${minYear}): ${od.works.length} works · ${withDoi.length} with a DOI\n${line}`);
  if (!withDoi.length) { console.log('  No DOI-bearing recent ORCID works — Tier 3 cannot expand. (Falls through to other tiers.)'); process.exit(0); }
  const piWorks = [];
  for (const w of withDoi) { const oaw = await workByDoi(w.doi); await sleep(80); if (oaw) piWorks.push(oaw); }
  console.log(`  resolved ${piWorks.length}/${withDoi.length} ORCID works to OpenAlex (for references + co-authors)`);
  if (!piWorks.length) { console.log('  None resolved in OpenAlex — Tier 3 yields nothing for this proposal.'); process.exit(0); }

  // COI set: PI + co-authors (collaboration neighborhood).
  const coiIds = new Set([shortId(pi.id)]);
  for (const w of piWorks) {
    for (const a of (w.authorships || [])) {
      const aid = shortId(a.author?.id);
      if (aid) coiIds.add(aid);
    }
  }
  console.log(`  COI exclusion set: PI + ${coiIds.size - 1} co-authors (collaboration neighborhood)`);

  // 4. Outward expansion = the works the PI cites (synthesized bibliography), most-recent works first.
  const refIds = [];
  const refSeen = new Set();
  const piWorksByRecency = piWorks.slice().sort((a, b) => (b.publication_year || 0) - (a.publication_year || 0));
  for (const w of piWorksByRecency) {
    for (const rid of (w.referenced_works || [])) {
      const s = shortId(rid);
      if (!refSeen.has(s)) { refSeen.add(s); refIds.push(s); }
    }
  }
  const cap = Math.min(refIds.length, args.maxRefs);
  console.log(`\n${line}\nSTEP 3 — synthesized bibliography: ${refIds.length} distinct works the PI cites\n${line}`);
  if (refIds.length > cap) console.log(`  ⚠ resolving ${cap}/${refIds.length} (--max-refs); ${refIds.length - cap} NOT resolved this run`);

  // 5. Resolve referenced works → authors, tally field experts (minus COI).
  const experts = new Map();
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
      if (!aid || coiIds.has(aid)) continue;
      const e = experts.get(aid) || { id: aid, name: a.author?.display_name, freq: 0, recentYear: 0 };
      e.freq += 1;
      if ((w.publication_year || 0) > e.recentYear) e.recentYear = w.publication_year || 0;
      experts.set(aid, e);
    }
  }
  const ranked = [...experts.values()].sort((a, b) => b.freq - a.freq || b.recentYear - a.recentYear);
  console.log(`  resolved ${resolved}/${cap} cited works → ${ranked.length} distinct non-COI field authors`);
  console.log('\n  sample of synthesized-bibliography ANCHOR titles (judge vs the request title above):');
  anchorTitles.forEach((t) => console.log(`     • ${t.slice(0, 96)}`));

  console.log(`\n${line}\nTIER-3 FIELD EXPERTS (grounded, COI-clean) — top 25 by cite-frequency then recency\n${line}`);
  ranked.slice(0, 25).forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. [${String(e.freq).padStart(2)}× · ${e.recentYear || '?'}] ${e.name}`));

  console.log(`\n${line}`);
  console.log('Read-only: no writes, no LLM. Identity is exact (Dataverse ORCID → OpenAlex); people derived only from real works.');
  console.log('Watch-outs: (1) anchor titles vs the request title — a mismatch = PI pivoted to a new area, trail is off-field;');
  console.log('(2) references skew to foundational work, so recency matters for active-vs-emeritus.');
  console.log(line);
}

main().catch((err) => { console.error('\nprobe-applicant-trail-origination failed:', err.stack || err.message); process.exit(1); });
