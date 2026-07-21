/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/save-candidates-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — the partial-success
 * batch semantics at the service layer, adapters mocked: all-rejected 422
 * body (both rejected counts ALWAYS present), nothing-saved 500 body
 * (rejected* keys conditional), mixed-batch 200 with conditional
 * rejected-count and errors keys, and per-candidate failure isolation. The deep
 * identity/COI/persist-gate branches stay covered by
 * tests/unit/reviewer-route-identity-gate.test.js through the route.
 * Duplicate correlation keys are rejected per row before any adapter write.
 */

jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: jest.fn(async () => ({ id: 'PID-1' })),
  getById: jest.fn(async () => ({ wmkf_primaryaffiliation: 'MIT' })),
  getByEmail: jest.fn(async () => null),
  setContactLink: jest.fn(async () => ({ action: 'link' })),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getInstitutionById: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  getById: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(async () => ({ id: 'PID-1' })),
  writeIdentityDecision: jest.fn(async () => undefined),
  clearIdentityFields: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  upsert: jest.fn(async () => ({ id: 'S1' })),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  stampSuggestionAnchor: jest.fn(async () => ({ updated: 1 })),
  findIdentityConfirmation: jest.fn(async () => null),
  findEligibilityByCandidateKey: jest.fn(async () => null),
}));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  verifyAutomatedIdentityAttestation: jest.fn(async () => ({ valid: true, source: 'automated_resolver' })),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(async () => ({ outcome: 'none' })),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadCoiContext: jest.fn(async () => ({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  })),
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  createInstitutionIdentityResolver: jest.fn(() => ({
    resolve: jest.fn(async () => null),
  })),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const contactAdapter = require('../../lib/dataverse/adapters/contact');
const accountAdapter = require('../../lib/dataverse/adapters/account');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const reviewerRosterStore = require('../../lib/services/reviewer-roster-store');
const { verifyAutomatedIdentityAttestation } = require('../../lib/services/reviewer-candidate-attestation');
const { lookupReviewerIdentity } = require('../../lib/services/reviewer-identity-lookup');
const { loadCoiContext } = require('../../lib/services/reviewer-request-context');
const { createInstitutionIdentityResolver } = require('../../lib/services/institution-identity-resolver');
const { ServiceHttpError } = require('../../lib/services/service-http-error');
const { VERIFICATION_STATUSES } = require('../../lib/services/discovery/constants');
const {
  saveCandidates,
  SaveCandidatesError,
  validateCandidateInput,
} = require('../../lib/services/reviewer-finder/save-candidates-service');

const BASE = { requestId: 'REQ-1', actingUserSystemId: 'SYS-1' };

beforeEach(() => {
  jest.clearAllMocks();
  potentialReviewerAdapter.getByEmail.mockResolvedValue(null);
  potentialReviewerAdapter.getById.mockResolvedValue({ wmkf_primaryaffiliation: 'MIT' });
  potentialReviewerAdapter.upsertByEmail.mockResolvedValue({ id: 'PID-1' });
  contactAdapter.getInstitutionById.mockResolvedValue(null);
  accountAdapter.getById.mockResolvedValue(null);
  reviewerSuggestionAdapter.upsert.mockResolvedValue({ id: 'S1' });
  lookupReviewerIdentity.mockResolvedValue({ outcome: 'none' });
  loadCoiContext.mockResolvedValue({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  });
});

