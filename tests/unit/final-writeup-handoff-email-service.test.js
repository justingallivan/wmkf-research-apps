/**
 * @jest-environment node
 *
 * Group-review handoff email (Stage 4): program gate, intent staged before the
 * transition and only while the request has no Final, delivery only after the
 * transition is confirmed from this draft, at most one email per draft,
 * recipients without the lead, retryable lookup outages, TEST-request refusal,
 * and never throwing to the route.
 */

import {
  AWAITING_TRANSITION_DAYS,
  deliverGroupReviewHandoff,
  deliverHandoffEmail,
  handoffCorrelationKey,
  recoverPendingHandoffEmails,
  renderHandoffEmail,
  stageGroupReviewHandoff,
} from '../../lib/services/final-writeup/handoff-email-service.js';
import {
  isHandoffEmailEnabledForProgram,
  readHandoffEmailProgramIds,
} from '../../lib/services/final-writeup/handoff-email-config.js';
import { REQUEST_DOCUMENT_LIFECYCLE_STATE } from '../../shared/config/requestDocument.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SOURCE_ID = '22222222-2222-4222-8222-222222222221';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';
const RESEARCH_ID = '33333333-3333-4333-8333-333333333333';
const SOCAL_ID = '33333333-3333-4333-8333-333333333334';
const LEAD_ID = '44444444-4444-4444-8444-444444444441';
const BEA_ID = '44444444-4444-4444-8444-444444444442';
const CY_ID = '44444444-4444-4444-8444-444444444443';
const EMAIL_ID = '55555555-5555-4555-8555-555555555555';
const REBUILT_EMAIL_ID = '55555555-5555-4555-8555-555555555556';
// An activity that already exists before the test (a stored draft or orphan).
const PRIOR_ID = '55555555-5555-4555-8555-555555555550';
const CREATED_IDS = [EMAIL_ID, REBUILT_EMAIL_ID, '55555555-5555-4555-8555-555555555557'];
const NOW = new Date('2026-10-07T20:00:00Z');

function request(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1003010',
    akoya_title: 'Quantum <Widgets>',
    _akoya_applicantid_value_formatted: 'Example University',
    _wmkf_programdirector_value: LEAD_ID,
    _wmkf_programdirector_value_formatted: 'Lee Lead',
    _wmkf_grantprogram_value: RESEARCH_ID,
    _wmkf_currentpresitevisit_value: SOURCE_ID,
    _wmkf_currentfinalwriteup_value: FINAL_ID,
    ...overrides,
  };
}

function finalDocument(overrides = {}) {
  return {
    wmkf_requestdocumentid: FINAL_ID,
    _wmkf_sourcedocument_value: SOURCE_ID,
    wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.REVIEW,
    ...overrides,
  };
}

function pendingRow(overrides = {}) {
  return {
    source_document_id: SOURCE_ID,
    final_document_id: null,
    request_id: REQUEST_ID,
    grant_program_id: RESEARCH_ID,
    lead_systemuser_id: LEAD_ID,
    state: 'pending',
    dynamics_email_id: null,
    recipient_generation: 0,
    attempt_count: 1,
    created_at: '2026-10-07T19:00:00Z',
    locked: false,
    ...overrides,
  };
}

