/**
 * @jest-environment node
 */
import {
  mergeEnrichment,
  asPercent,
  normalizeReviewerName,
  parseExcludeList,
  parseReferredSeeds,
  filterExcluded,
  hasValidApplicantEnrichmentCache,
  isCandidateSelectable,
  candidateWasSaved,
  pruneCandidateForRoster,
  pruneEmailEvidence,
  sanitizeInstitutionCOIDetails,
  mergeReferredProvenance,
  dedupeByNamePreferReferred,
  reviewerCandidateKey,
  withReviewerCandidateKey,
} from '../../shared/components/reviewers/reviewer-search-logic.js';
const { PROVENANCE_KINDS, provenanceGroupOf, provenanceKindOf, provenanceLabelForCandidate } = require('../../lib/utils/reviewer-provenance');
const { normalizeReviewerName: normName } = require('../../lib/utils/reviewer-name-match');

describe('parseReferredSeeds', () => {
  test('parses one-per-line referred reviewer seeds with referrer context', () => {
    expect(parseReferredSeeds(
      [
        'Jane Smith, jane@example.edu, University of Example https://example.edu/jane',
        'Dr. Amir Khan | amir@uni.edu | Uni Lab',
        'Jane Smith, jane@example.edu',
      ].join('\n'),
      'Dr. Abby Doyle'
    )).toEqual([
      {
        name: 'Jane Smith',
        email: 'jane@example.edu',
        affiliation: 'University of Example',
        url: 'https://example.edu/jane',
        referredBy: 'Dr. Abby Doyle',
      },
      {
        name: 'Dr. Amir Khan',
        email: 'amir@uni.edu',
        affiliation: 'Uni Lab',
        referredBy: 'Dr. Abby Doyle',
      },
    ]);
  });
});

describe('pruneCandidateForRoster — referred seed anchors survive reload', () => {
  test('keeps server-derived seed anchor fields for save-time revalidation', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Jane Smith',
      source: 'referred',
      isReferredSeed: true,
      referredBy: 'Dr. Abby Doyle',
      seedResolvedPotentialReviewerId: 'PID-SEED',
      seedResolvedContactId: 'CONTACT-SEED',
      seedIdentityMatchKey: 'email',
      seedIdentityNameConsistent: true,
      provenance: { kind: 'referred', seedRole: 'referred_by', sources: [], groundingWorkIds: [], referredBy: 'Dr. Abby Doyle' },
    });
    expect(pruned).toEqual(expect.objectContaining({
      isReferredSeed: true,
      referredBy: 'Dr. Abby Doyle',
      seedResolvedPotentialReviewerId: 'PID-SEED',
      seedResolvedContactId: 'CONTACT-SEED',
      seedIdentityMatchKey: 'email',
      seedIdentityNameConsistent: true,
    }));
  });
});

describe('scholarly email evidence survives a bounded roster round-trip', () => {
  test('keeps action + compact publication provenance and drops extra works', () => {
    const evidence = {
      sourceKind: 'scholarly_publication',
      sourceUrl: 'https://pubmed.ncbi.nlm.nih.gov/1/',
      action: 'ready',
      ownership: 'author_affiliation',
      affiliationMatched: true,
      publicationCount: 6,
      providers: ['ncbi_pubmed', 'europe_pmc'],
      publications: Array.from({ length: 6 }, (_, index) => ({
        pmid: String(index + 1),
        title: `Paper ${index + 1}`,
        year: 2026 - index,
        url: `https://pubmed.ncbi.nlm.nih.gov/${index + 1}/`,
        providers: ['ncbi_pubmed'],
        rawPayload: { shouldNotPersist: true },
      })),
      deliverabilityChecked: false,
      rawProviderResponse: { shouldNotPersist: true },
    };
    const compact = pruneEmailEvidence(evidence);
    expect(compact.publications).toHaveLength(5);
    expect(compact).not.toHaveProperty('rawProviderResponse');
    expect(compact.publications[0]).not.toHaveProperty('rawPayload');

    const pruned = pruneCandidateForRoster({
      name: 'Jane Roe',
      email: 'jane@stanford.edu',
      contactEnrichment: {
        email: 'jane@stanford.edu',
        emailSource: 'scholarly_multi',
        emailAction: 'ready',
        emailActionReason: 'Address source: scholarly_multi',
        emailEvidence: evidence,
      },
    });
    expect(pruned.contactEnrichment).toMatchObject({
      emailAction: 'ready',
      emailEvidence: { publicationCount: 6, action: 'ready' },
    });
  });
});

