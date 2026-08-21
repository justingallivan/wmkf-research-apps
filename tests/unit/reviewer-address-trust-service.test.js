/** @jest-environment node */

const findById = jest.fn();
const getById = jest.fn();
const findByEmailCandidates = jest.fn();
const update = jest.fn();
const attestAddress = jest.fn();
const clearAddressTrustBlocks = jest.fn();
const findCandidatesByKeys = jest.fn();
const recordSurfaced = jest.fn();
const resolveTrustedReviewerPerson = jest.fn();
const getRequestById = jest.fn();
const notify = jest.fn(async () => ({ id: 'alert-1' }));
const getOpenAlertsByTypeAndRequestId = jest.fn(async () => []);
const autoResolve = jest.fn(async () => 0);

jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...args) => getRequestById(...args),
}));

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...args) => getById(...args),
  findByEmailCandidates: (...args) => findByEmailCandidates(...args),
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
  default: { notify: (...args) => notify(...args) },
}));
jest.mock('../../lib/services/alert-service', () => ({
  __esModule: true,
  default: {
    getOpenAlertsByTypeAndRequestId: (...args) => getOpenAlertsByTypeAndRequestId(...args),
    autoResolve: (...args) => autoResolve(...args),
  },
}));

const {
  getAddressConflict,
  getAddressRepairRequestContext,
  createAddressRepairRequest,
  listOpenAddressRepairRequests,
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
      evidenceType: 'staff_address_choice',
      evidenceUrl: null,
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
  findByEmailCandidates.mockResolvedValue({ none: true });
  update.mockResolvedValue(undefined);
  findCandidatesByKeys.mockResolvedValue([]);
  clearAddressTrustBlocks.mockResolvedValue(null);
  recordSurfaced.mockResolvedValue(1);
  resolveTrustedReviewerPerson.mockResolvedValue(null);
  getRequestById.mockResolvedValue({
    akoya_requestnum: '1000001',
    akoya_title: 'Test request',
  });
  notify.mockResolvedValue({ id: 'alert-1' });
  getOpenAlertsByTypeAndRequestId.mockResolvedValue([]);
  autoResolve.mockResolvedValue(0);
});

test('open repair projection keeps only server-owned candidate keys and one newest alert per candidate', async () => {
  getOpenAlertsByTypeAndRequestId.mockResolvedValueOnce([
    { id: 491, status: 'acknowledged', metadata: { candidateKey: 'candidate:reviewer' } },
    { id: 490, status: 'active', metadata: { candidateKey: 'candidate:reviewer' } },
    { id: 489, status: 'active', metadata: { candidateKey: 'candidate:other-request' } },
  ]);

  await expect(listOpenAddressRepairRequests({
    requestId: REQUEST_ID,
    candidateKeys: ['candidate:reviewer'],
  })).resolves.toEqual([{
    alertId: 491,
    candidateKey: 'candidate:reviewer',
    status: 'acknowledged',
  }]);
});

test('create repair request returns an acknowledged request instead of notifying again', async () => {
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey: 'candidate:reviewer',
    name: 'Reviewer Name',
    rosterStatus: 'active',
    conflictRecordUnavailable: true,
  }]);
  getOpenAlertsByTypeAndRequestId.mockResolvedValueOnce([{
    id: 491,
    status: 'acknowledged',
    metadata: { candidateKey: 'candidate:reviewer' },
  }]);

  await expect(createAddressRepairRequest({
    requestId: REQUEST_ID,
    candidateKey: 'candidate:reviewer',
    code: 'different_client_code',
  })).resolves.toMatchObject({
    success: true,
    decision: 'repair_requested',
    repairReference: 491,
    repairRequest: {
      alertId: 491,
      candidateKey: 'candidate:reviewer',
      status: 'acknowledged',
    },
    message: expect.stringContaining('already pending'),
  });
  expect(notify).not.toHaveBeenCalled();
});

test('create repair request returns the newly-created durable pending state', async () => {
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey: 'candidate:reviewer',
    name: 'Reviewer Name',
    rosterStatus: 'active',
    conflictRecordUnavailable: true,
  }]);

  await expect(createAddressRepairRequest({
    requestId: REQUEST_ID,
    candidateKey: 'candidate:reviewer',
    code: 'conflict_record_unavailable',
  })).resolves.toMatchObject({
    success: true,
    repairReference: 'alert-1',
    repairRequest: {
      alertId: 'alert-1',
      candidateKey: 'candidate:reviewer',
      status: 'active',
    },
  });
  expect(notify).toHaveBeenCalledTimes(1);
});

