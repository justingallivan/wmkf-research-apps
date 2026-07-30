/**
 * @jest-environment node
 *
 * /api/workbench/reviewer-roster (S224) — auth gate, GUID validation, method
 * dispatch, and payload contracts. The store is mocked; `pruneCandidateForRoster`
 * runs for real (pure) so we also confirm the route prunes server-side.
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn(async () => ({ profileId: 5 })) }));
jest.mock('../../lib/services/reviewer-candidate-attestation', () => ({
  verifyAutomatedIdentityAttestation: jest.fn(async () => ({ valid: false, reason: 'no_token' })),
}));
jest.mock('../../lib/services/reviewer-roster-store', () => ({
  listForRequest: jest.fn(async () => ({ active: [], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [] })),
  recordSurfaced: jest.fn(async () => 0),
  setExcluded: jest.fn(async () => {}),
  promote: jest.fn(async () => ({ name: 'Bob Roe' })),
  confirmIdentity: jest.fn(async () => ({ confirmationId: 'confirm-1', candidate: { name: 'Ann Lee' } })),
  markSaved: jest.fn(async () => 1),
  findCandidateBySuggestion: jest.fn(async () => null),
  // S387: the roster route resolves an applicant row by its Dataverse ANCHOR, so an
  // anchor-stamped row still carrying a pre-anchor placeholder key can be excluded /
  // marked saved / identity-confirmed instead of 409-ing with no way forward.
  findCandidateBySuggestionAnchor: jest.fn(async () => null),
  findCandidatesByKeys: jest.fn(async () => []),
  removePreviousActiveSearchResults: jest.fn(async () => ({
    removed: 2,
    removedKeys: ['candidate:old-a', 'candidate:old-b'],
    active: [{ name: 'Applicant Person', provenance: { kind: 'applicant_suggested' } }],
    excluded: [{ name: 'Excluded Person' }],
    allNames: ['Applicant Person', 'Excluded Person', 'Saved Person'],
  })),
}));

import handler from '../../pages/api/workbench/reviewer-roster';
import { requireAppAccess } from '../../lib/utils/auth';
import { verifyAutomatedIdentityAttestation } from '../../lib/services/reviewer-candidate-attestation';
import * as store from '../../lib/services/reviewer-roster-store';
import { reviewerCandidateKey } from '../../shared/components/reviewers/reviewer-search-logic';

const REQ = '11111111-1111-1111-1111-111111111111';

function res() {
  return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 5 });
  verifyAutomatedIdentityAttestation.mockResolvedValue({ valid: false, reason: 'no_token' });
  store.findCandidateBySuggestion.mockResolvedValue(null);
  store.findCandidateBySuggestionAnchor.mockResolvedValue(null);
  store.findCandidatesByKeys.mockResolvedValue([]);
});

describe('auth', () => {
  it('short-circuits without calling the store when access is denied', async () => {
    requireAppAccess.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('400 on a non-GUID requestId', async () => {
    const r = res();
    await handler({ method: 'GET', query: { requestId: 'not-a-guid' } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.listForRequest).not.toHaveBeenCalled();
  });

  it('lists the roster for a valid requestId', async () => {
    store.listForRequest.mockResolvedValueOnce({ active: [{ name: 'Ann' }], excluded: [], allNames: ['Ann'] });
    const r = res();
    await handler({ method: 'GET', query: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.listForRequest).toHaveBeenCalledWith(REQ);
    expect(r.body.active).toEqual([{ name: 'Ann' }]);
  });
});

describe('POST recordSurfaced', () => {
  it('400 on a missing candidates array', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('400 when too many candidates', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ name: `R${i}` }));
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: many } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('rejects browser attempts to mint server-managed applicant suggestion rows', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Applicant Reviewer',
      suggestionId: '33333333-3333-3333-3333-333333333333',
      candidateKey: 'suggestion:33333333-3333-3333-3333-333333333333',
      isApplicantRecommended: true,
      identityStatus: 'probable',
      email: 'forged@example.edu',
      emailPersistAllowed: true,
    }] } }, r);

    expect(r.statusCode).toBe(400);
    expect(r.body).toMatchObject({ code: 'server_managed_applicant_candidate' });
    expect(store.recordSurfaced).not.toHaveBeenCalled();
  });

  it('re-derives an untrusted browser candidate key before writing the roster', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Mallory Example',
      candidateKey: 'candidate:existing-victim',
      email: 'mallory@example.edu',
      affiliation: 'Example University',
    }] } }, r);

    expect(r.statusCode).toBe(200);
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].candidateKey).toEqual(expect.any(String));
    expect(passed[0].candidateKey).not.toBe('candidate:existing-victim');
    expect(store.findCandidatesByKeys).toHaveBeenCalledWith(
      REQ,
      [passed[0].candidateKey],
    );
  });

  it('preserves a receipt-bound immutable roster candidate key', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      rosterCandidateKey: 'candidate:receipt-bound',
      eligibilityEvidenceBound: false,
    });
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Receipt Bound',
      candidateKey: 'candidate:receipt-bound',
      automatedIdentityAttestation: 'signed',
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].candidateKey).toBe('candidate:receipt-bound');
  });

  it('prunes server-side and records named candidates', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [
      { name: 'Ann Lee', hIndex: 9, contactEnrichment: { email: 'a@x.edu', tierResults: { secret: 1 }, identity: { status: 'unresolved' } } },
      { name: '' }, // dropped (no name)
    ] } }, r);
    expect(r.statusCode).toBe(200);
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed).toHaveLength(1);
    expect(passed[0].name).toBe('Ann Lee');
    expect(passed[0].hIndex).toBe(9);
    // A render-safe contactEnrichment subset is kept. Raw resolver internals
    // and tierResults are dropped, while the compact identity decision needed
    // by the W4.1 save boundary survives the roster round trip.
    expect(passed[0].contactEnrichment.email).toBe('a@x.edu');
    expect(passed[0].contactEnrichment.tierResults).toBeUndefined();
    expect(passed[0].contactEnrichment.identity).toEqual({
      status: 'unresolved',
      confidenceBand: null,
      resolverVersion: null,
      resolvedAt: null,
      evidenceSummary: null,
      anchors: null,
    });
    expect(passed[0].tierResults).toBeUndefined();
    // The resolver verdict survives as a safe boolean flag (unresolved → block).
    expect(passed[0].identityPersistAllowed).toBe(false);
  });

  it('strips browser-forged staff confirmation authority from discovered rows', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Ann Lee',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'forged-confirmation',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'forged-confirmation',
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'ann@example.edu',
      },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0].pdIdentityConfirmed).toBeUndefined();
    expect(passed[0].pdIdentityConfirmationId).toBeUndefined();
    expect(passed[0].manualContactFields).toBeUndefined();
    expect(passed[0].staffIdentityConfirmation).toBeUndefined();
  });

  it('preserves a server-stored confirmation when a discovered row resurfaces', async () => {
    const resurfaced = {
      name: 'Ann Lee',
      email: 'automated@example.net',
    };
    const derivedCandidateKey = reviewerCandidateKey(resurfaced);
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Ann Lee',
      candidateKey: derivedCandidateKey,
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email', 'website', 'affiliation'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        normalizedName: 'ann lee',
        email: 'verified@example.edu',
        website: 'https://example.edu/ann',
        affiliation: 'Example University',
        actorProfileId: 5,
      },
    }]);
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      ...resurfaced,
      candidateKey: derivedCandidateKey,
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      email: 'verified@example.edu',
      website: 'https://example.edu/ann',
      affiliation: 'Example University',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: expect.objectContaining({
        confirmationId: 'confirm-1',
        actorProfileId: 5,
      }),
    });
  });

  it('strips a browser-forged deceased claim without a bound server receipt', async () => {
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [{
      name: 'Ann Lee',
      eligibilityStatus: 'deceased',
      eligibilityReason: 'forged',
      eligibilityEvidence: { status: 'deceased', url: 'https://evil.example/fake' },
    }] } }, r);

    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      eligibilityStatus: 'unknown',
      eligibilityReason: null,
      eligibilityEvidence: null,
    });
  });

  it('preserves deceased evidence only when the server receipt binds it', async () => {
    verifyAutomatedIdentityAttestation.mockResolvedValueOnce({
      valid: true,
      eligibilityStatus: 'deceased',
      eligibilityEvidenceBound: true,
    });
    const candidate = {
      name: 'Ann Lee',
      automatedIdentityAttestation: 'signed',
      eligibilityStatus: 'deceased',
      eligibilityReason: 'Official source',
      eligibilityEvidence: {
        status: 'deceased',
        url: 'https://example.edu/in-memoriam/ann-lee',
      },
    };
    const r = res();
    await handler({ method: 'POST', body: { requestId: REQ, candidates: [candidate] } }, r);

    expect(verifyAutomatedIdentityAttestation).toHaveBeenCalledWith(
      'signed',
      expect.objectContaining({ requestId: REQ }),
    );
    const [, passed] = store.recordSurfaced.mock.calls[0];
    expect(passed[0]).toMatchObject({
      eligibilityStatus: 'deceased',
      eligibilityEvidence: {
        status: 'deceased',
        url: 'https://example.edu/in-memoriam/ann-lee',
      },
    });
  });
});

describe('PATCH', () => {
  it('exclude → setExcluded with the pruned candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude', candidate: { name: 'Bob Roe' } } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({ name: 'Bob Roe' }));
  });

  // S387 regression: before the anchor lookup, an applicant row whose key was still a
  // migration-025 placeholder could not be resolved at all, so exclude/saved/
  // confirm_identity 409'd and staff could not even set the card aside.
  it('exclude works for an anchor-stamped row still keyed with a pre-anchor placeholder', async () => {
    const suggestionId = '44444444-4444-4444-4444-444444444444';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Legacy Applicant',
      suggestionId,
      candidateKey: 'legacy-row:369',
      isApplicantRecommended: true,
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Legacy Applicant', suggestionId, candidateKey: 'legacy-row:369' },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({
      name: 'Legacy Applicant',
      candidateKey: 'legacy-row:369',
    }));
  });

  // The anchor lookup widened WHICH row is found, not WHOSE claim is trusted: the client
  // must still be acting on the row the server actually stored.
  it('still refuses when the client key disagrees with the stored row', async () => {
    const suggestionId = '55555555-5555-5555-5555-555555555555';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Legacy Applicant',
      suggestionId,
      candidateKey: 'legacy-row:369',
      isApplicantRecommended: true,
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Legacy Applicant', suggestionId, candidateKey: `suggestion:${suggestionId}` },
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.setExcluded).not.toHaveBeenCalled();
  });

  it('exclude of an applicant row uses the existing server blob, not the browser blob', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      identityStatus: 'unresolved',
      needsIdentification: true,
      isApplicantRecommended: true,
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        normalizedName: 'applicant reviewer',
        email: 'verified@example.edu',
      },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: {
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        identityStatus: 'probable',
        email: 'forged@example.edu',
      },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(store.setExcluded).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({
        identityStatus: 'unresolved',
        needsIdentification: true,
        email: null,
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'confirm-1',
        manualContactFields: ['email'],
        staffIdentityConfirmation: expect.objectContaining({ confirmationId: 'confirm-1' }),
      }),
    );
  });

  it('strips browser-forged confirmation authority from a non-applicant exclude', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: {
        name: 'Bob Roe',
        candidateKey: 'candidate:bob',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'forged',
        manualContactFields: ['email'],
        staffIdentityConfirmation: { confirmationId: 'forged', source: 'staff_confirmed' },
      },
    } }, r);
    const persisted = store.setExcluded.mock.calls[0][1];
    expect(persisted).not.toHaveProperty('pdIdentityConfirmed');
    expect(persisted).not.toHaveProperty('pdIdentityConfirmationId');
    expect(persisted).not.toHaveProperty('manualContactFields');
    expect(persisted).not.toHaveProperty('staffIdentityConfirmation');
  });

  it('preserves the canonical server confirmation on a non-applicant exclude', async () => {
    store.findCandidatesByKeys.mockResolvedValueOnce([{
      name: 'Bob Roe',
      candidateKey: 'candidate:bob',
      pdIdentityConfirmed: true,
      pdIdentityConfirmationId: 'confirm-1',
      manualContactFields: ['email'],
      staffIdentityConfirmation: {
        confirmationId: 'confirm-1',
        source: 'staff_confirmed',
        normalizedName: 'bob roe',
        email: 'verified@example.edu',
        website: '',
        affiliation: 'Example University',
        actorSystemUserId: 'system-5',
      },
    }]);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'exclude',
      candidate: { name: 'Bob Roe', candidateKey: 'candidate:bob', email: 'forged@example.net' },
    } }, r);

    expect(store.setExcluded).toHaveBeenCalledWith(REQ, expect.objectContaining({
      email: 'verified@example.edu',
      pdIdentityConfirmationId: 'confirm-1',
      staffIdentityConfirmation: expect.objectContaining({ actorSystemUserId: 'system-5' }),
    }));
  });

  it('exclude → 400 without a candidate', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'exclude' } }, r);
    expect(r.statusCode).toBe(400);
  });

  it('promote → returns the restored blob', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:bob' } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.promote).toHaveBeenCalledWith(REQ, 'candidate:bob');
    expect(r.body.candidate).toEqual({ name: 'Bob Roe' });
  });

  it('promote → 409 when the candidate is no longer excluded', async () => {
    store.promote.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'promote', candidateKey: 'candidate:stale' } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({
      success: false,
      code: 'candidate_not_excluded',
    });
  });

  it('saved → 409 because promotion services own the roster transition', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{ name: 'Ann Lee', candidateKey: 'candidate:ann' }],
    } }, r);
    expect(r.statusCode).toBe(409);
    expect(r.body).toMatchObject({ code: 'server_owned_transition' });
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('does not inspect or persist browser-forged authority on a saved request', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Ann Lee',
        candidateKey: 'candidate:ann',
        pdIdentityConfirmed: true,
        pdIdentityConfirmationId: 'forged',
        manualContactFields: ['email'],
        staffIdentityConfirmation: { confirmationId: 'forged', source: 'staff_confirmed' },
      }],
    } }, r);
    expect(r.statusCode).toBe(409);
    expect(store.findCandidatesByKeys).not.toHaveBeenCalled();
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('rejects a stale applicant mark-saved payload instead of creating an authoritative row', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        isApplicantRecommended: true,
      }],
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('rejects even an applicant saved payload with a complete server confirmation', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'saved',
      candidates: [{
        name: 'Applicant Reviewer',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        isApplicantRecommended: true,
        pdIdentityConfirmationId: 'forged',
      }],
    } }, r);

    expect(r.statusCode).toBe(409);
    expect(store.findCandidateBySuggestionAnchor).not.toHaveBeenCalled();
    expect(store.markSaved).not.toHaveBeenCalled();
  });

  it('confirm_identity records an actor-bound server confirmation', async () => {
    requireAppAccess.mockResolvedValueOnce({
      profileId: 5,
      session: { user: { dynamicsSystemuserId: 'SYS-5' } },
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: { name: 'Ann Lee', email: 'ANN@EXAMPLE.EDU', affiliation: 'Example U' },
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.confirmIdentity).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({ name: 'Ann Lee', email: 'ANN@EXAMPLE.EDU' }),
      { actorProfileId: 5, actorSystemUserId: 'SYS-5' },
    );
    expect(r.body.confirmationId).toBe('confirm-1');
  });

  it('confirm_identity keeps applicant identity evidence from the server row', async () => {
    const suggestionId = '33333333-3333-3333-3333-333333333333';
    store.findCandidateBySuggestionAnchor.mockResolvedValueOnce({
      name: 'Applicant Reviewer',
      suggestionId,
      candidateKey: `suggestion:${suggestionId}`,
      identityStatus: 'unresolved',
      verificationStatus: 'unresolved',
      needsIdentification: true,
      isApplicantRecommended: true,
    });
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: {
        name: 'Applicant Reviewer',
        email: 'verified@example.edu',
        suggestionId,
        candidateKey: `suggestion:${suggestionId}`,
        identityStatus: 'probable',
        needsIdentification: false,
      },
    } }, r);

    expect(r.statusCode).toBe(200);
    expect(store.confirmIdentity).toHaveBeenCalledWith(
      REQ,
      expect.objectContaining({
        suggestionId,
        identityStatus: 'unresolved',
        verificationStatus: 'unresolved',
        needsIdentification: true,
        email: 'verified@example.edu',
      }),
      expect.anything(),
    );
  });

  it('confirm_identity returns 409 when the active roster row is gone', async () => {
    store.confirmIdentity.mockResolvedValueOnce(null);
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'confirm_identity',
      candidate: { name: 'Ann Lee', email: 'ann@example.edu' },
    } }, r);
    expect(r.statusCode).toBe(409);
  });

  it('remove_previous_results deletes only through the scoped store helper and returns the refreshed roster', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
      candidateRefs: [
        { candidateKey: 'candidate:old-a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:old-b', updatedAt: '2026-07-19T13:00:00.000Z' },
      ],
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.removePreviousActiveSearchResults).toHaveBeenCalledWith(
      REQ,
      [
        { candidateKey: 'candidate:old-a', updatedAt: '2026-07-19T12:00:00.000Z' },
        { candidateKey: 'candidate:old-b', updatedAt: '2026-07-19T13:00:00.000Z' },
      ],
    );
    expect(store.listForRequest).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({
      success: true,
      removed: 2,
      removedKeys: ['candidate:old-a', 'candidate:old-b'],
      active: [{ name: 'Applicant Person', provenance: { kind: 'applicant_suggested' } }],
      excluded: [{ name: 'Excluded Person' }],
      allNames: ['Applicant Person', 'Excluded Person', 'Saved Person'],
    });
  });

  it('remove_previous_results accepts bounded generated keys longer than 256 characters', async () => {
    const candidateKey = `candidate:${'a'.repeat(680)}`;
    const candidateRefs = [{
      candidateKey,
      updatedAt: '2026-07-19T12:00:00.000Z',
    }];
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
      candidateRefs,
    } }, r);
    expect(r.statusCode).toBe(200);
    expect(store.removePreviousActiveSearchResults).toHaveBeenCalledWith(REQ, candidateRefs);
  });

  it('remove_previous_results rejects a missing candidate-ref scope', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: {
      requestId: REQ,
      action: 'remove_previous_results',
    } }, r);
    expect(r.statusCode).toBe(400);
    expect(store.removePreviousActiveSearchResults).not.toHaveBeenCalled();
  });

  it('remove_previous_results rejects malformed or oversized candidate-ref scopes', async () => {
    for (const candidateRefs of [
      [{ candidateKey: 'candidate:valid', updatedAt: '' }],
      [{ candidateKey: 'candidate:valid', updatedAt: 12345 }],
      [{ candidateKey: '', updatedAt: '2026-07-19T12:00:00.000Z' }],
      Array.from({ length: 301 }, (_, i) => ({
        candidateKey: `candidate:${i}`,
        updatedAt: '2026-07-19T12:00:00.000Z',
      })),
    ]) {
      const r = res();
      await handler({ method: 'PATCH', body: {
        requestId: REQ,
        action: 'remove_previous_results',
        candidateRefs,
      } }, r);
      expect(r.statusCode).toBe(400);
    }
    expect(store.removePreviousActiveSearchResults).not.toHaveBeenCalled();
  });

  it('unknown action → 400', async () => {
    const r = res();
    await handler({ method: 'PATCH', body: { requestId: REQ, action: 'frobnicate' } }, r);
    expect(r.statusCode).toBe(400);
  });
});

describe('method', () => {
  it('405 on an unsupported method', async () => {
    const r = res();
    await handler({ method: 'PUT', body: { requestId: REQ } }, r);
    expect(r.statusCode).toBe(405);
  });
});
