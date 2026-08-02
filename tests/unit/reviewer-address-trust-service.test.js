/** @jest-environment node */

const findById = jest.fn();
const getById = jest.fn();
const update = jest.fn();
const attestAddress = jest.fn();
const clearAddressTrustBlocks = jest.fn();
const completeStructuredAddressVerification = jest.fn();
const confirmIdentity = jest.fn();
const findCandidateByKey = jest.fn();
const findCandidatesByKeys = jest.fn();
const recordSurfaced = jest.fn();
const resolveTrustedReviewerPerson = jest.fn();
const getRequestById = jest.fn();
const buildReviewerStageDependencySnapshot = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...args) => getById(...args),
  update: (...args) => update(...args),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  attestAddress: (...args) => attestAddress(...args),
  clearAddressTrustBlocks: (...args) => clearAddressTrustBlocks(...args),
  completeStructuredAddressVerification: (...args) => completeStructuredAddressVerification(...args),
  confirmIdentity: (...args) => confirmIdentity(...args),
  findCandidateByKey: (...args) => findCandidateByKey(...args),
  findCandidatesByKeys: (...args) => findCandidatesByKeys(...args),
  recordSurfaced: (...args) => recordSurfaced(...args),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getRequestById(...args),
}));
jest.mock('../../lib/services/workbench/reviewer-warm-validation-service', () => ({
  REQUEST_SELECT: 'akoya_requestid,akoya_requestnum',
  projectApplicantWarmInputs: () => ({ state: 'current' }),
  resolveReviewerProposalMetadata: async () => ({ state: 'current', proposalContentVersion: 'd'.repeat(64) }),
  buildApplicantAnchorRefreshReceipt: jest.fn(),
}));
jest.mock('../../lib/services/workbench/reviewer-stage-source-versions', () => ({
  CONTRACT_VERSIONS: { identity: 4 },
  buildRequestCoiContextVersion: () => 'e'.repeat(64),
  buildReviewerStageDependencySnapshot: (...args) => buildReviewerStageDependencySnapshot(...args),
}));
jest.mock('../../lib/services/reviewer-contact-reconciliation', () => ({
  resolveTrustedReviewerPerson: (...args) => resolveTrustedReviewerPerson(...args),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const {
  getAddressConflict,
  retryAddressCheck,
  confirmStructuredRosterIdentity,
  verifyPersonAndAddress,
} = require('../../lib/services/reviewer-address-trust-service');
const {
  createConflictPendingState,
  createStaffVerifiedState,
  parseAddressTrustState,
} = require('../../lib/utils/reviewer-address-trust');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';

function failedWriteCandidate(email = 'found@example.edu') {
  const candidateKey = 'suggestion:row';
  return {
    candidateKey,
    suggestionId: SUGGESTION_ID,
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-2',
    conflictRecordUnavailable: true,
    addressTrustReceipt: {
      receiptId: 'receipt-1',
      email,
      personConfirmed: true,
      actorProfileId: 'profile-1',
      actorSystemUserId: 'system-1',
      requestId: REQUEST_ID,
      candidateKey,
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile',
      note: null,
      attestedAt: '2026-07-31T21:00:00.000Z',
    },
    email,
    contactEnrichment: {
      email,
      emailSource: 'manual',
      emailPersistAllowed: true,
      conflictRecordUnavailable: true,
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue({
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
  });
  getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'reviewer@example.edu',
    _etag: 'W/"person"',
  });
  update.mockResolvedValue(undefined);
  findCandidatesByKeys.mockResolvedValue([]);
  clearAddressTrustBlocks.mockResolvedValue(null);
  completeStructuredAddressVerification.mockResolvedValue({ outcome: 'recorded', candidate: { candidateKey: 'person:row' }, updatedAt: 'row-version-3' });
  confirmIdentity.mockResolvedValue({
    confirmationId: 'confirm-1',
    candidate: { candidateKey: `person:${PERSON_ID}`, name: 'Reviewer Name' },
  });
  findCandidateByKey.mockResolvedValue(null);
  recordSurfaced.mockResolvedValue(1);
  resolveTrustedReviewerPerson.mockResolvedValue(null);
  getRequestById.mockResolvedValue({ akoya_requestid: REQUEST_ID, akoya_requestnum: '1000001' });
  buildReviewerStageDependencySnapshot.mockImplementation(({ candidate }) => ({
    applicantInputVersion: null,
    proposalContentVersion: 'd'.repeat(64),
    requestCoiContextVersion: 'e'.repeat(64),
    stageInputVersions: {
      identity: 'a'.repeat(64),
      contact: 'b'.repeat(64),
      address_trust: candidate?.stageFreshness?.contact?.sourceVersion === 'b'.repeat(64)
        ? 'c'.repeat(64)
        : null,
    },
  }));
});

test('already-promoted verification binds evidence to the exact current person address atomically', async () => {
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'Reviewer@Example.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, decision: 'person_address_verified' });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'reviewer@example.edu',
    emailSource: 'staff_verified',
    addressTrustStateJson: expect.any(String),
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"person"' });
  const bundle = JSON.parse(update.mock.calls[0][1].addressTrustStateJson);
  expect(parseAddressTrustState(bundle, { storedEmail: 'reviewer@example.edu' })).toMatchObject({
    valid: true,
    state: {
      status: 'staff_verified',
      attestation: {
        requestId: REQUEST_ID,
        candidateKey: `suggestion:${SUGGESTION_ID}`,
        evidenceUrl: 'https://example.edu/paper',
      },
    },
  });
  expect(attestAddress).not.toHaveBeenCalled();
});

test('already-promoted verification fails closed when the displayed address is stale', async () => {
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'old@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(update).not.toHaveBeenCalled();
});

test('already-ready provenance is preserved instead of being relabeled staff_verified', async () => {
  getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'reviewer@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    _etag: 'W/"person"',
  });
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
  });
  expect(result).toMatchObject({ success: true, decision: 'already_ready' });
  expect(update).not.toHaveBeenCalled();
});

