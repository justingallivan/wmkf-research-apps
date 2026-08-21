/** @jest-environment node */

import {
  compactDataverseContactEvidence,
  loadPriorRequestContext,
  reconcileReviewerContacts,
  resolveTrustedReviewerPerson,
} from '../../lib/services/reviewer-contact-reconciliation';
import {
  createConflictPendingState,
  createStaffVerifiedState,
} from '../../lib/utils/reviewer-address-trust';
import { createServerIdentityDecisionReceipt } from '../../lib/services/reviewer-candidate-attestation';

const ORCID = '0000-0002-1825-0097';
const CURRENT_REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const PRIOR_REQUEST_ID = '22222222-2222-2222-2222-222222222222';

function candidate(name, enrichment = {}) {
  const row = {
    name,
    contactEnrichment: {
      identity: { status: 'probable' },
      ...enrichment,
    },
  };
  return {
    ...row,
    serverIdentityDecisionReceipt: createServerIdentityDecisionReceipt(row),
  };
}

function exactOrcidOutcome() {
  return {
    outcome: 'confident',
    match: {
      reviewerId: '33333333-3333-3333-3333-333333333333',
      matchKey: 'orcid',
      nameConsistent: true,
      context: { email: 'stored@example.edu' },
    },
    referencedReviewers: [{ reviewerId: 'hidden', institutions: [] }],
    referencedContacts: [],
  };
}

test('legacy request slots provide prior context when suggestion history is empty', async () => {
  const findRequestsByIds = jest.fn();
  const result = await loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => ({ records: [], hasMore: false })),
      findLegacyRequests: jest.fn(async () => ({
        records: [{
          akoya_requestid: PRIOR_REQUEST_ID,
          akoya_requestnum: '1002278',
          akoya_title: 'Deciphering the role of the secretome in aging',
          akoya_fiscalyear: 'June 2026',
          wmkf_meetingdate: '2026-06-04',
          createdon: 'do-not-project',
          _wmkf_potentialreviewer4_value: 'do-not-project',
        }],
        hasMore: false,
      })),
      findRequestsByIds,
    },
  );

  expect(findRequestsByIds).not.toHaveBeenCalled();
  expect(result).toEqual({
    complete: true,
    totalCount: 1,
    requests: [{
      requestId: PRIOR_REQUEST_ID,
      requestNumber: '1002278',
      title: 'Deciphering the role of the secretome in aging',
      fiscalYear: 'June 2026',
      meetingDate: '2026-06-04',
    }],
  });
  expect(JSON.stringify(result)).not.toContain('potentialreviewer4');
  expect(JSON.stringify(result)).not.toContain('createdon');
});

test('suggestion and legacy links exclude the current request, dedupe, sort, and cap', async () => {
  const ids = [
    PRIOR_REQUEST_ID,
    CURRENT_REQUEST_ID,
    '44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555',
    '66666666-6666-6666-6666-666666666666',
  ];
  const records = [
    { akoya_requestid: ids[0], akoya_requestnum: '1002278', akoya_fiscalyear: 'June 2026', wmkf_meetingdate: '2026-06-04' },
    { akoya_requestid: ids[2], akoya_requestnum: '1002400', akoya_fiscalyear: 'September 2026', wmkf_meetingdate: '2026-09-10' },
    { akoya_requestid: ids[3], akoya_requestnum: '1002100', akoya_fiscalyear: 'March 2026', wmkf_meetingdate: '2026-03-12' },
    { akoya_requestid: ids[4], akoya_requestnum: '1001900', akoya_fiscalyear: 'December 2025', wmkf_meetingdate: '2025-12-01' },
  ];
  const findRequestsByIds = jest.fn(async (requestIds) => ({
    records: records.filter((row) => requestIds.includes(row.akoya_requestid)),
    hasMore: false,
  }));

  const result = await loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => ({
        records: ids.map((id) => ({ _wmkf_request_value: id })),
        hasMore: false,
      })),
      findLegacyRequests: jest.fn(async () => ({ records: [records[0]], hasMore: false })),
      findRequestsByIds,
    },
  );

  expect(findRequestsByIds).toHaveBeenCalledWith(
    [PRIOR_REQUEST_ID, ids[2], ids[3], ids[4]],
    expect.objectContaining({ top: 4 }),
  );
  expect(result.complete).toBe(true);
  expect(result.totalCount).toBe(4);
  expect(result.requests.map((row) => row.requestNumber)).toEqual(['1002400', '1002278', '1002100']);
  expect(JSON.stringify(result)).not.toContain(CURRENT_REQUEST_ID);
});

