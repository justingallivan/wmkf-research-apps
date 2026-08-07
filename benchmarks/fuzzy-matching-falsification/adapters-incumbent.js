#!/usr/bin/env node
/**
 * Incumbent adapter set — baseline freeze (S405/session 2026-08-06, execution
 * explicitly authorized for THIS run; see benchmarks/fuzzy-matching-falsification/README.md
 * for the "build, don't execute" history this run lifts).
 *
 * Wraps EXISTING production matching code, READ-ONLY. No file under lib/,
 * shared/, pages/, tests/ is modified. Live OpenAlex calls are made — the
 * frozen 2026-08-06 baseline ran KEYED (OPENALEX_API_KEY sourced from
 * .env.local, matching production; see baseline/incumbent-2026-08-06.md for
 * the discarded keyless/broken-key runs).
 *
 * ============================================================================
 * MAPPING DECISIONS (this section IS part of the baseline record)
 * ============================================================================
 *
 * institutionResolve (case kind "resolve"):
 *   Seam: createInstitutionIdentityResolver().resolve(affiliation_string).
 *   The resolver signature is `resolve(affiliation, { countryCode, signal })` —
 *   it has NO parameter for `domain_evidence`. Cases carrying domain_evidence
 *   (the uc-sibling-domain family) are run with that field DISCARDED — the
 *   incumbent literally cannot consume it. That is itself a finding, not an
 *   adapter bug.
 *   - non-null identity  -> outcome 'resolved', target { name: displayName,
 *     ror_id: ror || null }.
 *   - null (no unique candidate; the resolver's contract is "never choose by
 *     rank alone, return null for missing/weak/tied") -> outcome 'review'.
 *     Justification: a null here is the resolver's built-in abstention, which
 *     is functionally a "send to a human" signal, not a hard failure to
 *     resolve; cases that actually want 'unresolved' as the correct abstention
 *     label will score as a documented outcome-vocabulary mismatch, not an
 *     adapter defect — recorded per-case in the report, not hidden.
 *   - The incumbent has NO multi-org detection. A multi-org string
 *     (inst-hier-003, "Dana-Farber Cancer Institute and Harvard Medical
 *     School...") is run as a single opaque query string; whatever the
 *     resolver returns (probably null/review, possibly a wrong single winner)
 *     is scored as-is. No skip — the seam exists, it's just wrong, which is
 *     the point of a falsification suite.
 *
 * institutionPairConsistent (case kind "pair-consistency"):
 *   Seam: createInstitutionConsistencyChecker().areConsistent(listed, evidence)
 *   — the exact function S400 probed.
 *   - true  -> outcome 'resolved', consistent: true.
 *   - false -> outcome 'review', consistent: false. Justification: the
 *     product intent documented in the case notes (inst-byline-012: "a
 *     correct system flags it INFORMATIVELY... never silently resolves it")
 *     treats a checker `false` as a review trigger, not a terminal
 *     'unresolved' — this matches inst-hier-001's expected 'review' with an
 *     unrelated-but-linked pair, and distinguishes the byline-normalization
 *     false-mismatch defect (checker says false, correct answer is
 *     consistent:true -> FAIL) from the one genuine flag (checker says false,
 *     correct answer IS review -> PASS).
 *
 * personMatch (case kind "pair-match"):
 *   Three real incumbent predicates cover most cases; anchor-keyed cases are
 *   skipped (see below).
 *   - candidate.kind === 'scholar-profile': SerpContactService.scholarNameMismatch(
 *     target.name, "<displayed_name> - <institution> - Google Scholar") — the
 *     exact guard that fixed the canonical Tsai/Nakano failure (S214). A
 *     synthetic Scholar-style title is built from the case fields since these
 *     cases don't carry a raw SERP title.
 *     mismatch === true  -> match:false, outcome 'unresolved'.
 *     mismatch === false -> match:true,  outcome 'resolved'.
 *   - all other candidate kinds (presented-person / byline-author /
 *     orcid-record / pubmed-verified-author): a composite of
 *     ContactParser.namesMatch (the dedup/exclusion-filter name comparator —
 *     exact-or-last-name+first-initial) and
 *     reviewer-identity-evidence.forenamesContradict (the S236 negative-
 *     evidence predicate: full forename disagreement, initials never
 *     contradict).
 *       forenamesContradict === true -> match:false, outcome 'unresolved'
 *         (veto wins regardless of namesMatch).
 *       else namesMatch === true      -> match:true,  outcome 'resolved'.
 *       else                          -> match:false, outcome 'unresolved'.
 *     KNOWN LIMITATION BY DESIGN, not an adapter bug: this composite is
 *     strictly binary. It has no 'review' band, no nickname table (namesMatch
 *     does not consult NICKNAME_MAP — that map lives at a different call
 *     site), and no diacritic folding or name-frequency weighting. Cases
 *     whose expected outcome is 'review', or that need nickname/diacritic
 *     equivalence, are EXPECTED to fail against this composite — that is the
 *     documented gap the independent research memo (outputs/fuzzy-matching-
 *     independent-research-fable-2026-08-05.md §1) describes, reproduced here
 *     as a frozen baseline number rather than an assertion.
 *   - target.anchors or candidate.anchors present (person-006, person-007):
 *     SKIPPED. The real anchor-collapse predicate
 *     (`partitionRediscoveredCandidates` / `buildEngagedSavedIndex` in
 *     shared/utils/reviewer-rediscovery.js) is an ES module (`import`/
 *     `export`, extensionless internal imports) that only loads through the
 *     Next.js/Jest toolchain — it is not `require()`-able from a bare Node
 *     script without adding a transpilation dependency, which is out of
 *     scope (no new npm dependencies). person-006's own input is also
 *     entirely structural `<placeholders>` per the case file. Recorded as a
 *     skip, not faked.
 *
 * contactAttribute (case kinds "attribution" / "conflict" / "validation"):
 *   Seam: ContactEnrichmentService._validateEmailAgainstVerifiedDomain, i.e.
 *   lib/services/contact-enrichment/email-adjudication.js
 *   validateEmailAgainstVerifiedDomain(ce), which mutates a plain `ce` object
 *   in place. A case is SKIPPED when its `contact_evidence.email` is absent
 *   or is itself a structural `<placeholder>` (the exact field this predicate
 *   compares) — that's contact-001, contact-002, contact-004 (its email is a
 *   placeholder even though the surrounding note describes a real domain
 *   shape). contact-003 has no `contact_evidence.email` at all (it carries
 *   top-level `stored_email`/`found_email` instead) and is also SKIPPED,
 *   doubly so: an address-conflict is a fail-closed state machine, not a
 *   single isolable predicate.
 *   ce is built as { email, emailSource: 'serp_search' (proxy for any
 *   SERP/Claude web-search-sourced contact — the case's contact_evidence.kind
 *   values are all search-shaped), anchoredInstitutionDomains: [scholar_
 *   verified_domain] if present else [], emailPersistAllowed: true (simulates
 *   the pre-guard accepted state) }.
 *     - domain related to an anchored domain -> attach:true, outcome 'resolved'
 *       (function sets emailPersistAllowed=true and returns early).
 *     - no anchored domain at all -> function no-ops (returns without
 *       touching anything) -> attach:true, outcome 'resolved' (keep-biased
 *       pass-through — this is the historical-evidence-decay/corresponding-
 *       author cases, contact-007/contact-008, run for real: they have a
 *       concrete email but no scholar_verified_domain field, so this predicate
 *       has nothing to check them against and defaults to keep. Their
 *       expected outcomes require evidence-recency and shared-inbox reasoning
 *       this predicate doesn't have — a real, reportable gap, not a skip).
 *     - anchored domain present and NOT related, source is search-like ->
 *       function marks emailSource='search_contested' -> attach:false,
 *       outcome 'unresolved'.
 *
 * affiliationCurrent (case kind "current-affiliation"):
 *   NOT WIRED. The incumbent has no evidence-ledger / current-vs-historical
 *   affiliation ranking implementation anywhere in the codebase (confirmed by
 *   the independent research inventory). All 6 affiliation-current.jsonl
 *   cases are left with no adapter; runSuite already reports these as
 *   'skipped' (no affiliationCurrent adapter) and they are counted as such.
 *
 * Politeness: a ~150ms delay is inserted before each live OpenAlex-touching
 * call (resolve / pair-consistency).
 * ============================================================================
 */