test('verification without either accepted reviewer identifier fails closed before any read or write', async () => {
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({ success: false, decision: 'blocked', code: 'candidate_stale' });
  expect(findById).not.toHaveBeenCalled();
  expect(findCandidateByKey).not.toHaveBeenCalled();
  expect(attestAddress).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('ordinary roster conflict discloses only the current address pair', async () => {
  const conflict = createConflictPendingState({
    email: 'reviewer@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey: 'suggestion:row',
    detectedAt: '2026-07-31T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey: 'suggestion:row',
    suggestionId: SUGGESTION_ID,
    addressConflictPending: true,
    rosterStatus: 'active',
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'reviewer@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    _etag: 'W/"person"',
  });
  await expect(getAddressConflict({
    requestId: REQUEST_ID,
    candidateKey: 'suggestion:row',
  })).resolves.toMatchObject({
    success: true,
    conflict: {
      storedEmail: 'reviewer@example.edu',
      foundEmail: 'found@example.edu',
      reason: 'email_mismatch',
    },
  });
});

test('retry_check actually retries the failed person conflict write before clearing the failure flag', async () => {
  const candidateKey = 'suggestion:row';
  const failedCandidate = {
    candidateKey,
    suggestionId: SUGGESTION_ID,
    name: 'Reviewer Name',
    email: 'stored@example.edu',
    conflictRecordUnavailable: true,
    rosterUpdatedAt: 'row-version-1',
    rosterStatus: 'active',
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
      conflictRecordUnavailable: true,
    },
  };
  findCandidatesByKeys
    .mockResolvedValueOnce([failedCandidate])
    .mockResolvedValueOnce([{
      ...failedCandidate,
      addressConflictPending: true,
      conflictRecordUnavailable: false,
      rosterUpdatedAt: 'row-version-2',
    }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: null,
    _etag: 'W/"person"',
  });

  const result = await retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    actorSystemUserId: 'system-1',
  });

  expect(update).toHaveBeenCalledWith(PERSON_ID, {
    addressTrustStateJson: expect.stringContaining('conflict_pending'),
  }, { actingUserSystemId: 'system-1', ifMatch: 'W/"person"' });
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQUEST_ID,
    [expect.objectContaining({
      addressConflictPending: true,
      conflictRecordUnavailable: false,
    })],
    { expectedUpdatedAt: 'row-version-1' },
  );
  expect(result).toMatchObject({ success: true, candidate: { rosterUpdatedAt: 'row-version-2' } });
});

