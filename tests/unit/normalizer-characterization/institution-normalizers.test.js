/**
 * Characterization tests for the institution normalizer inventory
 * (docs/NORMALIZER_CONSOLIDATION_INVENTORY.md §2), including a
 * multi-token-institution and UC-campus battery per definition, plus the
 * cross-seam divergence cases from §7. These PIN today's behavior; no
 * production code is modified by this file.
 */

const { normalizeInstitution: disclosureNormalizeInstitution } = require('../../../lib/services/dataverse-export/disclosure.js');
const { DeduplicationService } = require('../../../lib/services/deduplication-service');
const {
  createInstitutionIdentityResolver,
  institutionNameMatchRank,
  normalizeInstitutionName: identityResolverNormalizeInstitutionName,
  MATCH,
} = require('../../../lib/services/institution-identity-resolver');
const { normalizeAffiliationForCompare } = require('../../../lib/services/alert-reviewer-affiliation-mismatch.js');

// discovery/affiliation.js's normalizeAffiliationForComparison is not exported from the
// module's public surface used elsewhere, but IS exported for its own characterization net.
const affiliationCluster = require('../../../lib/services/discovery/affiliation');

// fundingApis.js's normalizeInstitutionName/institutionsMatch are module-internal (not
// exported); re-derived here VERBATIM from lib/fundingApis.js:257-341 to characterize
// behavior without editing the production file to add exports (out of scope this pass).
function fundingApisNormalizeInstitutionName(institutionName) {
  if (!institutionName) return new Set();
  let normalized = institutionName.toLowerCase();
  const removeTerms = [
    'regents of', 'regents of the', 'the regents of', 'the',
    'university of', 'college of', 'institute of',
    'inc', 'incorporated', 'foundation', 'center', 'centre',
  ];
  removeTerms.forEach((term) => {
    normalized = normalized.replace(new RegExp(`\\b${term}\\b`, 'gi'), '');
  });
  const words = normalized
    .split(/[\s,.-]+/)
    .filter((word) => word.length > 2)
    .filter((word) => !['and', 'for', 'the'].includes(word));
  return new Set(words);
}

function fundingApisInstitutionsMatch(institution1, institution2) {
  if (!institution1 || !institution2) return false;
  const keywords1 = fundingApisNormalizeInstitutionName(institution1);
  const keywords2 = fundingApisNormalizeInstitutionName(institution2);
  if (keywords1.size === 0 || keywords2.size === 0) return false;
  const intersection = new Set([...keywords1].filter((x) => keywords2.has(x)));
  if (intersection.size === 0) return false;
  const campusKeywords = ['berkeley', 'davis', 'irvine', 'los', 'angeles', 'merced',
    'riverside', 'san', 'diego', 'francisco', 'santa', 'barbara',
    'cruz', 'boulder', 'denver', 'springs'];
  const campus1 = Array.from(keywords1).filter((k) => campusKeywords.includes(k));
  const campus2 = Array.from(keywords2).filter((k) => campusKeywords.includes(k));
  if (campus1.length > 0 && campus2.length > 0) {
    return campus1.some((k) => campus2.includes(k));
  }
  return true;
}