test('partial source results render available rows without claiming a total', async () => {
  const result = await loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => { throw new Error('suggestions unavailable'); }),
      findLegacyRequests: jest.fn(async () => ({
        records: [{
          akoya_requestid: PRIOR_REQUEST_ID,
          akoya_requestnum: '1002278',
          akoya_fiscalyear: 'June 2026',
          wmkf_meetingdate: '2026-06-04',
        }],
        hasMore: true,
      })),
      findRequestsByIds: jest.fn(),
    },
  );

  expect(result).toMatchObject({ complete: false, requests: [{ requestNumber: '1002278' }] });
  expect(result).not.toHaveProperty('totalCount');
});

test('a capped source count marks history partial even when Dataverse omits a next link', async () => {
  const records = Array.from({ length: 25 }, (_, index) => ({
    akoya_requestid: `prior-request-${index}`,
    akoya_requestnum: String(1002000 + index),
    akoya_fiscalyear: 'June 2026',
  }));
  const result = await loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => ({
        records: [],
        totalCount: 0,
        hasMore: false,
      })),
      findLegacyRequests: jest.fn(async () => ({
        records,
        totalCount: 26,
        hasMore: false,
      })),
      findRequestsByIds: jest.fn(),
    },
  );

  expect(result).toMatchObject({ complete: false });
  expect(result).not.toHaveProperty('totalCount');
  expect(result.requests).toHaveLength(3);
});

test('a valid meeting date sorts ahead of an undated row before fiscal-year fallback', async () => {
  const result = await loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => ({ records: [], hasMore: false })),
      findLegacyRequests: jest.fn(async () => ({
        records: [
          {
            akoya_requestid: 'dated-request',
            akoya_requestnum: '1002000',
            akoya_fiscalyear: null,
            wmkf_meetingdate: '2026-06-04',
          },
          {
            akoya_requestid: 'undated-request',
            akoya_requestnum: '1003000',
            akoya_fiscalyear: 'June 2027',
            wmkf_meetingdate: null,
          },
        ],
        hasMore: false,
      })),
      findRequestsByIds: jest.fn(),
    },
  );

  expect(result.requests.map((row) => row.requestId))
    .toEqual(['dated-request', 'undated-request']);
});

test('both history sources failing omits context instead of asserting zero history', async () => {
  await expect(loadPriorRequestContext(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
    {
      findSuggestionLinks: jest.fn(async () => { throw new Error('suggestions unavailable'); }),
      findLegacyRequests: jest.fn(async () => { throw new Error('requests unavailable'); }),
      findRequestsByIds: jest.fn(),
    },
  )).resolves.toBeNull();
});

test('confident exact email becomes known without exposing Dataverse ids', () => {
  const evidence = compactDataverseContactEvidence({
    outcome: 'confident',
    match: {
      reviewerId: 'reviewer-secret-id',
      contactId: 'contact-secret-id',
      matchKey: 'email',
      nameConsistent: true,
    },
    referencedReviewers: [{
      reviewerId: 'reviewer-secret-id',
      institutions: [
        { value: 'Stanford University', source: 'staff_confirmed' },
        { value: 'Northwestern University', source: 'primary_affiliation' },
      ],
    }],
    referencedContacts: [{ contactId: 'contact-secret-id' }],
  }, { checkedAt: '2026-07-21T12:00:00.000Z' });

  expect(evidence).toEqual({
    status: 'known',
    matchKey: 'email',
    recordKinds: ['potential_reviewer', 'contact'],
    nameConsistent: true,
    institutions: [
      { value: 'Stanford University', source: 'staff_confirmed' },
      { value: 'Northwestern University', source: 'primary_affiliation' },
    ],
    reason: null,
    checkedAt: '2026-07-21T12:00:00.000Z',
  });
  expect(JSON.stringify(evidence)).not.toContain('secret-id');
});