const { createInstitutionIdentityResolver } = require('../../lib/services/institution-identity-resolver');
const { createInstitutionConsistencyChecker } = require('../../lib/services/institution-affiliation-consistency');
const { ContactParser } = require('../../lib/utils/contact-parser');
const { forenamesContradict } = require('../../lib/services/reviewer-identity-evidence');
const { SerpContactService } = require('../../lib/services/serp-contact-service');
const { validateEmailAgainstVerifiedDomain } = require('../../lib/services/contact-enrichment/email-adjudication');

const OPENALEX_DELAY_MS = 150;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const resolver = createInstitutionIdentityResolver();
const checker = createInstitutionConsistencyChecker({ resolver });

// Adapter-level skip: run.js recognizes `{ skipped: true, reason }` (added to
// the harness for this run — see run.js's runAdapter/judge changes) and
// records the case as skipped rather than judging it pass/fail.
function skip(reason) {
  return { skipped: true, reason };
}

async function institutionResolve(input) {
  await sleep(OPENALEX_DELAY_MS);
  const identity = await resolver.resolve(input.affiliation_string);
  if (!identity) {
    return { outcome: 'review', target: null };
  }
  return {
    outcome: 'resolved',
    target: { name: identity.displayName, ror_id: identity.ror || null },
  };
}

