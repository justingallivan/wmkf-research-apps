const {
  assessAffiliationRelationship,
  evaluateAffiliationPolicy,
  relationshipBetween,
} = require('../../lib/services/institution-affiliation-assessment');

const IDS = {
  parent: 'https://ror.org/000000001',
  childA: 'https://ror.org/000000002',
  childB: 'https://ror.org/000000003',
  other: 'https://ror.org/000000004',
  successor: 'https://ror.org/000000005',
};

function resolved(sourceRorId, relationships = [], extra = {}) {
  return {
    status: 'resolved',
    sourceRorId,
    canonicalRorId: extra.canonicalRorId || sourceRorId,
    relationships,
    provider: 'fixture',
    confidence: 'adjudicated',
    ...extra,
  };
}

function assertion({
  text,
  sourceType = 'publication',
  currentness = 'current',
  authorSpecific = true,
  resolution,
  segments,
}) {
  return {
    rawText: text,
    sourceType,
    sourceReference: 'fixture:source',
    observedAt: '2026-01-01',
    currentness,
    authorSpecific,
    segments: segments || [{ rawText: text, resolution }],
  };
}

function assess({ left, right, leftCurrentness = 'current', rightCurrentness = 'current' }) {
  return assessAffiliationRelationship({
    evidenceAssertion: assertion({ text: 'Evidence institution', resolution: left, currentness: leftCurrentness }),
    recordedAssertion: assertion({ text: 'Recorded institution', sourceType: 'staff_record', resolution: right, currentness: rightCurrentness }),
  });
}

function identity(sufficient) {
  return {
    sufficient,
    excludesAffiliation: true,
    evaluatorVersion: 'fixture-independent-identity/v1',
    evidence: ['exact_orcid_and_name'],
  };
}

describe('source-aware institution relationship truth', () => {
  test('classifies exact source identity as same', () => {
    expect(relationshipBetween(resolved(IDS.childA), resolved(IDS.childA))).toMatchObject({
      relationship: 'same',
      reason: 'same_source_ror',
    });
  });

  test('retains parent/child direction', () => {
    expect(relationshipBetween(
      resolved(IDS.childA, [{ type: 'parent', rorId: IDS.parent }]),
      resolved(IDS.parent),
    )).toMatchObject({ relationship: 'parent_child', direction: 'left_child_of_right' });
  });

  test('supports an adjudicated subunit when the provider has no separate ROR entity', () => {
    expect(relationshipBetween(
      {
        status: 'resolved',
        sourceRorId: null,
        canonicalRorId: IDS.parent,
        organizationScope: 'subunit',
        parentRorId: IDS.parent,
        relationships: [],
      },
      resolved(IDS.parent),
    )).toMatchObject({ relationship: 'parent_child', direction: 'left_child_of_right' });
  });

  test('abstains when two unidentifiable subunits share the same parent', () => {
    const subunit = () => ({
      status: 'resolved',
      sourceRorId: null,
      canonicalRorId: IDS.parent,
      organizationScope: 'subunit',
      parentRorId: IDS.parent,
      relationships: [],
    });
    expect(relationshipBetween(subunit(), subunit())).toMatchObject({
      relationship: 'unresolved',
      reason: 'shared_parent_subunit_identity_unresolved',
    });
  });

  test('never collapses siblings sharing a parent', () => {
    expect(relationshipBetween(
      resolved(IDS.childA, [{ type: 'parent', rorId: IDS.parent }]),
      resolved(IDS.childB, [{ type: 'parent', rorId: IDS.parent }]),
    )).toMatchObject({ relationship: 'sibling', reason: 'shared_parent' });
  });

  test('canonical equality does not erase a source successor/predecessor relationship', () => {
    expect(relationshipBetween(
      resolved(IDS.successor, [{ type: 'predecessor', rorId: IDS.childA }], {
        canonicalRorId: IDS.childA,
      }),
      resolved(IDS.childA),
    )).toMatchObject({ relationship: 'related_other' });
  });

  test('a compatible segment survives an unresolved additional affiliation', () => {
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: assertion({
        text: 'Child A; Additional institute',
        segments: [
          { rawText: 'Child A', resolution: resolved(IDS.childA) },
          { rawText: 'Additional institute', role: 'additional', resolution: { status: 'unresolved', reason: 'no_candidates' } },
        ],
      }),
      recordedAssertion: assertion({
        text: 'Child A',
        sourceType: 'staff_record',
        resolution: resolved(IDS.childA),
      }),
    });
    expect(assessment).toMatchObject({
      relationship: 'same',
      evidenceContext: 'compatible_with_additional',
    });
    expect(assessment.additionalAffiliations).toHaveLength(1);
  });

  test('partial resolution cannot manufacture a distinct verdict', () => {
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: assertion({
        text: 'Other; unresolved',
        segments: [
          { rawText: 'Other', resolution: resolved(IDS.other) },
          { rawText: 'unresolved', resolution: { status: 'unresolved', reason: 'provider_failure' } },
        ],
      }),
      recordedAssertion: assertion({
        text: 'Child A',
        sourceType: 'staff_record',
        resolution: resolved(IDS.childA),
      }),
    });
    expect(assessment.relationship).toBe('unresolved');
  });
});

