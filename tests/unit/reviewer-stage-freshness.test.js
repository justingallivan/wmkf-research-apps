/** @jest-environment node */
const {
  STAGES, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY,
  planCandidateFreshness, mapLegacyStage,
} = require('../../lib/services/reviewer-stage-freshness');

const now = Date.parse('2026-08-01T00:00:00.000Z');
const versions = Object.fromEntries(STAGES.map((stage) => [stage, `${stage}:v1`]));
function candidate(overrides = {}) {
  return {
    candidateKey: 'suggestion:abc', warmCacheVersion: 1,
    applicantInputVersion: 'input:v1', proposalContentVersion: 'proposal:v1',
    stageFreshness: Object.fromEntries(STAGES.map((stage) => [stage, {
      state: 'current', contractVersion: CONTRACT_VERSIONS[stage], sourceVersion: versions[stage], completedAt: '2026-07-31T00:00:00.000Z',
    }])),
    ...overrides,
  };
}
function authoritative(overrides = {}) { return { authorityState: 'current', versions, applicantInputVersion: 'input:v1', proposalContentVersion: 'proposal:v1', ...overrides }; }

test('every dependency-matrix stage invalidates only itself and its declared downstream stages', () => {
  for (const stage of STAGES) {
    const changed = candidate();
    changed.stageFreshness[stage] = { ...changed.stageFreshness[stage], sourceVersion: 'old' };
    const plan = planCandidateFreshness({ candidate: changed, authoritative: authoritative(), now });
    expect(plan.refreshes.map((entry) => entry.stage).sort()).toEqual([stage, ...DOWNSTREAM[stage]].sort());
  }
});

test('proposal changes invalidate coauthor only, while applicant and identity changes transitively invalidate dependencies', () => {
  const proposal = planCandidateFreshness({ candidate: candidate({ proposalContentVersion: 'old' }), authoritative: authoritative(), now });
  expect(proposal.refreshes.map((entry) => entry.stage).sort()).toEqual(['coauthor_coi', 'roster_persistence']);
  const applicant = planCandidateFreshness({ candidate: candidate({ applicantInputVersion: 'old' }), authoritative: authoritative(), now });
  expect(applicant.refreshes.map((entry) => entry.stage).sort()).toEqual(['applicant_anchor', ...DOWNSTREAM.applicant_anchor].sort());
  const identity = candidate(); identity.stageFreshness.identity.sourceVersion = 'old';
  expect(planCandidateFreshness({ candidate: identity, authoritative: authoritative(), now }).refreshes.map((entry) => entry.stage).sort())
    .toEqual(['identity', ...DOWNSTREAM.identity].sort());
});

test('unknown/missing states, contracts, and reasons fail closed', () => {
  const unknown = candidate(); unknown.stageFreshness.contact.state = 'mystery';
  const missing = candidate(); delete missing.stageFreshness.contact;
  const badVersion = candidate(); badVersion.stageFreshness.contact.contractVersion = 999;
  expect(planCandidateFreshness({ candidate: unknown, authoritative: authoritative(), now }).refreshes).toContainEqual({ stage: 'contact', reason: 'unclassified_miss' });
  expect(planCandidateFreshness({ candidate: missing, authoritative: authoritative(), now }).refreshes).toContainEqual({ stage: 'contact', reason: 'stage_missing' });
  expect(planCandidateFreshness({ candidate: badVersion, authoritative: authoritative(), now }).refreshes).toContainEqual({ stage: 'contact', reason: 'stage_contract_changed' });
});

test('identity does not age-expire, but configurable time-sensitive stages do', () => {
  const old = candidate(); old.stageFreshness.identity.completedAt = '2010-01-01T00:00:00.000Z'; old.stageFreshness.contact.completedAt = '2010-01-01T00:00:00.000Z';
  const plan = planCandidateFreshness({ candidate: old, authoritative: authoritative(), now, policy: DEFAULT_AGE_POLICY });
  expect(plan.refreshes).toContainEqual({ stage: 'contact', reason: 'stage_incomplete' });
  expect(plan.refreshes.map((entry) => entry.stage)).not.toContain('identity');
});

test('legacy compatibility requires explicit equivalent provenance and never creates automatic current evidence from ambiguity', () => {
  const equivalent = candidate({ stageFreshness: {}, legacyStageReceipts: { identity: { equivalenceVersion: 1, stage: 'identity', contractVersion: 4, sourceVersion: versions.identity, completedAt: '2026-07-31T00:00:00.000Z' } } });
  expect(mapLegacyStage(equivalent, 'identity', authoritative())).toMatchObject({ state: 'current', mappedFromLegacy: true });
  const ambiguous = candidate({ stageFreshness: {}, legacyStageReceipts: { identity: { equivalenceVersion: 1, stage: 'identity', contractVersion: 4, completedAt: '2026-07-31T00:00:00.000Z' } } });
  expect(mapLegacyStage(ambiguous, 'identity', authoritative())).toBeNull();
  expect(planCandidateFreshness({ candidate: ambiguous, authoritative: authoritative(), now }).refreshes).toContainEqual({ stage: 'identity', reason: 'stage_missing' });
});
