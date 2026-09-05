/**
 * @jest-environment node
 *
 * Stage 0 composed race baseline. Reviewer services, adapters, DAL context,
 * Dynamics reads/writes, annotation processing and If-Match transport are real.
 * Only external email/token/question/SQL dependencies are replaced. A KNOWN
 * DEFECT assertion pins existing behavior for a later semantic change; it is
 * neither a desired invariant nor a skipped regression test.
 */
jest.mock('@vercel/postgres', () => ({
  sql: jest.fn(() => { throw new Error('Unexpected Postgres access in race harness'); }),
}));
jest.mock('../../lib/external/token-lifecycle', () => ({
  mintAndStore: jest.fn(async () => ({ jwt: 'aaa.bbb.ccc' })),
  ensureToken: jest.fn(async () => {}),
  buildExternalUrl: (token) => `https://reviews.example.org/external/review/${token}`,
  SEND_TIME_TOKEN_PLACEHOLDER_JWT: 'send_time_token.pending_authority.not_live',
}));
jest.mock('../../lib/external/verify-suggestion-token', () => ({
  verifySuggestionToken: jest.fn(async () => ({ ok: true, payload: {
    suggestionId: '11111111-1111-4111-8111-111111111111',
    requestId: '22222222-2222-4222-8222-222222222222',
  } })),
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(async () => ({ found: false, value: null })),
}));
jest.mock('../../lib/external/review-question-fetcher', () => ({
  getAuthoritativeQuestionSet: jest.fn(async () => []),
  getActiveQuestionSet: jest.fn(async () => []),
}));
jest.mock('../../lib/services/review-synthesis-job-service', () => ({
  getReviewSynthesisJobState: jest.fn(() => { throw new Error('Unexpected synthesis SQL dependency'); }),
}));
jest.mock('../../lib/services/reviewer-acceptance-job-service', () => ({
  cancelReviewerAcceptanceJobsForSuggestion: jest.fn(async () => []),
}));

import { createReviewerEngagementTransport } from '../helpers/reviewer-engagement-transport';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { withDalContext } from '../../lib/dataverse/core/context';
import * as suggestionAdapter from '../../lib/dataverse/adapters/reviewer-suggestion';
import { sweepStaleInvites } from '../../lib/services/reviewer-suggestion-sweep';
import { sendEmails } from '../../lib/services/review-manager/send-emails-service';
import { patchMyCandidates } from '../../lib/services/reviewer-finder/my-candidates-service';
import { patchReviewers } from '../../lib/services/review-manager/reviewers-service';
import { markReceivedNoFile } from '../../lib/services/review-manager/mark-received-no-file-service';
import { transitionReviewersTerminal } from '../../lib/services/review-manager/terminal-transition-service';
import { REVIEW_STATUS_MAP, RESPONSE_TYPE_MAP } from '../../shared/config/reviewerLifecycle';
import { sql } from '@vercel/postgres';
import { getReviewSynthesisJobState } from '../../lib/services/review-synthesis-job-service';
import { ensureToken } from '../../lib/external/token-lifecycle';

const SET = 'wmkf_appreviewersuggestions';
const REQUESTS = 'akoya_requests';
const PEOPLE = 'wmkf_potentialreviewerses';
const ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';
const HONORARIUM = '44444444-4444-4444-8444-444444444444';
const OTHER = '55555555-5555-4555-8555-555555555555';
const THIRD = '66666666-6666-4666-8666-666666666666';
const RECEIVED = '2026-09-01T12:00:00.000Z';
const COMPLETED = '2026-09-02T12:00:00.000Z';
const trusted = (work) => withDalContext('stage0-reviewer-race', work);
const row = (overrides = {}) => ({
  wmkf_appreviewersuggestionid: ID,
  _wmkf_request_value: REQUEST,
  _wmkf_potentialreviewer_value: PERSON,
  wmkf_selected: true,
  wmkf_accepted: true,
  wmkf_declined: false,
  wmkf_responsetype: RESPONSE_TYPE_MAP.accepted,
  wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted,
  wmkf_applicantdisposition: null,
  wmkf_reviewreceivedat: null,
  wmkf_completedat: null,
  wmkf_remindercount: 0,
  wmkf_externaltokenrevoked: false,
  ...overrides,
});
const pending = (overrides = {}) => row({
  wmkf_accepted: false,
  wmkf_responsetype: null,
  wmkf_reviewstatus: null,
  wmkf_emailsentat: '2020-01-01T00:00:00.000Z',
  ...overrides,
});

