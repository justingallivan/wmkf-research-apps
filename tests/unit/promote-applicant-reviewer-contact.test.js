/**
 * @jest-environment node
 *
 * Fix (S306): promoting an applicant-suggested reviewer must persist the PD's
 * hand-corrections (the "lowest-trust input" routinely has no email or a wrong-
 * namesake identity). Previously promote-applicant-reviewer ONLY flipped
 * wmkf_selected=true, so the corrected contact was dropped. Now it flips selected
 * first, then writes ONLY the client-marked manual fields to the suggestion's OWN
 * person record, forcing source 'manual', and reports a partial-success contactError
 * (instead of failing the promote) when the email collides with another record.
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
  updateLifecycle: jest.fn(async () => undefined),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  update: jest.fn(async () => undefined),
  getById: jest.fn(async () => ({})), // no existing email by default
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn() }));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  __esModule: true,
  findCandidateBySuggestion: jest.fn(async () => null), // no roster row by default → no backfill
}));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { translateDuplicateKeyError } = require('../../lib/dataverse/duplicate-key');
const { findCandidateBySuggestion } = require('../../lib/services/reviewer-roster-store');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';
const SAFE_ROSTER_CANDIDATE = {
  suggestionId: SUGGESTION_ID,
  identityStatus: 'probable',
  needsIdentification: false,
};

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

describe('promote-applicant-reviewer — persist hand-corrections', () => {
  let handler;

  beforeAll(() => {
    handler = require('../../pages/api/workbench/promote-applicant-reviewer').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_applicantdisposition: 100000000, // recommended
    });
    findCandidateBySuggestion.mockResolvedValue(SAFE_ROSTER_CANDIDATE);
  });

  test('flips selected and persists the marked contact, stamping email manual', async () => {
    potentialReviewerAdapter.update.mockResolvedValue(undefined);
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
    expect(res.body.savedFields).toEqual(expect.arrayContaining(['affiliation', 'email']));

    // selected flipped.
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID, { selected: true }, expect.anything(),
    );
    // Writes target the suggestion's OWN person, never the client-supplied id.
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { affiliation: 'Example Research Lab' }, expect.anything());
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { email: 'ava.mercer@example.org' }, expect.anything());
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalledWith('99999999-9999-9999-9999-999999999999', expect.anything(), expect.anything());
    // emailSource forced manual, AFTER the email write.
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(PERSON_ID, { emailSource: 'manual' }, expect.anything());
  });

  test('email collision: still promoted, partialSuccess with a contactError', async () => {
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
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(true);
    expect(res.body.contactError).toMatchObject({ code: 'email_conflict', value: 'ava.mercer@example.org' });
    expect(res.body.savedFields).toContain('affiliation');
    expect(res.body.savedFields).not.toContain('email');
    // Promotion stuck despite the contact conflict.
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { selected: true }, expect.anything());
  });

  test('no contact payload: behaves as a plain promote (selected only)', async () => {
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(false);
    expect(res.body.savedFields).toEqual([]);
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { selected: true }, expect.anything());
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
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
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
    // Restore clean adapter defaults — clearAllMocks clears calls but NOT the throwing
    // mockImplementation the describe-1 collision test installs, which would leak here.
    potentialReviewerAdapter.update.mockResolvedValue(undefined);
    researcherAdapter.updateById.mockResolvedValue(undefined);
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_applicantdisposition: 100000000,
    });
    potentialReviewerAdapter.getById.mockResolvedValue({}); // person has no email
    findCandidateBySuggestion.mockResolvedValue(SAFE_ROSTER_CANDIDATE);
  });

  const promote = async () => {
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID } }; // NO manual contact
    const res = mockRes();
    await handler(req, res);
    return res;
  };

  test('backfills a vetted roster email, stamping the roster source (NOT manual)', async () => {
    findCandidateBySuggestion.mockResolvedValue({
      suggestionId: SUGGESTION_ID,
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
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { email: 'noor.patel@example.org' }, expect.anything());
    // Source forced from the vetted roster provenance — NOT 'manual'.
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(PERSON_ID, { emailSource: 'claude_search' }, expect.anything());
  });

  test('does NOT backfill when emailPersistAllowed is not true', async () => {
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'reviewer@example.org', emailSource: 'serp_search', emailPersistAllowed: false });
    const res = await promote();
    expect(res.body.savedFields).not.toContain('email');
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('rejects identity-unresolved promotion before lifecycle or contact writes', async () => {
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'reviewer@example.org', emailSource: 'affiliation', emailPersistAllowed: true, needsIdentification: true });
    const res = await promote();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'identity_confirmation_required' });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('idempotent: does NOT override a person that already has an email', async () => {
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'roster@example.org', emailSource: 'claude_search', emailPersistAllowed: true });
    potentialReviewerAdapter.getById.mockResolvedValue({ wmkf_emailaddress: 'existing@example.org' });
    const res = await promote();
    expect(res.body.savedFields).not.toContain('email');
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('a manual email wins: backfill is skipped after the eligibility read', async () => {
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'roster@example.org', emailSource: 'claude_search', emailPersistAllowed: true });
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, contact: { email: 'manual@example.org' } } };
    const res = mockRes();
    await handler(req, res);
    // Manual email persisted; the one roster read is the eligibility boundary,
    // and no separate email-backfill lookup occurs.
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { email: 'manual@example.org' }, expect.anything());
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(PERSON_ID, { emailSource: 'manual' }, expect.anything());
    expect(findCandidateBySuggestion).toHaveBeenCalledTimes(1);
  });

  test('duplicate-email collision on backfill is non-fatal (promoted + contactError)', async () => {
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'duplicate@example.org', emailSource: 'serp_search', emailPersistAllowed: true });
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'duplicate@example.org' });
    const res = await promote();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(true);
    expect(res.body.contactError).toMatchObject({ code: 'email_conflict', value: 'duplicate@example.org' });
    expect(res.body.savedFields).not.toContain('email');
    // Promotion still stuck.
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(SUGGESTION_ID, { selected: true }, expect.anything());
  });

  test('no roster row (legacy / no id anchor): fails closed before promotion', async () => {
    findCandidateBySuggestion.mockResolvedValue(null);
    const res = await promote();
    expect(res.statusCode).toBe(422);
    expect(res.body).toMatchObject({ code: 'identity_verification_required' });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('a manual email that COLLIDES is not silently overwritten by the roster email', async () => {
    // PD typed a conflicting email; the manual write 409s → not in savedFields.
    findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUGGESTION_ID, email: 'roster@example.org', emailSource: 'claude_search', emailPersistAllowed: true });
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'manual@example.org' });
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, contact: { email: 'manual@example.org' } } };
    const res = mockRes();
    await handler(req, res);
    // The PD's explicit choice routes to merge — backfill must NOT run.
    expect(findCandidateBySuggestion).toHaveBeenCalledTimes(1);
    expect(res.body.contactError).toMatchObject({ code: 'email_conflict', value: 'manual@example.org' });
    expect(res.body.savedFields).not.toContain('email');
  });
});
