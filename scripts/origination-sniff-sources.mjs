/**
 * origination-sniff-sources — regenerate the blinded sniff-test keys as SOURCE-
 * LABELED markdown for the reviewer-finder origination experiment, enriched with a
 * reliable per-candidate dossier. Blinding is dropped (it cost the judge effort
 * without payoff): candidates are grouped by the arm that surfaced them so the judge
 * can scan the Claude / current-pipeline set and judge sufficiency, with the grounded
 * + applicant-recommended sets as reference.
 *
 * Dossier (so the judge doesn't have to Google) is TOPIC-ANCHORED to avoid the
 * famous-name homonym trap: rather than "search the name and hope", we find on-topic
 * papers (proposal title = the field anchor) authored by that name and take THAT
 * author's OpenAlex record — so "Paul Turner" resolves to the phage biologist, not a
 * particle physicist. Arm-B candidates already carry a correct OpenAlex id and skip
 * the search. We then show affiliation, field, and active-year span (first→last
 * publication), which flags the failure modes the judge otherwise catches by hand:
 * a deceased/emeritus person has no recent year; a trainee has a short span.
 *
 * Reads each <dir>/<req>.key.json, writes <dir>/<req>.sources.md. OpenAlex only
 * (public data, authenticated with OPENALEX_API_KEY); run unsandboxed for network. No LLM, no
 * pipeline re-run, no Dataverse.
 *
 * Usage: node scripts/origination-sniff-sources.mjs [--dir tmp/origination-sniff]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

function loadEnvLocal() {
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of env.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
    }
  } catch { /* ignore */ }
}
loadEnvLocal();

