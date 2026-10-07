/**
 * @jest-environment node
 *
 * Group-review handoff email (Stage 4): program gate, send intent only from the
 * committing call, at most one email per Final, recipients without the lead,
 * TEST-request refusal, retryable failures, and never throwing to the route.
 */

import {
  deliverHandoffEmail,
  handoffCorrelationKey,
  notifyGroupReviewHandoff,
  recoverPendingHandoffEmails,
  renderHandoffEmail,
} from '../../lib/services/final-writeup/handoff-email-service.js';
import {
  isHandoffEmailEnabledForProgram,
  readHandoffEmailProgramIds,
} from '../../lib/services/final-writeup/handoff-email-config.js';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const FINAL_ID = '22222222-2222-4222-8222-222222222222';
const RESEARCH_ID = '33333333-3333-4333-8333-333333333333';
const SOCAL_ID = '33333333-3333-4333-8333-333333333334';
const LEAD_ID = '44444444-4444-4444-8444-444444444441';
const BEA_ID = '44444444-4444-4444-8444-444444444442';
const CY_ID = '44444444-4444-4444-8444-444444444443';
const EMAIL_ID = '55555555-5555-4555-8555-555555555555';

function request(overrides = {}) {
  return {
    akoya_requestid: REQUEST_ID,
    akoya_requestnum: '1003010',
    akoya_title: 'Quantum <Widgets>',
    _akoya_applicantid_value_formatted: 'Example University',
    _wmkf_programdirector_value: LEAD_ID,
    _wmkf_programdirector_value_formatted: 'Lee Lead',
    _wmkf_grantprogram_value: RESEARCH_ID,
    _wmkf_currentfinalwriteup_value: FINAL_ID,
    ...overrides,
  };
}

function harness({
  requestRow = request(),
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
  const calls = [];
  const activities = new Map();
  const deps = {
    getRequest: jest.fn(async () => requestRow),
    getSystemUser: jest.fn(async (id) => users[id] || null),
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
      row = {
        final_document_id: intent.finalDocumentId,
        request_id: intent.requestId,
        grant_program_id: intent.grantProgramId,
        lead_systemuser_id: intent.leadSystemUserId,
        state: 'pending',
        dynamics_email_id: null,
        locked: false,
      };
      return { inserted: true };
    }),
    getRow: jest.fn(async () => (row ? { ...row } : null)),
    claim: jest.fn(async () => {
      if (!row || row.state !== 'pending' || row.locked) return null;
      row.locked = true;
      return { ...row };
    }),
    recordActivity: jest.fn(async (_id, { emailId, toRecipients }) => {
      calls.push('record');
      row.dynamics_email_id = emailId;
      row.to_recipients = toRecipients;
    }),
    markSent: jest.fn(async () => { row.state = 'sent'; row.locked = false; }),
    markSkipped: jest.fn(async (_id, reason) => { row.state = 'skipped'; row.skip_reason = reason; row.locked = false; }),
    recordFailure: jest.fn(async (_id, code) => { row.last_error_code = code; row.locked = false; }),
    listPending: jest.fn(async () => (row && row.state === 'pending' && !row.locked ? [{ ...row }] : [])),
    programEnabled: (id) => enabledPrograms.includes(String(id).toLowerCase()),
    sender: () => 'alerts@wmkeck.org',
    baseUrl: () => 'https://apps.example.org',
  };
  return { deps, calls, getRow: () => row, activities };
}

const committed = () => ({ requestId: REQUEST_ID, finalDocumentId: FINAL_ID, committedByThisCall: true });

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