function harness({
  requestRow = request(),
  documentRow = finalDocument(),
  enabledPrograms = [RESEARCH_ID],
  audience = {
    status: 'configured',
    programDirectors: [
      { reviewerId: BEA_ID, name: 'Bea Director' },
      { reviewerId: CY_ID, name: 'Cy Director' },
      { reviewerId: LEAD_ID, name: 'Lee Lead' },
    ],
  },
  users = {
    [BEA_ID]: { systemuserid: BEA_ID, internalemailaddress: 'bea@wmkeck.org', isdisabled: false },
    [CY_ID]: { systemuserid: CY_ID, internalemailaddress: 'cy@wmkeck.org', isdisabled: false },
    [LEAD_ID]: { systemuserid: LEAD_ID, internalemailaddress: 'lee@wmkeck.org', isdisabled: false },
  },
  copy = { subject: 'Ready: {{requestNumber}} {{institution}}', body: '{{leadProgramDirector}} handed off "{{requestTitle}}".' },
  existingRow = null,
  correlationMatches = [],
} = {}) {
  let row = existingRow ? { ...existingRow } : null;
  let tokenSeq = 0;
  let createdCount = 0;
  const owns = (token) => Boolean(row && row.state === 'pending' && row.locked && row.lease_token === token);
  const state = { requestRow, documentRow };
  const calls = [];
  const activities = new Map();
  const deps = {
    getRequest: jest.fn(async () => state.requestRow),
    getDocument: jest.fn(async () => state.documentRow),
    getSystemUser: jest.fn(async (id) => {
      const user = users[id];
      if (user instanceof Error) throw user;
      return user || null;
    }),
    resolveAudience: jest.fn(async () => audience),
    getSettingStrict: jest.fn(async (key) => {
      const value = key.endsWith('.subject') ? copy.subject : copy.body;
      return value === undefined ? { found: false } : { found: true, value };
    }),
    createEmailActivity: jest.fn(async (input) => {
      calls.push('create');
      const id = CREATED_IDS[createdCount];
      createdCount += 1;
      // Same shape as the adapter's expanded read: To parties are mask 2.
      activities.set(id, {
        activityid: id,
        statuscode: 1,
        input,
        email_activity_parties: input.to.map((addressused) => ({ participationtypemask: 2, addressused })),
      });
      return id;
    }),
    getEmailActivity: jest.fn(async (id) => activities.get(id) || null),
    // Generation 0 answers with the fixture's correlation matches; later
    // generations find only activities created under that key.
    findEmailByCorrelation: jest.fn(async (key) => (
      key === handoffCorrelationKey(SOURCE_ID)
        ? correlationMatches
        : [...activities.values()].filter((activity) => activity.input?.correlationKey === key)
    )),
    rebuild: jest.fn(async (_id, token) => {
      if (!owns(token)) return null;
      Object.assign(row, {
        recipient_generation: Number(row.recipient_generation || 0) + 1,
        dynamics_email_id: null,
        to_recipients: null,
      });
      return { ...row };
    }),
    notify: jest.fn(async () => ({ id: 'alert-1' })),
    sendEmail: jest.fn(async (id) => {
      calls.push('send');
      activities.set(id, { ...activities.get(id), statuscode: 3 });
    }),
    insertIntent: jest.fn(async (intent) => {
      // Mirrors the store: a pending row's wait restarts; a
      // transition_not_committed skip reopens; anything else is untouched.
      if (row) {
        if (row.state === 'pending'
          || (row.state === 'skipped' && row.skip_reason === 'transition_not_committed')) {
          Object.assign(row, { state: 'pending', skip_reason: null, created_at: NOW.toISOString() });
        }
        return { inserted: false };
      }
      row = pendingRow({
        source_document_id: intent.sourceDocumentId,
        request_id: intent.requestId,
        grant_program_id: intent.grantProgramId,
        lead_systemuser_id: intent.leadSystemUserId,
      });
      return { inserted: true };
    }),
    getRow: jest.fn(async () => (row ? { ...row } : null)),
    // Mirrors the store: a claim mints a token; every write needs the
    // current token and an unexpired lease (`expire()` simulates expiry).
    claim: jest.fn(async () => {
      if (!row || row.state !== 'pending' || row.locked) return null;
      tokenSeq += 1;
      row.locked = true;
      row.attempt_count = Number(row.attempt_count || 0) + 1;
      row.lease_token = `token-${tokenSeq}`;
      return { ...row };
    }),
    renew: jest.fn(async (_id, token) => (
      row && row.state === 'pending' && row.locked && row.lease_token === token ? { ...row } : null
    )),
    recordFinal: jest.fn(async (_id, finalId, token) => {
      if (owns(token)) row.final_document_id = finalId;
    }),
    recordActivity: jest.fn(async (_id, {
      emailId, toRecipients, grantProgramId, leadSystemUserId,
    }, token) => {
      if (!owns(token) || (row.dynamics_email_id && row.dynamics_email_id !== emailId)) return { recorded: false };
      calls.push('record');
      Object.assign(row, {
        dynamics_email_id: emailId,
        to_recipients: toRecipients,
        grant_program_id: grantProgramId,
        lead_systemuser_id: leadSystemUserId,
      });
      return { recorded: true };
    }),
    markSent: jest.fn(async (_id, emailId, token) => {
      if (owns(token)) Object.assign(row, { state: 'sent', locked: false, lease_token: null });
    }),
    markSkipped: jest.fn(async (_id, reason, token) => {
      if (owns(token)) Object.assign(row, { state: 'skipped', skip_reason: reason, locked: false, lease_token: null });
    }),
    // Mirrors the store: expire only the lease owner, against the row's
    // CURRENT created_at.
    expire: jest.fn(async (_id, token, days) => {
      const age = NOW.getTime() - new Date(row.created_at).getTime();
      if (!owns(token) || age <= days * 24 * 60 * 60 * 1000) return { expired: false };
      Object.assign(row, { state: 'skipped', skip_reason: 'transition_not_committed', locked: false, lease_token: null });
      return { expired: true };
    }),
    reopenExpired: jest.fn(async () => {
      if (row && row.state === 'skipped' && row.skip_reason === 'transition_not_committed') {
        Object.assign(row, { state: 'pending', skip_reason: null });
      }
    }),
    release: jest.fn(async (_id, token) => {
      if (owns(token)) Object.assign(row, { locked: false, lease_token: null });
    }),
    recordFailure: jest.fn(async (_id, code, token) => {
      if (owns(token)) Object.assign(row, { last_error_code: code, locked: false, lease_token: null });
    }),
    listPending: jest.fn(async () => (row && row.state === 'pending' && !row.locked ? [{ ...row }] : [])),
    programEnabled: (id) => enabledPrograms.includes(String(id).toLowerCase()),
    anyProgramEnabled: () => enabledPrograms.length > 0,
    sender: () => 'alerts@wmkeck.org',
    baseUrl: () => 'https://apps.example.org',
  };
  const expire = () => { row.locked = false; };
  return { deps, calls, state, getRow: () => row, activities, expire };
}