test('422 SaveCandidatesError with the full body (both rejected counts always present) when ALL rows are rejected', async () => {
  const err = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Unresolved', needsIdentification: true },
      { name: 'Dr COI', hasInstitutionCOI: true },
    ],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toEqual({
    error: 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
    success: false,
    savedCount: 0,
    savedNames: [],
    savedKeys: [],
    totalRequested: 2,
    rejectedInvalid: 0,
    rejectedUnresolved: 1,
    rejectedInstitutionCOI: 1,
    rejectedIneligible: 0,
    errors: [
      {
        name: 'Dr Unresolved',
        candidateKey: expect.any(String),
        index: 0,
        error: 'Candidate identity is unresolved (needs identity review); not saved.',
        code: 'identity_unresolved',
      },
      {
        name: 'Dr COI',
        candidateKey: expect.any(String),
        index: 1,
        error: 'Candidate is at the proposal PI’s institution (institution COI); not saved.',
        code: 'institution_coi',
      },
    ],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test('direct deceased evidence is rejected before any Dataverse write', async () => {
  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Deceased', eligibilityStatus: 'deceased' }],
  }).catch((error) => error);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedIneligible: 1,
    errors: [expect.objectContaining({
      name: 'Dr Deceased',
      code: 'candidate_ineligible',
    })],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('durable eligibility lookup uses the signed pre-enrichment roster key', async () => {
  verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
    valid: true,
    source: 'automated_resolver',
    eligibilityStatus: 'unknown',
    rosterCandidateKey: 'candidate:pre-enrichment',
  });
  reviewerRosterStore.findEligibilityByCandidateKey.mockResolvedValueOnce({
    rosterStatus: 'ineligible',
    eligibilityStatus: 'deceased',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Changed',
      candidateKey: 'candidate:pre-enrichment',
      email: 'new.email@example.edu',
      affiliation: 'New University',
      automatedIdentityAttestation: 'signed',
    }],
  }).catch((error) => error);

  expect(reviewerRosterStore.findEligibilityByCandidateKey)
    .toHaveBeenCalledWith(BASE.requestId, 'candidate:pre-enrichment');
  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.body).toMatchObject({ rejectedIneligible: 1 });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test.each([
  ['missing', { valid: false, reason: 'no_token' }],
  ['legacy receipt without a signed roster key', { valid: true, source: 'automated_resolver' }],
])('roster-managed candidate fails closed with %s eligibility receipt', async (_label, receipt) => {
  verifyAutomatedIdentityAttestation.mockResolvedValueOnce(receipt);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Managed',
      candidateKey: 'candidate:pre-enrichment',
      eligibilityStatus: 'unknown',
      automatedIdentityAttestation: receipt.valid ? 'legacy-signed' : null,
    }],
  }).catch((error) => error);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    rejectedUnresolved: 1,
    errors: [expect.objectContaining({ code: 'identity_attestation_required' })],
  });
  expect(reviewerRosterStore.findEligibilityByCandidateKey).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('500 SaveCandidatesError when nothing saved for non-rejection reasons; rejected* keys stay undefined', async () => {
  potentialReviewerAdapter.upsertByEmail.mockRejectedValue(new Error('Dataverse write failed'));
  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Fails' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(500);
  expect(err.body).toMatchObject({
    error: 'No candidates were saved.',
    success: false,
    savedCount: 0,
    savedNames: [],
    savedKeys: [],
    totalRequested: 1,
    errors: [expect.objectContaining({
      name: 'Dr Fails',
      candidateKey: expect.any(String),
      index: 0,
      error: 'Dataverse write failed',
    })],
  });
  expect(err.body.rejectedInvalid).toBeUndefined();
  expect(err.body.rejectedUnresolved).toBeUndefined();
  expect(err.body.rejectedInstitutionCOI).toBeUndefined();
});

test('500 body includes a rejected count when the batch mixed rejections and failures (still zero saved)', async () => {
  potentialReviewerAdapter.upsertByEmail.mockRejectedValue(new Error('boom'));
  const err = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Unresolved', needsIdentification: true },
      { name: 'Dr Fails' },
    ],
  }).catch((e) => e);

  expect(err.httpStatus).toBe(500);
  expect(err.body.rejectedUnresolved).toBe(1);
  expect(err.body.rejectedInstitutionCOI).toBeUndefined();
  expect(err.body.errors).toHaveLength(2);
});

test('clean full success: 200 payload with NO rejected*/errors keys (undefined-valued, dropped at serialization)', async () => {
  const out = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr X', email: 'x@mit.edu' }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr X'],
    savedKeys: [expect.stringContaining('candidate:x|')],
    totalRequested: 1,
  });
  expect(out.rejectedInvalid).toBeUndefined();
  expect(out.rejectedUnresolved).toBeUndefined();
  expect(out.rejectedInstitutionCOI).toBeUndefined();
  expect(out.errors).toBeUndefined();
  // Conditional keys are present-but-undefined, so res.json drops them.
  expect(JSON.parse(JSON.stringify(out))).toEqual({
    success: true,
    savedCount: 1,
    savedNames: ['Dr X'],
    savedKeys: [expect.stringContaining('candidate:x|')],
    totalRequested: 1,
  });
});

