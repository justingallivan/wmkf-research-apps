/**
 * @jest-environment node
 *
 * Composed reviewer races: Stage 1A expiry and Stage 1B email regressions plus
 * the remaining Stage 0 characterizations. Services, adapters, DAL context,
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
import { closeReview } from '../../lib/services/review-manager/close-review-service';
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
