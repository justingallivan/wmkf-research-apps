/**
 * @jest-environment node
 */

const getById = jest.fn();
const findByEmailCandidates = jest.fn();
jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  getById: (...args) => getById(...args),
  findByEmailCandidates: (...args) => findByEmailCandidates(...args),
}));

import {
  projectCanonicalApplicantContact,
  pruneApplicantKnownReviewer,
} from '../../lib/utils/applicant-known-reviewer';
import {
  loadApplicantKnownReviewer,
} from '../../lib/services/workbench/applicant-known-reviewer-service';
import {
  createConflictPendingState,
  createStaffVerifiedState,
  STAFF_ADDRESS_CHOICE_REASON,
} from '../../lib/utils/reviewer-address-trust';

const PERSON = '22222222-2222-2222-2222-222222222222';

function person(over = {}) {
  return {
    wmkf_potentialreviewersid: PERSON,
    wmkf_name: 'Rotem Sorek',
    wmkf_primaryaffiliation: 'Weizmann Institute',
    wmkf_emailaddress: 'rotem@example.edu',
    wmkf_emailsource: null,
    wmkf_orcid: '0000-0001-2345-6789',
    statecode: 0,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getById.mockResolvedValue(person());
  findByEmailCandidates.mockResolvedValue({
    one: true,
    id: PERSON,
    row: person(),
  });
});

test('exact active owner with source-null email is known and quick_check', async () => {
  const known = await loadApplicantKnownReviewer(PERSON);
  expect(known).toMatchObject({
    status: 'known',
    potentialReviewerId: PERSON,
    email: 'rotem@example.edu',
    emailSource: null,
    emailReadiness: { action: 'quick_check', level: 'low' },
    orcid: '0000-0001-2345-6789',
  });
});

test('trusted source stays ready; research-only source stays research_only', async () => {
  getById.mockResolvedValueOnce(person({ wmkf_emailsource: 'scholarly_multi' }));
  findByEmailCandidates.mockResolvedValueOnce({
    one: true,
    id: PERSON,
    row: person({ wmkf_emailsource: 'scholarly_multi' }),
  });
  await expect(loadApplicantKnownReviewer(PERSON)).resolves.toMatchObject({
    emailReadiness: { action: 'ready' },
  });

  getById.mockResolvedValueOnce(person({ wmkf_emailsource: 'serp_search' }));
  findByEmailCandidates.mockResolvedValueOnce({
    one: true,
    id: PERSON,
    row: person({ wmkf_emailsource: 'serp_search' }),
  });
  await expect(loadApplicantKnownReviewer(PERSON)).resolves.toMatchObject({
    emailReadiness: { action: 'research_only' },
  });
});

test('a resolved staff choice is projected and survives the bounded client projection', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const candidateKey = 'candidate:rotem';
  const conflict = createConflictPendingState({
    email: 'stored@example.edu',
    foundEmail: 'rotem@example.edu',
    reason: 'email_mismatch',
    requestId,
    candidateKey,
    detectedAt: '2026-08-20T19:00:00.000Z',
  });
  const resolved = createStaffVerifiedState({
    email: 'rotem@example.edu',
    requestId,
    candidateKey,
    evidenceType: 'staff_address_choice',
    attestedAt: '2026-08-20T20:00:00.000Z',
    resolution: {
      conflict: conflict.conflict,
      decision: 'use_found',
      resolvedAt: '2026-08-20T20:00:00.000Z',
    },
  });
  const selectedPerson = person({
    wmkf_emailsource: 'staff_verified',
    wmkf_addresstruststatejson: JSON.stringify(resolved),
  });
  getById.mockResolvedValueOnce(selectedPerson);
  findByEmailCandidates.mockResolvedValueOnce({ one: true, id: PERSON, row: selectedPerson });

  const known = await loadApplicantKnownReviewer(PERSON);
  expect(known).toMatchObject({
    addressTrustVerified: true,
    addressChoice: { decision: 'use_found', selectedEmail: 'rotem@example.edu' },
    emailReadiness: { action: 'ready', reason: STAFF_ADDRESS_CHOICE_REASON },
  });
  expect(pruneApplicantKnownReviewer(known)).toMatchObject({
    addressChoice: { decision: 'use_found', selectedEmail: 'rotem@example.edu' },
    emailReadiness: { action: 'ready', reason: STAFF_ADDRESS_CHOICE_REASON },
  });
});

