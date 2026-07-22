/**
 * @jest-environment node
 *
 * lib/services/workbench/promote-applicant-reviewer-service — logic-level
 * tests (adapters mocked), Stage 4 series A extraction. The two route
 * characterization suites pin the full partial-success matrix; this suite
 * pins the service's typed errors, savedFields/contactError accumulation,
 * and the promote-before-contact ordering.
 */

const findById = jest.fn();
const updateLifecycle = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  APPLICANT_DISPOSITION_MAP: { recommended: 100000000, excluded: 100000001 },
  findById: (...a) => findById(...a),
  updateLifecycle: (...a) => updateLifecycle(...a),
}));

const update = jest.fn(async () => {});
const getById = jest.fn(async () => ({}));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  update: (...a) => update(...a),
  getById: (...a) => getById(...a),
}));

const updateById = jest.fn(async () => {});
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  updateById: (...a) => updateById(...a),
}));

const translateDuplicateKeyError = jest.fn();
jest.mock('../../lib/dataverse/duplicate-key', () => ({
  translateDuplicateKeyError: (...a) => translateDuplicateKeyError(...a),
}));

const findCandidateBySuggestion = jest.fn(async () => null);
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  findCandidateBySuggestion: (...a) => findCandidateBySuggestion(...a),
}));

import { promoteApplicantReviewer } from '../../lib/services/workbench/promote-applicant-reviewer-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';
const SUG = '33333333-3333-3333-3333-333333333333';
const PERSON = '22222222-2222-2222-2222-222222222222';

const args = (over = {}) => ({ requestId: REQ, suggestionId: SUG, contact: undefined, actingUserSystemId: 'u-1', ...over });

beforeEach(() => {
  jest.clearAllMocks();
  findById.mockResolvedValue({
    wmkf_appreviewersuggestionid: SUG,
    _wmkf_request_value: REQ,
    _wmkf_potentialreviewer_value: PERSON,
    wmkf_applicantdisposition: 100000000,
  });
  update.mockResolvedValue(undefined);
  updateById.mockResolvedValue(undefined);
  getById.mockResolvedValue({});
  findCandidateBySuggestion.mockResolvedValue({
    suggestionId: SUG,
    identityStatus: 'probable',
    needsIdentification: false,
  });
  translateDuplicateKeyError.mockReturnValue(null);
});

test('wrong-request suggestion → 404 typed error, no lifecycle write', async () => {
  findById.mockResolvedValue({ _wmkf_request_value: '00000000-0000-0000-0000-000000000000', wmkf_applicantdisposition: 100000000 });
  const err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe('Applicant reviewer suggestion not found for this request');
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('non-recommended row → 400; adapter applicant-excluded refusal → same 400 message', async () => {
  findById.mockResolvedValueOnce({ _wmkf_request_value: REQ, wmkf_applicantdisposition: null });
  let err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Only applicant-recommended reviewers can be promoted');

  findById.mockRejectedValueOnce(new Error('refusing to act on an applicant-excluded suggestion'));
  err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('Only applicant-recommended reviewers can be promoted');
});

test('typed 404 is NOT eaten by the applicant-excluded regex translation (P1m note 4)', async () => {
  // A message that would ALSO match the regex must still surface as its own typed error.
  findById.mockResolvedValue({ _wmkf_request_value: 'other', wmkf_applicantdisposition: 100000000 });
  const err = await promoteApplicantReviewer(args()).catch((e) => e);
  expect(err.httpStatus).toBe(404);
});

test('plain promote: selected flipped, empty clean result', async () => {
  const body = await promoteApplicantReviewer(args());
  expect(updateLifecycle).toHaveBeenCalledWith(SUG, { selected: true }, { actingUserSystemId: 'u-1' });
  expect(body).toEqual({ success: true, suggestionId: SUG, savedFields: [], partialSuccess: false, contactError: null });
});

test('missing authoritative roster row is rejected before lifecycle promotion', async () => {
  findCandidateBySuggestion.mockResolvedValue(null);
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'identity_verification_required' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('deceased applicant-recommended reviewer is rejected before lifecycle promotion', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Deceased',
    suggestionId: SUG,
    eligibilityStatus: 'deceased',
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'candidate_ineligible' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('durable ineligible status blocks promotion even when the candidate blob lacks its marker', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Deceased',
    suggestionId: SUG,
    rosterStatus: 'ineligible',
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('identity-review applicant is rejected before lifecycle promotion without server confirmation', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Namesake',
    suggestionId: SUG,
    needsIdentification: true,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
  });
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ code: 'identity_confirmation_required' });
  expect(updateLifecycle).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
});

test('server-recorded staff confirmation permits promotion of an identity-review applicant', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    name: 'Dr Namesake',
    suggestionId: SUG,
    needsIdentification: true,
    identityStatus: 'unresolved',
    pdIdentityConfirmed: true,
    pdIdentityConfirmationId: 'confirm-1',
    staffIdentityConfirmation: { confirmationId: 'confirm-1', source: 'staff_confirmed' },
  });
  const body = await promoteApplicantReviewer(args());
  expect(body.success).toBe(true);
  expect(updateLifecycle).toHaveBeenCalledWith(SUG, { selected: true }, { actingUserSystemId: 'u-1' });
});