describe('notifyGroupReviewHandoff', () => {
  test('the committing call emails the other PDs, regarding the request, activity recorded before send', async () => {
    const { deps, calls, getRow } = harness();
    const outcome = await notifyGroupReviewHandoff(committed(), deps);
    expect(outcome).toEqual({ status: 'sent' });
    expect(deps.insertIntent).toHaveBeenCalledWith({
      finalDocumentId: FINAL_ID, requestId: REQUEST_ID, grantProgramId: RESEARCH_ID, leadSystemUserId: LEAD_ID,
    });
    const input = deps.createEmailActivity.mock.calls[0][0];
    expect(input).toMatchObject({
      to: ['bea@wmkeck.org', 'cy@wmkeck.org'],
      from: 'alerts@wmkeck.org',
      regardingId: REQUEST_ID,
      regardingType: 'akoya_request',
      correlationKey: handoffCorrelationKey(FINAL_ID),
      subject: 'Ready: 1003010 Example University',
    });
    expect(input.to).not.toContain('lee@wmkeck.org');
    expect(input.body).toContain('Quantum &lt;Widgets&gt;');
    expect(input.body).toContain(`https://apps.example.org/workbench/${REQUEST_ID}?tab=final-writeup&amp;n=1003010`);
    expect(calls).toEqual(['create', 'record', 'send']);
    expect(getRow().state).toBe('sent');
  });

  test('a configured program that is not listed sends nothing and records no intent', async () => {
    // SoCal has a staffing entry and recipients, so only the program gate stops it.
    const { deps } = harness({ requestRow: request({ _wmkf_grantprogram_value: SOCAL_ID }) });
    const outcome = await notifyGroupReviewHandoff(committed(), deps);
    expect(outcome).toEqual({ status: 'not_enabled' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('a call that did not commit never creates an intent (pre-ship writeups stay silent)', async () => {
    const { deps } = harness();
    const outcome = await notifyGroupReviewHandoff({ ...committed(), committedByThisCall: false }, deps);
    expect(outcome).toEqual({ status: 'no_intent' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
    expect(deps.claim).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('a repeat call retries a pending intent but never resends a sent one', async () => {
    const { deps } = harness();
    await notifyGroupReviewHandoff(committed(), deps);
    const again = await notifyGroupReviewHandoff({ ...committed(), committedByThisCall: false }, deps);
    expect(again).toEqual({ status: 'sent' });
    const committedAgain = await notifyGroupReviewHandoff(committed(), deps);
    expect(committedAgain).toEqual({ status: 'not_claimed' });
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  });

  test('a non-committing call delivers an existing pending intent without inserting one', async () => {
    const { deps, getRow } = harness({
      existingRow: {
        final_document_id: FINAL_ID, request_id: REQUEST_ID, grant_program_id: RESEARCH_ID,
        lead_systemuser_id: LEAD_ID, state: 'pending', dynamics_email_id: null, locked: false,
      },
    });
    const outcome = await notifyGroupReviewHandoff({ ...committed(), committedByThisCall: false }, deps);
    expect(outcome).toEqual({ status: 'sent' });
    expect(deps.insertIntent).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
    expect(getRow().state).toBe('sent');
  });

  test('never throws, even when the request read fails', async () => {
    const { deps } = harness();
    deps.getRequest.mockRejectedValue(new Error('dataverse down'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(notifyGroupReviewHandoff(committed(), deps)).resolves.toEqual({
      status: 'failed', code: 'handoff_email_queue_failed',
    });
    spy.mockRestore();
  });
});

describe('deliverHandoffEmail', () => {
  const pending = (overrides = {}) => ({
    final_document_id: FINAL_ID,
    request_id: REQUEST_ID,
    grant_program_id: RESEARCH_ID,
    lead_systemuser_id: LEAD_ID,
    state: 'pending',
    dynamics_email_id: null,
    locked: false,
    ...overrides,
  });

  test('a held lease means another call is sending: nothing is created', async () => {
    const { deps } = harness({ existingRow: pending({ locked: true }) });
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'not_claimed' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('an activity found by correlation key is reused, not duplicated', async () => {
    const { deps, getRow } = harness({
      existingRow: pending(),
      correlationMatches: [{ activityid: EMAIL_ID, statuscode: 1, email_activity_parties: [{ participationtypemask: 2, addressused: 'bea@wmkeck.org' }] }],
    });
    deps.getEmailActivity.mockResolvedValue({ activityid: EMAIL_ID, statuscode: 3 });
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(deps.recordActivity).toHaveBeenCalledWith(FINAL_ID, expect.objectContaining({ emailId: EMAIL_ID, toRecipients: ['bea@wmkeck.org'] }));
    expect(getRow().state).toBe('sent');
  });

  test('a stored activity already accepted is marked sent without another SendEmail', async () => {
    const { deps, activities } = harness({ existingRow: pending({ dynamics_email_id: EMAIL_ID }) });
    activities.set(EMAIL_ID, { activityid: EMAIL_ID, statuscode: 6 });
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'sent' });
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
  });

  test('a send failure stays pending and retryable; recovery sends once', async () => {
    const { deps, getRow } = harness({ existingRow: pending() });
    deps.sendEmail.mockRejectedValueOnce(Object.assign(new Error('transport'), { code: 'dynamics_send_failed' }));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'failed', code: 'dynamics_send_failed' });
    spy.mockRestore();
    expect(getRow()).toMatchObject({ state: 'pending', dynamics_email_id: EMAIL_ID, last_error_code: 'dynamics_send_failed' });
    expect(deps.markSent).not.toHaveBeenCalled();

    const results = await recoverPendingHandoffEmails({}, deps);
    expect(results).toEqual([{ finalDocumentId: FINAL_ID, status: 'sent' }]);
    expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
  });

  test('an ambiguous send that Dynamics accepted counts as sent', async () => {
    const { deps, activities } = harness({ existingRow: pending() });
    deps.sendEmail.mockImplementationOnce(async (id) => {
      activities.set(id, { ...activities.get(id), statuscode: 7 });
      throw new Error('timeout after accept');
    });
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'sent' });
  });

  test('a TEST-request refusal is terminal, not retried', async () => {
    const { deps, getRow } = harness({ existingRow: pending() });
    deps.createEmailActivity.mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'test_request_email_denied' }));
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'skipped', reason: 'test_request_refused' });
    expect(getRow().state).toBe('skipped');
  });

  test.each([
    ['the program was removed from the list', { enabledPrograms: [] }, 'program_not_enabled'],
    ['the program has no staffing entry', { audience: { status: 'program-not-configured', programDirectors: [] } }, 'program_not_configured'],
    ['staffing is not published', { audience: { status: 'staffing-not-configured', programDirectors: [] } }, 'staffing_not_configured'],
    ['every other PD is disabled or has no address', {
      users: {
        [BEA_ID]: { systemuserid: BEA_ID, internalemailaddress: 'bea@wmkeck.org', isdisabled: true },
        [CY_ID]: { systemuserid: CY_ID, internalemailaddress: '', isdisabled: false },
      },
    }, 'no_recipients'],
    ['the lead is the only PD', { audience: { status: 'configured', programDirectors: [{ reviewerId: LEAD_ID, name: 'Lee Lead' }] } }, 'no_recipients'],
    ['the request now points at another Final', { requestRow: request({ _wmkf_currentfinalwriteup_value: '66666666-6666-4666-8666-666666666666' }) }, 'final_not_current'],
  ])('%s: skipped with a reason, nothing sent', async (_label, options, reason) => {
    const { deps, getRow } = harness({ existingRow: pending(), ...options });
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'skipped', reason });
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(getRow()).toMatchObject({ state: 'skipped', skip_reason: reason });
  });

  test.each([
    ['blank copy', { copy: { subject: '', body: 'x' } }, 'handoff_email_copy_unavailable'],
    ['unreadable audience', { audience: null }, 'handoff_email_audience_unavailable'],
  ])('%s fails retryably without sending', async (_label, options, code) => {
    const { deps, getRow } = harness({ existingRow: pending(), ...options });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await deliverHandoffEmail(FINAL_ID, deps)).toEqual({ status: 'failed', code });
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
