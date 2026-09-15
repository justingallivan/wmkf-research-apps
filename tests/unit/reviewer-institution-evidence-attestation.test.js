/** @jest-environment node */

import {
  createServerInstitutionEvidenceReceipt,
  hasServerInstitutionEvidenceReceipt,
  institutionEvidenceProjection,
  mintInstitutionEvidenceAttestation,
  projectAffiliationAssertions,
  reviewerInstitutionPhase2Enabled,
  verifyInstitutionEvidenceAttestation,
} from '../../lib/services/reviewer-institution-evidence-attestation';

const REQUEST = '11111111-1111-1111-1111-111111111111';
const NOW = new Date('2026-09-14T12:00:00.000Z');

function candidate() {
  return {
    candidateKey: 'candidate:bound-reviewer',
    name: 'Bound Reviewer',
    independentIdentity: {
      version: 'independent-identity/v1',
      result: 'sufficient',
      reason: 'pubmed_multi_work_author_bound',
      excludesAffiliation: true,
      method: 'pubmed_multi_work_author',
      resolverVersion: 'independentReviewerIdentity@1.0.0',
      requestBinding: REQUEST,
      candidateKey: 'candidate:bound-reviewer',
      identityInputDigest: 'a'.repeat(64),
      evidenceDigest: 'b'.repeat(64),
      evaluatedAt: '2026-09-14T12:00:00.000Z',
      providerObservedAt: '2026-09-14T12:00:00.000Z',
      expiresAt: '2026-09-28T12:00:00.000Z',
      providerState: 'complete',
      evidence: { rawProviderPayload: 'must not persist' },
    },
    affiliationAssertions: [{
      rawText: 'Department of Biology, Example University',
      sourceType: 'publication',
      sourceReference: 'pmid:123',
      observedAt: null,
      currentness: 'unknown',
      authorSpecific: true,
      publicationYear: 2025,
    }],
  };
}

let priorSecret;

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(NOW);
  priorSecret = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'reviewer-institution-evidence-test-secret';
});

afterEach(() => {
  jest.useRealTimers();
  if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET;
  else process.env.NEXTAUTH_SECRET = priorSecret;
});

test('flag is exact-on and defaults off', () => {
  expect(reviewerInstitutionPhase2Enabled({})).toBe(false);
  expect(reviewerInstitutionPhase2Enabled({ REVIEWER_INSTITUTION_PHASE2: 'true' })).toBe(false);
  expect(reviewerInstitutionPhase2Enabled({ REVIEWER_INSTITUTION_PHASE2: 'on' })).toBe(true);
});

test('projection is bounded and omits raw provider evidence', () => {
  const projection = institutionEvidenceProjection(candidate());
  expect(projection.independentIdentity).toMatchObject({
    result: 'sufficient',
    requestBinding: REQUEST,
  });
  expect(projection.independentIdentity).not.toHaveProperty('evidence');
  expect(projection.affiliationAssertions).toEqual([
    expect.objectContaining({ sourceReference: 'pmid:123', publicationYear: 2025 }),
  ]);
  expect(projection.affiliationAssertionsComplete).toBe(true);
});

test('an over-cap assertion set is bounded and explicitly marked incomplete', async () => {
  const value = candidate();
  value.affiliationAssertions = Array.from({ length: 25 }, (_, index) => ({
    rawText: `Institution ${index}`,
    sourceType: 'publication',
    sourceReference: `pmid:${index}`,
    observedAt: null,
    currentness: 'current',
    authorSpecific: true,
    publicationYear: 2026,
  }));
  const projection = institutionEvidenceProjection(value);
  expect(projection.affiliationAssertions).toHaveLength(24);
  expect(projection.affiliationAssertionsComplete).toBe(false);

  const token = await mintInstitutionEvidenceAttestation({ requestId: REQUEST, candidate: value });
  await expect(verifyInstitutionEvidenceAttestation(token, {
    requestId: REQUEST,
    candidate: value,
  })).resolves.toMatchObject({
    valid: true,
    affiliationAssertionsComplete: false,
  });
});

test('signed evidence survives transport but tampering and cross-request replay fail', async () => {
  const value = candidate();
  const token = await mintInstitutionEvidenceAttestation({ requestId: REQUEST, candidate: value });
  await expect(verifyInstitutionEvidenceAttestation(token, {
    requestId: REQUEST,
    candidate: value,
  })).resolves.toMatchObject({
    valid: true,
    independentIdentityBound: true,
    affiliationAssertionsBound: true,
  });

  await expect(verifyInstitutionEvidenceAttestation(token, {
    requestId: '22222222-2222-2222-2222-222222222222',
    candidate: value,
  })).resolves.toEqual({ valid: false, reason: 'claim_mismatch' });
  await expect(verifyInstitutionEvidenceAttestation(token, {
    requestId: REQUEST,
    candidate: {
      ...value,
      affiliationAssertions: [{
        ...value.affiliationAssertions[0],
        rawText: 'Applicant University',
      }],
    },
  })).resolves.toEqual({ valid: false, reason: 'claim_mismatch' });
});

test('outer receipt cannot rebind an independently issued identity result', async () => {
  const value = candidate();
  value.independentIdentity = {
    ...value.independentIdentity,
    requestBinding: '22222222-2222-2222-2222-222222222222',
  };
  await expect(mintInstitutionEvidenceAttestation({
    requestId: REQUEST,
    candidate: value,
  })).resolves.toBeNull();
  expect(createServerInstitutionEvidenceReceipt({
    requestId: REQUEST,
    candidate: value,
    expiresAt: value.independentIdentity.expiresAt,
  })).toBeNull();
});

test('stored receipt binds request, candidate, evidence, and expiry', () => {
  const value = candidate();
  const receipt = createServerInstitutionEvidenceReceipt({
    requestId: REQUEST,
    candidate: value,
    expiresAt: '2026-10-14T12:00:00.000Z',
  });
  const stored = { ...value, serverInstitutionEvidenceReceipt: receipt };
  expect(receipt.expiresAt).toBe(value.independentIdentity.expiresAt);
  expect(hasServerInstitutionEvidenceReceipt({ requestId: REQUEST, candidate: stored })).toBe(true);
  expect(hasServerInstitutionEvidenceReceipt({
    requestId: REQUEST,
    candidate: {
      ...stored,
      independentIdentity: { ...stored.independentIdentity, result: 'contradicted' },
    },
  })).toBe(false);
  expect(hasServerInstitutionEvidenceReceipt({
    requestId: REQUEST,
    candidate: stored,
    now: Date.parse(receipt.expiresAt),
  })).toBe(false);
});

test('invalid typed assertions are removed rather than normalized into authority', () => {
  expect(projectAffiliationAssertions([
    {
      rawText: 'Dangerous forged institution',
      sourceType: 'browser_claim',
      currentness: 'current',
      authorSpecific: true,
    },
    {
      rawText: 'Valid institution',
      sourceType: 'publication',
      currentness: 'unknown',
      authorSpecific: true,
      publicationYear: 2025,
    },
  ])).toEqual([expect.objectContaining({ rawText: 'Valid institution' })]);
});
