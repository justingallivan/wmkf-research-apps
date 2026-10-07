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
      activities.set(EMAIL_ID, { activityid: EMAIL_ID, statuscode: 1, input });
      return EMAIL_ID;
    }),
    getEmailActivity: jest.fn(async (id) => activities.get(id) || null),
    findEmailByCorrelation: jest.fn(async () => correlationMatches),
    sendEmail: jest.fn(async (id) => {
      calls.push('send');
      activities.set(id, { ...activities.get(id), statuscode: 3 });
    }),
    insertIntent: jest.fn(async (intent) => {
      if (row) return { inserted: false };
      row = pendingRow({
        source_document_id: intent.sourceDocumentId,
        request_id: intent.requestId,
        grant_program_id: intent.grantProgramId,
        lead_systemuser_id: intent.leadSystemUserId,
      });
      return { inserted: true };
    }),
    getRow: jest.fn(async () => (row ? { ...row } : null)),
    claim: jest.fn(async () => {
      if (!row || row.state !== 'pending' || row.locked) return null;
      row.locked = true;
      return { ...row };
    }),
    recordFinal: jest.fn(async (_id, finalId) => { row.final_document_id = finalId; }),
    recordActivity: jest.fn(async (_id, { emailId, toRecipients }) => {
      calls.push('record');
      row.dynamics_email_id = emailId;
      row.to_recipients = toRecipients;
    }),
    markSent: jest.fn(async () => { row.state = 'sent'; row.locked = false; }),
    markSkipped: jest.fn(async (_id, reason) => { row.state = 'skipped'; row.skip_reason = reason; row.locked = false; }),
    release: jest.fn(async () => { row.locked = false; }),
    recordFailure: jest.fn(async (_id, code) => { row.last_error_code = code; row.locked = false; }),
    listPending: jest.fn(async () => (row && row.state === 'pending' && !row.locked ? [{ ...row }] : [])),
    programEnabled: (id) => enabledPrograms.includes(String(id).toLowerCase()),
    sender: () => 'alerts@wmkeck.org',
    baseUrl: () => 'https://apps.example.org',
    now: () => NOW,
  };
  return { deps, calls, state, getRow: () => row, activities };
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

  test('a request read failure stages nothing and does not block the transition', async () => {
    const { deps } = harness();
    deps.getRequest.mockRejectedValue(new Error('dataverse down'));
    const spy = quiet();
    expect(await stageGroupReviewHandoff(stage(), deps)).toEqual({ status: 'request_unavailable' });
    spy.mockRestore();
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

  test('a held lease means another call is sending: nothing is created', async () => {
    const { deps } = harness({ existingRow: pendingRow({ locked: true }) });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'not_claimed' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('an activity found by correlation key is reused, not duplicated', async () => {
    const { deps, getRow } = harness({
      existingRow: pendingRow(),
      correlationMatches: [{ activityid: EMAIL_ID, statuscode: 1, email_activity_parties: [{ participationtypemask: 2, addressused: 'bea@wmkeck.org' }] }],
    });
    deps.getEmailActivity.mockResolvedValue({ activityid: EMAIL_ID, statuscode: 3 });
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(SOURCE_ID, expect.objectContaining({ emailId: EMAIL_ID, toRecipients: ['bea@wmkeck.org'] }));
    expect(getRow().state).toBe('sent');
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

  test('a TEST-request refusal is terminal, not retried', async () => {
    const { deps, getRow } = harness({ existingRow: pendingRow() });
    deps.createEmailActivity.mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'test_request_email_denied' }));
    expect(await deliverHandoffEmail(SOURCE_ID, deps)).toEqual({ status: 'skipped', reason: 'test_request_refused' });
    expect(getRow().state).toBe('skipped');
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
