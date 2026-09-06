/**
 * @jest-environment node
 *
 * Delegation-pin test for lib/services/reviewer-finder/my-candidates-service.js
 * (Reviewer Lifecycle Stage 3F).
 *
 * Mocks the EXTRACTED module (`reviewer-engagement/record-invitation`)
 * wholesale and drives the legacy caller (`patchMyCandidates`,
 * `markManualInviteSent` branch) to pin: it calls `recordManualInvitation`
 * exactly once, after all the guards, with `{ suggestionId, emailSentAt,
 * ifMatch: suggestion._etag, actingUserSystemId }`; a thrown 412 maps to the
 * existing `stale_manual_link` code; a non-412 throw propagates unchanged.
 * This must go red if `patchMyCandidates` reimplements the manual-invite
 * write inline while keeping the import.
 */

jest.mock('../../lib/services/program-director-resolver', () => ({
  resolveByEmail: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  __esModule: true,
  getById: jest.fn(),
  findByRequestNumber: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/account', () => ({
  __esModule: true,
  queryAccounts: jest.fn(async () => ({ records: [] })),
}));
const findById = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: jest.fn(async () => []),
  findRemovedByRequest: jest.fn(async () => []),
  findByPD: jest.fn(async () => ({ suggestions: [], requestById: {} })),
  aggregateReviewHistory: jest.fn(async () => ({})),
  findById: (...a) => findById(...a),
  updateLifecycle: jest.fn(async () => {}),
  restore: jest.fn(async () => {}),
  softDelete: jest.fn(async () => {}),
  bulkUpdateByRequest: jest.fn(async () => 0),
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000 },
  RESPONSE_TYPE_BY_VALUE: { 100000000: 'accepted', 100000001: 'declined' },
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  __esModule: true,
  queryReviewers: jest.fn(async () => ({ records: [] })),
  getById: jest.fn(async () => ({
    wmkf_emailaddress: 'old@example.edu',
    wmkf_addresstruststatejson: null,
    _etag: 'W/"person"',
  })),
  update: jest.fn(async () => {}),
  clearEmailForEdit: jest.fn(async () => ({ cleared: true })),
  findByEmailCandidates: jest.fn(),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  __esModule: true,
  updateById: jest.fn(async () => {}),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  ensureToken: jest.fn(async () => {}),
  buildExternalUrl: jest.fn((token) => `https://reviews.wmkeck.org/external/review/${token}`),
}));
jest.mock('../../lib/services/external-token', () => ({
  hashToken: jest.fn((token) => `hash:${token}`),
}));
jest.mock('../../lib/dataverse/duplicate-key', () => ({ translateDuplicateKeyError: jest.fn(() => null) }));

// The module under delegation test: mocked wholesale so this suite pins
// only the CALL SHAPE and error mapping, never the real write logic (that
// is covered directly by tests/unit/record-invitation.test.js).
const recordManualInvitation = jest.fn(async () => {});
jest.mock('../../lib/services/reviewer-engagement/record-invitation', () => ({
  recordManualInvitation: (...a) => recordManualInvitation(...a),
}));

const { patchMyCandidates } = require('../../lib/services/reviewer-finder/my-candidates-service');

const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const SYS = 'u-1';

function currentSuggestion(over = {}) {
  return {
    _etag: 'W/"7"',
    wmkf_selected: true,
    wmkf_invited: false,
    wmkf_accepted: false,
    wmkf_declined: false,
    wmkf_responsetype: null,
    wmkf_externaltokenhash: 'hash:manual.token',
    wmkf_externaltokenrevoked: false,
    wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  recordManualInvitation.mockResolvedValue(undefined);
});

describe('patchMyCandidates delegates the manual-invite write to recordManualInvitation', () => {
  test('calls recordManualInvitation once, after the guards, with suggestionId/emailSentAt/ifMatch/actingUserSystemId', async () => {
    findById.mockResolvedValue(currentSuggestion());

    const out = await patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    });

    expect(recordManualInvitation).toHaveBeenCalledTimes(1);
    expect(recordManualInvitation).toHaveBeenCalledWith({
      suggestionId: SUGGESTION_ID,
      emailSentAt: expect.any(String),
      ifMatch: 'W/"7"',
      actingUserSystemId: SYS,
    });
    expect(out).toMatchObject({
      success: true,
      message: 'Manual invitation recorded',
      manualInviteRecorded: true,
    });
  });

  test('a guard rejection (already invited) never reaches recordManualInvitation', async () => {
    findById.mockResolvedValue(currentSuggestion({ wmkf_invited: true }));

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: 'already_invited' } });

    expect(recordManualInvitation).not.toHaveBeenCalled();
  });

  test('a 412 from recordManualInvitation maps to stale_manual_link', async () => {
    findById.mockResolvedValue(currentSuggestion());
    recordManualInvitation.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: 'stale_manual_link' } });
  });

  test('a non-412 rejection from recordManualInvitation propagates unchanged', async () => {
    findById.mockResolvedValue(currentSuggestion());
    const err = new Error('dataverse down');
    recordManualInvitation.mockRejectedValueOnce(err);

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    })).rejects.toBe(err);
  });
});