test('a provisional OpenAlex ORCID hit can only require review', async () => {
  const lookup = jest.fn(async () => ({
    outcome: 'confident',
    match: { matchKey: 'orcid', nameConsistent: true },
    referencedReviewers: [{ reviewerId: 'hidden', institutions: [] }],
    referencedContacts: [],
  }));
  const rows = [candidate('Ahmad Khalil', {
    identity: { status: 'unresolved' },
    tierResults: { openalex_author: { orcid: ORCID } },
  })];

  await reconcileReviewerContacts(rows, {
    lookup,
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(lookup).toHaveBeenCalledWith(
    { name: 'Ahmad Khalil', email: null, orcid: ORCID },
    { allowNameFallback: false },
  );
  expect(rows[0].contactEnrichment.dataverseContactEvidence).toMatchObject({
    status: 'review_required',
    reason: 'provisional_orcid_match',
  });
});

test('a provisional provider ORCID cannot resolve a person for a durable write', async () => {
  const lookup = jest.fn();
  const getReviewer = jest.fn();
  const result = await resolveTrustedReviewerPerson(candidate('J. Smith', {
    identity: { status: 'unresolved', anchors: [] },
    tierResults: { openalex_author: { orcid: ORCID } },
  }), { lookup, getReviewer });

  expect(result).toBeNull();
  expect(lookup).not.toHaveBeenCalled();
  expect(getReviewer).not.toHaveBeenCalled();
});

test('only an active reviewer matched through an anchor-grounded ORCID is a durable write target', async () => {
  const row = candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  });
  // Address adjudication may update these mutable contact fields after the
  // server identity decision was recorded; it must not invalidate person identity.
  row.email = 'corrected@example.edu';
  row.affiliation = 'Corrected University';
  row.contactEnrichment.email = 'corrected@example.edu';
  const lookup = jest.fn(async () => ({
    outcome: 'confident',
    match: { reviewerId: 'reviewer-1', matchKey: 'orcid', nameConsistent: true },
  }));
  const getReviewer = jest.fn(async () => ({
    wmkf_potentialreviewersid: 'reviewer-1',
    statecode: 0,
  }));

  await expect(resolveTrustedReviewerPerson(row, { lookup, getReviewer })).resolves.toEqual({
    personId: 'reviewer-1',
    person: { wmkf_potentialreviewersid: 'reviewer-1', statecode: 0 },
  });
  getReviewer.mockResolvedValueOnce({ wmkf_potentialreviewersid: 'reviewer-1', statecode: 1 });
  await expect(resolveTrustedReviewerPerson(row, { lookup, getReviewer })).resolves.toBeNull();
  getReviewer.mockResolvedValueOnce({ wmkf_potentialreviewersid: 'reviewer-1', statecode: 1 });
  await expect(resolveTrustedReviewerPerson(row, {
    lookup,
    getReviewer,
    allowInactive: true,
  })).resolves.toEqual({
    personId: 'reviewer-1',
    person: { wmkf_potentialreviewersid: 'reviewer-1', statecode: 1 },
  });
});

test('an otherwise trusted ORCID cannot authorize a durable lookup without the server-bound identity receipt', async () => {
  const row = candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  });
  delete row.serverIdentityDecisionReceipt;
  const lookup = jest.fn();

  await expect(resolveTrustedReviewerPerson(row, { lookup })).resolves.toBeNull();
  expect(lookup).not.toHaveBeenCalled();
});

test('an ORCID explicitly grounded by a trusted identity anchor can become known', async () => {
  const lookup = jest.fn(async () => ({
    outcome: 'confident',
    match: { matchKey: 'orcid', nameConsistent: true },
    referencedReviewers: [{ reviewerId: 'hidden', institutions: [] }],
    referencedContacts: [],
  }));
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  })];

  await reconcileReviewerContacts(rows, { lookup, now: () => '2026-07-21T12:00:00.000Z' });

  expect(rows[0].contactEnrichment.dataverseContactEvidence).toMatchObject({
    status: 'known',
    matchKey: 'orcid',
    reason: null,
  });
});

