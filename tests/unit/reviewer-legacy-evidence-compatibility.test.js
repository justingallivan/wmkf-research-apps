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
  const base = { candidateKey };
  if (stage === 'applicant_anchor') return { ...base, requestId: 'request:v1', applicantInputVersion: 'input:v1' };
  if (stage === 'institution_coi') return { ...base, requestId: 'request:v1', institutionInputVersion: 'institution:v1' };
  if (stage === 'coauthor_coi') return { ...base, requestId: 'request:v1', proposalContentVersion: 'proposal:v1', proposalAuthorVersion: 'authors:v1' };
  if (stage === 'eligibility') return { ...base, eligibilityInputVersion: 'eligibility:v1' };
  if (stage === 'contact') return { ...base, contactInputVersion: 'contact:v1' };
  if (stage === 'address_trust') return { ...base, addressInputVersion: 'address:v1' };
  if (stage === 'roster_persistence') return { ...base, rosterProjectionVersion: 'projection:v1' };
  return base;
}

function legacyEvidence(stage, overrides = {}) {
  return {
    mapperVersion: LEGACY_EVIDENCE_MAPPER_VERSION,
    stage,
    identity: { candidateKey },
    dependencies: dependencies(stage),
    completeness: 'complete',
    source: { contractVersion: CONTRACT_VERSIONS[stage], sourceVersion: `${stage}:v1` },
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
])('%s remains non-authoritative', (_label, evidence, reason, state) => {
  const result = mapLegacyStageEvidence({
    candidate: { candidateKey, legacyStageReceipts: evidence === undefined ? {} : { identity: evidence, eligibility: evidence } },
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
    state: 'current', contractVersion: CONTRACT_VERSIONS[stage], sourceVersion: versions[stage], completedAt: checkedAt,
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
      eligibility: legacyEvidence('eligibility', { checkedAt: '2020-01-01T00:00:00.000Z' }),
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
  expect(plan.refreshes).toContainEqual({ stage: 'eligibility', reason: 'stage_incomplete' });
  expect(plan.evidenceCheckedDates.eligibility).toBe('2020-01-01T00:00:00.000Z');
  expect(LEGACY_EVIDENCE_REASONS).toContain('legacy_dependency_mismatch');
});
