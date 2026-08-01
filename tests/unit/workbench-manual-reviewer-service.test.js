/**
 * @jest-environment node
 *
 * lib/services/workbench/manual-reviewer-service — logic-level tests
 * (adapters mocked), Stage 4 series A extraction. Pins the typed-error
 * envelopes (all 409 conflict codes, in-pipeline 400s, 404) and the
 * exclusion-before-enrichment ordering the route characterization also pins.
 */

const getRequestById = jest.fn();
jest.mock('../../lib/dataverse/adapters/grant-request', () => ({
  getById: (...a) => getRequestById(...a),
}));

const PR = '11111111-2222-3333-4444-555555555555';
const CONTACT = '22222222-3333-4444-5555-666666666666';
const createReviewer = jest.fn();
const getReviewerById = jest.fn();
const setContactLink = jest.fn(async () => ({ action: 'link' }));
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  create: (...a) => createReviewer(...a),
  getById: (...a) => getReviewerById(...a),
  setContactLink: (...a) => setContactLink(...a),
}));

const getContactById = jest.fn();
jest.mock('../../lib/dataverse/adapters/contact', () => ({
  getById: (...a) => getContactById(...a),
}));

const upsertByPotentialReviewer = jest.fn(async () => ({ id: 'pr-1', created: false }));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: (...a) => upsertByPotentialReviewer(...a),
}));

const ensureStaffManualCandidate = jest.fn();
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  ensureStaffManualCandidate: (...a) => ensureStaffManualCandidate(...a),
}));

const lookupReviewerIdentity = jest.fn();
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: (...a) => lookupReviewerIdentity(...a),
}));

import { addManualReviewer, ManualReviewerError } from '../../lib/services/workbench/manual-reviewer-service';
import { ServiceHttpError } from '../../lib/services/service-http-error';

const REQ = '11111111-1111-1111-1111-111111111111';

const args = (over = {}) => ({
  requestId: REQ,
  name: 'Ada Lovelace',
  email: '',
  affiliation: '',
  note: '',
  referredBy: '',
  orcid: null,
  resolution: null,
  actingUserSystemId: 'u-1',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  getRequestById.mockResolvedValue({
    akoya_requestid: REQ,
    akoya_title: 'Manual add proposal',
    wmkf_meetingdate: '2026-06-01',
    _wmkf_programareaserved_value_formatted: 'Science',
  });
  createReviewer.mockResolvedValue({ id: PR, created: true });
  getReviewerById.mockResolvedValue({ wmkf_potentialreviewersid: PR });
  getContactById.mockResolvedValue(null);
  lookupReviewerIdentity.mockResolvedValue({ outcome: 'none' });
  ensureStaffManualCandidate.mockResolvedValue({ id: 'sug-1', created: true, selected: true });
});

test('404: unresolvable request → ServiceHttpError with historical message', async () => {
  getRequestById.mockRejectedValue(new Error('nope'));
  const err = await addManualReviewer(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ServiceHttpError);
  expect(err.httpStatus).toBe(404);
  expect(err.message).toBe(`No request found for ${REQ}`);
});

test('409 resolution_required: candidates outcome without explicit resolution carries the lookup in body', async () => {
  const lookup = { outcome: 'candidates', candidates: [{ reviewerId: PR, contactId: null }] };
  lookupReviewerIdentity.mockResolvedValue(lookup);
  const err = await addManualReviewer(args()).catch((e) => e);
  expect(err).toBeInstanceOf(ManualReviewerError);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({
    error: 'Reviewer identity needs staff confirmation before adding.',
    code: 'resolution_required',
    lookup,
  });
});

test('409 conflict passthrough: lookup conflict + non-create resolution → identity-conflict envelope', async () => {
  lookupReviewerIdentity.mockResolvedValue({ outcome: 'conflict', reason: 'orcid_mismatch', details: { a: 1 } });
  const err = await addManualReviewer(args({ resolution: { mode: 'reuse_reviewer', reviewerId: PR } })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ error: 'Manual reviewer identity conflict', code: 'orcid_mismatch', details: { a: 1 } });
});

test('409 stale_resolution: chosen id not among lookup candidates', async () => {
  const lookup = { outcome: 'candidates', candidates: [{ reviewerId: 'other-id', contactId: null }] };
  lookupReviewerIdentity.mockResolvedValue(lookup);
  const err = await addManualReviewer(args({ resolution: { mode: 'reuse_reviewer', reviewerId: PR } })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.code).toBe('stale_resolution');
  expect(err.body.lookup).toBe(lookup);
});

test('in-pipeline 400s: missing reviewerId/contactId for reuse modes (default { error } body)', async () => {
  lookupReviewerIdentity.mockResolvedValue({ outcome: 'none' });
  let err = await addManualReviewer(args({ resolution: { mode: 'reuse_reviewer' } })).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('resolution.reviewerId is required for reuse_reviewer');
  expect(err.body).toBeUndefined();

  err = await addManualReviewer(args({ resolution: { mode: 'reuse_contact' } })).catch((e) => e);
  expect(err.httpStatus).toBe(400);
  expect(err.message).toBe('resolution.contactId is required for reuse_contact');
});

