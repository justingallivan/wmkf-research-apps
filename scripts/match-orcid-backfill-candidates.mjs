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
 *     A profile's employments decide; search-result names count only when the
 *     profile lists none. "University of X" never matches "X University";
 *   - award-time, per PI award: a dated employment at that award's institution
 *     covering that award's meeting year (±1) → yes | no | undated | unfetched;
 *   - works: an ORCID work title sharing >= 2 distinct words with an award title.
 *
 * Grades (a human reviews every row before any write). Every graded row names
 * the exact selected ORCID; the reason and signals describe that ORCID.
 *   high   — PI only, the selected profile fetched, no reviewer/email conflict,
 *            and one of: one linked reviewer ORCID (resolver status
 *            confirmed/probable, filtered in the export) with no forename
 *            contradiction; exactly one candidate whose email equals the
 *            contact email, no forename contradiction; exactly one candidate at
 *            the award institution, forename fully agreeing, institution search
 *            not truncated, and employment covering an award year — or undated
 *            employment plus a works match.
 *   review — any other candidate with an institution, email-domain or email
 *            signal; a sole full-name match whose record lists no affiliations;
 *            every co-PI candidate lands here at best.
 *   none   — no name-matching record with any corroborating signal, or a
 *            lookup error.
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
const { forenameFullyAgrees, forenamesContradict, ReviewerIdentityEvidence } = await import('../lib/services/reviewer-identity-evidence.js');
const { tokenize } = ReviewerIdentityEvidence._internals;
const { DeduplicationService } = await import('../lib/services/deduplication-service.js');
const creds = { clientId: env.ORCID_CLIENT_ID, clientSecret: env.ORCID_CLIENT_SECRET };
const PROFILES_PER_PERSON = 4; // profiles fetched for unsignalled candidates
const MAX_PROFILES = 8; // per-person ceiling, signalled candidates first
const INST_PAGE = 10; // full-name + institution search page size

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
const stripLegal = (s) => String(s || '')
  .replace(/^(the\s+)?(board of trustees of|trustees of|regents of|board of regents of|president and fellows of|arizona board of regents,?)\s+(the\s+)?/i, '');
