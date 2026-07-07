/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/save-candidates-service.js
 * (Route→Service Consolidation Plan, Stage 3 wave) — the partial-success
 * batch semantics at the service layer, adapters mocked: all-rejected 422
 * body (both rejected counts ALWAYS present), nothing-saved 500 body
 * (rejected* keys conditional), mixed-batch 200 with conditional
 * rejected-count and errors keys, and per-candidate failure isolation. The deep
 * identity/COI/persist-gate branches stay covered by
 * tests/unit/reviewer-route-identity-gate.test.js through the route.
 * (No duplicate-key translation path exists on this route — that is
 * my-candidates PATCH semantics.)
 */

jest.mock('../../lib/dataverse/adapters/potential-reviewer', () => ({
  upsertByEmail: jest.fn(async () => ({ id: 'PID-1' })),
  getById: jest.fn(async () => ({ wmkf_primaryaffiliation: 'MIT' })),
  getByEmail: jest.fn(async () => null),
  setContactLink: jest.fn(async () => ({ action: 'link' })),
}));
jest.mock('../../lib/dataverse/adapters/researcher', () => ({
  upsertByPotentialReviewer: jest.fn(async () => ({ id: 'PID-1' })),
  writeIdentityDecision: jest.fn(async () => undefined),
  clearIdentityFields: jest.fn(async () => undefined),
}));
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  upsert: jest.fn(async () => ({ id: 'S1' })),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  stampSuggestionAnchor: jest.fn(async () => ({ updated: 1 })),
}));
jest.mock('../../lib/services/reviewer-identity-lookup', () => ({
  lookupReviewerIdentity: jest.fn(async () => ({ outcome: 'none' })),
}));
jest.mock('../../lib/services/reviewer-request-context', () => ({
  loadCoiContext: jest.fn(async () => ({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  })),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 'alert-1' })) },
}));

const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const reviewerSuggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const { lookupReviewerIdentity } = require('../../lib/services/reviewer-identity-lookup');
const { loadCoiContext } = require('../../lib/services/reviewer-request-context');
const { saveCandidates, SaveCandidatesError } = require('../../lib/services/reviewer-finder/save-candidates-service');

const BASE = { requestId: 'REQ-1', actingUserSystemId: 'SYS-1' };

beforeEach(() => {
  jest.clearAllMocks();
  potentialReviewerAdapter.getByEmail.mockResolvedValue(null);
  potentialReviewerAdapter.getById.mockResolvedValue({ wmkf_primaryaffiliation: 'MIT' });
  potentialReviewerAdapter.upsertByEmail.mockResolvedValue({ id: 'PID-1' });
  reviewerSuggestionAdapter.upsert.mockResolvedValue({ id: 'S1' });
  lookupReviewerIdentity.mockResolvedValue({ outcome: 'none' });
  loadCoiContext.mockResolvedValue({
    applicantInstitutionContext: { state: 'complete', names: ['Applicant University'] },
    institutionEntries: [{ identity: 'Applicant University', display: 'Applicant University' }],
  });
});

test('422 SaveCandidatesError with the full body (both rejected counts always present) when ALL rows are rejected', async () => {
  const err = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Unresolved', needsIdentification: true },
      { name: 'Dr COI', hasInstitutionCOI: true },
    ],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toEqual({
    error: 'Selected candidates were not saved — they need identity review or are at the PI’s institution.',
    success: false,
    savedCount: 0,
    savedNames: [],
    totalRequested: 2,
    rejectedUnresolved: 1,
    rejectedInstitutionCOI: 1,
    errors: [
      {
        name: 'Dr Unresolved',
        error: 'Candidate identity is unresolved (needs identity review); not saved.',
        code: 'identity_unresolved',
      },
      {
        name: 'Dr COI',
        error: 'Candidate is at the proposal PI’s institution (institution COI); not saved.',
        code: 'institution_coi',
      },
    ],
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
});

test('500 SaveCandidatesError when nothing saved for non-rejection reasons; rejected* keys stay undefined', async () => {
  potentialReviewerAdapter.upsertByEmail.mockRejectedValue(new Error('Dataverse write failed'));
  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Fails' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(500);
  expect(err.body).toEqual({
    error: 'No candidates were saved.',
    success: false,
    savedCount: 0,
    savedNames: [],
    totalRequested: 1,
    errors: [{ name: 'Dr Fails', error: 'Dataverse write failed' }],
  });
  expect(err.body.rejectedUnresolved).toBeUndefined();
  expect(err.body.rejectedInstitutionCOI).toBeUndefined();
});

test('500 body includes a rejected count when the batch mixed rejections and failures (still zero saved)', async () => {
  potentialReviewerAdapter.upsertByEmail.mockRejectedValue(new Error('boom'));
  const err = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Unresolved', needsIdentification: true },
      { name: 'Dr Fails' },
    ],
  }).catch((e) => e);

  expect(err.httpStatus).toBe(500);
  expect(err.body.rejectedUnresolved).toBe(1);
  expect(err.body.rejectedInstitutionCOI).toBeUndefined();
  expect(err.body.errors).toHaveLength(2);
});

