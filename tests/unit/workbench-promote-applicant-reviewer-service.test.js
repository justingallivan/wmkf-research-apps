/**
 * @jest-environment node
 *
 * lib/services/workbench/promote-applicant-reviewer-service — logic-level
 * tests (adapters mocked), Stage 4 series A extraction. The two route
 * characterization suites pin the full partial-success matrix; this suite
 * pins the service's typed errors, canonical-contact gate, savedFields, and
 * server-owned roster finalization.
 */

const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
const selectIfUnengaged = jest.fn(async () => ({}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
  selectIfUnengaged: (...a) => selectIfUnengaged(...a),
}));

const update = jest.fn(async () => {});
const getById = jest.fn(async () => ({ wmkf_emailaddress: 'existing@example.edu' }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  update: (...a) => update(...a),
  getById: (...a) => getById(...a),
}));

const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  updateById: (...a) => updateById(...a),
}));

const translateDuplicateKeyError = jest.fn();
jest.mock('../../lib/dataverse/duplicate-key', () => ({
  translateDuplicateKeyError: (...a) => translateDuplicateKeyError(...a),
}));

const findCandidateBySuggestion = jest.fn(async () => null);
const findAddressTrustReceipt = jest.fn(async () => null);
const finalizeCandidatePromotion = jest.fn(async () => ({ saved: true, candidateKey: 'candidate:applicant' }));
const promotionSnapshotIsCurrent = jest.fn(async () => true);
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  findCandidateBySuggestion: (...a) => findCandidateBySuggestion(...a),
  findAddressTrustReceipt: (...a) => findAddressTrustReceipt(...a),
  finalizeCandidatePromotion: (...a) => finalizeCandidatePromotion(...a),
  promotionSnapshotIsCurrent: (...a) => promotionSnapshotIsCurrent(...a),
}));
const mockGetCandidatePromotionAuthority = jest.fn();
jest.mock('../../lib/services/reviewer-promotion-authority', () => ({
  getCandidatePromotionAuthority: (...args) => mockGetCandidatePromotionAuthority(...args),
}));
const deriveReviewerPromotionAuthoritySnapshot = jest.fn(async ({ requestId, candidate }) => ({
  authorityState: 'current', requestId, candidateKey: candidate?.candidateKey,
  versions: Object.fromEntries([
    'applicant_anchor', 'identity', 'institution_domains', 'institution_coi', 'coauthor_coi',
    'eligibility', 'contact', 'address_trust', 'roster_persistence',
  ].map((stage) => [stage, `${stage}-source-v1`])),
}));
jest.mock('../../lib/services/workbench/reviewer-warm-validation-service', () => ({
  deriveReviewerPromotionAuthoritySnapshot: (...args) => deriveReviewerPromotionAuthoritySnapshot(...args),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const loadApplicantKnownReviewerContext = jest.fn();
jest.mock('../../lib/services/workbench/applicant-known-reviewer-service', () => ({
  loadApplicantKnownReviewerContext: (...a) => loadApplicantKnownReviewerContext(...a),
}));
const loadCoiContext = jest.fn();
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadCoiContext: (...a) => loadCoiContext(...a),
}));
const institutionCOIResolution = jest.fn();
const institutionCOIDecisionResolved = jest.fn();
jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: {
    institutionCOIResolution: (...a) => institutionCOIResolution(...a),
    institutionCOIDecisionResolved: (...a) => institutionCOIDecisionResolved(...a),
  },
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  createInstitutionIdentityResolver: jest.fn(() => ({ resolve: jest.fn(async () => null) })),
}));

import { promoteApplicantReviewer } from '../../lib/services/workbench/promote-applicant-reviewer-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const {
  getCandidatePromotionAuthority: getRealCandidatePromotionAuthority,
} = jest.requireActual('../../lib/services/reviewer-promotion-authority');

