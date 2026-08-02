/**
 * @jest-environment node
 */
import {
  APPLICANT_ENRICHMENT_CACHE_VERSION,
  mergeEnrichment,
  asPercent,
  normalizeReviewerName,
  parseExcludeList,
  parseReferredSeeds,
  filterExcluded,
  applicantTerminalSuggestionKeys,
  hasValidApplicantEnrichmentCache,
  isCandidateSelectable,
  candidateWasSaved,
  getCandidatePromotionDecision,
  getCandidateEmailReadiness,
  pruneCandidateForRoster,
  pruneEmailEvidence,
  pruneDataverseContactEvidence,
  sanitizeInstitutionCOIDetails,
  mergeReferredProvenance,
  dedupeByNamePreferReferred,
  dedupeReviewerCandidates,
  reviewerCandidateKey,
  withReviewerCandidateKey,
} from '../../shared/components/reviewers/reviewer-search-logic.js';
import { projectCanonicalApplicantContact } from '../../lib/utils/applicant-known-reviewer.js';
const { PROVENANCE_KINDS, provenanceGroupOf, provenanceKindOf, provenanceLabelForCandidate } = require('../../lib/utils/reviewer-provenance');
const { normalizeReviewerName: normName } = require('../../lib/utils/reviewer-name-match');

describe('dedupeReviewerCandidates', () => {
  test('collapses exact-ORCID search aliases and keeps the staff-attested address projection', () => {
    const foundAgain = {
      name: 'Ellen Zhong',
      candidateKey: 'orcid:0000-0001-6345-1907',
      orcid: '0000-0001-6345-1907',
      email: 'zhonge@princeton.edu',
      emailSource: 'scholarly_multi',
      source: 'proposal_named',
    };
    const staffAttested = {
      name: 'Ellen Zhong',
      candidateKey: 'candidate:ellen-legacy',
      orcid: '0000-0001-6345-1907',
      email: 'zhonge@cs.princeton.edu',
      emailSource: 'staff_verified',
      source: 'proposal_named',
      addressTrustReceipt: {
        receiptId: 'receipt-ellen',
        email: 'zhonge@cs.princeton.edu',
        personConfirmed: true,
      },
    };

    expect(dedupeReviewerCandidates([foundAgain, staffAttested])).toEqual([
      expect.objectContaining({
        candidateKey: 'candidate:ellen-legacy',
        email: 'zhonge@cs.princeton.edu',
      }),
    ]);
  });

  test('keeps same-name search candidates separate when their exact ORCIDs differ', () => {
    const rows = [
      { name: 'Alex Kim', candidateKey: 'candidate:alex-1', orcid: '0000-0002-1825-0097' },
      { name: 'Alex Kim', candidateKey: 'candidate:alex-2', orcid: '0000-0001-5109-3700' },
    ];
    expect(dedupeReviewerCandidates(rows)).toEqual(rows);
  });
});

test('applicant canonical email/source pair and promotion decision survive roster pruning', () => {
  const candidate = {
    name: 'Known Applicant Reviewer',
    potentialReviewerId: '22222222-2222-2222-2222-222222222222',
    suggestionId: '33333333-3333-3333-3333-333333333333',
    isApplicantRecommended: true,
    identityStatus: 'probable',
    emailPersistAllowed: false,
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: '22222222-2222-2222-2222-222222222222',
      name: 'Known Applicant Reviewer',
      email: 'known@example.edu',
      emailSource: null,
      affiliation: 'Example University',
      orcid: '0000-0001-2345-6789',
    },
  };
  const before = projectCanonicalApplicantContact({
    applicantKnownReviewer: candidate.applicantKnownReviewer,
    candidate,
  });
  const pruned = pruneCandidateForRoster(candidate);
  const after = projectCanonicalApplicantContact({
    applicantKnownReviewer: pruned.applicantKnownReviewer,
    candidate: pruned,
  });
  expect(pruned.applicantKnownReviewer).toMatchObject({
    email: 'known@example.edu',
    emailSource: null,
    emailReadiness: { action: 'quick_check' },
  });
  expect(after).toEqual(before);
  expect(isCandidateSelectable(pruned)).toBe(false);
});

