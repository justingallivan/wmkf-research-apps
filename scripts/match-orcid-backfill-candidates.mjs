/**
 * match-orcid-backfill-candidates.mjs — stage 1 of the Research PI/co-PI ORCID
 * backfill. Reads the pool JSON written by
 * export-research-orcid-backfill-pool.mjs, searches the public ORCID registry,
 * and writes a review CSV. No Dataverse access and no Dataverse writes; the
 * only network calls are ORCID's token and expanded-search endpoints.
 *
 * Grades (a human reviews every row before any write):
 *   high   — PI only: one reviewer-record ORCID whose profile name matches; or
 *            exactly one name-matching ORCID record whose email equals the
 *            contact email; or exactly one record with the same first given
 *            name listing the award's applicant institution.
 *   review — some name-matching record with an institution or email signal,
 *            but not unambiguous (incl. first-initial-only matches such as
 *            nicknames); a sole full-name match whose record lists no
 *            affiliations; every co-PI candidate lands here at best.
 *   none   — no name-matching record with any corroborating signal.
 * `institution-name` in expanded search lists every affiliation on the record
 * (any period), so an institution match is not proof of award-time employment.
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
const creds = { clientId: env.ORCID_CLIENT_ID, clientSecret: env.ORCID_CLIENT_SECRET };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function search(opts) {
  for (let attempt = 0; ; attempt++) {
    try {
      await sleep(150);
      return await ORCIDService.searchByName({ ...creds, ...opts });
    } catch (err) {
      if (attempt >= 3 || !(err.status === 429 || err.status >= 500)) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Institutions: compare the distinctive words after dropping legal boilerplate
// ("Regents of", "Board of Trustees of", ...) and generic words (university,
// research, center, ...). Sets must be equal, or the smaller (>= 3 words) may
// miss at most one word of the larger — so "University of Washington" never
// matches "Washington State University", "University of San Diego" never
// matches UC San Diego, nor a UC system name a UC campus.
const BOILERPLATE = new Set('the of at and in for a an inc corporation regents board trustees president fellows leland junior campus'.split(' '));
const GENERIC = new Set('university univ college institute institutes school center centre research medical medicine hospital foundation laboratory laboratories health sciences science department faculty'.split(' '));
const instWords = (s) => new Set(norm(s).split(' ').filter((w) => w && !BOILERPLATE.has(w) && !GENERIC.has(w)));
const instMatch = (a, b) => {
  const x = instWords(a); const y = instWords(b);
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size || ![...small].every((w) => large.has(w))) return false;
  return small.size === large.size || (small.size >= 3 && large.size - small.size <= 1);
};
// The Foundation itself is not an institution signal for a grantee.
const usableInst = (s) => s && !/keck foundation/i.test(s);

// Name match level: 'full' (same first given name) | 'initial' (same first
// initial — nicknames like Terry/Terrence) | null. Family names match on any
// shared hyphen/space component (Podlaha-Murphy ~ Podlaha).
const firstToken = (s) => norm(s).split(' ')[0] || '';
function nameMatch(person, rec) {
  const fam = norm(person.lastname).split(' ').filter((w) => w.length > 1);
  const recFam = norm(rec.familyName).split(' ').filter((w) => w.length > 1);
  if (!fam.length || !recFam.some((w) => fam.includes(w))) return null;
  const given = firstToken(person.firstname);
  const recGiven = firstToken(rec.givenNames);
  if (!given || !recGiven || given[0] !== recGiven[0]) return null;
  if (recGiven === given || given.length === 1 || recGiven.length === 1) return 'full';
  return 'initial';
}

const { people } = JSON.parse(fs.readFileSync(IN, 'utf8'));
const results = [];
let i = 0;
for (const person of people) {
  i += 1;
  const name = `${person.firstname} ${person.lastname}`.trim() || person.fullname;
  const isPi = person.roles.includes('PI');
  const applicants = person.institutions.filter((x) => x.source === 'award-applicant' && usableInst(x.name)).map((x) => x.name);
  const allInst = [...new Set(person.institutions.map((x) => x.name).filter(usableInst))];
  const familyParts = norm(person.lastname).split(' ').filter((w) => w.length > 1);

  // Searches: full name; full name + institution; family name + institution
  // (catches nicknames); first family-name component for compound surnames.
  const records = new Map();
  let error = '';
  try {
    const add = (recs) => { for (const rec of recs) records.set(rec.orcidId, rec); };
    add(await search({ name, maxResults: 25 }));
    for (const inst of allInst.slice(0, 2)) {
      add(await search({ name, affiliation: inst, maxResults: 10 }));
      add(await search({ name: person.lastname.replace(/\s+/g, '-'), affiliation: inst, maxResults: 10 }));
    }
    if (familyParts.length > 1) add(await search({ name: `${person.firstname} ${familyParts[0]}`, maxResults: 10 }));
  } catch (err) { error = String(err.message || err).slice(0, 200); }

  const candidates = [...records.values()].map((rec) => ({ ...rec, nameLevel: nameMatch(person, rec) }))
    .filter((rec) => rec.nameLevel).map((rec) => ({
      ...rec,
      applicantMatch: applicants.some((a) => rec.institutions.some((ri) => instMatch(a, ri))),
      instMatch: allInst.some((a) => rec.institutions.some((ri) => instMatch(a, ri))),
      emailMatch: Boolean(person.email) && rec.emails.some((e) => e.toLowerCase() === person.email.toLowerCase()),
      reviewerMatch: person.reviewerOrcids.includes(rec.orcidId),
    }));
  candidates.sort((a, b) => (b.reviewerMatch - a.reviewerMatch) || (b.emailMatch - a.emailMatch)
    || (b.applicantMatch - a.applicantMatch) || (b.instMatch - a.instMatch) || ((a.nameLevel === 'full' ? 0 : 1) - (b.nameLevel === 'full' ? 0 : 1)));

  const full = (c) => c.nameLevel === 'full';
  const reviewerHits = candidates.filter((c) => c.reviewerMatch);
  const emailHits = candidates.filter((c) => c.emailMatch);
  const applicantHits = candidates.filter((c) => c.applicantMatch);
  const signalled = candidates.filter((c) => c.reviewerMatch || c.emailMatch || c.instMatch);
  const fullNoInst = candidates.filter((c) => full(c) && !c.institutions.length);
  let grade = 'none';
  let reason = error ? `search error: ${error}` : candidates.length ? `${candidates.length} name match(es), no institution/email signal` : 'no name match';
  if (isPi && person.reviewerOrcids.length === 1 && reviewerHits.length === 1) { grade = 'high'; reason = 'linked reviewer-record ORCID; profile name matches'; }
  else if (isPi && emailHits.length === 1) { grade = 'high'; reason = 'one name match with matching email'; }
  else if (isPi && applicantHits.length === 1 && full(applicantHits[0])) { grade = 'high'; reason = 'one name match listing the award institution'; }
  else if (signalled.length) {
    grade = 'review';
    reason = `${signalled.length} name match(es) with a signal${signalled.some(full) ? '' : ' (first initial only)'}${isPi ? '' : ' (co-PI: always reviewed)'}`;
  } else if (person.reviewerOrcids.length) { grade = 'review'; reason = 'linked reviewer-record ORCID not found by name search'; }
  else if (candidates.filter(full).length === 1 && fullNoInst.length === 1) { grade = 'review'; reason = 'only full-name match; record lists no affiliations'; }

  results.push({ person, grade, reason, candidates });
  if (i % 25 === 0) console.log(`  ${i}/${people.length}`);
}

const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['grade', 'reason', 'role', 'contactid', 'name', 'email', 'institutions', 'award_years', 'reviewer_orcids', 'name_matches'];
for (let n = 1; n <= 3; n++) header.push(`cand${n}_orcid`, `cand${n}_url`, `cand${n}_name`, `cand${n}_signals`, `cand${n}_institutions`);
const lines = [header.join(',')];
const order = { high: 0, review: 1, none: 2 };
for (const { person, grade, reason, candidates } of results.sort((a, b) => order[a.grade] - order[b.grade])) {
  const cells = [grade, reason, person.roles.join('+'), person.contactId, person.fullname || `${person.firstname} ${person.lastname}`, person.email,
    person.institutions.map((x) => `${x.name} [${x.source}]`).join('; '),
    [...new Set(person.awards.map((a) => (a.meetingDate || '').slice(0, 4)))].join(' '),
    person.reviewerOrcids.join(' '), candidates.length];
  for (const c of candidates.slice(0, 3).concat([{}, {}, {}]).slice(0, 3)) {
    const signals = c.orcidId ? ['reviewerMatch', 'emailMatch', 'applicantMatch', 'instMatch'].filter((k) => c[k]).map((k) => k.replace('Match', ''))
      .concat(c.nameLevel === 'initial' ? ['first-initial-only'] : []).join(' ') : '';
    cells.push(c.orcidId, c.orcidUrl, c.orcidId ? `${c.givenNames || ''} ${c.familyName || ''}`.trim() : '', signals, (c.institutions || []).slice(0, 6).join('; '));
  }
  lines.push(cells.map(esc).join(','));
}
fs.writeFileSync(OUT, `${lines.join('\n')}\n`);

const count = (g, pi) => results.filter((r) => r.grade === g && r.person.roles.includes('PI') === pi).length;
console.log(`\n${results.length} people — PI: high ${count('high', true)}, review ${count('review', true)}, none ${count('none', true)}`
  + ` | co-PI only: review ${count('review', false)}, none ${count('none', false)}`);
console.log(`Search errors: ${results.filter((r) => r.reason.startsWith('search error')).length}`);
console.log(`Wrote ${OUT}\n`);