test('omitted/null email is explicitly missing, never quick_check', async () => {
  getById.mockResolvedValue(person({ wmkf_emailaddress: undefined }));
  const known = await loadApplicantKnownReviewer(PERSON);
  expect(findByEmailCandidates).not.toHaveBeenCalled();
  expect(known).toMatchObject({
    status: 'known',
    email: null,
    emailReadiness: { action: 'missing' },
  });
});

test.each([
  ['inactive exact person', person({ statecode: 1 }), { none: true }, 'inactive'],
  ['different active owner', person(), { one: true, id: 'other', row: person({ wmkf_potentialreviewersid: 'other' }) }, 'email_conflict'],
  ['multiple active owners', person(), { ambiguous: true, count: 2, rows: [person(), person()] }, 'email_conflict'],
  ['inactive-only owner result', person(), { one: true, id: PERSON, row: person({ statecode: 1 }) }, 'email_conflict'],
  ['missing owner result', person(), { none: true }, 'unavailable'],
])('%s fails closed', async (_label, exactPerson, owners, status) => {
  getById.mockResolvedValue(exactPerson);
  findByEmailCandidates.mockResolvedValue(owners);
  await expect(loadApplicantKnownReviewer(PERSON)).resolves.toMatchObject({ status });
});

test('email-owner read failure is distinct from a person read failure', async () => {
  findByEmailCandidates.mockRejectedValue(new Error('owner lookup unavailable'));
  await expect(loadApplicantKnownReviewer(PERSON)).resolves.toMatchObject({
    status: 'unavailable',
    code: 'email_owner_unavailable',
    potentialReviewerId: PERSON,
  });
});

test('person read failure returns an unavailable bounded projection', async () => {
  getById.mockRejectedValue(new Error('Dataverse unavailable'));
  await expect(loadApplicantKnownReviewer(PERSON)).resolves.toMatchObject({
    status: 'unavailable',
    code: 'person_unavailable',
    potentialReviewerId: PERSON,
  });
});

test('canonical contact reuses exact stored address and preserves send action', () => {
  const known = pruneApplicantKnownReviewer({
    ...person(),
    status: 'known',
    potentialReviewerId: PERSON,
    email: 'rotem@example.edu',
    emailSource: 'serp_search',
  });
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: known,
    candidate: { email: 'rotem@example.edu' },
  })).toMatchObject({
    decision: 'ready',
    reusable: true,
    email: 'rotem@example.edu',
    emailReadiness: { action: 'research_only' },
  });
});

test('stored and enriched address disagreement is non-reusable until staff asserts a manual correction', () => {
  const known = {
    status: 'known',
    potentialReviewerId: PERSON,
    email: 'stored@example.edu',
    emailSource: null,
  };
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: known,
    candidate: { contactEnrichment: { email: 'new@example.edu' } },
  })).toMatchObject({ decision: 'contact_claim_mismatch', reusable: false });
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: known,
    candidate: { email: 'stored@example.edu', applicantContactMismatch: true },
  })).toMatchObject({ decision: 'ready', reusable: true });
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: known,
    candidate: {
      email: 'corrected@example.edu',
      applicantContactMismatch: true,
      pdIdentityConfirmed: true,
      manualContactFields: ['email'],
    },
    allowStaffManualContact: true,
  })).toMatchObject({
    decision: 'ready',
    reusable: false,
    email: 'corrected@example.edu',
    emailSource: 'manual',
    emailReadiness: { action: 'quick_check' },
  });
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: known,
    candidate: {
      email: 'rotem@nospam.example.edu',
      pdIdentityConfirmed: true,
      manualContactFields: ['email'],
    },
    allowStaffManualContact: true,
  })).toMatchObject({
    decision: 'missing_email',
    code: 'anti_scrape_email',
    reusable: false,
  });
});

test('anti-scrape stored address remains missing instead of becoming selectable', () => {
  expect(projectCanonicalApplicantContact({
    applicantKnownReviewer: {
      status: 'known',
      potentialReviewerId: PERSON,
      email: 'rotem@nospam.example.edu',
      emailSource: 'manual',
    },
    candidate: { email: 'rotem@nospam.example.edu' },
  })).toMatchObject({
    decision: 'missing_email',
    code: 'anti_scrape_email',
    reusable: false,
  });
});