const REQ = '11111111-1111-1111-1111-111111111111';
const SUG = '33333333-3333-3333-3333-333333333333';
const PERSON = '22222222-2222-2222-2222-222222222222';
const CURRENT_STAGE_FRESHNESS = {
  identity: { state: 'current', contractVersion: 4, sourceVersion: 'identity-v4', completedAt: '2026-08-02T00:00:00.000Z' },
  institution_coi: { state: 'current', contractVersion: 1, sourceVersion: 'institution-v1', completedAt: '2026-08-02T00:00:00.000Z' },
  coauthor_coi: { state: 'current', contractVersion: 1, sourceVersion: 'coauthor-v1', completedAt: '2026-08-02T00:00:00.000Z' },
  eligibility: { state: 'current', contractVersion: 1, sourceVersion: 'eligibility-v1', completedAt: '2026-08-02T00:00:00.000Z' },
  contact: { state: 'current', contractVersion: 1, sourceVersion: 'contact-v1', completedAt: '2026-08-02T00:00:00.000Z' },
  address_trust: { state: 'current', contractVersion: 1, sourceVersion: 'address-v1', completedAt: '2026-08-02T00:00:00.000Z' },
};
const authorityCandidate = (extra = {}) => ({
  candidateKey: 'candidate:applicant',
  suggestionId: SUG,
  rosterStatus: 'active',
  identityStatus: 'probable',
  needsIdentification: false,
  stageFreshness: CURRENT_STAGE_FRESHNESS,
  coauthorCheckStatus: 'complete',
  coauthorCheckFailures: [],
  eligibilityCheckStatus: 'complete',
  eligibilityStatus: 'unknown',
  ...extra,
});

const args = (over = {}) => ({ requestId: REQ, suggestionId: SUG, contact: undefined, actingUserSystemId: 'u-1', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_applicantdisposition: 100000000,
  });
  update.mockResolvedValue(undefined);
  updateById.mockResolvedValue(undefined);
  getById.mockResolvedValue({
    wmkf_emailaddress: 'existing@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    _etag: 'W/"person"',
  });
  findAddressTrustReceipt.mockResolvedValue({
    receiptId: 'receipt-existing',
    personConfirmed: true,
    email: 'existing@example.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
    attestedAt: '2026-07-31T12:00:00.000Z',
  });
  findCandidateBySuggestion.mockResolvedValue({
    ...authorityCandidate(),
  });
  promotionSnapshotIsCurrent.mockResolvedValue(true);
  mockGetCandidatePromotionAuthority.mockReturnValue({ decision: 'ready', code: null, stage: null });
  finalizeCandidatePromotion.mockResolvedValue({ saved: true, candidateKey: 'candidate:applicant' });
  translateDuplicateKeyError.mockReturnValue(null);
  loadApplicantKnownReviewerContext.mockResolvedValue({
    applicantKnownReviewer: {
      status: 'known',
      code: null,
      potentialReviewerId: PERSON,
      email: 'existing@example.edu',
      emailSource: 'scholarly_multi',
      emailReadiness: {
        level: 'high',
        action: 'ready',
        reason: 'Address source: scholarly_multi',
      },
    },
    contactId: null,
  });
  loadCoiContext.mockResolvedValue({
    piResolution: { state: 'ok', reason: null },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  });
  institutionCOIResolution.mockResolvedValue({ status: 'lexical_non_match', decision: null });
  institutionCOIDecisionResolved.mockResolvedValue(null);
});

