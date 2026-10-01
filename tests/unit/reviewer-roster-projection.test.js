import { pruneCandidateForRoster } from '../../shared/components/reviewers/reviewer-search-logic';

function enrichedCandidate(orcid) {
  return {
    name: 'Alex Morgan',
    affiliation: 'Example University',
    orcid,
    email: `alex+${orcid.slice(-4)}@example.edu`,
    emailPersistAllowed: true,
    websitePersistAllowed: false,
    affiliationPersistAllowed: true,
    publications: [{ title: 'Evidence paper', year: 2024, url: 'https://example.edu/paper' }],
    contactEnrichment: {
      identity: {
        status: 'unresolved',
        confidenceBand: null,
        resolverVersion: 'golden-v1',
        resolvedAt: '2026-09-01T00:00:00.000Z',
        evidenceSummary: 'weak anchors',
        anchors: [{ type: 'orcid', canonicalKey: orcid, sourceUrl: 'https://orcid.org', verifier: 'orcid' }],
        privateResolverPayload: { shouldNotPersist: true },
      },
      email: `enriched+${orcid.slice(-4)}@example.edu`,
      emailSource: 'scholarly_multi',
      emailPersistAllowed: false,
      website: 'https://example.edu/alex',
      websiteSource: 'verified',
      websitePersistAllowed: true,
      affiliationPersistAllowed: false,
      emailEvidence: {
        sourceKind: 'publication',
        sourceUrl: 'https://example.edu/evidence',
        action: 'use',
        ownership: 'author-specific',
        ownershipProof: 'verified',
        matchClass: 'exact',
        alternatives: [{ email: 'other@example.edu', matchClass: 'weak' }],
        affiliationMatched: true,
        publicationCount: 1,
        providers: ['pubmed'],
        publications: [{ pmid: '123456', title: 'Evidence paper', year: 2024, providers: ['pubmed'] }],
        deliverabilityChecked: true,
        rawProviderRecord: { shouldNotPersist: true },
      },
      tierResults: {
        orcid: {
          affiliations: [{ current: true, disambiguationSource: 'ROR', disambiguatedOrganizationId: 'https://ror.org/03yrm5c26' }],
          rawResponse: { shouldNotPersist: true },
        },
        openalex_author: { skipped: 'name_mismatch', rawProfile: { shouldNotPersist: true } },
        privateTierPayload: { shouldNotPersist: true },
      },
      contactLeads: [{
        type: 'website',
        value: 'https://example.edu/lab',
        sourceUrl: 'https://example.edu/about',
        source: 'first_party',
        confidence: 'medium',
        rejectedReason: null,
        persistable: true,
        evidence: { shouldNotPersist: true },
      }],
      eligibilityEvidence: { status: 'emeritus', url: 'https://example.edu/faculty', title: 'Faculty', snippet: 'Current faculty page' },
      dataverseContactEvidence: { status: 'none', nameConsistent: true, recordKinds: ['contact'], rawRecord: { shouldNotPersist: true } },
    },
  };
}

