/**
 * probe-source-coverage — measure scholarly-database coverage for a set of
 * researcher names, by source, to inform reviewer-finder source routing.
 *
 * Read-only. Sends ONLY the candidate names (public researchers) to public
 * scholarly APIs — never proposal text or applicant identity. See
 * docs/REVIEWER_FINDER_RETRIEVAL_REDESIGN_PLAN.md (§6 sourcing decisions).
 *
 * Sources (validated S231): PubMed (NCBI eutils), OpenAlex, ORCID,
 * Semantic Scholar (keyed). DBLP included (CS-only; expected ~0 elsewhere).
 * NOT implemented yet (endpoint/key unverified — physics coverage gap):
 *   - NASA ADS  (astro; needs ADS_API_KEY, api.adsabs.harvard.edu/v1/search/query)
 *   - INSPIRE   (HEP; earlier naive q= matched the whole DB — needs correct syntax)
 *
 * Usage:
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-source-coverage.mjs \
 *        --names "Anna Frebel, David Baker"
 *   node --import ./scripts/lib/use-extensionless.mjs scripts/probe-source-coverage.mjs \
 *        --names-file names.txt          # one per line; optional "group|Name" to tag a field
 *
 * Env (from .env.local): SEMANTIC_SCHOLAR_API_KEY (optional; S2 skipped if absent),
 * NCBI_API_KEY (optional; raises PubMed rate limit).
 */
import { readFileSync } from 'node:fs';
try { const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8'); for (const l of env.split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/); if(m&&!(m[1] in process.env))process.env[m[1]]=m[2].trim().replace(/^"(.*)"$/,'$1').replace(/^'(.*)'$/,'$1');}} catch {}
const { PubMedService } = await import('../lib/services/pubmed-service.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = n => (n || '').replace(/^(dr\.?|prof\.?|professor)\s+/i, '').trim();
const fam = n => clean(n).split(' ').slice(-1)[0];
const giv = n => clean(n).split(' ').slice(0, -1).join(' ');
const S2_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || null;
const S2_GAP = 1300; // > 1 req/s S2 limit

async function jget(url, opts) { try { const r = await fetch(url, opts); if (!r.ok) return { __err: r.status }; return await r.json(); } catch (e) { return { __err: e.message }; } }

async function pubmed(name) { try { const a = await PubMedService.search(`${clean(name)}[Author] AND (2015:2026[pdat])`, 30); return { n: a.length }; } catch (e) { return { n: 0, err: e.message }; } }
async function openalex(name) { const j = await jget(`https://api.openalex.org/authors?search=${encodeURIComponent(clean(name))}&per_page=1`); if (j.__err) return { err: j.__err }; const t = j.results?.[0]; return { count: j.meta?.count || 0, works: t?.works_count, orcid: !!t?.ids?.orcid }; }
async function orcid(name) { const q = `family-name:${encodeURIComponent(fam(name))}+AND+given-names:${encodeURIComponent(giv(name) || fam(name))}`; const j = await jget(`https://pub.orcid.org/v3.0/expanded-search/?q=${q}&rows=1`, { headers: { Accept: 'application/json' } }); if (j.__err) return { err: j.__err }; return { found: (j['num-found'] || 0) > 0 }; }
async function dblp(name) { const j = await jget(`https://dblp.org/search/author/api?q=${encodeURIComponent(clean(name))}&format=json&h=1`); if (j.__err) return { err: j.__err }; return { count: parseInt(j.result?.hits?.['@total'] || '0', 10) }; }
async function s2(name) {
  if (!S2_KEY) return { skip: true };
  const url = `https://api.semanticscholar.org/graph/v1/author/search?query=${encodeURIComponent(clean(name))}&fields=name,paperCount,externalIds&limit=1`;
  for (let i = 0; i < 2; i++) { const r = await fetch(url, { headers: { 'x-api-key': S2_KEY } }); if (r.status === 429) { await sleep(3000); continue; } if (!r.ok) return { err: r.status }; const j = await r.json(); const t = j.data?.[0]; return { count: j.total || 0, papers: t?.paperCount, orcid: !!t?.externalIds?.ORCID }; }
  return { err: '429' };
}

// ---- input ----
const args = process.argv.slice(2);
let names = []; // {group, name}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--names') names.push(...args[++i].split(',').map(s => ({ group: 'all', name: s.trim() })).filter(x => x.name));
  else if (args[i] === '--names-file') {
    const lines = readFileSync(args[++i], 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
    for (const l of lines) { const [a, b] = l.includes('|') ? l.split('|') : [null, l]; names.push({ group: (b ? a : 'all').trim(), name: (b || a).trim() }); }
  }
}
if (!names.length) { console.log('Usage: --names "A, B"  |  --names-file path (one per line, optional "group|Name")'); process.exit(2); }
if (!S2_KEY) console.log('(note: SEMANTIC_SCHOLAR_API_KEY not set — S2 column skipped)\n');

// ---- run ----
const rows = [];
for (const { group, name } of names) {
  const rec = { group, name };
  rec.pm = await pubmed(name); await sleep(300);
  rec.oa = await openalex(name); await sleep(300);
  rec.orcid = await orcid(name); await sleep(300);
  rec.dblp = await dblp(name); await sleep(300);
  rec.s2 = await s2(name); if (S2_KEY) await sleep(S2_GAP);
  rows.push(rec);
  console.log(`${(group + ' ').slice(0, 10).padEnd(10)} ${name.slice(0, 26).padEnd(26)} PM:${String(rec.pm.n).padStart(3)} OA:${String(rec.oa.count ?? '-').padStart(3)}${rec.oa.orcid ? '+o' : '  '} ORCID:${rec.orcid.found ? 'Y' : '.'} DBLP:${String(rec.dblp.count ?? '-').padStart(2)} S2:${rec.s2.skip ? '-' : String(rec.s2.count ?? 'e').padStart(3)}`);
}

// ---- matrix by group ----
const byGroup = {};
for (const r of rows) { const g = (byGroup[r.group] ??= { n: 0, pm: 0, oa: 0, orcid: 0, s2: 0, s2n: 0 }); g.n++; if (r.pm.n > 0) g.pm++; if ((r.oa.count || 0) > 0) g.oa++; if (r.orcid.found) g.orcid++; if (!r.s2.skip && !r.s2.err) { g.s2n++; if ((r.s2.count || 0) > 0) g.s2++; } }
console.log('\n=== coverage by group (% found) ===');
console.log('group       n   PM%  OA%  ORCID%  S2%');
for (const [grp, g] of Object.entries(byGroup)) { const p = (x, d = g.n) => d ? String(Math.round(100 * x / d)).padStart(3) : '  -'; console.log(`${grp.slice(0, 10).padEnd(10)} ${String(g.n).padStart(2)}  ${p(g.pm)}  ${p(g.oa)}  ${p(g.orcid)}   ${p(g.s2, g.s2n)}`); }
console.log('\n(PM name-string presence ≠ identity; OA presence ≠ completeness — see redesign plan §2.3/§6.)');