test('retry_check does not create a conflict bundle when the person ETag is missing', async () => {
  const candidateKey = 'suggestion:row';
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    suggestionId: SUGGESTION_ID,
    name: 'Reviewer Name',
    email: 'found@example.edu',
    conflictRecordUnavailable: true,
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
    },
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: null,
    statecode: 0,
  });

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey });

  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(update).not.toHaveBeenCalled();
  expect(recordSurfaced).not.toHaveBeenCalled();
});

test('retry_check refuses an ordinary candidate whose ORCID is not trusted for a durable person write', async () => {
  const candidateKey = 'orcid:provisional';
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'J. Smith',
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    conflictRecordUnavailable: true,
    contactEnrichment: {
      identity: { status: 'unresolved', anchors: [] },
      orcidId: '0000-0002-1825-0097',
      email: 'found@example.edu',
      emailPersistAllowed: true,
    },
  }]);

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey });

  expect(resolveTrustedReviewerPerson).toHaveBeenCalled();
  expect(result).toMatchObject({ success: false, code: 'conflict_record_unavailable' });
  expect(update).not.toHaveBeenCalled();
  expect(recordSurfaced).not.toHaveBeenCalled();
});

test('retry_check is unavailable without a server-recorded conflict or failed conflict write', async () => {
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey: 'suggestion:row',
    suggestionId: SUGGESTION_ID,
    rosterStatus: 'active',
  }]);

  const result = await retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey: 'suggestion:row',
  });

  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(findById).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('retry_check applies a current roster receipt instead of reopening its address as a new conflict', async () => {
  const candidateKey = 'suggestion:row';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-07-31T20:00:00.000Z',
  });
  const receipt = {
    receiptId: 'receipt-1',
    email: 'found@example.edu',
    personConfirmed: true,
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
    requestId: REQUEST_ID,
    candidateKey,
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
    note: null,
    attestedAt: '2026-07-31T21:00:00.000Z',
  };
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    suggestionId: SUGGESTION_ID,
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-2',
    addressConflictPending: true,
    addressTrustReceipt: receipt,
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'manual',
      emailPersistAllowed: true,
    },
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    statecode: 0,
    _etag: 'W/"person"',
  });
  clearAddressTrustBlocks.mockResolvedValueOnce({
    candidateKey,
    email: 'found@example.edu',
    addressConflictPending: false,
  });

  const result = await retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, decision: 'address_conflict_resolved' });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'found@example.edu',
    emailSource: 'staff_verified',
    addressTrustStateJson: expect.stringContaining('staff_verified'),
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"person"' });
  expect(update.mock.calls[0][1].addressTrustStateJson).not.toContain('conflict_pending');
  expect(recordSurfaced).not.toHaveBeenCalled();
});

test('retry_check does not replay a receipt against a pending conflict without a person ETag', async () => {
  const candidateKey = 'suggestion:row';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-07-31T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    suggestionId: SUGGESTION_ID,
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-2',
    addressConflictPending: true,
    addressTrustReceipt: {
      receiptId: 'receipt-1',
      email: 'found@example.edu',
      personConfirmed: true,
      requestId: REQUEST_ID,
      candidateKey,
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile',
      attestedAt: '2026-07-31T21:00:00.000Z',
    },
    contactEnrichment: { email: 'found@example.edu', emailPersistAllowed: true },
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    statecode: 0,
  });

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey });

  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(update).not.toHaveBeenCalled();
  expect(clearAddressTrustBlocks).not.toHaveBeenCalled();
});

