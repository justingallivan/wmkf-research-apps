/**
 * @jest-environment node
 */

import {
  processReviewerAcceptanceJob,
  drainReviewerAcceptanceJobs,
} from '../../lib/services/reviewer-acceptance-drain';

const SUGGESTION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
const REVIEWER_ID = '33333333-3333-4333-8333-333333333333';

function acceptedSuggestion(overrides = {}) {
  return {
    wmkf_appreviewersuggestionid: SUGGESTION_ID,
    wmkf_accepted: true,
    wmkf_declined: false,
    wmkf_honorariumoptout: false,
    wmkf_revieweremail: 'reviewer@example.org',
    wmkf_revieweraffiliation: 'Reviewer Org',
    _wmkf_potentialreviewer_value: REVIEWER_ID,
    _wmkf_request_value: REQUEST_ID,
    ...overrides,
  };
}

function reviewer(overrides = {}) {
  return {
    wmkf_potentialreviewersid: REVIEWER_ID,
    wmkf_name: 'Dr. Reviewer',
    wmkf_emailaddress: 'reviewer@example.org',
    _wmkf_contact_value: '44444444-4444-4444-8444-444444444444',
    ...overrides,
  };
}

function request(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: 'REQ-001',
    akoya_title: 'Proposal',
    wmkf_reviewduedate: '2026-08-15',
    ...overrides,
  };
}

function job({ isAcceptRepeat = false, optedOut = false, status = 'queued', steps = {}, createdAt } = {}) {
  const suggestion = acceptedSuggestion({ wmkf_honorariumoptout: optedOut });
  return {
    id: 77,
    lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status,
    attempts: 0,
    suggestion_id: SUGGESTION_ID,
    created_at: createdAt || new Date().toISOString(),
    steps,
    payload: {
      schemaVersion: 1,
      acceptedAt: '2026-07-01T10:00:00.000Z',
      isAcceptRepeat,
      optedOut,
      acceptOrcidRaw: '0000-0002-1825-0097',
      body: {
        contactEdits: { email: 'reviewer@example.org', affiliation: 'Reviewer Org' },
        address: { line1: '1 St', city: 'Town', postalCode: '94000', country: 'US', phone: '+1 555 0100' },
        boardIdentity: { academicRank: 'Professor', primaryDepartment: 'Chemistry', mainInstitution: 'MIT' },
      },
      suggestion,
      acceptedSuggestion: suggestion,
      request: request(),
      reviewer: reviewer(),
    },
  };
}

function deps(currentSuggestion = acceptedSuggestion()) {
  return {
    dynamics: {
      getRecord: jest.fn(async () => currentSuggestion),
    },
    potentialReviewers: {
      getById: jest.fn(async () => reviewer()),
    },
    ensureHonorarium: jest.fn(async () => ({ status: 'deferred', contactId: 'contact-1' })),
    captureOrcid: jest.fn(async () => ({})),
    captureIdentity: jest.fn(async () => ({})),
    syncNameTitle: jest.fn(async () => ({})),
    alertEmail: jest.fn(async () => ({})),
    alertAffiliation: jest.fn(async () => ({})),
    sendAcceptanceEmail: jest.fn(async () => ({ sent: true })),
    notify: jest.fn(async () => ({ id: 1 })),
    quota: jest.fn(async () => ({ notified: false })),
    jobs: {
      mergeReviewerAcceptanceJobStep: jest.fn(async () => ({})),
      completeReviewerAcceptanceJob: jest.fn(async () => ({})),
      cancelReviewerAcceptanceJob: jest.fn(async () => ({})),
      claimReviewerAcceptanceJobs: jest.fn(async () => []),
      recordReviewerAcceptanceJobFailure: jest.fn(async () => ({ status: 'queued' })),
    },
  };
}

