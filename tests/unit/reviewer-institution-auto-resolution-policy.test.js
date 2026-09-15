const fixture = require('../fixtures/reviewer-institution-auto-resolution/v1/policy-regression.json');
const {
  assessAffiliationRelationship,
} = require('../../lib/services/institution-affiliation-assessment');
const {
  POLICY_VERSION,
  evaluateReviewerInstitutionAutoResolution,
} = require('../../lib/services/reviewer-institution-auto-resolution-policy');

const IDS = {
  system: 'https://ror.org/000000001',
  unit_a: 'https://ror.org/000000002',
  unit_b: 'https://ror.org/000000003',
};

function resolution(segment = {}) {
  if (segment.unresolved) return { status: 'unresolved', reason: segment.unresolved };
  if (segment.scope === 'subunit') {
    return {
      status: 'resolved',
      sourceRorId: null,
      canonicalRorId: IDS[segment.parentOrg],
      organizationScope: 'subunit',
      parentRorId: IDS[segment.parentOrg],
      relationships: [],
      provider: 'synthetic_fixture',
      confidence: 'adjudicated',
    };
  }
  return {
    status: 'resolved',
    sourceRorId: IDS[segment.org],
    canonicalRorId: IDS[segment.canonicalOrg || segment.org],
    relationships: (segment.relationships || []).map((item) => ({
      type: item.type,
      rorId: IDS[item.org],
    })),
    provider: 'synthetic_fixture',
    confidence: 'adjudicated',
  };
}

function assertion(input = {}, sourceType = 'publication') {
  return {
    rawText: 'Synthetic organization evidence',
    sourceType,
    sourceReference: 'synthetic:policy-regression',
    observedAt: '2026-09-14',
    currentness: input.currentness || 'current',
    authorSpecific: input.authorSpecific ?? true,
    segments: input.segments.map((segment) => ({
      rawText: `Synthetic ${segment.label || segment.org || segment.parentOrg || 'unresolved'} organization`,
      role: segment.role,
      resolution: resolution(segment),
    })),
  };
}

function independentIdentity(value) {
  if (value === 'not_evaluable') return null;
  return {
    sufficient: value === 'sufficient',
    excludesAffiliation: true,
    evaluatorVersion: 'synthetic-independent-identity/v1',
    evidence: ['non_affiliation_fixture'],
  };
}

function independentIdentityV1(result, overrides = {}) {
  return {
    version: 'independent-identity/v1',
    result,
    reason: 'synthetic',
    excludesAffiliation: true,
    method: 'exact_work_unique_author',
    resolverVersion: 'independentReviewerIdentity@1.0.0',
    requestBinding: 'request-1',
    candidateKey: 'candidate-1',
    identityInputDigest: 'a'.repeat(64),
    evaluatedAt: '2026-09-14T18:00:00.000Z',
    providerObservedAt: '2026-09-14T18:00:00.000Z',
    expiresAt: '2026-09-28T18:00:00.000Z',
    providerState: 'complete',
    evidence: {},
    ...overrides,
  };
}

function evaluate(testCase) {
  const assessed = assessAffiliationRelationship({
    evidenceAssertion: assertion(testCase.evidence),
    recordedAssertion: assertion(testCase.recorded, 'staff_record'),
  });
  const assessment = { ...assessed, ...(testCase.assessmentOverride || {}) };
  const policy = evaluateReviewerInstitutionAutoResolution({
    assessment,
    independentIdentity: independentIdentity(testCase.identity),
    additionalCoi: testCase.additionalCoi || 'not_screened',
    bindingState: testCase.bindingState || 'current',
    parentChildKind: testCase.parentChildKind || 'not_applicable',
    providerState: testCase.providerState || 'complete',
  });
  return { assessment, policy };
}