test('an inactive or duplicate reviewer is routed to record repair, not identity confirmation', () => {
  const candidate = pruneCandidateForRoster({
    name: 'Inactive Reviewer',
    email: 'inactive@example.edu',
    emailSource: 'scholarly_multi',
    serverRepairReason: 'person_inactive',
    contactEnrichment: { identity: { status: 'probable' } },
  });
  expect(candidate.serverRepairReason).toBe('person_inactive');
  expect(getCandidatePromotionDecision(candidate)).toEqual({
    decision: 'needs_record_repair',
    reason: 'person_inactive',
    email: null,
  });
  expect(isCandidateSelectable(candidate)).toBe(false);
});

test('an applicant-linked inactive person exposes repair before a failed promotion attempt', () => {
  const candidate = {
    name: 'Inactive Applicant Reviewer',
    isApplicantRecommended: true,
    applicantKnownReviewer: {
      status: 'inactive',
      code: 'person_inactive',
      email: 'inactive@example.edu',
      emailSource: 'scholarly_multi',
    },
  };
  expect(getCandidatePromotionDecision(candidate)).toMatchObject({
    decision: 'needs_record_repair',
    reason: 'person_inactive',
  });
});

test('vetted enrichment pair stays selectable when the exact applicant person has no stored email', () => {
  const pruned = pruneCandidateForRoster({
    name: 'Applicant With New Email',
    suggestionId: '33333333-3333-3333-3333-333333333333',
    isApplicantRecommended: true,
    identityStatus: 'probable',
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: '22222222-2222-2222-2222-222222222222',
      email: null,
      emailSource: null,
    },
    email: 'new@example.edu',
    emailSource: 'scholarly_multi',
    contactEnrichment: {
      identity: { status: 'probable' },
      email: 'new@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
    },
  });
  expect(pruned).toMatchObject({
    email: 'new@example.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    contactEnrichment: {
      email: 'new@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
    },
  });
  expect(getCandidatePromotionDecision(pruned)).toMatchObject({
    decision: 'ready',
    email: 'new@example.edu',
    emailSource: 'scholarly_multi',
  });
  expect(isCandidateSelectable(pruned)).toBe(true);
});

test('applicant contact-claim mismatch survives roster pruning and remains non-selectable until staff correction', () => {
  const pruned = pruneCandidateForRoster({
    name: 'Conflicted Applicant Reviewer',
    suggestionId: '33333333-3333-3333-3333-333333333333',
    isApplicantRecommended: true,
    identityStatus: 'probable',
    applicantContactMismatch: true,
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: '22222222-2222-2222-2222-222222222222',
      email: 'stored@example.edu',
      emailSource: 'scholarly_multi',
    },
  });
  expect(pruned.applicantContactMismatch).toBe(true);
  expect(isCandidateSelectable(pruned)).toBe(false);
  expect(isCandidateSelectable({
    ...pruned,
    email: 'corrected@example.edu',
    emailSource: 'manual',
    contactEnrichment: { email: 'corrected@example.edu', emailSource: 'manual' },
    pdIdentityConfirmed: true,
    manualContactFields: ['email'],
    addressTrustReceipt: {
      receiptId: 'receipt-corrected',
      personConfirmed: true,
      email: 'corrected@example.edu',
    },
  })).toBe(true);
});

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