const quiet = () => jest.spyOn(console, 'error').mockImplementation(() => {});

describe('program list', () => {
  test('reads a JSON list of GUIDs, lowercased; anything else means none', () => {
    expect(readHandoffEmailProgramIds({})).toEqual([]);
    expect(readHandoffEmailProgramIds({ FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS: 'not json' })).toEqual([]);
    expect(readHandoffEmailProgramIds({ FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS: '"x"' })).toEqual([]);
    expect(readHandoffEmailProgramIds({
      FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS: JSON.stringify([RESEARCH_ID.toUpperCase(), 'research', RESEARCH_ID]),
    })).toEqual([RESEARCH_ID]);
    const env = { FINAL_WRITEUP_HANDOFF_EMAIL_PROGRAM_IDS: JSON.stringify([RESEARCH_ID]) };
    expect(isHandoffEmailEnabledForProgram(RESEARCH_ID, env)).toBe(true);
    expect(isHandoffEmailEnabledForProgram(SOCAL_ID, env)).toBe(false);
    expect(isHandoffEmailEnabledForProgram(null, env)).toBe(false);
  });
});

describe('stageGroupReviewHandoff', () => {
  const stage = (overrides = {}) => ({
    requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID, isSuperuser: false, ...overrides,
  });

  test('stages the intent for the draft while the request has no Final', async () => {
    const { deps } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'staged' });
    expect(deps.insertIntent).toHaveBeenCalledWith({
      sourceDocumentId: SOURCE_ID, requestId: REQUEST_ID, grantProgramId: RESEARCH_ID, leadSystemUserId: LEAD_ID,
    });
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'already_staged' });
  });

  test('a request already in group review gets no intent (pre-ship writeups stay silent)', async () => {
    const { deps } = harness();
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'already_in_review' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
  });

  test('a configured program that is not listed gets no intent', async () => {
    // SoCal has a staffing entry and recipients, so only the program gate stops it.
    const { deps } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null, _wmkf_grantprogram_value: SOCAL_ID }),
    });
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'not_enabled' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
  });

  test('a superuser who is not the lead may stage', async () => {
    const { deps } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    expect(await stageGroupReviewHandoff(stage({ actingUserSystemId: BEA_ID, isSuperuser: true }), deps))
      .toEqual({ status: 'staged' });
  });

  test('someone who is neither the lead nor a superuser cannot stage', async () => {
    const { deps } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    expect(await stageGroupReviewHandoff(stage({ actingUserSystemId: BEA_ID }), deps)).toEqual({ status: 'not_authorized' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
  });

  test("another request's draft cannot be staged, so the real handoff still emails", async () => {
    const OTHER_DRAFT = '22222222-2222-4222-8222-222222222229';
    const { deps, getRow } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    // A mismatched request/draft pair is refused without a row...
    expect(await stageGroupReviewHandoff(stage({ sourceDocumentId: OTHER_DRAFT }), deps)).toEqual({ status: 'not_current_draft' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
    expect(getRow()).toBeNull();
    // ...and the legitimate handoff for the request's own draft stages normally.
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'staged' });
    expect(getRow()).toMatchObject({ source_document_id: SOURCE_ID, request_id: REQUEST_ID });
  });

  test('a request read failure while a program is listed reports failed so the route refuses', async () => {
    const { deps } = harness();
    deps.getRequest.mockRejectedValue(new Error('dataverse down'));
    const spy = quiet();
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({
      status: 'failed', code: 'handoff_email_request_read_failed',
    });
    spy.mockRestore();
  });

  test('with no program listed nothing is read and nothing can block', async () => {
    const { deps } = harness({ enabledPrograms: [] });
    deps.getRequest.mockRejectedValue(new Error('dataverse down'));
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'not_enabled' });
    expect(deps.getRequest).not.toHaveBeenCalled();
  });

  test('a persistence failure for a listed program reports failed so the route can refuse', async () => {
    const { deps } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    deps.insertIntent.mockRejectedValue(new Error('postgres down'));
    const spy = quiet();
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'failed', code: 'handoff_email_stage_failed' });
    spy.mockRestore();
  });
});

