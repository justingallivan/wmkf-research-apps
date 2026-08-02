/**
 * @jest-environment node
 *
 * The promotion endpoint is intentionally selection-only: browser-provided
 * contact corrections never write a shared person record.  Address changes go
 * through their dedicated authenticated and server-attested workflow; this
 * route can only use an already-vetted roster email for its own suggestion.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: { dynamicsSystemuserId: 'sys-1' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  selectIfUnengaged: jest.fn(async () => ({ selected: true })),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
}));
let mockPersonEmail = null;
let mockPersonEmailSource = null;
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  update: jest.fn(async (_id, updates) => {
    if (updates?.email) mockPersonEmail = updates.email;
    if (updates?.emailSource !== undefined) mockPersonEmailSource = updates.emailSource;
  }),
  getById: jest.fn(async () => ({
    wmkf_potentialreviewersid: '22222222-2222-2222-2222-222222222222',
    wmkf_emailaddress: mockPersonEmail,
    wmkf_emailsource: mockPersonEmailSource,
    statecode: 0,
  })),
  findByEmailCandidates: jest.fn(async () => ({
    one: true,
    id: '22222222-2222-2222-2222-222222222222',
    row: { wmkf_potentialreviewersid: '22222222-2222-2222-2222-222222222222', statecode: 0 },
  })),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn() }));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  __esModule: true,
  findCandidateBySuggestion: jest.fn(async () => null), // no roster row by default → no backfill
  finalizeCandidatePromotion: jest.fn(async () => ({ saved: true })),
  findAddressTrustReceipt: jest.fn(async () => null),
  promotionSnapshotIsCurrent: jest.fn(async () => true),
}));
const mockGetCandidatePromotionAuthority = jest.fn();
jest.mock('../../lib/services/reviewer-promotion-authority', () => ({
  ...jest.requireActual('../../lib/services/reviewer-promotion-authority'),
  getCandidatePromotionAuthority: (...args) => mockGetCandidatePromotionAuthority(...args),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadCoiContext: jest.fn(async () => ({
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  })),
}));
jest.mock('../../lib/services/deduplication-service', () => ({
  DeduplicationService: {
    institutionCOIResolution: jest.fn(async () => ({ status: 'clear', decision: null })),
    institutionCOIDecisionResolved: jest.fn(async () => null),
  },
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  createInstitutionIdentityResolver: jest.fn(() => ({})),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { translateDuplicateKeyError } = require('../../lib/dataverse/duplicate-key');
const { findCandidateBySuggestion, finalizeCandidatePromotion, findAddressTrustReceipt } = require('../../lib/services/reviewer-roster-store');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';
const SAFE_ROSTER_CANDIDATE = {
  candidateKey: 'candidate:applicant',
  suggestionId: SUGGESTION_ID,
  identityStatus: 'probable',
  needsIdentification: false,
};

function mockAddressReceipt(email) {
  findAddressTrustReceipt.mockResolvedValue({
    receiptId: `receipt:${email}`,
    personConfirmed: true,
    email,
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/reviewer',
    attestedAt: '2026-07-31T12:00:00.000Z',
  });
}

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

describe('promote-applicant-reviewer — browser contact is not mutation authority', () => {
  let handler;

  beforeAll(() => {
    handler = require('../../pages/api/workbench/promote-applicant-reviewer').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCandidatePromotionAuthority.mockReturnValue({
      decision: 'ready', code: null, stage: null, reason: null,
    });
    mockPersonEmail = 'existing@example.org';
    mockPersonEmailSource = 'scholarly_multi';
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates?.email) mockPersonEmail = updates.email;
      if (updates?.emailSource !== undefined) mockPersonEmailSource = updates.emailSource;
    });
    potentialReviewerAdapter.getById.mockImplementation(async () => ({
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_emailaddress: mockPersonEmail,
      wmkf_emailsource: mockPersonEmailSource,
      _etag: 'W/"person"',
      statecode: 0,
    }));
    finalizeCandidatePromotion.mockResolvedValue({ saved: true });
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_applicantdisposition: 100000000, // recommended
    });
    findCandidateBySuggestion.mockResolvedValue(SAFE_ROSTER_CANDIDATE);
  });

  test('ignores marked contact and promotes using only the server-held reviewer record', async () => {
    const req = {
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        suggestionId: SUGGESTION_ID,
        contact: { affiliation: 'Example Research Lab', email: 'ava.mercer@example.org' },
        // A bogus client person id must be IGNORED — the route uses findById's value.
        potentialReviewerId: '99999999-9999-9999-9999-999999999999',
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(false);
    expect(res.body.savedFields).toEqual([]);

    // selected flipped.
    expect(suggestionAdapter.selectIfUnengaged).toHaveBeenCalledWith(
      SUGGESTION_ID, expect.anything(),
    );
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
    expect(researcherAdapter.updateById).not.toHaveBeenCalled();
  });

  test('browser email-collision bait cannot withhold a promotion', async () => {
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'ava.mercer@example.org' });

    const req = {
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        suggestionId: SUGGESTION_ID,
        contact: { affiliation: 'Example Research Lab', email: 'ava.mercer@example.org' },
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, savedFields: [] });
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
    expect(suggestionAdapter.selectIfUnengaged).toHaveBeenCalled();
  });

  test('no contact payload: behaves as a plain promote (selected only)', async () => {
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(false);
    expect(res.body.savedFields).toEqual([]);
    expect(suggestionAdapter.selectIfUnengaged).toHaveBeenCalledWith(SUGGESTION_ID, expect.anything());
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
    expect(researcherAdapter.updateById).not.toHaveBeenCalled();
  });

  test('a wrong-request suggestion is rejected before any write', async () => {
    suggestionAdapter.findById.mockResolvedValue({
      _wmkf_request_value: '00000000-0000-0000-0000-000000000000',
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_applicantdisposition: 100000000,
    });
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, contact: { email: 'reviewer@example.org' } } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(suggestionAdapter.selectIfUnengaged).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });
});

// B1 (S317): promote must also persist the VETTED enrichment email that
// enrich-recommended wrote to the roster but not to Dataverse — read server-side by
// requestId+suggestionId (id anchor), gated exactly like save-candidates, idempotent.
describe('promote-applicant-reviewer — B1 enriched-email backfill', () => {
  let handler;
  beforeAll(() => { handler = require('../../pages/api/workbench/promote-applicant-reviewer').default; });
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCandidatePromotionAuthority.mockReturnValue({
      decision: 'ready', code: null, stage: null, reason: null,
    });
    // Restore clean adapter defaults — clearAllMocks clears calls but NOT the throwing
    // mockImplementation the describe-1 collision test installs, which would leak here.
    mockPersonEmail = null;
    mockPersonEmailSource = null;
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates?.email) mockPersonEmail = updates.email;
      if (updates?.emailSource !== undefined) mockPersonEmailSource = updates.emailSource;
    });
    potentialReviewerAdapter.getById.mockImplementation(async () => ({
      wmkf_potentialreviewersid: PERSON_ID,
      wmkf_emailaddress: mockPersonEmail,
      wmkf_emailsource: mockPersonEmailSource,
      _etag: 'W/"person"',
      statecode: 0,
    }));
    researcherAdapter.updateById.mockResolvedValue(undefined);
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_applicantdisposition: 100000000,
    });
    findCandidateBySuggestion.mockResolvedValue(SAFE_ROSTER_CANDIDATE);
    finalizeCandidatePromotion.mockResolvedValue({ saved: true });
  });

  const promote = async () => {
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID } }; // NO manual contact
    const res = mockRes();
    await handler(req, res);
    return res;
  };

  test('backfills a vetted roster email, stamping the roster source (NOT manual)', async () => {
    mockAddressReceipt('noor.patel@example.org');
    findCandidateBySuggestion.mockResolvedValue({
      ...SAFE_ROSTER_CANDIDATE,
      email: 'noor.patel@example.org',
      emailSource: 'claude_search',
      emailPersistAllowed: true,
    });
    const res = await promote();

    expect(res.statusCode).toBe(200);
    expect(res.body.savedFields).toContain('email');
    expect(res.body.partialSuccess).toBe(false);
    // Read is id-anchored on requestId + suggestionId.
    expect(findCandidateBySuggestion).toHaveBeenCalledWith(REQUEST_ID, SUGGESTION_ID);
    // Email written to the suggestion's OWN person.
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
      email: 'noor.patel@example.org',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }), expect.anything());
    // Source forced from the vetted roster provenance — NOT 'manual' — and written in the
    // SAME patch as the address (S387), not as a follow-up call.
    expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(PERSON_ID, { emailSource: 'claude_search' }, expect.anything());
  });

  test('does NOT backfill when emailPersistAllowed is not true', async () => {
    findCandidateBySuggestion.mockResolvedValue({
      ...SAFE_ROSTER_CANDIDATE,
      email: 'reviewer@example.org',
      emailSource: 'serp_search',
      emailPersistAllowed: false,
    });
    const res = await promote();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'missing_verified_email' });
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
    expect(suggestionAdapter.selectIfUnengaged).not.toHaveBeenCalled();
  });

  test('rejects identity-unresolved promotion before lifecycle or contact writes', async () => {
    findCandidateBySuggestion.mockResolvedValue({
      ...SAFE_ROSTER_CANDIDATE,
      email: 'reviewer@example.org',
      emailSource: 'affiliation',
      emailPersistAllowed: true,
      needsIdentification: true,
    });
    const res = await promote();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'identity_confirmation_required' });
    expect(suggestionAdapter.selectIfUnengaged).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('same research-only email still binds the exact staff attestation', async () => {
    mockAddressReceipt('existing@example.org');
    findCandidateBySuggestion.mockResolvedValue({ ...SAFE_ROSTER_CANDIDATE, email: 'existing@example.org', emailSource: 'claude_search', emailPersistAllowed: true });
    mockPersonEmail = 'existing@example.org';
    mockPersonEmailSource = 'claude_search';
    const res = await promote();
    expect(res.statusCode).toBe(200);
    expect(res.body.savedFields).toContain('email');
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
      email: 'existing@example.org',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }), expect.anything());
  });

  test('a browser manual email cannot override the vetted roster backfill', async () => {
    mockAddressReceipt('roster@example.org');
    findCandidateBySuggestion.mockResolvedValue({
      ...SAFE_ROSTER_CANDIDATE,
      email: 'roster@example.org',
      emailSource: 'claude_search',
      emailPersistAllowed: true,
      contactEnrichment: {
        identity: { status: 'probable' },
        email: 'roster@example.org',
        emailSource: 'claude_search',
        emailPersistAllowed: true,
      },
    });
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, contact: { email: 'manual@example.org' } } };
    const res = mockRes();
    await handler(req, res);
    // Promotion keeps using the roster email; the browser value is only ignored
    // transport data and cannot choose a canonical address.
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
      email: 'roster@example.org',
      emailSource: 'staff_verified',
      addressTrustStateJson: expect.any(String),
    }), expect.anything());
    // S387: one atomic patch, not an address write followed by a source write.
    expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(
      PERSON_ID, { emailSource: 'manual' }, expect.anything(),
    );
    expect(findCandidateBySuggestion).toHaveBeenCalledTimes(1);
  });

  test('duplicate-email collision on backfill withholds promotion', async () => {
    mockAddressReceipt('duplicate@example.org');
    findCandidateBySuggestion.mockResolvedValue({ ...SAFE_ROSTER_CANDIDATE, email: 'duplicate@example.org', emailSource: 'serp_search', emailPersistAllowed: true });
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'duplicate@example.org' });
    const res = await promote();
    expect(res.statusCode).toBe(409);
    expect(res.body.contactError).toMatchObject({ code: 'email_conflict', value: 'duplicate@example.org' });
    expect(suggestionAdapter.selectIfUnengaged).not.toHaveBeenCalled();
  });

  test('no roster row (legacy / no id anchor): fails closed before promotion', async () => {
    findCandidateBySuggestion.mockResolvedValue(null);
    const res = await promote();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'identity_verification_required' });
    expect(suggestionAdapter.selectIfUnengaged).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

});