test('repair alert lock identity is candidate-scoped rather than reason-code-scoped', async () => {
  const candidate = {
    candidateKey: 'candidate:reviewer',
    name: 'Reviewer Name',
    rosterStatus: 'active',
    conflictRecordUnavailable: true,
  };
  findCandidatesByKeys.mockResolvedValue([candidate]);

  await createAddressRepairRequest({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    code: 'address_conflict_pending',
  });
  await createAddressRepairRequest({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    code: 'person_inactive',
  });

  expect(notify).toHaveBeenCalledTimes(2);
  expect(notify.mock.calls[0][0].autoResolveKey).toBe(notify.mock.calls[1][0].autoResolveKey);
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

test('already-promoted conflict can keep the stored address with the exact person ETag', async () => {
  const candidateKey = `suggestion:${SUGGESTION_ID}`;
  const conflict = createConflictPendingState({
    email: 'reviewer@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T19:00:00.000Z',
  });
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'reviewer@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
    statecode: 0,
    _etag: 'W/"person-choice"',
  });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'staff_address_choice',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: true,
    selectedDecision: 'keep_stored',
    personUpdated: true,
  });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'reviewer@example.edu',
    emailSource: 'staff_verified',
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"person-choice"' });
  expect(JSON.parse(update.mock.calls[0][1].addressTrustStateJson).resolution)
    .toMatchObject({ decision: 'keep_stored' });
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

test('staff address choices are rejected unless the server can re-read a pending conflict', async () => {
  const suggestionResult = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'staff_address_choice',
  });
  expect(suggestionResult).toMatchObject({
    success: false,
    code: 'invalid_address_attestation',
  });

  for (const rosterStatus of ['active', 'saved']) {
    findCandidatesByKeys.mockResolvedValueOnce([{
      candidateKey: 'candidate:reviewer',
      rosterStatus,
      email: 'reviewer@example.edu',
      contactEnrichment: { email: 'reviewer@example.edu' },
    }]);
    const rosterResult = await verifyPersonAndAddress({
      requestId: REQUEST_ID,
      candidateKey: 'candidate:reviewer',
      email: 'reviewer@example.edu',
      evidenceType: 'staff_address_choice',
    });
    expect(rosterResult).toMatchObject({
      success: false,
      code: 'invalid_address_attestation',
    });
  }
  expect(attestAddress).not.toHaveBeenCalled();
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

test('roster verification carries the complete verified contact into the atomic attestation write', async () => {
  const candidateKey = 'candidate:tatiana';
  const verifiedContact = {
    website: 'https://example.edu/current-profile',
    affiliation: 'Current Department',
  };
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'Tatiana Kutateladze',
    email: 'tatiana@example.edu',
    rosterStatus: 'active',
  }]);
  attestAddress.mockResolvedValueOnce({
    receiptId: 'receipt-current',
    candidate: {
      candidateKey,
      name: 'Tatiana Kutateladze',
      email: 'tatiana@example.edu',
      ...verifiedContact,
      pdIdentityConfirmationId: 'confirmation-current',
    },
  });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'tatiana@example.edu',
    verifiedContact,
    evidenceType: 'institution_page',
    evidenceUrl: verifiedContact.website,
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(attestAddress).toHaveBeenCalledWith(REQUEST_ID, candidateKey, {
    email: 'tatiana@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: verifiedContact.website,
    note: undefined,
    verifiedContact,
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });
  expect(result).toMatchObject({
    success: true,
    decision: 'attested_pending_promotion',
    candidate: { pdIdentityConfirmationId: 'confirmation-current' },
  });
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

