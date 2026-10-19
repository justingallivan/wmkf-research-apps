/**
 * match-orcid-backfill-candidates.mjs — stage 1 of the Research PI/co-PI ORCID
 * backfill. Reads the pool JSON written by
 * export-research-orcid-backfill-pool.mjs, searches the public ORCID registry,
 * and writes a review CSV. No Dataverse access and no Dataverse writes. Network
 * calls: ORCID (token, expanded-search, public record) and ROR v2 organization
 * search (institution names and email domains only, never person data).
 * OpenAlex is deliberately not called: its key's daily budget is shared with
 * production.
 *
 * Evidence per candidate ORCID record:
 *   - name: surname component match plus the production forename gates
 *     (`forenameFullyAgrees` / `forenamesContradict`,
 *     lib/services/reviewer-identity-evidence.js);
 *   - institution: the record's dated employments (`ORCIDService.getProfile`)
 *     and expanded-search institution names, compared to the person's
 *     institutions by ROR id when both sides have one, else by name
 *     (`instMatch` below, which understands grantee legal names, or
 *     `DeduplicationService.institutionDirectMatch`);
 *   - award-time: whether a dated employment at the award institution covers
 *     an award year (±1).
 *
 * Grades (a human reviews every row before any write):
 *   high   — PI only, and one of: one reviewer-record ORCID whose profile name
 *            matches; exactly one candidate whose email equals the contact
 *            email; exactly one candidate at the award institution, with a
 *            fully agreeing forename and not contradicted by dated employment.
 *   review — some candidate with an institution, email-domain or email signal
 *            that is not unambiguous; first-initial or differing forenames
 *            (nicknames); a sole full-name match whose record lists no
 *            affiliations; every co-PI candidate lands here at best.
 *   none   — no name-matching record with any corroborating signal.
 *
 *   node scripts/match-orcid-backfill-candidates.mjs --in=<pool.json> --out=<review.csv>
 */

import fs from 'fs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const IN = arg('in');
const OUT = arg('out');
if (!IN || !OUT) { console.error('--in=<pool.json> and --out=<review.csv> are required'); process.exit(2); }

// Only the ORCID client credentials are read from .env.local.
const env = {};
try {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^(ORCID_CLIENT_ID|ORCID_CLIENT_SECRET)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  }
} catch { console.error('Could not read .env.local — run from repo root.'); process.exit(2); }
if (!env.ORCID_CLIENT_ID || !env.ORCID_CLIENT_SECRET) { console.error('ORCID client credentials missing from .env.local'); process.exit(2); }

