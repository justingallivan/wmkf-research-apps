/**
 * @jest-environment node
 */
import {
  mergeEnrichment,
  asPercent,
  normalizeReviewerName,
  parseExcludeList,
  filterExcluded,
  pruneCandidateForRoster,
  sanitizeInstitutionCOIDetails,
} from '../../shared/components/reviewers/reviewer-search-logic.js';
const { provenanceGroupOf } = require('../../lib/utils/reviewer-provenance');

describe('sanitizeInstitutionCOIDetails (S240)', () => {
  test('strips legacy .historical, keeps piInstitution + reviewerInstitution', () => {
    expect(sanitizeInstitutionCOIDetails({ piInstitution: 'JHU', reviewerInstitution: 'JHU', historical: true }))
      .toEqual({ piInstitution: 'JHU', reviewerInstitution: 'JHU' });
  });
  test('null / empty / non-object → null', () => {
    expect(sanitizeInstitutionCOIDetails(null)).toBeNull();
    expect(sanitizeInstitutionCOIDetails({})).toBeNull();
    expect(sanitizeInstitutionCOIDetails({ historical: true })).toBeNull();
  });
});

describe('pruneCandidateForRoster — institutionCOIDetails (S240)', () => {
  test('persists a sanitized detail (no .historical)', () => {
    const out = pruneCandidateForRoster({
      name: 'Dr P', hasInstitutionCOI: true,
      institutionCOIDetails: { piInstitution: 'MIT', reviewerInstitution: 'MIT', historical: false },
    });
    expect(out.institutionCOIDetails).toEqual({ piInstitution: 'MIT', reviewerInstitution: 'MIT' });
    expect(out.institutionCOIDetails).not.toHaveProperty('historical');
  });
});