test('wrong-request suggestion → 404 typed error, no lifecycle write', async () => {
  findById.mockResolvedValue({ _wmkf_request_value: '00000000-0000-0000-0000-000000000000', wmkf_applicantdisposition: 100000000 });
  const err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('Applicant reviewer suggestion not found for this request');
  expect(err.body.remediation).not.toHaveLength(0);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('non-recommended row → 400; adapter applicant-excluded refusal → same 400 message', async () => {
  findById.mockResolvedValueOnce({ _wmkf_request_value: REQ, wmkf_applicantdisposition: null });
  let err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Only applicant-recommended reviewers can be promoted');

  findById.mockRejectedValueOnce(new Error('refusing to act on an applicant-excluded suggestion'));
  err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Only applicant-recommended reviewers can be promoted');
  expect(err.body).toMatchObject({
    code: 'applicant_excluded',
    remediation: expect.any(Array),
  });
  expect(err.body.remediation).not.toHaveLength(0);
});

test.each([
  ['declined', { wmkf_selected: false, wmkf_declined: true }, 'restore_required'],
  ['invited', { wmkf_selected: true, wmkf_invited: true }, 'already_handled'],
])('%s engagement is refused before any person/contact mutation', async (_label, engagement, code) => {
  findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_applicantdisposition: 100000000,
    ...engagement,
  });
  const err = await promoteApplicantReviewer(args({
    contact: { email: 'new@example.edu', manualEmail: true },
  })).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toMatchObject({ code, stage: expect.any(String) });
  expect(update).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('typed 404 is NOT eaten by the applicant-excluded regex translation (P1m note 4)', async () => {
  // A message that would ALSO match the regex must still surface as its own typed error.
  findById.mockResolvedValue({ _wmkf_request_value: 'other', wmkf_applicantdisposition: 100000000 });
  const err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(404);
});

test('authority derivation unavailable → 503 before COI, contact, or lifecycle mutation', async () => {
  mockGetCandidatePromotionAuthority.mockReturnValueOnce({
    decision: 'blocked',
    code: 'promotion_authority_unavailable',
    stage: null,
  });

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toMatchObject({ code: 'promotion_authority_unavailable' });
  expect(institutionCOIResolution).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('a fully populated applicant roster row fails closed through the real policy without an authoritative snapshot', async () => {
  // Do not use the normal ready mock: the real policy must see the service
  // omitted `authoritative` and stop this otherwise-ready row before mutation.
  mockGetCandidatePromotionAuthority.mockImplementation(getRealCandidatePromotionAuthority);
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    candidateKey: 'candidate:snapshot-required',
  }));

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'stage_authority_stale', stage: 'identity' });
  expect(mockGetCandidatePromotionAuthority).toHaveBeenCalledWith(
    expect.objectContaining({
      candidateKey: 'candidate:snapshot-required',
      rosterStatus: 'active',
      stageFreshness: CURRENT_STAGE_FRESHNESS,
      coauthorCheckStatus: 'complete',
      eligibilityCheckStatus: 'complete',
    }),
    expect.objectContaining({ serverAuthoritative: true, checkInstitution: false }),
  );
  expect(mockGetCandidatePromotionAuthority.mock.calls[0][1]).toMatchObject({
    requestId: REQ,
    authoritative: expect.objectContaining({ authorityState: 'current' }),
  });
  expect(loadCoiContext).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('trusted applicant institution screen: clean no-match allows promotion', async () => {
  const body = await promoteApplicantReviewer(args());

  expect(body.success).toBe(true);
  expect(institutionCOIResolution).toHaveBeenCalledWith(
    expect.objectContaining({ candidateKey: 'candidate:applicant' }),
    expect.any(Array),
    expect.any(Object),
  );
  expect(selectIfUnengaged).toHaveBeenCalled();
});

test('trusted applicant institution screen: blocking decision prevents lifecycle mutation', async () => {
  institutionCOIResolution.mockResolvedValueOnce({
    status: 'matched',
    decision: {
      dropDecision: 'dropped',
      candidate: { institutionCOIDetails: { piInstitution: 'Applicant University' } },
    },
  });

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'institution_coi' });
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('trusted applicant institution screen failure prevents lifecycle mutation', async () => {
  loadCoiContext.mockRejectedValueOnce(new Error('Dataverse unavailable'));

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toMatchObject({ code: 'institution_coi_unavailable' });
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('plain promote: canonical email verified, selected flipped, roster finalized', async () => {
  const body = await promoteApplicantReviewer(args());
  expect(selectIfUnengaged).toHaveBeenCalledWith(SUG, { actingUserSystemId: 'u-1' });
  expect(body).toEqual({
    success: true,
    suggestionId: SUG,
    candidateKey: 'candidate:applicant',
    savedFields: [],
    rosterFinalized: true,
    partialSuccess: false,
    contactError: null,
    emailAction: 'ready',
    emailActionReason: 'Address source: scholarly_multi',
  });
});

test('changed server roster snapshot prevents lifecycle mutation', async () => {
  promotionSnapshotIsCurrent.mockResolvedValueOnce(false);

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toMatchObject({ code: 'roster_snapshot_stale' });
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('source-null canonical contact requires evidence and becomes exact-bundle ready', async () => {
  getById.mockResolvedValue({
    wmkf_emailaddress: 'existing@example.edu',
    wmkf_emailsource: null,
    _etag: 'W/"person"',
  });
  loadApplicantKnownReviewerContext.mockResolvedValueOnce({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'existing@example.edu',
      emailSource: null,
      emailReadiness: {
        level: 'low',
        action: 'quick_check',
        reason: 'Email source not recorded — confirm before sending',
      },
    },
  }).mockResolvedValueOnce({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'existing@example.edu',
      emailSource: 'staff_verified',
      addressTrustVerified: true,
      emailReadiness: { level: 'high', action: 'ready', reason: 'Exact address verified by staff' },
    },
  });
  const body = await promoteApplicantReviewer(args());
  expect(update).toHaveBeenCalledWith(
    PERSON,
    expect.objectContaining({
      email: 'existing@example.edu',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }),
    { actingUserSystemId: 'u-1', ifMatch: 'W/"person"' },
  );
  expect(body).toMatchObject({ success: true, emailAction: 'ready' });
});

test('research-only canonical contact requires evidence and becomes exact-bundle ready', async () => {
  getById.mockResolvedValue({
    wmkf_emailaddress: 'existing@example.edu',
    wmkf_emailsource: 'serp_search',
    _etag: 'W/"person"',
  });
  loadApplicantKnownReviewerContext.mockResolvedValueOnce({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'existing@example.edu',
      emailSource: 'serp_search',
      emailReadiness: {
        level: 'low',
        action: 'research_only',
        reason: 'Search lead lacks address-specific first-party evidence',
      },
    },
  }).mockResolvedValueOnce({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'existing@example.edu',
      emailSource: 'staff_verified',
      addressTrustVerified: true,
      emailReadiness: { level: 'high', action: 'ready', reason: 'Exact address verified by staff' },
    },
  });
  const body = await promoteApplicantReviewer(args());
  expect(selectIfUnengaged).toHaveBeenCalled();
  expect(body).toMatchObject({ success: true, emailAction: 'ready' });
});

test.each([
  ['inactive', 'person_inactive', 422],
  ['email_conflict', 'email_conflict', 409],
  ['unavailable', 'contact_verification_unavailable', 503],
])('%s exact-person state blocks promotion with a stable code', async (status, code, httpStatus) => {
  loadApplicantKnownReviewerContext.mockResolvedValue({
    applicantKnownReviewer: {
      status,
      code: status === 'unavailable' ? 'person_unavailable' : code,
      potentialReviewerId: PERSON,
      email: status === 'unavailable' ? null : 'existing@example.edu',
      emailSource: null,
    },
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(httpStatus);
  expect(err.body).toMatchObject({ code });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('known exact person with no stored or vetted email remains in Find', async () => {
  loadApplicantKnownReviewerContext.mockResolvedValue({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: null,
      emailSource: null,
    },
  });
  getById.mockResolvedValue({});
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    code: 'missing_verified_email',
    decision: 'missing_email',
  });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('stored/enriched email mismatch blocks promotion and does not select the suggestion', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    email: 'new@example.edu',
  }));
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toMatchObject({ code: 'contact_claim_mismatch' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('applicant promotion cannot use a receipt when the address conflict was never durably recorded', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    email: 'found@example.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    applicantContactMismatch: true,
    conflictRecordUnavailable: true,
    addressTrustReceipt: {
      receiptId: 'old-receipt',
      personConfirmed: true,
      email: 'found@example.edu',
    },
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
      conflictRecordUnavailable: true,
    },
  }));
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'existing@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    wmkf_addresstruststatejson: null,
    _etag: 'W/"person"',
  });
  const error = await promoteApplicantReviewer(args()).catch((caught) => caught);

  expect(error).toBeInstanceOf(ServiceHttpError);
  expect(error.httpStatus).toBe(409);
  expect(error.body).toMatchObject({
    code: 'conflict_record_unavailable',
    remediation: expect.arrayContaining([
      expect.objectContaining({ action: 'retry_check' }),
      expect.objectContaining({ action: 'create_repair_request' }),
      expect.objectContaining({ action: 'set_aside' }),
    ]),
  });
  expect(findAddressTrustReceipt).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('a manual applicant address cannot bypass a failed conflict write', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    email: 'found@example.edu',
    emailSource: 'manual',
    manualContactFields: ['email'],
    applicantContactMismatch: true,
    conflictRecordUnavailable: true,
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'manual',
      emailPersistAllowed: true,
      conflictRecordUnavailable: true,
    },
  }));
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'existing@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    wmkf_addresstruststatejson: null,
    _etag: 'W/"person"',
  });

  const error = await promoteApplicantReviewer(args({
    contact: { email: 'found@example.edu' },
  })).catch((caught) => caught);

  expect(error).toBeInstanceOf(ServiceHttpError);
  expect(error.body).toMatchObject({ code: 'conflict_record_unavailable' });
  expect(findAddressTrustReceipt).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('posted manual contact cannot rewrite the canonical person during applicant promotion', async () => {
  const body = await promoteApplicantReviewer(args({
    contact: { email: 'corrected@example.edu', affiliation: 'Attacker Institute' },
  }));
  expect(body).toMatchObject({ success: true, emailAction: 'ready' });
  expect(update).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
  expect(selectIfUnengaged).toHaveBeenCalled();
});

