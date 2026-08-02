/** @jest-environment node */
const {
  LEGACY_EVIDENCE_MAPPER_VERSION,
  LEGACY_EVIDENCE_REASONS,
  mapLegacyStageEvidence,
} = require('../../lib/services/reviewer-legacy-evidence-compatibility');
const { CONTRACT_VERSIONS, planCandidateFreshness } = require('../../lib/services/reviewer-stage-freshness');

const candidateKey = 'suggestion:11111111-1111-1111-1111-111111111111';
const checkedAt = '2026-07-31T00:00:00.000Z';

function dependencies(stage) {
  const required = {
    applicant_anchor: ['candidateKey', 'requestId', 'applicantInputVersion'],
    identity: ['candidateKey', 'applicantAnchorResultVersion', 'proposalContentVersion'],
    institution_domains: ['candidateKey', 'identityResultVersion'],
    institution_coi: ['candidateKey', 'requestId', 'identityResultVersion', 'requestCoiContextVersion'],
    coauthor_coi: ['candidateKey', 'requestId', 'identityResultVersion', 'proposalContentVersion', 'proposalAuthorVersion'],
    eligibility: ['candidateKey', 'identityResultVersion', 'institutionDomainsResultVersion', 'trustedDomainsVersion'],
    contact: ['candidateKey', 'identityResultVersion', 'institutionDomainsResultVersion', 'canonicalPersonVersion'],
    address_trust: ['candidateKey', 'identityResultVersion', 'contactResultVersion', 'canonicalPersonVersion'],
    roster_persistence: ['candidateKey', 'rosterProjectionVersion'],
  }[stage] || [];
  return Object.fromEntries(required.map((key) => [key, key === 'candidateKey' ? candidateKey : `${key}:v1`]));
}

function legacyEvidence(stage, overrides = {}) {
  return {
    mapperVersion: LEGACY_EVIDENCE_MAPPER_VERSION,
    stage,
    identity: { candidateKey },
    dependencies: dependencies(stage),
    completeness: 'complete',
    state: 'current',
    source: {
      contractVersion: CONTRACT_VERSIONS[stage],
      sourceVersion: `${stage}:v1`,
      resultVersion: 'a'.repeat(64),
    },
    checkedAt,
    ...overrides,
  };
}

function authoritative(stage, overrides = {}) {
  return {
    versions: { [stage]: `${stage}:v1` },
    legacyEvidenceDependencies: { [stage]: dependencies(stage) },
    ...overrides,
  };
}

test('maps only a versioned legacy proof with equivalent identity, dependencies, completeness, and source', () => {
  const result = mapLegacyStageEvidence({
    candidate: { candidateKey, legacyStageReceipts: { coauthor_coi: legacyEvidence('coauthor_coi') } },
    stage: 'coauthor_coi',
    authoritative: authoritative('coauthor_coi'),
    contractVersion: CONTRACT_VERSIONS.coauthor_coi,
  });

  expect(result.reason).toBe('legacy_evidence_equivalent');
  expect(result.receipt).toEqual(expect.objectContaining({
    state: 'current',
    resultVersion: 'a'.repeat(64),
    completedAt: checkedAt,
    mappedFromLegacy: true,
    equivalenceReason: 'legacy_evidence_equivalent',
  }));
});