const dir = (() => { const i = process.argv.indexOf('--dir'); return i >= 0 ? process.argv[i + 1] : 'tmp/origination-sniff'; })();
const OA = 'https://api.openalex.org';
const MAILTO = process.env.OPENALEX_POLITE_MAILTO || '';
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || '';
const NOW = new Date().getFullYear();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry 429 (rate limit) and 5xx with exponential backoff — without it, a long
// batch silently degrades to "not resolved" as OpenAlex throttles partway through.
async function jget(url, tries = 4) {
  const requestUrl = new URL(url);
  if (requestUrl.hostname === 'api.openalex.org' && OPENALEX_API_KEY) {
    requestUrl.searchParams.set('api_key', OPENALEX_API_KEY);
  }
  for (let i = 0; i < tries; i += 1) {
    try {
      const userAgent = MAILTO ? `wmkf-sniff (mailto:${MAILTO})` : 'wmkf-sniff';
      const r = await fetch(requestUrl, { headers: { 'User-Agent': userAgent } });
      if (r.ok) return await r.json();
      if ((r.status === 429 || r.status >= 500) && i < tries - 1) { await sleep(800 * (i + 1)); continue; }
      return { __err: r.status };
    } catch (e) {
      if (i < tries - 1) { await sleep(800 * (i + 1)); continue; }
      return { __err: e.message };
    }
  }
  return { __err: 'retries-exhausted' };
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'novel', 'using', 'role', 'roles', 'their', 'this', 'that', 'new', 'via']);
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
function domainQuery(text) {
  const seen = new Set();
  return norm(text).split(' ').filter((w) => w.length >= 4 && !STOP.has(w) && !seen.has(w) && seen.add(w)).slice(0, 10).join(' ');
}
function nameMatch(a, b) {
  const ta = norm(a).split(' ').filter(Boolean);
  const tb = norm(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false; // surname must match
  return ta[0] === tb[0] || ta[0][0] === tb[0][0]; // first name or initial
}
const instOf = (a) => a?.last_known_institutions?.[0]?.display_name || a?.last_known_institution?.display_name || null;
const topicsOfN = (a, n) => (a?.topics || a?.x_concepts || []).slice(0, n).map((c) => c.display_name).filter(Boolean);
const topicsOf = (a) => topicsOfN(a, 2);

async function fetchAuthor(id) {
  const a = await jget(`${OA}/authors/${String(id).replace(/^https?:\/\/openalex\.org\//i, '')}?mailto=${MAILTO}`);
  return (!a.__err && a.id) ? a : null;
}

// Topic-anchored author resolution. Returns the OpenAlex author OBJECT (or null).
async function resolveAuthor(name, dq) {
  // On-topic works authored by this name → candidate author ids. Among the matching
  // clusters pick the one with the MOST lifetime works (the real person, not a
  // fragment cluster OpenAlex split off — which is what mis-flagged Bikard/Ghosh).
  const f = `title_and_abstract.search:${encodeURIComponent(dq)},raw_author_name.search:${encodeURIComponent(name)}`;
  const j = await jget(`${OA}/works?filter=${f}&per-page=25&sort=publication_date:desc&mailto=${MAILTO}`);
  const tally = new Map();
  if (!j.__err && j.results?.length) {
    for (const w of j.results) {
      for (const au of (w.authorships || [])) {
        const id = au.author?.id; const dn = au.author?.display_name;
        if (id && dn && nameMatch(dn, name)) tally.set(id, (tally.get(id) || 0) + 1);
      }
    }
  }
  const candIds = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map((e) => e[0]);
  const authors = [];
  for (const id of candIds) { const a = await fetchAuthor(id); await sleep(130); if (a) authors.push(a); }
  if (authors.length) return authors.sort((x, y) => (y.works_count || 0) - (x.works_count || 0))[0];

  // Fallback (no on-topic work found): plain author search, but require a topic
  // overlap AND real output — else a non-field suggestion (e.g. a synthetic-biology
  // chemist on a phage proposal) would resolve to a wrong tiny homonym. Better to
  // return null → honest "not resolved on-topic".
  const dtoks = new Set(dq.split(' ').filter((w) => w.length >= 4));
  const a = await jget(`${OA}/authors?search=${encodeURIComponent(name)}&per-page=10&mailto=${MAILTO}`);
  const hits = (!a.__err && a.results) ? a.results : [];
  const score = (h) => topicsOf(h).join(' ').toLowerCase().split(/[^a-z0-9]+/).filter((w) => dtoks.has(w)).length;
  const best = hits.map((h) => ({ h, s: score(h) })).sort((x, y) => y.s - x.s || (y.h.works_count || 0) - (x.h.works_count || 0))[0];
  return (best && best.s > 0 && (best.h.works_count || 0) >= 20) ? best.h : null;
}

async function yearSpan(authorId) {
  const idf = `author.id:${String(authorId).replace(/^https?:\/\/openalex\.org\//i, '')}`;
  const last = await jget(`${OA}/works?filter=${idf}&sort=publication_date:desc&per-page=1&mailto=${MAILTO}`);
  await sleep(130);
  const first = await jget(`${OA}/works?filter=${idf}&sort=publication_date:asc&per-page=1&mailto=${MAILTO}`);
  const ly = last.results?.[0]?.publication_year || null;
  const fy = first.results?.[0]?.publication_year || null;
  return { fy, ly };
}

const cache = new Map(); // resolution cache: ck -> author object | null
async function resolveCandidate(c, dq) {
  if (c._author !== undefined) return c._author; // arm-B pre-pass already fetched
  const ck = c.oaId || `name:${norm(c.name)}|${dq}`;
  if (cache.has(ck)) return cache.get(ck);
  const author = c.oaId ? await fetchAuthor(c.oaId) : await resolveAuthor(clean(c.name), dq);
  await sleep(130);
  cache.set(ck, author);
  return author;
}

async function formatDossier(author) {
  if (!author) return '_not resolved on-topic — verify manually_';
  const { fy, ly } = await yearSpan(author.id);
  const inst = instOf(author) || '—';
  const topics = topicsOf(author).join(', ') || '—';
  const works = author.works_count || 0;
  // Span > 70 yrs ⇒ OpenAlex has merged multiple humans into one cluster
  // (e.g. "Paul Turner" 1923–2026); don't trust the span or affiliation, say so.
  // (Threshold above a real long career — Casjens 1965–2026 — to avoid false flags.)
  const merged = fy && ly && (ly - fy) > 70;
  const span = merged ? `…–${ly}` : ((fy && ly) ? `${fy}–${ly}` : (ly ? `…–${ly}` : '?'));
  const flags = [];
  if (ly && ly <= NOW - 6) flags.push(`⚠ no pubs since ${ly}`);
  if (!merged && fy && ly && (ly - fy) <= 6 && works < 40) flags.push('⚠ early-career?');
  if (merged) flags.push('⚠ merged record — affiliation unreliable');
  return `${inst} · ${topics} · active ${span} (${works}w)${flags.length ? `  ${flags.join('; ')}` : ''}`;
}

const GROUPS = [
  { arm: 'A', heading: 'Claude — current pipeline', others: { B: 'grounded', C: 'applicant-rec' } },
  { arm: 'B', heading: 'Grounded retrieval (OpenAlex author-agg + cited refs)', others: { A: 'Claude', C: 'applicant-rec' } },
  { arm: 'C', heading: 'Applicant recommended', others: { A: 'Claude', B: 'grounded' } },
];
const clean = (n) => String(n || '').replace(/\s+/g, ' ').trim();

const keyFiles = readdirSync(dir).filter((f) => f.endsWith('.key.json')).sort();
let written = 0;

for (const kf of keyFiles) {
  const key = JSON.parse(readFileSync(`${dir}/${kf}`, 'utf8'));
  process.stdout.write(`\n${key.request} (${key.candidates.length} candidates) `);

  // Pre-pass: arm-B candidates carry correct OpenAlex ids and are on-field by
  // construction, so their topics define the proposal's empirical field — a far
  // better anchor for resolving arm-A/C names than the (often niche) title alone.
  const fieldTally = new Map();
  for (const c of key.candidates) {
    if (!c.oaId) continue;
    const a = await fetchAuthor(c.oaId); await sleep(130);
    c._author = a;
    if (a) for (const t of topicsOfN(a, 3)) fieldTally.set(t, (fieldTally.get(t) || 0) + 1);
  }
  const fieldTopics = [...fieldTally.entries()].sort((x, y) => y[1] - x[1]).slice(0, 4).map((e) => e[0]);
  const dq = domainQuery([...fieldTopics, key.title].join(' '));

  // Main pass: resolve + format every candidate (arm-B reuses the pre-pass fetch).
  for (const c of key.candidates) {
    c._line = await formatDossier(await resolveCandidate(c, dq));
    process.stdout.write('.');
  }

  const inArm = (a) => key.candidates.filter((c) => c.arms.includes(a)).sort((x, y) => clean(x.name).localeCompare(clean(y.name)));
  const sections = GROUPS.map((g) => {
    const members = inArm(g.arm);
    const lines = members.map((c) => {
      const tags = c.arms.filter((a) => a !== g.arm).map((a) => g.others[a]).filter(Boolean);
      return `- **${clean(c.name)}**${tags.length ? ` _(also: ${tags.join(', ')})_` : ''}\n    ${c._line}`;
    });
    return `## ${g.heading} (${members.length})\n\n${lines.join('\n') || '_(none)_'}`;
  });

  const md = `# Reviewer candidates by source — Request ${key.request}: ${key.title || '(untitled)'}

Applicant institution: ${key.applicant?.institution || '—'}
Counts: Claude ${key.counts.arm1} · Grounded ${key.counts.arm2} · Applicant-recommended ${key.counts.armC} · ${key.counts.unified} distinct people

Each name carries a dossier: **affiliation · field · active first–last year (lifetime works)**. Flags: \`⚠ no pubs since YYYY\` (likely emeritus/deceased/inactive), \`⚠ early-career?\` (short track record — possible trainee). \`_not resolved_\` = couldn't pin an on-topic OpenAlex record; verify manually.

**Your call:** scanning the **Claude** set — is it enough to staff a review panel for this proposal? If not, what's missing — and does the Grounded or Applicant-recommended set fill the gap? (Names tagged _(also: …)_ were surfaced by more than one source.)

${sections.join('\n\n')}
`;
  writeFileSync(`${dir}/${key.request}.sources.md`, md);
  written += 1;
}

console.log(`\n\nWrote ${written} enriched source-labeled file(s) to ${dir}/ (<req>.sources.md)`);