test('anti-scrape browser contact is ignored before any person write', async () => {
  const body = await promoteApplicantReviewer(args({
    contact: { email: 'reviewer@nospam.example.edu', affiliation: 'Example U' },
  }));
  expect(body).toMatchObject({ success: true });
  expect(update).not.toHaveBeenCalled();
  expect(updateById).not.toHaveBeenCalled();
  expect(selectIfUnengaged).toHaveBeenCalled();
});

test('missing authoritative roster row is rejected before lifecycle promotion', async () => {
  findCandidateBySuggestion.mockResolvedValue(null);
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'identity_verification_required' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('a roster row bound to a different suggestion is rejected before any mutation', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    suggestionId: '44444444-4444-4444-4444-444444444444',
  }));

  const err = await promoteApplicantReviewer(args()).catch((error) => error);

  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toMatchObject({ code: 'roster_snapshot_stale' });
  expect(institutionCOIResolution).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

test('deceased applicant-recommended reviewer is rejected before lifecycle promotion', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Deceased',
    candidateKey: 'candidate:deceased',
    suggestionId: SUG,
    eligibilityStatus: 'deceased',
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'candidate_ineligible' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('durable ineligible status blocks promotion even when the candidate blob lacks its marker', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Deceased',
    candidateKey: 'candidate:deceased',
    suggestionId: SUG,
    rosterStatus: 'ineligible',
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('identity-review applicant is rejected before lifecycle promotion without server confirmation', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    name: 'Dr Namesake',
    candidateKey: 'candidate:namesake',
    suggestionId: SUG,
    needsIdentification: true,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
  }));
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'identity_confirmation_required' });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('server-recorded staff confirmation permits promotion of an identity-review applicant', async () => {
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    name: 'Dr Namesake',
    candidateKey: 'candidate:namesake',
    suggestionId: SUG,
    needsIdentification: true,
    identityStatus: 'unresolved',
    pdIdentityConfirmed: true,
    pdIdentityConfirmationId: 'confirm-1',
    staffIdentityConfirmation: {
      confirmationId: 'confirm-1',
      source: 'staff_confirmed',
      state: 'confirmed',
      canonicalPersonId: '22222222-2222-4222-8222-222222222222',
      canonicalPersonEtag: 'W/"person-v1"',
      actorId: 'u-1',
      confirmedAt: '2026-08-02T00:00:00.000Z',
    },
  }));
  const body = await promoteApplicantReviewer(args());
  expect(body.success).toBe(true);
  expect(selectIfUnengaged).toHaveBeenCalledWith(SUG, { actingUserSystemId: 'u-1' });
});