// "University of Miami" vs "Miami University" are different institutions with
// the same distinctive words; word order decides. Also consults the shared
// helper's guard (DeduplicationService.isInverseUniversityName).
const inverseUniversity = (a, b) => {
  const x = norm(stripLegal(a)).replace(/^the /, ''); const y = norm(stripLegal(b)).replace(/^the /, '');
  const flip = (p, q) => { const m = p.match(/^university of (.+)$/); return Boolean(m) && q === `${m[1]} university`; };
  return flip(x, y) || flip(y, x) || DeduplicationService.isInverseUniversityName(
    DeduplicationService.normalizeInstitution(a), DeduplicationService.normalizeInstitution(b));
};
const instMatch = (a, b) => {
  if (inverseUniversity(a, b)) return false;
  const x = instWords(a); const y = instWords(b);
  const [small, large] = x.size <= y.size ? [x, y] : [y, x];
  if (!small.size || ![...small].every((w) => large.has(w))) return false;
  return small.size === large.size || (small.size >= 3 && large.size - small.size <= 1);
};
const namesAgree = (a, b) => !inverseUniversity(a, b) && (instMatch(a, b) || DeduplicationService.institutionDirectMatch(a, b));
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
  const cleaned = stripLegal(name).replace(/\s+at\s+/gi, ', ');
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
  // Validation rows hide linked reviewer ORCIDs: many known contact ORCIDs came
  // from an earlier reviewer back-propagation and would otherwise grade
  // themselves.
  const reviewerOrcids = person.knownOrcid ? [] : person.reviewerOrcids;

  // The person's institutions, each with a ROR id when one resolves safely.
  const insts = [];
  for (const x of person.institutions.filter((y) => usableInst(y.name))) {
    if (insts.some((y) => y.name === x.name && y.source === x.source)) continue;
    insts.push({ name: x.name, source: x.source, ror: (await rorForAffiliation(x.name))?.ror || null });
  }
  const domain = await rorForDomain((person.email.split('@')[1] || '').toLowerCase());
  if (domain && !insts.some((x) => x.ror === domain.ror)) insts.push({ name: domain.names[0], source: 'email-domain', ror: domain.ror });
  const applicants = insts.filter((x) => x.source === 'award-applicant');
  // Each PI award as its own (institution, meeting year) tuple.
  const piAwards = person.awards.filter((a) => a.role === 'PI' && usableInst(a.applicant)).map((a) => ({
    inst: applicants.find((x) => x.name === a.applicant),
    year: Number((a.meetingDate || '').slice(0, 4)),
  })).filter((a) => a.inst && a.year);
  const titles = person.awards.map((a) => a.title).filter(Boolean);
  const familyParts = norm(person.lastname).split(' ').filter((w) => w.length > 1);

  // Searches: full name; family name alone and family name + institution
  // (catch nicknames such as Terry/Terrence); full name + institution; first
  // family-name component for compound surnames. A full-name + institution
  // search that fills its page may have dropped a namesake: flag it.
  const records = new Map();
  let error = '';
  let truncated = false;
  try {
    const add = (recs) => { for (const rec of recs) records.set(rec.orcidId, rec); return recs; };
    add(await search({ name, maxResults: 25 }));
    add(await search({ name: person.lastname.replace(/\s+/g, '-'), maxResults: 25 }));
    const searchInsts = [...new Set(insts.filter((x) => x.source !== 'email-domain').map((x) => x.name))].slice(0, 2);
    if (domain && !insts.some((x) => x.source !== 'email-domain' && x.ror === domain.ror)) searchInsts.push(domain.names[0]);
    for (const inst of searchInsts) {
      if (add(await search({ name, affiliation: inst, maxResults: INST_PAGE })).length >= INST_PAGE) truncated = true;
      add(await search({ name: person.lastname.replace(/\s+/g, '-'), affiliation: inst, maxResults: INST_PAGE }));
    }
    if (familyParts.length > 1) add(await search({ name: `${person.firstname} ${familyParts[0]}`, maxResults: 10 }));
  } catch (err) { error = String(err.message || err).slice(0, 200); }

  const named = [...records.values()].map((rec) => ({ ...rec, nameLevel: nameLevel(person, rec) })).filter((rec) => rec.nameLevel);
  // Every candidate with a search-level signal gets its profile fetched (so
  // any selectable candidate has dated employments), plus the leading others.
  const preSignal = (rec) => reviewerOrcids.includes(rec.orcidId)
    || (person.email && rec.emails.some((e) => e.toLowerCase() === person.email.toLowerCase()))
    || insts.some((x) => rec.institutions.some((ri) => namesAgree(x.name, ri)));
  named.sort((a, b) => preSignal(b) - preSignal(a));
  const candidates = [];
  let fetched = 0;
  for (const [k, rec] of named.entries()) {
    let employments = [];
    let profiled = false;
    if (!error && fetched < MAX_PROFILES && (k < PROFILES_PER_PERSON || preSignal(rec))) {
      fetched += 1;
      try {
        const p = await profile(rec.orcidId);
        profiled = Boolean(p);
        employments = (p?.affiliations || []).map((a) => ({
          name: a.organization,
          ror: a.disambiguationSource === 'ROR' ? rorId(a.disambiguatedOrganizationId) : null,
          start: Number(a.startYear) || null,
          end: Number(a.endYear) || null,
        }));
      } catch (err) { error = `profile: ${String(err.message || err).slice(0, 150)}`; }
    }
    // A profile's employments decide; undated search-result names are used
    // only when the profile lists no employment (so a conflicting profile ROR
    // cannot be overridden by a search-result name).
    const orgs = employments.length ? employments : rec.institutions.map((n) => ({ name: n, ror: null }));
    const hits = (set) => orgs.some((o) => set.some((x) => orgAgrees(x, o)));
    const datedAt = (inst) => employments.filter((e) => e.start && orgAgrees(inst, e));
    const covered = piAwards.some((a) => datedAt(a.inst).some((e) => e.start <= a.year + 1 && (!e.end || e.end >= a.year - 1)));
    const anyDated = piAwards.some((a) => datedAt(a.inst).length);
    candidates.push({
      ...rec,
      employments,
      profiled,
      applicantMatch: hits(applicants),
      atAward: !profiled ? 'unfetched' : covered ? 'yes' : anyDated ? 'no' : 'undated',
      instMatch: hits(insts.filter((x) => x.source !== 'email-domain')),
      domainMatch: hits(insts.filter((x) => x.source === 'email-domain')),
      emailMatch: Boolean(person.email) && rec.emails.some((e) => e.toLowerCase() === person.email.toLowerCase()),
      reviewerMatch: reviewerOrcids.includes(rec.orcidId),
      worksMatch: false,
    });
  }
  // Works check (ORCID self-asserted works vs the award titles) for the
  // candidates that could be selected: >= 2 distinct shared title words, the
  // threshold the identity work-grounding rescue uses.
  for (const c of candidates.filter((x) => x.profiled && (x.applicantMatch || x.emailMatch) && titles.length)) {
    try {
      const works = await withRetry(() => ORCIDService.getWorks(c.orcidId, creds.clientId, creds.clientSecret, { limit: 100 }), 150);
      const titleTokens = titles.map((t) => new Set(tokenize(t)));
      c.worksMatch = works.some((w) => {
        const wt = new Set(tokenize(w));
        return titleTokens.some((tt) => [...tt].filter((tok) => wt.has(tok)).length >= 2);
      });
    } catch (err) { error = `works: ${String(err.message || err).slice(0, 150)}`; }
  }
  const levelRank = { full: 0, initial: 1, differs: 2 };
  candidates.sort((a, b) => (b.reviewerMatch - a.reviewerMatch) || (b.emailMatch - a.emailMatch)
    || (b.applicantMatch - a.applicantMatch) || (b.instMatch - a.instMatch) || (b.domainMatch - a.domainMatch)
    || (b.worksMatch - a.worksMatch) || (levelRank[a.nameLevel] - levelRank[b.nameLevel]));

  // Grade, naming the exact ORCID the grade is about.
  const eligible = (c) => c && c.profiled && c.nameLevel !== 'differs';
  const reviewerHits = candidates.filter((c) => c.reviewerMatch);
  const emailHits = candidates.filter((c) => c.emailMatch);
  const applicantHits = candidates.filter((c) => c.applicantMatch);
  const conflicting = new Set([...reviewerHits, ...emailHits].map((c) => c.orcidId)).size > 1;
  const signalled = candidates.filter((c) => c.reviewerMatch || c.emailMatch || c.instMatch || c.domainMatch);
  const noAffiliations = candidates.filter((c) => c.nameLevel === 'full' && !c.institutions.length && !c.employments.length);
  const inst = applicantHits.length === 1 ? applicantHits[0] : null;
  let grade = 'none';
  let selected = null;
  let reason = candidates.length ? `${candidates.length} name match(es), no institution/email signal` : 'no name match';
  if (error) { reason = `lookup error: ${error}`; }
  else if (isPi && !conflicting && reviewerOrcids.length === 1 && reviewerHits.length === 1 && eligible(reviewerHits[0])) {
    grade = 'high'; selected = reviewerHits[0]; reason = 'linked eligible reviewer-record ORCID; profile fetched, forename consistent';
  } else if (isPi && !conflicting && emailHits.length === 1 && eligible(emailHits[0])) {
    grade = 'high'; selected = emailHits[0]; reason = 'one name match with matching email; profile fetched';
  } else if (isPi && !conflicting && inst && inst.nameLevel === 'full' && inst.profiled && !truncated
    && (inst.atAward === 'yes' || (inst.worksMatch && inst.atAward !== 'no'))) {
    grade = 'high'; selected = inst;
    reason = inst.atAward === 'yes'
      ? `only match at the award institution, employed there in the award years${inst.worksMatch ? '; works match award title' : ''}`
      : 'only match at the award institution (undated); works match award title';
  } else if (signalled.length) {
    grade = 'review'; selected = signalled[0];
    const notes = [];
    if (conflicting) notes.push('reviewer/email point to different ORCIDs');
    if (applicantHits.length > 1) notes.push(`${applicantHits.length} accounts at the award institution`);
    if (truncated) notes.push('institution search page full');
    if (inst?.atAward === 'no') notes.push('award-institution employment outside award years');
    if (inst && ['undated', 'unfetched'].includes(inst.atAward) && !inst.worksMatch) notes.push(`employment ${inst.atAward}, no works match`);
    if (selected.nameLevel !== 'full') notes.push(`forename ${selected.nameLevel}`);
    if (!isPi) notes.push('co-PI: always reviewed');
    reason = `${signalled.length} name match(es) with a signal${notes.length ? ` (${notes.join('; ')})` : ''}`;
  } else if (reviewerOrcids.length) { grade = 'review'; reason = 'linked reviewer-record ORCID not found by name search'; }
  else if (candidates.filter((c) => c.nameLevel === 'full').length === 1 && noAffiliations.length === 1) {
    grade = 'review'; selected = noAffiliations[0]; reason = 'only full-name match; record lists no affiliations';
  }

  (person.knownOrcid ? validation : results).push({ person, grade, reason, selected, candidates, insts, piAwards, truncated });
  if (i % 25 === 0) console.log(`  ${i}/${people.length}`);
}