test('per-row validation rejects malformed rows before any adapter write', async () => {
  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Valid', email: 'valid@example.edu' },
      { name: '', email: 'missing-name@example.edu' },
      { name: 'Dr Invalid Status', identityStatus: 'staff_says_yes' },
    ],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr Valid'],
    rejectedInvalid: 2,
  });
  expect(out.savedKeys).toHaveLength(1);
  expect(out.errors).toEqual([
    expect.objectContaining({ index: 1, code: 'invalid_candidate', candidateKey: null }),
    expect.objectContaining({ index: 2, code: 'invalid_candidate' }),
  ]);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledTimes(1);
});

test.each(Object.values(VERIFICATION_STATUSES))(
  'top-level discovery identityStatus %s is accepted by candidate validation',
  (identityStatus) => {
    expect(validateCandidateInput({ name: `Dr ${identityStatus}`, identityStatus }, 0)).toMatchObject({ ok: true });
  },
);

test('PubMed-verified discovery candidate saves without broadening the nested resolver vocabulary', async () => {
  const sheena = {
    name: 'Sheena Radford',
    email: 's.e.radford@leeds.ac.uk',
    affiliation: 'University of Leeds',
    verified: true,
    verificationStatus: VERIFICATION_STATUSES.VERIFIED,
    identityStatus: VERIFICATION_STATUSES.VERIFIED,
    verificationSource: 'pubmed',
    emailSource: 'pubmed',
    publications: 17,
    hIndex: 96,
    totalCitations: 32094,
  };

  const out = await saveCandidates({ ...BASE, candidates: [sheena] });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Sheena Radford'],
    totalRequested: 1,
  });
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledTimes(1);
  expect(validateCandidateInput({
    name: 'Nested discovery status',
    contactEnrichment: { identity: { status: VERIFICATION_STATUSES.VERIFIED } },
  }, 0)).toMatchObject({
    ok: false,
    error: { error: 'contactEnrichment.identity.status is not supported.' },
  });
});

test('duplicate candidate keys are rejected per row without graduating the failed sibling', async () => {
  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr First', email: 'first@example.edu', clientCandidateId: 'duplicate-1' },
      { name: 'Dr Second', email: 'second@example.edu', clientCandidateId: 'duplicate-1' },
    ],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr First'],
    savedKeys: ['client:duplicate-1'],
    rejectedInvalid: 1,
    errors: [{
      name: 'Dr Second',
      candidateKey: 'client:duplicate-1',
      index: 1,
      code: 'invalid_candidate',
      error: 'Duplicate candidate correlation key in this save request.',
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalledTimes(1);
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledTimes(1);
});

test('all malformed rows return 422 with stable validation correlations', async () => {
  const err = await saveCandidates({
    ...BASE,
    candidates: [null, { name: 'Dr Bad Identity', contactEnrichment: { identity: { status: 'invented' } } }],
  }).catch((error) => error);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    error: 'Selected candidates were not saved; see row errors for invalid or ineligible candidates.',
    success: false,
    savedCount: 0,
    savedKeys: [],
    rejectedInvalid: 2,
  });
  expect(err.body.errors).toEqual([
    expect.objectContaining({ index: 0, code: 'invalid_candidate', candidateKey: null }),
    expect.objectContaining({ index: 1, code: 'invalid_candidate', candidateKey: expect.any(String) }),
  ]);
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
});

test('candidate validation bounds nested identity payloads', () => {
  expect(validateCandidateInput({
    name: 'Dr Too Many Anchors',
    contactEnrichment: { identity: { status: 'probable', anchors: Array.from({ length: 51 }, () => ({})) } },
  }, 4)).toMatchObject({
    ok: false,
    error: { index: 4, code: 'invalid_candidate' },
  });
});