test('clean full success: 200 payload with NO rejected*/errors keys (undefined-valued, dropped at serialization)', async () => {
  const out = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr X', email: 'x@mit.edu' }],
  });

  expect(out).toEqual({
    success: true,
    savedCount: 1,
    savedNames: ['Dr X'],
    totalRequested: 1,
  });
  // Conditional keys are present-but-undefined, so res.json drops them.
  expect(JSON.parse(JSON.stringify(out))).toEqual({
    success: true,
    savedCount: 1,
    savedNames: ['Dr X'],
    totalRequested: 1,
  });
});

test('threads the gate-fetched email reuse row into upsertByEmail on a safe reuse', async () => {
  const existingReviewer = {
    wmkf_potentialreviewersid: 'PID-SAFE',
    wmkf_emailaddress: 'safe@example.edu',
    wmkf_primaryaffiliation: 'Different University',
  };
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(existingReviewer);
  potentialReviewerAdapter.upsertByEmail.mockResolvedValueOnce({
    id: 'PID-SAFE',
    created: false,
    reusedAffiliation: 'Different University',
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Safe Reuse',
      email: 'safe@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(out.savedCount).toBe(1);
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledTimes(1);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr Safe Reuse',
      email: 'safe@example.edu',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: existingReviewer },
  );
  expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalledWith(
    'PID-SAFE',
    expect.objectContaining({ name: 'Dr Safe Reuse' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ potentialReviewerId: 'PID-SAFE' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('threads a checked email miss into upsertByEmail so the write path cannot re-read a drifted row', async () => {
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Checked Miss',
      email: 'miss@example.edu',
      affiliation: 'Different University',
    }],
  });

  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledTimes(1);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr Checked Miss',
      email: 'miss@example.edu',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: null },
  );
});

test('mixed partial success: saved rows kept, rejected/failed rows accumulate their conditional keys', async () => {
  potentialReviewerAdapter.upsertByEmail.mockImplementation(async ({ name }) => {
    if (name === 'Dr Fails') throw new Error('adapter down');
    return { id: 'PID-1' };
  });

  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr Saved', email: 'ok@mit.edu' },
      { name: 'Dr Unresolved', identityStatus: 'unresolved' },
      { name: 'Dr COI', hasInstitutionCOI: true },
      { name: 'Dr Fails' },
    ],
  });

  expect(out.success).toBe(true);
  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr Saved']);
  expect(out.totalRequested).toBe(4);
  expect(out.rejectedUnresolved).toBe(1);
  expect(out.rejectedInstitutionCOI).toBe(1);
  expect(out.errors).toEqual([
    expect.objectContaining({ name: 'Dr Unresolved', code: 'identity_unresolved' }),
    expect.objectContaining({ name: 'Dr COI', code: 'institution_coi' }),
    { name: 'Dr Fails', error: 'adapter down' },
  ]);
});

test('a late per-candidate failure (suggestion upsert) does not abort the batch or unmark earlier saves', async () => {
  reviewerSuggestionAdapter.upsert
    .mockResolvedValueOnce({ id: 'S1' })
    .mockRejectedValueOnce(new Error('suggestion write failed'));

  const out = await saveCandidates({
    ...BASE,
    candidates: [
      { name: 'Dr First', email: 'a@mit.edu' },
      { name: 'Dr Second', email: 'b@mit.edu' },
    ],
  });

  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr First']);
  expect(out.errors).toEqual([{ name: 'Dr Second', error: 'suggestion write failed' }]);
});

