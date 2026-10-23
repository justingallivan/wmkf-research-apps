/**
 * @jest-environment node
 *
 * Local integration coverage for the first-manual-invitation boundary through
 * the real COI recomputation and DeduplicationService matcher. Dataverse and
 * request context are fixtures, and institution resolution deterministically
 * abstains so this suite never calls a provider or network.
 */

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
  createInstitutionIdentityResolver: jest.fn(() => ({
    resolve: jest.fn(async () => null),
  })),
}));

const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const personAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const requestContext = require('../../lib/services/reviewer-request-context');
const { screenFirstManualInvitationInstitutionCOI } = require('../../lib/services/reviewer-first-manual-invitation-coi');

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

function setup({ mainInstitution, institutionEntries, person = {} }) {
  suggestionAdapter.findById.mockResolvedValue(suggestion());
  personAdapter.getById.mockResolvedValue({
    wmkf_name: 'Reviewer Example',
    wmkf_maininstitution: mainInstitution,
    ...person,
  });
  requestContext.loadCoiContext.mockResolvedValue({
    requestContext: { title: 'Fixture proposal' },
    piResolution: { state: 'ok' },
    institutionEntries: institutionEntries.map((name) => ({ identity: name, display: name })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('first manual invitation institution COI using the real matcher', () => {
  test('same trusted current institution as the applicant blocks', async () => {
    setup({
      mainInstitution: 'North Valley University',
      institutionEntries: ['North Valley University'],
    });
    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'manual_institution_coi' });
  });

  test('different trusted current institution clears even if legacy affiliation fields conflict', async () => {
    setup({
      mainInstitution: 'Coastal Research University',
      institutionEntries: ['North Valley University'],
      person: {
        wmkf_primaryaffiliation: 'North Valley University',
        wmkf_organizationname: 'North Valley University',
      },
    });

    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .resolves.toMatchObject({ applicable: true, screened: true, reason: 'clear' });
  });

  test.each(['Broad Institute', 'HHMI'])('a sole %s overlap is exempt', async (institution) => {
    setup({ mainInstitution: institution, institutionEntries: [institution] });

    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .resolves.toMatchObject({ applicable: true, screened: true, reason: 'clear' });
  });

  test("a request's Broad institution does not exempt a direct university match", async () => {
    setup({
      mainInstitution: 'Stanford University',
      institutionEntries: ['Broad Institute', 'Stanford University'],
    });

    await expect(screenFirstManualInvitationInstitutionCOI({ suggestionId: SUGGESTION_ID }))
      .rejects.toMatchObject({ httpStatus: 409, code: 'manual_institution_coi' });
  });
});