// Blind scoring against contacts that already carry a valid ORCID (export
// --include-known). knownOrcid is never read by the grading above, and their
// linked reviewer ORCIDs are masked.
if (validation.length) {
  const right = (v) => v.selected?.orcidId === v.person.knownOrcid;
  const listed = (v) => right(v) || v.candidates.slice(0, 3).some((c) => c.orcidId === v.person.knownOrcid);
  const highWrong = validation.filter((v) => v.grade === 'high' && !right(v));
  console.log(`\nValidation against ${validation.length} known ORCIDs (reviewer ORCIDs masked):`);
  console.log(`  high, correct:            ${validation.filter((v) => v.grade === 'high' && right(v)).length}`);
  console.log(`  high, WRONG:              ${highWrong.length}`);
  console.log(`  review, selected correct: ${validation.filter((v) => v.grade === 'review' && right(v)).length}`);
  console.log(`  review, correct in top 3: ${validation.filter((v) => v.grade === 'review' && !right(v) && listed(v)).length}`);
  console.log(`  review, correct missing:  ${validation.filter((v) => v.grade === 'review' && !listed(v)).length}`);
  console.log(`  none:                     ${validation.filter((v) => v.grade === 'none').length}`);
  for (const v of highWrong) console.log(`    WRONG: ${v.person.contactId} known ${v.person.knownOrcid} vs selected ${v.selected?.orcidId} (${v.reason})`);
}