let transport;
let email;
const savedEnv = {};
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  for (const key of ['DYNAMICS_URL', 'DATAVERSE_TARGET_INTERLOCK', 'REVIEWER_EMAIL_DELIVERY_MODE']) savedEnv[key] = process.env[key];
  process.env.DYNAMICS_URL = 'https://reviewer-harness.invalid';
  process.env.DATAVERSE_TARGET_INTERLOCK = 'off'; // Synthetic host; real DAL enforcement stays on.
  process.env.REVIEWER_EMAIL_DELIVERY_MODE = 'send';
  transport = createReviewerEngagementTransport({
    [SET]: [row()],
    [REQUESTS]: [{ akoya_requestid: REQUEST, akoya_requestnum: 'REQ-BASELINE', wmkf_meetingdate: null }],
    [PEOPLE]: [{
      wmkf_potentialreviewersid: PERSON,
      wmkf_name: 'Dr. Baseline Reviewer',
      wmkf_emailaddress: 'reviewer@example.org',
      wmkf_emailsource: 'orcid',
      wmkf_identitystatus: 'confirmed',
    }],
  });
  global.fetch = jest.fn(transport.fetch);
  jest.spyOn(DynamicsService, 'getAccessToken').mockResolvedValue('test-token');
  email = jest.spyOn(DynamicsService, 'createAndSendEmail').mockResolvedValue({ emailId: 'email-baseline' });
  jest.spyOn(console, 'log').mockImplementation(() => {}); // HTTP telemetry only.
});
afterEach(async () => {
  // A caught dependency error must still fail this suite, including a malformed
  // URL rejected before the transport can append it to its request inventory.
  try {
    const fetchOutcomes = await Promise.allSettled(global.fetch.mock.results.map((result) => result.value));
    expect(fetchOutcomes.filter((outcome) => outcome.status === 'rejected')).toEqual([]);
    expect(transport.unexpectedRequests).toEqual([]);
    expect(sql).not.toHaveBeenCalled();
    expect(getReviewSynthesisJobState).not.toHaveBeenCalled();
  } finally {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function writes() { return transport.requests.filter((request) => request.method !== 'GET'); }
function send(templateType = 'followup') {
  const events = [];
  const body = templateType === 'materials'
    ? 'Dear Reviewer,\n\nPlease review:\nhttps://reviews.example.org/external/review/aaa.bbb.ccc\n\nThank you.'
    : 'Dear Reviewer,\n\nA reminder about your review.\n\nThank you.';
  const promise = trusted(() => sendEmails({
    requestBody: { templateType, drafts: [{ suggestionId: ID, subject: 'Reviewer message', body,
      externalLinkExpected: templateType === 'materials' }] },
    fromEmail: 'staff@example.org',
  }, (event) => events.push(event)));
  return { promise, events };
}
function assertSent(events, count = 1) {
  expect(events.filter((event) => event.event === 'email_sent')).toHaveLength(count);
  expect(events.find((event) => event.event === 'result').data.sent).toHaveLength(count);
  expect(events.slice(-2).map((event) => event.event)).toEqual(['result', 'complete']);
}

describe('F2 stale invitation discovery versus newer state', () => {
  function seedStale() {
    transport.seed(SET, pending());
    transport.patch(REQUESTS, REQUEST, { wmkf_meetingdate: '2020-02-01' });
  }

  test('KNOWN DEFECT F2: real acceptance after discovery is overwritten by unconditional no_response', async () => {
    seedStale();
    const atParentRead = transport.pauseNext((request) => request.entitySet === REQUESTS && request.method === 'GET');
    const sweep = trusted(() => sweepStaleInvites());
    await atParentRead.reached;
    let accepted;
    try {
      await trusted(() => suggestionAdapter.applyStage2aResponse(ID, {
        action: 'accept',
        acks: { coiVersionId: OTHER, aiUseVersionId: THIRD },
        responseReceivedAt: RECEIVED,
      }, { ifMatch: transport.get(SET, ID)._etag }));
      accepted = transport.get(SET, ID);
    } finally { atParentRead.release(); }

    expect(await sweep).toMatchObject({ swept: 1, errors: [] });
    expect(accepted.wmkf_responsetype).toBe(RESPONSE_TYPE_MAP.accepted);
    expect(transport.get(SET, ID)).toMatchObject({
      wmkf_accepted: true, wmkf_declined: false, wmkf_responsetype: RESPONSE_TYPE_MAP.no_response,
    });
    expect(writes().at(-1).headers['If-Match']).toBeUndefined();
    expect(transport.get(SET, ID).wmkf_responsereceivedat).not.toBe(RECEIVED);
  });

  test.each([
    ['removed', { wmkf_selected: false }],
    ['excluded', { wmkf_selected: false, wmkf_applicantdisposition: 100000001 }],
  ])('KNOWN DEFECT F2: a row %s after discovery still receives the sweep stamp', async (_name, mutation) => {
    seedStale();
    const pause = transport.pauseNext((request) => request.method === 'PATCH');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    transport.patch(SET, ID, mutation);
    pause.release();
    expect(await sweep).toMatchObject({ swept: 1 });
    expect(transport.get(SET, ID)).toMatchObject({ ...mutation, wmkf_responsetype: RESPONSE_TYPE_MAP.no_response });
    expect(writes()[0].headers['If-Match']).toBeUndefined();
  });

  test('dry-run detects eligible invitation without writing; missing meeting date stays ineligible', async () => {
    seedStale();
    expect(await trusted(() => sweepStaleInvites({ dryRun: true }))).toMatchObject({ eligible: 1, swept: 0, dryRun: true });
    transport.patch(REQUESTS, REQUEST, { wmkf_meetingdate: null });
    expect(await trusted(() => sweepStaleInvites())).toMatchObject({ scanned: 1, eligible: 0, swept: 0 });
    expect(writes()).toEqual([]);
    expect(transport.get(SET, ID).wmkf_responsetype).toBeNull();
  });

  test('missing parent never becomes eligible and maxBatch limits each real sweep', async () => {
    seedStale();
    transport.seed(SET, pending({ wmkf_appreviewersuggestionid: OTHER }));
    transport.seed(SET, pending({ wmkf_appreviewersuggestionid: THIRD, _wmkf_request_value: HONORARIUM }));
    expect(await trusted(() => sweepStaleInvites({ maxBatch: 1 })))
      .toMatchObject({ scanned: 3, eligible: 2, swept: 1, skipped: 1, errors: [] });
    expect(writes()).toHaveLength(1);
    expect(transport.get(SET, THIRD).wmkf_responsetype).toBeNull();
    expect(await trusted(() => sweepStaleInvites({ maxBatch: 1 })))
      .toMatchObject({ scanned: 2, eligible: 1, swept: 1, skipped: 0, errors: [] });
    expect(writes().map((request) => request.key)).toEqual([ID, OTHER]);
  });
});

describe('F4 post-send bookkeeping races through the real adapter', () => {
  test.each(['materials', 'followup'])('KNOWN DEFECT F4: %s bookkeeping borrows the receipt version and regresses Review Received', async (templateType) => {
    const originalVersion = transport.get(SET, ID)._etag;
    let receiptVersion;
    email.mockImplementationOnce(async () => {
      await markReceivedNoFile({ suggestionId: ID });
      receiptVersion = transport.get(SET, ID)._etag;
      expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP.review_received);
      return { emailId: 'sent-before-bookkeeping' };
    });
    const run = send(templateType);
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(receiptVersion).not.toBe(originalVersion);
    expect(writes().at(-1).headers['If-Match']).toBe(receiptVersion);
    expect(transport.get(SET, ID)).toMatchObject({
      wmkf_reviewstatus: REVIEW_STATUS_MAP[templateType === 'materials' ? 'materials_sent' : 'under_review'],
      wmkf_reviewreceivedat: expect.any(String), wmkf_reviewuploadedbystaff: true,
    });
  });

  test('terminal transition during send is preserved and emits a bookkeeping warning after successful delivery', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    email.mockImplementationOnce(async () => {
      const terminal = await transitionReviewersTerminal({ requestId: REQUEST, suggestionIds: [ID], terminalStatus: 'released' });
      expect(terminal.transitioned).toBe(1);
      return { emailId: 'sent-before-close' };
    });
    const run = send();
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(transport.get(SET, ID)).toMatchObject({
      wmkf_reviewstatus: REVIEW_STATUS_MAP.released, wmkf_externaltokenrevoked: true, wmkf_remindercount: 0,
    });
    expect(writes()).toHaveLength(1);
    expect(run.events).toContainEqual({ event: 'progress', data: expect.objectContaining({ message: expect.stringContaining('Warning: lifecycle update failed') }) });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('email already sent'), expect.stringContaining('closed review status'));
  });

  test('412 after bookkeeping guard preserves the competing receipt and never resends transport', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const pause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.wmkf_remindercount === 1);
    const run = send();
    await pause.reached;
    let winner;
    try {
      await trusted(() => markReceivedNoFile({ suggestionId: ID }));
      winner = transport.get(SET, ID);
    } finally { pause.release(); }
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(writes().find((request) => request.body?.wmkf_remindercount === 1).status).toBe(412);
    expect(run.events.some((event) => event.data?.message?.includes('Warning: lifecycle update failed'))).toBe(true);
  });

  test.each(['accepted', 'under_review'])('KNOWN DEFECT F4: concurrent reminders from %s each send but persist only one increment', async (sourceStatus) => {
    transport.seed(SET, row({ wmkf_reviewstatus: REVIEW_STATUS_MAP[sourceStatus], wmkf_remindercount: 7 }));
    let releaseFirst;
    let firstReached;
    const firstAtSend = new Promise((resolve) => { firstReached = resolve; });
    email.mockImplementationOnce(async () => {
      firstReached();
      await new Promise((resolve) => { releaseFirst = resolve; });
      return { emailId: 'first' };
    });
    const first = send();
    await firstAtSend;
    const second = send();
    let secondRow;
    try {
      await second.promise;
      secondRow = transport.get(SET, ID);
    } finally { releaseFirst(); }
    await first.promise;

    assertSent(first.events);
    assertSent(second.events);
    expect(email).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(2);
    expect(writes().every((request) => request.status === 204)).toBe(true);
    expect(secondRow.wmkf_remindercount).toBe(8);
    expect(writes().at(-1).headers['If-Match']).toBe(sourceStatus === 'accepted' ? secondRow._etag : undefined);
    expect(transport.get(SET, ID).wmkf_remindercount).toBe(8);
  });

  test('KNOWN DEFECT F4: status bookkeeping with missing guard ETag falls through to an unconditional write', async () => {
    transport.seed(SET, row({ _etag: null }));
    const run = send();
    await run.promise;
    assertSent(run.events);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers['If-Match']).toBeUndefined();
    expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP.under_review);
  });
});

