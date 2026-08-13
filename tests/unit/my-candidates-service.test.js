/**
 * @jest-environment node
 *
 * Unit tests for lib/services/reviewer-finder/my-candidates-service.js
 * (Route→Service Consolidation Plan, Stage 3 — P1m multi-verb pilot).
 * One method per verb, adapters mocked: per-verb happy paths, the
 * mode=proposals GET branch (incl. its sanitized 500), PATCH bulk-vs-single
 * dispatch, duplicate-email partial success + savedFields, restore path,
 * and DELETE semantics (atomic softDelete args; failure propagation).
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
jest.mock('../../lib/dataverse/adapters/reviewer-suggestion', () => ({
  __esModule: true,
  findByRequest: jest.fn(async () => []),
  findRemovedByRequest: jest.fn(async () => []),
  findByPD: jest.fn(async () => ({ suggestions: [], requestById: {} })),
  aggregateReviewHistory: jest.fn(async () => ({})),
  findById: jest.fn(),
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

const { resolveByEmail } = require('../../lib/services/program-director-resolver');
const grantRequestAdapter = require('../../lib/dataverse/adapters/grant-request');
const suggestionAdapter = require('../../lib/dataverse/adapters/reviewer-suggestion');
const potentialReviewerAdapter = require('../../lib/dataverse/adapters/potential-reviewer');
const researcherAdapter = require('../../lib/dataverse/adapters/researcher');
const { ensureToken } = require('../../lib/external/token-lifecycle');
const { translateDuplicateKeyError } = require('../../lib/dataverse/duplicate-key');
const {
  getMyCandidates,
  patchMyCandidates,
  deleteMyCandidates,
  MyCandidatesError,
} = require('../../lib/services/reviewer-finder/my-candidates-service');

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SUGGESTION_ID = '33333333-3333-3333-3333-333333333333';
const PERSON_ID = '22222222-2222-2222-2222-222222222222';
const EMAIL = 'pd@example.org';
const SYS = 'u-1';

beforeEach(() => {
  jest.clearAllMocks();
  translateDuplicateKeyError.mockReturnValue(null);
});

describe('getMyCandidates', () => {
  test('single-request scope: hydrates person/researcher and groups candidates under the proposal', async () => {
    grantRequestAdapter.getById.mockResolvedValue({
      akoya_requestid: REQUEST_ID,
      akoya_requestnum: 'R-1',
      akoya_title: 'A Proposal',
      wmkf_meetingdate: '2026-06-15',
      wmkf_reviewduedate: '2026-09-01',
    });
    suggestionAdapter.findByRequest.mockResolvedValue([{
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_request_value: REQUEST_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_sources: 'literature_retrieved',
      wmkf_responsetype: 100000000,
      wmkf_respondremindersentat: '2026-08-10T00:00:00Z',
      wmkf_reviewduedateoverride: '2026-09-15',
    }]);
    potentialReviewerAdapter.queryReviewers.mockImplementation(async ({ select }) => (
      select.includes('wmkf_organizationname')
        ? { records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr X', wmkf_emailaddress: 'x@example.org' }] }
        : { records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_primaryaffiliation: 'MIT' }] }
    ));

    const out = await getMyCandidates({ requestId: REQUEST_ID, azureEmail: EMAIL });

    expect(out.success).toBe(true);
    expect(out.totalCandidates).toBe(1);
    expect(out.proposals[0]).toMatchObject({ proposalId: REQUEST_ID, requestNumber: 'R-1' });
    expect(out.proposals[0].candidates[0]).toMatchObject({
      suggestionId: SUGGESTION_ID,
      name: 'Dr X',
      affiliation: 'MIT',
      responseType: 'accepted', // optionset → string code mapping preserved
      respondReminderSentAt: '2026-08-10T00:00:00Z',
      reviewDueDateOverride: '2026-09-15',
      requestReviewDeadline: '2026-09-01',
      effectiveReviewDeadline: '2026-09-15',
    });
    expect(resolveByEmail).not.toHaveBeenCalled(); // explicit request skips PD scope
  });

  test('single-request scope with only REMOVED rows builds a proposal shell carrying removedCandidates', async () => {
    grantRequestAdapter.getById.mockResolvedValue({
      akoya_requestid: REQUEST_ID, akoya_requestnum: 'R-1', akoya_title: 'A Proposal',
    });
    suggestionAdapter.findByRequest.mockResolvedValue([]);
    suggestionAdapter.findRemovedByRequest.mockResolvedValue([{
      wmkf_appreviewersuggestionid: SUGGESTION_ID,
      _wmkf_potentialreviewer_value: PERSON_ID,
      wmkf_invited: true,
      wmkf_declined: true,
      wmkf_responsetype: 100000001,
      modifiedon: '2026-06-01',
    }]);
    potentialReviewerAdapter.queryReviewers.mockImplementation(async ({ select }) => (
      select.includes('wmkf_organizationname')
        ? { records: [{ wmkf_potentialreviewersid: PERSON_ID, wmkf_name: 'Dr X' }] }
        : { records: [{
          wmkf_potentialreviewersid: PERSON_ID,
          wmkf_orcid: '0000-0001-2345-6789',
          wmkf_orcidurl: 'https://orcid.org/0000-0001-2345-6789',
          wmkf_googlescholarid: 'scholar-x',
        }] }
    ));

    const out = await getMyCandidates({ requestId: REQUEST_ID, azureEmail: EMAIL });

    expect(out.totalCandidates).toBe(0);
    expect(out.proposals[0].candidates).toEqual([]);
    expect(out.proposals[0].removedCandidates).toEqual([expect.objectContaining({
      suggestionId: SUGGESTION_ID,
      potentialReviewerId: PERSON_ID,
      name: 'Dr X',
      orcid: '0000-0001-2345-6789',
      orcidUrl: 'https://orcid.org/0000-0001-2345-6789',
      googleScholarId: 'scholar-x',
      wasInvited: true,
      declined: true,
      responseType: 'declined',
      removedAt: '2026-06-01',
    })]);
  });

  test('PD scope with unresolvable PD returns the empty envelope with programDirector: null', async () => {
    resolveByEmail.mockResolvedValue(null);
    const out = await getMyCandidates({ azureEmail: EMAIL });
    expect(out).toEqual({ success: true, proposals: [], totalCandidates: 0, programDirector: null });
  });

  test('mode=proposals returns the sorted distinct request list', async () => {
    resolveByEmail.mockResolvedValue({ systemuserid: 'pd-1' });
    suggestionAdapter.findByPD.mockResolvedValue({
      requestById: {
        [REQUEST_ID]: { requestId: REQUEST_ID, title: 'Old', requestNumber: 'R-1', cycleCode: 'D25', cycleLabel: 'Dec 2025', meetingDate: '2025-12-01' },
        [SUGGESTION_ID]: { requestId: SUGGESTION_ID, title: 'New', requestNumber: 'R-2', cycleCode: 'J26', cycleLabel: 'Jun 2026', meetingDate: '2026-06-15' },
      },
    });

    const out = await getMyCandidates({ mode: 'proposals', azureEmail: EMAIL });

    expect(out.success).toBe(true);
    expect(out.proposals.map((p) => p.title)).toEqual(['New', 'Old']); // newest first
    expect(out.proposals[0]).toEqual({
      id: SUGGESTION_ID,
      proposalHash: SUGGESTION_ID,
      title: 'New',
      cycleCode: 'J26',
      cycleLabel: 'Jun 2026',
      requestNumber: 'R-2',
      meetingDate: '2026-06-15',
    });
  });

  test('mode=proposals failure throws the SANITIZED 500 (no details) MyCandidatesError', async () => {
    resolveByEmail.mockRejectedValue(new Error('secret upstream detail'));
    const err = await getMyCandidates({ mode: 'proposals', azureEmail: EMAIL }).catch((e) => e);
    expect(err).toBeInstanceOf(MyCandidatesError);
    expect(err.httpStatus).toBe(500);
    expect(err.body).toEqual({ error: 'Failed to fetch proposals' });
  });

  test('default-scope adapter failure propagates untyped (shell owns the detailed 500)', async () => {
    resolveByEmail.mockResolvedValue({ systemuserid: 'pd-1' });
    suggestionAdapter.findByPD.mockRejectedValue(new Error('Dataverse down'));
    await expect(getMyCandidates({ azureEmail: EMAIL })).rejects.toThrow('Dataverse down');
  });

  test('chunk boundary: 26 distinct person ids chunk both the reviewer and researcher OR-chains at 25, first call gets ids 0-24 in order, second gets id 25', async () => {
    grantRequestAdapter.getById.mockResolvedValue({
      akoya_requestid: REQUEST_ID, akoya_requestnum: 'R-1', akoya_title: 'A Proposal',
    });
    const personIds = Array.from({ length: 26 }, (_, i) => `person-${i}`);
    suggestionAdapter.findByRequest.mockResolvedValue(
      personIds.map((pid, i) => ({
        wmkf_appreviewersuggestionid: `sug-${i}`,
        _wmkf_request_value: REQUEST_ID,
        _wmkf_potentialreviewer_value: pid,
      })),
    );
    suggestionAdapter.findRemovedByRequest.mockResolvedValue([]);
    potentialReviewerAdapter.queryReviewers.mockResolvedValue({ records: [] });

    await getMyCandidates({ requestId: REQUEST_ID, azureEmail: EMAIL });

    const reviewerCalls = potentialReviewerAdapter.queryReviewers.mock.calls.filter((c) => c[0].select.includes('wmkf_name'));
    const researcherCalls = potentialReviewerAdapter.queryReviewers.mock.calls.filter((c) => c[0].select.includes('wmkf_primaryaffiliation'));
    expect(reviewerCalls).toHaveLength(2);
    expect(researcherCalls).toHaveLength(2);
    for (const calls of [reviewerCalls, researcherCalls]) {
      expect(calls[0][0].filter.split(' or ')).toEqual(
        personIds.slice(0, 25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
      );
      expect(calls[1][0].filter.split(' or ')).toEqual(
        personIds.slice(25).map((id) => `wmkf_potentialreviewersid eq ${id}`),
      );
    }
  });

  test('chunk boundary: 26 distinct applicant account ids chunk the AKA OR-chain at 25, first call gets ids 0-24 in order, second gets id 25', async () => {
    resolveByEmail.mockResolvedValue({ systemuserid: 'pd-1' });
    const accountIds = Array.from({ length: 26 }, (_, i) => `account-${i}`);
    const requestById = {};
    accountIds.forEach((aid, i) => {
      requestById[`req-${i}`] = { requestId: `req-${i}`, applicantId: aid };
    });
    suggestionAdapter.findByPD.mockResolvedValue({
      suggestions: [{ wmkf_appreviewersuggestionid: 's-0', _wmkf_request_value: 'req-0', _wmkf_potentialreviewer_value: null }],
      requestById,
    });

    await getMyCandidates({ azureEmail: EMAIL });

    const accountAdapter = require('../../lib/dataverse/adapters/account');
    expect(accountAdapter.queryAccounts).toHaveBeenCalledTimes(2);
    const firstFilter = accountAdapter.queryAccounts.mock.calls[0][0].filter;
    const secondFilter = accountAdapter.queryAccounts.mock.calls[1][0].filter;
    expect(firstFilter.split(' or ')).toEqual(accountIds.slice(0, 25).map((id) => `accountid eq ${id}`));
    expect(secondFilter.split(' or ')).toEqual(accountIds.slice(25).map((id) => `accountid eq ${id}`));
  });
});

describe('patchMyCandidates', () => {
  test('bulk-by-request dispatch: proposalId without suggestionId → bulkUpdateByRequest, bulk envelope', async () => {
    suggestionAdapter.bulkUpdateByRequest.mockResolvedValue(3);
    const out = await patchMyCandidates({
      body: { proposalId: REQUEST_ID, programArea: 'Science' },
      actingUserSystemId: SYS,
    });
    expect(out).toEqual({
      success: true,
      message: 'Proposal updated',
      updated: { proposalId: REQUEST_ID, programArea: 'Science', suggestionsUpdated: 3 },
    });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('bulk rejected fields (PI/institution) → 400 with rejectedFields + hint body', async () => {
    const err = await patchMyCandidates({
      body: { proposalId: REQUEST_ID, proposalAuthors: 'X', grantCycleCode: 'J26' },
      actingUserSystemId: SYS,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(MyCandidatesError);
    expect(err.httpStatus).toBe(400);
    expect(err.body).toEqual({
      error: 'Editing PI / institution is not supported here',
      rejectedFields: ['proposalAuthors'],
      hint: 'These fields belong on akoya_request and are managed in CRM.',
    });
    expect(suggestionAdapter.bulkUpdateByRequest).not.toHaveBeenCalled();
  });

  test('single-suggestion dispatch: lifecycle edit calls updateLifecycle; accepted=true auto-mints token non-fatally', async () => {
    ensureToken.mockRejectedValue(new Error('mint failed'));
    const out = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, accepted: true },
      actingUserSystemId: SYS,
    });
    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID, { accepted: true }, { actingUserSystemId: SYS },
    );
    expect(ensureToken).toHaveBeenCalledWith(SUGGESTION_ID, { actingUserSystemId: SYS });
    expect(out).toEqual({
      success: true,
      message: 'Candidate updated',
      updated: { suggestionId: SUGGESTION_ID, accepted: true },
    });
  });

  test('the generic candidate PATCH cannot bypass the accepted-reviewer extension workflow', async () => {
    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, reviewDueDateOverride: '2099-09-15' },
      actingUserSystemId: SYS,
    })).rejects.toMatchObject({
      httpStatus: 400,
      message: 'No supported fields to update',
    });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('restore: true re-selects via restore() and returns the restore envelope', async () => {
    const out = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, restore: true },
      actingUserSystemId: SYS,
    });
    expect(suggestionAdapter.restore).toHaveBeenCalledWith(SUGGESTION_ID, { actingUserSystemId: SYS });
    expect(out).toEqual({ success: true, message: 'Candidate restored' });
  });

  test('manual invitation: verifies the current official link and records the normal invite lifecycle with an optimistic lock', async () => {
    suggestionAdapter.findById.mockResolvedValue({
      _etag: 'W/"7"',
      wmkf_selected: true,
      wmkf_invited: false,
      wmkf_accepted: false,
      wmkf_declined: false,
      wmkf_responsetype: null,
      wmkf_externaltokenhash: 'hash:manual.token',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
    });

    const out = await patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    });

    expect(suggestionAdapter.updateLifecycle).toHaveBeenCalledWith(
      SUGGESTION_ID,
      expect.objectContaining({ invited: true, emailSentAt: expect.any(String), respondReminderSentAt: null }),
      { actingUserSystemId: SYS, ifMatch: 'W/"7"' },
    );
    expect(out).toMatchObject({
      success: true,
      message: 'Manual invitation recorded',
      manualInviteRecorded: true,
      updated: { suggestionId: SUGGESTION_ID, invited: true },
    });
  });

  test('manual invitation: fails closed when the current lifecycle ETag is unavailable', async () => {
    suggestionAdapter.findById.mockResolvedValue({
      wmkf_selected: true,
      wmkf_invited: false,
      wmkf_accepted: false,
      wmkf_declined: false,
      wmkf_responsetype: null,
      wmkf_externaltokenhash: 'hash:manual.token',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
    });

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
      actingUserSystemId: SYS,
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: 'manual_invite_state_unavailable' } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('manual invitation: rejects a replaced link without changing lifecycle state', async () => {
    suggestionAdapter.findById.mockResolvedValue({
      _etag: 'W/"7"',
      wmkf_selected: true,
      wmkf_externaltokenhash: 'hash:newer.token',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
    });

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/older.token',
      },
    })).rejects.toMatchObject({
      httpStatus: 409,
      body: { code: 'stale_manual_link' },
    });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test.each([
    ['not selected', { wmkf_selected: false }, 'candidate_not_selected'],
    ['already invited', { wmkf_selected: true, wmkf_invited: true }, 'already_invited'],
    ['already responded', { wmkf_selected: true, wmkf_accepted: true }, 'already_responded'],
    ['revoked link', { wmkf_selected: true, wmkf_externaltokenrevoked: true }, 'stale_manual_link'],
  ])('manual invitation: rejects %s', async (_label, override, expectedCode) => {
    suggestionAdapter.findById.mockResolvedValue({
      _etag: 'W/"7"',
      wmkf_selected: true,
      wmkf_invited: false,
      wmkf_accepted: false,
      wmkf_declined: false,
      wmkf_responsetype: null,
      wmkf_externaltokenhash: 'hash:manual.token',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
      ...override,
    });

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: expectedCode } });
    expect(suggestionAdapter.updateLifecycle).not.toHaveBeenCalled();
  });

  test('manual invitation: translates a concurrent token/lifecycle change into a stale-link recovery response', async () => {
    suggestionAdapter.findById.mockResolvedValue({
      _etag: 'W/"7"',
      wmkf_selected: true,
      wmkf_externaltokenhash: 'hash:manual.token',
      wmkf_externaltokenrevoked: false,
      wmkf_externaltokenexpires: '2099-01-01T00:00:00.000Z',
    });
    suggestionAdapter.updateLifecycle.mockRejectedValue(Object.assign(new Error('precondition failed'), { status: 412 }));

    await expect(patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        markManualInviteSent: true,
        manualLink: 'https://reviews.wmkeck.org/external/review/manual.token',
      },
    })).rejects.toMatchObject({ httpStatus: 409, body: { code: 'stale_manual_link' } });
  });

  test('validation: neither id → 400; bad GUIDs → 400; no supported fields → 400; missing person link → 404', async () => {
    await expect(patchMyCandidates({ body: {} })).rejects.toMatchObject({ httpStatus: 400, message: 'suggestionId or proposalId is required' });
    await expect(patchMyCandidates({ body: { proposalId: 'nope', programArea: 'x' } })).rejects.toMatchObject({ httpStatus: 400, message: 'proposalId is not a valid GUID' });
    await expect(patchMyCandidates({ body: { suggestionId: 'nope', invited: true } })).rejects.toMatchObject({ httpStatus: 400, message: 'suggestionId is not a valid GUID' });
    await expect(patchMyCandidates({ body: { suggestionId: SUGGESTION_ID } })).rejects.toMatchObject({ httpStatus: 400, message: 'No supported fields to update' });
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: null });
    await expect(patchMyCandidates({ body: { suggestionId: SUGGESTION_ID, name: 'X' } })).rejects.toMatchObject({ httpStatus: 404, message: 'Linked potential reviewer not found for this suggestion' });
  });

  test('duplicate-email 409: conflict-safe fields committed first, savedFields + partialSuccess + conflictingRecordId in body', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates && 'email' in updates) throw new Error('alt-key duplicate');
      return undefined;
    });
    translateDuplicateKeyError.mockImplementation((e) => (
      e?.message === 'alt-key duplicate'
        ? { field: 'wmkf_emailaddress', value: 'dup@x.org', message: 'That email is already in use.' }
        : null
    ));
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({
      one: true, id: 'WINNER-1', row: { statecode: 0 },
    });

    const err = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, affiliation: 'JILA', website: 'https://jila.edu', email: 'dup@x.org' },
      actingUserSystemId: SYS,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(MyCandidatesError);
    expect(err.httpStatus).toBe(409);
    expect(err.body).toEqual({
      field: 'wmkf_emailaddress',
      value: 'dup@x.org',
      message: 'That email is already in use.',
      conflictingRecordId: 'WINNER-1',
      partialSuccess: true,
      savedFields: ['affiliation', 'website'],
    });
    // emailSource never stamped manual for an email that did not land.
    expect(researcherAdapter.updateById).not.toHaveBeenCalledWith(
      PERSON_ID, expect.objectContaining({ emailSource: 'manual' }), expect.anything(),
    );
  });

  test('manual email edit cannot bypass a pending address conflict and returns executable remedies', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.getById.mockResolvedValueOnce({
      wmkf_emailaddress: 'stored@example.edu',
      wmkf_addresstruststatejson: JSON.stringify({
        version: 1,
        email: 'stored@example.edu',
        status: 'conflict_pending',
        attestation: null,
        conflict: {
          reason: 'email_mismatch',
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@example.edu',
          source: 'scholarly_multi',
          requestId: REQUEST_ID,
          candidateKey: `suggestion:${SUGGESTION_ID}`,
          detectedAt: '2026-07-31T20:00:00.000Z',
        },
        resolution: null,
      }),
    });

    const error = await patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        affiliation: 'Updated Institute',
        email: 'found@example.edu',
      },
      actingUserSystemId: SYS,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(MyCandidatesError);
    expect(error).toMatchObject({
      httpStatus: 409,
      body: {
        code: 'address_conflict_pending',
        partialSuccess: true,
        savedFields: ['affiliation'],
        remediation: expect.arrayContaining([
          expect.objectContaining({ action: 'resolve_address_conflict' }),
          expect.objectContaining({ action: 'create_repair_request' }),
        ]),
      },
    });
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalledWith(
      PERSON_ID,
      expect.objectContaining({ email: expect.anything() }),
      expect.anything(),
    );
  });

  test('concurrent person change makes a manual address edit a retryable 409 with partial-save detail', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.getById.mockResolvedValueOnce({
      wmkf_emailaddress: 'old@example.edu',
      wmkf_addresstruststatejson: null,
      _etag: 'W/"person-1"',
    });
    potentialReviewerAdapter.update.mockImplementation(async (_id, updates) => {
      if (updates?.email) throw Object.assign(new Error('Precondition Failed'), { status: 412 });
    });

    const error = await patchMyCandidates({
      body: {
        suggestionId: SUGGESTION_ID,
        affiliation: 'Updated Institute',
        email: 'new@example.edu',
      },
      actingUserSystemId: SYS,
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      httpStatus: 409,
      body: {
        code: 'candidate_stale',
        partialSuccess: true,
        savedFields: ['affiliation'],
        remediation: [expect.objectContaining({ action: 'reload_candidate' })],
      },
    });
    expect(potentialReviewerAdapter.update).toHaveBeenCalledWith(
      PERSON_ID,
      { email: 'new@example.edu', emailSource: 'manual' },
      { actingUserSystemId: SYS, ifMatch: 'W/"person-1"' },
    );
  });

  test('manual address edit fails closed with a reload remedy when the person ETag is missing', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.getById.mockResolvedValueOnce({
      wmkf_emailaddress: 'old@example.edu',
      wmkf_addresstruststatejson: null,
    });

    const error = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, email: 'new@example.edu' },
      actingUserSystemId: SYS,
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      httpStatus: 409,
      body: {
        code: 'candidate_stale',
        partialSuccess: false,
        remediation: [expect.objectContaining({ action: 'reload_candidate' })],
      },
    });
    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
  });

  test('empty email routes through the explicit ETag-bound clear command', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    const emailClear = {
      expectedEmail: 'old@example.edu',
      expectedEmailSource: 'manual',
      expectedEtag: 'W/"8"',
      reason: 'staff_removed_incorrect_address',
    };

    const out = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, email: '', emailClear },
      actingUserSystemId: SYS,
    });

    expect(potentialReviewerAdapter.update).not.toHaveBeenCalled();
    expect(potentialReviewerAdapter.clearEmailForEdit).toHaveBeenCalledWith(
      PERSON_ID,
      emailClear,
      { actingUserSystemId: SYS },
    );
    expect(out.success).toBe(true);
  });

  test('empty email without clear evidence is a typed client error', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.clearEmailForEdit.mockRejectedValue(
      Object.assign(new Error('clear evidence required'), {
        code: 'contact_clear_evidence_required',
        status: 400,
      }),
    );

    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, email: '' },
    })).rejects.toMatchObject({
      httpStatus: 400,
      body: { code: 'contact_clear_evidence_required' },
    });
  });

  test('duplicate-key conflicting owner is fail-closed: ambiguous/inactive owner → conflictingRecordId null', async () => {
    suggestionAdapter.findById.mockResolvedValue({ _wmkf_potentialreviewer_value: PERSON_ID });
    potentialReviewerAdapter.update.mockRejectedValue(new Error('dup'));
    translateDuplicateKeyError.mockReturnValue({ field: 'wmkf_emailaddress', value: 'dup@x.org', message: 'in use' });
    potentialReviewerAdapter.findByEmailCandidates.mockResolvedValue({ one: false });

    const err = await patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, email: 'dup@x.org' },
    }).catch((e) => e);

    expect(err.httpStatus).toBe(409);
    expect(err.body.conflictingRecordId).toBeNull();
    expect(err.body.partialSuccess).toBe(false);
    expect(err.body.savedFields).toEqual([]);
  });

  test('non-duplicate adapter failures propagate untyped (shell owns the 500)', async () => {
    suggestionAdapter.updateLifecycle.mockRejectedValue(new Error('Dataverse down'));
    await expect(patchMyCandidates({
      body: { suggestionId: SUGGESTION_ID, invited: true },
    })).rejects.toThrow('Dataverse down');
  });
});

describe('deleteMyCandidates', () => {
  test('happy path: ONE atomic softDelete with alsoRevokeToken, removal envelope', async () => {
    const out = await deleteMyCandidates({ suggestionId: SUGGESTION_ID, actingUserSystemId: SYS });
    expect(suggestionAdapter.softDelete).toHaveBeenCalledWith(
      SUGGESTION_ID, { actingUserSystemId: SYS, alsoRevokeToken: true },
    );
    expect(out).toEqual({ success: true, message: 'Candidate removed' });
  });

  test('missing-row softDelete failure propagates untyped (caller keeps the row; shell 500s)', async () => {
    suggestionAdapter.softDelete.mockRejectedValue(new Error('row not found'));
    await expect(deleteMyCandidates({ suggestionId: SUGGESTION_ID })).rejects.toThrow('row not found');
  });
});
