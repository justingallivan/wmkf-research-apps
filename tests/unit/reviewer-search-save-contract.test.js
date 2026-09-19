/**
 * @jest-environment node
 *
 * Draft P7 producer contract tests. Kept outside Jest discovery until green.
 */

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));

jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({
    profileId: 7,
    session: { user: { dynamicsSystemuserId: 'SYS-1' } },
  })),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: jest.fn(async () => ({ id: 'PERSON-1' })),
  getById: jest.fn(async () => ({
    wmkf_primaryaffiliation: 'Example University',
    wmkf_emailaddress: 'applicant@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    _etag: 'W/"person"',
  })),
  update: jest.fn(async () => undefined),
  getByIdForMerge: jest.fn(async () => ({ wmkf_potentialreviewersid: 'PERSON-1', _etag: 'W/"1"' })),
  getByEmail: jest.fn(async () => null),
  setContactLink: jest.fn(async () => ({ action: 'link' })),
  deleteExactNew: jest.fn(async () => undefined),
  findByEmailCandidates: jest.fn(async () => ({
    one: true,
    id: 'PERSON-1',
    row: { wmkf_potentialreviewersid: 'PERSON-1', statecode: 0 },
  })),
}));
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getInstitutionById: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  getById: jest.fn(async () => null),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(async () => ({ id: 'RESEARCHER-1' })),
  writeIdentityDecision: jest.fn(async () => undefined),
  clearIdentityFields: jest.fn(async () => undefined),
  updateById: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  upsert: jest.fn(async () => ({ id: 'SUGGESTION-1' })),
  findAllByPotentialReviewer: jest.fn(async () => []),
  findById: jest.fn(async () => ({
    wmkf_appreviewersuggestionid: '33333333-3333-3333-3333-333333333333',
    _wmkf_request_value: '11111111-1111-1111-1111-111111111111',
    _wmkf_potentialreviewer_value: 'PERSON-1',
    wmkf_applicantdisposition: 100000000,
  })),
  selectIfUnengaged: jest.fn(async () => ({ selected: true })),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  queryAllRequests: jest.fn(async () => ({ records: [], capped: false })),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  finalizeCandidatePromotion: jest.fn(async (_requestId, candidate, anchors) => ({
    saved: true,
    candidateKey: anchors?.candidateKey || candidate?.candidateKey,
  })),
  markPromotionBlocked: jest.fn(async (_requestId, candidateKey) => ({ blocked: true, candidateKey })),
  findIdentityConfirmation: jest.fn(async () => null),
  findEligibilityByCandidateKey: jest.fn(async () => null),
  findAddressTrustReceipt: jest.fn(async () => ({
    receiptId: 'receipt:applicant',
    personConfirmed: true,
    email: 'applicant@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    attestedAt: '2026-09-18T00:00:00.000Z',
  })),
  findCandidatesByKeys: jest.fn(async (_requestId, candidateKeys) => candidateKeys.map((candidateKey) => ({
    candidateKey,
    rosterStatus: 'active',
    ...(candidateKey === 'roster:conflict' ? { conflictRecordUnavailable: true } : {}),
  }))),
  listForRequest: jest.fn(async () => ({
    active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [],
  })),
  findCandidateBySuggestion: jest.fn(async () => ({
    candidateKey: 'roster:applicant',
    suggestionId: '33333333-3333-3333-3333-333333333333',
    name: 'Applicant Reviewer',
    email: 'applicant@example.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    needsIdentification: false,
  })),
}));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  verifyAutomatedIdentityAttestation: jest.fn(async (_token, { candidate } = {}) => ({
    valid: true,
    source: 'automated_resolver',
    identityDecisionBound: true,
    contactAuthorityBound: true,
    rosterCandidateKey: candidate?.candidateKey || null,
  })),
  hasServerIdentityDecisionReceipt: jest.fn(() => false),
  createServerIdentityDecisionReceipt: jest.fn(() => null),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(async () => ({ outcome: 'none' })),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadCoiContext: jest.fn(async () => ({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
    cycleCode: '2026',
  })),
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  createInstitutionIdentityResolver: jest.fn(() => ({ resolve: jest.fn(async () => null) })),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'ALERT-1' })) },
}));
jest.mock('../../lib/services/reviewer-institution-measurement', () => ({
  measurementEnabled: jest.fn(() => false),
  recordInstitutionMeasurement: jest.fn(async () => 'inserted'),
  classifiedOutcome: jest.fn((code, saved) => saved ? 'saved' : code),
}));
jest.mock('../../lib/services/reviewer-institution-evidence-attestation', () => ({
  hasServerInstitutionEvidenceReceipt: jest.fn(() => false),
  reviewerInstitutionPhase2Enabled: jest.fn(() => false),
  verifyInstitutionEvidenceAttestation: jest.fn(async () => ({ valid: false, reason: 'no_token' })),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({
  translateDuplicateKeyError: jest.fn(() => null),
}));
jest.mock('../../lib/services/reviewer-address-trust-service', () => ({
  listOpenAddressRepairRequests: jest.fn(async () => []),
}));
const saveHandler = require('../../pages/api/reviewer-finder/save-candidates').default;
const applicantHandler = require('../../pages/api/workbench/promote-applicant-reviewer').default;
const rosterHandler = require('../../pages/api/workbench/reviewer-roster').default;
const rosterStore = require('../../lib/services/reviewer-roster-store');
const { sql } = require('@vercel/postgres');
const contract = require('../fixtures/reviewer-search-http-contract.json');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function serialized(body) {
  return JSON.parse(JSON.stringify(body));
}

test('producer envelope: ordinary save uses the real save service and freezes mixed result correlation', async () => {
  const res = response();
  await saveHandler({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      proposalTitle: 'Frozen proposal',
      programArea: 'Frozen program',
      candidates: [
        {
          name: 'Ordinary Saved',
          email: 'applicant@example.edu',
          emailSource: 'pubmed',
          emailPersistAllowed: true,
          identityStatus: 'probable',
          automatedIdentityAttestation: 'signed-token',
          candidateKey: 'roster:ordinary',
        },
        {
          name: 'Ordinary Blocked',
          candidateKey: 'roster:conflict',
          email: 'applicant@example.edu',
          emailSource: 'pubmed',
          emailPersistAllowed: true,
          identityStatus: 'probable',
          automatedIdentityAttestation: 'signed-token',
        },
      ],
    },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(serialized(res.body)).toEqual(contract.ordinaryMixedSave);
});

test('producer envelope: applicant promotion exposes manual fields and a partial roster finalization', async () => {
  rosterStore.findCandidateBySuggestion.mockResolvedValueOnce({
    candidateKey: 'roster:applicant',
    suggestionId: SUGGESTION_ID,
    name: 'Applicant Reviewer',
    email: 'applicant@example.edu',
    emailSource: 'scholarly_multi',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    needsIdentification: false,
  });
  rosterStore.finalizeCandidatePromotion.mockResolvedValueOnce({ saved: false });

  const res = response();
  await applicantHandler({
    method: 'POST',
    body: {
      requestId: REQUEST_ID,
      suggestionId: SUGGESTION_ID,
      contact: {
        email: 'applicant@example.edu',
        affiliation: 'Example University',
      },
    },
  }, res);

  expect(res.statusCode).toBe(200);
  expect(serialized(res.body)).toEqual(contract.applicantPartialPromotion);
  expect(res.body).not.toHaveProperty('potentialReviewerId');
});

test('producer envelope: roster GET is the recovery snapshot after an ordinary unknown outcome', async () => {
  // Real row-to-roster projection: saved non-suggestion keys do not appear in
  // savedKeys. Preserve this existing unknown-outcome limitation in the UI.
  sql.mockResolvedValueOnce({ rows: [{
    candidate_key: 'roster:ordinary', status: 'saved', display_name: 'Ordinary Saved',
    source_kind: 'literature_retrieved',
    candidate: { name: 'Ordinary Saved', candidateKey: 'roster:ordinary', suggestionId: 'SUGGESTION-1' },
  }] });
  rosterStore.listForRequest.mockImplementationOnce(
    jest.requireActual('../../lib/services/reviewer-roster-store').listForRequest,
  );
  const res = response();
  await rosterHandler({ method: 'GET', query: { requestId: REQUEST_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(serialized(res.body)).toEqual(contract.rosterRecovery);
});


test('producer envelope: single ordinary submission has no phantom second result', async () => {
  const res = response();
  await saveHandler({ method: 'POST', body: {
    requestId: REQUEST_ID,
    candidates: [{ name: 'Ordinary Saved', email: 'applicant@example.edu',
      emailSource: 'pubmed', emailPersistAllowed: true, identityStatus: 'probable',
      automatedIdentityAttestation: 'signed-token', candidateKey: 'roster:ordinary' }],
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(serialized(res.body)).toEqual(contract.ordinarySingleSave);
});

test('producer envelope: finalized applicant promotion matches the mixed-click submission', async () => {
  const res = response();
  await applicantHandler({ method: 'POST', body: {
    requestId: REQUEST_ID, suggestionId: SUGGESTION_ID,
    contact: { email: 'applicant@example.edu', affiliation: 'Example University' },
  } }, res);
  expect(res.statusCode).toBe(200);
  expect(serialized(res.body)).toEqual(contract.applicantFinalizedPromotion);
});