test('server recomputes institution COI from the reused reviewer CRM affiliation (getByEmail) before any save write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // The write would reuse an existing reviewer by email (upsertByEmail { existing });
  // the gate evaluates THAT reuse target's CRM affiliation, not the payload's.
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-EXISTING',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr CRM Affiliation',
      email: 'crm@example.edu',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr CRM Affiliation',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
      institutionCOIDetails: expect.objectContaining({
        piInstitution: 'Applicant University',
        reviewerInstitution: 'Applicant University',
      }),
    }],
  });
  expect(lookupReviewerIdentity).toHaveBeenCalledWith({
    name: 'Dr CRM Affiliation',
    email: 'crm@example.edu',
    orcid: null,
  });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(
    '[save-candidates] server_recomputed_institution_coi_rejected',
    expect.objectContaining({
      requestId: BASE.requestId,
      candidateName: 'Dr CRM Affiliation',
      decisionSource: 'server_reviewer_identity_affiliation',
    }),
  );
  warn.mockRestore();
});

test('name-only namesake at the applicant institution does NOT block a distinct new reviewer (viaNameMatch excluded)', async () => {
  // The lookup surfaced a same-name existing reviewer at the applicant institution
  // via a fallback NAME search only (viaNameMatch:true). Persistence creates a NEW
  // reviewer (new email → getByEmail null, no reuse) and never reuses the namesake,
  // so its CRM affiliation must NOT trigger a false institution COI.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'reviewer', matchKey: 'name', reviewerId: 'PID-NAMESAKE', context: { affiliation: 'Applicant University' } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-NAMESAKE', affiliation: 'Applicant University', viaNameMatch: true },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const out = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Namesake', email: 'new@safe.edu', affiliation: 'Safe University' }],
  });

  expect(out.success).toBe(true);
  expect(out.savedCount).toBe(1);
  expect(out.savedNames).toEqual(['Dr Namesake']);
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledTimes(1);
  // The weak namesake id is not a reuse/link target — it was never read by id.
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
});

test('an EXACT (viaNameMatch:false) referenced reviewer at the applicant institution still fails COI even with no email reuse target', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // A strong identity reference (email/ORCID/link, viaNameMatch:false) is a real
  // reuse/link target and must stay screened — the fix narrows ONLY weak namesakes.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'reviewer', matchKey: 'email', reviewerId: 'PID-EMAILMATCH', context: { affiliation: 'Applicant University' } },
    ],
    referencedReviewers: [
      { reviewerId: 'PID-EMAILMATCH', affiliation: 'Applicant University', viaNameMatch: false },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Strong', email: 'strong@example.edu', affiliation: 'Safe University' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({ savedCount: 0, rejectedInstitutionCOI: 1 });
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('non-confident lookup shape (linked/conflict/none) still fails COI via the email reuse target — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // A non-confident outcome (here 'candidates' with a `source:'linked'` row, the exact
  // shape earlier missed): the write would still reuse the existing reviewer by email,
  // so the gate reads getByEmail's CRM affiliation regardless of the lookup shape.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    candidates: [
      { source: 'linked', matchKey: 'name', reviewerId: 'PID-EXISTING', context: { affiliation: 'Applicant University' } },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-EXISTING',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    // No COI flags, payload affiliation deliberately omitted — only the trusted
    // reused-reviewer CRM row exposes the same-institution conflict.
    candidates: [{ name: 'Dr Ambiguous', email: 'ambiguous@example.edu' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Ambiguous',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledWith('ambiguous@example.edu');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with linked ORCID candidate at applicant institution fails COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'candidates',
    referencedReviewers: [{ reviewerId: 'PID-LINKED', affiliation: 'Applicant University' }],
    candidates: [
      {
        source: 'linked',
        matchKey: 'orcid',
        reviewerId: 'PID-LINKED',
        context: { affiliation: 'Applicant University' },
      },
    ],
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Linked NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Linked NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with conflict reviewerId at applicant institution fails COI via getById — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'contact_linked_elsewhere',
    details: { reviewerId: 'PID-CONFLICT' },
    referencedReviewers: [{ reviewerId: 'PID-CONFLICT', affiliation: null }],
  });
  potentialReviewerAdapter.getById.mockResolvedValueOnce({
    wmkf_potentialreviewersid: 'PID-CONFLICT',
    wmkf_primaryaffiliation: 'Applicant University',
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Conflict NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-CONFLICT');
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with conflict reviewerId getById failure fails closed — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'contact_linked_elsewhere',
    details: { reviewerId: 'PID-CONFLICT' },
    referencedReviewers: [{ reviewerId: 'PID-CONFLICT', affiliation: null }],
  });
  potentialReviewerAdapter.getById.mockRejectedValueOnce(new Error('reviewer read down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Conflict Lookup Down', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Conflict Lookup Down',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_affiliation_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-CONFLICT');
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate whose identity lookup throws fails closed before writes', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockRejectedValueOnce(new Error('lookup down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Lookup Throws', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Lookup Throws',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email candidate with ORCID/email split conflict resolves every referenced reviewer and rejects same-institution COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'conflict',
    reason: 'orcid_email_split',
    details: {
      orcidReviewerId: 'PID-ORCID',
      emailReviewerId: 'PID-EMAIL',
    },
    referencedReviewers: [
      { reviewerId: 'PID-ORCID', affiliation: null },
      { reviewerId: 'PID-EMAIL', affiliation: null },
    ],
  });
  potentialReviewerAdapter.getByEmail.mockResolvedValueOnce(null);
  potentialReviewerAdapter.getById.mockImplementation(async (id) => ({
    wmkf_potentialreviewersid: id,
    wmkf_primaryaffiliation: id === 'PID-ORCID' ? 'Applicant University' : 'Different University',
  }));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr Split Email',
      email: 'split@example.edu',
      orcid: '0000-0002-1825-0097',
      affiliation: 'Different University',
    }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Split Email',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).toHaveBeenCalledWith('split@example.edu');
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-ORCID');
  expect(potentialReviewerAdapter.getById).toHaveBeenCalledWith('PID-EMAIL');
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email candidate whose identity lookup throws fails closed before writes', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  lookupReviewerIdentity.mockRejectedValueOnce(new Error('lookup down'));

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr Email Lookup Throws', email: 'throws@example.edu' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr Email Lookup Throws',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'reviewer_identity_lookup_failed',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.setContactLink).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});