test.each([
  ['missing payload', undefined, 'legacy_evidence_missing', null],
  ['old equivalence certificate without proof', { equivalenceVersion: 1, stage: 'identity' }, 'legacy_evidence_invalid', 'incomplete'],
  ['missing provenance', legacyEvidence('identity', { source: undefined }), 'legacy_source_contract_mismatch', 'incomplete'],
  ['ambiguous identity', legacyEvidence('identity', { identity: { candidateKey: 'person:other' } }), 'legacy_identity_mismatch', 'incomplete'],
  ['incomplete check', legacyEvidence('eligibility', { completeness: 'partial' }), 'legacy_evidence_incomplete', 'incomplete'],
  ['missing deterministic result version', legacyEvidence('identity', { source: { contractVersion: CONTRACT_VERSIONS.identity, sourceVersion: 'identity:v1' } }), 'legacy_result_version_missing', 'incomplete'],
  ['unknown legacy stage', legacyEvidence('identity', { stage: 'unknown_stage' }), 'legacy_stage_unknown', 'incomplete'],
  ['wrong stage/reason N/A pair', legacyEvidence('eligibility', { state: 'not_applicable', reasonCode: 'missing_email' }), 'legacy_reason_invalid', 'incomplete'],
])('%s remains non-authoritative', (_label, evidence, reason, state) => {
  const result = mapLegacyStageEvidence({
    candidate: { candidateKey, legacyStageReceipts: evidence === undefined ? {} : { identity: evidence, eligibility: evidence, unknown_stage: evidence } },
    stage: evidence?.stage || 'identity',
    authoritative: authoritative(evidence?.stage || 'identity'),
    contractVersion: CONTRACT_VERSIONS[evidence?.stage || 'identity'],
  });

  expect(result.reason).toBe(reason);
  expect(LEGACY_EVIDENCE_REASONS).toContain(result.reason);
  expect(result.receipt?.state || null).toBe(state);
});

test.each([
  ['requestId', 'request:v2'],
  ['proposalContentVersion', 'proposal:v2'],
])('request/proposal-bound evidence fails closed on a recent but mismatched %s', (dependency, changedValue) => {
  const result = mapLegacyStageEvidence({
    candidate: { candidateKey, legacyStageReceipts: { coauthor_coi: legacyEvidence('coauthor_coi') } },
    stage: 'coauthor_coi',
    authoritative: authoritative('coauthor_coi', {
      legacyEvidenceDependencies: {
        coauthor_coi: { ...dependencies('coauthor_coi'), [dependency]: changedValue },
      },
    }),
    contractVersion: CONTRACT_VERSIONS.coauthor_coi,
  });

  expect(result).toEqual(expect.objectContaining({ reason: 'legacy_dependency_mismatch' }));
  expect(result.receipt).toEqual(expect.objectContaining({ state: 'incomplete', completedAt: checkedAt }));
});

test('planner preserves missing versus incomplete legacy evidence and uses injected stage age policy', () => {
  const stages = Object.keys(CONTRACT_VERSIONS);
  const versions = Object.fromEntries(stages.map((stage) => [stage, `${stage}:v1`]));
  const fresh = Object.fromEntries(stages.map((stage) => [stage, {
    state: 'current', contractVersion: CONTRACT_VERSIONS[stage], sourceVersion: versions[stage],
    resultVersion: `${stage}:result:v1`, completedAt: checkedAt,
  }]));
  delete fresh.identity;
  delete fresh.eligibility;
  const candidate = {
    candidateKey,
    warmCacheVersion: 1,
    applicantInputVersion: 'input:v1',
    proposalContentVersion: 'proposal:v1',
    stageFreshness: fresh,
    legacyStageReceipts: {
      eligibility: legacyEvidence('eligibility', {
        checkedAt: '2020-01-01T00:00:00.000Z',
        source: { contractVersion: CONTRACT_VERSIONS.eligibility, sourceVersion: 'eligibility:v1' },
      }),
    },
  };
  const plan = planCandidateFreshness({
    candidate,
    authoritative: {
      authorityState: 'current', versions,
      applicantInputVersion: 'input:v1', proposalContentVersion: 'proposal:v1',
      legacyEvidenceDependencies: { eligibility: dependencies('eligibility') },
    },
    now: Date.parse('2026-08-01T00:00:00.000Z'),
    policy: { version: 1, stages: { eligibility: { maxAgeMs: 24 * 60 * 60 * 1000 } } },
  });

  expect(plan.refreshes).toContainEqual({ stage: 'identity', reason: 'stage_missing' });
  // The old mapper has no sealed result version, so it remains visible legacy
  // history but cannot become a current warm receipt under the new contract.
  expect(plan.refreshes).toContainEqual({ stage: 'eligibility', reason: 'stage_incomplete' });
  expect(plan.evidenceCheckedDates.eligibility).toBe('2020-01-01T00:00:00.000Z');
  expect(LEGACY_EVIDENCE_REASONS).toContain('legacy_dependency_mismatch');
});