test('retry_check records the real conflict before considering an old one-sided receipt', async () => {
  const candidate = failedWriteCandidate();
  findCandidatesByKeys
    .mockResolvedValueOnce([candidate])
    .mockResolvedValueOnce([{
      ...candidate,
      addressConflictPending: true,
      conflictRecordUnavailable: false,
      rosterUpdatedAt: 'row-version-3',
    }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: null,
    statecode: 0,
    _etag: 'W/"person"',
  });

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey: candidate.candidateKey });

  expect(result).toMatchObject({ success: true, decision: 'refreshed' });
  expect(update).toHaveBeenCalledWith(PERSON_ID, {
    addressTrustStateJson: expect.any(String),
  }, { actingUserSystemId: null, ifMatch: 'W/"person"' });
  const persisted = parseAddressTrustState(update.mock.calls[0][1].addressTrustStateJson, {
    storedEmail: 'stored@example.edu',
  });
  expect(persisted).toMatchObject({
    valid: true,
    state: {
      status: 'conflict_pending',
      conflict: {
        storedEmail: 'stored@example.edu',
        foundEmail: 'found@example.edu',
      },
    },
  });
  expect(clearAddressTrustBlocks).not.toHaveBeenCalled();
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQUEST_ID,
    [expect.objectContaining({
      addressConflictPending: true,
      conflictRecordUnavailable: false,
    })],
    { expectedUpdatedAt: 'row-version-2' },
  );
});

test.each([
  ['concurrent person change', Object.assign(new Error('dataverse failed (412): concurrency mismatch'), { status: 412 }), 'candidate_stale'],
  ['Dataverse outage', new Error('Dataverse unavailable'), 'conflict_record_unavailable'],
])('retry_check keeps the roster blocked when the conflict-only write fails: %s', async (_label, failure, code) => {
  const candidate = failedWriteCandidate();
  findCandidatesByKeys.mockResolvedValueOnce([candidate]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: null,
    statecode: 0,
    _etag: 'W/"person"',
  });
  update.mockRejectedValueOnce(failure);

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey: candidate.candidateKey });

  expect(result).toMatchObject({ success: false, code });
  expect(update).toHaveBeenCalledWith(PERSON_ID, {
    addressTrustStateJson: expect.any(String),
  }, { actingUserSystemId: null, ifMatch: 'W/"person"' });
  expect(recordSurfaced).not.toHaveBeenCalled();
  expect(clearAddressTrustBlocks).not.toHaveBeenCalled();
});

test.each([
  ['the stored and found addresses now agree', 'found@example.edu'],
  ['the stored address was removed', null],
])('retry_check clears the stale unavailable flag without a person write when %s', async (_label, storedEmail) => {
  const candidate = failedWriteCandidate();
  findCandidatesByKeys
    .mockResolvedValueOnce([candidate])
    .mockResolvedValueOnce([{
      ...candidate,
      conflictRecordUnavailable: false,
      rosterUpdatedAt: 'row-version-3',
    }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: storedEmail,
    wmkf_addresstruststatejson: null,
    statecode: 0,
    _etag: 'W/"person"',
  });

  const result = await retryAddressCheck({ requestId: REQUEST_ID, candidateKey: candidate.candidateKey });

  expect(result).toMatchObject({ success: true, decision: 'refreshed' });
  expect(update).not.toHaveBeenCalled();
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQUEST_ID,
    [expect.objectContaining({ conflictRecordUnavailable: false })],
    { expectedUpdatedAt: 'row-version-2' },
  );
});

test('canonical roster actions require an existing current identity receipt before any address mutation', async () => {
  const candidate = structuredCandidate({ stageFreshness: {} });
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    email: 'verified@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: false, code: 'identity_verification_required' });
  expect(update).not.toHaveBeenCalled();
  expect(attestAddress).not.toHaveBeenCalled();
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test('inactive people cannot be relabeled staff_verified', async () => {
  getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'reviewer@example.edu',
    statecode: 1,
    _etag: 'W/"person"',
  });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({ success: false, code: 'person_inactive' });
  expect(update).not.toHaveBeenCalled();
});

