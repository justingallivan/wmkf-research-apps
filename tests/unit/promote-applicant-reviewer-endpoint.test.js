/**
 * @jest-environment node
 *
 * /api/workbench/promote-applicant-reviewer — explicit PD promotion for an
 * applicant-recommended suggestion row.
 */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(async () => ({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } })),
}));

jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => fn(),
}));

jest.mock('../../lib/services/reviewer-roster-store', () => ({
  findCandidateBySuggestion: jest.fn(async () => null),
  finalizeCandidatePromotion: jest.fn(async (_requestId, candidate) => ({
    saved: true,
    candidateKey: candidate.candidateKey,
  })),
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

jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: jest.fn(async () => ({
    wmkf_potentialreviewersid: 'potential-reviewer-1',
    wmkf_emailaddress: 'applicant@example.edu',
    wmkf_emailsource: 'scholarly_multi',
    statecode: 0,
  })),
  findByEmailCandidates: jest.fn(async () => ({
    one: true,
    id: 'potential-reviewer-1',
    row: { wmkf_potentialreviewersid: 'potential-reviewer-1', statecode: 0 },
  })),
  update: jest.fn(async () => undefined),
}));

const findById = jest.fn();
const selectIfUnengaged = jest.fn(async () => ({ selected: true }));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
  findById: (...a) => findById(...a),
  selectIfUnengaged: (...a) => selectIfUnengaged(...a),
}));

import handler from '../../pages/api/workbench/promote-applicant-reviewer';
import { requireAppAccess } from '../../lib/utils/auth';
import { findCandidateBySuggestion } from '../../lib/services/reviewer-roster-store';

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_REQUEST_ID = '22222222-2222-2222-2222-222222222222';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';

function res() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

function post(body) {
  return { method: 'POST', body };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCandidatePromotionAuthority.mockReturnValue({
    decision: 'ready', code: null, stage: null, reason: null,
  });
  requireAppAccess.mockResolvedValue({ profileId: 7, session: { user: { dynamicsSystemuserId: 'u-1' } } });
  findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    _wmkf_potentialreviewer_value: 'potential-reviewer-1',
    wmkf_applicantdisposition: 100000000,
  });
  findCandidateBySuggestion.mockResolvedValue({
    suggestionId: SUGGESTION_ID,
    candidateKey: `suggestion:${SUGGESTION_ID}`,
    email: 'applicant@example.edu',
    emailSource: 'applicant_form',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    needsIdentification: false,
  });
});

it('405s on non-POST', async () => {
  const r = res();
  await handler({ method: 'GET' }, r);
  expect(r.statusCode).toBe(405);
  expect(r.headers.Allow).toBe('POST');
});

it('unauthenticated caller: short-circuit, no request/promotion work attempted', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);
  expect(findById).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

it('400s on non-GUID ids before any Dataverse selector', async () => {
  const r = res();
  await handler(post({ requestId: 'not-a-guid', suggestionId: SUGGESTION_ID }), r);
  expect(r.statusCode).toBe(400);
  expect(findById).not.toHaveBeenCalled();
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

it('404s when the suggestion does not belong to the request', async () => {
  findById.mockResolvedValueOnce({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: OTHER_REQUEST_ID,
    wmkf_applicantdisposition: 100000000,
  });

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(404);
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

it('400s when the row is not applicant-recommended', async () => {
  findById.mockResolvedValueOnce({
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    _wmkf_request_value: REQUEST_ID,
    wmkf_applicantdisposition: null,
  });

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(400);
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

it('400s when the adapter refuses an applicant-excluded row', async () => {
  findById.mockRejectedValueOnce(new Error('reviewer-suggestion.findById: refusing to act on an applicant-excluded suggestion'));

  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(400);
  expect(selectIfUnengaged).not.toHaveBeenCalled();
});

it('selects the existing applicant-recommended row', async () => {
  const r = res();
  await handler(post({ requestId: REQUEST_ID, suggestionId: SUGGESTION_ID }), r);

  expect(r.statusCode).toBe(200);
  expect(r.body).toEqual({
    success: true,
    suggestionId: SUGGESTION_ID,
    candidateKey: `suggestion:${SUGGESTION_ID}`,
    savedFields: [],
    rosterFinalized: true,
    partialSuccess: false,
    contactError: null,
    emailAction: 'ready',
    emailActionReason: 'Address source: scholarly_multi',
  });
  expect(selectIfUnengaged).toHaveBeenCalledWith(
    SUGGESTION_ID,
    { actingUserSystemId: 'u-1' },
  );
});