async function institutionPairConsistent(input) {
  await sleep(OPENALEX_DELAY_MS);
  const consistent = await checker.areConsistent(input.listed, input.evidence);
  return {
    outcome: consistent ? 'resolved' : 'review',
    consistent,
  };
}

function scholarTitleFor(candidate) {
  const inst = candidate.institution || '';
  return `${candidate.displayed_name} - ${inst} - Google Scholar`;
}

async function personMatch(input) {
  const { target, candidate } = input;
  if (target?.anchors || candidate?.anchors) {
    return skip('anchor-based matching lives in shared/utils/reviewer-rediscovery.js (ES module, not require()-able without adding a transpiler dependency)');
  }

  if (candidate?.kind === 'scholar-profile') {
    const mismatch = SerpContactService.scholarNameMismatch(target?.name, scholarTitleFor(candidate));
    return mismatch
      ? { outcome: 'unresolved', match: false }
      : { outcome: 'resolved', match: true };
  }

  const contradicts = forenamesContradict(target?.name, candidate?.displayed_name);
  if (contradicts) {
    return { outcome: 'unresolved', match: false };
  }
  const normTarget = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(target?.name || ''));
  const normCandidate = ContactParser.normalizeNameForMatch(ContactParser.stripHonorifics(candidate?.displayed_name || ''));
  const matches = ContactParser.namesMatch(normTarget, normCandidate);
  return matches
    ? { outcome: 'resolved', match: true }
    : { outcome: 'unresolved', match: false };
}

async function contactAttribute(input) {
  const { person, contact_evidence: evidence } = input;
  const email = evidence?.email;
  // Cases carrying only structural placeholders for the email/domain (the
  // exact fields this predicate compares) or gating on the address-conflict
  // state machine have no runnable seam here.
  if (!email || /^<.*>$/.test(String(email).trim())) {
    return skip('placeholder or absent email/domain — no comparable value for validateEmailAgainstVerifiedDomain');
  }
  if (input.stored_email !== undefined || input.found_email !== undefined) {
    return skip('address-conflict is a fail-closed state machine (docs/REVIEWER_ADDRESS_TRUST_AND_CONFLICT_RESOLUTION_PLAN.md), not a single isolable predicate');
  }

  const verifiedDomain = person?.scholar_verified_domain || null;
  const ce = {
    email,
    emailSource: 'serp_search',
    anchoredInstitutionDomains: verifiedDomain ? [verifiedDomain] : [],
    emailPersistAllowed: true,
  };
  validateEmailAgainstVerifiedDomain(ce);

  const attach = ce.emailPersistAllowed === true && ce.emailSource !== 'search_contested';
  return {
    outcome: attach ? 'resolved' : 'unresolved',
    attach,
  };
}

module.exports = {
  institutionResolve,
  institutionPairConsistent,
  personMatch,
  contactAttribute,
};
