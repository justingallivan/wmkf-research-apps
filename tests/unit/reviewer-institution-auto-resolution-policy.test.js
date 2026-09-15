const crypto = require('node:crypto');
const fixture = require('../fixtures/reviewer-institution-auto-resolution/v1/policy-regression.json');
const { canonicalJson } = require('../../lib/utils/canonical-json');
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
const POLICY_NOW = '2026-09-14T19:00:00.000Z';
const EXPECTED_IDENTITY_BINDING = {
  requestBinding: 'request-1',
  candidateKey: 'candidate-1',
  identityInputDigest: 'a'.repeat(64),
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
  return independentIdentityV1(value);
}

function independentIdentityV1(result, overrides = {}) {
  const identity = {
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
  if (!Object.prototype.hasOwnProperty.call(overrides, 'evidenceDigest')) {
    identity.evidenceDigest = crypto
      .createHash('sha256')
      .update(canonicalJson(identity.evidence))
      .digest('hex');
  }
  return identity;
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
    expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
    now: POLICY_NOW,
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
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      institutionAction: 'clear_institution_concern',
      finalCandidateEffect: 'reject',
      finalReason: 'independent_identity_contradicted',
      remedies: ['not_a_fit'],
    });
  });

  test.each([
    ['providerObservedAt', undefined, 'independent_identity_unavailable'],
    ['requestBinding', undefined, 'independent_identity_binding_mismatch'],
    ['identityInputDigest', undefined, 'independent_identity_binding_mismatch'],
    ['evidenceDigest', undefined, 'independent_identity_unavailable'],
    ['resolverVersion', 'independentReviewerIdentity@future', 'independent_identity_unavailable'],
    ['providerState', 'partial', 'independent_identity_unavailable'],
  ])('a v1 sufficient result with invalid %s fails closed', (field, value, finalReason) => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient', { [field]: value }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason,
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
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('an expired v1 receipt cannot authorize a decision', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient'),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: '2026-09-29T00:00:00.000Z',
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_expired',
    });
  });

  test('a future-dated receipt cannot authorize a decision', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient', {
        evaluatedAt: '2026-09-15T18:00:00.000Z',
        providerObservedAt: '2026-09-15T18:00:00.000Z',
        expiresAt: '2026-09-29T18:00:00.000Z',
      }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('a receipt beyond the maximum TTL cannot authorize a decision', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient', {
        expiresAt: '2026-09-28T18:00:00.001Z',
      }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('tampered evidence cannot retain authority under a stale evidence digest', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient', {
        evidence: { substituted: true },
        evidenceDigest: '0'.repeat(64),
      }),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_unavailable',
    });
  });

  test('a receipt for another candidate cannot authorize a decision', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: independentIdentityV1('sufficient'),
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: { ...EXPECTED_IDENTITY_BINDING, candidateKey: 'candidate-2' },
      now: POLICY_NOW,
    });
    expect(policy).toMatchObject({
      finalCandidateEffect: 'hold',
      finalReason: 'independent_identity_binding_mismatch',
    });
  });

  test('the legacy boolean identity shape has no authority', () => {
    const base = evaluate(fixture.cases.find((item) => item.key === 'exact_alias'));
    const policy = evaluateReviewerInstitutionAutoResolution({
      assessment: base.assessment,
      independentIdentity: {
        sufficient: true,
        excludesAffiliation: true,
        evaluatorVersion: 'synthetic-independent-identity/v1',
      },
      additionalCoi: 'not_screened',
      bindingState: 'current',
      parentChildKind: 'not_applicable',
      providerState: 'complete',
      expectedIdentityBinding: EXPECTED_IDENTITY_BINDING,
      now: POLICY_NOW,
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