const { ORCIDService } = await import('../lib/services/orcid-service.js');
const { forenameFullyAgrees, forenamesContradict } = await import('../lib/services/reviewer-identity-evidence.js');
const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
const creds = { clientId: env.ORCID_CLIENT_ID, clientSecret: env.ORCID_CLIENT_SECRET };
const PROFILES_PER_PERSON = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, pauseMs) {
  for (let attempt = 0; ; attempt++) {
    try {
      await sleep(pauseMs);
      return await fn();
    } catch (err) {
      if (attempt >= 3 || !(err.status === 429 || err.status >= 500)) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}
const search = (opts) => withRetry(() => ORCIDService.searchByName({ ...creds, ...opts }), 150);
const profile = (orcidId) => withRetry(() => ORCIDService.getProfile(orcidId, creds.clientId, creds.clientSecret), 150);
async function ror(query) {
  return withRetry(async () => {
    const res = await fetch(`https://api.ror.org/v2/organizations?${query}`);
    if (!res.ok) { const err = new Error(`ROR ${res.status}`); err.status = res.status; throw err; }
    return (await res.json()).items || [];
  }, 100);
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Institution names: compare the distinctive words after dropping legal
// boilerplate ("Regents of", "Board of Trustees of", ...) and generic words
// (university, research, center, ...). Sets must be equal, or the smaller
// (>= 3 words) may miss at most one word of the larger — so "University of
// Washington" never matches "Washington State University", "University of San
// Diego" never matches UC San Diego, nor a UC system name a UC campus.
// DeduplicationService.institutionDirectMatch is also consulted, but it does
// not understand grantee legal names (it rejects "Regents of the University of
// California at Los Angeles" vs "University of California Los Angeles").
const BOILERPLATE = new Set('the of at and in for a an inc corporation regents board trustees president fellows leland junior campus'.split(' '));
const GENERIC = new Set('university univ college institute institutes school center centre research medical medicine hospital foundation laboratory laboratories health sciences science department faculty'.split(' '));
const instWords = (s) => new Set(norm(s).split(' ').filter((w) => w && !BOILERPLATE.has(w) && !GENERIC.has(w)));
const instMatch = (a, b) => {
  const x = instWords(a); const y = instWords(b);
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size || ![...small].every((w) => large.has(w))) return false;
  return small.size === large.size || (small.size >= 3 && large.size - small.size <= 1);
};
const namesAgree = (a, b) => instMatch(a, b) || DeduplicationService.institutionDirectMatch(a, b);
// Both sides { name, ror? }: ROR ids decide when both exist; otherwise names.
const orgAgrees = (a, b) => (a.ror && b.ror ? a.ror === b.ror : namesAgree(a.name, b.name));
// The Foundation itself is not an institution signal for a grantee.
const usableInst = (s) => s && !/keck foundation/i.test(s);
const rorId = (id) => (id ? String(id).replace(/^https?:\/\/ror\.org\//, '').toLowerCase() : null);
const rorNames = (org) => (org.names || []).filter((n) => !n.types.includes('acronym'))
  .sort((a, b) => b.types.includes('ror_display') - a.types.includes('ror_display')).map((n) => n.value);

// Institution string → ROR id via ROR's affiliation matcher, after stripping
// legal boilerplate. ROR's "chosen" pick is accepted only when one of its
// names independently agrees with the string (ROR alone maps "Purdue
// University" to an unrelated university and "University of California at San
// Diego" to the UC system).
const affiliationCache = new Map();
async function rorForAffiliation(name) {
  if (affiliationCache.has(name)) return affiliationCache.get(name);
  const cleaned = name
    .replace(/^(the\s+)?(board of trustees of|trustees of|regents of|board of regents of|president and fellows of|arizona board of regents,?)\s+(the\s+)?/i, '')
    .replace(/\s+at\s+/gi, ', ');
  let result = null;
  try {
    const chosen = (await ror(`affiliation=${encodeURIComponent(cleaned)}`)).filter((it) => it.chosen).map((it) => it.organization);
    const agreeing = chosen.filter((org) => rorNames(org).some((n) => instMatch(cleaned, n)));
    if (agreeing.length === 1) result = { ror: rorId(agreeing[0].id), names: rorNames(agreeing[0]) };
  } catch { /* fall back to name matching */ }
  affiliationCache.set(name, result);
  return result;
}

// Email domain → institution via ROR (only the domain is sent). Keep records
// listing the exact domain; prefer the one with sub-units (a campus over its
// labs); otherwise accept a sole exact record. Subdomains fall back to their
// parent domain (mednet.ucla.edu → ucla.edu). This reflects the person's
// CURRENT institution, so it can lift a match to review, never high.
const FREEMAIL = /^(gmail|googlemail|yahoo|hotmail|outlook|live|icloud|me|mac|aol|protonmail|comcast|msn)\./;
const domainCache = new Map();
async function rorForDomain(domain) {
  if (!domain || FREEMAIL.test(domain)) return null;
  if (domainCache.has(domain)) return domainCache.get(domain);
  let result = null;
  const labels = domain.split('.');
  for (let k = 0; k <= labels.length - 2 && !result; k++) {
    const d = labels.slice(k).join('.');
    try {
      const exact = (await ror(`query.advanced=${encodeURIComponent(`domains:${d}`)}`)).filter((it) => (it.domains || []).includes(d));
      const parents = exact.filter((it) => (it.relationships || []).some((r) => r.type === 'child'));
      const pick = parents.length === 1 ? parents[0] : exact.length === 1 ? exact[0] : null;
      if (pick) result = { ror: rorId(pick.id), names: rorNames(pick) };
    } catch { break; }
  }
  domainCache.set(domain, result);
  return result;
}

// Name: surname must share a component (Podlaha-Murphy ~ Podlaha) and the first
// initial must agree. Level from the production forename gates: 'full'
// (forenames fully agree), 'differs' (both full and different — nicknames such
// as Terry/Terrence, or a namesake), else 'initial'.
function nameLevel(person, rec) {
  const fam = norm(person.lastname).split(' ').filter((w) => w.length > 1);
  const recFam = norm(rec.familyName).split(' ').filter((w) => w.length > 1);
  if (!fam.length || !recFam.some((w) => fam.includes(w))) return null;
  const given = norm(person.firstname)[0];
  const recGiven = norm(rec.givenNames)[0];
  if (!given || given !== recGiven) return null;
  const personName = `${person.firstname} ${person.lastname}`;
  const recName = `${rec.givenNames || ''} ${rec.familyName || ''}`;
  if (forenameFullyAgrees(personName, recName)) return 'full';
  return forenamesContradict(personName, recName) ? 'differs' : 'initial';
}

const { people } = JSON.parse(fs.readFileSync(IN, 'utf8'));
const results = [];
const validation = [];
let i = 0;
for (const person of people) {
  i += 1;
  const name = `${person.firstname} ${person.lastname}`.trim() || person.fullname;
  const isPi = person.roles.includes('PI');
  const awardYears = person.awards.map((a) => Number((a.meetingDate || '').slice(0, 4))).filter(Boolean);

  // The person's institutions, each with a ROR id when one resolves safely.
  const insts = [];
  for (const x of person.institutions.filter((y) => usableInst(y.name))) {
    if (insts.some((y) => y.name === x.name && y.source === x.source)) continue;
    insts.push({ name: x.name, source: x.source, ror: (await rorForAffiliation(x.name))?.ror || null });
  }
  const domain = await rorForDomain((person.email.split('@')[1] || '').toLowerCase());
  if (domain && !insts.some((x) => x.ror === domain.ror)) insts.push({ name: domain.names[0], source: 'email-domain', ror: domain.ror });
  const applicants = insts.filter((x) => x.source === 'award-applicant');
  const familyParts = norm(person.lastname).split(' ').filter((w) => w.length > 1);

  // Searches: full name; family name alone and family name + institution
  // (catch nicknames such as Terry/Terrence); full name + institution; first
  // family-name component for compound surnames.
  const records = new Map();
  let error = '';
  try {
    const add = (recs) => { for (const rec of recs) records.set(rec.orcidId, rec); };
    add(await search({ name, maxResults: 25 }));
    add(await search({ name: person.lastname.replace(/\s+/g, '-'), maxResults: 25 }));
    const searchInsts = [...new Set(insts.filter((x) => x.source !== 'email-domain').map((x) => x.name))].slice(0, 2);
    if (domain && !insts.some((x) => x.source !== 'email-domain' && x.ror === domain.ror)) searchInsts.push(domain.names[0]);
    for (const inst of searchInsts) {
      add(await search({ name, affiliation: inst, maxResults: 10 }));
      add(await search({ name: person.lastname.replace(/\s+/g, '-'), affiliation: inst, maxResults: 10 }));
    }
    if (familyParts.length > 1) add(await search({ name: `${person.firstname} ${familyParts[0]}`, maxResults: 10 }));
  } catch (err) { error = String(err.message || err).slice(0, 200); }

  const named = [...records.values()].map((rec) => ({ ...rec, nameLevel: nameLevel(person, rec) })).filter((rec) => rec.nameLevel);
  // Pre-rank by search-result institution names, then fetch dated
  // employments for the leading candidates.
  named.sort((a, b) => insts.some((x) => b.institutions.some((ri) => namesAgree(x.name, ri)))
    - insts.some((x) => a.institutions.some((ri) => namesAgree(x.name, ri))));
  const candidates = [];
  for (const [k, rec] of named.entries()) {
    let employments = [];
    if (k < PROFILES_PER_PERSON && !error) {
      try {
        const p = await profile(rec.orcidId);
        employments = (p?.affiliations || []).map((a) => ({
          name: a.organization,
          ror: a.disambiguationSource === 'ROR' ? rorId(a.disambiguatedOrganizationId) : null,
          start: Number(a.startYear) || null,
          end: Number(a.endYear) || null,
        }));
      } catch (err) { error = `profile: ${String(err.message || err).slice(0, 150)}`; }
    }
    const orgs = [...employments, ...rec.institutions.map((n) => ({ name: n, ror: null }))];
    const hits = (set) => orgs.some((o) => set.some((x) => orgAgrees(x, o)));
    const atApplicant = employments.filter((e) => applicants.some((x) => orgAgrees(x, e)));
    const dated = atApplicant.filter((e) => e.start);
    const covers = dated.some((e) => awardYears.some((y) => e.start <= y + 1 && (!e.end || e.end >= y - 1)));
    candidates.push({
      ...rec,
      employments,
      applicantMatch: hits(applicants),
      atAward: covers ? 'yes' : dated.length ? 'no' : 'unknown',
      instMatch: hits(insts.filter((x) => x.source !== 'email-domain')),
      domainMatch: hits(insts.filter((x) => x.source === 'email-domain')),
      emailMatch: Boolean(person.email) && [...rec.emails].some((e) => e.toLowerCase() === person.email.toLowerCase()),
      reviewerMatch: person.reviewerOrcids.includes(rec.orcidId),
    });
  }
  const levelRank = { full: 0, initial: 1, differs: 2 };
  candidates.sort((a, b) => (b.reviewerMatch - a.reviewerMatch) || (b.emailMatch - a.emailMatch)
    || (b.applicantMatch - a.applicantMatch) || (b.instMatch - a.instMatch) || (b.domainMatch - a.domainMatch)
    || (levelRank[a.nameLevel] - levelRank[b.nameLevel]));

  const full = (c) => c.nameLevel === 'full';
  const reviewerHits = candidates.filter((c) => c.reviewerMatch);
  const emailHits = candidates.filter((c) => c.emailMatch);
  const applicantHits = candidates.filter((c) => c.applicantMatch);
  const signalled = candidates.filter((c) => c.reviewerMatch || c.emailMatch || c.instMatch || c.domainMatch);
  const noAffiliations = candidates.filter((c) => full(c) && !c.institutions.length && !c.employments.length);
  let grade = 'none';
  let reason = error ? `lookup error: ${error}` : candidates.length ? `${candidates.length} name match(es), no institution/email signal` : 'no name match';
  if (isPi && person.reviewerOrcids.length === 1 && reviewerHits.length === 1 && !error) { grade = 'high'; reason = 'linked reviewer-record ORCID; profile name matches'; }
  else if (isPi && emailHits.length === 1 && !error) { grade = 'high'; reason = 'one name match with matching email'; }
  else if (isPi && applicantHits.length === 1 && full(applicantHits[0]) && applicantHits[0].atAward !== 'no' && !error) {
    grade = 'high';
    reason = applicantHits[0].atAward === 'yes' ? 'one name match employed at the award institution in the award years' : 'one name match listing the award institution';
  } else if (signalled.length) {
    grade = 'review';
    const notes = [];
    if (!signalled.some(full)) notes.push('forename not fully agreeing');
    if (applicantHits.length === 1 && applicantHits[0].atAward === 'no') notes.push('award-institution employment outside award years');
    if (!isPi) notes.push('co-PI: always reviewed');
    reason = `${signalled.length} name match(es) with a signal${notes.length ? ` (${notes.join('; ')})` : ''}`;
  } else if (person.reviewerOrcids.length) { grade = 'review'; reason = 'linked reviewer-record ORCID not found by name search'; }
  else if (candidates.filter(full).length === 1 && noAffiliations.length === 1) { grade = 'review'; reason = 'only full-name match; record lists no affiliations'; }

  (person.knownOrcid ? validation : results).push({ person, grade, reason, candidates, insts });
  if (i % 25 === 0) console.log(`  ${i}/${people.length}`);
}

// Blind scoring against contacts that already carry a valid ORCID (export
// --include-known). knownOrcid is never read by the grading above.
if (validation.length) {
  const top = (v) => v.candidates[0]?.orcidId === v.person.knownOrcid;
  const listed = (v) => v.candidates.slice(0, 3).some((c) => c.orcidId === v.person.knownOrcid);
  const highWrong = validation.filter((v) => v.grade === 'high' && !top(v));
  console.log(`\nValidation against ${validation.length} known ORCIDs:`);
  console.log(`  high, correct:            ${validation.filter((v) => v.grade === 'high' && top(v)).length}`);
  console.log(`  high, WRONG:              ${highWrong.length}`);
  console.log(`  review, correct in top 3: ${validation.filter((v) => v.grade === 'review' && listed(v)).length}`);
  console.log(`  review, correct missing:  ${validation.filter((v) => v.grade === 'review' && !listed(v)).length}`);
  console.log(`  none:                     ${validation.filter((v) => v.grade === 'none').length}`);
  for (const v of highWrong) console.log(`    WRONG: ${v.person.contactId} known ${v.person.knownOrcid} vs matched ${v.candidates[0]?.orcidId} (${v.reason})`);
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['grade', 'reason', 'role', 'contactid', 'name', 'email', 'institutions', 'award_years', 'reviewer_orcids', 'name_matches'];
for (let n = 1; n <= 3; n++) header.push(`cand${n}_orcid`, `cand${n}_url`, `cand${n}_name`, `cand${n}_signals`, `cand${n}_employment`);
const lines = [header.join(',')];
const order = { high: 0, review: 1, none: 2 };
for (const { person, grade, reason, candidates, insts } of results.sort((a, b) => order[a.grade] - order[b.grade])) {
  const cells = [grade, reason, person.roles.join('+'), person.contactId, person.fullname || `${person.firstname} ${person.lastname}`, person.email,
    insts.map((x) => `${x.name} [${x.source}${x.ror ? ` ror:${x.ror}` : ''}]`).join('; '),
    [...new Set(person.awards.map((a) => (a.meetingDate || '').slice(0, 4)))].join(' '),
    person.reviewerOrcids.join(' '), candidates.length];
  for (const c of candidates.slice(0, 3).concat([{}, {}, {}]).slice(0, 3)) {
    const signals = c.orcidId ? ['reviewerMatch', 'emailMatch', 'applicantMatch', 'instMatch', 'domainMatch'].filter((k) => c[k]).map((k) => k.replace('Match', ''))
      .concat(c.applicantMatch ? [`at-award:${c.atAward}`] : [], c.nameLevel !== 'full' ? [`forename:${c.nameLevel}`] : []).join(' ') : '';
    const employment = c.orcidId
      ? (c.employments.length ? c.employments.map((e) => `${e.name} (${e.start || '?'}–${e.end || 'now'})`) : (c.institutions || []).map((n) => `${n} (undated)`)).slice(0, 6).join('; ')
      : '';
    cells.push(c.orcidId, c.orcidUrl, c.orcidId ? `${c.givenNames || ''} ${c.familyName || ''}`.trim() : '', signals, employment);
  }
  lines.push(cells.map(esc).join(','));
}
fs.writeFileSync(OUT, `${lines.join('\n')}\n`);

const count = (g, pi) => results.filter((r) => r.grade === g && r.person.roles.includes('PI') === pi).length;
console.log(`\n${results.length} people — PI: high ${count('high', true)}, review ${count('review', true)}, none ${count('none', true)}`
  + ` | co-PI only: review ${count('review', false)}, none ${count('none', false)}`);
console.log(`Lookup errors: ${results.filter((r) => r.reason.startsWith('lookup error')).length}`);
console.log(`Wrote ${OUT}\n`);
