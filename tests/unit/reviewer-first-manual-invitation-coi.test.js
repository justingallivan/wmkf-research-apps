jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findById: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  getById: jest.fn(),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  __esModule: true,
  loadCoiContext: jest.fn(),
}));
jest.mock('../../lib/services/institution-identity-resolver', () => ({
  __esModule: true,
  createInstitutionIdentityResolver: jest.fn(() => ({ resolve: jest.fn() })),
}));
jest.mock('../../lib/services/reviewer-institution-coi-screen', () => ({
  __esModule: true,
  recomputeReviewerInstitutionCOI: jest.fn(),
}));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const personAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const requestContext = require('../../lib/services/reviewer-request-context');
const { recomputeReviewerInstitutionCOI } = require('../../lib/services/reviewer-institution-coi-screen');
const {
  isFirstManualInvitation,
  screenFirstManualInvitationInstitutionCOI,
} = require('../../lib/services/reviewer-first-manual-invitation-coi');

const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';

function suggestion(overrides = {}) {
  return {
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
    wmkf_sources: 'staff_manual',
    wmkf_invited: false,
    wmkf_emailsentat: null,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  suggestionAdapter.findById.mockResolvedValue(suggestion());
  personAdapter.getById.mockResolvedValue({
    wmkf_name: 'Reviewer A',
    wmkf_maininstitution: 'North University',
    wmkf_primaryaffiliation: 'Applicant University',
    _wmkf_organization_value: 'organization-id',
  });
  requestContext.loadCoiContext.mockResolvedValue({
    institutionEntries: [{ name: 'Applicant University' }],
    piResolution: { state: 'ok' },
  });
  recomputeReviewerInstitutionCOI.mockResolvedValue({ decision: { dropDecision: 'clear' } });
});

describe('isFirstManualInvitation', () => {
  test('requires the exact comma-delimited staff_manual token', () => {
    expect(isFirstManualInvitation(suggestion({ wmkf_sources: 'literature, staff_manual, referred' }))).toBe(true);
    expect(isFirstManualInvitation(suggestion({ wmkf_sources: 'staff_manual_extra' }))).toBe(false);
  });

  test.each([
    { wmkf_invited: true },
    { wmkf_emailsentat: '2026-10-22T10:00:00Z' },
    { wmkf_accepted: true },
    { wmkf_declined: true },
    { wmkf_responsetype: 100000000 },
    { wmkf_reviewreceivedat: '2026-10-22T10:00:00Z' },
  ])('excludes a row with invitation or engagement history: %j', (history) => {
    expect(isFirstManualInvitation(suggestion(history))).toBe(false);
  });

  test('does not treat a token-access timestamp as a completed invitation', () => {
    expect(isFirstManualInvitation(suggestion({ wmkf_proposalfirstaccessed: '2026-10-22T10:00:00Z' }))).toBe(true);
  });
});

describe('screenFirstManualInvitationInstitutionCOI', () => {
  test('fresh-reads the row, validates server pins, and uses only mainInstitution as the person affiliation', async () => {
    await expect(screenFirstManualInvitationInstitutionCOI({
      suggestionId: SUGGESTION_ID,
      expectedRequestId: REQUEST_ID.toUpperCase(),
      expectedPersonId: PERSON_ID,
    })).resolves.toMatchObject({ applicable: true, screened: true });
    expect(suggestionAdapter.findById).toHaveBeenCalledWith(SUGGESTION_ID);
    expect(requestContext.loadCoiContext).toHaveBeenCalledWith(REQUEST_ID, {
      includeCoPIs: false,
      requireCompleteInstitutions: true,
    });
    expect(recomputeReviewerInstitutionCOI).toHaveBeenCalledWith(expect.objectContaining({
      serverAffiliations: ['North University'],
      institutionEntries: [{ name: 'Applicant University' }],
      candidate: { name: 'Reviewer A' },
    }));
  });

  test.each([
    ['request', { expectedRequestId: '44444444-4444-4444-4444-444444444444' }],
    ['person', { expectedPersonId: '55555555-5555-5555-5555-555555555555' }],
  ])('pin mismatch for %s fails unavailable before reading the person', async (_label, pins) => {
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID, ...pins }))
      .rejects.toMatchObject({ httpStatus: 503, code: 'manual_institution_coi_unavailable' });
    expect(personAdapter.getById).not.toHaveBeenCalled();
  });

  test('a missing fresh row fails unavailable instead of bypassing the screen', async () => {
    suggestionAdapter.findById.mockResolvedValueOnce(null);
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 503, code: 'manual_institution_coi_unavailable' });
  });

  test('a manual row with unknown current institution remains allowed without inferring from legacy fields', async () => {
    personAdapter.getById.mockResolvedValueOnce({
      wmkf_name: 'Reviewer A',
      wmkf_maininstitution: '',
      wmkf_primaryaffiliation: 'Applicant University',
      _wmkf_organization_value: 'org-id',
    });
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .resolves.toMatchObject({ applicable: true, screened: false, reason: 'institution_unknown' });
    expect(requestContext.loadCoiContext).not.toHaveBeenCalled();
  });

  test('only a corroborated dropped decision blocks; flagged and exempt decisions pass', async () => {
    recomputeReviewerInstitutionCOI.mockResolvedValueOnce({ decision: { dropDecision: 'dropped' } });
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'manual_institution_coi' });

    recomputeReviewerInstitutionCOI.mockResolvedValueOnce({ decision: { dropDecision: 'flagged' } });
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .resolves.toMatchObject({ screened: true });

    recomputeReviewerInstitutionCOI.mockResolvedValueOnce({ decision: { dropDecision: 'exempt' } });
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .resolves.toMatchObject({ screened: true });
  });

  test.each([
    ['missing context', null],
    ['missing entries', { piResolution: { state: 'ok' } }],
    ['malformed entries', { institutionEntries: {}, piResolution: { state: 'ok' } }],
    ['missing PI resolution', { institutionEntries: [] }],
    ['failed PI resolution', { institutionEntries: [], piResolution: { state: 'failed' } }],
  ])('%s fails unavailable', async (_label, context) => {
    requestContext.loadCoiContext.mockResolvedValueOnce(context);
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 503, code: 'manual_institution_coi_unavailable' });
  });

  test('person read failures and missing people fail unavailable', async () => {
    personAdapter.getById.mockRejectedValueOnce(new Error('read failed'));
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 503, code: 'manual_institution_coi_unavailable' });
    personAdapter.getById.mockResolvedValueOnce(null);
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 503, code: 'manual_institution_coi_unavailable' });
  });
});