test('ordinary roster actions report an inactive resolved person as repair-only', async () => {
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey: 'orcid:trusted',
    name: 'Reviewer Name',
    rosterStatus: 'active',
    addressConflictPending: true,
  }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: { statecode: 1, wmkf_emailaddress: 'reviewer@example.edu' },
  });

  const result = await getAddressConflict({
    requestId: REQUEST_ID,
    candidateKey: 'orcid:trusted',
  });

  expect(resolveTrustedReviewerPerson).toHaveBeenCalledWith(
    expect.anything(),
    { allowInactive: true },
  );
  expect(result).toMatchObject({ success: false, code: 'person_inactive' });
});

test.each(['saved', 'excluded', 'ineligible'])(
  'get_address_conflict refuses a %s roster row before resolving or disclosing its address pair',
  async (rosterStatus) => {
    findCandidatesByKeys.mockResolvedValueOnce([{
      candidateKey: 'suggestion:row',
      suggestionId: SUGGESTION_ID,
      rosterStatus,
      addressConflictPending: true,
    }]);

    const result = await getAddressConflict({
      requestId: REQUEST_ID,
      candidateKey: 'suggestion:row',
    });

    expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
    expect(findById).not.toHaveBeenCalled();
    expect(getById).not.toHaveBeenCalled();
  },
);

test('resolved retry projection derives readiness from the actual person provenance', async () => {
  const candidateKey = 'suggestion:row';
  const prior = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-07-31T20:00:00.000Z',
  });
  const resolved = createStaffVerifiedState({
    email: 'stored@example.edu',
    requestId: REQUEST_ID,
    candidateKey,
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
    attestedAt: '2026-07-31T21:00:00.000Z',
    resolution: {
      conflict: prior.conflict,
      decision: 'keep_stored',
      resolvedAt: '2026-07-31T21:00:00.000Z',
    },
  });
  const failedCandidate = {
    candidateKey,
    suggestionId: SUGGESTION_ID,
    name: 'Reviewer Name',
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    conflictRecordUnavailable: true,
    applicantContactMismatch: true,
    applicantKnownReviewer: { email: 'stored@example.edu' },
    contactEnrichment: {
      email: 'found@example.edu',
      emailSource: 'scholarly_multi',
      emailPersistAllowed: true,
    },
  };
  findCandidatesByKeys
    .mockResolvedValueOnce([failedCandidate])
    .mockResolvedValueOnce([{ ...failedCandidate, rosterUpdatedAt: 'row-version-2' }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_emailsource: null,
    wmkf_addresstruststatejson: JSON.stringify(resolved),
    statecode: 0,
    _etag: 'W/"person"',
  });

  await retryAddressCheck({ requestId: REQUEST_ID, candidateKey });

  expect(recordSurfaced).toHaveBeenCalledWith(REQUEST_ID, [expect.objectContaining({
    applicantKnownReviewer: expect.objectContaining({
      addressTrustVerified: false,
      emailReadiness: expect.objectContaining({ action: 'quick_check' }),
    }),
  })], { expectedUpdatedAt: 'row-version-1' });
});

function structuredCandidate(overrides = {}) {
  return {
    candidateKey: `person:${PERSON_ID}`,
    potentialReviewerId: PERSON_ID,
    name: 'Reviewer Name',
    affiliation: 'Example University',
    identityDecision: 'confirmed',
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    stageFreshness: {
      identity: {
        state: 'current', contractVersion: 4,
        sourceVersion: 'a'.repeat(64), resultVersion: 'identity-result',
        completedAt: '2026-08-02T12:00:00.000Z', reasonCode: null, failureCode: null,
      },
    },
    ...overrides,
  };
}

