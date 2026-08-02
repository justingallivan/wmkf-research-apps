/** @jest-environment node */
const {
  STAGES, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY,
  planCandidateFreshness, mapLegacyStage,
} = require('../../lib/services/reviewer-stage-freshness');

const now = Date.parse('2026-08-01T00:00:00.000Z');
const versions = Object.fromEntries(STAGES.map((stage) => [stage, `${stage}:v1`]));
function candidate(overrides = {}) {
  return {
    candidateKey: 'suggestion:11111111-1111-1111-1111-111111111111', warmCacheVersion: 1,
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

test('missing versions and refresh leases never create authority or duplicate refresh work', () => {
  const missing = candidate(); delete missing.stageFreshness.contact.sourceVersion;
  expect(planCandidateFreshness({ candidate: missing, authoritative: authoritative(), now }).refreshes).toContainEqual({ stage: 'contact', reason: 'stage_contract_changed' });
  const refreshing = candidate(); refreshing.stageFreshness.contact = { ...refreshing.stageFreshness.contact, state: 'refreshing', refreshStartedAt: '2026-08-01T00:00:00.000Z' };
  const pending = planCandidateFreshness({ candidate: refreshing, authoritative: authoritative(), now: now + 10, policy: { version: 1, stages: {}, leaseMs: 1000 } });
  expect(pending.pendingStages).toContain('contact'); expect(pending.refreshes.map((entry) => entry.stage)).not.toContain('contact');
  const expired = planCandidateFreshness({ candidate: refreshing, authoritative: authoritative(), now: now + 2000, policy: { version: 1, stages: {}, leaseMs: 1000 } });
  expect(expired.refreshes).toContainEqual({ stage: 'contact', reason: 'prior_refresh_incomplete' });
  expect(expired.promotionAuthority).toBe('blocked_refresh_required');
});

test('planner accepts only canonical anchors and rejects normalized/client candidate keys', () => {
  expect(planCandidateFreshness({ candidate: candidate({ candidateKey: 'candidate:normalized-name' }), authoritative: authoritative(), now }).candidateKey).toBeNull();
  expect(planCandidateFreshness({ candidate: candidate({ candidateKey: 'client:forged' }), authoritative: authoritative(), now }).candidateKey).toBeNull();
  expect(planCandidateFreshness({ candidate: candidate({ candidateKey: 'unknown:x' }), authoritative: authoritative(), now }).candidateKey).toBeNull();
  expect(planCandidateFreshness({ candidate: candidate({ candidateKey: 'suggestion:', suggestionId: '11111111-1111-1111-1111-111111111111' }), authoritative: authoritative(), now }).candidateKey).toBeNull();
  expect(planCandidateFreshness({ candidate: candidate({ candidateKey: 'candidate:x', suggestionId: '11111111-1111-1111-1111-111111111111' }), authoritative: authoritative(), now }).candidateKey).toBeNull();
  expect(planCandidateFreshness({ candidate: { ...candidate(), candidateKey: undefined, suggestionId: '11111111-1111-1111-1111-111111111111' }, authoritative: authoritative(), now }).candidateKey).toBe('suggestion:11111111-1111-1111-1111-111111111111');
  expect(planCandidateFreshness({ candidate: { ...candidate(), candidateKey: undefined, suggestionId: 'not-guid' }, authoritative: authoritative(), now }).candidateKey).toBeNull();
});

test('default policy does not age-expire; injected time-sensitive policy does not age-expire identity or coauthor', () => {
  const old = candidate(); old.stageFreshness.identity.completedAt = '2010-01-01T00:00:00.000Z'; old.stageFreshness.contact.completedAt = '2010-01-01T00:00:00.000Z';
  expect(planCandidateFreshness({ candidate: old, authoritative: authoritative(), now, policy: DEFAULT_AGE_POLICY }).refreshes).toEqual([]);
  old.stageFreshness.coauthor_coi.completedAt = '2010-01-01T00:00:00.000Z';
  const plan = planCandidateFreshness({ candidate: old, authoritative: authoritative(), now, policy: { version: 1, stages: { contact: { maxAgeMs: 1 } } } });
  expect(plan.refreshes).toContainEqual({ stage: 'contact', reason: 'stage_incomplete' });
  expect(plan.refreshes.map((entry) => entry.stage)).not.toContain('identity');
});

test('legacy compatibility requires explicit equivalent provenance and never creates automatic current evidence from ambiguity', () => {
  const identityDependencies = { candidateKey: 'suggestion:11111111-1111-1111-1111-111111111111' };
  const equivalent = candidate({
    stageFreshness: {},
    legacyStageReceipts: {
      identity: {
        mapperVersion: 1, stage: 'identity', identity: identityDependencies,
        dependencies: identityDependencies, completeness: 'complete',
        source: { contractVersion: 4, sourceVersion: versions.identity },
        checkedAt: '2026-07-31T00:00:00.000Z',
      },
    },
  });
  const withDependencies = authoritative({ legacyEvidenceDependencies: { identity: identityDependencies } });
  expect(mapLegacyStage(equivalent, 'identity', withDependencies)).toMatchObject({ state: 'current', mappedFromLegacy: true });
  const ambiguous = candidate({
    stageFreshness: {},
    legacyStageReceipts: {
      identity: {
        mapperVersion: 1, stage: 'identity', identity: identityDependencies,
        dependencies: identityDependencies, completeness: 'complete',
        checkedAt: '2026-07-31T00:00:00.000Z',
      },
    },
  });
  expect(mapLegacyStage(ambiguous, 'identity', withDependencies)).toMatchObject({ state: 'incomplete' });
  expect(planCandidateFreshness({ candidate: ambiguous, authoritative: withDependencies, now }).refreshes).toContainEqual({ stage: 'identity', reason: 'stage_incomplete' });
});
