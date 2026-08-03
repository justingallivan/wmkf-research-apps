/** @jest-environment node */
const {
  STAGES, CONTRACT_VERSIONS, DOWNSTREAM, DEFAULT_AGE_POLICY,
  planCandidateFreshness, mapLegacyStage, projectLegacySelectionProjection,
} = require('../../lib/services/reviewer-stage-freshness');
const { expiredLeaseRecoverySourceVersion } = require('../../lib/services/workbench/reviewer-stage-source-versions');

const now = Date.parse('2026-08-01T00:00:00.000Z');
const versions = Object.fromEntries(STAGES.map((stage) => [stage, `${stage}:v1`]));
function candidate(overrides = {}) {
  return {
    candidateKey: 'suggestion:11111111-1111-1111-1111-111111111111', warmCacheVersion: 1,
    applicantInputVersion: 'input:v1', proposalContentVersion: 'proposal:v1',
    stageFreshness: Object.fromEntries(STAGES.map((stage) => [stage, {
      state: 'current', contractVersion: CONTRACT_VERSIONS[stage], sourceVersion: versions[stage],
      resultVersion: `${stage}:result-v1`, completedAt: '2026-07-31T00:00:00.000Z',
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
  const refreshing = candidate(); refreshing.stageRefresh = {
    contact: { refreshAttemptId: 'attempt-1', refreshStartedAt: '2026-08-01T00:00:00.000Z' },
  };
  const pending = planCandidateFreshness({ candidate: refreshing, authoritative: authoritative(), now: now + 10, policy: { version: 1, stages: {}, leaseMs: 1000 } });
  expect(pending.pendingStages).toContain('contact'); expect(pending.refreshes.map((entry) => entry.stage)).not.toContain('contact');
  const expired = planCandidateFreshness({ candidate: refreshing, authoritative: authoritative(), now: now + 2000, policy: { version: 1, stages: {}, leaseMs: 1000 } });
  expect(expired.refreshes).toContainEqual({
    stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease',
  });
  expect(expired.promotionAuthority).toBe('blocked_refresh_required');

  const upstreamChanged = candidate({
    applicantInputVersion: 'input:changed',
    stageRefresh: {
      contact: { refreshAttemptId: 'attempt-2', refreshStartedAt: '2026-08-01T00:00:00.000Z' },
    },
  });
  const recoveryFirst = planCandidateFreshness({
    candidate: upstreamChanged,
    authoritative: authoritative(),
    now: now + 2000,
    policy: { version: 1, stages: {}, leaseMs: 1000 },
  });
  expect(recoveryFirst.refreshes[0]).toEqual({
    stage: 'contact', reason: 'prior_refresh_incomplete', action: 'recover_expired_lease',
  });
  expect(recoveryFirst.refreshes).toContainEqual({ stage: 'applicant_anchor', reason: 'candidate_input_changed' });
});

test('a valid expired owner canonicalizes recovery reason ahead of an earlier warm-cache invalidation', () => {
  const withExpiredContact = candidate({
    stageRefresh: {
      contact: {
        refreshAttemptId: 'contact-attempt',
        refreshStartedAt: '2026-08-01T00:00:00.000Z',
      },
    },
  });
  delete withExpiredContact.warmCacheVersion;

  const plan = planCandidateFreshness({
    candidate: withExpiredContact,
    authoritative: authoritative(),
    now: now + 2_000,
    policy: { version: 1, stages: {}, leaseMs: 1_000 },
  });

  expect(plan.refreshes[0]).toEqual({
    stage: 'contact',
    reason: 'prior_refresh_incomplete',
    action: 'recover_expired_lease',
  });
  expect(plan.leaseRepairRequired).toBe(false);
});

test('a malformed lease is operator-repair-only and is never advertised as expired-lease recovery', () => {
  const malformed = candidate({
    stageRefresh: {
      // Historical aliases are not canonical recovery authority.
      contact: { attemptId: 'legacy-attempt', startedAt: '2020-08-01T00:00:00.000Z' },
    },
  });
  const plan = planCandidateFreshness({ candidate: malformed, authoritative: authoritative(), now });

  expect(plan.leaseRepairRequired).toBe(true);
  expect(plan.refreshes).toContainEqual({
    stage: 'contact', reason: 'stage_incomplete', action: 'operator_repair_required',
  });
  expect(plan.refreshes).not.toContainEqual(expect.objectContaining({ action: 'recover_expired_lease' }));
});

test('a non-stage malformed lease blocks promotion even when every real stage is current', () => {
  const malformed = candidate({ stageRefresh: { historical: 'corrupt-lease' } });
  const plan = planCandidateFreshness({ candidate: malformed, authoritative: authoritative(), now });

  expect(plan.refreshes).toEqual([]);
  expect(plan.pendingStages).toEqual([]);
  expect(plan.leaseRepairRequired).toBe(true);
  expect(plan.cacheOutcome).not.toBe('hit');
  expect(plan.promotionAuthority).toBe('blocked_refresh_required');
});

test.each(['  ', 'a'.repeat(129)])('invalid per-stage attempt IDs never appear pending: %p', (refreshAttemptId) => {
  const malformed = candidate({
    stageRefresh: {
      contact: { refreshAttemptId, refreshStartedAt: '2026-08-01T00:00:00.000Z' },
    },
  });
  const plan = planCandidateFreshness({
    candidate: malformed,
    authoritative: authoritative(),
    now: now + 10,
    policy: { version: 1, stages: {}, leaseMs: 1000 },
  });

  expect(plan.pendingStages).not.toContain('contact');
  expect(plan.leaseRepairRequired).toBe(true);
  expect(plan.refreshes).toContainEqual({
    stage: 'contact', reason: 'stage_incomplete', action: 'operator_repair_required',
  });
});

test('an expired-lease recovery receipt remains incomplete so ordinary planning resumes when authority returns', () => {
  const recovered = candidate();
  recovered.stageFreshness.contact = {
    state: 'incomplete',
    contractVersion: CONTRACT_VERSIONS.contact,
    sourceVersion: expiredLeaseRecoverySourceVersion({
      requestId: '11111111-1111-1111-1111-111111111111',
      candidateKey: recovered.candidateKey,
      stage: 'contact',
    }),
    resultVersion: 'f'.repeat(64),
    completedAt: null,
    reasonCode: null,
    failureCode: 'retryable_failure',
  };
  // Recovery deletes the matching lease.  Once the normal snapshot is
  // available again, the next plan is a standard contact refresh rather than
  // a false cache hit or another recovery action.
  const plan = planCandidateFreshness({ candidate: recovered, authoritative: authoritative(), now });

  expect(plan.refreshes).toContainEqual({ stage: 'contact', reason: 'stage_incomplete' });
  expect(plan.refreshes).not.toContainEqual(expect.objectContaining({ action: 'recover_expired_lease' }));
  expect(plan.promotionAuthority).toBe('blocked_refresh_required');
});

test('a completed receipt without its sealed result version fails closed', () => {
  const missingResult = candidate();
  delete missingResult.stageFreshness.identity.resultVersion;
  expect(planCandidateFreshness({ candidate: missingResult, authoritative: authoritative(), now }).refreshes)
    .toContainEqual({ stage: 'identity', reason: 'stage_contract_changed' });
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
  const identityDependencies = {
    candidateKey: 'suggestion:11111111-1111-1111-1111-111111111111',
    applicantAnchorResultVersion: 'applicant-anchor-result:v1',
    proposalContentVersion: 'proposal:v1',
  };
  const equivalent = candidate({
    stageFreshness: {},
    legacyStageReceipts: {
      identity: {
        mapperVersion: 1, stage: 'identity', identity: identityDependencies,
        dependencies: identityDependencies, completeness: 'complete',
        state: 'current',
        source: {
          contractVersion: 4,
          sourceVersion: versions.identity,
          resultVersion: 'a'.repeat(64),
        },
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

test('legacy selection projection accepts only verified signed historical evidence or a structured staff receipt', () => {
  const legacyCandidate = {
    candidateKey: 'person:55555555-5555-4555-8555-555555555555',
    identityStatus: 'probable',
    email: 'kwferrar@stanford.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    contactEnrichment: {
      identity: {
        status: 'probable',
        resolvedAt: '2026-07-29T12:00:00.000Z',
      },
    },
  };
  const args = {
    requestId: '11111111-1111-1111-1111-111111111111',
    contact: { decision: 'ready', email: 'kwferrar@stanford.edu' },
    automatedAttestation: {
      valid: true,
      historicalSelection: true,
      identityDecisionBound: true,
      eligibilityEvidenceBound: true,
      issuedAt: '2026-07-29T00:00:00.000Z',
    },
  };

  expect(projectLegacySelectionProjection(legacyCandidate, args)).toEqual({
    version: 1,
    state: 'selectable',
    evidenceCheckedAt: '2026-07-29T00:00:00.000Z',
  });

  const mutations = [
    { stageFreshness: { identity: {} } },
    { stageRefresh: { identity: {} } },
    { warmCacheVersion: 1 },
    { identityStatus: 'unresolved' },
    { contactEnrichment: { identity: { status: 'probable', resolvedAt: 'not-a-date' } } },
  ];
  for (const mutation of mutations) {
    expect(projectLegacySelectionProjection({ ...legacyCandidate, ...mutation }, args)).toBeNull();
  }
  expect(projectLegacySelectionProjection(legacyCandidate, {
    ...args,
    contact: { decision: 'ready', email: 'other@example.edu' },
  })).toBeNull();
  expect(projectLegacySelectionProjection(legacyCandidate, {
    ...args,
    contact: { decision: 'needs_identity_confirmation', email: 'kwferrar@stanford.edu' },
  })).toBeNull();
  expect(projectLegacySelectionProjection(legacyCandidate, {
    ...args,
    automatedAttestation: { ...args.automatedAttestation, historicalSelection: false },
  })).toBeNull();
});