test('409 email_mismatch on reuse_contact with a different typed email', async () => {
  getContactById.mockResolvedValue({ contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@crm.edu' });
  const err = await addManualReviewer(args({
    email: 'ada@typed.edu',
    resolution: { mode: 'reuse_contact', contactId: CONTACT },
  })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({
    error: 'Manual reviewer identity conflict',
    code: 'email_mismatch',
    details: { contactId: CONTACT, typedEmail: 'ada@typed.edu', contactEmail: 'ada@crm.edu' },
  });
  expect(createReviewer).not.toHaveBeenCalled();
});

test('409 contact_linked_elsewhere: reviewer already linked to a different contact', async () => {
  getReviewerById.mockResolvedValue({ wmkf_potentialreviewersid: PR, _wmkf_contact_value: 'zzzzzzzz-1111-2222-3333-444444444444' });
  getContactById.mockResolvedValue({ contactid: CONTACT, fullname: 'Ada Lovelace' });
  const err = await addManualReviewer(args({
    resolution: { mode: 'reuse_reviewer', reviewerId: PR, contactId: CONTACT },
  })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body.code).toBe('contact_linked_elsewhere');
});

test('409 applicant_excluded fires BEFORE any identity-bearing enrichment write', async () => {
  ensureStaffManualCandidate.mockResolvedValue({ id: 'sug-x', created: false, skippedExcluded: true });
  const err = await addManualReviewer(args({ email: 'ada@example.edu', orcid: '0000-0002-1825-0097' })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({
    error: 'This reviewer is excluded for this request and was not added.',
    code: 'applicant_excluded',
    suggestionId: 'sug-x',
  });
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
});

test('setContactLink structured conflict is translated; untyped errors propagate (P1m note 4 ordering)', async () => {
  lookupReviewerIdentity.mockResolvedValue({
    outcome: 'confident',
    match: { reviewerId: null, contactId: CONTACT, matchKey: 'email', nameConsistent: true },
  });
  getContactById.mockResolvedValue({ contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@crm.edu' });
  const linkErr = new Error('conflict');
  linkErr.status = 409;
  linkErr.code = 'contact_linked_elsewhere';
  linkErr.details = { contactId: CONTACT };
  setContactLink.mockRejectedValueOnce(linkErr);
  let err = await addManualReviewer(args({ email: 'ada@crm.edu' })).catch((e) => e);
  expect(err.httpStatus).toBe(409);
  expect(err.body).toEqual({ error: 'Manual reviewer identity conflict', code: 'contact_linked_elsewhere', details: { contactId: CONTACT } });

  setContactLink.mockRejectedValueOnce(new Error('network down'));
  err = await addManualReviewer(args({ email: 'ada@crm.edu' })).catch((e) => e);
  expect(err).not.toBeInstanceOf(ServiceHttpError);
  expect(err.message).toBe('network down');
});

test('referral: match reason + dual source tokens + provenanceKind in the DTO', async () => {
  const body = await addManualReviewer(args({ referredBy: 'Dr. Abby Doyle', note: 'Synthesis expert.' }));
  expect(ensureStaffManualCandidate).toHaveBeenCalledWith(
    expect.objectContaining({
      matchReason: 'Referred by Dr. Abby Doyle. Synthesis expert.',
      sources: ['staff_manual', 'referred'],
    }),
    { actingUserSystemId: 'u-1' },
  );
  expect(body.candidate).toMatchObject({
    referredBy: 'Dr. Abby Doyle',
    provenanceKind: 'referred',
    sources: ['staff_manual', 'referred'],
  });
  expect(body.created).toEqual({ person: true, suggestion: true });
});

test.each([
  ['promotion_required', 'Promote this applicant-recommended reviewer from Find.'],
  ['restore_required', 'Restore this previously declined reviewer from Removed.'],
  ['already_handled', 'Open Track Reviewers to continue from the current engagement stage.'],
])('applicant-row provenance merge returns typed %s instead of a false Added success', async (outcome, remedy) => {
  lookupReviewerIdentity.mockResolvedValue({
    outcome: 'confident',
    match: { reviewerId: PR, nameConsistent: true },
  });
  ensureStaffManualCandidate.mockResolvedValue({
    id: 'sug-applicant',
    created: false,
    selected: false,
    outcome,
    stage: outcome === 'restore_required' ? 'declined' : outcome === 'already_handled' ? 'invited' : 'recommended',
  });

  const body = await addManualReviewer(args({
    referredBy: 'Declining Reviewer',
    email: 'ada@example.edu',
  }));

  expect(body).toEqual(expect.objectContaining({
    success: true,
    outcome,
    suggestionId: 'sug-applicant',
    remedy,
  }));
  expect(body.candidate).toBeUndefined();
  expect(upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(setContactLink).not.toHaveBeenCalled();
});

test('reuse_contact fills email from the contact and links it (fill-only enrichment single round-trip)', async () => {
  getContactById.mockResolvedValue({ contactid: CONTACT, fullname: 'Ada Lovelace', emailaddress1: 'ada@crm.edu', wmkf_orcid: '0000-0002-1825-0097' });
  const body = await addManualReviewer(args({ resolution: { mode: 'reuse_contact', contactId: CONTACT } }));
  expect(body.candidate.email).toBe('ada@crm.edu');
  expect(body.candidate.orcid).toBe('0000-0002-1825-0097');
  expect(upsertByPotentialReviewer).toHaveBeenCalledWith(
    PR,
    { emailSource: 'manual', orcid: '0000-0002-1825-0097', orcidUrl: 'https://orcid.org/0000-0002-1825-0097' },
    { actingUserSystemId: 'u-1' },
  );
  expect(setContactLink).toHaveBeenCalledWith(PR, CONTACT, { actingUserSystemId: 'u-1' });
});