test('failed PI resolution rejects fail-closed before writes', async () => {
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    piResolution: { state: 'failed', reason: 'contact_read_failed', error: 'contact read down' },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr PI Unscreened', email: 'pi-safe@example.edu', affiliation: 'Different University' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toEqual({
    error: 'Could not verify institution conflicts right now (PI institution lookup temporarily unavailable). Please retry.',
    code: 'pi_institution_lookup_unavailable',
    retryable: true,
    reason: 'contact_read_failed',
    requestId: BASE.requestId,
  });
  expect(err.body.error).not.toMatch(/COI|at the PI.?s institution/i);
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(contactAdapter.getInstitutionById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test.each([
  [400, 'requestId is not a valid GUID'],
  [404, 'Request REQ-404 was not found'],
])('loadCoiContext statusCode %i is normalized to SaveCandidatesError before writes', async (statusCode, message) => {
  const sourceError = new Error(message);
  sourceError.statusCode = statusCode;
  loadCoiContext.mockRejectedValueOnce(sourceError);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Context', email: 'context@example.edu', affiliation: 'Different University' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(statusCode);
  expect(err.body).toEqual({ error: message });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(contactAdapter.getInstitutionById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test('loadCoiContext ServiceHttpError is preserved as-is before writes', async () => {
  const sourceError = new ServiceHttpError('Applicant institution context is unavailable', {
    httpStatus: 503,
    body: { error: 'Applicant institution context is unavailable', retryable: true },
  });
  loadCoiContext.mockRejectedValueOnce(sourceError);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Applicant Context', email: 'applicant-context@example.edu' }],
  }).catch((e) => e);

  expect(err).toBe(sourceError);
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test('loadCoiContext plain error without statusCode remains unexpected for the route 500 path', async () => {
  const sourceError = new Error('context loader exploded');
  loadCoiContext.mockRejectedValueOnce(sourceError);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Plain Context', email: 'plain-context@example.edu' }],
  }).catch((e) => e);

  expect(err).toBe(sourceError);
  expect(err).not.toBeInstanceOf(SaveCandidatesError);
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test('clean no-PI resolution state still saves a safe candidate', async () => {
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    piResolution: { state: 'ok', reason: 'no_project_leader' },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr No PI', email: 'nopi@example.edu', affiliation: 'Different University' }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr No PI'],
    totalRequested: 1,
  });
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
});

test('threads the gate-fetched email reuse row into upsertByEmail on a safe reuse', async () => {
  const existingReviewer = {
    wmkf_potentialreviewersid: 'PID-SAFE',
    wmkf_emailaddress: 'safe@example.edu',
    wmkf_primaryaffiliation: 'Different University',
  };
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(existingReviewer);
  potentialReviewerAdapter.upsertByEmail.mockResolvedValueOnce({
    id: 'PID-SAFE',
    created: false,
    reusedAffiliation: 'Different University',
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Safe Reuse',
      email: 'safe@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(out.savedCount).toBe(1);
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledTimes(1);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr Safe Reuse',
      email: 'safe@example.edu',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: existingReviewer },
  );
  expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalledWith(
    'PID-SAFE',
    expect.objectContaining({ name: 'Dr Safe Reuse' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ potentialReviewerId: 'PID-SAFE' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('threads a checked email miss into upsertByEmail so the write path cannot re-read a drifted row', async () => {
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Checked Miss',
      email: 'miss@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledTimes(1);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr Checked Miss',
      email: 'miss@example.edu',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: null },
  );
});

test('mixed partial success: saved rows kept, rejected/failed rows accumulate their conditional keys', async () => {
  potentialReviewerAdapter.upsertByEmail.mockImplementation(async ({ name }) => {
    if (name === 'Dr Fails') throw new Error('adapter down');
    return { id: 'PID-1' };
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Saved', email: 'ok@mit.edu' },
      { name: 'Dr Unresolved', identityStatus: 'unresolved' },
      { name: 'Dr COI', hasInstitutionCOI: true },
      { name: 'Dr Fails' },
    ],
  });

  expect(out.success).toBe(true);
  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr Saved']);
  expect(out.totalRequested).toBe(4);
  expect(out.rejectedUnresolved).toBe(1);
  expect(out.rejectedInstitutionCOI).toBe(1);
  expect(out.errors).toEqual([
    expect.objectContaining({
      name: 'Dr Unresolved', code: 'identity_unresolved', index: 1, candidateKey: expect.any(String),
    }),
    expect.objectContaining({
      name: 'Dr COI', code: 'institution_coi', index: 2, candidateKey: expect.any(String),
    }),
    expect.objectContaining({
      name: 'Dr Fails', error: 'adapter down', index: 3, candidateKey: expect.any(String),
    }),
  ]);
});

test('a late per-candidate failure (suggestion upsert) does not abort the batch or unmark earlier saves', async () => {
  reviewerSuggestionAdapter.upsert
    .mockResolvedValueOnce({ id: 'S1' })
    .mockRejectedValueOnce(new Error('suggestion write failed'));

  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr First', email: 'a@mit.edu' },
      { name: 'Dr Second', email: 'b@mit.edu' },
    ],
  });

  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr First']);
  expect(out.errors).toEqual([expect.objectContaining({
    name: 'Dr Second',
    candidateKey: expect.any(String),
    index: 1,
    error: 'suggestion write failed',
  })]);
});

