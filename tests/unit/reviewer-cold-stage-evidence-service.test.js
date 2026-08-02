/** @jest-environment node */

const {
  COLD_STAGE_ORDER,
  projectColdStageEvidence,
  projectColdStageEvidenceBatch,
  coldPersistenceEntry,
} = require('../../lib/services/reviewer-finder/cold-stage-evidence-service');
const { CONTRACT_VERSIONS, planCandidateFreshness } = require('../../lib/services/reviewer-stage-freshness');
const { buildReviewerStageDependencySnapshot } = require('../../lib/services/workbench/reviewer-stage-source-versions');
const { institutionDomainInputFingerprint } = require('../../lib/services/workbench/institution-domain-input-fingerprint');
const { projectIdentityEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/identity');
const { projectInstitutionDomainsEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/institution-domains');
const { projectInstitutionCoiEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/institution-coi');
const { projectColdCoauthorCoiEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/coauthor-coi');
const { projectColdEligibilityEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/eligibility');
const { projectColdReviewerContactEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/contact');
const { projectColdAddressTrustEvidence } = require('../../lib/services/workbench/reviewer-stage-producers/address-trust');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_VERSION = 'a'.repeat(64);
const AUTHOR_VERSION = 'b'.repeat(64);
const DOMAIN_FINGERPRINT = 'c'.repeat(64);
const WHEN = '2026-08-02T00:00:00.000Z';

function serverCandidate(overrides = {}) {
  return {
    candidateKey: 'openalex:A123',
    name: 'Jane Smith',
    affiliation: 'Example University',
    provenance: { kind: 'literature_retrieved' },
    contactEnrichment: { affiliation: 'Example University' },
    ...overrides,
  };
}

function envelope(stage, sourceVersion, evidencePatch = {}, state = 'current') {
  return {
    outcome: state,
    evidencePatch,
    receipt: {
      state,
      contractVersion: CONTRACT_VERSIONS[stage],
      sourceVersion,
      resultVersion: `${stage}:server-result:v1`,
      completedAt: state === 'current' || state === 'not_applicable' ? WHEN : null,
      reasonCode: state === 'not_applicable' ? 'server_not_applicable' : null,
      failureCode: state === 'incomplete' ? 'partial_coverage' : null,
    },
  };
}

function plans({ tamperStage = null, incompleteStage = null } = {}) {
  return COLD_STAGE_ORDER.map((stage) => ({
    stage,
    ...(stage === 'institution_domains' ? {
      sourceInputPatch: {
        institutionDomainEvidence: { inputFingerprint: DOMAIN_FINGERPRINT },
      },
    } : {}),
    ...(stage === 'coauthor_coi' ? {
      sourceInputPatch: { proposalAuthorVersion: AUTHOR_VERSION },
    } : {}),
    project: jest.fn(({ expectedSourceVersion }) => envelope(
      stage,
      stage === tamperStage ? 'wrong-source-version' : expectedSourceVersion,
      stage === 'identity' ? {
        identityDecision: 'probable',
        identityEvidence: { decision: 'probable', status: 'probable', anchors: [] },
        identityResolverVersion: 'reviewer-identity-runtime:v1',
        identityResolvedAt: WHEN,
      } : stage === 'institution_domains' ? {
        institutionDomainEvidence: {
          inputFingerprint: DOMAIN_FINGERPRINT,
          anchoredDomains: ['example.edu'],
          plausibleDomains: [],
          institutions: ['Example University'],
          lookups: [],
          completeness: 'complete',
        },
        trustedInstitutionDomains: ['example.edu'],
        plausibleInstitutionDomains: [],
      } : stage === 'institution_coi' ? {
        hasInstitutionCOI: false,
        institutionCOIDetails: {},
        institutionCoiEvidence: { hasInstitutionCOI: false, dropDecision: 'clean', details: {} },
      } : stage === 'coauthor_coi' ? {
        hasCoauthorCOI: false,
        coauthorships: [],
        coauthorSharedPaperTotal: 0,
        coauthorMaxWithOneAuthor: 0,
        coauthorCOIStrength: 'none',
        coauthorCheckStatus: 'complete',
        coauthorCheckFailures: [],
        coauthorAuthorResults: [{ author: 'Alice Author', status: 'complete', sharedPaperCount: 0, papers: [] }],
        proposalAuthorVersion: AUTHOR_VERSION,
      } : stage === 'eligibility' ? {
        eligibilityStatus: 'unknown',
        eligibilityCheckStatus: 'complete',
        eligibilityReason: null,
        eligibilityEvidence: { status: 'unknown' },
      } : stage === 'contact' ? {
        email: 'jane@example.edu',
        emailSource: 'university_directory',
        emailPersistAllowed: true,
        emailEvidence: null,
        emailAction: 'ready',
        emailActionReason: null,
        website: null,
        websiteSource: null,
        websitePersistAllowed: false,
        facultyPageUrl: null,
        affiliation: 'Example University',
        affiliationSource: 'server_candidate',
        affiliationPersistAllowed: true,
        contactStatus: 'complete',
        contactStatusReason: null,
        contactLeads: [],
        contactTierSummary: { tiersUsed: [], providerError: false },
      } : stage === 'address_trust' ? {
        addressTrustStatus: 'ready',
        addressTrustReason: null,
        addressTrustEmail: 'jane@example.edu',
        addressTrustSource: 'university_directory',
        addressTrustEvidence: null,
      } : {},
      stage === 'applicant_anchor' ? 'not_applicable' : stage === incompleteStage ? 'incomplete' : 'current',
    )),
  }));
}

async function project(candidate, stagePlans = plans()) {
  return projectColdStageEvidence({
    candidate,
    stagePlans,
    requestId: REQUEST_ID,
    proposalContentVersion: PROPOSAL_VERSION,
    requestCoiContextVersion: 'server-request-coi-context:v1',
    completedAt: WHEN,
  });
}

function actualColdPlans(baseCandidate) {
  const identityResult = { status: 'probable', anchors: [] };
  const domainFingerprint = institutionDomainInputFingerprint(baseCandidate);
  const domainResult = {
    outcome: 'current', anchoredDomains: ['example.edu'], plausibleDomains: [],
    institutions: ['Example University'], lookups: [],
  };
  const coiContext = {
    piResolution: { state: 'current' },
    institutionEntries: [{ name: 'Different University' }],
  };
  return [
    {
      stage: 'applicant_anchor',
      project: ({ expectedSourceVersion }) => envelope('applicant_anchor', expectedSourceVersion, {}, 'not_applicable'),
    },
    {
      stage: 'identity',
      project: ({ candidate, expectedSourceVersion, proposalContentVersion, completedAt }) => projectIdentityEvidence({
        candidate, proposalContentVersion, identityResult, completedAt, expectedSourceVersion,
      }),
    },
    {
      stage: 'institution_domains',
      sourceInputPatch: { institutionDomainEvidence: { inputFingerprint: domainFingerprint } },
      project: ({ candidate, expectedSourceVersion, completedAt }) => projectInstitutionDomainsEvidence({
        candidate,
        identityReceipt: candidate.stageFreshness.identity,
        identityEvidence: candidate.identityEvidence,
        identityResult,
        domainResult,
        completedAt,
        expectedSourceVersion,
        expectedInputFingerprint: domainFingerprint,
      }),
    },
    {
      stage: 'institution_coi',
      project: ({ candidate, expectedSourceVersion, requestId, completedAt }) => projectInstitutionCoiEvidence({
        requestId,
        candidate,
        identityReceipt: candidate.stageFreshness.identity,
        identityEvidence: candidate.identityEvidence,
        identityResult,
        context: coiContext,
        decision: null,
        completedAt,
        expectedSourceVersion,
      }),
    },
    {
      stage: 'coauthor_coi',
      sourceInputPatch: { proposalAuthorVersion: AUTHOR_VERSION },
      project: ({ candidate, expectedSourceVersion }) => projectColdCoauthorCoiEvidence({
        candidate,
        proposalAuthors: ['Alice Author'],
        proposalAuthorVersion: AUTHOR_VERSION,
        sourceVersion: 'producer-local-source',
        expectedSourceVersion,
        now: () => WHEN,
      }),
    },
    {
      stage: 'eligibility',
      project: ({ candidate, expectedSourceVersion }) => projectColdEligibilityEvidence({
        candidate, sourceVersion: 'producer-local-source', expectedSourceVersion, now: () => WHEN,
      }),
    },
    {
      stage: 'contact',
      project: ({ candidate, expectedSourceVersion }) => projectColdReviewerContactEvidence({
        candidate, sourceVersion: 'producer-local-source', expectedSourceVersion, complete: true, now: () => WHEN,
      }),
    },
    {
      stage: 'address_trust',
      project: ({ candidate, expectedSourceVersion }) => projectColdAddressTrustEvidence({
        candidate, sourceVersion: 'producer-local-source', expectedSourceVersion, now: () => WHEN,
      }),
    },
  ];
}

test('recomputes and passes the sequential shared source version for every cold stage', async () => {
  const stagePlans = plans();
  const projected = await project(serverCandidate(), stagePlans);

  expect(projected).toMatchObject({ outcome: 'ready', persistable: true });
  expect(Object.keys(projected.stageEvidence)).toEqual(COLD_STAGE_ORDER);
  for (const plan of stagePlans) {
    const expectedSourceVersion = plan.project.mock.calls[0][0].expectedSourceVersion;
    expect(projected.stageEvidence[plan.stage].receipt.sourceVersion).toBe(expectedSourceVersion);
    expect(projected.snapshot.stageInputVersions[plan.stage]).toBe(expectedSourceVersion);
    expect(plan.project).toHaveBeenCalledTimes(1);
  }
});

test('the actual cold projectors accept only the sequential shared source version without reopening a provider', async () => {
  const candidate = serverCandidate({
    coauthorCheckStatus: 'complete',
    coauthorships: [],
    coauthorCheckFailures: [],
    hasCoauthorCOI: false,
    contactEnrichment: {
      affiliation: 'Example University',
      identity: { status: 'probable' },
      eligibilityCheckStatus: 'complete',
      eligibilityStatus: 'unknown',
      email: 'jane@example.edu',
      emailSource: 'pubmed',
      emailPersistAllowed: true,
      affiliationPersistAllowed: true,
      contactStatus: 'complete',
      tierResults: {},
    },
  });
  const projected = await project(candidate, actualColdPlans(candidate));

  expect(projected).toMatchObject({ outcome: 'ready', persistable: true });
  for (const stage of COLD_STAGE_ORDER) {
    expect(projected.stageEvidence[stage].receipt.sourceVersion)
      .toBe(projected.snapshot.stageInputVersions[stage]);
  }
  expect(projected.candidate.stageFreshness.roster_persistence).toBeUndefined();
});

test('rejects a producer envelope that does not use the just-computed shared source version', async () => {
  const projected = await project(serverCandidate(), plans({ tamperStage: 'identity' }));

  expect(projected).toMatchObject({
    outcome: 'partial',
    persistable: true,
    code: 'stage_source_version_mismatch',
    failedStage: 'identity',
  });
  expect(Object.keys(projected.stageEvidence)).toEqual(['applicant_anchor']);
});

test('a canonical incomplete stage persists prior and failed receipts, then warm planning resumes at that dependency', async () => {
  const projected = await project(serverCandidate({ warmCacheVersion: 1 }), plans({ incompleteStage: 'identity' }));
  const persistenceEntry = coldPersistenceEntry(projected);
  const authoritative = buildReviewerStageDependencySnapshot({
    candidate: projected.candidate,
    requestId: REQUEST_ID,
    proposalContentVersion: PROPOSAL_VERSION,
    requestCoiContextVersion: 'server-request-coi-context:v1',
  });
  const warmPlan = planCandidateFreshness({
    candidate: { ...projected.candidate, warmCacheVersion: 1, proposalContentVersion: PROPOSAL_VERSION },
    authoritative: {
      authorityState: 'current',
      versions: authoritative.versions,
      proposalContentVersion: PROPOSAL_VERSION,
    },
  });

  expect(projected).toMatchObject({
    outcome: 'partial', persistable: true, code: 'stage_incomplete', failedStage: 'identity',
  });
  expect(persistenceEntry.stageEvidence).toEqual({
    applicant_anchor: expect.any(Object),
    identity: expect.objectContaining({ outcome: 'incomplete' }),
  });
  expect(persistenceEntry.candidate.stageFreshness.roster_persistence).toBeUndefined();
  expect(warmPlan.currentStages).toContain('applicant_anchor');
  expect(warmPlan.refreshes.map((entry) => entry.stage)).toEqual(expect.arrayContaining([
    'identity', 'institution_domains', 'institution_coi', 'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence',
  ]));
  expect(warmPlan.refreshes.map((entry) => entry.stage)).not.toContain('applicant_anchor');
});

test('ignores browser-shaped stage evidence and source values before recomputing the server chain', async () => {
  const projected = await project(serverCandidate({
    stageFreshness: { identity: { state: 'current', sourceVersion: 'browser', resultVersion: 'browser' } },
    stageEvidence: { identity: { forged: true } },
    proposalContentVersion: 'f'.repeat(64),
    identityDecision: 'confirmed',
    identityEvidence: { decision: 'confirmed', forged: true },
    proposalAuthorVersion: 'f'.repeat(64),
    institutionDomainEvidence: { inputFingerprint: 'e'.repeat(64) },
  }));

  expect(projected).toMatchObject({ outcome: 'ready', persistable: true });
  expect(projected.candidate.proposalAuthorVersion).toBe(AUTHOR_VERSION);
  expect(projected.candidate.proposalContentVersion).toBeUndefined();
  expect(projected.candidate.identityEvidence.forged).toBeUndefined();
  expect(projected.candidate.institutionDomainEvidence.inputFingerprint).toBe(DOMAIN_FINGERPRINT);
  expect(projected.candidate.stageFreshness.identity.sourceVersion).toBe(
    projected.stageEvidence.identity.receipt.sourceVersion,
  );
});

test('mixed canonical and noncanonical results preserve display rows but create a persistence entry only for the canonical candidate', async () => {
  const [canonical, noncanonical] = await projectColdStageEvidenceBatch({
    entries: [
      { candidate: serverCandidate(), stagePlans: plans() },
      { candidate: serverCandidate({ candidateKey: 'candidate:browser-derived' }), stagePlans: plans() },
    ],
    requestId: REQUEST_ID,
    proposalContentVersion: PROPOSAL_VERSION,
    requestCoiContextVersion: 'server-request-coi-context:v1',
    completedAt: WHEN,
  });

  expect(canonical).toMatchObject({ outcome: 'ready', persistable: true });
  expect(canonical.persistenceEntry).toMatchObject({ candidate: { candidateKey: 'openalex:A123' } });
  expect(noncanonical).toMatchObject({
    outcome: 'partial',
    persistable: false,
    code: 'canonical_candidate_unavailable',
    persistenceEntry: null,
  });
  expect(noncanonical.candidate).toMatchObject({ name: 'Jane Smith', candidateKey: 'candidate:browser-derived' });
});