test('email-less candidate with no lookup match and non-conflicting payload affiliation saves', async () => {
  lookupReviewerIdentity.mockResolvedValueOnce({ outcome: 'none' });

  const out = await saveCandidates({
    ...BASE,
    candidates: [{
      name: 'Dr NoEmail Safe',
      affiliation: 'Different University',
      expertise: 'Safe science',
    }],
  });

  expect(out).toMatchObject({
    success: true,
    savedCount: 1,
    savedNames: ['Dr NoEmail Safe'],
    totalRequested: 1,
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.getById).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'Dr NoEmail Safe',
      email: null,
      affiliation: 'Different University',
    }),
    { actingUserSystemId: BASE.actingUserSystemId, existing: null },
  );
  expect(researcherAdapter.upsertByPotentialReviewer).toHaveBeenCalledWith(
    'PID-1',
    expect.objectContaining({
      name: 'Dr NoEmail Safe',
      affiliation: 'Different University',
    }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
  expect(reviewerSuggestionAdapter.upsert).toHaveBeenCalledWith(
    expect.objectContaining({ potentialReviewerId: 'PID-1' }),
    { actingUserSystemId: BASE.actingUserSystemId },
  );
});

test('email-less candidate with a confident ORCID match to a same-institution reviewer fails COI — no write', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // No email → the write would CREATE a new reviewer (upsertByEmail with email:null
  // skips reuse), but the confident ORCID match exposes the existing reviewer's CRM
  // affiliation; the gate must evaluate it regardless of the missing email.
  lookupReviewerIdentity.mockResolvedValueOnce({
    outcome: 'confident',
    referencedReviewers: [{ reviewerId: 'PID-ORCID', affiliation: 'Applicant University' }],
    match: {
      reviewerId: 'PID-ORCID',
      matchKey: 'orcid',
      context: { affiliation: 'Applicant University' },
    },
  });

  const err = await saveCandidates({
    ...BASE,
    candidates: [{ name: 'Dr NoEmail', orcid: '0000-0002-1825-0097' }],
  }).catch((e) => e);

  expect(err).toBeInstanceOf(SaveCandidatesError);
  expect(err.httpStatus).toBe(422);
  expect(err.body).toMatchObject({
    savedCount: 0,
    rejectedInstitutionCOI: 1,
    errors: [{
      name: 'Dr NoEmail',
      code: 'institution_coi',
      serverRecomputed: true,
      decisionSource: 'server_reviewer_identity_affiliation',
    }],
  });
  expect(potentialReviewerAdapter.getByEmail).not.toHaveBeenCalled();
  expect(potentialReviewerAdapter.upsertByEmail).not.toHaveBeenCalled();
  expect(researcherAdapter.upsertByPotentialReviewer).not.toHaveBeenCalled();
  expect(reviewerSuggestionAdapter.upsert).not.toHaveBeenCalled();
  warn.mockRestore();
});