const signalsOf = (c) => ['reviewerMatch', 'emailMatch', 'applicantMatch', 'instMatch', 'domainMatch', 'worksMatch']
  .filter((k) => c[k]).map((k) => k.replace('Match', ''))
  .concat(c.applicantMatch ? [`at-award:${c.atAward}`] : [], c.nameLevel !== 'full' ? [`forename:${c.nameLevel}`] : [], c.profiled ? [] : ['profile:unfetched'])
  .join(' ');
const employmentOf = (c) => (c.employments.length
  ? c.employments.map((e) => `${e.name}${e.ror ? ` ror:${e.ror}` : ''} (${e.start || '?'}–${e.end || 'now'})`)
  : (c.institutions || []).map((n) => `${n} (search result, undated)`)).slice(0, 6).join('; ');
const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const header = ['grade', 'reason', 'selected_orcid', 'selected_url', 'selected_name', 'selected_signals', 'selected_employment',
  'role', 'contactid', 'name', 'email', 'institutions', 'pi_awards', 'reviewer_orcids', 'name_matches', 'institution_search_full'];
for (let n = 1; n <= 3; n++) header.push(`cand${n}_orcid`, `cand${n}_name`, `cand${n}_signals`);
const lines = [header.join(',')];
const order = { high: 0, review: 1, none: 2 };
for (const r of results.sort((a, b) => order[a.grade] - order[b.grade])) {
  const { person, selected: s } = r;
  const cells = [r.grade, r.reason, s?.orcidId, s?.orcidUrl, s ? `${s.givenNames || ''} ${s.familyName || ''}`.trim() : '', s ? signalsOf(s) : '', s ? employmentOf(s) : '',
    person.roles.join('+'), person.contactId, person.fullname || `${person.firstname} ${person.lastname}`, person.email,
    r.insts.map((x) => `${x.name} [${x.source}${x.ror ? ` ror:${x.ror}` : ''}]`).join('; '),
    r.piAwards.map((a) => `${a.inst.name} ${a.year}`).join('; '),
    person.reviewerOrcids.join(' '), r.candidates.length, r.truncated ? 'yes' : ''];
  for (const c of r.candidates.slice(0, 3).concat([null, null, null]).slice(0, 3)) {
    cells.push(c?.orcidId, c ? `${c.givenNames || ''} ${c.familyName || ''}`.trim() : '', c ? signalsOf(c) : '');
  }
  lines.push(cells.map(esc).join(','));
}
fs.writeFileSync(OUT, `${lines.join('\n')}\n`);

const count = (g, pi) => results.filter((r) => r.grade === g && r.person.roles.includes('PI') === pi).length;
console.log(`\n${results.length} people — PI: high ${count('high', true)}, review ${count('review', true)}, none ${count('none', true)}`
  + ` | co-PI only: review ${count('review', false)}, none ${count('none', false)}`);
console.log(`Lookup errors: ${results.filter((r) => r.reason.startsWith('lookup error')).length}`);
console.log(`Wrote ${OUT}\n`);