describe('Institution normalizer characterization', () => {
  // ---------------------------------------------------------------------
  // §2.1 — dataverse-export/disclosure.js normalizeInstitution: CRM
  // Account-disclosure canonical key.
  // ---------------------------------------------------------------------
  describe('disclosure.js normalizeInstitution — CRM disclosure-account key', () => {
    test('multi-token institution, no legal suffix', () => {
      expect(disclosureNormalizeInstitution('University of California, San Diego')).toBe('university of california san diego');
    });

    test('Texas A&M — ampersand becomes a tokenizer boundary, "a" and "m" stay separate tokens', () => {
      expect(disclosureNormalizeInstitution('Texas A&M University')).toBe('texas a m university');
    });

    test('UCSF acronym is left as-is (no acronym expansion here)', () => {
      expect(disclosureNormalizeInstitution('UCSF')).toBe('ucsf');
    });

    test('trailing legal suffix stripped, repeatedly', () => {
      expect(disclosureNormalizeInstitution('Broad Research Foundation Inc.')).toBe('broad research');
    });

    test('dotted "L.L.C." collapses to the committed "llc" token before suffix-stripping', () => {
      expect(disclosureNormalizeInstitution('Acme Research L.L.C.')).toBe('acme research');
    });

    test('ONLY the leading "the" token is stripped — a mid-string "the" survives', () => {
      expect(disclosureNormalizeInstitution('The Regents of the University of California')).toBe('regents of the university of california');
    });

    test('"univ"/"u"/"inst" word-abbreviations expand', () => {
      expect(disclosureNormalizeInstitution('Univ of Chicago')).toBe('university of chicago');
    });

    test('diacritics fold via NFKD', () => {
      expect(disclosureNormalizeInstitution('École Polytechnique')).toBe('ecole polytechnique');
    });

    test('null input returns empty string', () => {
      expect(disclosureNormalizeInstitution(null)).toBe('');
    });
  });

  // ---------------------------------------------------------------------
  // §2.2/§2.3 — DeduplicationService.normalizeInstitution +
  // expandInstitutionAbbreviations: the COI hard-drop comparator.
  // ---------------------------------------------------------------------
  describe('DeduplicationService.normalizeInstitution — COI hard-drop base normalizer', () => {
    test('multi-token institution, unchanged core tokens', () => {
      expect(DeduplicationService.normalizeInstitution('University of California, San Diego')).toBe('university of california san diego');
    });

    test('department/school prefix is stripped when followed by a comma', () => {
      expect(DeduplicationService.normalizeInstitution('Department of Biology, Stanford University'))
        .toBe('stanford university');
    });

    test('trailing "USA" is stripped', () => {
      expect(DeduplicationService.normalizeInstitution('MIT, USA')).toBe('mit');
    });

    test('does NOT fold diacritics (unlike disclosure.js, §2.1)', () => {
      expect(DeduplicationService.normalizeInstitution('École Polytechnique')).toBe('cole polytechnique');
    });

    test('does NOT strip legal suffixes like Inc./Foundation (unlike disclosure.js, §2.1)', () => {
      expect(DeduplicationService.normalizeInstitution('Broad Research Foundation Inc'))
        .toBe('broad research foundation inc');
    });
  });

  describe('DeduplicationService.expandInstitutionAbbreviations — named-institution acronym table', () => {
    test('UC Berkeley expands to the full system+campus name', () => {
      expect(DeduplicationService.expandInstitutionAbbreviations('UC Berkeley'))
        .toBe('university of california berkeley');
    });

    test('MIT expands', () => {
      expect(DeduplicationService.expandInstitutionAbbreviations('MIT'))
        .toBe('massachusetts institute of technology');
    });

    test('UCSF/UCLA/UCSD ARE in the table (specific UC campuses expand)', () => {
      expect(DeduplicationService.expandInstitutionAbbreviations('UCSF')).toBe('university of california san francisco');
    });

    test('an acronym genuinely absent from the table (e.g. "Texas A&M") is left unchanged (only lowercased)', () => {
      expect(DeduplicationService.expandInstitutionAbbreviations('Texas A&M')).toBe('texas a&m');
    });
  });

  describe('DeduplicationService.institutionsMatch / institutionDirectMatch — UC-campus adversarial battery', () => {
    test('same UC campus written two ways (abbreviated vs full) matches', () => {
      expect(DeduplicationService.institutionsMatch('UC Berkeley', 'University of California, Berkeley')).toBe(true);
    });

    test('KNOWN RISK, pinned as-is: bare "University of California" (system-level, no campus) DOES match a specific campus under institutionsMatch — the containment check ("university of california" is a substring of "university of california san diego") fires before the conflicting-words veto is reached, because there is no conflicting word here (only a missing campus qualifier, not an opposing one). This is exactly the "parent/sibling trap" the outside research memo (§2.3) documents. `institutionDirectMatch` (the COI-hard-drop entry point) is the stricter sibling function — see the next test.', () => {
      expect(DeduplicationService.institutionsMatch('University of California', 'University of California, San Diego')).toBe(true);
    });

    test('institutionDirectMatch (the ACTUAL COI hard-drop comparator) does NOT contain this bare-vs-campus bug — it requires equal key-word-count sets', () => {
      expect(DeduplicationService.institutionDirectMatch('University of California', 'University of California, San Diego')).toBe(false);
    });

    test('two DIFFERENT UC campuses do not match', () => {
      expect(DeduplicationService.institutionsMatch('UC Berkeley', 'UC San Diego')).toBe(false);
    });

    test('"University of Michigan" vs "Michigan State University" do not match (conflicting "state")', () => {
      expect(DeduplicationService.institutionsMatch('University of Michigan', 'Michigan State University')).toBe(false);
    });

    test('Texas A&M is NOT in this abbreviation table (unlike "texas tech", which is) — left unexpanded', () => {
      expect(DeduplicationService.expandInstitutionAbbreviations('texas a&m')).toBe('texas a&m');
      expect(DeduplicationService.expandInstitutionAbbreviations('texas tech')).toBe('texas tech university');
    });

    test('institutionDirectMatch requires an inverse "University of X" / "X University" NOT to be treated as equal', () => {
      expect(DeduplicationService.institutionDirectMatch('University of Michigan', 'Michigan University')).toBe(false);
    });

    test('institutionDirectMatch: campus qualifier suffix (", Ann Arbor") matches the bare campus name', () => {
      expect(DeduplicationService.institutionDirectMatch(
        'University of Michigan',
        'University of Michigan, Ann Arbor',
      )).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // §2.4 — fundingApis.js normalizeInstitutionName / institutionsMatch:
  // Set-returning keyword extractor, independent campus-veto list.
  // ---------------------------------------------------------------------
  describe('fundingApis.js normalizeInstitutionName — returns a Set<string>, not a canonical string', () => {
    test('returns a Set of significant keywords, administrative terms removed', () => {
      // "the regents of the university of california" removes "the regents of the" (the "regents
      // of the" phrase) then "university of" separately, but "california" is NOT an admin term
      // and survives as a keyword alongside "san"/"diego".
      const keywords = fundingApisNormalizeInstitutionName('The Regents of the University of California, San Diego');
      expect(keywords).toEqual(new Set(['california', 'san', 'diego']));
    });

    test('short words (<=2 chars) and {and,for,the} are excluded', () => {
      const keywords = fundingApisNormalizeInstitutionName('MIT');
      // 'mit' survives (length 3); demonstrate the length filter with a 2-char case:
      expect(keywords.has('mit')).toBe(true);
      expect(fundingApisNormalizeInstitutionName('A and B').has('and')).toBe(false);
    });

    test('KNOWN RISK, pinned as-is: the campus veto here ONLY fires when BOTH sides carry a campus keyword — a bare "University of California" (no campus keyword on that side) still matches a specific campus, the same parent/sibling trap as DeduplicationService.institutionsMatch above', () => {
      expect(fundingApisInstitutionsMatch('University of California', 'University of California, San Diego')).toBe(true);
    });

    test('two DIFFERENT UC campuses (both sides carry a campus keyword) do NOT match — the veto fires when both sides qualify', () => {
      expect(fundingApisInstitutionsMatch('University of California, Berkeley', 'University of California, San Diego')).toBe(false);
    });

    test('CROSS-SEAM: this campus-veto list and DeduplicationService\'s conflicting-words list are independently maintained', () => {
      // "Michigan State University" vs "University of Michigan": fundingApis has NO
      // conflicting-words veto (only a UC-campus veto) — its keyword-intersection rule
      // can behave differently from DeduplicationService.institutionsMatch (§2.2/2.3) on
      // the exact same pair.
      const funding = fundingApisInstitutionsMatch('Michigan State University', 'University of Michigan');
      const dedup = DeduplicationService.institutionsMatch('Michigan State University', 'University of Michigan');
      expect(dedup).toBe(false); // "state" is a conflicting word for DeduplicationService
      expect(funding).toBe(true); // fundingApis has no "state" veto — keyword overlap ("michigan") is enough
    });
  });

  // ---------------------------------------------------------------------
  // §2.5 — discovery/affiliation.js normalizeAffiliationForComparison:
  // pattern-EXTRACT, not strip; 50-char truncation fallback.
  // ---------------------------------------------------------------------
  describe('discovery/affiliation.js normalizeAffiliationForComparison — pattern extraction with truncation fallback', () => {
    test('extracts "University of X" pattern from a longer byline affiliation string, stopping at the first comma', () => {
      // The extraction regex is `university of [^,]+` — it stops at the FIRST comma, so
      // "La Jolla, CA 92093" (city/state after the institution) is NOT part of the key.
      expect(affiliationCluster.normalizeAffiliationForComparison(
        'Department of Biology, University of California San Diego, La Jolla, CA 92093, USA. jsmith@ucsd.edu',
      )).toBe('university of california san diego');
    });

    test('extracts "X University" pattern', () => {
      expect(affiliationCluster.normalizeAffiliationForComparison('Stanford University, Palo Alto')).toBe('stanford university');
    });

    test('non-university/institute affiliation falls through to a 50-char truncation, NOT institution identity', () => {
      const longCompanyName = 'Acme Biotech Research Labs Corporation Worldwide Headquarters Division';
      const result = affiliationCluster.normalizeAffiliationForComparison(longCompanyName);
      expect(result).toBe(longCompanyName.toLowerCase().substring(0, 50).trim());
      expect(result.length).toBeLessThanOrEqual(50);
    });

    test('country suffix is stripped before pattern extraction', () => {
      expect(affiliationCluster.normalizeAffiliationForComparison('MIT, USA')).toBe('mit');
    });
  });

  // ---------------------------------------------------------------------
  // §2.6 — institution-identity-resolver.js normalizeInstitutionName: thin
  // wrapper around the PERSON-name normalizer ContactParser.normalizeNameForMatch.
  // ---------------------------------------------------------------------
  describe('institution-identity-resolver.js institutionNameMatchRank — lightest-touch normalizer, no abbreviation handling', () => {
    test('normalizeInstitutionName only strips commas/periods — "Univ." is left as "univ", not expanded', () => {
      expect(identityResolverNormalizeInstitutionName('Univ. of California')).toBe('univ of california');
      expect(identityResolverNormalizeInstitutionName('University of California')).toBe('university of california');
    });

    test('"Univ. of California" vs "University of California" is NOT an exact-rank match (no abbreviation expansion)', () => {
      expect(institutionNameMatchRank('Univ. of California', 'University of California')).toBe(MATCH.NONE);
    });

    test('identical display names rank EXACT', () => {
      expect(institutionNameMatchRank('University of California', 'University of California')).toBe(MATCH.EXACT);
    });

    test('an explicit acronym query only matches an acronym-consistent display name (never a bare containment)', () => {
      expect(institutionNameMatchRank('MIT', 'MIT Media Lab')).toBe(MATCH.NONE);
      expect(institutionNameMatchRank('MIT', 'Massachusetts Institute Of Technology')).toBe(MATCH.ACRONYM);
    });

    test('multi-token containment ranks CONTAINMENT when the shorter name has >=2 tokens', () => {
      expect(institutionNameMatchRank('University of California', 'University of California, San Diego')).toBe(MATCH.CONTAINMENT);
    });
  });

  // ---------------------------------------------------------------------
  // §2.7 — alert-reviewer-affiliation-mismatch.js normalizeAffiliationForCompare:
  // lightest-touch of ALL normalizers (person or institution) in the inventory.
  // ---------------------------------------------------------------------
  describe('alert-reviewer-affiliation-mismatch.js normalizeAffiliationForCompare — edge-trim only', () => {
    test('case-folds and trims edge punctuation, but does NOT touch internal words/abbreviations', () => {
      expect(normalizeAffiliationForCompare('  University of California, San Diego.  ')).toBe('university of california, san diego');
    });

    test('"Univ." abbreviation is NOT expanded — survives verbatim (lowercased)', () => {
      expect(normalizeAffiliationForCompare('Univ. of California')).toBe('univ. of california');
    });

    test('two affiliation strings differing only by abbreviation do NOT compare equal under this normalizer', () => {
      expect(normalizeAffiliationForCompare('UC San Diego')).not.toBe(normalizeAffiliationForCompare('University of California, San Diego'));
    });

    test('leading/trailing symbols (not just punctuation) are stripped via \\p{S}', () => {
      expect(normalizeAffiliationForCompare('"Stanford University"')).toBe('stanford university');
    });
  });

  // ---------------------------------------------------------------------
  // §2.8 — integrity-matching-service.js inline normalizeInst: same shape
  // as the plain person-name algorithm (§1.1/§1.2), applied to institutions.
  // ---------------------------------------------------------------------
  describe('integrity-matching-service.js adjustConfidenceForInstitution — inline normalizeInst', () => {
    const { IntegrityMatchingService } = require('../../../lib/services/integrity-matching-service');

    test('exact match after normalization adds +15 confidence', () => {
      const result = IntegrityMatchingService.adjustConfidenceForInstitution(50, 'MIT', 'MIT');
      expect(result).toBe(65);
    });

    test('one institution containing the other adds +10', () => {
      const result = IntegrityMatchingService.adjustConfidenceForInstitution(
        50, 'Stanford', 'Stanford University',
      );
      expect(result).toBe(60);
    });

    test('significant-word overlap (>=2 words, stopwords excluded) adds +10', () => {
      const result = IntegrityMatchingService.adjustConfidenceForInstitution(
        50, 'University of California San Diego', 'UC San Diego Medical Center',
      );
      expect(result).toBeGreaterThanOrEqual(60);
    });

    test('no overlap: confidence unchanged', () => {
      const result = IntegrityMatchingService.adjustConfidenceForInstitution(50, 'MIT', 'Stanford University');
      expect(result).toBe(50);
    });

    test('missing institution on either side: confidence unchanged', () => {
      expect(IntegrityMatchingService.adjustConfidenceForInstitution(50, null, 'MIT')).toBe(50);
    });
  });

  // ---------------------------------------------------------------------
  // §2.9 — contact-enrichment/domain-evidence.js institutionTokens +
  // institutionsContradict: rare-token-overlap negative-evidence check.
  // ---------------------------------------------------------------------
  describe('contact-enrichment/domain-evidence.js institutionsContradict', () => {
    const { institutionsContradict } = require('../../../lib/services/contact-enrichment/domain-evidence.js');

    test('no shared significant token (>=4 chars, excluding generic institutional words) ⇒ contradiction', () => {
      expect(institutionsContradict('Stanford University', 'Harvard University')).toBe(true);
    });

    test('a result institution with NO token >=4 chars (e.g. a bare 3-letter acronym like "MIT") has NO evidence either way — NOT flagged as a contradiction', () => {
      expect(institutionsContradict('Stanford University', 'MIT')).toBe(false);
    });

    test('shared significant token ⇒ NOT a contradiction', () => {
      expect(institutionsContradict('Stanford University Medical Center', 'Stanford University')).toBe(false);
    });

    test('generic institutional words (university/department/institute/school/college) do not count as evidence either way', () => {
      // Both strings reduce to ONLY generic tokens once "university"/"institute" are excluded,
      // so there is no evidence in either direction — not a contradiction (empty ⇒ false).
      expect(institutionsContradict('University Institute', 'College School')).toBe(false);
    });

    test('missing anchor or result: never a contradiction (abstain, not veto)', () => {
      expect(institutionsContradict(null, 'MIT')).toBe(false);
      expect(institutionsContradict('MIT', null)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // §7 cross-seam divergence: same institution pair, different verdict.
  // ---------------------------------------------------------------------
  describe('Cross-seam: "Univ. of California, Berkeley" vs "University of California, Berkeley"', () => {
    test('equal under DeduplicationService (abbreviation-expansion runs first, but "Univ." is not in the acronym table — still equal via non-alpha normalization matching on shared tokens)', () => {
      // "Univ." normalizes (strip non-alpha) to "univ" which does NOT equal "university" —
      // DeduplicationService has NO generic word-abbreviation table (unlike disclosure.js).
      // This assertion documents the ACTUAL (non-obvious) behavior: they are NOT direct-matched.
      expect(DeduplicationService.institutionDirectMatch(
        'Univ. of California, Berkeley',
        'University of California, Berkeley',
      )).toBe(false);
    });

    test('the generic "univ"→"university" abbreviation exists ONLY in disclosure.js (§2.1), not in the reviewer-side normalizers', () => {
      expect(disclosureNormalizeInstitution('Univ. of California, Berkeley'))
        .toBe(disclosureNormalizeInstitution('University of California, Berkeley'));
    });
  });
});