test.each([
  ['Broad Institute', 'The Broad Institute'],
  ['HHMI', 'Howard Hughes Medical Institute'],
])('shared exempt institution %s remains visible but does not block save', async (
  candidateAffiliation,
  piAffiliation,
) => {
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: [piAffiliation] },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{ identity: piAffiliation, display: piAffiliation }],
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: `Dr ${candidateAffiliation}`,
      email: 'shared@example.edu',
      affiliation: candidateAffiliation,
      hasInstitutionCOI: true,
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
  });
  expect(out.rejectedInstitutionCOI).toBeUndefined();
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
});

test('server-resolved distinct institution ids clear a stale client COI flag', async () => {
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: ['University of Michigan'] },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{
      identity: 'University of Michigan',
      display: 'University of Michigan',
    }],
  });
  createInstitutionIdentityResolver.mockReturnValueOnce({
    resolve: jest.fn(async (name) => (
      name === 'University of Michigan Ann Arbor'
        ? {
            openAlexId: 'I111111111',
            ror: null,
            displayName: name,
          }
        : {
            openAlexId: 'I222222222',
            ror: null,
            displayName: name,
          }
    )),
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Refuted COI',
      email: 'refuted@example.edu',
      affiliation: 'University of Michigan Ann Arbor',
      hasInstitutionCOI: true,
      contactEnrichment: {
        coiRecomputed: true,
        hasInstitutionCOI: true,
      },
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr Refuted COI'],
  });
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
});

test('pre-existing distinct institution ids clear a stale client COI flag', async () => {
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: ['Example University'] },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{
      identity: {
        name: 'Example University',
        openAlexId: 'I222222222',
      },
      display: 'Example University',
    }],
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Existing ID Refutation',
      email: 'existing-id-refutation@example.edu',
      affiliation: 'Example University',
      affiliationOpenAlexId: 'I111111111',
      hasInstitutionCOI: true,
      contactEnrichment: {
        coiRecomputed: true,
        hasInstitutionCOI: true,
      },
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr Existing ID Refutation'],
  });
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
});

test('institution resolver abstention preserves the lexical COI hard block', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: { state: 'complete', names: ['University of Michigan'] },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{
      identity: 'University of Michigan',
      display: 'University of Michigan',
    }],
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Unresolved COI',
      email: 'unresolved-coi@example.edu',
      affiliation: 'University of Michigan Ann Arbor',
      hasInstitutionCOI: true,
    }],
  }).catch((error) => error);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Unresolved COI',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'candidate_payload',
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('direct shared MIT affiliation hard-blocks even when the payload also has exempt Broad affiliation', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  loadCoiContext.mockResolvedValueOnce({
    applicantInstitutionContext: {
      state: 'complete',
      names: ['Broad Institute', 'MIT'],
    },
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [
      { identity: 'Broad Institute', display: 'Broad Institute' },
      { identity: 'MIT', display: 'MIT' },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-DUAL',
    wmkf_primaryaffiliation: 'Massachusetts Institute of Technology',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Broad and MIT',
      email: 'dual@example.edu',
      affiliation: 'Broad Institute',
      hasInstitutionCOI: true,
    }],
  }).catch((error) => error);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      decisionSource: 'server_reviewer_identity_affiliation',
      institutionCOIDetails: {
        piInstitution: 'MIT',
        reviewerInstitution: 'Massachusetts Institute of Technology',
      },
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('server recomputes institution COI from the reused reviewer CRM affiliation (getByEmail) before any save write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // The write would reuse an existing reviewer by email (upsertByEmail { existing });
  // the gate evaluates THAT reuse target's CRM affiliation, not the payload's.
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-EXISTING',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr CRM Affiliation',
      email: 'crm@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr CRM Affiliation',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
      institutionCOIDetails: expect.objectContaining({
        piInstitution: 'Applicant University',
        reviewerInstitution: 'Applicant University',
      }),
    }],
  });
  expect(lookupReviewerIdentity).toHaveBeenCalledWith({
    name: 'Dr CRM Affiliation',
    email: 'crm@example.edu',
    orcid: null,
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    '[save-candidates] server_recomputed_institution_coi_rejected',
    expect.objectContaining({
      requestId: BASE.requestId,
      candidateName: 'Dr CRM Affiliation',
      decisionSource: 'server_reviewer_identity_affiliation',
    }),
  );
  warn.mockRestore();
});