test('exact trusted reconciliation attaches prior request context without exposing the person id', async () => {
  const priorRequestContextLoader = jest.fn(async () => ({
    complete: true,
    totalCount: 1,
    requests: [{
      requestId: PRIOR_REQUEST_ID,
      requestNumber: '1002278',
      title: 'Deciphering the role of the secretome in aging',
      fiscalYear: 'June 2026',
      meetingDate: '2026-06-04',
    }],
  }));
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  })];

  await reconcileReviewerContacts(rows, {
    requestId: CURRENT_REQUEST_ID,
    includePriorRequestContext: true,
    priorRequestContextLoader,
    lookup: jest.fn(async () => exactOrcidOutcome()),
  });

  expect(priorRequestContextLoader).toHaveBeenCalledWith(
    '33333333-3333-3333-3333-333333333333',
    CURRENT_REQUEST_ID,
  );
  expect(rows[0].contactEnrichment.dataverseContactEvidence.priorRequestContext)
    .toMatchObject({ requests: [{ requestNumber: '1002278', fiscalYear: 'June 2026' }] });
  expect(JSON.stringify(rows[0].contactEnrichment.dataverseContactEvidence))
    .not.toContain('33333333-3333-3333-3333-333333333333');
});

test('history is not read without an exact server-bound person match', async () => {
  const cases = [
    {
      row: candidate('No receipt', {
        identity: {
          status: 'probable',
          anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
        },
        orcidId: ORCID,
      }),
      outcome: exactOrcidOutcome(),
      removeReceipt: true,
    },
    {
      row: candidate('Ambiguous person', {
        identity: {
          status: 'probable',
          anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
        },
        orcidId: ORCID,
      }),
      outcome: { outcome: 'candidates', referencedReviewers: [], referencedContacts: [] },
    },
    {
      row: candidate('Provisional ORCID', {
        identity: { status: 'unresolved', anchors: [] },
        tierResults: { openalex_author: { orcid: ORCID } },
      }),
      outcome: exactOrcidOutcome(),
    },
  ];
  const priorRequestContextLoader = jest.fn();

  for (const testCase of cases) {
    if (testCase.removeReceipt) delete testCase.row.serverIdentityDecisionReceipt;
    await reconcileReviewerContacts([testCase.row], {
      requestId: CURRENT_REQUEST_ID,
      includePriorRequestContext: true,
      priorRequestContextLoader,
      lookup: jest.fn(async () => testCase.outcome),
    });
  }

  expect(priorRequestContextLoader).not.toHaveBeenCalled();
});

test('history timeout preserves the candidate and a late result cannot mutate it', async () => {
  jest.useFakeTimers();
  let resolveHistory;
  const lateHistory = new Promise((resolve) => { resolveHistory = resolve; });
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  })];

  const pendingResult = reconcileReviewerContacts(rows, {
    requestId: CURRENT_REQUEST_ID,
    includePriorRequestContext: true,
    priorRequestBudgetMs: 100,
    priorRequestContextLoader: jest.fn(() => lateHistory),
    lookup: jest.fn(async () => exactOrcidOutcome()),
  });

  await jest.advanceTimersByTimeAsync(100);
  const result = await pendingResult;
  expect(result).toBe(rows);
  expect(rows[0].contactEnrichment.dataverseContactEvidence).not.toHaveProperty('priorRequestContext');
  resolveHistory({
    complete: true,
    totalCount: 1,
    requests: [{ requestId: PRIOR_REQUEST_ID, requestNumber: '1002278' }],
  });
  await Promise.resolve();
  expect(rows[0].contactEnrichment.dataverseContactEvidence).not.toHaveProperty('priorRequestContext');
  jest.useRealTimers();
});

