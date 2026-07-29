/**
 * @jest-environment node
 *
 * S387 — staff attestation for a research-only address
 * (my-candidates PATCH `verifyEmailAddress`).
 *
 * The dead-end being closed: an address whose only provenance is a web search is
 * `research_only`, which the render AND send gates refuse with no send-time override,
 * and the advertised "verify it, then Edit contact" hatch is a no-op when the verified
 * address is the one already stored (CandidateEditModal omits an unchanged email).
 *
 * `emailConfidence` is deliberately NOT mocked — these tests assert against the same
 * classifier the send gate uses, so a change to the buckets fails here too.
 */

jest.mock('../../lib/services/program-director-resolver', () => ({ resolveByEmail: jest.fn() }));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true, getById: jest.fn(), findByRequestNumber: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true, queryAccounts: jest.fn(async () => ({ records: [] })),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
  updateLifecycle: jest.fn(async () => {}),
  restore: jest.fn(async () => {}),
  softDelete: jest.fn(async () => {}),
  bulkUpdateByRequest: jest.fn(async () => 0),
  findByRequest: jest.fn(async () => []),
  findRemovedByRequest: jest.fn(async () => []),
  findByPD: jest.fn(async () => ({ suggestions: [], requestById: {} })),
  aggregateReviewHistory: jest.fn(async () => ({})),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: {},
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: jest.fn(async () => ({ records: [] })),
  update: jest.fn(async () => {}),
  findByEmailCandidates: jest.fn(),
  getByIdWithSelect: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true, updateById: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  ensureToken: jest.fn(async () => {}),
  buildExternalUrl: jest.fn((token) => `https://reviews.wmkeck.org/external/review/${token}`),
}));
jest.mock('../../lib/services/external-token', () => ({ hashToken: jest.fn((t) => `hash:${t}`) }));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn(() => null) }));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { patchMyCandidates } = require('../../lib/services/reviewer-finder/my-candidates-service');

const SUGGESTION_ID = '11111111-2222-3333-4444-555555555555';
const PERSON_ID = '66666666-7777-8888-9999-000000000000';
const EMAIL = 'pmali@ucsd.edu';

function verify(overrides = {}) {
  return patchMyCandidates({
    body: { suggestionId: SUGGESTION_ID, verifyEmailAddress: true, verifiedEmail: EMAIL, ...overrides },
    actingUserSystemId: 'staff-1',
  });
}

function personRow(overrides = {}) {
  return {
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: EMAIL,
    wmkf_emailsource: 'serp_search',
    wmkf_identitystatus: 'unresolved',
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  suggestionAdapter.findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
  });
  potentialReviewerAdapter.getByIdWithSelect.mockResolvedValue(personRow());
});

describe('verifyEmailAddress — happy path', () => {
  test('stamps staff_verified on the person and reports the attested address', async () => {
    const result = await verify();
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(
      PERSON_ID,
      { emailSource: 'staff_verified' },
      { actingUserSystemId: 'staff-1' },
    );
    expect(result).toMatchObject({
      success: true,
      updated: { suggestionId: SUGGESTION_ID, emailSource: 'staff_verified', email: EMAIL },
    });
  });

  test('accepts a case/whitespace variant of the stored address', async () => {
    await expect(verify({ verifiedEmail: '  PMali@UCSD.edu ' })).resolves.toMatchObject({ success: true });
    expect(researcherAdapter.updateById).toHaveBeenCalled();
  });

  test('the attested source is sendable but still requires the send-time acknowledgement', () => {
    const { emailConfidence } = require('../../lib/utils/reviewer-invite');
    const after = emailConfidence(personRow({ wmkf_emailsource: 'staff_verified' }));
    expect(after.action).toBe('quick_check');
    expect(after.action).not.toBe('ready');
    expect(after.reason).toMatch(/verified by staff/i);
  });
});

describe('verifyEmailAddress — refusals (all must write nothing)', () => {
  afterEach(() => {
    expect(researcherAdapter.updateById).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('rejects a missing verifiedEmail rather than attesting whatever is stored', async () => {
    await expect(verify({ verifiedEmail: undefined })).rejects.toMatchObject({
      httpStatus: 400,
      body: { code: 'verified_email_required' },
    });
  });

  test('rejects an address that changed since the screen loaded', async () => {
    potentialReviewerAdapter.getByIdWithSelect.mockResolvedValue(
      personRow({ wmkf_emailaddress: 'someone.else@ucsd.edu' }),
    );
    await expect(verify()).rejects.toMatchObject({
      httpStatus: 409,
      body: { code: 'address_changed' },
    });
  });

  test('rejects a person row with no address', async () => {
    potentialReviewerAdapter.getByIdWithSelect.mockResolvedValue(personRow({ wmkf_emailaddress: '' }));
    await expect(verify()).rejects.toMatchObject({ httpStatus: 409, body: { code: 'no_address' } });
  });

  test('rejects a suggestion with no linked person', async () => {
    suggestionAdapter.findById.mockResolvedValue({ wmkf_appreviewersuggestionid: SUGGESTION_ID });
    await expect(verify()).rejects.toMatchObject({ httpStatus: 409, body: { code: 'person_missing' } });
  });

  // The downgrade guard. Every one of these sources classifies as something OTHER than
  // research_only, so stamping staff_verified would WEAKEN provenance (ready → quick_check)
  // or re-stamp an already-usable address. 'staff_verified' itself covers idempotency:
  // a second click is refused, not a duplicate write.
  test.each([
    ['orcid', 'ready'],
    ['institution_page', 'ready'],
    ['scholarly_multi', 'ready'],
    ['manual', 'quick_check'],
    ['affiliation', 'quick_check'],
    ['scholarly_single', 'quick_check'],
    ['staff_verified', 'quick_check'],
    ['', 'quick_check'],
  ])('refuses to re-stamp a %s address (currently %s)', async (source) => {
    potentialReviewerAdapter.getByIdWithSelect.mockResolvedValue(
      personRow({ wmkf_emailsource: source }),
    );
    await expect(verify()).rejects.toMatchObject({
      httpStatus: 409,
      body: { code: 'not_research_only' },
    });
  });

});

// Complement of the refused set. Kept OUT of the block above so it is not covered by
// that suite's "wrote nothing" afterEach — this case MUST write.
describe('verifyEmailAddress — the other research-only source', () => {
  test('search_contested is attestable (deliberate human override) and writes', async () => {
    potentialReviewerAdapter.getByIdWithSelect.mockResolvedValue(
      personRow({ wmkf_emailsource: 'search_contested' }),
    );
    await expect(verify()).resolves.toMatchObject({ success: true });
    expect(researcherAdapter.updateById).toHaveBeenCalledWith(
      PERSON_ID, { emailSource: 'staff_verified' }, { actingUserSystemId: 'staff-1' },
    );
  });
});