test('manual email collision: promotion stands, partialSuccess + email_conflict, backfill skipped', async () => {
  update.mockImplementation(async (_id, updates) => {
    if (updates && 'email' in updates) throw new Error('alt-key duplicate');
  });
  translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'a@b.edu' });
  const body = await promoteApplicantReviewer(args({ contact: { affiliation: 'JILA', email: 'a@b.edu' } }));
  expect(body.success).toBe(true);
  expect(body.partialSuccess).toBe(true);
  expect(body.contactError).toMatchObject({ code: 'email_conflict', value: 'a@b.edu' });
  expect(body.savedFields).toEqual(['affiliation']);
  // One server-side roster read still enforces deceased eligibility; the
  // manual attempt gates only the email backfill's second read.
  expect(findCandidateBySuggestion).toHaveBeenCalledTimes(1);
  expect(updateLifecycle).toHaveBeenCalled(); // promotion stuck
});

test('B1 backfill: vetted roster email written with roster provenance when no manual email', async () => {
  findCandidateBySuggestion.mockResolvedValue({
    suggestionId: SUG, email: 'kaang@snu.ac.kr', emailSource: 'claude_search', emailPersistAllowed: true,
  });
  const body = await promoteApplicantReviewer(args());
  expect(body.savedFields).toEqual(['email']);
  expect(update).toHaveBeenCalledWith(PERSON, { email: 'kaang@snu.ac.kr' }, { actingUserSystemId: 'u-1' });
  expect(updateById).toHaveBeenCalledWith(PERSON, { emailSource: 'claude_search' }, { actingUserSystemId: 'u-1' });
});

test('B1 idempotency: existing person email blocks the backfill', async () => {
  findCandidateBySuggestion.mockResolvedValue({ suggestionId: SUG, email: 'x@y.edu', emailSource: 'claude_search', emailPersistAllowed: true });
  getById.mockResolvedValue({ wmkf_emailaddress: 'existing@y.edu' });
  const body = await promoteApplicantReviewer(args());
  expect(body.savedFields).toEqual([]);
  expect(update).not.toHaveBeenCalled();
});

test('eligibility roster read failure returns retryable 503 before lifecycle mutation', async () => {
  findCandidateBySuggestion.mockRejectedValue(new Error('roster down'));
  const err = await promoteApplicantReviewer(args()).catch((error) => error);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(503);
  expect(err.body).toMatchObject({ code: 'eligibility_unavailable' });
  expect(updateLifecycle).not.toHaveBeenCalled();
});

test('safe-field write failure: contact_write_failed reported, promotion stands', async () => {
  update.mockImplementation(async (_id, updates) => {
    if (updates && 'affiliation' in updates) throw new Error('boom');
  });
  const body = await promoteApplicantReviewer(args({ contact: { affiliation: 'JILA' } }));
  expect(body.partialSuccess).toBe(true);
  expect(body.contactError).toMatchObject({ code: 'contact_write_failed' });
  expect(body.savedFields).toEqual([]);
});
