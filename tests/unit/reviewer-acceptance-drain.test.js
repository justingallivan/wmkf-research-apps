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

function job({ isAcceptRepeat = false, optedOut = false, status = 'queued', steps = {}, createdAt, acceptedAt = '2026-07-01T10:00:00.000Z' } = {}) {
  const suggestion = acceptedSuggestion({ wmkf_honorariumoptout: optedOut });
  return {
    id: 77,
    lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status,
    attempts: 0,
    suggestion_id: SUGGESTION_ID,
    created_at: createdAt || new Date().toISOString(),
    accepted_at: acceptedAt,
    steps,
    payload: {
      schemaVersion: 1,
      acceptedAt,
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
    suggestions: {
      getForAcceptanceDrain: jest.fn(async () => currentSuggestion),
    },
    potentialReviewers: {
      getById: jest.fn(async () => reviewer()),
    },
    ensureHonorarium: jest.fn(async () => ({ status: 'deferred', contactId: 'contact-1' })),
    ensureAcceptedContact: jest.fn(async () => ({ contactId: 'contact-optout', addressCaptureError: null })),
    captureOrcid: jest.fn(async () => ({ persisted: true })),
    captureIdentity: jest.fn(async () => ({})),
    syncNameTitle: jest.fn(async () => ({})),
    alertEmail: jest.fn(async () => ({})),
    autoLinkAccount: jest.fn(async () => ({ skipped: 'no_exact_target' })),
    alertAffiliation: jest.fn(async () => ({})),
    resolveAffiliation: jest.fn(async () => ({ resolvedCount: 0 })),
    sendAcceptanceEmail: jest.fn(async () => ({ sent: true })),
    notify: jest.fn(async () => ({ id: 1 })),
    quota: jest.fn(async () => ({ notified: false })),
    deleteLateHonorarium: jest.fn(async () => ({ deleted: true })),
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
      reviewer: expect.objectContaining({
        wmkf_orcid: '0000-0002-1825-0097',
        wmkf_identitystatus: 'confirmed',
      }),
      body: expect.objectContaining({ address: expect.any(Object) }),
    }));
    expect(d.captureOrcid).toHaveBeenCalledWith(expect.objectContaining({
      contactId: null,
      bindingEventAt: '2026-07-01T10:00:00.000Z',
    }));
    expect(d.captureOrcid.mock.invocationCallOrder[0])
      .toBeLessThan(d.ensureHonorarium.mock.invocationCallOrder[0]);
    expect(d.captureIdentity).toHaveBeenCalledWith(expect.objectContaining({ academicRank: 'Professor' }));
    expect(d.syncNameTitle).toHaveBeenCalledWith(expect.objectContaining({ trusted: true }));
    expect(d.alertEmail).toHaveBeenCalledWith(expect.objectContaining({ reviewerEmail: 'reviewer@example.org' }));
    expect(d.autoLinkAccount).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-1',
      reviewerAffiliation: 'Reviewer Org',
      trustedAcceptance: true,
    }));
    expect(d.alertAffiliation).toHaveBeenCalledWith(expect.objectContaining({ reviewerAffiliation: 'Reviewer Org' }));
    expect(d.autoLinkAccount.mock.invocationCallOrder[0])
      .toBeLessThan(d.alertAffiliation.mock.invocationCallOrder[0]);
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.quota).toHaveBeenCalledWith({ requestId: REQUEST_ID, actingUserSystemId: null });
    expect(d.jobs.mergeReviewerAcceptanceJobStep).toHaveBeenCalledWith(77, expect.any(String), 'acceptance_confirmation', expect.objectContaining({ claimedAt: expect.any(String) }));
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalledWith(77, expect.any(String));
  });

  it('passes the current reviewer-confirmed engagement email to the confirmation sender', async () => {
    const d = deps(acceptedSuggestion({
      wmkf_revieweremail: 'confirmed@current.edu',
    }));
    d.potentialReviewers.getById.mockResolvedValueOnce(reviewer({
      wmkf_emailaddress: 'stale@former.edu',
    }));

    await processReviewerAcceptanceJob(job(), d);

    expect(d.sendAcceptanceEmail).toHaveBeenCalledWith(expect.objectContaining({
      suggestion: expect.objectContaining({
        wmkf_revieweremail: 'confirmed@current.edu',
      }),
      reviewer: expect.objectContaining({
        wmkf_emailaddress: 'stale@former.edu',
      }),
    }));
  });

  it('re-accept jobs retry follow-up work but skip one-time confirmation and quota', async () => {
    const d = deps();
    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.ensureHonorarium).toHaveBeenCalled();
    expect(d.captureOrcid).toHaveBeenCalledWith(expect.objectContaining({
      bindingEventAt: '2026-07-01T10:00:00.000Z',
    }));
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('normalizes a Date-valued accepted_at before activating the writer', async () => {
    const d = deps();
    await processReviewerAcceptanceJob(job({
      acceptedAt: new Date('2026-07-01T10:00:00.347Z'),
    }), d);

    expect(d.captureOrcid).toHaveBeenCalledWith(expect.objectContaining({
      bindingEventAt: '2026-07-01T10:00:00.347Z',
    }));
  });

  it('does not synthesize confirmed when capture abstains', async () => {
    const d = deps();
    d.captureOrcid.mockResolvedValueOnce({ skipped: 'invalid_orcid', state: 'malformed' });

    await processReviewerAcceptanceJob(job(), d);

    const honorariumReviewer = d.ensureHonorarium.mock.calls[0][0].reviewer;
    expect(honorariumReviewer.wmkf_orcid).toBe('0000-0002-1825-0097');
    expect(honorariumReviewer).not.toHaveProperty('wmkf_identitystatus');
  });

  it('opt-out jobs skip honorarium but still run non-payment follow-up work', async () => {
    const d = deps(acceptedSuggestion({ wmkf_honorariumoptout: true }));
    await processReviewerAcceptanceJob(job({ optedOut: true }), d);

    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.ensureAcceptedContact).toHaveBeenCalledWith(expect.objectContaining({
      reviewer: expect.objectContaining({ wmkf_potentialreviewersid: REVIEWER_ID }),
      suggestion: expect.objectContaining({ wmkf_appreviewersuggestionid: SUGGESTION_ID }),
      body: expect.objectContaining({ contactEdits: expect.any(Object) }),
    }));
    expect(d.captureOrcid).toHaveBeenCalled();
    expect(d.syncNameTitle).toHaveBeenCalledWith(expect.objectContaining({
      contactId: 'contact-optout',
    }));
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('opt-out identity conflict remains unlinked, alerts staff, and terminates without retry churn', async () => {
    const d = deps(acceptedSuggestion({ wmkf_honorariumoptout: true }));
    const conflict = Object.assign(new Error('accepted reviewer contact requires staff identity review'), {
      code: 'accepted_reviewer_contact_identity_review_required',
      retryable: false,
    });
    d.potentialReviewers.getById.mockResolvedValueOnce(reviewer({ _wmkf_contact_value: null }));
    d.ensureAcceptedContact.mockRejectedValueOnce(conflict);

    await expect(processReviewerAcceptanceJob(job({ optedOut: true }), d)).rejects.toBe(conflict);

    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'accepted_reviewer_contact_promotion_failed',
      metadata: expect.objectContaining({
        potentialReviewerId: REVIEWER_ID,
        optedOut: true,
        code: 'accepted_reviewer_contact_identity_review_required',
      }),
    }));
    expect(d.syncNameTitle).toHaveBeenCalledWith(expect.objectContaining({ contactId: null }));
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('does not duplicate an identity-review alert already emitted by contact promotion', async () => {
    const d = deps(acceptedSuggestion({ wmkf_honorariumoptout: true }));
    const conflict = Object.assign(new Error('staff review required'), {
      code: 'accepted_reviewer_contact_identity_review_required',
      retryable: false,
      staffAlerted: true,
    });
    d.ensureAcceptedContact.mockRejectedValueOnce(conflict);

    await expect(processReviewerAcceptanceJob(job({ optedOut: true }), d)).rejects.toBe(conflict);

    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'accepted_reviewer_contact_promotion_failed',
    }));
  });

  it('cancels immediately when the reviewer already withdrew', async () => {
    const d = deps(acceptedSuggestion({
      wmkf_accepted: false,
      wmkf_declined: true,
    }));

    const result = await processReviewerAcceptanceJob(job(), d);

    expect(result).toMatchObject({
      status: 'cancelled',
      reason: 'reviewer_withdrew_before_materials',
    });
    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.ensureAcceptedContact).not.toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
  });

  it('removes a late-created honorarium and stops when withdrawal races the acceptance worker', async () => {
    const d = deps();
    d.suggestions.getForAcceptanceDrain
      .mockResolvedValueOnce(acceptedSuggestion())
      .mockResolvedValueOnce(acceptedSuggestion({
        wmkf_accepted: false,
        wmkf_declined: true,
        _wmkf_honorariumrequest_value: '55555555-5555-4555-8555-555555555555',
      }));

    const result = await processReviewerAcceptanceJob(job(), d);

    expect(d.ensureHonorarium).toHaveBeenCalled();
    expect(d.deleteLateHonorarium).toHaveBeenCalledWith(
      SUGGESTION_ID,
      { suggestions: d.suggestions },
    );
    expect(result.status).toBe('cancelled');
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
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

  it('processes a queued job when Dataverse truncates the same accepted second', async () => {
    const d = deps(acceptedSuggestion({ wmkf_responsereceivedat: '2026-07-01T10:00:00Z' }));
    const result = await processReviewerAcceptanceJob(job({ acceptedAt: '2026-07-01T10:00:00.347Z' }), d);

    expect(result.status).toBe('completed');
    expect(d.jobs.cancelReviewerAcceptanceJob).not.toHaveBeenCalled();
    expect(d.ensureHonorarium).toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalledWith(77, expect.any(String));
  });

  it('cancels a queued sibling job whose acceptedAt does not match Dataverse', async () => {
    const d = deps(acceptedSuggestion({ wmkf_responsereceivedat: '2026-07-01T10:00:05.000Z' }));
    const result = await processReviewerAcceptanceJob(job({ status: 'queued' }), d);

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
      message: expect.stringContaining('reviewer_acceptance_followup_retry_required'),
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

  it('suppresses the mismatch warning after a confident Account link', async () => {
    const d = deps();
    d.autoLinkAccount.mockResolvedValueOnce({
      linked: true,
      accountId: 'account-1',
      accountName: 'Reviewer Org',
    });

    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.autoLinkAccount).toHaveBeenCalled();
    expect(d.alertAffiliation).not.toHaveBeenCalled();
    expect(d.resolveAffiliation).toHaveBeenCalledWith(expect.objectContaining({
      reviewer: expect.objectContaining({ wmkf_potentialreviewersid: REVIEWER_ID }),
      contactId: 'contact-1',
    }));
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('clears a standing mismatch warning when the Contact was already linked correctly', async () => {
    const d = deps();
    d.autoLinkAccount.mockResolvedValueOnce({
      linked: false,
      alreadyLinked: true,
      accountId: 'account-1',
      accountName: 'Reviewer Org',
    });

    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.resolveAffiliation).toHaveBeenCalledTimes(1);
    expect(d.alertAffiliation).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('treats a capped Account scan as an abstention, alerts ops once, and retains mismatch handling', async () => {
    const d = deps();
    d.autoLinkAccount.mockResolvedValueOnce({
      skipped: 'account_scan_capped',
      scannedCount: 5000,
      totalCount: 5200,
    });

    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reviewer_contact_account_scan_capped',
      severity: 'warning',
      emailAdmins: true,
      metadata: { scannedCount: 5000, totalCount: 5200 },
      autoResolveKey: 'reviewer-contact-account-scan-capped',
    }));
    expect(d.alertAffiliation).toHaveBeenCalledTimes(1);
    expect(d.resolveAffiliation).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('still completes mismatch handling when the capped-scan ops alert fails', async () => {
    const d = deps();
    d.autoLinkAccount.mockResolvedValueOnce({
      skipped: 'account_scan_capped',
      scannedCount: 5000,
      totalCount: 5200,
    });
    d.notify.mockRejectedValueOnce(new Error('system_alerts unavailable'));

    await processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d);

    expect(d.alertAffiliation).toHaveBeenCalledTimes(1);
    expect(d.jobs.completeReviewerAcceptanceJob).toHaveBeenCalled();
  });

  it('retries an operational Account-link failure without emitting transient mismatch noise', async () => {
    const d = deps();
    d.autoLinkAccount.mockRejectedValueOnce(new Error('Dataverse Account scan unavailable'));

    await expect(processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d)).rejects.toMatchObject({
      message: expect.stringContaining('reviewer_acceptance_followup_retry_required'),
      retryable: true,
    });

    expect(d.alertAffiliation).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('retries binding failures before honorarium or other downstream work starts', async () => {
    const d = deps();
    d.captureOrcid.mockRejectedValueOnce(new Error('identity binding unavailable'));

    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow('identity binding unavailable');

    expect(d.ensureHonorarium).not.toHaveBeenCalled();
    expect(d.captureIdentity).not.toHaveBeenCalled();
    expect(d.syncNameTitle).not.toHaveBeenCalled();
    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
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

  it('keeps full-mode address failures retryable instead of silently finalizing', async () => {
    const d = deps();
    d.ensureHonorarium.mockResolvedValueOnce({
      status: 'alert_only',
      contactId: 'contact-1',
      honorariumRequestId: 'hon-1',
      addressCaptureError: 'Dataverse contact PATCH failed',
    });

    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toMatchObject({
      message: expect.stringContaining('address_capture_failed'),
      retryable: true,
    });
    expect(d.sendAcceptanceEmail).toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('fails closed before sending an acceptance email when the lease-step claim no-ops', async () => {
    const d = deps();
    d.jobs.mergeReviewerAcceptanceJobStep.mockResolvedValueOnce(null);

    await expect(processReviewerAcceptanceJob(job(), d)).rejects.toMatchObject({
      code: 'reviewer_acceptance_lease_lost',
      retryable: true,
    });

    expect(d.sendAcceptanceEmail).not.toHaveBeenCalled();
    expect(d.quota).not.toHaveBeenCalled();
    expect(d.jobs.completeReviewerAcceptanceJob).not.toHaveBeenCalled();
  });

  it('does not report completion when the lease-guarded completion update no-ops', async () => {
    const d = deps();
    d.jobs.completeReviewerAcceptanceJob.mockResolvedValueOnce(null);

    await expect(processReviewerAcceptanceJob(job({ isAcceptRepeat: true }), d)).rejects.toMatchObject({
      code: 'reviewer_acceptance_lease_lost',
    });
  });

  it('does not report cancellation when the lease-guarded cancellation update no-ops', async () => {
    const stale = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const d = deps(acceptedSuggestion({ wmkf_accepted: false }));
    d.jobs.cancelReviewerAcceptanceJob.mockResolvedValueOnce(null);

    await expect(processReviewerAcceptanceJob(
      job({ status: 'accept_pending', createdAt: stale }),
      d,
    )).rejects.toMatchObject({
      code: 'reviewer_acceptance_lease_lost',
    });
  });
});

describe('drainReviewerAcceptanceJobs', () => {
  it('records a retry when processing throws', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job()]);
    d.suggestions.getForAcceptanceDrain.mockRejectedValueOnce(new Error('Dataverse down'));

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({
      claimed: 1,
      jobIds: [77],
      completed: 0,
      completedJobIds: [],
      retried: 1,
      retriedJobIds: [77],
      failed: 0,
      leaseLost: 0,
    });
    expect(d.jobs.recordReviewerAcceptanceJobFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 77 }),
      expect.any(Error),
      expect.objectContaining({ retryable: true }),
    );
  });

  it('records only lease loss when failure recording no-ops under a stale token', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job()]);
    d.suggestions.getForAcceptanceDrain.mockRejectedValueOnce(new Error('Dataverse down'));
    d.jobs.recordReviewerAcceptanceJobFailure.mockResolvedValueOnce(null);

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      completedJobIds: [],
      retried: 0,
      retriedJobIds: [],
      failed: 0,
      failedJobIds: [],
      leaseLost: 1,
      leaseLostJobIds: [77],
    });
    expect(result.errors).toEqual([
      expect.objectContaining({
        jobId: 77,
        retryable: true,
        code: 'reviewer_acceptance_lease_lost',
      }),
    ]);
  });

  it('terminally fails deterministic binding blocks without scheduling another retry', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job()]);
    const blocked = Object.assign(new Error('binding_transition_blocked'), {
      code: 'binding_transition_blocked',
      retryable: false,
    });
    d.captureOrcid.mockRejectedValueOnce(blocked);
    d.jobs.recordReviewerAcceptanceJobFailure.mockResolvedValueOnce({ status: 'failed' });

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      retried: 0,
      failed: 1,
      failedJobIds: [77],
    });
    expect(d.jobs.recordReviewerAcceptanceJobFailure).toHaveBeenCalledWith(
      expect.objectContaining({ id: 77 }),
      blocked,
      expect.objectContaining({ retryable: false }),
    );
  });

  it('records completed ids only after the lease-guarded completion returns a row', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job({ isAcceptRepeat: true })]);

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({
      claimed: 1,
      jobIds: [77],
      completed: 1,
      completedJobIds: [77],
      retried: 0,
      retriedJobIds: [],
      leaseLost: 0,
      leaseLostJobIds: [],
    });
  });

  it('does not classify a stale completion as completed or retried', async () => {
    const d = deps();
    d.jobs.claimReviewerAcceptanceJobs.mockResolvedValueOnce([job({ isAcceptRepeat: true })]);
    d.jobs.completeReviewerAcceptanceJob.mockResolvedValueOnce(null);

    const result = await drainReviewerAcceptanceJobs({ deps: d });

    expect(result).toMatchObject({
      claimed: 1,
      completed: 0,
      completedJobIds: [],
      retried: 0,
      retriedJobIds: [],
      leaseLost: 1,
      leaseLostJobIds: [77],
    });
    expect(d.jobs.recordReviewerAcceptanceJobFailure).not.toHaveBeenCalled();
  });
});