describe('mergeEnrichment', () => {
  const candidates = [
    { name: 'Dr. A', email: null, website: null, relevanceScore: 90 },
    { name: 'Dr. B', email: 'old@b.edu' },
  ];

  test('attaches contactEnrichment and prefers its email/website by name', () => {
    const out = mergeEnrichment(candidates, [
      { name: 'Dr. A', contactEnrichment: { email: 'a@x.edu', website: 'https://a' } },
    ]);
    expect(out[0].email).toBe('a@x.edu');
    expect(out[0].website).toBe('https://a');
    expect(out[0].contactEnrichment).toEqual({ email: 'a@x.edu', website: 'https://a' });
    // unmatched candidate untouched
    expect(out[1]).toEqual(candidates[1]);
  });

  test('keeps the existing email when enrichment has none', () => {
    const out = mergeEnrichment(candidates, [
      { name: 'Dr. B', contactEnrichment: { website: 'https://b' } },
    ]);
    expect(out[1].email).toBe('old@b.edu');
    expect(out[1].website).toBe('https://b');
  });

  test('returns candidates unchanged when there are no enrichment results', () => {
    expect(mergeEnrichment(candidates, null)).toBe(candidates);
    expect(mergeEnrichment(candidates, [])).toBe(candidates);
  });

  test('non-array candidates → []', () => {
    expect(mergeEnrichment(null, [])).toEqual([]);
  });

  test('promotes bibliometrics + orcid/scholar onto the candidate top-level (save-candidates reads candidate.*)', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. C', hIndex: null }],
      [{
        name: 'Dr. C',
        contactEnrichment: {
          email: 'c@x.edu',
          orcidId: '0000-0002-1825-0097',
          orcidUrl: 'https://orcid.org/0000-0002-1825-0097',
          googleScholarId: 'ABC123',
          googleScholarUrl: 'https://scholar.google.com/citations?user=ABC123',
          hIndex: 42,
          i10Index: 88,
          totalCitations: 12345,
          facultyPageUrl: 'https://u.edu/c',
          department: 'Microbiology',
        },
      }],
    );
    expect(out[0].hIndex).toBe(42);
    expect(out[0].i10Index).toBe(88);
    expect(out[0].totalCitations).toBe(12345);
    expect(out[0].orcid).toBe('0000-0002-1825-0097');
    expect(out[0].orcidUrl).toBe('https://orcid.org/0000-0002-1825-0097');
    expect(out[0].googleScholarId).toBe('ABC123');
    expect(out[0].googleScholarUrl).toBe('https://scholar.google.com/citations?user=ABC123');
    expect(out[0].facultyPageUrl).toBe('https://u.edu/c');
    expect(out[0].department).toBe('Microbiology');
  });

  test('a real 0 h-index from enrichment is not dropped by the candidate fallback', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. D', hIndex: 9 }],
      [{ name: 'Dr. D', contactEnrichment: { hIndex: 0, totalCitations: 0 } }],
    );
    expect(out[0].hIndex).toBe(0);
    expect(out[0].totalCitations).toBe(0);
  });

  test('absent enrichment bibliometrics keep the candidate values', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. E', hIndex: 7, totalCitations: 50 }],
      [{ name: 'Dr. E', contactEnrichment: { email: 'e@x.edu' } }],
    );
    expect(out[0].hIndex).toBe(7);
    expect(out[0].totalCitations).toBe(50);
  });

  // Codex P2#1: institution COI is re-evaluated against the post-enrichment
  // affiliation; the merge promotes it only when the route flagged coiRecomputed.
  test('promotes a recomputed COI (override discover) when coiRecomputed is set, stripping legacy historical', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. F', hasInstitutionCOI: false, institutionCOIDetails: null }],
      [{ name: 'Dr. F', contactEnrichment: {
        coiRecomputed: true,
        hasInstitutionCOI: true,
        // a legacy payload may still carry historical — the merge must strip it (S240)
        institutionCOIDetails: { piInstitution: 'JHU', reviewerInstitution: 'JHU', historical: true },
      } }],
    );
    expect(out[0].hasInstitutionCOI).toBe(true);
    expect(out[0].institutionCOIDetails).toEqual({ piInstitution: 'JHU', reviewerInstitution: 'JHU' });
    expect(out[0].institutionCOIDetails).not.toHaveProperty('historical');
  });

  test('a recompute that found NO COI overrides a stale discover-true', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. G', hasInstitutionCOI: true, institutionCOIDetails: { historical: false } }],
      [{ name: 'Dr. G', contactEnrichment: { coiRecomputed: true, hasInstitutionCOI: false, institutionCOIDetails: null } }],
    );
    expect(out[0].hasInstitutionCOI).toBe(false);
    expect(out[0].institutionCOIDetails).toBeNull();
  });

  test('keeps the discover COI when the route did NOT recompute, but strips legacy historical', () => {
    const out = mergeEnrichment(
      [{ name: 'Dr. H', hasInstitutionCOI: true, institutionCOIDetails: { piInstitution: 'JHU', reviewerInstitution: 'JHU', historical: true } }],
      [{ name: 'Dr. H', contactEnrichment: { email: 'h@x.edu' } }],
    );
    expect(out[0].hasInstitutionCOI).toBe(true);
    expect(out[0].institutionCOIDetails).toEqual({ piInstitution: 'JHU', reviewerInstitution: 'JHU' });
    expect(out[0].institutionCOIDetails).not.toHaveProperty('historical');
  });
});

describe('asPercent', () => {
  test('0–1 confidence → percent', () => {
    expect(asPercent(0.87)).toBe(87);
  });
  test('0–100 score passes through rounded', () => {
    expect(asPercent(87)).toBe(87);
    expect(asPercent(72.4)).toBe(72);
  });
  test('non-number → null', () => {
    expect(asPercent(undefined)).toBeNull();
    expect(asPercent(NaN)).toBeNull();
  });
});

describe('normalizeReviewerName', () => {
  test('strips honorifics and punctuation', () => {
    expect(normalizeReviewerName('Dr. Thomas K. Wood')).toBe('thomas k wood');
  });

  test('folds diacritics to their base letter (NFD), so accented == plain', () => {
    expect(normalizeReviewerName('Prof Jens Hör')).toBe('jens hor');
    expect(normalizeReviewerName('Jens Hor')).toBe('jens hor');
    expect(normalizeReviewerName('José García')).toBe('jose garcia');
    expect(normalizeReviewerName('Müller')).toBe('muller');
    expect(normalizeReviewerName('Strauß')).toBe('strauss');
  });
});

