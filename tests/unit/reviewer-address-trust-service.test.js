/** @jest-environment node */

const findById = jest.fn();
const getById = jest.fn();
const update = jest.fn();
const attestAddress = jest.fn();
const clearAddressTrustBlocks = jest.fn();
const findCandidatesByKeys = jest.fn();
const recordSurfaced = jest.fn();
const resolveTrustedReviewerPerson = jest.fn();

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
  findCandidatesByKeys: (...args) => findCandidatesByKeys(...args),
  recordSurfaced: (...args) => recordSurfaced(...args),
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
  recordSurfaced.mockResolvedValue(1);
  resolveTrustedReviewerPerson.mockResolvedValue(null);
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

test('ordinary roster conflict can choose the newly found address with fresh evidence', async () => {
  const candidateKey = 'suggestion:row';
  const conflict = createConflictPendingState({
    email: 'reviewer@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2020-01-01T00:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    suggestionId: SUGGESTION_ID,
    addressConflictPending: true,
    rosterStatus: 'active',
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'reviewer@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    _etag: 'W/"person"',
  });
  attestAddress.mockResolvedValueOnce({
    receiptId: 'receipt-1',
    receipt: {
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
      attestedAt: '2026-07-31T22:00:00.000Z',
    },
    candidate: { rosterUpdatedAt: 'row-version-2' },
  });
  clearAddressTrustBlocks.mockResolvedValueOnce({
    candidateKey,
    email: 'found@example.edu',
    addressConflictPending: false,
  });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'found@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, decision: 'address_conflict_resolved' });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'found@example.edu',
    emailSource: 'staff_verified',
  }), expect.objectContaining({ ifMatch: 'W/"person"' }));
  const bundle = JSON.parse(update.mock.calls[0][1].addressTrustStateJson);
  expect(bundle.resolution).toMatchObject({ decision: 'use_found' });
  expect(clearAddressTrustBlocks).toHaveBeenCalledWith(REQUEST_ID, candidateKey, {
    receiptId: 'receipt-1',
    expectedUpdatedAt: 'row-version-2',
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

test('a Dataverse failure after roster attestation returns explicit partial success and the authoritative candidate', async () => {
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
    addressConflictPending: true,
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    statecode: 0,
    _etag: 'W/"person"',
  });
  attestAddress.mockResolvedValueOnce({
    receiptId: 'receipt-1',
    receipt: {
      receiptId: 'receipt-1',
      email: 'found@example.edu',
      personConfirmed: true,
      requestId: REQUEST_ID,
      candidateKey,
      evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile',
      attestedAt: '2026-07-31T21:00:00.000Z',
    },
    candidate: { candidateKey, rosterUpdatedAt: 'row-version-2' },
  });
  update.mockRejectedValueOnce(new Error('Dataverse unavailable'));

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'found@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({
    success: false,
    code: 'conflict_record_unavailable',
    partialSuccess: true,
    receiptRecorded: true,
    receiptId: 'receipt-1',
    candidate: { rosterUpdatedAt: 'row-version-2' },
  });
  expect(result.remediation).not.toHaveLength(0);
});

test('a concurrent person edit after roster attestation is a retryable stale 409 result, not a generic failure', async () => {
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
    addressConflictPending: true,
  }]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    statecode: 0,
    _etag: 'W/"person"',
  });
  attestAddress.mockResolvedValueOnce({
    receiptId: 'receipt-1',
    receipt: {
      receiptId: 'receipt-1', email: 'stored@example.edu', personConfirmed: true,
      requestId: REQUEST_ID, candidateKey, evidenceType: 'institution_page',
      evidenceUrl: 'https://example.edu/profile', attestedAt: '2026-07-31T21:00:00.000Z',
    },
    candidate: { candidateKey, rosterUpdatedAt: 'row-version-2' },
  });
  update.mockRejectedValueOnce(Object.assign(new Error('Precondition Failed'), { status: 412 }));

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'stored@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({
    success: false,
    code: 'candidate_stale',
    partialSuccess: true,
    receiptRecorded: true,
  });
  expect(result.remediation).toEqual(expect.arrayContaining([
    expect.objectContaining({ action: 'retry_check' }),
  ]));
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