describe('F3 generic staff response correction and F5 batch baseline', () => {
  test.each(['complete', 'withdrew', 'released'])('KNOWN DEFECT F3: response-only staff correction rewrites a %s engagement without dedicated transition effects', async (status) => {
    const withdrawn = status === 'withdrew';
    const receipt = status === 'complete' ? RECEIVED : null;
    const completion = status === 'complete' ? COMPLETED : null;
    const honorarium = withdrawn ? null : HONORARIUM;
    const selected = !withdrawn;
    const tokenRevoked = status !== 'complete';
    transport.seed(SET, row({
      wmkf_reviewstatus: REVIEW_STATUS_MAP[status], wmkf_reviewreceivedat: receipt,
      wmkf_completedat: completion, _wmkf_honorariumrequest_value: honorarium,
      wmkf_selected: selected, wmkf_externaltokenrevoked: tokenRevoked,
      wmkf_accepted: !withdrawn, wmkf_declined: withdrawn,
      wmkf_responsetype: RESPONSE_TYPE_MAP[withdrawn ? 'declined' : 'accepted'],
    }));
    transport.seed(REQUESTS, { akoya_requestid: HONORARIUM, akoya_requestnum: 'HONORARIUM-UNCHANGED' });

    expect(await trusted(() => patchMyCandidates({ body: {
      suggestionId: ID, accepted: withdrawn, declined: !withdrawn,
      responseType: withdrawn ? 'accepted' : 'declined', responseReceivedAt: 'now',
    } }))).toMatchObject({ success: true });

    expect(transport.get(SET, ID)).toMatchObject({
      wmkf_reviewstatus: REVIEW_STATUS_MAP[status], wmkf_reviewreceivedat: receipt, wmkf_completedat: completion,
      wmkf_accepted: withdrawn, wmkf_declined: !withdrawn,
      wmkf_responsetype: RESPONSE_TYPE_MAP[withdrawn ? 'accepted' : 'declined'],
      wmkf_selected: selected, wmkf_externaltokenrevoked: tokenRevoked, _wmkf_honorariumrequest_value: honorarium,
    });
    expect(ensureToken).toHaveBeenCalledTimes(withdrawn ? 1 : 0);
    expect(transport.get(REQUESTS, HONORARIUM)).not.toBeNull();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers['If-Match']).toBeUndefined();
  });

  test.each(['complete', 'withdrew', 'released'])('the same adapter rejects a status-changing correction out of %s', async (status) => {
    transport.seed(SET, row({ wmkf_reviewstatus: REVIEW_STATUS_MAP[status] }));
    await expect(trusted(() => patchReviewers({ suggestionId: ID, lifecycle: { reviewStatus: 'under_review' } })))
      .rejects.toThrow('closed review status');
    expect(writes()).toEqual([]);
    expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP[status]);
  });

  test.each([0, 1, 2])('KNOWN DEFECT F5: batch failure at index %i preserves earlier commits and throws without outcome identifiers', async (failureIndex) => {
    const ids = [ID, OTHER, THIRD];
    ids.forEach((id, index) => transport.seed(SET, row({
      wmkf_appreviewersuggestionid: id,
      wmkf_applicantdisposition: index === failureIndex ? 100000001 : null,
    })));
    let failure;
    try {
      await trusted(() => patchReviewers({ suggestionIds: ids, reviewStatus: 'under_review' }));
    } catch (error) { failure = error; }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain('applicant-excluded');
    expect(failure).not.toHaveProperty('results');
    expect(failure).not.toHaveProperty('successfulIds');
    expect(writes().map((request) => request.key)).toEqual(ids.slice(0, failureIndex));
    ids.forEach((id, index) => expect(transport.get(SET, id).wmkf_reviewstatus)
      .toBe(REVIEW_STATUS_MAP[index < failureIndex ? 'under_review' : 'accepted']));
    const readIds = transport.requests.filter((request) => request.method === 'GET' && request.entitySet === SET).map((request) => request.key);
    expect(readIds).toEqual(ids.slice(0, failureIndex + 1));
  });
});
