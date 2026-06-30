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
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn() }));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { translateDuplicateKeyError } = require('../../lib/dataverse/duplicate-key');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

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
  });

  test('flips selected and persists the marked contact, stamping email manual', async () => {
    potentialReviewerAdapter.update.mockResolvedValue(undefined);
    const req = {
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        suggestionId: SUGGESTION_ID,
        contact: { affiliation: 'JILA', email: 'jun.ye@colorado.edu' },
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
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { affiliation: 'JILA' }, expect.anything());
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(PERSON_ID, { email: 'jun.ye@colorado.edu' }, expect.anything());
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalledWith('99999999-9999-9999-9999-999999999999', expect.anything(), expect.anything());
    // emailSource forced manual, AFTER the email write.
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(PERSON_ID, { emailSource: 'manual' }, expect.anything());
  });

  test('email collision: still promoted, partialSuccess with a contactError', async () => {
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'jun.ye@colorado.edu' });

    const req = {
      method: 'POST',
      body: {
        requestId: REQUEST_ID,
        suggestionId: SUGGESTION_ID,
        contact: { affiliation: 'JILA', email: 'jun.ye@colorado.edu' },
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.partialSuccess).toBe(true);
    expect(res.body.contactError).toMatchObject({ code: 'email_conflict', value: 'jun.ye@colorado.edu' });
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
    const req = { method: 'POST', body: { requestId: REQUEST_ID, suggestionId: SUGGESTION_ID, contact: { email: 'x@y.edu' } } };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });
});