test('prior request presentation time is shared across the candidate batch', async () => {
  jest.useFakeTimers();
  const rows = ['First exact match', 'Second exact match'].map((name) => candidate(name, {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
  }));
  const priorRequestContextLoader = jest.fn(() => new Promise(() => {}));

  const pendingResult = reconcileReviewerContacts(rows, {
    requestId: CURRENT_REQUEST_ID,
    includePriorRequestContext: true,
    priorRequestBudgetMs: 100,
    priorRequestContextLoader,
    lookup: jest.fn(async () => exactOrcidOutcome()),
  });

  await jest.advanceTimersByTimeAsync(100);
  await pendingResult;
  expect(priorRequestContextLoader).toHaveBeenCalledTimes(1);
  expect(rows[0].contactEnrichment.dataverseContactEvidence).not.toHaveProperty('priorRequestContext');
  expect(rows[1].contactEnrichment.dataverseContactEvidence).not.toHaveProperty('priorRequestContext');
  jest.useRealTimers();
});

test('trusted ORCID mismatch records durable conflict state without changing either address', async () => {
  const updateReviewer = jest.fn(async () => ({}));
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
    email: 'found@example.edu',
    emailSource: 'scholarly_single',
    emailPersistAllowed: true,
  })];

  await reconcileReviewerContacts(rows, {
    requestId: '11111111-1111-1111-1111-111111111111',
    actingUserSystemId: 'system-user-1',
    lookup: jest.fn(async () => ({
      outcome: 'confident',
      match: {
        reviewerId: 'reviewer-1',
        matchKey: 'orcid',
        nameConsistent: true,
        context: { email: 'stored@example.edu' },
      },
      referencedReviewers: [{ reviewerId: 'reviewer-1', institutions: [] }],
      referencedContacts: [],
    })),
    getReviewer: jest.fn(async () => ({
      wmkf_potentialreviewersid: 'reviewer-1',
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: null,
      _etag: 'W/"1"',
    })),
    updateReviewer,
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(updateReviewer).toHaveBeenCalledWith(
    'reviewer-1',
    expect.objectContaining({
      addressTrustStateJson: expect.stringContaining('"status":"conflict_pending"'),
    }),
    { actingUserSystemId: 'system-user-1', ifMatch: 'W/"1"' },
  );
  const written = JSON.parse(updateReviewer.mock.calls[0][1].addressTrustStateJson);
  expect(written).toMatchObject({
    email: 'stored@example.edu',
    conflict: { foundEmail: 'found@example.edu', reason: 'email_mismatch' },
  });
  expect(rows[0]).toMatchObject({
    addressConflictPending: true,
    contactEnrichment: {
      email: 'found@example.edu',
      addressConflictPending: true,
      dataverseContactEvidence: { status: 'review_required', reason: 'email_mismatch' },
    },
  });
});

test('failed contradiction write remains visible and offers the repair path', async () => {
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
    email: 'found@example.edu',
    emailSource: 'scholarly_single',
    emailPersistAllowed: true,
  })];

  await reconcileReviewerContacts(rows, {
    requestId: '11111111-1111-1111-1111-111111111111',
    lookup: jest.fn(async () => ({
      outcome: 'confident',
      match: {
        reviewerId: 'reviewer-1',
        matchKey: 'orcid',
        nameConsistent: true,
        context: { email: 'stored@example.edu' },
      },
      referencedReviewers: [{ reviewerId: 'reviewer-1', institutions: [] }],
      referencedContacts: [],
    })),
    getReviewer: jest.fn(async () => ({
      wmkf_emailaddress: 'stored@example.edu',
      _etag: 'W/"1"',
    })),
    updateReviewer: jest.fn(async () => { throw new Error('Dataverse unavailable'); }),
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(rows[0]).toMatchObject({
    conflictRecordUnavailable: true,
    contactEnrichment: {
      conflictRecordUnavailable: true,
      dataverseContactEvidence: {
        status: 'review_required',
        reason: 'conflict_record_unavailable',
      },
    },
  });
});

test('missing person ETag fails closed before a durable contradiction write', async () => {
  const updateReviewer = jest.fn();
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
    email: 'found@example.edu',
    emailSource: 'scholarly_single',
    emailPersistAllowed: true,
  })];

  await reconcileReviewerContacts(rows, {
    requestId: '11111111-1111-1111-1111-111111111111',
    lookup: jest.fn(async () => ({
      outcome: 'confident',
      match: {
        reviewerId: 'reviewer-1',
        matchKey: 'orcid',
        nameConsistent: true,
        context: { email: 'stored@example.edu' },
      },
      referencedReviewers: [{ reviewerId: 'reviewer-1', institutions: [] }],
      referencedContacts: [],
    })),
    getReviewer: jest.fn(async () => ({
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: null,
    })),
    updateReviewer,
  });

  expect(updateReviewer).not.toHaveBeenCalled();
  expect(rows[0]).toMatchObject({
    conflictRecordUnavailable: true,
    contactEnrichment: { conflictRecordUnavailable: true },
  });
});

