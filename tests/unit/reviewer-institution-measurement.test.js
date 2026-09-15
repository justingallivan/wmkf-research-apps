/** @jest-environment node */

const sqlMock = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (...args) => sqlMock(...args) }));

const {
  recordInstitutionMeasurement,
  classifiedOutcome,
  _internals,
} = require('../../lib/services/reviewer-institution-measurement');

const requestId = '11111111-1111-1111-1111-111111111111';
const candidate = {
  candidateKey: 'suggestion:abc',
  name: 'Example Person',
  email: 'private@example.edu',
  suggestedInstitution: 'Named University',
  affiliation: 'Named University School of Medicine',
  institutionMismatch: true,
  provenance: { kind: 'applicant_suggested' },
};
const assessment = {
  relationship: 'parent_child',
  evidenceContext: 'compatible_with_additional',
  evidenceAssertion: {
    sourceType: 'publication', currentness: 'historical', authorSpecific: true,
    rawText: 'Sensitive byline', sourceReference: '123456',
  },
  recordedAssertion: {
    sourceType: 'staff_record', currentness: 'unknown', rawText: 'Sensitive record',
  },
  additionalAffiliations: [{ rawText: 'Another Sensitive Affiliation' }],
};

beforeEach(() => {
  process.env.REVIEWER_INSTITUTION_MEASUREMENT = 'on';
  _internals.resetBreaker();
  sqlMock.mockReset();
  sqlMock.mockResolvedValue({ rowCount: 1 });
});
afterEach(() => {
  delete process.env.REVIEWER_INSTITUTION_MEASUREMENT;
  jest.restoreAllMocks();
});

test('trusted producer stores only enumerated provenance and digests, never raw identity or assertion text', async () => {
  expect(await recordInstitutionMeasurement({
    requestId, candidate, eventType: 'roster_upsert', captureSource: 'server_applicant',
    assessment, legacyHold: true,
  })).toBe('inserted');
  const values = sqlMock.mock.calls[0].slice(1);
  expect(values[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(values[1]).toMatch(/^[a-f0-9]{64}$/);
  expect(values).toContain('parent_child');
  expect(values).toContain('compatible_with_additional');
  expect(values).toContain('not_evaluable');
  expect(values).toContain('not_screened');
  const stored = JSON.stringify(values);
  for (const secret of ['Example Person', 'private@example.edu', 'Named University',
    'Sensitive byline', 'Sensitive record', 'Another Sensitive Affiliation', requestId, 'suggestion:abc', '123456']) {
    expect(stored).not.toContain(secret);
  }
});

test('unverified roster content cannot manufacture a relationship or legacy hold', async () => {
  const row = _internals.buildRow({
    requestId, candidate, eventType: 'roster_upsert', captureSource: 'roster_unverified',
    assessment, legacyHold: true,
  });
  expect(row.relationship).toBeNull();
  expect(row.legacyHold).toBeNull();
  expect(row.evidenceSourceType).toBeNull();
  expect(row.proposedAction).toBe('not_evaluable');
});

test('unknown event/source and disabled flag insert nothing', async () => {
  expect(await recordInstitutionMeasurement({ requestId, candidate, eventType: 'auto_clear', captureSource: 'server_applicant' })).toBe('skipped');
  process.env.REVIEWER_INSTITUTION_MEASUREMENT = 'warn';
  expect(await recordInstitutionMeasurement({ requestId, candidate, eventType: 'roster_upsert', captureSource: 'server_applicant' })).toBe('disabled');
  expect(sqlMock).not.toHaveBeenCalled();
});

test('database failure is non-authoritative and save errors use bounded categories', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  sqlMock.mockRejectedValue(new Error('private database detail'));
  await expect(recordInstitutionMeasurement({ requestId, candidate, eventType: 'save_rejected', captureSource: 'stored_roster' })).resolves.toBe('failed');
  expect(classifiedOutcome('identity_unresolved')).toBe('identity_hold');
  expect(classifiedOutcome('identity_unavailable')).toBe('identity_hold');
  expect(classifiedOutcome('institution_coi')).toBe('institution_coi');
  expect(classifiedOutcome('address_verification_required')).toBe('contact_hold');
  expect(classifiedOutcome('conflict_record_unavailable')).toBe('contact_hold');
  expect(classifiedOutcome('applicant_excluded')).toBe('stale_or_invalid');
  expect(classifiedOutcome('private arbitrary error')).toBe('other');
});