test('name-only namesake at the applicant institution does NOT block a distinct new reviewer (viaNameMatch excluded)', async () => {
  // The lookup surfaced a same-name existing reviewer at the applicant institution
  // via a fallback NAME search only (viaNameMatch:true). Persistence creates a NEW
  // reviewer (new email → getByEmail null, no reuse) and never reuses the namesake,
  // so its CRM affiliation must NOT trigger a false institution COI.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'reviewer', matchKey: 'name', reviewerId: 'PID-NAMESAKE', context: { affiliation: 'Applicant University' } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-NAMESAKE', affiliation: 'Applicant University', viaNameMatch: true },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const out = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Namesake', email: 'new@safe.edu', affiliation: 'Safe University' }],
  });

  expect(out.success).toBe(true);
  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr Namesake']);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  // The weak namesake id is not a reuse/link target — it was never read by id.
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
});

test('an EXACT (viaNameMatch:false) referenced reviewer at the applicant institution still fails COI even with no email reuse target', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // A strong identity reference (email/ORCID/link, viaNameMatch:false) is a real
  // reuse/link target and must stay screened — the fix narrows ONLY weak namesakes.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'reviewer', matchKey: 'email', reviewerId: 'PID-EMAILMATCH', context: { affiliation: 'Applicant University' } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-EMAILMATCH', affiliation: 'Applicant University', viaNameMatch: false },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Strong', email: 'strong@example.edu', affiliation: 'Safe University' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ savedCount: 0, rejectedInstitutionCOI: 1 });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('confident contact-only email match at the applicant institution fails COI before link/write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-APPLICANT', viaNameMatch: false }],
    match: {
      reviewerId: null,
      contactId: 'CONTACT-APPLICANT',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: null },
    },
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-APPLICANT',
    adx_organizationname: 'Applicant University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Contact Applicant',
      email: 'contact-applicant@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Contact Applicant',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-APPLICANT');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('confident contact-only different-institution match saves and links', async () => {
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-SAFE', viaNameMatch: false }],
    match: {
      reviewerId: null,
      contactId: 'CONTACT-SAFE',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: null },
    },
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-SAFE',
    adx_organizationname: 'Different University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Contact Safe',
      email: 'contact-safe@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr Contact Safe'],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-SAFE');
  expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith(
    'PID-1',
    'CONTACT-SAFE',
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('confident contact institution lookup failure rejects fail-closed before link/write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-DOWN', viaNameMatch: false }],
    match: {
      reviewerId: null,
      contactId: 'CONTACT-DOWN',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: null },
    },
  });
  contactAdapter.getInstitutionById.mockRejectedValueOnce(new Error('contact read down'));
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Contact Down',
      email: 'contact-down@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Contact Down',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_contact_institution_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-mismatch conflict contact at the applicant institution fails COI before write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'email_mismatch',
    details: { contactId: 'CONTACT-CONFLICT-APPLICANT' },
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-CONFLICT-APPLICANT', viaNameMatch: false }],
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-CONFLICT-APPLICANT',
    adx_organizationname: 'Applicant University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Conflict Contact Applicant',
      email: 'conflict-contact@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict Contact Applicant',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-CONFLICT-APPLICANT');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-mismatch conflict contact at a different institution saves without linking', async () => {
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'email_mismatch',
    details: { contactId: 'CONTACT-CONFLICT-SAFE' },
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-CONFLICT-SAFE', viaNameMatch: false }],
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-CONFLICT-SAFE',
    adx_organizationname: 'Different University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Conflict Contact Safe',
      email: 'conflict-safe@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr Conflict Contact Safe'],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-CONFLICT-SAFE');
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
});

