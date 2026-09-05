/**
 * @jest-environment node
 *
 * Composed reviewer races: Stage 1A expiry, Stage 1B email and Stage 1D correction
 * regressions and Stage 6A status outcomes. Services, adapters, DAL context,
 * Dynamics reads/writes, annotation processing and If-Match transport are real.
 * External email/token/question/SQL dependencies and authenticated entry/role
 * lookups are replaced; the whole-batch request ownership policy is real.
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
jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  getUserRole: jest.fn(),
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
import { closeReview } from '../../lib/services/review-manager/close-review-service';
import { REVIEW_STATUS_MAP, RESPONSE_TYPE_MAP } from '../../shared/config/reviewerLifecycle';
import { sql } from '@vercel/postgres';
import { getReviewSynthesisJobState } from '../../lib/services/review-synthesis-job-service';
import { ensureToken } from '../../lib/external/token-lifecycle';
import reviewersHandler from '../../pages/api/review-manager/reviewers';
import { requireAppAccess, getUserRole } from '../../lib/utils/auth';

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
let expectedFetchRejections;
const savedEnv = {};
const originalFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  expectedFetchRejections = [];
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
    const rejectedFetches = fetchOutcomes.filter((outcome) => outcome.status === 'rejected');
    // Only exact, deliberately injected network failures are allowed. A caught
    // unknown fixture/URL failure still fails the isolation contract.
    expect(rejectedFetches).toHaveLength(expectedFetchRejections.length);
    rejectedFetches.forEach((outcome, index) => expect(outcome.reason).toBe(expectedFetchRejections[index]));
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
  const needsLink = templateType === 'materials' || templateType === 'invitation';
  const body = needsLink
    ? 'Dear Reviewer,\n\nPlease review:\nhttps://reviews.example.org/external/review/aaa.bbb.ccc\n\nThank you.'
    : 'Dear Reviewer,\n\nA reminder about your review.\n\nThank you.';
  const promise = trusted(() => sendEmails({
    requestBody: { templateType, drafts: [{ suggestionId: ID, subject: 'Reviewer message', body,
      externalLinkExpected: needsLink }] },
    fromEmail: 'staff@example.org',
  }, (event) => events.push(event)));
  return { promise, events };
}
function assertSent(events, count = 1) {
  expect(events.filter((event) => event.event === 'email_sent')).toHaveLength(count);
  const result = events.find((event) => event.event === 'result').data;
  expect(result.sent).toHaveLength(count);
  expect(result.sent).toEqual(expect.arrayContaining([expect.objectContaining({ suggestionId: ID, emailId: expect.any(String) })]));
  expect(result.sent).toEqual(events.filter((event) => event.event === 'email_sent').map((event) => event.data));
  expect(result).toMatchObject({ failed: [], skipped: [], unconfirmed: [], stats: { sent: count, failed: 0, skipped: 0, unconfirmed: 0 } });
  expect(events.filter((event) => ['email_failed', 'email_unconfirmed', 'error'].includes(event.event))).toEqual([]);
  expect(events.slice(-2).map((event) => event.event)).toEqual(['result', 'complete']);
  expect(events.at(-1).data).toMatchObject({ sent: count, failed: 0, skipped: 0, unconfirmed: 0 });
}

describe('F2 stale invitation discovery versus newer state', () => {
  function seedStale() {
    transport.seed(SET, pending());
    transport.patch(REQUESTS, REQUEST, { wmkf_meetingdate: '2020-02-01' });
  }

  test('F2 regression: real acceptance after discovery survives fresh eligibility revalidation', async () => {
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

    expect(await sweep).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(accepted.wmkf_responsetype).toBe(RESPONSE_TYPE_MAP.accepted);
    expect(transport.get(SET, ID)).toEqual(accepted);
    expect(writes()).toHaveLength(1); // Only the actual acceptance writer.
    expect(transport.get(SET, ID).wmkf_responsereceivedat).toBe(RECEIVED);
  });

  test.each([
    ['removed', { wmkf_selected: false }],
    ['excluded', { wmkf_applicantdisposition: 100000001 }],
  ])('F2 regression: a row %s after fresh eligibility wins the conditional PATCH race', async (_name, mutation) => {
    seedStale();
    const pause = transport.pauseNext((request) => request.method === 'PATCH');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    const winner = transport.patch(SET, ID, mutation);
    pause.release();
    expect(await sweep).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers['If-Match']).toEqual(expect.any(String));
    expect(writes()[0].headers['If-Match']).not.toBe(winner._etag);
    expect(writes()[0].status).toBe(412);
  });

  test('F2 regression: real acceptance after the fresh read wins at the HTTP If-Match boundary', async () => {
    seedStale();
    const pause = transport.pauseNext((request) => request.method === 'PATCH'
      && request.body?.wmkf_responsetype === RESPONSE_TYPE_MAP.no_response);
    const sweep = trusted(() => sweepStaleInvites());
    const write = await pause.reached;
    const authorizedVersion = transport.get(SET, ID)._etag;
    let winner;
    try {
      await trusted(() => suggestionAdapter.applyStage2aResponse(ID, {
        action: 'accept', acks: { coiVersionId: OTHER, aiUseVersionId: THIRD },
        responseReceivedAt: RECEIVED,
      }, { ifMatch: authorizedVersion }));
      winner = transport.get(SET, ID);
    } finally { pause.release(); }
    expect(await sweep).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(write.headers['If-Match']).toBe(authorizedVersion);
    expect(write.status).toBe(412);
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(transport.get(SET, ID)).toMatchObject({ wmkf_accepted: true, wmkf_responsetype: RESPONSE_TYPE_MAP.accepted, wmkf_responsereceivedat: RECEIVED });
    expect(writes()).toHaveLength(2); // One refused expiry, one committed acceptance.
  });

  test.each([
    ['removed', { wmkf_selected: false }],
    ['excluded but still selected', { wmkf_applicantdisposition: 100000001 }],
    ['invitation evidence cleared', { wmkf_emailsentat: null }],
    ['response timestamp recorded', { wmkf_responsereceivedat: RECEIVED }],
    ['review receipt recorded', { wmkf_reviewreceivedat: RECEIVED }],
    ['completed', { wmkf_completedat: COMPLETED }],
    ['unknown review status', { wmkf_reviewstatus: 999 }],
  ])('F2 regression: %s before the fresh eligibility read is skipped without a write', async (_label, mutation) => {
    seedStale();
    const pause = transport.pauseNext((request) => request.entitySet === REQUESTS && request.method === 'GET');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    const winner = transport.patch(SET, ID, mutation);
    pause.release();
    expect(await sweep).toMatchObject({ eligible: 1, swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(writes()).toHaveLength(0);
  });

  test('F2 regression: a suggestion deleted after discovery is skipped as a structured Dataverse not-found', async () => {
    seedStale();
    const pause = transport.pauseNext((request) => request.entitySet === REQUESTS && request.method === 'GET');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    try { await trusted(() => DynamicsService.deleteRecord(SET, ID)); }
    finally { pause.release(); }
    expect(await sweep).toMatchObject({ eligible: 1, swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID)).toBeNull();
    expect(writes().map((request) => request.method)).toEqual(['DELETE']);
  });

  test('F2 regression: reparented suggestion cannot borrow another expired request from discovery', async () => {
    seedStale();
    // Both requests are expired, so the negative assertion proves binding,
    // not an incidental missing/future meeting date on the new request.
    transport.seed(REQUESTS, { akoya_requestid: OTHER, wmkf_meetingdate: '2020-02-01' });
    const pause = transport.pauseNext((request) => request.entitySet === REQUESTS && request.method === 'GET');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    const moved = transport.patch(SET, ID, { _wmkf_request_value: OTHER });
    pause.release();
    expect(await sweep).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID)).toEqual(moved);
    expect(writes()).toHaveLength(0);
  });

  test('F2 regression: reparenting after fresh authorization cannot land an expiry on the new request', async () => {
    seedStale();
    transport.seed(REQUESTS, { akoya_requestid: OTHER, wmkf_meetingdate: '2020-02-01' });
    const pause = transport.pauseNext((request) => request.method === 'PATCH');
    const sweep = trusted(() => sweepStaleInvites());
    const write = await pause.reached;
    const moved = transport.patch(SET, ID, { _wmkf_request_value: OTHER });
    pause.release();
    expect(await sweep).toMatchObject({ swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID)).toEqual(moved);
    expect(write.status).toBe(412);
  });

  test.each(['rescheduled', 'deleted'])('F2 regression: parent %s after discovery is freshly rechecked before expiry', async (change) => {
    seedStale();
    const pause = transport.pauseNext((request) => request.entitySet === SET && request.key === ID && request.method === 'GET');
    const sweep = trusted(() => sweepStaleInvites());
    await pause.reached;
    try {
      if (change === 'rescheduled') transport.patch(REQUESTS, REQUEST, { wmkf_meetingdate: '2099-02-01' });
      else await trusted(() => DynamicsService.deleteRecord(REQUESTS, REQUEST));
    } finally { pause.release(); }
    expect(await sweep).toMatchObject({ eligible: 1, swept: 0, skipped: 1, errors: [] });
    expect(transport.get(SET, ID).wmkf_responsetype).toBeNull();
    expect(writes().filter((request) => request.entitySet === SET)).toHaveLength(0);
  });

  test('documented boundary: a suggestion ETag does not lock a parent meeting-date edit after its final recheck', async () => {
    seedStale();
    const pause = transport.pauseNext((request) => request.method === 'PATCH');
    const sweep = trusted(() => sweepStaleInvites());
    const write = await pause.reached;
    const suggestionVersion = transport.get(SET, ID)._etag;
    transport.patch(REQUESTS, REQUEST, { wmkf_meetingdate: '2099-02-01' });
    pause.release();
    expect(await sweep).toMatchObject({ swept: 1, skipped: 0, errors: [] });
    expect(write.headers['If-Match']).toBe(suggestionVersion);
    expect(write.status).toBe(204);
    expect(transport.get(REQUESTS, REQUEST).wmkf_meetingdate).toBe('2099-02-01');
    expect(transport.get(SET, ID).wmkf_responsetype).toBe(RESPONSE_TYPE_MAP.no_response);
  });

  test('conditional expiry followed by repeat performs no second write or response restamp', async () => {
    seedStale();
    const version = transport.get(SET, ID)._etag;
    expect(await trusted(() => sweepStaleInvites())).toMatchObject({ swept: 1, skipped: 0, errors: [] });
    const expired = transport.get(SET, ID);
    expect(writes()[0].headers['If-Match']).toBe(version);
    expect(expired.wmkf_responsereceivedat).toEqual(expect.any(String));
    expect(await trusted(() => sweepStaleInvites())).toMatchObject({ scanned: 0, swept: 0, errors: [] });
    expect(writes()).toHaveLength(1);
    expect(transport.get(SET, ID)).toEqual(expired);
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
  async function makeTerminal(status) {
    if (status === 'complete') {
      await trusted(() => markReceivedNoFile({ suggestionId: ID }));
      expect(await trusted(() => closeReview({
        suggestionId: ID, disposition: 'not_applicable', authorizedRequestId: REQUEST,
      }))).toMatchObject({ status: 'closed' });
    } else {
      expect(await trusted(() => transitionReviewersTerminal({
        requestId: REQUEST, suggestionIds: [ID], terminalStatus: status,
      }))).toMatchObject({ transitioned: 1 });
    }
    return transport.get(SET, ID);
  }

  function assertBookkeepingWarning(events) {
    assertSent(events);
    expect(events).toContainEqual({ event: 'progress', data: expect.objectContaining({
      stage: 'updating_lifecycle', message: expect.stringContaining('Warning: lifecycle update failed'),
    }) });
  }

  function assertDeliveryStamp(templateType, expectedCount = 1) {
    const current = transport.get(SET, ID);
    if (templateType === 'materials') expect(current.wmkf_materialssentat).toEqual(expect.any(String));
    else expect(current).toMatchObject({ wmkf_remindersentat: expect.any(String), wmkf_remindercount: expectedCount });
  }

  test.each(['materials', 'followup'])('F4 regression: %s bookkeeping preserves Review Received after delivery', async (templateType) => {
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
      wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received,
      wmkf_reviewreceivedat: expect.any(String), wmkf_reviewuploadedbystaff: true,
    });
    expect(writes().at(-1).body).not.toHaveProperty('wmkf_reviewstatus');
    assertDeliveryStamp(templateType);
  });

  test.each(['materials', 'followup'].flatMap((template) => ['complete', 'withdrew', 'released'].map((status) => [template, status])))('%s bookkeeping preserves %s committed during delivery and warns after the successful send', async (templateType, status) => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    let winner;
    email.mockImplementationOnce(async () => {
      winner = await makeTerminal(status);
      return { emailId: 'sent-before-close' };
    });
    const run = send(templateType);
    await run.promise;

    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(writes().filter((request) => request.body?.wmkf_remindercount !== undefined || request.body?.wmkf_materialssentat)).toHaveLength(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('email already sent'), expect.any(String));
  });

  test.each(['materials', 'followup'])('F4 regression: 412 after the %s bookkeeping read preserves the receipt and retries only the delivered stamp', async (templateType) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const stampField = templateType === 'materials' ? 'wmkf_materialssentat' : 'wmkf_remindersentat';
    const pause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.[stampField]);
    const run = send(templateType);
    const staleWrite = await pause.reached;
    let winner;
    try {
      await trusted(() => markReceivedNoFile({ suggestionId: ID }));
      winner = transport.get(SET, ID);
    } finally { pause.release(); }
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(transport.get(SET, ID)).toMatchObject({
      wmkf_reviewstatus: winner.wmkf_reviewstatus,
      wmkf_reviewreceivedat: winner.wmkf_reviewreceivedat,
      wmkf_reviewuploadedbystaff: winner.wmkf_reviewuploadedbystaff,
    });
    expect(staleWrite.status).toBe(412);
    const retry = writes().at(-1);
    expect(retry.status).toBe(204);
    expect(retry.headers['If-Match']).toBe(winner._etag);
    expect(retry.body).not.toHaveProperty('wmkf_reviewstatus');
    expect(retry.body[stampField]).toBe(staleWrite.body[stampField]);
    expect(writes()).toHaveLength(3);
    assertDeliveryStamp(templateType);
    expect(run.events.some((event) => event.data?.message?.includes('Warning: lifecycle update failed'))).toBe(false);
  });

  test.each(['accepted', 'under_review'])('F4 regression: concurrent reminders from %s each persist an increment', async (sourceStatus) => {
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
    expect(writes().at(-1).headers['If-Match']).toBe(secondRow._etag);
    expect(transport.get(SET, ID).wmkf_remindercount).toBe(9);
  });

  test.each(['accepted', 'under_review'])('F4 regression: same-version %s reminder PATCHes retry only bookkeeping with the fresh count and ETag', async (sourceStatus) => {
    transport.seed(SET, row({ wmkf_reviewstatus: REVIEW_STATUS_MAP[sourceStatus], wmkf_remindercount: 7 }));
    const sharedVersion = transport.get(SET, ID)._etag;
    const firstWritePause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.wmkf_remindercount === 8);
    const first = send();
    const firstWrite = await firstWritePause.reached;
    const secondWritePause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.wmkf_remindercount === 8);
    const second = send();
    const secondWrite = await secondWritePause.reached;
    let secondRow;
    try {
      secondWritePause.release();
      await second.promise;
      secondRow = transport.get(SET, ID);
    } finally {
      secondWritePause.release();
      firstWritePause.release();
    }
    await first.promise;

    assertSent(first.events);
    assertSent(second.events);
    expect(firstWrite.headers['If-Match']).toBe(sharedVersion);
    expect(secondWrite.headers['If-Match']).toBe(sharedVersion);
    expect(secondRow.wmkf_remindercount).toBe(8);
    expect(email).toHaveBeenCalledTimes(2);
    expect(writes()).toHaveLength(3);
    expect(firstWrite.status).toBe(412);
    expect(secondWrite.status).toBe(204);
    const retriedWrite = writes().at(-1);
    expect(retriedWrite).toMatchObject({ status: 204, body: { wmkf_remindercount: 9 } });
    expect(retriedWrite.headers['If-Match']).toBe(secondRow._etag);
    expect(retriedWrite.headers['If-Match']).not.toBe(sharedVersion);
    const retryRequests = transport.requests.slice(transport.requests.indexOf(secondWrite) + 1);
    expect(retryRequests.some((request) => request.method === 'GET' && request.entitySet === SET && request.key === ID)).toBe(true);
    expect(transport.get(SET, ID)).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.under_review, wmkf_remindercount: 9 });
    expect([...first.events, ...second.events].some((event) => event.data?.message?.includes('Warning: lifecycle update failed'))).toBe(false);
  });

  test.each(['materials', 'followup'].flatMap((template) => ['complete', 'withdrew', 'released'].map((status) => [template, status])))('F4 regression: %s bookkeeping retries after %s wins the write race without resending delivery', async (templateType, status) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const stampField = templateType === 'materials' ? 'wmkf_materialssentat' : 'wmkf_remindersentat';
    const pause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.[stampField]);
    const run = send(templateType);
    const pendingWrite = await pause.reached;
    let winner;
    try { winner = await makeTerminal(status); }
    finally { pause.release(); }
    await run.promise;

    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(pendingWrite.status).toBe(412);
    expect(transport.get(SET, ID)).toEqual(winner);
    expect(writes().filter((request) => request.body?.[stampField])).toHaveLength(1);
  });

  test.each(['materials', 'followup'])('F4 regression: %s preserves a receipt timestamp on an older accepted status while recording delivery', async (templateType) => {
    let receipt;
    email.mockImplementationOnce(async () => {
      // Legacy receipt producers could leave status at accepted. The receipt
      // timestamp itself must suppress an otherwise eligible status advance.
      receipt = transport.patch(SET, ID, { wmkf_reviewreceivedat: RECEIVED });
      return { emailId: 'receipt-timestamp-winner' };
    });
    const run = send(templateType);
    await run.promise;
    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers['If-Match']).toBe(receipt._etag);
    expect(writes()[0].body).not.toHaveProperty('wmkf_reviewstatus');
    expect(transport.get(SET, ID)).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted, wmkf_reviewreceivedat: RECEIVED });
    assertDeliveryStamp(templateType);
  });

  test.each([
    [null, null],
    [REVIEW_STATUS_MAP.accepted, REVIEW_STATUS_MAP.under_review],
    [REVIEW_STATUS_MAP.materials_sent, REVIEW_STATUS_MAP.under_review],
    [REVIEW_STATUS_MAP.under_review, REVIEW_STATUS_MAP.under_review],
    [REVIEW_STATUS_MAP.review_received, REVIEW_STATUS_MAP.review_received],
  ])('followup status %s advances only to %s and always records its delivered increment conditionally', async (sourceStatus, expectedStatus) => {
    transport.seed(SET, row({ wmkf_reviewstatus: sourceStatus }));
    const version = transport.get(SET, ID)._etag;
    const run = send();
    await run.promise;
    assertSent(run.events);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].headers['If-Match']).toBe(version);
    expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(expectedStatus);
    assertDeliveryStamp('followup');
  });

  test.each([
    ['completion timestamp without terminal status', { wmkf_completedat: COMPLETED }],
    ['unknown nonnull status', { wmkf_reviewstatus: 999 }],
    ['changed request binding', { _wmkf_request_value: OTHER }],
    ['changed reviewer binding', { _wmkf_potentialreviewer_value: OTHER }],
    ['missing request binding', { _wmkf_request_value: null }],
    ['missing reviewer binding', { _wmkf_potentialreviewer_value: null }],
  ])('F4 regression: %s after delivery warns and performs no bookkeeping write', async (_label, mutation) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let winner;
    email.mockImplementationOnce(async () => {
      winner = transport.patch(SET, ID, mutation);
      return { emailId: 'delivered-before-state-changed' };
    });
    const run = send();
    await run.promise;
    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
    expect(transport.get(SET, ID)).toEqual(winner);
  });

  test.each([
    ['request binding', { _wmkf_request_value: OTHER }],
    ['reviewer binding', { _wmkf_potentialreviewer_value: OTHER }],
    ['completion timestamp', { wmkf_completedat: COMPLETED }],
    ['unknown status', { wmkf_reviewstatus: 999 }],
  ])('F4 regression: changed %s after the read wins the PATCH and stops bookkeeping retry', async (_label, mutation) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const pause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.wmkf_remindercount === 1);
    const run = send();
    const staleWrite = await pause.reached;
    const winner = transport.patch(SET, ID, mutation);
    pause.release();
    await run.promise;
    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(1);
    expect(staleWrite.status).toBe(412);
    expect(transport.get(SET, ID)).toEqual(winner);
  });

  test('post-send bookkeeping does not invent accepted, selected, response or token gates for an otherwise known status', async () => {
    const changed = { wmkf_accepted: false, wmkf_selected: false, wmkf_declined: true,
      wmkf_responsetype: RESPONSE_TYPE_MAP.declined, wmkf_externaltokenrevoked: true };
    email.mockImplementationOnce(async () => {
      transport.patch(SET, ID, changed);
      return { emailId: 'delivered-with-legacy-state' };
    });
    const run = send();
    await run.promise;
    assertSent(run.events);
    expect(writes()).toHaveLength(1);
    expect(transport.get(SET, ID)).toMatchObject(changed);
    assertDeliveryStamp('followup');
  });

  test.each(['read', 'write'])('F4 regression: a non-412 bookkeeping %s error keeps the delivery sent and never retries transport', async (phase) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const rejected = [];
    const before = transport.get(SET, ID);
    email.mockImplementationOnce(async () => {
      global.fetch.mockImplementation(async (url, options = {}) => {
        const method = options.method || 'GET';
        if (url.includes(`${SET}(${ID})`) && method === (phase === 'read' ? 'GET' : 'PATCH')) {
          rejected.push({ url, options });
          // Text containing 412 must not turn a different HTTP error into a
          // concurrency retry. This is a modeled HTTP response, not a rejected
          // transport promise swallowed by the harness.
          const body = { error: { message: 'Fixture forbidden; reference 412 is not the HTTP status' } };
          return { ok: false, status: 403, headers: { get: () => 'application/json' },
            text: async () => JSON.stringify(body), json: async () => body };
        }
        return transport.fetch(url, options);
      });
      return { emailId: 'sent-before-bookkeeping-error' };
    });
    const run = send();
    await run.promise;
    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(rejected).toHaveLength(1);
    expect(transport.get(SET, ID)).toEqual(before);
    expect(writes()).toHaveLength(0);
    if (phase === 'write') expect(rejected[0].options.headers['If-Match']).toBe(before._etag);
  });

  test('F4 regression: three actual 412 conflicts exhaust bookkeeping without an unconditional fallback or another delivery', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    let conflicts = 0;
    email.mockImplementationOnce(async () => {
      global.fetch.mockImplementation(async (url, options = {}) => {
        if (url.includes(`${SET}(${ID})`) && options.method === 'PATCH') {
          conflicts += 1;
          transport.patch(SET, ID, { wmkf_notes: `Competing writer ${conflicts}` });
        }
        return transport.fetch(url, options);
      });
      return { emailId: 'sent-before-repeated-conflict' };
    });
    const run = send();
    await run.promise;
    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(conflicts).toBe(3);
    expect(writes()).toHaveLength(3);
    expect(writes().every((request) => request.status === 412 && request.headers['If-Match'])).toBe(true);
    expect(new Set(writes().map((request) => request.headers['If-Match'])).size).toBe(3);
    expect(transport.get(SET, ID)).toMatchObject({ wmkf_reviewstatus: REVIEW_STATUS_MAP.accepted, wmkf_remindercount: 0, wmkf_notes: 'Competing writer 3' });
    expect(transport.get(SET, ID)).not.toHaveProperty('wmkf_remindersentat');
  });

  test.each([null, '*', 'W/" "', ' W/"12"', 'W/"12" ', 'malformed'])('F4 regression: bookkeeping with invalid ETag %p never writes unconditionally', async (etag) => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    transport.seed(SET, row({ _etag: etag }));
    const run = send();
    await run.promise;
    assertBookkeepingWarning(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(writes()).toHaveLength(0);
    expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP.accepted);
  });

  test('invitation stamping remains inline before email_sent and never enters post-loop bookkeeping', async () => {
    transport.seed(SET, pending({ wmkf_invited: false, wmkf_emailsentat: null }));
    transport.patch(REQUESTS, REQUEST, { _wmkf_programdirector_value: OTHER });
    transport.seed('systemusers', { systemuserid: OTHER, fullname: 'Program Director',
      internalemailaddress: 'pd@example.org', isdisabled: false });
    const pause = transport.pauseNext((request) => request.method === 'PATCH' && request.body?.wmkf_invited === true);
    const run = send('invitation');
    await pause.reached;
    const eventsWhileStampPending = run.events.map((event) => event.event);
    pause.release();
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    expect(eventsWhileStampPending).not.toContain('email_sent');
    expect(writes()).toHaveLength(1);
    expect(writes()[0].body).toMatchObject({ wmkf_invited: true, wmkf_emailsentat: expect.any(String), wmkf_respondremindersentat: null });
    expect(run.events.find((event) => event.event === 'email_sent').data.inviteRecorded).toBe(true);
    expect(run.events.some((event) => event.data?.stage === 'updating_lifecycle')).toBe(false);
  });

  test.each(['accepted', 'complete', 'withdrew', 'released'])('manual thankyou remains a separate delivery-only stamp for %s', async (status) => {
    const before = status === 'accepted' ? transport.get(SET, ID) : await makeTerminal(status);
    const run = send('thankyou');
    await run.promise;

    assertSent(run.events);
    expect(email).toHaveBeenCalledTimes(1);
    const thankyouWrites = writes().filter((request) => request.body?.wmkf_thankyousentat);
    expect(thankyouWrites).toHaveLength(1);
    expect(thankyouWrites[0].headers['If-Match']).toBe(before._etag);
    expect(thankyouWrites[0].body).toEqual({ wmkf_thankyousentat: expect.any(String) });
    const existingFields = { ...before };
    delete existingFields._etag;
    expect(transport.get(SET, ID)).toMatchObject(existingFields);
    expect(run.events.some((event) => event.data?.message?.includes('Warning: lifecycle update failed'))).toBe(false);
  });
});

describe('F3 generic staff correction regressions', () => {
  const ACTOR = '77777777-7777-4777-8777-777777777777';
  let impersonationBefore;
  beforeEach(() => {
    impersonationBefore = process.env.DYNAMICS_IMPERSONATION_ENABLED;
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
  });
  afterEach(() => {
    if (impersonationBefore === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
    else process.env.DYNAMICS_IMPERSONATION_ENABLED = impersonationBefore;
  });
  const ORIGINAL_EMAIL_AT = '2026-08-01T12:00:00.000Z';
  const CORRECTION_EMAIL_AT = '2026-08-02T12:00:00.000Z';
  const CLOSED = ['complete', 'withdrew', 'released'];
  const CORRECTIONS = [
    ['invited', 'wmkf_invited', [false, null, true]],
    ['accepted', 'wmkf_accepted', [false, null, true]],
    ['declined', 'wmkf_declined', [true, null, false]],
    ['emailSentAt', 'wmkf_emailsentat', ['now', null, ORIGINAL_EMAIL_AT]],
    ['responseType', 'wmkf_responsetype', ['declined', null, 'accepted']],
    ['responseReceivedAt', 'wmkf_responsereceivedat', ['now', null, RECEIVED]],
  ];
  const MIXED_CORRECTION = {
    invited: false, accepted: true, declined: false,
    emailSentAt: CORRECTION_EMAIL_AT, responseType: 'accepted', responseReceivedAt: 'now',
    name: 'Correction must not leak into the person',
  };

  function seedCorrection(fields = {}) {
    // The linked honorarium is deliberately PRESENT even on a historical
    // withdrew row: refusing a correction must not perform terminal cleanup.
    transport.seed(SET, row({
      wmkf_invited: true, wmkf_emailsentat: ORIGINAL_EMAIL_AT,
      wmkf_responsereceivedat: RECEIVED, _wmkf_honorariumrequest_value: HONORARIUM,
      ...fields,
    }));
    transport.seed(REQUESTS, {
      akoya_requestid: HONORARIUM, akoya_requestnum: 'HONORARIUM-UNCHANGED',
      wmkf_authorizationtoremitpaymentflag: false,
    });
    transport.seed(REQUESTS, {
      akoya_requestid: OTHER, akoya_requestnum: 'SECOND-VALID-REQUEST',
      wmkf_meetingdate: '2026-12-01',
    });
  }

  function history() {
    return {
      suggestion: transport.get(SET, ID),
      people: transport.rows(PEOPLE),
      requests: transport.rows(REQUESTS),
    };
  }

  function assertHistoryUnchanged(before) {
    expect(transport.get(SET, ID)).toEqual(before.suggestion);
    expect(transport.rows(PEOPLE)).toEqual(before.people);
    expect(transport.rows(REQUESTS)).toEqual(before.requests);
    expect(ensureToken).not.toHaveBeenCalled();
    expect(email).not.toHaveBeenCalled();
  }

  const correct = (fields, options = {}) => trusted(() => patchMyCandidates({
    body: { suggestionId: ID, ...fields },
    actingUserSystemId: ACTOR,
    authorizedRequestId: REQUEST,
    ...options,
  }));
  const correctionWrites = () => writes().filter((request) => request.entitySet === SET
    && request.body?.wmkf_emailsentat === CORRECTION_EMAIL_AT);

  test.each(CLOSED.flatMap((status) => CORRECTIONS.flatMap(([field, _raw, values]) =>
    values.map((value) => [status, field, value]))))(
    'F3 regression: %s rejects defined %s=%p and leaves linked history and mixed person edits untouched',
    async (status, field, value) => {
      seedCorrection({
        wmkf_reviewstatus: REVIEW_STATUS_MAP[status],
        wmkf_reviewreceivedat: status === 'complete' ? RECEIVED : null,
        wmkf_completedat: status === 'complete' ? COMPLETED : null,
        wmkf_selected: status !== 'withdrew', wmkf_externaltokenrevoked: status !== 'complete',
      });
      const before = history();
      await expect(correct({ [field]: value, name: MIXED_CORRECTION.name }))
        .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_closed' } });
      expect(writes()).toEqual([]);
      assertHistoryUnchanged(before);
    },
  );

  test.each(CLOSED.flatMap((status) => CORRECTIONS.map(([field, raw, values]) =>
    [status, field, raw, values[0]])))(
    'F3 regression: the real adapter independently rejects %s source for %s (%s)',
    async (status, field, _raw, value) => {
      seedCorrection({ wmkf_reviewstatus: REVIEW_STATUS_MAP[status] });
      const before = history();
      await expect(trusted(() => suggestionAdapter.updateLifecycle(ID, { [field]: value }, {
        actingUserSystemId: ACTOR,
      }))).rejects.toMatchObject({ code: 'correction_closed' });
      expect(writes()).toEqual([]);
      assertHistoryUnchanged(before);
    },
  );

  test.each([null, 'accepted', 'materials_sent', 'under_review', 'review_received'])(
    'F3 regression: open source %s retains six-field mapping, exact version/actor and token-before-person order',
    async (status) => {
      seedCorrection({
        wmkf_reviewstatus: status === null ? null : REVIEW_STATUS_MAP[status],
        // These are deliberately not additional source gates. Receipt remains
        // compatible with correction until the separate human closeout.
        wmkf_selected: false, wmkf_accepted: false, wmkf_declined: true,
        wmkf_reviewreceivedat: RECEIVED,
      });
      const before = history();
      let stateAtToken;
      ensureToken.mockImplementationOnce(async () => { stateAtToken = history(); });
      const result = await correct({ ...MIXED_CORRECTION, emailSentAt: 'now' });
      expect(result).toMatchObject({ success: true, message: 'Candidate updated', updated: {
        suggestionId: ID, invited: false, accepted: true, declined: false, responseType: 'accepted',
        name: MIXED_CORRECTION.name,
      } });
      expect(result.updated.emailSentAt).toEqual(expect.any(String));
      expect(result.updated.emailSentAt).not.toBe('now');
      expect(result.updated.responseReceivedAt).not.toBe('now');
      const lifecycleWrite = writes()[0];
      expect(lifecycleWrite.body).toEqual({
        wmkf_invited: false, wmkf_accepted: true, wmkf_declined: false,
        wmkf_emailsentat: result.updated.emailSentAt,
        wmkf_responsetype: RESPONSE_TYPE_MAP.accepted,
        wmkf_responsereceivedat: result.updated.responseReceivedAt,
      });
      expect(lifecycleWrite.headers['If-Match']).toBe(before.suggestion._etag);
      expect(lifecycleWrite.headers.MSCRMCallerID).toBe(ACTOR);
      expect(ensureToken).toHaveBeenCalledTimes(1);
      expect(ensureToken).toHaveBeenCalledWith(ID, { actingUserSystemId: ACTOR });
      expect(stateAtToken.people).toEqual(before.people);
      expect(stateAtToken.suggestion).toMatchObject(lifecycleWrite.body);
      expect(writes().map((request) => request.entitySet)).toEqual([SET, PEOPLE]);
      expect(transport.get(PEOPLE, PERSON).wmkf_name).toBe(MIXED_CORRECTION.name);
      expect(transport.rows(REQUESTS)).toEqual(before.requests);
      expect(transport.get(SET, ID)).toMatchObject({
        wmkf_selected: false, wmkf_reviewreceivedat: RECEIVED, wmkf_completedat: null,
        wmkf_reviewstatus: before.suggestion.wmkf_reviewstatus,
      });
    },
  );

  test.each([
    [{ wmkf_reviewstatus: 999 }, {}, 'correction_state_unavailable'],
    [{ wmkf_reviewstatus: '100000000' }, {}, 'correction_state_unavailable'],
    [{ wmkf_completedat: COMPLETED }, {}, 'correction_closed'],
    [{ _wmkf_request_value: OTHER }, {}, 'correction_request_changed'],
    [{ _wmkf_request_value: null }, {}, 'correction_request_changed'],
    [{}, { authorizedRequestId: undefined }, 'correction_missing_authorized_request'],
    ...[null, '*', '', 'W/" "', ' W/"12"', 'W/"12" ', 'malformed'].map((etag) =>
      [{ _etag: etag }, {}, 'correction_version_unavailable']),
  ])('F3 regression: invalid source %j / binding %j fails before token or mixed person effects (%s)', async (fields, options, code) => {
    seedCorrection(fields);
    const before = history();
    // A body-provided binding is never authority, even when it matches the row
    // that moved away from the Request authorized by the route.
    await expect(correct({ ...MIXED_CORRECTION, authorizedRequestId: OTHER }, options))
      .rejects.toMatchObject({ httpStatus: code === 'correction_missing_authorized_request' ? 400 : 409, body: { code } });
    expect(writes()).toEqual([]);
    assertHistoryUnchanged(before);
  });

  test('F3 regression: an omitted status projection is not silently treated as explicit null', async () => {
    seedCorrection();
    const before = history();
    global.fetch.mockImplementation(async (url, options = {}) => {
      const response = await transport.fetch(url, options);
      if (url.includes(`${SET}(${ID})`) && (!options.method || options.method === 'GET')) {
        return { ...response, json: async () => {
          const data = await response.json();
          delete data.wmkf_reviewstatus;
          return data;
        } };
      }
      return response;
    });
    await expect(correct(MIXED_CORRECTION))
      .rejects.toMatchObject({ httpStatus: 409, body: { code: 'correction_state_unavailable' } });
    expect(writes()).toEqual([]);
    assertHistoryUnchanged(before);
  });

  test('F3 regression: a service request binding comparison remains case insensitive', async () => {
    const mixedCaseRequest = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    seedCorrection({ _wmkf_request_value: mixedCaseRequest.toUpperCase() });
    transport.seed(REQUESTS, { akoya_requestid: mixedCaseRequest, akoya_requestnum: 'CASE-BOUND' });
    const version = transport.get(SET, ID)._etag;
    await expect(correct({ declined: false }, { authorizedRequestId: mixedCaseRequest }))
      .resolves.toMatchObject({ success: true });
    expect(writes()[0].headers['If-Match']).toBe(version);
  });

  async function commitWinningChange(kind) {
    if (kind === 'complete') {
      await trusted(() => closeReview({
        suggestionId: ID, disposition: 'eligible', authorizedRequestId: REQUEST, actingUserSystemId: ACTOR,
      }));
    } else if (kind === 'withdrew' || kind === 'released') {
      await expect(trusted(() => transitionReviewersTerminal({
        requestId: REQUEST, suggestionIds: [ID], terminalStatus: kind, actingUserSystemId: ACTOR,
      }))).resolves.toMatchObject({ transitioned: 1 });
    } else {
      transport.patch(SET, ID, { _wmkf_request_value: OTHER, wmkf_notes: 'Authorized Request changed' });
    }
    return history();
  }

  test.each(['before_service_read', 'before_adapter_read', 'before_patch'].flatMap((window) =>
    ['complete', 'withdrew', 'released', 'reparent'].map((winner) => [window, winner])))(
    'F3 regression: %s / %s preserves the complete winning row with no correction retry, token or person effects',
    async (window, winnerKind) => {
      seedCorrection(winnerKind === 'complete' ? {
        wmkf_reviewstatus: REVIEW_STATUS_MAP.review_received, wmkf_reviewreceivedat: RECEIVED,
      } : {});
      const originalVersion = transport.get(SET, ID)._etag;
      const pause = transport.pauseNext((request) => {
        if (request.entitySet !== SET || request.key !== ID) return false;
        if (window === 'before_patch') return request.method === 'PATCH';
        if (request.method !== 'GET') return false;
        return window === 'before_service_read'
          || !request.params.get('$select')?.split(',').includes('_wmkf_request_value');
      });
      const outcome = correct(MIXED_CORRECTION).then((value) => ({ value }), (error) => ({ error }));
      const paused = await pause.reached;
      let winner;
      try { winner = await commitWinningChange(winnerKind); } finally { pause.release(); }
      const { error } = await outcome;
      const patchExpected = window === 'before_patch'
        || (window === 'before_adapter_read' && winnerKind === 'reparent');
      const code = patchExpected ? 'correction_conflict'
        : winnerKind === 'reparent' ? 'correction_request_changed' : 'correction_closed';
      expect(error).toMatchObject({ httpStatus: 409, body: { code } });
      assertHistoryUnchanged(winner);
      expect(writes().filter((request) => request.entitySet === PEOPLE)).toEqual([]);
      expect(correctionWrites()).toHaveLength(patchExpected ? 1 : 0);
      if (patchExpected) {
        const rejected = correctionWrites()[0];
        expect(rejected.status).toBe(412);
        expect(rejected.headers['If-Match']).toBe(originalVersion);
        expect(rejected.headers['If-Match']).not.toBe(winner.suggestion._etag);
      }
      if (window === 'before_patch') expect(paused).toBe(correctionWrites()[0]);
    },
  );

  test('F3 regression: a nonterminal concurrent edit cannot upgrade the version captured by the service', async () => {
    seedCorrection();
    const originalVersion = transport.get(SET, ID)._etag;
    const pause = transport.pauseNext((request) => request.method === 'GET'
      && request.entitySet === SET && request.key === ID, { stage: 'after' });
    const outcome = correct(MIXED_CORRECTION).then((value) => ({ value }), (error) => ({ error }));
    await pause.reached;
    transport.patch(SET, ID, { wmkf_notes: 'Another staff edit wins' });
    const winner = history();
    pause.release();
    expect((await outcome).error).toMatchObject({ httpStatus: 409, body: { code: 'correction_conflict' } });
    expect(correctionWrites()).toHaveLength(1);
    expect(correctionWrites()[0]).toMatchObject({ status: 412, headers: { 'If-Match': originalVersion } });
    assertHistoryUnchanged(winner);
  });

  test('F3 regression: direct protected adapter writes use the guard version when the caller omits one', async () => {
    seedCorrection({ wmkf_reviewstatus: null, wmkf_accepted: false, wmkf_selected: false });
    const before = transport.get(SET, ID);
    await trusted(() => suggestionAdapter.updateLifecycle(ID, {
      responseType: 'withdrawn_sufficient', withdrawnSufficientAt: COMPLETED, respondReminderSentAt: null,
    }, { actingUserSystemId: ACTOR }));
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ headers: { 'If-Match': before._etag, MSCRMCallerID: ACTOR }, body: {
      wmkf_responsetype: RESPONSE_TYPE_MAP.withdrawn_sufficient,
      wmkf_withdrawnsufficientat: COMPLETED, wmkf_respondremindersentat: null,
    } });
  });

  test('F3 regression: an explicitly stale direct adapter version is never replaced by its newer guard read', async () => {
    seedCorrection();
    const stale = transport.get(SET, ID)._etag;
    transport.patch(SET, ID, { wmkf_notes: 'Newer version must survive' });
    const winner = history();
    await expect(trusted(() => suggestionAdapter.updateLifecycle(ID, { accepted: false }, { ifMatch: stale })))
      .rejects.toMatchObject({ status: 412 });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({ status: 412, headers: { 'If-Match': stale } });
    assertHistoryUnchanged(winner);
  });

  test.each(['complete', 'withdrew', 'released'])('the same adapter rejects a status-changing correction out of %s', async (status) => {
    transport.seed(SET, row({ wmkf_reviewstatus: REVIEW_STATUS_MAP[status] }));
    await expect(trusted(() => patchReviewers({ suggestionId: ID, lifecycle: { reviewStatus: 'under_review' } })))
      .rejects.toMatchObject({
        cause: expect.objectContaining({ message: expect.stringContaining('closed review status') }),
        savedIds: [], failedIds: [ID], notAttemptedIds: [],
      });
    expect(writes()).toEqual([]);
    expect(transport.get(SET, ID).wmkf_reviewstatus).toBe(REVIEW_STATUS_MAP[status]);
  });

});

describe('F5 Stage 6A route, real authorization and persisted status outcomes', () => {
  const ACTOR = '77777777-7777-4777-8777-777777777777';
  const CASE_ID = 'abcdef12-abcd-4abc-8abc-abcdefabcdef';
  const ids = [ID, OTHER, THIRD];
  let impersonationBefore;

  beforeEach(() => {
    impersonationBefore = process.env.DYNAMICS_IMPERSONATION_ENABLED;
    process.env.DYNAMICS_IMPERSONATION_ENABLED = 'true';
    requireAppAccess.mockResolvedValue({
      profileId: 7, session: { user: { dynamicsSystemuserId: ACTOR } },
    });
    getUserRole.mockResolvedValue('read_write');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    transport.patch(REQUESTS, REQUEST, { _wmkf_programdirector_value: ACTOR });
  });
  afterEach(() => {
    if (impersonationBefore === undefined) delete process.env.DYNAMICS_IMPERSONATION_ENABLED;
    else process.env.DYNAMICS_IMPERSONATION_ENABLED = impersonationBefore;
  });

  function seedTargets(targets = ids) {
    targets.forEach(id => transport.seed(SET, row({ wmkf_appreviewersuggestionid: id })));
    return new Map(targets.map(id => [id, transport.get(SET, id)]));
  }

  async function patchThroughRoute(body) {
    const res = { status: jest.fn(), json: jest.fn() };
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    await reviewersHandler({ method: 'PATCH', body, query: {}, headers: {} }, res);
    expect(res.status).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledTimes(1);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'review-manager', 'reviewers');
    expect(getUserRole).toHaveBeenCalledWith(7);
    return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0] };
  }

  const guardReads = () => transport.requests.filter(request => request.method === 'GET'
    && request.entitySet === SET && request.key !== null);
  const patchCalls = () => global.fetch.mock.calls.filter(([url, options]) => options?.method === 'PATCH'
    && new URL(url).pathname.startsWith(`/api/data/v9.2/${SET}(`));
  const callId = ([url]) => new URL(url).pathname.match(/\(([^)]+)\)$/)[1];

  function assertPatchBindings(before) {
    for (const call of patchCalls()) {
      const [url, options] = call;
      const id = callId(call);
      expect(new URL(url).origin).toBe('https://reviewer-harness.invalid');
      expect(JSON.parse(options.body)).toEqual({ wmkf_reviewstatus: REVIEW_STATUS_MAP.under_review });
      expect(options.headers).toMatchObject({ 'If-Match': before.get(id)._etag, MSCRMCallerID: ACTOR });
    }
    expect(writes().every(request => request.entitySet === SET)).toBe(true);
    expect(email).not.toHaveBeenCalled();
    expect(ensureToken).not.toHaveBeenCalled();
  }

  function assertPersisted(before, savedIds, racedId) {
    for (const [id, initial] of before) {
      const current = transport.get(SET, id);
      expect({ ...current, _etag: initial._etag }).toEqual({
        ...initial,
        wmkf_reviewstatus: savedIds.includes(id) ? REVIEW_STATUS_MAP.under_review : initial.wmkf_reviewstatus,
        ...(id === racedId ? { wmkf_notes: 'Concurrent writer wins before conditional PATCH' } : {}),
      });
      if (savedIds.includes(id) || id === racedId) expect(current._etag).not.toBe(initial._etag);
      else expect(current._etag).toBe(initial._etag);
    }
  }

  function assertAuthorizedBeforeWrites(targets) {
    const authorizations = transport.requests.filter(request => request.method === 'GET' && request.key === null);
    expect(authorizations.map(request => request.entitySet)).toEqual([SET, REQUESTS]);
    expect(authorizations[0].params.get('$select')).toBe('wmkf_appreviewersuggestionid,_wmkf_request_value');
    for (const id of targets) expect(authorizations[0].params.get('$filter')).toContain(`wmkf_appreviewersuggestionid eq ${id}`);
    expect(authorizations[1].params.get('$select')).toBe('akoya_requestid,_wmkf_programdirector_value');
    expect(transport.requests.indexOf(authorizations[1])).toBeLessThan(transport.requests.indexOf(guardReads()[0]));
  }

  test.each(['single', 'batch'])('F5 regression: %s confirms exact saved identities through real HTTP writes', async form => {
    const targets = form === 'single' ? [ID] : ids;
    const before = seedTargets(targets);
    const result = await patchThroughRoute({
      ...(form === 'single' ? { suggestionId: ID } : { suggestionIds: ids }),
      reviewStatus: 'under_review', actingUserSystemId: THIRD,
    });
    expect(result).toEqual({ status: 200, body: {
      success: true, message: form === 'single' ? 'Reviewer updated' : 'Updated 3 reviewers',
      savedIds: targets, failedIds: [], notAttemptedIds: [],
    } });
    expect(patchCalls().map(callId)).toEqual(targets);
    expect(guardReads().map(request => request.key)).toEqual(targets);
    expect(writes().map(request => request.status)).toEqual(targets.map(() => 204));
    assertAuthorizedBeforeWrites(targets);
    assertPatchBindings(before);
    assertPersisted(before, targets);
  });

  test.each(['excluded', 'read_failure', '412', 'transport_before_commit', 'commit_then_response_loss']
    .flatMap(kind => [0, 1, 2].map(index => [kind, index])))(
    'F5 regression: %s at index %i reports confirmed prefix, uncertain attempt and untouched suffix',
    async (kind, failureIndex) => {
      const failedId = ids[failureIndex];
      if (kind === 'excluded') {
        seedTargets();
        transport.patch(SET, failedId, { wmkf_applicantdisposition: 100000001 });
      } else seedTargets();
      const before = new Map(ids.map(id => [id, transport.get(SET, id)]));
      const injected = new Error(`Stage6A intentional ${kind}`);
      if (['read_failure', 'transport_before_commit', 'commit_then_response_loss'].includes(kind)) {
        global.fetch.mockImplementation(async (url, options = {}) => {
          const method = options.method || 'GET';
          const matches = new URL(url).pathname === `/api/data/v9.2/${SET}(${failedId})`;
          if (matches && method === 'PATCH' && kind === 'transport_before_commit') {
            // No server receives this request. Its real write-core payload and
            // actor/If-Match headers are checked below through fetch.mock.calls.
            expectedFetchRejections.push(injected);
            throw injected;
          }
          const response = await transport.fetch(url, options);
          if (matches && method === 'GET' && kind === 'read_failure') {
            transport.requests.at(-1).status = 503;
            return { ...response, ok: false, status: 503,
              text: async () => JSON.stringify({ error: { message: injected.message } }) };
          }
          if (matches && method === 'PATCH' && kind === 'commit_then_response_loss') {
            expect(response.status).toBe(204);
            expectedFetchRejections.push(injected);
            throw injected;
          }
          return response;
        });
      }
      const pause = kind === '412' ? transport.pauseNext(request => request.method === 'PATCH'
        && request.entitySet === SET && request.key === failedId) : null;
      const pendingResult = patchThroughRoute({ suggestionIds: ids, reviewStatus: 'under_review' });
      if (pause) {
        await pause.reached;
        transport.patch(SET, failedId, { wmkf_notes: 'Concurrent writer wins before conditional PATCH' });
        pause.release();
      }
      const result = await pendingResult;
      expect(result).toEqual({ status: 500, body: {
        error: 'Failed to update reviewer', details: undefined, timestamp: expect.any(String),
        success: false, savedIds: ids.slice(0, failureIndex), failedIds: [failedId],
        notAttemptedIds: ids.slice(failureIndex + 1),
      } });
      const attempts = ids.slice(0, failureIndex + (['excluded', 'read_failure'].includes(kind) ? 0 : 1));
      expect(patchCalls().map(callId)).toEqual(attempts);
      // Whole-batch ownership reads intentionally precede all mutations. This
      // asserts no later mutation guard-read, rather than forbidding preauth.
      expect(guardReads().map(request => request.key)).toEqual(ids.slice(0, failureIndex + 1));
      expect(writes().map(request => request.key)).toEqual(kind === 'transport_before_commit'
        ? ids.slice(0, failureIndex) : attempts);
      if (kind === '412') expect(writes().at(-1)).toMatchObject({ key: failedId, status: 412,
        headers: { 'If-Match': before.get(failedId)._etag } });
      const committed = ids.slice(0, failureIndex + (kind === 'commit_then_response_loss' ? 1 : 0));
      assertAuthorizedBeforeWrites(ids);
      assertPatchBindings(before);
      assertPersisted(before, committed, kind === '412' ? failedId : undefined);
    },
  );

  test.each([false, true])('F5 regression: trim/case duplicates run once in first-occurrence order (failure=%s)', async failing => {
    const targets = [CASE_ID, OTHER, THIRD];
    seedTargets(targets);
    if (failing) transport.patch(SET, OTHER, { wmkf_applicantdisposition: 100000001 });
    const before = new Map(targets.map(id => [id, transport.get(SET, id)]));
    const result = await patchThroughRoute({
      suggestionIds: [` ${CASE_ID.toUpperCase()} `, OTHER, CASE_ID, THIRD, ` ${OTHER} `],
      reviewStatus: 'under_review',
    });
    expect(result.status).toBe(failing ? 500 : 200);
    expect(result.body).toMatchObject({ success: !failing,
      savedIds: failing ? [CASE_ID] : targets,
      failedIds: failing ? [OTHER] : [], notAttemptedIds: failing ? [THIRD] : [],
    });
    if (!failing) expect(result.body.message).toBe('Updated 3 reviewers');
    expect(patchCalls().map(callId)).toEqual(failing ? [CASE_ID] : targets);
    expect(guardReads().map(request => request.key)).toEqual(failing ? [CASE_ID, OTHER] : targets);
    assertAuthorizedBeforeWrites(targets);
    assertPatchBindings(before);
    assertPersisted(before, failing ? [CASE_ID] : targets);
  });

  test.each([
    ['foreign', 403, 'Only the lead Program Director (or a superuser) can manage reviewer activity for this request.'],
    ['missing_suggestion', 404, 'Reviewer suggestion was not found.'],
    ['missing_request', 404, 'Request was not found.'],
    ['suggestion_read_error', 502, 'Reviewer ownership could not be verified.'],
    ['request_read_error', 502, 'Request ownership could not be verified.'],
  ])('F5 regression: real whole-batch authorization rejects later %s before any lifecycle read/write', async (kind, status, error) => {
    seedTargets(kind === 'missing_suggestion' ? [ID] : [ID, OTHER]);
    if (kind !== 'missing_suggestion') transport.patch(SET, OTHER, { _wmkf_request_value: HONORARIUM });
    if (kind !== 'missing_request') transport.seed(REQUESTS, {
      akoya_requestid: HONORARIUM,
      _wmkf_programdirector_value: kind === 'foreign' ? THIRD : ACTOR,
    });
    if (kind.endsWith('read_error')) {
      const targetSet = kind === 'suggestion_read_error' ? SET : REQUESTS;
      global.fetch.mockImplementation(async (url, options = {}) => {
        const response = await transport.fetch(url, options);
        if (new URL(url).pathname === `/api/data/v9.2/${targetSet}`) {
          transport.requests.at(-1).status = 503;
          return { ...response, ok: false, status: 503,
            text: async () => JSON.stringify({ error: { message: 'Intentional ownership-read outage' } }) };
        }
        return response;
      });
    }
    const before = transport.rows(SET);
    const requestBefore = transport.rows(REQUESTS);
    expect(await patchThroughRoute({ suggestionIds: [ID, OTHER], reviewStatus: 'under_review' }))
      .toEqual({ status, body: { error } });
    expect(guardReads()).toEqual([]);
    expect(patchCalls()).toEqual([]);
    expect(writes()).toEqual([]);
    expect(transport.rows(SET)).toEqual(before);
    expect(transport.rows(REQUESTS)).toEqual(requestBefore);
    const authRead = transport.requests[0];
    expect(authRead).toMatchObject({ method: 'GET', entitySet: SET, key: null });
    expect(authRead.params.get('$filter')).toBe(`wmkf_appreviewersuggestionid eq ${ID} or wmkf_appreviewersuggestionid eq ${OTHER}`);
    expect(email).not.toHaveBeenCalled();
    expect(ensureToken).not.toHaveBeenCalled();
  });
});