test('repair alert context re-reads request, conflict, and bounded evidence from server-owned keys', async () => {
  const candidateKey = 'candidate:reviewer';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@lab.example.edu',
    reason: 'email_mismatch',
    source: 'scholarly_multi',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'Reviewer Name',
    affiliation: 'Example University',
    email: 'found@lab.example.edu',
    rosterStatus: 'active',
    identityStatus: 'confirmed',
    emailPersistAllowed: true,
    addressConflictPending: true,
    website: 'https://example.edu/reviewer',
    orcid: '0000-0002-1825-0097',
    contactEnrichment: {
      emailSource: 'scholarly_multi',
      emailEvidence: {
        sourceUrl: 'javascript:alert(1)',
        publications: [{ title: 'Evidence paper', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' }],
      },
    },
  }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: {
      wmkf_name: 'Reviewer Name',
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(conflict),
    },
  });

  await expect(getAddressRepairRequestContext({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'address_conflict_pending',
  })).resolves.toMatchObject({
    request: { id: REQUEST_ID, number: '1000001', title: 'Test request' },
    reviewer: { candidateKey, name: 'Reviewer Name', affiliation: 'Example University' },
    issue: {
      status: 'conflict_pending',
      storedEmail: 'stored@example.edu',
      foundEmail: 'found@lab.example.edu',
      source: 'scholarly_multi',
      recommendedAction: 'review_address_conflict',
    },
    evidenceLinks: [
      { label: 'Institution or lab profile', url: 'https://example.edu/reviewer' },
      { label: 'ORCID profile', url: 'https://orcid.org/0000-0002-1825-0097' },
      { label: 'Evidence paper', url: 'https://pubmed.ncbi.nlm.nih.gov/1/' },
    ],
    workbenchUrl: expect.stringContaining(`repairCandidate=${encodeURIComponent(candidateKey)}`),
  });
  expect(getRequestById).toHaveBeenCalledWith(REQUEST_ID, {
    select: 'akoya_requestnum,akoya_title',
  });
  expect(update).not.toHaveBeenCalled();
  expect(recordSurfaced).not.toHaveBeenCalled();
});

test('repair alert context recommends identity confirmation when the highlighted card gates address review', async () => {
  const candidateKey = 'candidate:unresolved-reviewer';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@lab.example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'Unresolved Reviewer',
    email: 'found@lab.example.edu',
    rosterStatus: 'active',
    identityStatus: 'unresolved',
    addressConflictPending: true,
  }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: {
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(conflict),
    },
  });

  await expect(getAddressRepairRequestContext({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'address_conflict_pending',
  })).resolves.toMatchObject({
    issue: {
      status: 'conflict_pending',
      recommendedAction: 'confirm_identity',
    },
  });
});

test('repair alert context stays generic when Confirm identity is suppressed by a card blocker', async () => {
  const candidateKey = 'candidate:blocked-unresolved-reviewer';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@lab.example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'Blocked Reviewer',
    email: 'found@lab.example.edu',
    rosterStatus: 'active',
    identityStatus: 'unresolved',
    addressConflictPending: true,
    hasInstitutionCOI: true,
  }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: {
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(conflict),
    },
  });

  await expect(getAddressRepairRequestContext({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'address_conflict_pending',
  })).resolves.toMatchObject({
    issue: { recommendedAction: 'use_primary_action' },
  });
});

test('suggestion repair context falls back to Dataverse and deep-links to Invite when its roster row is gone', async () => {
  const candidateKey = `suggestion:${SUGGESTION_ID}`;
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T20:00:00.000Z',
  });
  findCandidatesByKeys.mockResolvedValueOnce([]);
  getById.mockResolvedValue({
    wmkf_name: 'Saved Reviewer',
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: JSON.stringify(conflict),
  });

  const context = await getAddressRepairRequestContext({
    requestId: REQUEST_ID,
    candidateKey,
    suggestionId: SUGGESTION_ID,
    code: 'address_conflict_pending',
  });

  expect(context).toMatchObject({
    workbenchSurface: 'invite',
    issue: { recommendedAction: 'review_repair' },
    workbenchUrl: expect.stringContaining(`sub=candidates&repairSuggestion=${SUGGESTION_ID}`),
  });
});