test('a previously resolved exact address pair is not reopened by enrichment', async () => {
  const priorConflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'found@example.edu',
    reason: 'email_mismatch',
    requestId: '11111111-1111-1111-1111-111111111111',
    candidateKey: 'orcid:test',
    detectedAt: '2026-07-20T12:00:00.000Z',
  });
  const resolved = createStaffVerifiedState({
    email: 'stored@example.edu',
    requestId: '11111111-1111-1111-1111-111111111111',
    candidateKey: 'orcid:test',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
    attestedAt: '2026-07-20T13:00:00.000Z',
    resolution: {
      conflict: priorConflict.conflict,
      decision: 'keep_stored',
      resolvedAt: '2026-07-20T13:00:00.000Z',
    },
  });
  const updateReviewer = jest.fn();
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
    email: 'found@example.edu',
    emailSource: 'scholarly_single',
    emailPersistAllowed: true,
  })];
  await reconcileReviewerContacts(rows, {
    requestId: '11111111-1111-1111-1111-111111111111',
    lookup: jest.fn(async () => ({
      outcome: 'confident',
      match: {
        reviewerId: 'reviewer-1', matchKey: 'orcid', nameConsistent: true,
        context: { email: 'stored@example.edu' },
      },
      referencedReviewers: [], referencedContacts: [],
    })),
    getReviewer: jest.fn(async () => ({
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(resolved),
      _etag: 'W/"2"',
    })),
    updateReviewer,
  });
  expect(updateReviewer).not.toHaveBeenCalled();
  expect(rows[0].addressConflictPending).not.toBe(true);
});

test('a third address replaces an older pending pair', async () => {
  const pending = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'old-found@example.edu',
    reason: 'email_mismatch',
    requestId: '11111111-1111-1111-1111-111111111111',
    candidateKey: 'orcid:test',
    detectedAt: '2026-07-20T12:00:00.000Z',
  });
  const updateReviewer = jest.fn();
  const rows = [candidate('Trusted Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'orcid_public', canonicalKey: `orcid:${ORCID}` }],
    },
    orcidId: ORCID,
    email: 'third@example.edu',
    emailSource: 'scholarly_single',
    emailPersistAllowed: true,
  })];
  await reconcileReviewerContacts(rows, {
    requestId: '11111111-1111-1111-1111-111111111111',
    lookup: jest.fn(async () => ({
      outcome: 'confident',
      match: {
        reviewerId: 'reviewer-1', matchKey: 'orcid', nameConsistent: true,
        context: { email: 'stored@example.edu' },
      },
      referencedReviewers: [], referencedContacts: [],
    })),
    getReviewer: jest.fn(async () => ({
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify(pending),
      _etag: 'W/"2"',
    })),
    updateReviewer,
    now: () => '2026-07-21T12:00:00.000Z',
  });
  const written = JSON.parse(updateReviewer.mock.calls[0][1].addressTrustStateJson);
  expect(written.conflict).toMatchObject({ foundEmail: 'third@example.edu' });
});

test('a probable identity without an ORCID-specific anchor still treats the ORCID as provisional', async () => {
  const lookup = jest.fn(async () => ({
    outcome: 'confident',
    match: { matchKey: 'orcid', nameConsistent: true },
    referencedReviewers: [{ reviewerId: 'hidden', institutions: [] }],
    referencedContacts: [],
  }));
  const rows = [candidate('OpenAlex Researcher', {
    identity: {
      status: 'probable',
      anchors: [{ type: 'openalex_author_spine', canonicalKey: 'openalex:A123' }],
    },
    orcidId: ORCID,
  })];

  await reconcileReviewerContacts(rows, { lookup, now: () => '2026-07-21T12:00:00.000Z' });

  expect(rows[0].contactEnrichment.dataverseContactEvidence.status).toBe('review_required');
});