describe('reviewer roster projection serialized contract', () => {
  test('preserves the pre-extraction full DTO, false-over-true gates, raw-enrichment exclusion, reload shape, and same-name identities', () => {
    const inputs = [
      enrichedCandidate('0000-0001-2345-6789'),
      enrichedCandidate('0000-0002-2345-6789'),
    ];
    const projected = inputs.map(pruneCandidateForRoster);
    const reloaded = projected.map(pruneCandidateForRoster);

    expect(projected[0].name).toBe(projected[1].name);
    expect(projected[0].candidateKey).not.toBe(projected[1].candidateKey);
    expect(projected[0].contactEnrichment).not.toHaveProperty('tierResults');
    expect(projected[0].contactEnrichment.contactLeads[0].persistable).toBe(false);
    expect(projected[0]).toMatchObject({
      emailPersistAllowed: false,
      websitePersistAllowed: false,
      affiliationPersistAllowed: false,
    });

    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(projected));
    expect(JSON.stringify(reloaded)).toBe(JSON.stringify(projected));
    expect(JSON.stringify(projected, null, 2)).toMatchInlineSnapshot(`
"[
  {
    "identityPersistAllowed": false,
    "scholarPersistAllowed": false,
    "emailPersistAllowed": false,
    "websitePersistAllowed": false,
    "affiliationPersistAllowed": false,
    "contactEnrichment": {
      "identity": {
        "status": "unresolved",
        "confidenceBand": null,
        "resolverVersion": "golden-v1",
        "resolvedAt": "2026-09-01T00:00:00.000Z",
        "evidenceSummary": "weak anchors",
        "anchors": [
          {
            "type": "orcid",
            "canonicalKey": "0000-0001-2345-6789",
            "sourceUrl": "https://orcid.org",
            "verifier": "orcid"
          }
        ]
      },
      "email": "enriched+6789@example.edu",
      "emailSource": "scholarly_multi",
      "emailYear": null,
      "emailAction": null,
      "emailActionReason": null,
      "emailEvidence": {
        "sourceKind": "publication",
        "sourceUrl": "https://example.edu/evidence",
        "action": "use",
        "ownership": "author-specific",
        "ownershipProof": "verified",
        "matchClass": "exact",
        "alternatives": [
          {
            "email": "other@example.edu",
            "matchClass": "weak"
          }
        ],
        "affiliationMatched": true,
        "publicationCount": 1,
        "providers": [
          "pubmed"
        ],
        "publications": [
          {
            "pmid": "123456",
            "pmcid": null,
            "doi": null,
            "title": "Evidence paper",
            "year": 2024,
            "url": null,
            "providers": [
              "pubmed"
            ]
          }
        ],
        "deliverabilityChecked": true
      },
      "contactStatus": null,
      "contactStatusReason": null,
      "verifiedInstitutionDomain": null,
      "anchoredInstitutionDomains": [],
      "plausibleInstitutionDomains": [],
      "website": "https://example.edu/alex",
      "websiteSource": "verified",
      "orcid": null,
      "orcidId": null,
      "orcidUrl": null,
      "googleScholarUrl": null,
      "googleScholarId": null,
      "affiliationSource": null,
      "openAlexInstitutionId": null,
      "openAlexInstitutionRor": null,
      "orcidInstitutionRor": "https://ror.org/03yrm5c26",
      "priorAffiliation": null,
      "hIndex": null,
      "totalCitations": null,
      "emailPersistAllowed": false,
      "websitePersistAllowed": false,
      "affiliationPersistAllowed": false,
      "contactLeads": [
        {
          "type": "website",
          "value": "https://example.edu/lab",
          "sourceUrl": "https://example.edu/about",
          "source": "first_party",
          "confidence": "medium",
          "rejectedReason": null,
          "persistable": false
        }
      ],
      "eligibilityStatus": "unknown",
      "eligibilityReason": null,
      "eligibilityEvidence": {
        "status": "emeritus",
        "url": "https://example.edu/faculty",
        "title": "Faculty",
        "snippet": "Current faculty page",
        "sourceDomain": null,
        "checkedAt": null
      },
      "dataverseContactEvidence": {
        "status": "none",
        "matchKey": null,
        "recordKinds": [
          "contact"
        ],
        "nameConsistent": true,
        "institutions": [],
        "reason": null,
        "checkedAt": null
      }
    },
    "name": "Alex Morgan",
    "affiliation": "Example University",
    "affiliationSource": null,
    "seniorityEstimate": null,
    "verificationConfidence": null,
    "identityStatus": "unresolved",
    "eligibilityStatus": "unknown",
    "eligibilityReason": null,
    "eligibilityEvidence": {
      "status": "emeritus",
      "url": "https://example.edu/faculty",
      "title": "Faculty",
      "snippet": "Current faculty page",
      "sourceDomain": null,
      "checkedAt": null
    },
    "needsIdentification": false,
    "verificationStatus": null,
    "isClaudeSuggestion": false,
    "source": null,
    "sources": [],
    "provenance": {
      "kind": "barred_parametric",
      "sources": [],
      "seedRole": "query_seed",
      "groundingWorkIds": []
    },
    "isReferredSeed": false,
    "referredBy": null,
    "seedResolvedPotentialReviewerId": null,
    "seedResolvedContactId": null,
    "seedIdentityMatchKey": null,
    "seedIdentityNameConsistent": null,
    "isApplicantRecommended": false,
    "applicantKnownReviewer": null,
    "applicantContactMismatch": false,
    "serverRepairReason": null,
    "enrichedProposalKey": null,
    "applicantEnrichmentCacheVersion": null,
    "suggestionId": null,
    "hasInstitutionCOI": false,
    "institutionCOIDetails": null,
    "hasCoauthorCOI": false,
    "coauthorships": [],
    "coauthorCheckStatus": null,
    "coauthorCheckFailures": [],
    "coauthorCOIStrength": null,
    "coauthorSharedPaperTotal": null,
    "coauthorMaxWithOneAuthor": null,
    "aiFlaggedNotRelevant": false,
    "lowPublicationCount": false,
    "lowPublicationCountFound": null,
    "institutionMismatch": false,
    "institutionPresentation": null,
    "suggestedInstitution": null,
    "expertiseMismatch": false,
    "verificationIncoherence": false,
    "verificationIncoherenceReasons": [],
    "expertiseAreas": null,
    "keywords": null,
    "reasoning": null,
    "identityNote": null,
    "email": "alex+6789@example.edu",
    "emailSource": "scholarly_multi",
    "emailYear": null,
    "emailAction": null,
    "emailActionReason": null,
    "website": "https://example.edu/alex",
    "orcid": "0000-0001-2345-6789",
    "orcidUrl": null,
    "googleScholarUrl": null,
    "googleScholarId": null,
    "priorAffiliation": null,
    "hIndex": null,
    "i10Index": null,
    "totalCitations": null,
    "publicationCount5yr": null,
    "publications": [
      {
        "title": "Evidence paper",
        "year": 2024,
        "url": "https://example.edu/paper"
      }
    ],
    "relevanceScore": null,
    "automatedIdentityAttestation": null,
    "candidateKey": "orcid:0000-0001-2345-6789",
    "manualContactFields": [],
    "pdIdentityConfirmed": false,
    "pdIdentityConfirmationId": null,
    "staffIdentityConfirmation": null,
    "addressConflictPending": false,
    "conflictRecordUnavailable": false,
    "addressVerificationRequired": false,
    "serverIdentityReviewReason": null
  },
  {
    "identityPersistAllowed": false,
    "scholarPersistAllowed": false,
    "emailPersistAllowed": false,
    "websitePersistAllowed": false,
    "affiliationPersistAllowed": false,
    "contactEnrichment": {
      "identity": {
        "status": "unresolved",
        "confidenceBand": null,
        "resolverVersion": "golden-v1",
        "resolvedAt": "2026-09-01T00:00:00.000Z",
        "evidenceSummary": "weak anchors",
        "anchors": [
          {
            "type": "orcid",
            "canonicalKey": "0000-0002-2345-6789",
            "sourceUrl": "https://orcid.org",
            "verifier": "orcid"
          }
        ]
      },
      "email": "enriched+6789@example.edu",
      "emailSource": "scholarly_multi",
      "emailYear": null,
      "emailAction": null,
      "emailActionReason": null,
      "emailEvidence": {
        "sourceKind": "publication",
        "sourceUrl": "https://example.edu/evidence",
        "action": "use",
        "ownership": "author-specific",
        "ownershipProof": "verified",
        "matchClass": "exact",
        "alternatives": [
          {
            "email": "other@example.edu",
            "matchClass": "weak"
          }
        ],
        "affiliationMatched": true,
        "publicationCount": 1,
        "providers": [
          "pubmed"
        ],
        "publications": [
          {
            "pmid": "123456",
            "pmcid": null,
            "doi": null,
            "title": "Evidence paper",
            "year": 2024,
            "url": null,
            "providers": [
              "pubmed"
            ]
          }
        ],
        "deliverabilityChecked": true
      },
      "contactStatus": null,
      "contactStatusReason": null,
      "verifiedInstitutionDomain": null,
      "anchoredInstitutionDomains": [],
      "plausibleInstitutionDomains": [],
      "website": "https://example.edu/alex",
      "websiteSource": "verified",
      "orcid": null,
      "orcidId": null,
      "orcidUrl": null,
      "googleScholarUrl": null,
      "googleScholarId": null,
      "affiliationSource": null,
      "openAlexInstitutionId": null,
      "openAlexInstitutionRor": null,
      "orcidInstitutionRor": "https://ror.org/03yrm5c26",
      "priorAffiliation": null,
      "hIndex": null,
      "totalCitations": null,
      "emailPersistAllowed": false,
      "websitePersistAllowed": false,
      "affiliationPersistAllowed": false,
      "contactLeads": [
        {
          "type": "website",
          "value": "https://example.edu/lab",
          "sourceUrl": "https://example.edu/about",
          "source": "first_party",
          "confidence": "medium",
          "rejectedReason": null,
          "persistable": false
        }
      ],
      "eligibilityStatus": "unknown",
      "eligibilityReason": null,
      "eligibilityEvidence": {
        "status": "emeritus",
        "url": "https://example.edu/faculty",
        "title": "Faculty",
        "snippet": "Current faculty page",
        "sourceDomain": null,
        "checkedAt": null
      },
      "dataverseContactEvidence": {
        "status": "none",
        "matchKey": null,
        "recordKinds": [
          "contact"
        ],
        "nameConsistent": true,
        "institutions": [],
        "reason": null,
        "checkedAt": null
      }
    },
    "name": "Alex Morgan",
    "affiliation": "Example University",
    "affiliationSource": null,
    "seniorityEstimate": null,
    "verificationConfidence": null,
    "identityStatus": "unresolved",
    "eligibilityStatus": "unknown",
    "eligibilityReason": null,
    "eligibilityEvidence": {
      "status": "emeritus",
      "url": "https://example.edu/faculty",
      "title": "Faculty",
      "snippet": "Current faculty page",
      "sourceDomain": null,
      "checkedAt": null
    },
    "needsIdentification": false,
    "verificationStatus": null,
    "isClaudeSuggestion": false,
    "source": null,
    "sources": [],
    "provenance": {
      "kind": "barred_parametric",
      "sources": [],
      "seedRole": "query_seed",
      "groundingWorkIds": []
    },
    "isReferredSeed": false,
    "referredBy": null,
    "seedResolvedPotentialReviewerId": null,
    "seedResolvedContactId": null,
    "seedIdentityMatchKey": null,
    "seedIdentityNameConsistent": null,
    "isApplicantRecommended": false,
    "applicantKnownReviewer": null,
    "applicantContactMismatch": false,
    "serverRepairReason": null,
    "enrichedProposalKey": null,
    "applicantEnrichmentCacheVersion": null,
    "suggestionId": null,
    "hasInstitutionCOI": false,
    "institutionCOIDetails": null,
    "hasCoauthorCOI": false,
    "coauthorships": [],
    "coauthorCheckStatus": null,
    "coauthorCheckFailures": [],
    "coauthorCOIStrength": null,
    "coauthorSharedPaperTotal": null,
    "coauthorMaxWithOneAuthor": null,
    "aiFlaggedNotRelevant": false,
    "lowPublicationCount": false,
    "lowPublicationCountFound": null,
    "institutionMismatch": false,
    "institutionPresentation": null,
    "suggestedInstitution": null,
    "expertiseMismatch": false,
    "verificationIncoherence": false,
    "verificationIncoherenceReasons": [],
    "expertiseAreas": null,
    "keywords": null,
    "reasoning": null,
    "identityNote": null,
    "email": "alex+6789@example.edu",
    "emailSource": "scholarly_multi",
    "emailYear": null,
    "emailAction": null,
    "emailActionReason": null,
    "website": "https://example.edu/alex",
    "orcid": "0000-0002-2345-6789",
    "orcidUrl": null,
    "googleScholarUrl": null,
    "googleScholarId": null,
    "priorAffiliation": null,
    "hIndex": null,
    "i10Index": null,
    "totalCitations": null,
    "publicationCount5yr": null,
    "publications": [
      {
        "title": "Evidence paper",
        "year": 2024,
        "url": "https://example.edu/paper"
      }
    ],
    "relevanceScore": null,
    "automatedIdentityAttestation": null,
    "candidateKey": "orcid:0000-0002-2345-6789",
    "manualContactFields": [],
    "pdIdentityConfirmed": false,
    "pdIdentityConfirmationId": null,
    "staffIdentityConfirmation": null,
    "addressConflictPending": false,
    "conflictRecordUnavailable": false,
    "addressVerificationRequired": false,
    "serverIdentityReviewReason": null
  }
]"
`);

;
  });

  test.each([null, undefined, false, 7, 'not a candidate'])('returns non-object candidate input unchanged: %p', (candidate) => {
    expect(pruneCandidateForRoster(candidate)).toBe(candidate);
  });
});