describe('reviewer institution auto-resolution policy regression v1', () => {
  test('fixture is PII-free, versioned, and covers every planned pattern', () => {
    expect(fixture.version).toBe('reviewer-institution-auto-resolution-regression/v1');
    expect(fixture.cases).toHaveLength(18);
    const serialized = JSON.stringify(fixture);
    expect(serialized).not.toMatch(/https?:\/\//i);
    expect(serialized).not.toMatch(/request(Id|Num|Number)|candidate(Key|Id)|sourceReference/i);
    expect(new Set(fixture.cases.map((item) => item.key)).size).toBe(fixture.cases.length);
  });

  test.each(fixture.cases)('$key: $pattern', (testCase) => {
    const { assessment, policy } = evaluate(testCase);
    expect(POLICY_VERSION).toBe('institution-affiliation-policy/v2');
    expect({
      relationship: assessment.relationship,
      institutionAction: policy.institutionAction,
      reason: policy.reason,
      finalCandidateEffect: policy.finalCandidateEffect,
      finalReason: policy.finalReason,
      remedies: policy.remedies,
    }).toEqual(testCase.expected);
  });

  test('a matching institution never rescues an insufficient identity', () => {
    const { assessment, policy } = evaluate(
      fixture.cases.find((item) => item.key === 'wrong_person_matching_institution'),
    );
    expect(assessment.relationship).toBe('same');
    expect(policy.institutionAction).toBe('clear_institution_concern');
    expect(policy.finalCandidateEffect).toBe('hold');
    expect(policy.finalReason).toBe('independent_identity_insufficient');
  });

  test('a contradicted v1 identity rejects even when the institution matches', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('contradicted'),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
    });
    expect(policy).toMatchObject({
      institutionAction: 'clear_institution_concern',
      finalCandidateEffect: 'reject',
      finalReason: 'independent_identity_contradicted',
      remedies: ['not_a_fit'],
    });
  });

  test.each([
    ['providerObservedAt', undefined],
    ['requestBinding', undefined],
    ['identityInputDigest', undefined],
    ['resolverVersion', 'independentReviewerIdentity@future'],
    ['providerState', 'partial'],
  ])('a v1 sufficient result with invalid %s fails closed', (field, value) => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient', { [field]: value }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('a contradicted result from a partial provider run cannot reject', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('contradicted', { providerState: 'partial' }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('neutrality is never reported as an institution clearance', () => {
    const neutralRows = fixture.cases
      .map((testCase) => ({ key: testCase.key, policy: evaluate(testCase).policy }))
      .filter(({ policy }) => policy.institutionEffect === 'neutral');
    expect(neutralRows.length).toBeGreaterThan(0);
    expect(neutralRows.every(({ policy }) => (
      policy.institutionAction !== 'clear_institution_concern'
    ))).toBe(true);
  });

  test.each([
    ['relationship', { assessment: { relationship: 'future_relationship' } }, 'unknown_relationship'],
    ['evidence context', { assessment: { evidenceContext: 'future_context' } }, 'unknown_evidence_context'],
    ['additional COI', { additionalCoi: 'future_coi' }, 'unknown_additional_coi'],
    ['binding state', { bindingState: 'future_binding' }, 'unknown_binding_state'],
    ['parent-child kind', { parentChildKind: 'future_parent_child' }, 'unknown_parent_child_kind'],
    ['provider state', { providerState: 'future_provider' }, 'unknown_provider_state'],
  ])('unknown %s fails closed', (_label, override, expectedReason) => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: { ...base.assessment, ...(override.assessment || {}) },
      independentIdentity: independentIdentity('sufficient'),
      additionalCoi: override.additionalCoi || 'not_screened',
      bindingState: override.bindingState || 'current',
      parentChildKind: override.parentChildKind || 'not_applicable',
      providerState: override.providerState || 'complete',
    });
    expect(policy).toMatchObject({
      institutionAction: 'block_invalid_contract',
      finalCandidateEffect: 'hold',
      reason: expectedReason,
    });
  });
});