describe('parseExcludeList', () => {
  test('splits on commas and newlines, trims, drops empties', () => {
    expect(parseExcludeList('Tom Wood,  Jens Hör\n\nJane Doe')).toEqual(['Tom Wood', 'Jens Hör', 'Jane Doe']);
    expect(parseExcludeList('')).toEqual([]);
    expect(parseExcludeList(null)).toEqual([]);
  });
});

describe('filterExcluded', () => {
  const candidates = [
    { name: 'Dr. Thomas K. Wood' },
    { name: 'Jane Smith' },
    { name: 'jens hor' },
  ];

  test('removes candidates matching excluded names (normalized, exact)', () => {
    const { kept, removed } = filterExcluded(candidates, ['Thomas K. Wood', 'Jens Hor']);
    expect(kept.map((c) => c.name)).toEqual(['Jane Smith']);
    expect(removed.map((c) => c.name)).toEqual(['Dr. Thomas K. Wood', 'jens hor']);
  });

  test('no exclusions → everything kept', () => {
    expect(filterExcluded(candidates, []).kept).toEqual(candidates);
    expect(filterExcluded(candidates, []).removed).toEqual([]);
  });

  test('does not over-filter on partial/substring names', () => {
    const { kept } = filterExcluded([{ name: 'Thomas Woodward' }], ['Thomas Wood']);
    expect(kept.map((c) => c.name)).toEqual(['Thomas Woodward']);
  });

  test('matches across diacritics — accented candidate vs plain excluded name', () => {
    const { kept, removed } = filterExcluded([{ name: 'Jens Hör' }, { name: 'Jane Smith' }], ['Jens Hor']);
    expect(kept.map((c) => c.name)).toEqual(['Jane Smith']);
    expect(removed.map((c) => c.name)).toEqual(['Jens Hör']);
  });
});

describe('pruneCandidateForRoster — model-flagged concern survives reload', () => {
  test('carries potentialConcerns into the roster DTO', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Dr. Taekjip Ha',
      affiliation: 'Harvard Medical School',
      reasoning: 'Leading single-molecule biophysicist; directly relevant.',
      potentialConcerns: 'Former Johns Hopkins faculty — shared institution with the PI.',
    });
    expect(pruned.potentialConcerns).toBe('Former Johns Hopkins faculty — shared institution with the PI.');
    // Fitness justification stays in its own field, not conflated.
    expect(pruned.reasoning).toMatch(/single-molecule/);
  });

  test('absent concern normalizes to null', () => {
    const pruned = pruneCandidateForRoster({ name: 'Jane Smith', affiliation: 'MIT' });
    expect(pruned.potentialConcerns).toBeNull();
  });

  test('verification-incoherence flag survives reload so the ranking down-weight reapplies', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Robert Sang',
      affiliation: 'Griffith University',
      verificationIncoherence: true,
      verificationIncoherenceReasons: ['institution_mismatch'],
    });
    expect(pruned.verificationIncoherence).toBe(true);
    expect(pruned.verificationIncoherenceReasons).toEqual(['institution_mismatch']);
  });

  test('folds the redundant incoherentVerification alias into the canonical flag', () => {
    const pruned = pruneCandidateForRoster({ name: 'Jane Smith', incoherentVerification: true });
    expect(pruned.verificationIncoherence).toBe(true);
  });

  test('absent incoherence normalizes to false', () => {
    const pruned = pruneCandidateForRoster({ name: 'Jane Smith', affiliation: 'MIT' });
    expect(pruned.verificationIncoherence).toBe(false);
    expect(pruned.verificationIncoherenceReasons).toEqual([]);
  });

  test('contact persist-deny flags survive roster pruning', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Yanjun Chen',
      contactEnrichment: {
        email: 'nickchenyj@gmail.com',
        website: 'https://www.cliburn.org/yanjun-chen',
        emailPersistAllowed: false,
        websitePersistAllowed: false,
        affiliationPersistAllowed: false,
      },
    });
    expect(pruned.emailPersistAllowed).toBe(false);
    expect(pruned.websitePersistAllowed).toBe(false);
    expect(pruned.affiliationPersistAllowed).toBe(false);
    expect(pruned.contactEnrichment.emailPersistAllowed).toBe(false);
    expect(pruned.contactEnrichment.websitePersistAllowed).toBe(false);
    expect(pruned.contactEnrichment.affiliationPersistAllowed).toBe(false);
  });
});