describe('sanitizeInstitutionCOIDetails (S240)', () => {
  test('strips legacy .historical, keeps piInstitution + reviewerInstitution', () => {
    expect(sanitizeInstitutionCOIDetails({ piInstitution: 'JHU', reviewerInstitution: 'JHU', historical: true }))
      .toEqual({ piInstitution: 'JHU', reviewerInstitution: 'JHU' });
  });
  test('keeps bounded Phase-C decision metadata', () => {
    expect(sanitizeInstitutionCOIDetails({
      piInstitution: 'MIT',
      reviewerInstitution: 'MIT',
      dropDecision: 'flagged',
      corroborationReason: 'single_low_trust_affiliation_contradicted_by_current_affiliation',
      matchedAffiliationSource: 'openalex_current',
      contradictoryAffiliationSource: 'orcid_current',
      historical: true,
    })).toEqual({
      piInstitution: 'MIT',
      reviewerInstitution: 'MIT',
      dropDecision: 'flagged',
      corroborationReason: 'single_low_trust_affiliation_contradicted_by_current_affiliation',
      matchedAffiliationSource: 'openalex_current',
      contradictoryAffiliationSource: 'orcid_current',
    });
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

  test('persists Phase-C flag-not-drop detail metadata', () => {
    const out = pruneCandidateForRoster({
      name: 'Dr P',
      hasInstitutionCOI: true,
      institutionCOIDetails: {
        piInstitution: 'MIT',
        reviewerInstitution: 'MIT',
        dropDecision: 'flagged',
        corroborationReason: 'single_low_trust_affiliation_contradicted_by_current_affiliation',
        matchedAffiliationSource: 'openalex_current',
        contradictoryAffiliationSource: 'orcid_current',
      },
    });
    expect(out.institutionCOIDetails).toEqual({
      piInstitution: 'MIT',
      reviewerInstitution: 'MIT',
      dropDecision: 'flagged',
      corroborationReason: 'single_low_trust_affiliation_contradicted_by_current_affiliation',
      matchedAffiliationSource: 'openalex_current',
      contradictoryAffiliationSource: 'orcid_current',
    });
  });
});

describe('isCandidateSelectable', () => {
  test('institution-COI flagged rows are read-only even when identity is otherwise selectable', () => {
    expect(isCandidateSelectable({
      name: 'Flagged',
      hasInstitutionCOI: true,
      institutionCOIDetails: { dropDecision: 'flagged', piInstitution: 'MIT', reviewerInstitution: 'MIT' },
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(false);
  });

  test('PD identity confirmation does not waive institution COI', () => {
    expect(isCandidateSelectable({
      name: 'Flagged',
      pdIdentityConfirmed: true,
      hasInstitutionCOI: true,
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(false);
  });

  test('resolved non-COI rows remain selectable', () => {
    expect(isCandidateSelectable({
      name: 'Clean',
      hasInstitutionCOI: false,
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(true);
  });
});

describe('mergeEnrichment', () => {
  test('keeps same-name candidates bound to their own enrichment', () => {
    const candidates = [
      withReviewerCandidateKey({ name: 'Dr. Alex Kim', affiliation: 'One University' }),
      withReviewerCandidateKey({ name: 'Dr. Alex Kim', affiliation: 'Two University' }),
    ];
    const enrichment = [
      {
        ...candidates[0],
        contactEnrichment: { email: 'alex.one@one.edu', emailSource: 'serp_search' },
      },
      {
        ...candidates[1],
        contactEnrichment: { email: 'alex.two@two.edu', emailSource: 'serp_search' },
      },
    ];

    const out = mergeEnrichment(candidates, enrichment);

    expect(out.map((c) => c.email)).toEqual(['alex.one@one.edu', 'alex.two@two.edu']);
    expect(out[0].candidateKey).not.toBe(out[1].candidateKey);
  });

  test('candidate correlation prefers durable identity anchors over name', () => {
    expect(reviewerCandidateKey({ name: 'Alex Kim', openAlexId: 'A123' })).toBe('openalex:a123');
    expect(reviewerCandidateKey({ name: 'Alex Kim', affiliation: 'One University' }))
      .not.toBe(reviewerCandidateKey({ name: 'Alex Kim', affiliation: 'Two University' }));
  });

  test('preserves the server-signed automated identity receipt', () => {
    const [out] = mergeEnrichment([{ name: 'Dr Receipt' }], [{
      name: 'Dr Receipt',
      automatedIdentityAttestation: 'signed-receipt',
      contactEnrichment: { identity: { status: 'probable' } },
    }]);
    expect(out.automatedIdentityAttestation).toBe('signed-receipt');
    expect(pruneCandidateForRoster(out).automatedIdentityAttestation).toBe('signed-receipt');
  });
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

  test('defensively nulls a document-file website at the merge (S266)', () => {
    const pdf = 'https://repositum.tuwien.at/bitstream/1/Treiber-2022.pdf';
    const out = mergeEnrichment(
      [{ name: 'Dr. A', website: null }],
      [{ name: 'Dr. A', contactEnrichment: { website: pdf } }],
    );
    expect(out[0].website).toBeNull();
    expect(out[0].contactEnrichment.website).toBeNull();
    expect(out[0].website || out[0].contactEnrichment.website || null).toBeNull();
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

describe('saved candidate correlation', () => {
  test('stable keys do not graduate a same-name candidate with different anchors', () => {
    const saved = { name: 'Dr Same Name', email: 'first@example.edu', affiliation: 'One University' };
    const sibling = { name: 'Same Name', email: 'second@example.edu', affiliation: 'Two University' };
    const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');
    expect(candidateWasSaved(saved, [reviewerSaveKey(saved)], ['Dr Same Name'])).toBe(true);
    expect(candidateWasSaved(sibling, [reviewerSaveKey(saved)], ['Dr Same Name'])).toBe(false);
  });

  test('legacy savedNames remain supported only when stable keys are absent', () => {
    expect(candidateWasSaved({ name: 'Dr Legacy' }, [], ['Legacy'])).toBe(true);
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

describe('pruneCandidateForRoster — flags survive reload', () => {
  test('POTENTIAL_CONCERNS retired (Chunk 2b, S254): a stray potentialConcerns input is dropped from the roster DTO', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Dr. Taekjip Ha',
      affiliation: 'Harvard Medical School',
      reasoning: 'Leading single-molecule biophysicist; directly relevant.',
      potentialConcerns: 'Former Johns Hopkins faculty — shared institution with the PI.',
    });
    expect(pruned.potentialConcerns).toBeUndefined();
    // Fitness justification still rides in its own field, untouched.
    expect(pruned.reasoning).toMatch(/single-molecule/);
  });

  test('defensively nulls a document-file website in the pruned DTO (S266)', () => {
    const pdf = 'https://repositum.tuwien.at/bitstream/1/Treiber-2022.pdf';
    const pruned = pruneCandidateForRoster({
      name: 'Markus Kitzler-Zeiler',
      website: pdf,
      contactEnrichment: { website: pdf },
    });
    expect(pruned.website).toBeNull();
    expect(pruned.contactEnrichment.website).toBeNull();
  });

  test('keeps a real profile-page website through the prune', () => {
    const profile = 'https://chem.x.edu/faculty/markus-kitzler-zeiler';
    const pruned = pruneCandidateForRoster({
      name: 'Markus Kitzler-Zeiler',
      website: profile,
      contactEnrichment: { website: profile },
    });
    expect(pruned.website).toBe(profile);
    expect(pruned.contactEnrichment.website).toBe(profile);
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

describe('pruneCandidateForRoster — applicant enrichment cache fields survive reload', () => {
  test('carries applicant proposal key, suggestion id, COI, contact, provenance, metrics, and identity markers', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Dr Applicant',
      suggestionId: '22222222-2222-4222-8222-222222222222',
      enrichedProposalKey: 'Library::Folder::Proposal.pdf',
      isApplicantRecommended: true,
      provenance: { kind: PROVENANCE_KINDS.APPLICANT_SUGGESTED, sources: ['applicant'] },
      hasInstitutionCOI: true,
      institutionCOIDetails: { piInstitution: 'MIT', reviewerInstitution: 'MIT', historical: true },
      hasCoauthorCOI: true,
      coauthorCOIStrength: 'possible',
      coauthorships: [{ proposalAuthor: 'Dr PI', paperCount: 1 }],
      email: 'applicant@example.edu',
      hIndex: 31,
      publicationCount5yr: 12,
      orcidUrl: 'https://orcid.org/0000-0001',
      googleScholarUrl: 'https://scholar.google.com/citations?user=ABC',
      reasoning: 'Applicant listed this reviewer.',
      seniorityEstimate: 'Senior',
      identityStatus: 'confirmed',
      needsIdentification: false,
    });

    expect(pruned.enrichedProposalKey).toBe('Library::Folder::Proposal.pdf');
    expect(pruned.suggestionId).toBe('22222222-2222-4222-8222-222222222222');
    expect(pruned.isApplicantRecommended).toBe(true);
    expect(pruned.provenance.kind).toBe(PROVENANCE_KINDS.APPLICANT_SUGGESTED);
    expect(pruned.hasInstitutionCOI).toBe(true);
    expect(pruned.institutionCOIDetails).toEqual({ piInstitution: 'MIT', reviewerInstitution: 'MIT' });
    expect(pruned.hasCoauthorCOI).toBe(true);
    expect(pruned.coauthorCOIStrength).toBe('possible');
    expect(pruned.coauthorships).toEqual([{ proposalAuthor: 'Dr PI', paperCount: 1 }]);
    expect(pruned.email).toBe('applicant@example.edu');
    expect(pruned.hIndex).toBe(31);
    expect(pruned.publicationCount5yr).toBe(12);
    expect(pruned.orcidUrl).toBe('https://orcid.org/0000-0001');
    expect(pruned.googleScholarUrl).toBe('https://scholar.google.com/citations?user=ABC');
    expect(pruned.reasoning).toBe('Applicant listed this reviewer.');
    expect(pruned.seniorityEstimate).toBe('Senior');
    expect(pruned.identityStatus).toBe('confirmed');
    expect(pruned.needsIdentification).toBe(false);
  });
});

describe('hasValidApplicantEnrichmentCache', () => {
  const proposalKey = 'Library::Folder::Proposal.pdf';

  test('requires a non-null proposal key and same-key applicant-origin roster row', () => {
    expect(hasValidApplicantEnrichmentCache([
      { name: 'Dr Applicant', isApplicantRecommended: true, enrichedProposalKey: proposalKey },
    ], proposalKey)).toBe(true);

    expect(hasValidApplicantEnrichmentCache([
      { name: 'Dr Applicant', isApplicantRecommended: true, enrichedProposalKey: 'Other::Proposal.pdf' },
    ], proposalKey)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      { name: 'Dr Applicant', isApplicantRecommended: true, enrichedProposalKey: proposalKey },
    ], null)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      { name: 'Dr Literature', enrichedProposalKey: proposalKey },
    ], proposalKey)).toBe(false);
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

describe('dedupeByNamePreferReferred — seed⇄discovery collision keeps the Externally-Referred badge (S320)', () => {
  const keyFn = (c) => normName(c.name);
  const seed = () => ({
    name: 'Jane Smith',
    referredBy: 'Doug Nadel',
    source: 'referred',
    sources: ['referred'],
    reasoning: 'Referred by Doug Nadel.',
    isReferredSeed: true,
  });
  const discovery = () => ({
    name: 'Jane Smith',
    email: 'jane@uni.edu',
    affiliation: 'University of Example',
    sources: ['pubmed'],
    reasoning: 'Strong methods overlap with the proposal.',
    verificationStatus: 'verified',
  });

  test('discovery ranked HIGHER (first): survivor is badged Externally-Referred and retains referredBy', () => {
    const out = dedupeByNamePreferReferred([discovery(), seed()], keyFn);
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(provenanceKindOf(s)).toBe(PROVENANCE_KINDS.REFERRED);
    expect(provenanceGroupOf(s)).toBe('cited_or_proposal_named');
    expect(s.referredBy).toBe('Doug Nadel');
    expect(provenanceLabelForCandidate(s)).toBe('Externally-Referred · Doug Nadel');
    // survivor keeps its OWN (verified discovery) contact — nothing lost
    expect(s.email).toBe('jane@uni.edu');
    // durable string so my-candidates reload reconstructs the referrer
    expect(s.reasoning).toMatch(/^Referred by Doug Nadel\./);
    // referred persists into wmkf_sources
    expect(s.sources).toContain('referred');
    expect(s.sources).toContain('pubmed');
  });

  test('seed ranked HIGHER (first): survivor stays referred; discovery contact is NOT grafted onto the bare seed', () => {
    const out = dedupeByNamePreferReferred([seed(), discovery()], keyFn);
    expect(out).toHaveLength(1);
    const s = out[0];
    expect(provenanceKindOf(s)).toBe(PROVENANCE_KINDS.REFERRED);
    expect(s.referredBy).toBe('Doug Nadel');
    // name-only safety: the unresolved seed does NOT absorb discovery's email
    expect(s.email).toBeUndefined();
  });

  test('no duplicate row: exactly one survivor either way', () => {
    expect(dedupeByNamePreferReferred([discovery(), seed()], keyFn)).toHaveLength(1);
    expect(dedupeByNamePreferReferred([seed(), discovery()], keyFn)).toHaveLength(1);
  });

  test('two non-referred same-name candidates: first wins, unchanged (no false promotion)', () => {
    const a = { name: 'Bob Lee', sources: ['pubmed'], email: 'bob@a.edu' };
    const b = { name: 'Bob Lee', sources: ['arxiv'], email: 'bob@b.edu' };
    const out = dedupeByNamePreferReferred([a, b], keyFn);
    expect(out).toHaveLength(1);
    expect(out[0].email).toBe('bob@a.edu');
    expect(provenanceKindOf(out[0])).not.toBe(PROVENANCE_KINDS.REFERRED);
  });

  test('applicant-suggested survivor is NOT flipped to referred (promote-by-suggestionId path preserved)', () => {
    const applicant = { name: 'Jane Smith', isApplicantRecommended: true, suggestionId: 'sug-1', email: 'jane@app.edu' };
    const out = dedupeByNamePreferReferred([applicant, seed()], keyFn);
    expect(out).toHaveLength(1);
    expect(provenanceKindOf(out[0])).toBe(PROVENANCE_KINDS.APPLICANT_SUGGESTED);
    expect(out[0].suggestionId).toBe('sug-1');
  });
});

describe('mergeReferredProvenance — unit safety', () => {
  test('does not copy contact/identity from the dropped referred copy onto the survivor', () => {
    const keep = { name: 'X Person', sources: ['pubmed'] }; // no email
    const incoming = { name: 'X Person', referredBy: 'Doug', source: 'referred', sources: ['referred'], email: 'leak@evil.edu' };
    const merged = mergeReferredProvenance(keep, incoming);
    expect(merged.email).toBeUndefined();
    expect(provenanceKindOf(merged)).toBe(PROVENANCE_KINDS.REFERRED);
    expect(merged.referredBy).toBe('Doug');
  });

  test('no-op when incoming is not referred', () => {
    const keep = { name: 'X', sources: ['pubmed'], email: 'x@a.edu' };
    const incoming = { name: 'X', sources: ['arxiv'], email: 'x@b.edu' };
    expect(mergeReferredProvenance(keep, incoming)).toBe(keep);
  });
});