describe('delivery', () => {
  test('a confirmed transition emails the other PDs regarding the request, activity recorded before send', async () => {
    const { deps, calls, getRow } = harness({ existingRow: pendingRow() });
    expect(await deliverGroupReviewHandoff({ sourceDocumentId: SOURCE_ID }, deps)).toEqual({ status: 'sent' });
    const input = deps.createEmailActivity.mock.calls[0][0];
    expect(input).toMatchObject({
      to: ['bea@wmkeck.org', 'cy@wmkeck.org'],
      from: 'alerts@wmkeck.org',
      regardingId: REQUEST_ID,
      regardingType: 'akoya_request',
      correlationKey: handoffCorrelationKey(SOURCE_ID),
      subject: 'Ready: 1003010 Example University',
    });
    expect(input.to).not.toContain('lee@wmkeck.org');
    expect(input.body).toContain('Quantum &lt;Widgets&gt;');
    expect(input.body).toContain(`https://apps.example.org/workbench/${REQUEST_ID}?tab=final-writeup&amp;n=1003010`);
    expect(calls).toEqual(['create', 'record', 'send']);
    expect(getRow()).toMatchObject({ state: 'sent', final_document_id: FINAL_ID });
  });

  test('a lost commit response: the staged intent waits, then a retry sends it', async () => {
    const { deps, state, getRow } = harness({ requestRow: request({ _wmkf_currentfinalwriteup_value: null }) });
    await stageGroupReviewHandoff({
      requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID,
    }, deps);
    // The transition committed, but this call saw no Final yet.
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'awaiting_transition' });
    expect(deps.release).toHaveBeenCalled();
    expect(getRow()).toMatchObject({ state: 'pending', locked: false });
    expect(getRow().last_error_code).toBeUndefined();
    state.requestRow = request();
    // A retry POST (reused) or recovery now finds the committed Final.
    expect(await deliverGroupReviewHandoff({ sourceDocumentId: SOURCE_ID }, deps)).toEqual({ status: 'sent' });
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
  });

  test('a transport failure, then the writeup moves to leadership: recovery does not send the stale email', async () => {
    const { deps, state, getRow } = harness({ existingRow: pendingRow() });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'dynamics_send_failed' });
    spy.mockRestore();
    state.documentRow = finalDocument({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([
      { sourceDocumentId: SOURCE_ID, status: 'skipped', reason: 'no_longer_in_group_review' },
    ]);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(getRow().state).toBe('skipped');
  });

  test('an expired intent is reopened by a later valid handoff, which then emails', async () => {
    const { deps, state, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ created_at: '2026-09-20T00:00:00Z' }),
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason: 'transition_not_committed' });
    const stageArgs = { requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID };
    expect(await stageGroupReviewHandoff(stageArgs, deps)).toEqual({ status: 'already_staged' });
    expect(getRow()).toMatchObject({ state: 'pending' });
    state.requestRow = request();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
  });

  test('an aged intent is not expired by recovery while its retried handoff commits', async () => {
    const { deps, state, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ created_at: '2026-09-20T00:00:00Z' }),
    });
    // The lead PD retries: staging restarts the 14-day wait...
    await stageGroupReviewHandoff({ requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID }, deps);
    // ...so recovery running before the commit leaves it waiting.
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'awaiting_transition' }]);
    state.requestRow = request();
    expect(await deliverGroupReviewHandoff({ sourceDocumentId: SOURCE_ID }, deps)).toEqual({ status: 'sent' });
    expect(getRow().state).toBe('sent');
  });

  test('a stale recovery worker cannot expire an intent a concurrent retry refreshed and committed', async () => {
    const { deps, state, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ created_at: '2026-09-20T00:00:00Z' }),
    });
    const stageArgs = { requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID };
    let postDelivery;
    deps.getRequest.mockImplementationOnce(async () => {
      // Recovery has claimed the aged row and read "no Final"...
      const snapshot = request({ _wmkf_currentfinalwriteup_value: null });
      // ...while the lead PD's retry refreshes the intent and commits.
      await stageGroupReviewHandoff(stageArgs, deps);
      state.requestRow = request();
      postDelivery = await deliverGroupReviewHandoff({ sourceDocumentId: SOURCE_ID }, deps);
      return snapshot;
    });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'awaiting_transition' }]);
    expect(postDelivery).toEqual({ status: 'not_claimed' });
    expect(getRow().state).toBe('pending');
    // The next recovery run sends it.
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
  });

  test('an intent already expired by recovery is reopened when its transition then commits', async () => {
    const { deps, state, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ created_at: '2026-09-20T00:00:00Z' }),
    });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([
      { sourceDocumentId: SOURCE_ID, status: 'skipped', reason: 'transition_not_committed' },
    ]);
    state.requestRow = request();
    expect(await deliverGroupReviewHandoff({ sourceDocumentId: SOURCE_ID }, deps)).toEqual({ status: 'sent' });
    expect(getRow().state).toBe('sent');
  });

  test('a sent intent is never reopened by staging', async () => {
    const { deps, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ state: 'sent', dynamics_email_id: EMAIL_ID }),
    });
    const stageArgs = { requestId: REQUEST_ID, sourceDocumentId: SOURCE_ID, actingUserSystemId: LEAD_ID };
    expect(await stageGroupReviewHandoff(stageArgs, deps)).toEqual({ status: 'already_staged' });
    expect(getRow().state).toBe('sent');
  });

  test('an email already accepted is recorded as sent even if its program was later removed', async () => {
    const { deps, activities, getRow } = harness({ existingRow: pendingRow({ dynamics_email_id: EMAIL_ID }), enabledPrograms: [] });
    activities.set(EMAIL_ID, { activityid: EMAIL_ID, statuscode: 3 });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(getRow().state).toBe('sent');
    expect(deps.getRequest).not.toHaveBeenCalled();
  });

  test('recovery sends a pending intent whose transition committed', async () => {
    const { deps } = harness({ existingRow: pendingRow() });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
  });

  test(`an intent whose transition never commits is skipped after ${AWAITING_TRANSITION_DAYS} days`, async () => {
    const { deps, getRow } = harness({
      requestRow: request({ _wmkf_currentfinalwriteup_value: null }),
      existingRow: pendingRow({ created_at: '2026-09-20T00:00:00Z' }),
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason: 'transition_not_committed' });
    expect(getRow().state).toBe('skipped');
  });

  test('a repeat delivery never resends', async () => {
    const { deps } = harness({ existingRow: pendingRow() });
    await deliverHandoffEmail(SOURCE_ID, deps);
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'not_claimed' });
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  test('a worker whose lease expired and was taken over neither creates nor sends a second email', async () => {
    const { deps, expire, getRow } = harness({ existingRow: pendingRow() });
    let resumeA;
    const stalled = new Promise((resolve) => { resumeA = resolve; });
    const realLookup = deps.getSystemUser.getMockImplementation();
    deps.getSystemUser.mockImplementationOnce(async (id) => { await stalled; return realLookup(id); });
    // Worker A claims and stalls in its first recipient lookup.
    const workerA = deliverHandoffEmail(SOURCE_ID, deps);
    await new Promise((resolve) => setImmediate(resolve));
    // A's lease expires; worker B claims, creates and sends.
    expire();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    // A resumes and must stop at its fence.
    resumeA();
    expect(await workerA).toEqual({ status: 'lease_lost' });
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(getRow().state).toBe('sent');
  });

  test('a lease lost between create and record does not send the extra activity', async () => {
    const { deps, expire } = harness({ existingRow: pendingRow() });
    deps.createEmailActivity.mockImplementationOnce(async (input) => {
      expire();
      await deliverHandoffEmail(SOURCE_ID, deps); // B takes over (finds nothing, creates its own)
      return '77777777-7777-4777-8777-777777777777';
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'lease_lost' });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  test('a program reassigned after staging is checked as it is now: no email for an unlisted program', async () => {
    const { deps } = harness({
      existingRow: pendingRow(),
      requestRow: request({ _wmkf_grantprogram_value: SOCAL_ID }),
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason: 'program_not_enabled' });
    expect(deps.resolveAudience).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('a reassignment between listed programs uses the current audience and lead', async () => {
    const { deps } = harness({
      existingRow: pendingRow(),
      enabledPrograms: [RESEARCH_ID, SOCAL_ID],
      requestRow: request({ _wmkf_grantprogram_value: SOCAL_ID, _wmkf_programdirector_value: BEA_ID }),
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.resolveAudience).toHaveBeenCalledWith(SOCAL_ID);
    // Bea is now the lead, so she is excluded; Lee is no longer the lead, so he is included.
    expect(deps.createEmailActivity.mock.calls[0][0].to).toEqual(['cy@wmkeck.org', 'lee@wmkeck.org']);
  });

  test.each([
    ['program', { requestRow: request({ _wmkf_grantprogram_value: SOCAL_ID }), audience: { status: 'configured', programDirectors: [{ reviewerId: CY_ID, name: 'Cy Director' }] } }],
    ['lead', { requestRow: request({ _wmkf_programdirector_value: BEA_ID }) }],
  ])('a stored unsent draft built before the %s changed is abandoned, and a fresh email goes to the current recipients', async (_label, change) => {
    const { deps, activities } = harness({
      existingRow: pendingRow({ dynamics_email_id: PRIOR_ID }),
      enabledPrograms: [RESEARCH_ID, SOCAL_ID],
      ...change,
    });
    // Built for the original lead and program: Bea and Cy.
    activities.set(PRIOR_ID, {
      activityid: PRIOR_ID,
      statuscode: 1,
      email_activity_parties: ['bea@wmkeck.org', 'cy@wmkeck.org'].map((addressused) => ({ participationtypemask: 2, addressused })),
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    // The stale draft is never sent; the fresh one has its own correlation key.
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).not.toHaveBeenCalledWith(PRIOR_ID);
    const fresh = deps.createEmailActivity.mock.calls[0][0];
    expect(fresh.correlationKey).toBe(handoffCorrelationKey(SOURCE_ID, 1));
    expect(fresh.to).not.toEqual(['bea@wmkeck.org', 'cy@wmkeck.org']);
  });

  test('lead reassigned before delivery, then a transport failure: recovery sends the draft once', async () => {
    const { deps, getRow } = harness({
      existingRow: pendingRow(),
      requestRow: request({ _wmkf_programdirector_value: BEA_ID }),
    });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'dynamics_send_failed' });
    spy.mockRestore();
    // The draft was built for the current lead, and the ledger says so.
    expect(getRow()).toMatchObject({ lead_systemuser_id: BEA_ID, grant_program_id: RESEARCH_ID });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(2);
  });

  test.each([
    ['a PD was removed from the program audience', {
      audience: { status: 'configured', programDirectors: [{ reviewerId: BEA_ID, name: 'Bea Director' }] },
      expectedTo: ['bea@wmkeck.org'],
    }],
    ['a PD account was disabled', { users: {
      [BEA_ID]: { systemuserid: BEA_ID, internalemailaddress: 'bea@wmkeck.org', isdisabled: false },
      [CY_ID]: { systemuserid: CY_ID, internalemailaddress: 'cy@wmkeck.org', isdisabled: true },
    }, expectedTo: ['bea@wmkeck.org'] }],
    ['a PD address changed', { users: {
      [BEA_ID]: { systemuserid: BEA_ID, internalemailaddress: 'bea@wmkeck.org', isdisabled: false },
      [CY_ID]: { systemuserid: CY_ID, internalemailaddress: 'cy.new@wmkeck.org', isdisabled: false },
    }, expectedTo: ['bea@wmkeck.org', 'cy.new@wmkeck.org'] }],
  ])('a recorded draft whose send failed is not resent after %s; a fresh email goes to the current recipients', async (_label, later) => {
    const { deps, getRow } = harness({ existingRow: pendingRow() });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'dynamics_send_failed' });
    spy.mockRestore();
    if (later.audience) deps.resolveAudience.mockResolvedValue(later.audience);
    if (later.users) deps.getSystemUser.mockImplementation(async (id) => later.users[id] || null);
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
    // The first draft (old recipients) was only attempted once and never resent.
    expect(deps.sendEmail.mock.calls.map(([id]) => id)).toEqual([EMAIL_ID, REBUILT_EMAIL_ID]);
    expect(getRow()).toMatchObject({ state: 'sent', recipient_generation: 1 });
    expect(deps.createEmailActivity.mock.calls[1][0].to).toEqual(later.expectedTo);
  });

  test('a recorded draft is not resent when the recipient lookup fails (fail closed, retryable)', async () => {
    const { deps, getRow } = harness({ existingRow: pendingRow() });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    await deliverHandoffEmail(SOURCE_ID, deps);
    deps.getSystemUser.mockRejectedValue(Object.assign(new Error('throttled'), { status: 429 }));
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'handoff_email_recipient_lookup_failed' });
    spy.mockRestore();
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(getRow().state).toBe('pending');
  });

  test('a held lease means another call is sending: nothing is created', async () => {
    const { deps } = harness({ existingRow: pendingRow({ locked: true }) });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'not_claimed' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  const orphan = (addresses) => ({
    activityid: PRIOR_ID,
    statuscode: 1,
    email_activity_parties: addresses.map((addressused) => ({ participationtypemask: 2, addressused })),
  });

  test('an orphan found by correlation that addresses the current recipients is adopted, not duplicated', async () => {
    const { deps, getRow } = harness({
      existingRow: pendingRow(),
      correlationMatches: [orphan(['CY@wmkeck.org', 'bea@wmkeck.org'])],
    });
    deps.getEmailActivity.mockResolvedValue({ activityid: PRIOR_ID, statuscode: 3 });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({ emailId: PRIOR_ID, toRecipients: ['bea@wmkeck.org', 'cy@wmkeck.org'], leadSystemUserId: LEAD_ID }),
      expect.any(String),
    );
    expect(getRow().state).toBe('sent');
  });

  test.each([
    ['the lead was reassigned', { requestRow: request({ _wmkf_programdirector_value: BEA_ID }) }],
    ['the program was reassigned', {
      enabledPrograms: [RESEARCH_ID, SOCAL_ID],
      requestRow: request({ _wmkf_grantprogram_value: SOCAL_ID }),
      audience: { status: 'configured', programDirectors: [{ reviewerId: CY_ID, name: 'Cy Director' }] },
    }],
  ])('an orphan built before %s is never sent; a fresh email goes to the current recipients', async (_label, options) => {
    // Created for Bea + Cy under the old lead/program; the ledger never recorded it.
    const { deps, getRow } = harness({
      existingRow: pendingRow(),
      correlationMatches: [orphan(['bea@wmkeck.org', 'cy@wmkeck.org'])],
      ...options,
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.sendEmail).not.toHaveBeenCalledWith(PRIOR_ID);
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(deps.createEmailActivity.mock.calls[0][0].correlationKey).toBe(handoffCorrelationKey(SOURCE_ID, 1));
    expect(getRow()).toMatchObject({ state: 'sent', recipient_generation: 1 });
  });

  test.each([
    ['program_not_configured', { audience: { status: 'program-not-configured', programDirectors: [] } }],
    ['staffing_not_configured', { audience: { status: 'staffing-not-configured', programDirectors: [] } }],
    ['no_recipients', { audience: { status: 'configured', programDirectors: [{ reviewerId: LEAD_ID, name: 'Lee Lead' }] } }],
  ])('an owed email that cannot be sent (%s) raises an ops alert', async (reason, options) => {
    const { deps } = harness({ existingRow: pendingRow(), ...options });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason });
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'final_writeup_handoff_email_undelivered',
      severity: 'error',
      category: 'ops',
      autoResolveKey: `final-writeup-handoff-email:${SOURCE_ID}`,
      metadata: expect.objectContaining({ reason, requestId: REQUEST_ID }),
    }));
  });

  test('repeated failures raise an ops alert from the third attempt; earlier ones do not', async () => {
    const { deps } = harness({ existingRow: pendingRow({ attempt_count: 0 }) });
    deps.sendEmail.mockRejectedValue(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    await deliverHandoffEmail(SOURCE_ID, deps);
    await deliverHandoffEmail(SOURCE_ID, deps);
    expect(deps.notify).not.toHaveBeenCalled();
    await deliverHandoffEmail(SOURCE_ID, deps);
    spy.mockRestore();
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ reason: 'dynamics_send_failed' }),
    }));
  });

  test.each([
    ['program_not_enabled', { enabledPrograms: [] }],
    ['no_longer_in_group_review', { documentRow: finalDocument({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL }) }],
  ])('a deliberate no-email outcome (%s) raises no alert', async (_label, options) => {
    const { deps } = harness({ existingRow: pendingRow(), ...options });
    await deliverHandoffEmail(SOURCE_ID, deps);
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('an orphan whose recipients cannot be resolved stays pending (fail closed)', async () => {
    const { deps, getRow } = harness({
      existingRow: pendingRow(),
      correlationMatches: [orphan(['bea@wmkeck.org', 'cy@wmkeck.org'])],
      audience: null,
    });
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'handoff_email_audience_unavailable' });
    spy.mockRestore();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(getRow().state).toBe('pending');
  });

  test('a stored activity already accepted is marked sent without another SendEmail', async () => {
    const { deps, activities } = harness({ existingRow: pendingRow({ dynamics_email_id: EMAIL_ID }) });
    activities.set(EMAIL_ID, { activityid: EMAIL_ID, statuscode: 6 });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('a send failure stays pending and retryable; recovery sends once', async () => {
    const { deps, getRow } = harness({ existingRow: pendingRow() });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'dynamics_send_failed' });
    spy.mockRestore();
    expect(getRow()).toMatchObject({ state: 'pending', dynamics_email_id: EMAIL_ID, last_error_code: 'dynamics_send_failed' });
    expect(deps.markSent).not.toHaveBeenCalled();
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
  });

  test('an ambiguous send that Dynamics accepted counts as sent', async () => {
    const { deps, activities } = harness({ existingRow: pendingRow() });
    deps.sendEmail.mockImplementationOnce(async (id) => {
      activities.set(id, { ...activities.get(id), statuscode: 7 });
      throw new Error('timeout after accept');
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
  });

  test('a transport guard refusal (including an unreadable marker) stays pending; recovery then sends', async () => {
    const { deps, getRow } = harness({ existingRow: pendingRow() });
    deps.createEmailActivity.mockRejectedValueOnce(Object.assign(
      new Error('Email refused: request is not a verified ordinary request (read_failed).'),
      { code: 'test_request_email_denied' },
    ));
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code: 'test_request_email_denied' });
    spy.mockRestore();
    expect(getRow()).toMatchObject({ state: 'pending', last_error_code: 'test_request_email_denied' });
    expect(await recoverPendingHandoffEmails({}, deps)).toEqual([{ sourceDocumentId: SOURCE_ID, status: 'sent' }]);
  });

  test('a PD who no longer exists (404) is dropped and the others are emailed', async () => {
    const { deps } = harness({
      existingRow: pendingRow(),
      users: {
        [BEA_ID]: Object.assign(new Error('not found'), { status: 404 }),
        [CY_ID]: { systemuserid: CY_ID, internalemailaddress: 'cy@wmkeck.org', isdisabled: false },
      },
    });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.createEmailActivity.mock.calls[0][0].to).toEqual(['cy@wmkeck.org']);
  });

  test.each([
    ['a partial lookup outage', {
      [BEA_ID]: Object.assign(new Error('throttled'), { status: 429 }),
      [CY_ID]: { systemuserid: CY_ID, internalemailaddress: 'cy@wmkeck.org', isdisabled: false },
    }],
    ['a total lookup outage', {
      [BEA_ID]: Object.assign(new Error('down'), { status: 503 }),
      [CY_ID]: new Error('network'),
    }],
  ])('%s keeps the whole send pending instead of a partial or skipped send', async (_label, users) => {
    const { deps, getRow } = harness({ existingRow: pendingRow(), users });
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({
      status: 'failed', code: 'handoff_email_recipient_lookup_failed',
    });
    spy.mockRestore();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ state: 'pending', last_error_code: 'handoff_email_recipient_lookup_failed' });
  });

  test.each([
    ['the program was removed from the list', { enabledPrograms: [] }, 'program_not_enabled'],
    ['the current Final came from another draft', { documentRow: finalDocument({ _wmkf_sourcedocument_value: '99999999-9999-4999-8999-999999999999' }) }, 'final_from_other_draft'],
    ['the Final has moved on to leadership', { documentRow: finalDocument({ wmkf_lifecyclestate: REQUEST_DOCUMENT_LIFECYCLE_STATE.FINAL }) }, 'no_longer_in_group_review'],
    ['the program has no staffing entry', { audience: { status: 'program-not-configured', programDirectors: [] } }, 'program_not_configured'],
    ['staffing is not published', { audience: { status: 'staffing-not-configured', programDirectors: [] } }, 'staffing_not_configured'],
    ['every other PD is disabled or has no address', {
      users: {
        [BEA_ID]: { systemuserid: BEA_ID, internalemailaddress: 'bea@wmkeck.org', isdisabled: true },
        [CY_ID]: { systemuserid: CY_ID, internalemailaddress: '', isdisabled: false },
      },
    }, 'no_recipients'],
    ['the lead is the only PD', { audience: { status: 'configured', programDirectors: [{ reviewerId: LEAD_ID, name: 'Lee Lead' }] } }, 'no_recipients'],
  ])('%s: skipped with a reason, nothing sent', async (_label, options, reason) => {
    const { deps, getRow } = harness({ existingRow: pendingRow(), ...options });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ state: 'skipped', skip_reason: reason });
  });

  test.each([
    ['blank copy', { copy: { subject: '', body: 'x' } }, 'handoff_email_copy_unavailable'],
    ['unreadable audience', { audience: null }, 'handoff_email_audience_unavailable'],
    ['unreadable Final document', { documentRow: null }, 'handoff_email_final_unavailable'],
  ])('%s fails retryably without sending', async (_label, options, code) => {
    const { deps, getRow } = harness({ existingRow: pendingRow(), ...options });
    const spy = quiet();
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'failed', code });
    spy.mockRestore();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ state: 'pending', last_error_code: code });
  });
});

test('render resolves tokens, escapes HTML and adds the writeup link', () => {
  const { subject, html } = renderHandoffEmail({
    subjectTemplate: 'Ready for group review: {{requestNumber}} {{institution}}',
    bodyTemplate: 'First {{requestTitle}}.\n\nSecond line.',
    request: request(),
    writeupUrl: 'https://apps.example.org/w?a=1&b=2',
  });
  expect(subject).toBe('Ready for group review: 1003010 Example University');
  expect(html).toContain('<p>First Quantum &lt;Widgets&gt;.</p>');
  expect(html).toContain('<p>Second line.</p>');
  expect(html).toContain('href="https://apps.example.org/w?a=1&amp;b=2"');
});