test('browser email collision cannot alter applicant promotion', async () => {
  update.mockImplementation(async (_id, updates) => {
    if (updates && 'email' in updates) throw new Error('alt-key duplicate');
  });
  translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'a@b.edu' });
  const body = await promoteApplicantReviewer(args({ contact: { affiliation: 'JILA', email: 'a@b.edu' } }));
  expect(body).toMatchObject({ success: true });
  expect(update).not.toHaveBeenCalled();
  expect(findCandidateBySuggestion).toHaveBeenCalledTimes(1);
  expect(selectIfUnengaged).toHaveBeenCalled();
});

test('B1 backfill: vetted roster email written with roster provenance when no manual email', async () => {
  findAddressTrustReceipt.mockResolvedValueOnce({
    receiptId: 'receipt-kaang',
    personConfirmed: true,
    email: 'kaang@snu.ac.kr',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
    attestedAt: '2026-07-31T12:00:00.000Z',
  });
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    candidateKey: 'candidate:kaang',
    email: 'kaang@snu.ac.kr',
    emailSource: 'claude_search',
    contactEnrichment: {
      identity: { status: 'probable' },
      email: 'kaang@snu.ac.kr',
      emailSource: 'claude_search',
      emailPersistAllowed: true,
    },
  }));
  getById
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      wmkf_emailaddress: 'kaang@snu.ac.kr',
      wmkf_emailsource: 'claude_search',
      _etag: 'W/"kaang"',
    })
    .mockResolvedValueOnce({
      wmkf_emailaddress: 'kaang@snu.ac.kr',
      wmkf_emailsource: 'claude_search',
      _etag: 'W/"kaang"',
    });
  loadApplicantKnownReviewerContext.mockResolvedValue({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'kaang@snu.ac.kr',
      emailSource: 'claude_search',
    },
  });
  const body = await promoteApplicantReviewer(args());
  expect(body.savedFields).toEqual(['email']);
  // S387: the vetted address and its roster provenance land in ONE patch, so a rejected
  // address cannot leave the row labelled with a source for a different one.
  expect(update).toHaveBeenCalledWith(
    PERSON,
    expect.objectContaining({
      email: 'kaang@snu.ac.kr',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }),
    { actingUserSystemId: 'u-1', ifMatch: 'W/"kaang"' },
  );
  expect(updateById).not.toHaveBeenCalledWith(PERSON, { emailSource: 'claude_search' }, { actingUserSystemId: 'u-1' });
});