test('name-inconsistent exact rows remain review_required, never known', async () => {
  const rows = [candidate('Ada Lovelace', { email: 'ada@example.edu' })];
  await reconcileReviewerContacts(rows, {
    lookup: jest.fn(async () => ({
      outcome: 'candidates',
      candidates: [{ matchKey: 'email' }],
      referencedReviewers: [{ reviewerId: 'hidden', institutions: [] }],
      referencedContacts: [],
    })),
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(rows[0].contactEnrichment.dataverseContactEvidence.status).toBe('review_required');
});

test('partial enrichment skips every lookup and marks evidence unavailable', async () => {
  const lookup = jest.fn();
  const rows = [
    candidate('A', { email: 'a@example.edu' }),
    candidate('B', { email: 'b@example.edu' }),
  ];

  await reconcileReviewerContacts(rows, {
    skip: true,
    lookup,
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(lookup).not.toHaveBeenCalled();
  expect(rows.map((row) => row.contactEnrichment.dataverseContactEvidence.reason))
    .toEqual(['partial_enrichment', 'partial_enrichment']);
});

test('abort after one lookup prevents later Dataverse reads and preserves order', async () => {
  const controller = new AbortController();
  const lookup = jest.fn(async ({ name }) => {
    if (name === 'A') controller.abort(new Error('deadline'));
    return { outcome: 'none', referencedReviewers: [], referencedContacts: [] };
  });
  const rows = [
    candidate('A', { email: 'a@example.edu' }),
    candidate('B', { email: 'b@example.edu' }),
  ];

  const out = await reconcileReviewerContacts(rows, {
    signal: controller.signal,
    lookup,
    now: () => '2026-07-21T12:00:00.000Z',
  });

  expect(out).toBe(rows);
  expect(lookup).toHaveBeenCalledTimes(1);
  expect(rows[0].contactEnrichment.dataverseContactEvidence.status).toBe('none');
  expect(rows[1].contactEnrichment.dataverseContactEvidence).toMatchObject({
    status: 'unavailable',
    reason: 'deadline_exceeded',
  });
});

test('lookup failures are isolated per candidate and subsequent candidates continue', async () => {
  const lookup = jest.fn()
    .mockRejectedValueOnce(new Error('Dataverse unavailable'))
    .mockResolvedValueOnce({ outcome: 'none', referencedReviewers: [], referencedContacts: [] });
  const rows = [
    candidate('A', { email: 'a@example.edu' }),
    candidate('B', { email: 'b@example.edu' }),
  ];

  await reconcileReviewerContacts(rows, { lookup, now: () => '2026-07-21T12:00:00.000Z' });

  expect(lookup).toHaveBeenCalledTimes(2);
  expect(rows[0].contactEnrichment.dataverseContactEvidence.status).toBe('unavailable');
  expect(rows[1].contactEnrichment.dataverseContactEvidence.status).toBe('none');
});

test('conflict details never leak while the bounded reason survives', () => {
  const evidence = compactDataverseContactEvidence({
    outcome: 'conflict',
    reason: 'orcid_email_split',
    details: { reviewerId: 'secret-reviewer', contactId: 'secret-contact' },
    referencedReviewers: [{
      reviewerId: 'secret-reviewer',
      institutions: [{ value: 'Harvard University', source: 'primary_affiliation' }],
    }],
    referencedContacts: [{ contactId: 'secret-contact' }],
  }, { checkedAt: '2026-07-21T12:00:00.000Z' });

  expect(evidence).toMatchObject({
    status: 'review_required',
    reason: 'orcid_email_split',
  });
  expect(JSON.stringify(evidence)).not.toContain('secret-');
});

test('candidates with no exact key issue no Dataverse lookup', async () => {
  const lookup = jest.fn();
  const rows = [candidate('No Exact Key', {
    identity: { status: 'unresolved' },
  })];

  await reconcileReviewerContacts(rows, { lookup, now: () => '2026-07-21T12:00:00.000Z' });

  expect(lookup).not.toHaveBeenCalled();
  expect(rows[0].contactEnrichment).not.toHaveProperty('dataverseContactEvidence');
});