describe('pruneCandidateForRoster — W4.1 identity evidence survives reload', () => {
  test('retains only the server-attested identity fields used by persistence', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Taekjip Ha',
      contactEnrichment: {
        identity: {
          status: 'probable',
          confidenceBand: 'medium',
          resolverVersion: '2.0.0-works-first',
          resolvedAt: '2026-07-19T12:00:00.000Z',
          evidenceSummary: 'probable — authorship grounded',
          anchors: [{
            type: 'authorship_grounded',
            canonicalKey: 'openalex:A100',
            sourceUrl: 'https://openalex.org/A100',
            verifier: 'reviewerWorksFirst@2.0.0-works-first',
            parserOutput: { rawProviderPayload: 'drop-me' },
          }],
          rejectedAnchors: [{ raw: 'drop-me' }],
        },
      },
    });

    expect(pruned.contactEnrichment.identity).toEqual({
      status: 'probable',
      confidenceBand: 'medium',
      resolverVersion: '2.0.0-works-first',
      resolvedAt: '2026-07-19T12:00:00.000Z',
      evidenceSummary: 'probable — authorship grounded',
      anchors: [{
        type: 'authorship_grounded',
        canonicalKey: 'openalex:A100',
        sourceUrl: 'https://openalex.org/A100',
        verifier: 'reviewerWorksFirst@2.0.0-works-first',
      }],
    });
    expect(pruned.contactEnrichment.identity).not.toHaveProperty('rejectedAnchors');
    expect(JSON.stringify(pruned)).not.toContain('rawProviderPayload');
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

describe('institution-page ownership evidence survives a bounded roster round-trip', () => {
  test('keeps the proof, official source, and only eight compact alternatives', () => {
    const evidence = {
      sourceKind: 'institution_page',
      sourceUrl: 'https://engineering.tamu.edu/electrical/profiles/phemmer.html',
      ownershipProof: 'mailbox_initials_surname_unverified_middle',
      matchClass: 'initials_surname',
      alternatives: Array.from({ length: 10 }, (_, index) => ({
        email: `role${index}@tamu.edu`,
        matchClass: 'unmatched',
        rawPageContext: { shouldNotPersist: true },
      })),
      rawHtml: '<html>should not persist</html>',
    };

    const compact = pruneEmailEvidence(evidence);
    expect(compact).toMatchObject({
      sourceKind: 'institution_page',
      sourceUrl: evidence.sourceUrl,
      ownershipProof: 'mailbox_initials_surname_unverified_middle',
      matchClass: 'initials_surname',
    });
    expect(compact.alternatives).toHaveLength(8);
    expect(compact.alternatives[0]).toEqual({
      email: 'role0@tamu.edu',
      matchClass: 'unmatched',
    });
    expect(compact).not.toHaveProperty('rawHtml');
    expect(compact.alternatives[0]).not.toHaveProperty('rawPageContext');

    const pruned = pruneCandidateForRoster({
      name: 'Philip Hemmer',
      email: 'prhemmer@tamu.edu',
      contactEnrichment: {
        email: 'prhemmer@tamu.edu',
        emailSource: 'institution_page',
        emailEvidence: evidence,
      },
    });
    expect(pruned.contactEnrichment.emailEvidence).toEqual(compact);
  });
});

describe('Dataverse contact evidence survives a bounded roster round-trip', () => {
  test('keeps compact display evidence and drops unknown fields', () => {
    const raw = {
      status: 'known',
      matchKey: 'email',
      recordKinds: ['potential_reviewer', 'contact', 'unknown'],
      nameConsistent: true,
      institutions: [
        { value: 'Stanford University', source: 'staff_confirmed', raw: 'drop' },
        { value: 'Northwestern University', source: 'primary_affiliation' },
        { value: 'Ignore', source: 'unknown' },
      ],
      reason: null,
      checkedAt: '2026-07-21T12:00:00.000Z',
      reviewerId: 'must-not-survive',
    };

    expect(pruneDataverseContactEvidence(raw)).toEqual({
      status: 'known',
      matchKey: 'email',
      recordKinds: ['potential_reviewer', 'contact'],
      nameConsistent: true,
      institutions: [
        { value: 'Stanford University', source: 'staff_confirmed' },
        { value: 'Northwestern University', source: 'primary_affiliation' },
      ],
      reason: null,
      checkedAt: '2026-07-21T12:00:00.000Z',
    });

    const pruned = pruneCandidateForRoster({
      name: 'Michael Jewett',
      contactEnrichment: { dataverseContactEvidence: raw },
    });
    expect(pruned.contactEnrichment.dataverseContactEvidence)
      .toEqual(pruneDataverseContactEvidence(raw));
    expect(JSON.stringify(pruned)).not.toContain('must-not-survive');
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

  test('resolved non-COI quick-check rows remain visible but require exact-address verification', () => {
    expect(isCandidateSelectable({
      name: 'Clean',
      email: 'clean@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
      identityStatus: 'probable',
      hasInstitutionCOI: false,
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(false);
  });

  test('an exact person-and-address receipt makes a resolved quick-check row selectable', () => {
    expect(isCandidateSelectable({
      name: 'Clean',
      email: 'clean@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
      identityStatus: 'probable',
      hasInstitutionCOI: false,
      addressTrustReceipt: {
        receiptId: 'receipt-clean',
        personConfirmed: true,
        email: 'clean@example.edu',
      },
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(true);
  });

  test('Dataverse split identity remains actionable but nonselectable until staff confirms person and address', () => {
    const candidate = {
      name: 'Split Identity',
      email: 'split@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
      identityStatus: 'probable',
      hasInstitutionCOI: false,
      contactEnrichment: {
        identity: { status: 'probable' },
        dataverseContactEvidence: {
          status: 'review_required',
          reason: 'orcid_email_split',
        },
      },
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    };
    expect(getCandidatePromotionDecision(candidate)).toMatchObject({
      decision: 'needs_identity_confirmation',
      reason: 'orcid_email_split',
    });
    expect(isCandidateSelectable(candidate)).toBe(false);
    expect(isCandidateSelectable({ ...candidate, pdIdentityConfirmed: true })).toBe(true);
  });

  test('nested unresolved identity overrides top-level verified/selectable signals', () => {
    expect(isCandidateSelectable({
      name: 'Contradictory',
      email: 'contradictory@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
      identityStatus: 'probable',
      verificationStatus: 'verified',
      contactEnrichment: {
        email: 'contradictory@example.edu',
        emailSource: 'pubmed',
        emailPersistAllowed: true,
        identity: { status: 'unresolved' },
      },
      hasInstitutionCOI: false,
    })).toBe(false);
  });

  test('deceased rows are never selectable, including after PD identity confirmation', () => {
    expect(isCandidateSelectable({
      name: 'Deceased',
      pdIdentityConfirmed: true,
      eligibilityStatus: 'deceased',
      provenance: { kind: PROVENANCE_KINDS.LITERATURE_RETRIEVED, sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
    })).toBe(false);
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

  test('promotes and prunes eligibility evidence for durable reload', () => {
    const [out] = mergeEnrichment([{ name: 'Dr Emeritus' }], [{
      name: 'Dr Emeritus',
      contactEnrichment: {
        eligibilityStatus: 'emeritus',
        eligibilityReason: 'Official profile says emeritus.',
        eligibilityEvidence: {
          status: 'emeritus',
          url: 'https://example.edu/people/emeritus',
          title: 'Dr Emeritus | Professor Emeritus',
          snippet: 'Dr Emeritus is Professor Emeritus.',
          sourceDomain: 'example.edu',
          checkedAt: '2026-07-19T12:00:00.000Z',
        },
      },
    }]);
    expect(out.eligibilityStatus).toBe('emeritus');
    expect(pruneCandidateForRoster(out)).toMatchObject({
      eligibilityStatus: 'emeritus',
      eligibilityEvidence: { sourceDomain: 'example.edu' },
      contactEnrichment: {
        eligibilityStatus: 'emeritus',
        eligibilityEvidence: { url: 'https://example.edu/people/emeritus' },
      },
    });
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

describe('getCandidateEmailReadiness', () => {
  test('uses the invitation classifier for identity-owned and multiply corroborated emails', () => {
    expect(getCandidateEmailReadiness({
      email: 'person@example.edu',
      emailSource: 'institution_page',
    })).toMatchObject({ level: 'high', action: 'ready' });

    expect(getCandidateEmailReadiness({
      email: 'person@example.edu',
      contactEnrichment: {
        emailSource: 'scholarly_multi',
      },
    })).toMatchObject({ level: 'high', action: 'ready' });
  });

  test('single-work, legacy, manual, and unknown emails need confirmation', () => {
    for (const emailSource of ['scholarly_single', 'pubmed', 'manual', 'unknown_source']) {
      expect(getCandidateEmailReadiness({
        email: 'person@example.edu',
        emailSource,
        identityStatus: 'confirmed',
      })).toMatchObject({ level: 'low', action: 'quick_check' });
    }
  });

  test('search-only and contested emails remain research leads, not sendable addresses', () => {
    for (const emailSource of ['serp_search', 'claude_search', 'search_contested']) {
      expect(getCandidateEmailReadiness({
        email: 'person@example.edu',
        emailSource,
        identityStatus: 'confirmed',
      })).toMatchObject({ level: 'low', action: 'research_only' });
    }
    expect(getCandidateEmailReadiness({
      email: 'person@example.edu',
      emailSource: 'serp_search',
      identityStatus: 'probable',
    })).toMatchObject({ level: 'low', action: 'research_only' });
  });

  test('preserves the specific contested-contact reason for staff review', () => {
    expect(getCandidateEmailReadiness({
      email: 'person@other-domain.example',
      identityStatus: 'confirmed',
      contactEnrichment: {
        emailSource: 'search_contested',
        contactStatusReason: 'Email domain conflicts with the verified institution',
      },
    })).toEqual({
      level: 'low',
      action: 'research_only',
      reason: 'Email domain conflicts with the verified institution',
    });
  });

  test('no address is reported as missing even if stale provenance remains', () => {
    expect(getCandidateEmailReadiness({
      email: null,
      emailSource: 'orcid',
      contactEnrichment: { email: null, emailSource: 'orcid' },
    })).toEqual({
      level: 'missing',
      action: 'missing',
      reason: 'No email address found during contact enrichment',
    });
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

  test('legacy savedNames cannot graduate a candidate without an exact stable key', () => {
    expect(candidateWasSaved({ name: 'Dr Legacy' }, [], ['Legacy'])).toBe(false);
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
      applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
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
    expect(pruned.applicantEnrichmentCacheVersion).toBe(APPLICANT_ENRICHMENT_CACHE_VERSION);
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
  const expected = [{ suggestionId: 'SUG-1' }];
  const canonical = {
    name: 'Dr Applicant',
    suggestionId: 'SUG-1',
    candidateKey: 'suggestion:sug-1',
    isApplicantRecommended: true,
    enrichedProposalKey: proposalKey,
    applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: 'person-1',
      email: 'applicant@example.edu',
      emailSource: null,
    },
    identityStatus: 'probable',
  };

  test('requires a non-null proposal key and the exact expected canonical suggestion row', () => {
    expect(hasValidApplicantEnrichmentCache([canonical], proposalKey, expected)).toBe(true);

    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, enrichedProposalKey: 'Other::Proposal.pdf' },
    ], proposalKey, expected)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([canonical], null, expected)).toBe(false);
    expect(hasValidApplicantEnrichmentCache([canonical], proposalKey, [])).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, isApplicantRecommended: false, provenance: { kind: 'literature_retrieved' } },
    ], proposalKey, expected)).toBe(false);
  });

  test('rejects unversioned and older applicant enrichment rows', () => {
    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, applicantEnrichmentCacheVersion: undefined },
    ], proposalKey, expected)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION - 1 },
    ], proposalKey, expected)).toBe(false);
  });

  test('retries transient hydration outages but caches stable conflicts and mismatches', () => {
    expect(hasValidApplicantEnrichmentCache([
      {
        ...canonical,
        applicantKnownReviewer: { status: 'unavailable', potentialReviewerId: 'person-1' },
      },
    ], proposalKey, expected)).toBe(false);
    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, applicantContactMismatch: true },
    ], proposalKey, expected)).toBe(true);
    expect(hasValidApplicantEnrichmentCache([
      {
        ...canonical,
        identityStatus: 'unresolved',
        applicantKnownReviewer: { status: 'email_conflict', potentialReviewerId: 'person-1' },
      },
    ], proposalKey, expected)).toBe(true);
  });

  test('ignores legacy-key rows once the canonical row exists and rejects partial canonical batches', () => {
    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, candidateKey: 'person:legacy', identityStatus: null },
    ], proposalKey, expected)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      canonical,
      { ...canonical, candidateKey: 'person:legacy', identityStatus: null },
    ], proposalKey, expected)).toBe(true);

    expect(hasValidApplicantEnrichmentCache([
      canonical,
    ], proposalKey, [{ suggestionId: 'SUG-1' }, { suggestionId: 'SUG-2' }])).toBe(false);
  });

  test('requires every canonical applicant row to carry a terminal gate result', () => {
    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, identityStatus: null },
    ], proposalKey, expected)).toBe(false);

    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, identityStatus: 'unresolved', needsIdentification: true },
    ], proposalKey, expected)).toBe(true);

    expect(hasValidApplicantEnrichmentCache([
      { ...canonical, identityStatus: null, eligibilityStatus: 'deceased' },
    ], proposalKey, expected)).toBe(true);
  });

  test('treats canonical saved/excluded suggestions as terminal without hiding unknown missing rows', () => {
    const secondExpected = [{ suggestionId: 'SUG-1' }, { suggestionId: 'SUG-2' }];
    const excluded = [{
      name: 'Excluded Applicant',
      suggestionId: 'SUG-1',
      candidateKey: 'suggestion:sug-1',
    }];
    const terminal = applicantTerminalSuggestionKeys(excluded, ['suggestion:sug-2']);
    expect(hasValidApplicantEnrichmentCache([], proposalKey, secondExpected, terminal)).toBe(true);

    const unknownOnly = applicantTerminalSuggestionKeys([], ['suggestion:other']);
    expect(hasValidApplicantEnrichmentCache([], proposalKey, expected, unknownOnly)).toBe(false);
  });

  test('rejects non-canonical excluded/saved keys as terminal authority', () => {
    const terminal = applicantTerminalSuggestionKeys(
      [{ suggestionId: 'SUG-1', candidateKey: 'candidate:forged' }],
      ['suggestion:SUG-1', 'candidate:other'],
    );
    expect(Array.from(terminal)).toEqual([]);
    expect(hasValidApplicantEnrichmentCache([], proposalKey, expected, terminal)).toBe(false);
  });
});

