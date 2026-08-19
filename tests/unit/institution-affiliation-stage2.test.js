/**
 * @jest-environment node
 */

const {
  createInstitutionStage2Evaluator,
} = require('../../lib/services/institution-affiliation-stage2');

const IDS = {
  left: 'https://ror.org/000000001',
  right: 'https://ror.org/000000002',
};

function resolution(id, extra = {}) {
  return {
    status: 'resolved',
    sourceRorId: id,
    canonicalRorId: id,
    relationships: [],
    provider: 'fixture',
    confidence: 'adjudicated',
    ...extra,
  };
}

function resolverFor(resolutions) {
  return {
    resolve: jest.fn(async (assertion) => ({
      ...assertion,
      segments: resolutions[assertion.rawText] || [{
        rawText: assertion.rawText,
        resolution: { status: 'unresolved', reason: 'no_candidates', provider: 'fixture' },
      }],
    })),
  };
}

function assertion(rawText, overrides = {}) {
  return {
    rawText,
    sourceType: 'publication',
    sourceReference: 'fixture',
    observedAt: '2025-01-01',
    currentness: 'current',
    authorSpecific: true,
    ...overrides,
  };
}

function identity(sufficient = true) {
  return {
    sufficient,
    excludesAffiliation: true,
    evaluatorVersion: 'fixture/v1',
    evidence: ['orcid'],
  };
}

test('compatible card evidence clears the warning without changing a legacy hold', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{ rawText: 'Evidence', resolution: resolution(IDS.left) }],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.left) }],
    }),
  });

  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence'),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
    legacyHold: true,
  });

  expect(presentation).toMatchObject({
    visible: true,
    kind: 'compatible',
    heading: 'Affiliations appear compatible',
    legacyHold: true,
    remedies: ['confirm_identity', 'not_a_fit'],
  });
  expect(presentation.detail).toMatch(/still requires confirmation before Invite/);
});

test('a compatible card with no incumbent hold renders no institution notice', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{ rawText: 'Evidence', resolution: resolution(IDS.left) }],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.left) }],
    }),
  });
  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence'),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
  });
  expect(presentation).toMatchObject({ visible: false, kind: 'compatible' });
});

test('current distinct affiliations render exact correction remedies', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{ rawText: 'Evidence', resolution: resolution(IDS.left) }],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.right) }],
    }),
  });
  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence'),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
  });
  expect(presentation).toMatchObject({
    kind: 'current_conflict',
    heading: 'Current affiliations conflict',
    remedies: [
      'confirm_identity',
      'correct_current_institution',
      'record_joint_appointment',
      'not_a_fit',
    ],
  });
});

test('a compatible segment retains additional affiliation copy', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      'Evidence; Additional': [
        { rawText: 'Evidence', resolution: resolution(IDS.left) },
        { rawText: 'Additional', role: 'additional', resolution: resolution(IDS.right) },
      ],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.left) }],
    }),
  });
  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence; Additional'),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
  });
  expect(presentation).toMatchObject({
    visible: true,
    kind: 'additional',
    heading: 'Additional affiliation',
  });
  expect(presentation.detail).toMatch(/Additional/);
});

test('historical difference is informational rather than a mismatch', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{ rawText: 'Evidence', resolution: resolution(IDS.left) }],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.right) }],
    }),
  });
  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence', { currentness: 'historical' }),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
  });
  expect(presentation).toMatchObject({ kind: 'historical', tone: 'neutral' });
  expect(presentation.detail).toMatch(/No institution correction is required/);
  expect(presentation.detail).not.toMatch(/mismatch/i);
});

test('provider failure has retry copy and never claims mismatch', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{
        rawText: 'Evidence',
        resolution: { status: 'unresolved', reason: 'provider_failure', provider: 'fixture' },
      }],
      Recorded: [{ rawText: 'Recorded', resolution: resolution(IDS.right) }],
    }),
  });
  const { presentation } = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence'),
    recordedAssertion: assertion('Recorded', { sourceType: 'staff_record' }),
    consumer: 'candidate_card',
    independentIdentity: identity(),
  });
  expect(presentation).toMatchObject({
    kind: 'provider_failure',
    heading: 'Institution comparison unavailable',
    remedies: ['retry_enrichment'],
  });
  expect(presentation.detail).toMatch(/not a confirmed mismatch/i);
});

test('staff notification suppresses compatible pairs and reports historical pairs as information', async () => {
  const evaluator = createInstitutionStage2Evaluator({
    assertionResolver: resolverFor({
      Evidence: [{ rawText: 'Evidence', resolution: resolution(IDS.left) }],
      Same: [{ rawText: 'Same', resolution: resolution(IDS.left) }],
      Different: [{ rawText: 'Different', resolution: resolution(IDS.right) }],
    }),
  });
  const compatible = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence', { sourceType: 'reviewer_self_report' }),
    recordedAssertion: assertion('Same', { sourceType: 'staff_record' }),
    consumer: 'staff_notification',
  });
  expect(compatible.presentation).toMatchObject({ notify: false, kind: 'compatible' });

  const historical = await evaluator.evaluate({
    evidenceAssertion: assertion('Evidence', { currentness: 'historical' }),
    recordedAssertion: assertion('Different', { sourceType: 'staff_record' }),
    consumer: 'staff_notification',
  });
  expect(historical.presentation).toMatchObject({
    notify: true,
    kind: 'historical',
    severity: 'info',
  });
  expect(historical.presentation.detail).toMatch(/not a confirmed current mismatch/i);
});