describe('processReviewerAcceptanceJob', () => {
  it('drains a fresh non-opt-out accept through honorarium, identity/contact sync, confirmation, and quota', async () => {
    const d = deps();
    const result = await processReviewerAcceptanceJob(job(), d);

    expect(result.status).toBe('completed');
    expect(d.ensureHonorarium).toHaveBeenCalledWith(expect.objectContaining({
      suggestion: expect.objectContaining({ wmkf_appreviewersuggestionid: SUGGESTION_ID }),
      request: expect.objectContaining({ akoya_requestid: REQUEST_ID }),
      reviewer: expect.objectContaining({ wmkf_orcid: '0000-0002-1825-0097' }),
      body: expect.objectContaining({ address: expect.any(Object) }),
    }));
    expect(d.captureOrcid).toHaveBeenCalledWith(expect.objectContaining({ contactId: 'contact-1' }));
    expect(d.captureIdentity).toHaveBeenCalledWith(expect.objectContaining({ academicRank: 'Professor' }));
    expect(d.syncNameTitle).toHaveBeenCalledWith(expect.objectContaining({ trusted: true }));
    expect(d.alertEmail).toHaveBeenCalledWith(expect.objectContaining({ reviewerEmail: 'reviewer@example.org' }));
    expect(d.alertAffiliation).toHaveBeenCalledWith(expect.objectContaining({ reviewerAffiliation: 'Reviewer Org' }));
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.quota).toHaveBeenCalledWith({ requestId: REQUEST_ID, actingUserSystemId: null });
    expect(d.jobs.mergeReviewerAcceptanceJobStep).toHaveBeenCalledWith(77, expect.any(String), 'acceptance_confirmation', expect.objectContaining({ claimedAt: expect.any(String) }));
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalledWith(77, expect.any(String));
  });

  it('re-accept jobs retry follow-up work but skip one-time confirmation and quota', async () => {
    const d = deps();
    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.ensureHonorarium).toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('opt-out jobs skip honorarium but still run non-payment follow-up work', async () => {
    const d = deps(acceptedSuggestion({ wmkf_honorariumoptout: true }));
    await processReviewerAcceptanceJob(job({ optedOut: true }), d);

    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.captureOrcid).toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('cancels stale accept_pending jobs when Dataverse never accepted', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const d = deps(acceptedSuggestion({ wmkf_accepted: false }));
    const result = await processReviewerAcceptanceJob(job({ status: 'accept_pending', createdAt: stale }), d);

    expect(result).toMatchObject({ status: 'cancelled', reason: 'accept_not_committed' });
    expect(d.jobs.cancelReviewerAcceptanceJob).toHaveBeenCalledWith(77, 'accept_not_committed', { leaseToken: expect.any(String) });
    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('retries a recent sibling job whose acceptedAt does not match Dataverse', async () => {
    const d = deps(acceptedSuggestion({ wmkf_responsereceivedat: '2026-07-01T10:00:05.000Z' }));

    await expect(processReviewerAcceptanceJob(job({ status: 'accept_pending' }), d)).rejects.toMatchObject({
      message: 'accepted_timestamp_mismatch',
      retryable: true,
    });

    expect(d.jobs.cancelReviewerAcceptanceJob).not.toHaveBeenCalled();
    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('cancels a stale sibling job whose acceptedAt does not match Dataverse', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const d = deps(acceptedSuggestion({ wmkf_responsereceivedat: '2026-07-01T10:00:05.000Z' }));
    const result = await processReviewerAcceptanceJob(job({ status: 'accept_pending', createdAt: stale }), d);

    expect(result).toMatchObject({ status: 'cancelled', reason: 'accepted_timestamp_mismatch' });
    expect(d.jobs.cancelReviewerAcceptanceJob).toHaveBeenCalledWith(
      77,
      expect.stringContaining('accepted_timestamp_mismatch'),
      { leaseToken: expect.any(String) },
    );
    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('keeps honorarium exceptions retryable after running remaining follow-up', async () => {
    const d = deps();
    d.ensureHonorarium.mockRejectedValueOnce(new Error('BILL down'));

    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toMatchObject({
      message: expect.stringContaining('honorarium_onboarding_retry_required'),
      retryable: true,
      delaySeconds: 300,
    });

    expect(d.captureOrcid).toHaveBeenCalled();
    expect(d.captureIdentity).toHaveBeenCalled();
    expect(d.syncNameTitle).toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.quota).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('keeps capture-only address failures retryable after notifying staff', async () => {
    const d = deps();
    d.ensureHonorarium.mockResolvedValueOnce({
      status: 'deferred',
      contactId: 'contact-1',
      addressCaptureError: 'Dataverse contact PATCH failed',
    });

    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toMatchObject({
      message: expect.stringContaining('address_capture_failed'),
      retryable: true,
    });

    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'honorarium_capture_failed',
      autoResolveKey: `honorarium_capture_failed:${SUGGESTION_ID}`,
    }));
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });
});

describe('drainReviewerAcceptanceJobs', () => {
  it('records a retry when processing throws', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job()]);
    d.dynamics.getRecord.mockRejectedValueOnce(new Error('Dataverse down'));

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({ claimed: 1, retried: 1, failed: 0 });
    expect(d.jobs.recordReviewerAcceptanceJobFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 77 }),
      expect.any(Error),
      expect.objectContaining({ retryable: true }),
    );
  });
});
