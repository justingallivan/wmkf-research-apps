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
 *            contact email; or exactly one name-matching record listing the
 *            award's applicant institution.
 *   review — some name-matching record with an institution or email signal,
 *            but not unambiguous; every co-PI candidate lands here at best.
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
  .replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\b(the|inc|of)\b/g, ' ').replace(/\s+/g, ' ').trim();
const instMatch = (a, b) => {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 8 && (x.includes(y) || y.includes(x)));
};
const firstToken = (s) => norm(s).split(' ')[0] || '';
function nameMatches(person, rec) {
  const family = norm(person.lastname);
  const given = firstToken(person.firstname);
  const recFamily = norm(rec.familyName);
  if (!family || !recFamily || !(recFamily === family || recFamily.split(' ').includes(family) || family.split(' ').includes(recFamily))) return false;
  const recGiven = firstToken(rec.givenNames);
  if (!given || !recGiven) return false;
  return recGiven === given || (given.length === 1 && recGiven.startsWith(given)) || (recGiven.length === 1 && given.startsWith(recGiven));
}

const { people } = JSON.parse(fs.readFileSync(IN, 'utf8'));
const results = [];
let i = 0;
for (const person of people) {
  i += 1;
  const name = `${person.firstname} ${person.lastname}`.trim() || person.fullname;
  const isPi = person.roles.includes('PI');
  const applicants = person.institutions.filter((x) => x.source === 'award-applicant').map((x) => x.name);
  const allInst = person.institutions.map((x) => x.name);

  // Name-only search plus one search per distinct institution (max 2).
  const records = new Map();
  let error = '';
  try {
    for (const rec of await search({ name, maxResults: 25 })) records.set(rec.orcidId, rec);
    for (const inst of [...new Set(allInst)].slice(0, 2)) {
      for (const rec of await search({ name, affiliation: inst, maxResults: 10 })) records.set(rec.orcidId, rec);
    }
  } catch (err) { error = String(err.message || err).slice(0, 200); }

  const candidates = [...records.values()].filter((rec) => nameMatches(person, rec)).map((rec) => ({
    ...rec,
    applicantMatch: applicants.some((a) => rec.institutions.some((ri) => instMatch(a, ri))),
    instMatch: allInst.some((a) => rec.institutions.some((ri) => instMatch(a, ri))),
    emailMatch: Boolean(person.email) && rec.emails.some((e) => e.toLowerCase() === person.email.toLowerCase()),
    reviewerMatch: person.reviewerOrcids.includes(rec.orcidId),
  }));
  candidates.sort((a, b) => (b.reviewerMatch - a.reviewerMatch) || (b.emailMatch - a.emailMatch)
    || (b.applicantMatch - a.applicantMatch) || (b.instMatch - a.instMatch));

  const reviewerHits = candidates.filter((c) => c.reviewerMatch);
  const emailHits = candidates.filter((c) => c.emailMatch);
  const applicantHits = candidates.filter((c) => c.applicantMatch);
  const signalled = candidates.filter((c) => c.reviewerMatch || c.emailMatch || c.instMatch);
  let grade = 'none';
  let reason = error ? `search error: ${error}` : candidates.length ? `${candidates.length} name match(es), no institution/email signal` : 'no name match';
  if (isPi && person.reviewerOrcids.length === 1 && reviewerHits.length === 1) { grade = 'high'; reason = 'linked reviewer-record ORCID; profile name matches'; }
  else if (isPi && emailHits.length === 1) { grade = 'high'; reason = 'one name match with matching email'; }
  else if (isPi && applicantHits.length === 1) { grade = 'high'; reason = 'one name match listing the award institution'; }
  else if (signalled.length) { grade = 'review'; reason = `${signalled.length} name match(es) with a signal${isPi ? '' : ' (co-PI: always reviewed)'}`; }
  else if (person.reviewerOrcids.length) { grade = 'review'; reason = 'linked reviewer-record ORCID not found by name search'; }

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
    const signals = c.orcidId ? ['reviewerMatch', 'emailMatch', 'applicantMatch', 'instMatch'].filter((k) => c[k]).map((k) => k.replace('Match', '')).join(' ') : '';
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