test('structured identity confirmation atomically binds a server-read canonical person, ETag, actor, and receipt', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'server@example.edu',
    statecode: 0,
    _etag: 'W/"identity-v1"',
  });

  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: {
      email: 'staff@example.edu',
      website: 'https://example.edu/staff',
      affiliation: 'Staff-confirmed Institute',
      // Browser-shaped authority is deliberately ignored.
      canonicalPersonId: '99999999-9999-4999-8999-999999999999',
      canonicalPersonEtag: 'W/"forged"',
      actorId: 'forged-user',
    },
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, code: 'identity_confirmed', confirmationId: 'confirm-1' });
  expect(confirmIdentity).toHaveBeenCalledWith(
    REQUEST_ID,
    expect.objectContaining({
      candidateKey: candidate.candidateKey,
      name: 'Reviewer Name',
      email: 'staff@example.edu',
      affiliation: 'Staff-confirmed Institute',
    }),
    expect.objectContaining({
      actorProfileId: 'profile-1',
      actorSystemUserId: 'system-1',
      expectedUpdatedAt: 'row-version-1',
      canonicalPerson: expect.objectContaining({
        canonicalPersonId: PERSON_ID,
        canonicalPersonEtag: 'W/"identity-v1"',
        actorId: 'system-1',
        confirmedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      }),
      identityEnvelope: expect.objectContaining({
        outcome: 'current',
        receipt: expect.objectContaining({ sourceVersion: 'a'.repeat(64) }),
        evidencePatch: expect.objectContaining({
          staffIdentityConfirmation: expect.objectContaining({
            canonicalPersonId: PERSON_ID,
            canonicalPersonEtag: 'W/"identity-v1"',
            actorId: 'system-1',
          }),
        }),
      }),
    }),
  );
});

test('structured identity confirmation fails closed without an authenticated system actor', async () => {
  const candidate = structuredCandidate();
  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: null,
  });
  expect(result).toMatchObject({ success: false, code: 'invalid_identity_confirmation' });
  expect(findCandidateByKey).not.toHaveBeenCalled();
  expect(confirmIdentity).not.toHaveBeenCalled();
});

test('structured identity confirmation rejects a noncanonical browser candidate key before any read', async () => {
  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: 'candidate:legacy-browser-key',
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(findCandidateByKey).not.toHaveBeenCalled();
  expect(confirmIdentity).not.toHaveBeenCalled();
});

test('structured identity confirmation fails closed when the canonical person cannot be re-established', async () => {
  const candidate = structuredCandidate({ potentialReviewerId: null });
  findCandidateByKey.mockResolvedValue(candidate);
  resolveTrustedReviewerPerson.mockResolvedValue(null);
  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(confirmIdentity).not.toHaveBeenCalled();
});

test('structured identity confirmation rejects a person ETag change before the roster CAS', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  getById
    .mockResolvedValueOnce({
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_emailaddress: 'server@example.edu', statecode: 0, _etag: 'W/"before"',
    })
    .mockResolvedValueOnce({
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_emailaddress: 'server@example.edu', statecode: 0, _etag: 'W/"after"',
    });
  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(confirmIdentity).not.toHaveBeenCalled();
});

test('structured identity confirmation reports a stale roster CAS without issuing a usable confirmation', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'server@example.edu', statecode: 0, _etag: 'W/"identity-v1"',
  });
  confirmIdentity.mockResolvedValueOnce(null);
  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(confirmIdentity).toHaveBeenCalledWith(
    REQUEST_ID,
    expect.any(Object),
    expect.objectContaining({ expectedUpdatedAt: 'row-version-1' }),
  );
});

