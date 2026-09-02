/**
 * @jest-environment node
 *
 * Fix #2 (email-collision partial save): the saved-candidate PATCH must write the
 * conflict-SAFE fields (name/affiliation/website/h-index) BEFORE it attempts the
 * isolated email write, so a duplicate-email 409 leaves those edits committed and
 * the 409 reports `partialSuccess` + `savedFields`. Previously the email rode in
 * the same atomic person PATCH as affiliation, so a collision discarded everything
 * the staffer typed (the "lost all my edits" report).
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ session: { user: { azureEmail: 'pd@example.org' } } })),
}));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/reviewer-request-authorization', () => ({
  authorizeReviewerRequestMutation: jest.fn(async () => ({})),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: { getRecord: jest.fn(), queryRecords: jest.fn() },
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: {},
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  getById: jest.fn(async () => ({
    wmkf_emailaddress: 'old@example.org',
    wmkf_addresstruststatejson: null,
    _etag: 'W/"person"',
  })),
  update: jest.fn(),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({ ensureToken: jest.fn() }));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn() }));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { translateDuplicateKeyError } = require('../../lib/dataverse/duplicate-key');

const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';
const CONFLICT_ID = '44444444-4444-4444-4444-444444444444';

function mockRes() {
  const res = {};
  res.statusCode = 200;
  res.body = null;
  res.status = jest.fn((c) => { res.statusCode = c; return res; });
  res.json = jest.fn((b) => { res.body = b; return res; });
  res.setHeader = jest.fn();
  return res;
}

describe('my-candidates PATCH — partial save on email conflict', () => {
  let handler;

  beforeAll(() => {
    handler = require('../../pages/api/reviewer-finder/my-candidates').default;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
    });
    researcherAdapter.updateById.mockResolvedValue(undefined);
  });

  test('email duplicate 409 keeps the non-email edits and reports partialSuccess + savedFields', async () => {
    // Safe writes succeed; the isolated email write throws a duplicate-key error.
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) {
        throw new Error('Dataverse alt-key duplicate on wmkf_emailaddress');
      }
      return undefined;
    });
    translateDuplicateKeyError.mockReturnValue({
      field: 'wmkf_emailaddress', value: 'ava.mercer@example.org', message: 'That email is already in use.',
    });
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({
      one: true, id: CONFLICT_ID, row: { statecode: 0 },
    });

    const req = {
      method: 'PATCH',
      body: {
        suggestionId: SUGGESTION_ID,
        affiliation: 'Example Research Lab',
        website: 'https://research.example.org',
        email: 'ava.mercer@example.org',
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.partialSuccess).toBe(true);
    expect(res.body.savedFields).toEqual(expect.arrayContaining(['affiliation', 'website']));
    expect(res.body.savedFields).not.toContain('email');
    expect(res.body.conflictingRecordId).toBe(CONFLICT_ID);

    // The non-email researcher write committed BEFORE the failed email write.
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(
      PERSON_ID,
      expect.objectContaining({ affiliation: 'Example Research Lab', website: 'https://research.example.org' }),
      expect.anything(),
    );
    // emailSource is NOT stamped manual when the email never landed.
    expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(
      PERSON_ID, expect.objectContaining({ emailSource: 'manual' }), expect.anything(),
    );
  });

  test('clean edit: email written in its own PATCH, then emailSource stamped manual; 200', async () => {
    potentialReviewerAdapter.update.mockResolvedValue(undefined);
    translateDuplicateKeyError.mockReturnValue(null);

    const req = {
      method: 'PATCH',
      body: {
        suggestionId: SUGGESTION_ID,
        affiliation: 'Example Research Lab',
        email: 'ava.mercer@example.org',
      },
    };
    const res = mockRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    // Email is isolated from the OTHER fields (so a duplicate-key 409 rejects only the
    // address), but S387 pairs it with its own provenance in that same PATCH — a source
    // must never outlive the address it describes.
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(
      PERSON_ID, { email: 'ava.mercer@example.org', emailSource: 'manual' }, expect.anything(),
    );
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalledWith(
      PERSON_ID, expect.objectContaining({ email: expect.anything(), affiliation: expect.anything() }), expect.anything(),
    );
    // …and NOT as a follow-up write that could land without its address.
    expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(
      PERSON_ID, { emailSource: 'manual' }, expect.anything(),
    );
  });
});