test('existing research-only person email is upgraded only after exact attestation', async () => {
  findAddressTrustReceipt.mockResolvedValueOnce({
    receiptId: 'receipt-x',
    personConfirmed: true,
    email: 'x@y.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
    attestedAt: '2026-07-31T12:00:00.000Z',
  });
  findCandidateBySuggestion.mockResolvedValue(authorityCandidate({
    candidateKey: 'candidate:x',
    email: 'x@y.edu',
    emailSource: 'claude_search',
    emailPersistAllowed: true,
  }));
  getById.mockResolvedValue({
    wmkf_emailaddress: 'x@y.edu',
    wmkf_emailsource: 'claude_search',
    _etag: 'W/"x"',
  });
  loadApplicantKnownReviewerContext.mockResolvedValue({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'x@y.edu',
      emailSource: 'claude_search',
    },
  });
  const body = await promoteApplicantReviewer(args());
  expect(body.savedFields).toEqual(['email']);
  expect(update).toHaveBeenCalledWith(
    PERSON,
    expect.objectContaining({
      email: 'x@y.edu',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }),
    { actingUserSystemId: 'u-1', ifMatch: 'W/"x"' },
  );
});

test('eligibility roster read failure returns retryable 503 before lifecycle mutation', async () => {
  findCandidateBySuggestion.mockRejectedValue(new Error('roster down'));
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toMatchObject({ code: 'eligibility_unavailable' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('browser safe-field payload is ignored before lifecycle promotion', async () => {
  update.mockImplementation(async (_id, updates) => {
    if (updates && 'affiliation' in updates) throw new Error('boom');
  });
  const body = await promoteApplicantReviewer(args({ contact: { affiliation: 'JILA' } }));
  expect(body).toMatchObject({ success: true });
  expect(update).not.toHaveBeenCalled();
  expect(selectIfUnengaged).toHaveBeenCalled();
});