function installStructuredPerson({ changedBeforeCas = false, emailChangedBeforeCas = false, personId = PERSON_ID } = {}) {
  let current = {
    wmkf_potentialreviewersid: personId,
    wmkf_emailaddress: 'old@example.edu',
    wmkf_emailsource: 'research_only',
    statecode: 0,
    _etag: 'W/"before"',
    wmkf_addresstruststatejson: null,
  };
  update.mockImplementation(async (_id, patch) => {
    current = {
      ...current,
      wmkf_emailaddress: patch.email,
      wmkf_emailsource: patch.emailSource,
      wmkf_addresstruststatejson: patch.addressTrustStateJson,
      _etag: 'W/"after"',
    };
  });
  let readsAfterUpdate = 0;
  getById.mockImplementation(async () => {
    if (current._etag === 'W/"after"') {
      readsAfterUpdate += 1;
      if (changedBeforeCas && readsAfterUpdate >= 2) return { ...current, _etag: 'W/"concurrent"' };
      if (emailChangedBeforeCas && readsAfterUpdate >= 2) return { ...current, wmkf_emailaddress: 'changed@example.edu' };
    }
    return { ...current };
  });
}

test('structured address verification atomically projects server-read contact + address stages with the post-action person binding', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    email: 'verified@example.edu',
    verifiedContact: { website: 'https://example.edu/reviewer', affiliation: 'Example University' },
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, code: 'address_attested', rosterVersion: 'row-version-3' });
  expect(attestAddress).not.toHaveBeenCalled();
  expect(clearAddressTrustBlocks).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'verified@example.edu', emailSource: 'staff_verified', addressTrustStateJson: expect.any(String),
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"before"' });
  expect(completeStructuredAddressVerification).toHaveBeenCalledWith(
    REQUEST_ID,
    candidate.candidateKey,
    'row-version-1',
    expect.objectContaining({
      expectedSourceVersions: { contact: 'b'.repeat(64), address_trust: 'c'.repeat(64) },
      contactEnvelope: expect.objectContaining({
        outcome: 'current',
        receipt: expect.objectContaining({ sourceVersion: 'b'.repeat(64) }),
        evidencePatch: expect.objectContaining({
          email: 'verified@example.edu', emailSource: 'staff_verified',
          canonicalPersonId: PERSON_ID, canonicalPersonEtag: 'W/"after"', personEtag: 'W/"after"',
        }),
      }),
      addressTrustEnvelope: expect.objectContaining({
        outcome: 'current',
        receipt: expect.objectContaining({ sourceVersion: 'c'.repeat(64) }),
        evidencePatch: expect.objectContaining({
          addressTrustEmail: 'verified@example.edu', addressTrustSource: 'staff_verified',
          addressTrustEvidence: expect.objectContaining({
            canonicalPersonId: PERSON_ID, canonicalPersonEtag: 'W/"after"', actorId: 'system-1',
          }),
        }),
      }),
    }),
  );
});

test('reports Dataverse-success/roster-CAS-loss as explicit partial success, never a completed address action', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  completeStructuredAddressVerification.mockResolvedValueOnce({ outcome: 'skipped_stale' });
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer',
    actorSystemUserId: 'system-1',
  });

  expect(update).toHaveBeenCalled();
  expect(completeStructuredAddressVerification).toHaveBeenCalled();
  expect(result).toMatchObject({ success: false, partialSuccess: true, personUpdated: true, retryable: true });
  expect(result.decision).not.toBe('attested_pending_promotion');
});

test('retains administrator-only lease repair guidance when the structured roster store reports a malformed lease', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  completeStructuredAddressVerification.mockResolvedValueOnce({
    outcome: 'lease_repair_required',
    leaseStage: 'contact',
  });
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: false,
    partialSuccess: true,
    personUpdated: true,
    code: 'lease_repair_required',
    leaseStage: 'contact',
    retryable: false,
  });
  expect(result.message).toMatch(/Do not retry automatically.*Workbench administrator/i);
  expect(result.remediation).toEqual([{ action: 'create_repair_request', label: 'Create repair request' }]);
});

