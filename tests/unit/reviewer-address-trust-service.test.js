/** @jest-environment node */

const findById = jest.fn();
const getById = jest.fn();
const update = jest.fn();
const attestAddress = jest.fn();

jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  findById: (...args) => findById(...args),
}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...args) => getById(...args),
  update: (...args) => update(...args),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  attestAddress: (...args) => attestAddress(...args),
  findCandidatesByKeys: jest.fn(async () => []),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const { verifyPersonAndAddress } = require('../../lib/services/reviewer-address-trust-service');
const { parseAddressTrustState } = require('../../lib/utils/reviewer-address-trust');

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue({
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: PERSON_ID,
  });
  getById.mockResolvedValue({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'reviewer@example.edu',
    _etag: 'W/"person"',
  });
  update.mockResolvedValue(undefined);
});

test('already-promoted verification binds evidence to the exact current person address atomically', async () => {
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'Reviewer@Example.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
    actorProfileId: 'profile-1',
    actorSystemUserId: 'system-1',
  });

  expect(result).toMatchObject({ success: true, decision: 'person_address_verified' });
  expect(update).toHaveBeenCalledWith(PERSON_ID, expect.objectContaining({
    email: 'reviewer@example.edu',
    emailSource: 'staff_verified',
    addressTrustStateJson: expect.any(String),
  }), { actingUserSystemId: 'system-1', ifMatch: 'W/"person"' });
  const bundle = JSON.parse(update.mock.calls[0][1].addressTrustStateJson);
  expect(parseAddressTrustState(bundle, { storedEmail: 'reviewer@example.edu' })).toMatchObject({
    valid: true,
    state: {
      status: 'staff_verified',
      attestation: {
        requestId: REQUEST_ID,
        candidateKey: `suggestion:${SUGGESTION_ID}`,
        evidenceUrl: 'https://example.edu/paper',
      },
    },
  });
  expect(attestAddress).not.toHaveBeenCalled();
});

test('already-promoted verification fails closed when the displayed address is stale', async () => {
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'old@example.edu',
    evidenceType: 'institution_page',
    evidenceUrl: 'https://example.edu/profile',
  });
  expect(result).toMatchObject({ success: false, code: 'candidate_stale' });
  expect(update).not.toHaveBeenCalled();
});

test('already-ready provenance is preserved instead of being relabeled staff_verified', async () => {
  getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: PERSON_ID,
    wmkf_emailaddress: 'reviewer@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    _etag: 'W/"person"',
  });
  const result = await verifyPersonAndAddress({
    requestId: REQUEST_ID,
    suggestionId: SUGGESTION_ID,
    email: 'reviewer@example.edu',
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/paper',
  });
  expect(result).toMatchObject({ success: true, decision: 'already_ready' });
  expect(update).not.toHaveBeenCalled();
});