test('conflict contact institution lookup failure rejects fail-closed before write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'orcid_email_split',
    details: { orcidContactId: 'CONTACT-CONFLICT-DOWN' },
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-CONFLICT-DOWN', viaNameMatch: false }],
  });
  contactAdapter.getInstitutionById.mockRejectedValueOnce(new Error('contact read down'));
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Conflict Contact Down',
      email: 'conflict-down@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict Contact Down',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_contact_institution_lookup_failed',
    }],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-CONFLICT-DOWN');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('confident contact with no CRM institution signal saves and links', async () => {
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-NO-INSTITUTION', viaNameMatch: false }],
    match: {
      reviewerId: null,
      contactId: 'CONTACT-NO-INSTITUTION',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: null },
    },
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-NO-INSTITUTION',
    adx_organizationname: ' ',
    _parentcustomerid_value: null,
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Contact No Institution',
      email: 'contact-none@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(out.savedCount).toBe(1);
  expect(accountAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).toHaveBeenCalledWith(
    'PID-1',
    'CONTACT-NO-INSTITUTION',
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('confident contact with parent-account institution at the applicant institution fails COI', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [],
    referencedContacts: [{ contactId: 'CONTACT-PARENT', viaNameMatch: false }],
    match: {
      reviewerId: null,
      contactId: 'CONTACT-PARENT',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: null },
    },
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-PARENT',
    adx_organizationname: ' ',
    _parentcustomerid_value: 'ACCOUNT-APPLICANT',
  });
  accountAdapter.getById.mockResolvedValueOnce({ name: 'Applicant University' });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Contact Parent',
      email: 'contact-parent@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(accountAdapter.getById).toHaveBeenCalledWith('ACCOUNT-APPLICANT', { select: 'name' });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('confident reviewer+contact linked match also screens divergent contact institution', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [
      { reviewerId: 'PID-SAFE', affiliation: 'Different University', viaNameMatch: false },
    ],
    referencedContacts: [{ contactId: 'CONTACT-DIVERGENT', viaNameMatch: false }],
    match: {
      reviewerId: 'PID-SAFE',
      contactId: 'CONTACT-DIVERGENT',
      matchKey: 'email',
      nameConsistent: true,
      context: { affiliation: 'Different University' },
    },
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-DIVERGENT',
    adx_organizationname: 'Applicant University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Divergent Contact',
      email: 'divergent@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Divergent Contact',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('non-confident lookup shape (linked/conflict/none) still fails COI via the email reuse target — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // A non-confident outcome (here 'candidates' with a `source:'linked'` row, the exact
  // shape earlier missed): the write would still reuse the existing reviewer by email,
  // so the gate reads getByEmail's CRM affiliation regardless of the lookup shape.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'linked', matchKey: 'name', reviewerId: 'PID-EXISTING', context: { affiliation: 'Applicant University' } },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-EXISTING',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    // No COI flags, payload affiliation deliberately omitted — only the trusted
    // reused-reviewer CRM row exposes the same-institution conflict.
    candidates: [{ name: 'Dr Ambiguous', email: 'ambiguous@example.edu' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Ambiguous',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledWith('ambiguous@example.edu');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with linked ORCID candidate at applicant institution fails COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    referencedReviewers: [{ reviewerId: 'PID-LINKED', affiliation: 'Applicant University' }],
    candidates: [
      {
        source: 'linked',
        matchKey: 'orcid',
        reviewerId: 'PID-LINKED',
        context: { affiliation: 'Applicant University' },
      },
    ],
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Linked NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Linked NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with conflict reviewerId at applicant institution fails COI via getById — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'contact_linked_elsewhere',
    details: { reviewerId: 'PID-CONFLICT' },
    referencedReviewers: [{ reviewerId: 'PID-CONFLICT', affiliation: null }],
  });
  potentialReviewerAdapter.getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-CONFLICT',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Conflict NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-CONFLICT');
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with conflict reviewerId getById failure fails closed — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'contact_linked_elsewhere',
    details: { reviewerId: 'PID-CONFLICT' },
    referencedReviewers: [{ reviewerId: 'PID-CONFLICT', affiliation: null }],
  });
  potentialReviewerAdapter.getById.mockRejectedValueOnce(new Error('reviewer read down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Conflict Lookup Down', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict Lookup Down',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_affiliation_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-CONFLICT');
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate whose identity lookup throws fails closed before writes', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockRejectedValueOnce(new Error('lookup down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Lookup Throws', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Lookup Throws',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email candidate with ORCID/email split conflict resolves every referenced reviewer and rejects same-institution COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'orcid_email_split',
    details: {
      orcidReviewerId: 'PID-ORCID',
      emailReviewerId: 'PID-EMAIL',
    },
    referencedReviewers: [
      { reviewerId: 'PID-ORCID', affiliation: null },
      { reviewerId: 'PID-EMAIL', affiliation: null },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);
  potentialReviewerAdapter.getById.mockImplementation(async (id) => ({
    wmkf_potentialreviewersid: id,
    wmkf_primaryaffiliation: id === 'PID-ORCID' ? 'Applicant University' : 'Different University',
  }));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Split Email',
      email: 'split@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Split Email',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledWith('split@example.edu');
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-ORCID');
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-EMAIL');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('finding 7 save regression: exact email contact declared beside non-confident ORCID outcome rejects before write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'reviewer', matchKey: 'orcid', reviewerId: 'PID-ORCID-NONCONFIDENT', context: { affiliation: 'Different University' } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-ORCID-NONCONFIDENT', affiliation: 'Different University', viaNameMatch: false },
    ],
    referencedContacts: [
      { contactId: 'CONTACT-EMAIL-EXACT', viaNameMatch: false },
    ],
  });
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-EMAIL-EXACT',
    adx_organizationname: 'Applicant University',
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Finding Seven',
      email: 'finding-seven@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Finding Seven',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(contactAdapter.getInstitutionById).toHaveBeenCalledWith('CONTACT-EMAIL-EXACT');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('finding B save regression: email ambiguity cannot drop a same-institution ORCID reviewer declaration', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'contact', matchKey: 'email', contactId: 'CONTACT-AMBIGUOUS', context: { affiliation: null } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-ORCID-APPLICANT', affiliation: 'Applicant University', viaNameMatch: false },
    ],
    referencedContacts: [
      { contactId: 'CONTACT-AMBIGUOUS', viaNameMatch: false },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-AMBIGUOUS',
    adx_organizationname: 'Different University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Finding B',
      email: 'finding-b@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ savedCount: 0, rejectedInstitutionCOI: 1 });
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('finding C save regression: exact reviewer declared beside ambiguous contact rows rejects before write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'contact', matchKey: 'email', contactId: 'CONTACT-AMBIG-A', context: { affiliation: null } },
      { source: 'contact', matchKey: 'email', contactId: 'CONTACT-AMBIG-B', context: { affiliation: null } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-EMAIL-ONE', affiliation: 'Applicant University', viaNameMatch: false },
    ],
    referencedContacts: [
      { contactId: 'CONTACT-AMBIG-A', viaNameMatch: false },
      { contactId: 'CONTACT-AMBIG-B', viaNameMatch: false },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);
  contactAdapter.getInstitutionById
    .mockResolvedValueOnce({ contactid: 'CONTACT-AMBIG-A', adx_organizationname: 'Different University' })
    .mockResolvedValueOnce({ contactid: 'CONTACT-AMBIG-B', adx_organizationname: 'Different University' });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Finding C',
      email: 'finding-c@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ savedCount: 0, rejectedInstitutionCOI: 1 });
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('finding D save regression: email_mismatch conflict screens the ORCID reviewer declaration before write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'email_mismatch',
    details: {
      contactId: 'CONTACT-MISMATCH',
      typedEmail: 'new@example.edu',
      contactEmail: 'old@example.edu',
    },
    referencedReviewers: [
      { reviewerId: 'PID-MISMATCH-ORCID', affiliation: 'Applicant University', viaNameMatch: false },
    ],
    referencedContacts: [
      { contactId: 'CONTACT-MISMATCH', viaNameMatch: false },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);
  contactAdapter.getInstitutionById.mockResolvedValueOnce({
    contactid: 'CONTACT-MISMATCH',
    adx_organizationname: 'Different University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Finding D',
      email: 'new@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ savedCount: 0, rejectedInstitutionCOI: 1 });
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email candidate whose identity lookup throws fails closed before writes', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockRejectedValueOnce(new Error('lookup down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Email Lookup Throws', email: 'throws@example.edu' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Email Lookup Throws',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with no lookup match and non-conflicting payload affiliation saves', async () => {
  lookupReviewerIdentity.mockResolvedValueOnce({ outcome: 'none' });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr NoEmail Safe',
      affiliation: 'Different University',
      expertise: 'Safe science',
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr NoEmail Safe'],
    totalRequested: 1,
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr NoEmail Safe',
      email: null,
      affiliation: 'Different University',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: null },
  );
  expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalledWith(
    'PID-1',
    expect.objectContaining({
      name: 'Dr NoEmail Safe',
      affiliation: 'Different University',
    }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ potentialReviewerId: 'PID-1' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('email-less candidate with a confident ORCID match to a same-institution reviewer fails COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // No email → the write would CREATE a new reviewer (upsertByEmail with email:null
  // skips reuse), but the confident ORCID match exposes the existing reviewer's CRM
  // affiliation; the gate must evaluate it regardless of the missing email.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [{ reviewerId: 'PID-ORCID', affiliation: 'Applicant University' }],
    match: {
      reviewerId: 'PID-ORCID',
      matchKey: 'orcid',
      context: { affiliation: 'Applicant University' },
    },
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});
