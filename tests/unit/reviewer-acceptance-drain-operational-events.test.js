/**
 * Unit tests for the reviewer-acceptance drain ↔ operational_events wiring.
 *
 * Covers: honorarium failure passes the operationalEvent enrichment through
 * notify() (stage, transient, jobId, structured-error projection); job
 * completion marks the follow-up recovery keys recovered; withdrawal
 * cancellation marks them superseded; settle failures never change the job
 * outcome.
 *
 * @jest-environment node
 */

jest.mock('../../lib/services/operational-event-service', () => ({
  __esModule: true,
  default: {
    recordEvent: jest.fn(async () => ({ id: 1, folded: false })),
    markRecovered: jest.fn(async () => 1),
    markSuperseded: jest.fn(async () => 1),
  },
}));

import { processReviewerAcceptanceJob } from '../../lib/services/reviewer-acceptance-drain';
import OperationalEventService from '../../lib/services/operational-event-service';

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

function job() {
  const suggestion = acceptedSuggestion();
  return {
    id: 77,
    lease_token: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    status: 'queued',
    attempts: 3,
    suggestion_id: SUGGESTION_ID,
    created_at: new Date().toISOString(),
    accepted_at: '2026-07-01T10:00:00.000Z',
    steps: {},
    payload: {
      schemaVersion: 1,
      acceptedAt: '2026-07-01T10:00:00.000Z',
      isAcceptRepeat: true,
      optedOut: false,
      body: { contactEdits: { email: 'reviewer@example.org' } },
      suggestion,
      acceptedSuggestion: suggestion,
      request: { akoya_requestid: REQUEST_ID, akoya_requestnum: 'REQ-001' },
      reviewer: { wmkf_potentialreviewersid: REVIEWER_ID, wmkf_emailaddress: 'reviewer@example.org' },
    },
  };
}

function deps(currentSuggestion = acceptedSuggestion()) {
  return {
    suggestions: { getForAcceptanceDrain: jest.fn(async () => currentSuggestion) },
    potentialReviewers: {
      getById: jest.fn(async () => ({ wmkf_potentialreviewersid: REVIEWER_ID })),
    },
    ensureHonorarium: jest.fn(async () => ({ status: 'created', contactId: 'contact-1' })),
    ensureAcceptedContact: jest.fn(async () => ({ contactId: 'c' })),
    captureOrcid: jest.fn(async () => ({ persisted: true })),
    captureIdentity: jest.fn(async () => ({})),
    syncNameTitle: jest.fn(async () => ({})),
    alertEmail: jest.fn(async () => ({})),
    autoLinkAccount: jest.fn(async () => ({ skipped: 'no_exact_target' })),
    alertAffiliation: jest.fn(async () => ({})),
    resolveAffiliation: jest.fn(async () => ({})),
    sendAcceptanceEmail: jest.fn(async () => ({ sent: true })),
    notify: jest.fn(async () => ({ id: 1 })),
    quota: jest.fn(async () => ({})),
    deleteLateHonorarium: jest.fn(async () => ({})),
    jobs: {
      mergeReviewerAcceptanceJobStep: jest.fn(async () => ({})),
      completeReviewerAcceptanceJob: jest.fn(async () => ({})),
      cancelReviewerAcceptanceJob: jest.fn(async () => ({})),
      recordReviewerAcceptanceJobFailure: jest.fn(async () => ({ status: 'queued' })),
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('honorarium failure sends operationalEvent enrichment through notify()', async () => {
  const d = deps();
  const honErr = new Error('dataverse no-response: This operation was aborted');
  honErr.isTransient = true;
  honErr.serviceName = 'dataverse';
  honErr.status = null;
  honErr.causeKind = 'abort';
  honErr.noResponse = true;
  d.ensureHonorarium.mockRejectedValue(honErr);

  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow(/followup_retry_required/);

  const notifyArgs = d.notify.mock.calls.find(
    ([args]) => args.type === 'honorarium_onboard_failed',
  )[0];
  expect(notifyArgs.operationalEvent).toMatchObject({
    stage: 'honorarium_onboard',
    transient: true,
    requestNumber: 'REQ-001',
    entityRefs: { suggestionId: SUGGESTION_ID, jobId: 77 },
    metadata: expect.objectContaining({
      serviceName: 'dataverse',
      causeKind: 'abort',
      noResponse: true,
      attempts: 3,
    }),
  });
  // Failure attempts never settle events.
  expect(OperationalEventService.markRecovered).not.toHaveBeenCalled();
});

test('accepted-contact failure sends operationalEvent enrichment through notify()', async () => {
  // Cycle-2 Codex finding: this warning-severity path recorded no durable
  // event, yet completion/withdrawal settle its recovery key. The enrichment
  // makes the settled row actually exist.
  const d = deps();
  const contactErr = new Error('contact promotion blocked');
  contactErr.code = 'accepted_reviewer_contact_conflict';
  contactErr.isTransient = false;
  d.ensureHonorarium.mockRejectedValue(contactErr);

  await expect(processReviewerAcceptanceJob(job(), d)).rejects.toThrow();

  const notifyArgs = d.notify.mock.calls.find(
    ([args]) => args.type === 'accepted_reviewer_contact_promotion_failed',
  )[0];
  expect(notifyArgs.autoResolveKey).toBe(`accepted-reviewer-contact-failed:${REVIEWER_ID}`);
  expect(notifyArgs.operationalEvent).toMatchObject({
    stage: 'accepted_contact_promotion',
    transient: false,
    requestNumber: 'REQ-001',
    entityRefs: {
      suggestionId: SUGGESTION_ID,
      potentialReviewerId: REVIEWER_ID,
      jobId: 77,
    },
    metadata: expect.objectContaining({
      code: 'accepted_reviewer_contact_conflict',
      attempts: 3,
    }),
  });
});

test('job completion marks the follow-up recovery keys recovered', async () => {
  const d = deps();
  const result = await processReviewerAcceptanceJob(job(), d);
  expect(result.status).toBe('completed');
  expect(OperationalEventService.markRecovered).toHaveBeenCalledWith(
    `honorarium_onboard_failed:${SUGGESTION_ID}`,
    expect.objectContaining({ note: expect.stringContaining('completed') }),
  );
  expect(OperationalEventService.markRecovered).toHaveBeenCalledWith(
    `accepted-reviewer-contact-failed:${REVIEWER_ID}`,
    expect.anything(),
  );
  expect(OperationalEventService.markSuperseded).not.toHaveBeenCalled();
});

test('withdrawal during follow-up marks events superseded, not recovered', async () => {
  const d = deps();
  // First read: accepted (job proceeds); post-honorarium re-read: withdrawn.
  d.suggestions.getForAcceptanceDrain
    .mockResolvedValueOnce(acceptedSuggestion())
    .mockResolvedValueOnce(acceptedSuggestion({ wmkf_declined: true }));
  const result = await processReviewerAcceptanceJob(job(), d);
  expect(result.status).toBe('cancelled');
  expect(OperationalEventService.markSuperseded).toHaveBeenCalledWith(
    `honorarium_onboard_failed:${SUGGESTION_ID}`,
    expect.anything(),
  );
  expect(OperationalEventService.markRecovered).not.toHaveBeenCalled();
});

test('settle failure never changes the completed job outcome', async () => {
  OperationalEventService.markRecovered.mockRejectedValue(new Error('events down'));
  const d = deps();
  const result = await processReviewerAcceptanceJob(job(), d);
  expect(result.status).toBe('completed');
});