test('a staff-verified conflict with a cleared roster block is ready to close, not repair again', async () => {
  const candidateKey = 'candidate:resolved-reviewer';
  const prior = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: REQUEST_ID,
    candidateKey,
    detectedAt: '2026-08-20T20:00:00.000Z',
  });
  const resolved = createStaffVerifiedState({
    email: 'stored@example.edu',
    requestId: REQUEST_ID,
    candidateKey,
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
    attestedAt: '2026-08-20T21:00:00.000Z',
    resolution: {
      conflict: prior.conflict,
      decision: 'keep_stored',
      resolvedAt: '2026-08-20T21:00:00.000Z',
    },
  });
  findCandidatesByKeys.mockResolvedValueOnce([{
    candidateKey,
    name: 'Resolved Reviewer',
    email: 'stored@example.edu',
    rosterStatus: 'active',
    addressConflictPending: false,
    conflictRecordUnavailable: false,
  }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: {
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(resolved),
    },
  });

  await expect(getAddressRepairRequestContext({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'address_conflict_pending',
  })).resolves.toMatchObject({
    issue: { status: 'ready_to_close', recommendedAction: 'resolve_alert' },
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
    conflictRecordUnavailable: true,
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
      evidenceType: 'staff_address_choice',
      evidenceUrl: null,
      note: null,
      attestedAt: '2026-07-31T22:00:00.000Z',
    },
    candidate: { rosterUpdatedAt: 'row-version-2' },
  });
  clearAddressTrustBlocks.mockResolvedValueOnce({
    candidateKey,
    suggestionId: SUGGESTION_ID,
    email: 'found@example.edu',
    addressConflictPending: false,
  });
  getOpenAlertsByTypeAndRequestId.mockResolvedValueOnce([
    {
      id: 491,
      auto_resolve_key: 'stored-resolution-key',
      metadata: { candidateKey },
    },
    {
      id: 492,
      auto_resolve_key: 'legacy-divergent-key',
      metadata: { candidateKey },
    },
  ]);
  autoResolve
    .mockResolvedValueOnce(3)
    .mockResolvedValueOnce(0);

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'found@example.edu',
    evidenceType: 'staff_address_choice',
    evidenceUrl: null,
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: true,
    decision: 'address_conflict_resolved',
    selectedDecision: 'use_found',
    alertCloseout: { expectedCount: 2, resolvedCount: 3, status: 'resolved' },
  });
  expect(autoResolve).toHaveBeenCalledTimes(2);
  expect(autoResolve).toHaveBeenNthCalledWith(1, 'stored-resolution-key');
  expect(autoResolve).toHaveBeenNthCalledWith(2, 'legacy-divergent-key');
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'found@example.edu',
    emailSource: 'staff_verified',
  }), expect.objectContaining({ ifMatch: 'W/"person"' }));
  const bundle = JSON.parse(update.mock.calls[0][1].addressTrustStateJson);
  expect(bundle.resolution).toMatchObject({ decision: 'use_found' });
  expect(clearAddressTrustBlocks).toHaveBeenCalledWith(REQUEST_ID, candidateKey, {
    receiptId: 'receipt-1',
    expectedUpdatedAt: 'row-version-2',
    addressChoice: {
      decision: 'use_found',
      selectedEmail: 'found@example.edu',
    },
  });
});

test('ordinary verification cannot create a receipt while a failed conflict write has no durable bundle', async () => {
  const candidate = failedWriteCandidate();
  findCandidatesByKeys.mockResolvedValueOnce([candidate]);
  getById.mockResolvedValueOnce({
    wmkf_emailaddress: 'stored@example.edu',
    wmkf_addresstruststatejson: null,
    statecode: 0,
    _etag: 'W/"person"',
  });

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey: candidate.candidateKey,
    email: 'found@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({
    success: false,
    code: 'conflict_record_unavailable',
    remediation: expect.arrayContaining([
      expect.objectContaining({ action: 'retry_check' }),
      expect.objectContaining({ action: 'create_repair_request' }),
      expect.objectContaining({ action: 'set_aside' }),
    ]),
  });
  expect(attestAddress).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
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

test('structural retry rechecks an AkoyaGO inactive-person repair and clears the client block', async () => {
  const candidateKey = 'suggestion:row';
  const candidate = {
    candidateKey,
    suggestionId: SUGGESTION_ID,
    potentialReviewerId: PERSON_ID,
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    serverRepairReason: 'person_inactive',
  };
  const refreshed = { ...candidate, rosterUpdatedAt: 'row-version-2' };
  delete refreshed.serverRepairReason;
  findCandidatesByKeys
    .mockResolvedValueOnce([candidate])
    .mockResolvedValueOnce([refreshed]);
  getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: PERSON_ID,
    statecode: 0,
    _etag: 'W/"person"',
  });

  const result = await retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'person_inactive',
  });

  expect(result).toMatchObject({
    success: true,
    decision: 'structural_state_refreshed',
    candidate: expect.not.objectContaining({ serverRepairReason: expect.anything() }),
  });
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQUEST_ID,
    [expect.not.objectContaining({ serverRepairReason: expect.anything() })],
    { expectedUpdatedAt: 'row-version-1' },
  );
});