describe('author-specific evidence authority', () => {
  test.each([false, 'unknown'])('%p evidence cannot create a current-conflict veto', (authorSpecific) => {
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: assertion({
        text: 'Unattributed publication institution',
        authorSpecific,
        resolution: resolved(IDS.childA),
      }),
      recordedAssertion: assertion({
        text: 'Recorded institution',
        sourceType: 'staff_record',
        resolution: resolved(IDS.other),
      }),
    });
    expect(assessment).toMatchObject({
      relationship: 'distinct',
      evidenceContext: 'unresolved',
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_selectability',
      independentIdentity: identity(true),
    })).toMatchObject({
      effect: 'neutral',
      action: 'allow_if_other_identity_gates_pass',
      reason: 'unresolved',
    });
  });

  test('non-author-specific compatibility cannot add identity weight', () => {
    const assessment = assessAffiliationRelationship({
      evidenceAssertion: assertion({
        text: 'Unattributed publication institution',
        authorSpecific: false,
        resolution: resolved(IDS.childA),
      }),
      recordedAssertion: assertion({
        text: 'Recorded institution',
        sourceType: 'staff_record',
        resolution: resolved(IDS.childA),
      }),
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'identity_anchor',
      independentIdentity: identity(true),
    })).toMatchObject({
      effect: 'neutral',
      action: 'no_affiliation_weight',
      reason: 'unresolved',
    });
  });
});

describe('conditional-neutrality consumer policy', () => {
  test('current sibling conflict vetoes selectability even with independent identity', () => {
    const assessment = assess({
      left: resolved(IDS.childA, [{ type: 'parent', rorId: IDS.parent }]),
      right: resolved(IDS.childB, [{ type: 'parent', rorId: IDS.parent }]),
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_selectability',
      independentIdentity: identity(true),
    })).toMatchObject({ effect: 'veto', action: 'hold_for_identity_or_institution_correction' });
  });

  test('historical difference is neutral only when independent identity is sufficient', () => {
    const assessment = assess({
      left: resolved(IDS.other),
      right: resolved(IDS.childA),
      leftCurrentness: 'historical',
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'automated_write',
      independentIdentity: identity(true),
    }).action).toBe('allow_if_other_identity_gates_pass');
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'automated_write',
      independentIdentity: identity(false),
    })).toMatchObject({ effect: 'hold', action: 'hold_for_independent_identity' });
  });

  test('unresolved evidence is neutral with independent identity and held without it', () => {
    const assessment = assess({
      left: { status: 'unresolved', reason: 'no_candidates' },
      right: resolved(IDS.childA),
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_selectability',
      independentIdentity: identity(true),
    })).toMatchObject({ effect: 'neutral', action: 'allow_if_other_identity_gates_pass' });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_selectability',
      independentIdentity: identity(false),
    })).toMatchObject({ effect: 'hold', action: 'hold_for_independent_identity' });
  });

  test('missing affiliation-exclusion proof fails closed at a high-authority consumer', () => {
    const assessment = assess({
      left: { status: 'unresolved', reason: 'no_candidates' },
      right: resolved(IDS.childA),
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'automated_write',
      independentIdentity: { sufficient: true, excludesAffiliation: false, evaluatorVersion: 'bad' },
    })).toMatchObject({ effect: 'hold', reason: 'independent_identity_unavailable' });
  });

  test('provider failure yields a retry remedy instead of a mismatch claim', () => {
    const assessment = assess({
      left: { status: 'unresolved', reason: 'provider_failure' },
      right: resolved(IDS.childA),
    });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'candidate_card',
      independentIdentity: identity(false),
    })).toMatchObject({
      effect: 'hold',
      action: 'show_retry_hold',
      reason: 'provider_failure',
      remedies: ['retry_enrichment'],
    });
  });

  test('compatible affiliation corroborates identity but does not establish it', () => {
    const assessment = assess({ left: resolved(IDS.childA), right: resolved(IDS.childA) });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'identity_anchor',
      independentIdentity: identity(false),
    })).toMatchObject({ effect: 'corroborating_only', action: 'add_same_affiliation_weight' });
  });

  test('an unknown consumer fails closed', () => {
    const assessment = assess({ left: resolved(IDS.childA), right: resolved(IDS.childA) });
    expect(evaluateAffiliationPolicy({
      assessment,
      consumer: 'future_consumer',
      independentIdentity: identity(true),
    })).toMatchObject({ effect: 'hold', action: 'block_unknown_consumer' });
  });

  test('unknown relationship and context values fail closed at high-authority consumers', () => {
    expect(evaluateAffiliationPolicy({
      assessment: { relationship: 'future_relationship', evidenceContext: 'unresolved' },
      consumer: 'candidate_selectability',
      independentIdentity: identity(true),
    })).toMatchObject({ effect: 'hold', reason: 'unknown_relationship' });
    expect(evaluateAffiliationPolicy({
      assessment: { relationship: 'same', evidenceContext: 'future_context' },
      consumer: 'automated_write',
      independentIdentity: identity(true),
    })).toMatchObject({ effect: 'hold', reason: 'unknown_evidence_context' });
  });
});