describe('pruneCandidateForRoster — server identity confirmation survives reload', () => {
  test('keeps only the bounded confirmation/manual-contact shape', () => {
    const pruned = pruneCandidateForRoster({
      name: 'Ann Lee',
      email: 'ann@example.edu',
      contactEnrichment: { email: 'ann@example.edu', websiteSource: 'manual' },
      manualContactFields: ['email', 'website', 'email', 'forged'],
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
        website: 'https://example.edu/ann',
        affiliation: 'Example University',
        actorProfileId: 5,
        actorSystemUserId: 'system-5',
        confirmedAt: '2026-07-20T12:00:00.000Z',
        forgedExtra: 'drop me',
      },
    });

    expect(pruned.manualContactFields).toEqual(['email', 'website']);
    expect(pruned.contactEnrichment.websiteSource).toBe('manual');
    expect(pruned.staffIdentityConfirmation).toEqual({
      confirmationId: 'confirm-1',
      source: 'staff_confirmed',
      normalizedName: 'ann lee',
      email: 'ann@example.edu',
      website: 'https://example.edu/ann',
      affiliation: 'Example University',
      actorProfileId: 5,
      actorSystemUserId: 'system-5',
      confirmedAt: '2026-07-20T12:00:00.000Z',
    });
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
      coauthorCheckStatus: 'incomplete',
      coauthorCheckFailures: [{
        proposalAuthor: 'Dr Proposal Author',
        status: 429,
        reason: 'rate_limited',
      }],
    });
    expect(pruned.hasCoauthorCOI).toBe(true);
    expect(pruned.coauthorCOIStrength).toBe('possible');
    expect(pruned.coauthorSharedPaperTotal).toBe(2);
    expect(pruned.coauthorMaxWithOneAuthor).toBe(1);
    expect(pruned.coauthorCheckStatus).toBe('incomplete');
    expect(pruned.coauthorCheckFailures).toEqual([{
      proposalAuthor: 'Dr Proposal Author',
      status: 429,
      reason: 'rate_limited',
    }]);
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
    expect(pruned.coauthorCheckStatus).toBeNull();
    expect(pruned.coauthorCheckFailures).toEqual([]);
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

test('pruneCandidateForRoster keeps bounded warm freshness metadata and strips unknown stage fields', () => {
  const pruned = pruneCandidateForRoster({
    name: 'Fresh Person', candidateKey: 'suggestion:fresh', warmCacheVersion: 1,
    proposalContentVersion: 'p'.repeat(300), applicantInputVersion: 'a'.repeat(300),
    stageFreshness: {
      identity: { state: 'current', contractVersion: 4, sourceVersion: 's'.repeat(300), completedAt: '2026-08-01', rawProviderBody: { pii: true } },
      unknown_stage: { state: 'current', contractVersion: 1 },
    },
  });
  expect(pruned.warmCacheVersion).toBe(1);
  expect(pruned.proposalContentVersion).toHaveLength(160);
  expect(pruned.applicantInputVersion).toHaveLength(160);
  expect(pruned.stageFreshness).toEqual({ identity: expect.objectContaining({ state: 'current', sourceVersion: 's'.repeat(160) }) });
  expect(pruned.stageFreshness.identity.rawProviderBody).toBeUndefined();
});