test('structural retry rechecks exact email ownership before clearing a duplicate-owner block', async () => {
  const candidateKey = 'suggestion:row';
  const candidate = {
    candidateKey,
    suggestionId: SUGGESTION_ID,
    potentialReviewerId: PERSON_ID,
    email: 'reviewer@example.edu',
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    serverRepairReason: 'email_conflict',
  };
  findCandidatesByKeys
    .mockResolvedValueOnce([candidate])
    .mockResolvedValueOnce([{ ...candidate, serverRepairReason: undefined }]);
  getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: candidate.email,
    statecode: 0,
  });
  findByEmailCandidates.mockResolvedValueOnce({
    one: true,
    id: PERSON_ID,
    row: { wmkf_potentialreviewersid: PERSON_ID, statecode: 0 },
  });

  await expect(retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'email_conflict',
  })).resolves.toMatchObject({ success: true, decision: 'structural_state_refreshed' });
  expect(findByEmailCandidates).toHaveBeenCalledWith(candidate.email);
});

test('structural retry requires a fresh trusted identity before clearing Contact linkage', async () => {
  const candidateKey = 'candidate:linked';
  const candidate = {
    candidateKey,
    name: 'Linked Reviewer',
    rosterStatus: 'active',
    rosterUpdatedAt: 'row-version-1',
    serverRepairReason: 'contact_linked_elsewhere',
    contactEnrichment: {
      dataverseContactEvidence: { status: 'review_required', reason: 'contact_linked_elsewhere' },
    },
  };
  findCandidatesByKeys
    .mockResolvedValueOnce([candidate])
    .mockResolvedValueOnce([{ ...candidate, serverRepairReason: undefined }]);
  resolveTrustedReviewerPerson.mockResolvedValueOnce({
    personId: PERSON_ID,
    person: { wmkf_potentialreviewersid: PERSON_ID, statecode: 0 },
  });

  await expect(retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    code: 'contact_linked_elsewhere',
  })).resolves.toMatchObject({ success: true, decision: 'structural_state_refreshed' });
  expect(recordSurfaced).toHaveBeenCalledWith(
    REQUEST_ID,
    [expect.objectContaining({
      contactEnrichment: expect.objectContaining({
        dataverseContactEvidence: expect.objectContaining({ status: 'known', reason: null }),
      }),
    })],
    { expectedUpdatedAt: 'row-version-1' },
  );
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
    evidenceType: 'staff_address_choice',
    evidenceUrl: null,
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
    suggestionId: SUGGESTION_ID,
    email: 'found@example.edu',
    addressConflictPending: false,
  });
  getOpenAlertsByTypeAndRequestId.mockResolvedValueOnce([{
    id: 491,
    auto_resolve_key: 'stored-resolution-key',
    metadata: { candidateKey },
  }]);
  autoResolve.mockRejectedValueOnce(new Error('alert store unavailable'));

  const result = await retryAddressCheck({
    requestId: REQUEST_ID,
    candidateKey,
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({
    success: true,
    decision: 'address_conflict_resolved',
    selectedDecision: 'use_found',
    personUpdated: true,
    rosterCleared: true,
    alertCloseout: { expectedCount: 1, resolvedCount: 0, status: 'incomplete' },
  });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'found@example.edu',
    emailSource: 'staff_verified',
    addressTrustStateJson: expect.stringContaining('staff_verified'),
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"person"' });
  expect(update.mock.calls[0][1].addressTrustStateJson).not.toContain('conflict_pending');
  expect(clearAddressTrustBlocks).toHaveBeenCalledWith(REQUEST_ID, candidateKey, {
    receiptId: 'receipt-1',
    expectedUpdatedAt: 'row-version-2',
    addressChoice: {
      decision: 'use_found',
      selectedEmail: 'found@example.edu',
    },
  });
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

test('verification records partial success but does not update a pending person conflict without an ETag', async () => {
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

  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    candidateKey,
    email: 'found@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });

  expect(result).toMatchObject({
    success: false,
    code: 'candidate_stale',
    partialSuccess: true,
    receiptRecorded: true,
  });
  expect(update).not.toHaveBeenCalled();
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