test('requires an authenticated system actor before any structured address mutation', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer', actorSystemUserId: null,
  });

  expect(result).toMatchObject({ success: false, code: 'invalid_address_attestation' });
  expect(update).not.toHaveBeenCalled();
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test.each([
  ['live', '2099-08-02T12:00:00.000Z', 'refresh_in_progress'],
  ['expired', '2020-08-02T12:00:00.000Z', 'lease_recovery_required'],
])('refuses a %s unrelated stage lease before the person or roster write', async (_label, refreshStartedAt, code) => {
  const candidate = structuredCandidate({
    stageRefresh: {
      eligibility: {
        refreshAttemptId: 'eligibility-attempt',
        refreshStartedAt,
      },
    },
  });
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson();

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer', actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: false, decision: 'blocked', code, leaseStage: 'eligibility' });
  expect(update).not.toHaveBeenCalled();
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test('structured identity confirmation treats a malformed lease as administrator repair, not a running refresh', async () => {
  const candidate = structuredCandidate({
    stageRefresh: {
      contact: { refreshAttemptId: '', refreshStartedAt: '2026-08-02T12:00:00.000Z' },
    },
  });
  findCandidateByKey.mockResolvedValue(candidate);

  const result = await confirmStructuredRosterIdentity({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    manualContact: { email: 'staff@example.edu' },
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: false,
    decision: 'blocked',
    code: 'lease_repair_required',
    leaseStage: 'contact',
    retryable: false,
  });
  expect(result.message).toMatch(/cannot be treated as running.*Workbench administrator/i);
  expect(result.remediation).toEqual([{ action: 'create_repair_request', label: 'Create repair request' }]);
  expect(confirmIdentity).not.toHaveBeenCalled();
  expect(getById).not.toHaveBeenCalled();
});

test('structured address verification treats a malformed lease as administrator repair before any write', async () => {
  const candidate = structuredCandidate({
    stageRefresh: {
      eligibility: { refreshAttemptId: '', refreshStartedAt: '2026-08-02T12:00:00.000Z' },
    },
  });
  findCandidateByKey.mockResolvedValue(candidate);

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    email: 'verified@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: false,
    decision: 'blocked',
    code: 'lease_repair_required',
    leaseStage: 'eligibility',
    retryable: false,
  });
  expect(result.message).toMatch(/cannot be treated as running.*Workbench administrator/i);
  expect(result.remediation).toEqual([{ action: 'create_repair_request', label: 'Create repair request' }]);
  expect(update).not.toHaveBeenCalled();
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test('rejects a changed person ETag before projecting the roster pair', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson({ changedBeforeCas: true });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer', actorSystemUserId: 'system-1',
  });

  expect(update).toHaveBeenCalled();
  expect(result).toMatchObject({ success: false, partialSuccess: true, code: 'candidate_stale' });
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test('rejects a changed person email before projecting the roster pair', async () => {
  const candidate = structuredCandidate();
  findCandidateByKey.mockResolvedValue(candidate);
  installStructuredPerson({ emailChangedBeforeCas: true });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey: candidate.candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer', actorSystemUserId: 'system-1',
  });

  expect(update).toHaveBeenCalled();
  expect(result).toMatchObject({ success: false, partialSuccess: true, code: 'candidate_stale' });
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});

test.each([
  ['missing roster candidate', () => {
    findCandidateByKey.mockResolvedValueOnce(null);
    return `person:${PERSON_ID}`;
  }],
  ['wrong request suggestion', () => {
    const candidate = structuredCandidate({ candidateKey: `suggestion:${SUGGESTION_ID}`, suggestionId: SUGGESTION_ID });
    findCandidateByKey.mockResolvedValue(candidate);
    findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: '44444444-4444-4444-8444-444444444444',
      _wmkf_potentialreviewer_value: PERSON_ID,
    });
    return candidate.candidateKey;
  }],
  ['wrong canonical person', () => {
    const candidate = structuredCandidate();
    findCandidateByKey.mockResolvedValue(candidate);
    installStructuredPerson({ personId: '44444444-4444-4444-8444-444444444444' });
    return candidate.candidateKey;
  }],
])('fails closed for %s before the person write', async (_label, arrange) => {
  const candidateKey = arrange();
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID, candidateKey, email: 'verified@example.edu',
    evidenceType: 'institution_page', evidenceUrl: 'https://example.edu/reviewer', actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(update).not.toHaveBeenCalled();
  expect(completeStructuredAddressVerification).not.toHaveBeenCalled();
});