describe('pruneCandidateForRoster — identity-review markers survive reload (Slice E1b)', () => {
  // Regression for the roster reload-leak: a deferred/unresolved candidate stamped
  // identityStatus:'unresolved' at discovery would lose the marker through the roster
  // DTO and become silently selectable again on reload. pruneCandidateForRoster must
  // carry the three fields provenanceGroupOf reads so the gate holds across a reload.
  test('carries identityStatus/needsIdentification/verificationStatus and stays needs_identity_review', () => {
    const deferred = {
      name: 'Olga Smirnova',
      sources: ['openalex', 'pubmed'],
      needsIdentification: true,
      identityStatus: 'unresolved',
      verificationStatus: 'unresolved',
    };
    // Pre-prune it routes to the non-selectable group...
    expect(provenanceGroupOf(deferred)).toBe('needs_identity_review');
    const pruned = pruneCandidateForRoster(deferred);
    expect(pruned.identityStatus).toBe('unresolved');
    expect(pruned.needsIdentification).toBe(true);
    expect(pruned.verificationStatus).toBe('unresolved');
    // ...and STILL routes there after the roster round-trip (no reload-leak).
    expect(provenanceGroupOf(pruned)).toBe('needs_identity_review');
  });

  test('a resolved candidate stays selectable after prune (no false-positive gating)', () => {
    const resolved = {
      name: 'Erika Keller',
      sources: ['openalex'],
      needsIdentification: false,
      identityStatus: 'confirmed',
      verificationStatus: 'verified',
    };
    const pruned = pruneCandidateForRoster(resolved);
    expect(pruned.needsIdentification).toBe(false);
    expect(provenanceGroupOf(pruned)).not.toBe('needs_identity_review');
  });
});

describe('pruneCandidateForRoster — S238 graded-COI + warning markers survive reload', () => {
  // Without these, a roster reload silently regresses a 'possible' overlap to red (the
  // UI fallback treats a missing strength as 'likely') and drops the off-topic /
  // few-publications warnings entirely.
  it('preserves coauthorCOIStrength and the shared-paper counts', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Jane Smith',
      hasCoauthorCOI: true,
      coauthorCOIStrength: 'possible',
      coauthorSharedPaperTotal: 2,
      coauthorMaxWithOneAuthor: 1,
    });
    expect(pruned.hasCoauthorCOI).toBe(true);
    expect(pruned.coauthorCOIStrength).toBe('possible');
    expect(pruned.coauthorSharedPaperTotal).toBe(2);
    expect(pruned.coauthorMaxWithOneAuthor).toBe(1);
  });

  it('preserves aiFlaggedNotRelevant and lowPublicationCount warnings', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Jane Smith',
      aiFlaggedNotRelevant: true,
      lowPublicationCount: true,
      lowPublicationCountFound: 2,
    });
    expect(pruned.aiFlaggedNotRelevant).toBe(true);
    expect(pruned.lowPublicationCount).toBe(true);
    expect(pruned.lowPublicationCountFound).toBe(2);
  });

  it('defaults the markers to false/null when absent (no accidental flags)', () => {
    const pruned = pruneCandidateForRoster({ name: 'Jane Smith', affiliation: 'MIT' });
    expect(pruned.coauthorCOIStrength).toBeNull();
    expect(pruned.aiFlaggedNotRelevant).toBe(false);
    expect(pruned.lowPublicationCount).toBe(false);
  });
});
