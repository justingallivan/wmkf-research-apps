/** @jest-environment node */

import {
  agendaScheduleChanged,
  computeAgenda,
  getAgendaStatus,
  prepareAgendaEmail,
  renderAgendaEmail,
  sendAgendaEmail,
} from '../../lib/services/meeting-tracker/agenda-service';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST_ONE = '22222222-2222-4222-8222-222222222222';
const REQUEST_TWO = '33333333-3333-4333-8333-333333333333';
const OPERATION_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR_ID = '55555555-5555-4555-8555-555555555555';
const EMAIL_ID = '66666666-6666-4666-8666-666666666666';

function session(overrides = {}) {
  return {
    sessionId: SESSION_ID,
    scheduledStartIso: '2026-09-14T16:00:00.000Z',
    scheduledEndIso: '2026-09-14T16:30:00.000Z',
    ianaTimeZone: 'America/Los_Angeles',
    meetingLink: 'https://zoom.us/j/123',
    location: 'Board room',
    ...overrides,
  };
}

function slots() {
  return [
    {
      wmkf_deliberationslotid: '77777777-7777-4777-8777-777777777777',
      wmkf_order: 2,
      wmkf_minutes: 20,
      _wmkf_request_value: REQUEST_TWO,
      wmkf_Request: { akoya_requestnum: '1002', akoya_title: 'Second proposal' },
      wmkf_LeadPd: null,
      briefing: null,
    },
    {
      wmkf_deliberationslotid: '88888888-8888-4888-8888-888888888888',
      wmkf_order: 1,
      wmkf_minutes: 15,
      _wmkf_request_value: REQUEST_ONE,
      wmkf_Request: { akoya_requestnum: '1001', akoya_title: 'First proposal' },
      wmkf_LeadPd: { fullname: 'Alex Staff' },
      briefing: { url: 'https://reviews.example.org/external/briefing/token' },
    },
  ];
}

function row(snapshot = computeAgenda(session(), slots()), overrides = {}) {
  return {
    operation_id: OPERATION_ID,
    session_id: SESSION_ID,
    agenda_snapshot: snapshot,
    to_recipients: ['board@example.org'],
    cc_recipients: ['staff@example.org'],
    subject: 'Deliberation session agenda',
    body_text: 'Exact text',
    body_html: '<p>Exact HTML</p>',
    from_email: 'pc@example.org',
    acting_user_system_id: ACTOR_ID,
    state: 'prepared',
    dynamics_email_id: null,
    send_requested_at: null,
    sent_at: null,
    lease_token: null,
    created_at: '2026-09-10T12:00:00.000Z',
    updated_at: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

function emailActivity(attempt, statuscode = 1) {
  return {
    activityid: EMAIL_ID,
    subject: attempt.subject,
    description: attempt.body_html,
    subcategory: `wmkf-deliberation-agenda:${OPERATION_ID}`,
    statecode: statuscode === 6 ? 1 : 0,
    statuscode,
    email_activity_parties: [
      { participationtypemask: 1, addressused: 'pc@example.org' },
      { participationtypemask: 2, addressused: 'board@example.org' },
      { participationtypemask: 3, addressused: 'staff@example.org' },
    ],
  };
}

function prepareDependencies(overrides = {}) {
  return {
    getSession: jest.fn(async () => ({ session: session(), slots: slots() })),
    getLatestUnresolvedAgenda: jest.fn(async () => null),
    createOrGetAgenda: jest.fn(async (input) => ({
      operation_id: input.operationId,
      session_id: input.sessionId,
      agenda_snapshot: input.agendaSnapshot,
      to_recipients: input.toRecipients,
      cc_recipients: input.ccRecipients,
      subject: input.subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      from_email: input.fromEmail,
      acting_user_system_id: input.actingUserSystemId,
      state: 'prepared',
      inserted: true,
      created_at: '2026-09-10T12:00:00.000Z',
      updated_at: '2026-09-10T12:00:00.000Z',
    })),
    ...overrides,
  };
}

function sendDependencies(baseRow, overrides = {}) {
  const claimed = { ...baseRow, lease_token: '99999999-9999-4999-8999-999999999999' };
  return {
    getAgenda: jest.fn(async () => baseRow),
    getLatestUnresolvedAgenda: jest.fn(async () => null),
    claimSend: jest.fn(async () => claimed),
    getSession: jest.fn(async () => ({ session: session(), slots: slots() })),
    findEmailByCorrelation: jest.fn(async () => []),
    createEmailActivity: jest.fn(async () => EMAIL_ID),
    recordEmailActivity: jest.fn(async (attempt) => ({ ...attempt, dynamics_email_id: EMAIL_ID, state: 'activity_created' })),
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, 6)),
    recordSendRequested: jest.fn(async (attempt) => ({ ...attempt, state: 'send_requested', send_requested_at: '2026-09-10T12:01:00.000Z' })),
    recordDraftReconciled: jest.fn(async (attempt, status) => ({
      ...attempt,
      state: 'activity_created',
      send_requested_at: null,
      dynamics_statecode: status.statecode,
      dynamics_statuscode: status.statuscode,
    })),
    recordTerminalFailure: jest.fn(async (attempt, status, message) => ({
      ...attempt,
      state: 'failed',
      dynamics_statecode: status.statecode ?? null,
      dynamics_statuscode: status.statuscode ?? null,
      lease_token: null,
      locked_until: null,
      last_error_code: 'agenda_send_terminal',
      last_error_message: message,
    })),
    renewSendLease: jest.fn(async (attempt) => attempt),
    sendEmail: jest.fn(async () => undefined),
    recordSent: jest.fn(async (attempt, status) => ({
      ...attempt,
      state: 'sent',
      sent_at: '2026-09-10T12:02:00.000Z',
      dynamics_statuscode: status.statuscode,
    })),
    recordFailure: jest.fn(async () => null),
    impersonationEnabled: jest.fn(() => true),
    ...overrides,
  };
}

const actorInput = {
  sessionId: SESSION_ID,
  operationId: OPERATION_ID,
  fromEmail: 'pc@example.org',
  actingUserSystemId: ACTOR_ID,
};

test('computeAgenda orders slots, accumulates times past the session end, and supplies missing values', () => {
  const agenda = computeAgenda(session(), slots(), new Date('2026-09-10T00:00:00Z'));
  expect(agenda.slots.map((slot) => slot.requestNumber)).toEqual(['1001', '1002']);
  expect(agenda.slots[0]).toMatchObject({
    windowText: '9:00 AM–9:15 AM',
    computedStartIso: '2026-09-14T16:00:00.000Z',
    computedEndIso: '2026-09-14T16:15:00.000Z',
    leadPdName: 'Alex Staff',
    briefingUrl: 'https://reviews.example.org/external/briefing/token',
  });
  expect(agenda.slots[1]).toMatchObject({
    windowText: '9:15 AM–9:35 AM',
    leadPdName: 'Not assigned',
    briefingUrl: null,
  });
  expect(agenda.sessionLine).toMatch(/PDT/);
});

test('computeAgenda drops non-HTTPS links and rendered HTML escapes every proposal value', () => {
  const unsafeSlots = slots();
  unsafeSlots[0].briefing = { url: 'http://reviews.example.org/token' };
  unsafeSlots[0].wmkf_Request.akoya_title = '<img src=x onerror=alert(1)>';
  const agenda = computeAgenda(session({ meetingLink: 'javascript:alert(1)', location: '<Room>' }), unsafeSlots);
  expect(agenda.meetingLink).toBeNull();
  expect(agenda.slots[1].briefingUrl).toBeNull();
  const rendered = renderAgendaEmail('<Hello>', agenda);
  expect(rendered.bodyHtml).toContain('&lt;Hello&gt;');
  expect(rendered.bodyHtml).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(rendered.bodyHtml).not.toContain('javascript:');
  expect(rendered.bodyText).toContain('briefing link to follow by email');
});

test('drift compares session start and ordered request/minutes tuples only', () => {
  const snapshot = computeAgenda(session(), slots());
  expect(agendaScheduleChanged(session({ location: 'Changed room' }), slots(), snapshot)).toBe(false);
  expect(agendaScheduleChanged(session({ scheduledStartIso: '2026-09-14T16:00:00Z' }), slots(), snapshot)).toBe(false);
  expect(agendaScheduleChanged(session({ scheduledStartIso: '2026-09-14T16:05:00.000Z' }), slots(), snapshot)).toBe(true);
  const reordered = slots().map((slot, index) => ({ ...slot, wmkf_order: index + 1 }));
  expect(agendaScheduleChanged(session(), reordered, snapshot)).toBe(true);
  const longer = slots().map((slot, index) => (index === 0 ? { ...slot, wmkf_minutes: 25 } : slot));
  expect(agendaScheduleChanged(session(), longer, snapshot)).toBe(true);
});

test('prepare accepts an idempotent JSONB row even when object keys are reordered', async () => {
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).reverse().map(([key, nested]) => [key, reverseKeys(nested)]));
  };
  const deps = prepareDependencies({
    createOrGetAgenda: jest.fn(async (input) => ({
      ...row(reverseKeys(input.agendaSnapshot)),
      operation_id: input.operationId,
      session_id: input.sessionId,
      to_recipients: input.toRecipients,
      cc_recipients: input.ccRecipients,
      subject: input.subject,
      body_text: input.bodyText,
      body_html: input.bodyHtml,
      from_email: input.fromEmail,
      acting_user_system_id: input.actingUserSystemId,
      inserted: false,
    })),
  });
  const result = await prepareAgendaEmail({
    ...actorInput,
    to: 'board@example.org',
    cc: 'staff@example.org',
    subject: 'Agenda subject',
    bodyText: 'Agenda message',
  }, deps);
  expect(result.reused).toBe(true);
});

test('prepare freezes the normalized recipients, rendered body, and exact snapshot', async () => {
  const deps = prepareDependencies();
  const result = await prepareAgendaEmail({
    ...actorInput,
    to: 'BOARD@example.org, board@example.org',
    cc: 'staff@example.org',
    subject: 'Agenda subject',
    bodyText: 'Agenda message',
  }, deps);
  expect(deps.createOrGetAgenda).toHaveBeenCalledWith(expect.objectContaining({
    sessionId: SESSION_ID,
    toRecipients: ['board@example.org'],
    ccRecipients: ['staff@example.org'],
    subject: 'Agenda subject',
    fromEmail: 'pc@example.org',
    actingUserSystemId: ACTOR_ID,
    agendaSnapshot: expect.objectContaining({ slots: expect.arrayContaining([expect.objectContaining({ requestId: REQUEST_ONE })]) }),
    bodyHtml: expect.stringContaining('Open briefing'),
  }));
  expect(result.agenda).toMatchObject({ operationId: OPERATION_ID, recipientCount: 2 });
});

test('prepare refuses empty To, no slots, and operation reuse with different content', async () => {
  await expect(prepareAgendaEmail({
    ...actorInput, to: '', cc: '', subject: 'Agenda', bodyText: 'Message',
  }, prepareDependencies())).rejects.toMatchObject({ httpStatus: 400, code: 'distribution_to_required' });

  await expect(prepareAgendaEmail({
    ...actorInput, to: 'board@example.org', cc: '', subject: 'Agenda', bodyText: 'Message',
  }, prepareDependencies({ getSession: jest.fn(async () => ({ session: session(), slots: [] })) })))
    .rejects.toMatchObject({ httpStatus: 409, code: 'agenda_slots_required' });

  await expect(prepareAgendaEmail({
    ...actorInput, to: 'board@example.org', cc: '', subject: 'New subject', bodyText: 'Message',
  }, prepareDependencies({ createOrGetAgenda: jest.fn(async () => row(undefined, { subject: 'Old subject' })) })))
    .rejects.toMatchObject({ httpStatus: 409, code: 'agenda_operation_conflict' });
});

test('prepare blocks a second operation while a durable send is unresolved', async () => {
  const pending = row(undefined, {
    operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00.000Z',
  });
  const deps = prepareDependencies({ getLatestUnresolvedAgenda: jest.fn(async () => pending) });
  await expect(prepareAgendaEmail({
    ...actorInput,
    to: 'board@example.org',
    cc: '',
    subject: 'Agenda subject',
    bodyText: 'Agenda message',
  }, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'agenda_send_unresolved',
    body: { pendingSend: expect.objectContaining({ operationId: pending.operation_id }) },
  });
  expect(deps.createOrGetAgenda).not.toHaveBeenCalled();
});

test('send blocks a prepared sibling operation while another send is unresolved', async () => {
  const baseRow = row();
  const pending = row(undefined, {
    operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00.000Z',
  });
  const deps = sendDependencies(baseRow, {
    getLatestUnresolvedAgenda: jest.fn(async () => pending),
  });
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'agenda_send_unresolved',
    body: { pendingSend: expect.objectContaining({ operationId: pending.operation_id }) },
  });
  expect(deps.claimSend).not.toHaveBeenCalled();
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('a concurrent unresolved send constraint is mapped before transport', async () => {
  const baseRow = row();
  const pending = row(undefined, {
    operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00.000Z',
  });
  const deps = sendDependencies(baseRow, {
    getLatestUnresolvedAgenda: jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pending),
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, 1)),
    recordSendRequested: jest.fn(async () => { throw new Error('unique violation'); }),
  });
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'agenda_send_unresolved',
    body: { pendingSend: expect.objectContaining({ operationId: pending.operation_id }) },
  });
  expect(deps.createEmailActivity).toHaveBeenCalledTimes(1);
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('status reports the last sent receipt separately from a newer unresolved send', async () => {
  const sent = row(undefined, {
    state: 'sent',
    sent_at: '2026-09-10T12:00:00.000Z',
  });
  const pending = row(undefined, {
    operation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:05:00.000Z',
  });
  const result = await getAgendaStatus({ sessionId: SESSION_ID }, {
    getSession: jest.fn(async () => ({
      session: session({ scheduledStartIso: '2026-09-14T16:00:00Z' }),
      slots: slots(),
    })),
    getLatestSentAgenda: jest.fn(async () => sent),
    getLatestUnresolvedAgenda: jest.fn(async () => pending),
  });
  expect(result).toMatchObject({
    lastAgenda: { state: 'sent', sentAt: sent.sent_at },
    pendingSend: { state: 'send_requested', operationId: pending.operation_id },
    scheduleChanged: false,
  });
});

test('send persists each fence before transport and returns the accepted receipt', async () => {
  const baseRow = row();
  const order = [];
  let reads = 0;
  const deps = sendDependencies(baseRow, {
    createEmailActivity: jest.fn(async () => { order.push('create'); return EMAIL_ID; }),
    recordEmailActivity: jest.fn(async (attempt) => { order.push('record-activity'); return { ...attempt, dynamics_email_id: EMAIL_ID, state: 'activity_created' }; }),
    getEmailActivity: jest.fn(async () => {
      reads += 1;
      return emailActivity(baseRow, reads >= 3 ? 6 : 1);
    }),
    recordSendRequested: jest.fn(async (attempt) => { order.push('intent'); return { ...attempt, state: 'send_requested', send_requested_at: '2026-09-10T12:01:00Z' }; }),
    renewSendLease: jest.fn(async (attempt) => { order.push('renew'); return attempt; }),
    sendEmail: jest.fn(async () => { order.push('send'); }),
    recordSent: jest.fn(async (attempt) => { order.push('sent'); return { ...attempt, state: 'sent', sent_at: '2026-09-10T12:02:00Z' }; }),
  });
  const result = await sendAgendaEmail(actorInput, deps);
  expect(order).toEqual(['create', 'record-activity', 'intent', 'renew', 'send', 'sent']);
  expect(deps.createEmailActivity).toHaveBeenCalledWith(expect.objectContaining({
    correlationKey: `wmkf-deliberation-agenda:${OPERATION_ID}`,
    actingUserSystemId: ACTOR_ID,
    noFallback: true,
  }));
  expect(deps.createEmailActivity.mock.calls[0][0]).not.toHaveProperty('regardingId');
  expect(result.agenda.transportAccepted).toBe(true);
});

test('a correlated activity is recovered and accepted without creating or sending again', async () => {
  const baseRow = row();
  const recovered = emailActivity(baseRow, 6);
  const deps = sendDependencies(baseRow, {
    findEmailByCorrelation: jest.fn(async () => [recovered]),
    getEmailActivity: jest.fn(async () => recovered),
  });
  const result = await sendAgendaEmail(actorInput, deps);
  expect(deps.recordEmailActivity).toHaveBeenCalled();
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(result.reused).toBe(true);
});

test('a retry with durable send intent reconciles accepted status before schedule freshness', async () => {
  const baseRow = row(undefined, {
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00Z',
  });
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, 6)),
    getSession: jest.fn(async () => { throw new Error('must not read schedule'); }),
  });
  const result = await sendAgendaEmail(actorInput, deps);
  expect(result.reused).toBe(true);
  expect(deps.getSession).not.toHaveBeenCalled();
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('a retry with unreadable durable send intent never requests transport again', async () => {
  const baseRow = row(undefined, {
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00Z',
  });
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => null),
  });
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 202, code: 'agenda_send_unconfirmed',
  });
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.recordFailure).toHaveBeenCalled();
});

test('a retry with confirmed Draft status resumes transport on the same activity', async () => {
  const baseRow = row(undefined, {
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00Z',
  });
  let reads = 0;
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => {
      reads += 1;
      return emailActivity(baseRow, reads >= 4 ? 6 : 1);
    }),
  });
  const result = await sendAgendaEmail(actorInput, deps);
  expect(deps.recordDraftReconciled).toHaveBeenCalledWith(
    expect.objectContaining({ operation_id: OPERATION_ID }),
    expect.objectContaining({ activityid: EMAIL_ID, statuscode: 1 }),
  );
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).toHaveBeenCalledTimes(1);
  expect(result.agenda).toMatchObject({ state: 'sent', transportAccepted: true });
});

test('a different staff actor cannot resume a confirmed Draft activity', async () => {
  const baseRow = row(undefined, {
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00Z',
  });
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, 1)),
  });
  await expect(sendAgendaEmail({
    ...actorInput,
    fromEmail: 'other@example.org',
    actingUserSystemId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }, deps)).rejects.toMatchObject({
    httpStatus: 403,
    code: 'agenda_actor_mismatch',
  });
  expect(deps.recordDraftReconciled).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test.each([2, 4, 5, 8])('a retry with terminal Dynamics status %s resolves failed without transport', async (statuscode) => {
  const baseRow = row(undefined, {
    state: 'send_requested',
    dynamics_email_id: EMAIL_ID,
    send_requested_at: '2026-09-10T12:01:00Z',
  });
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, statuscode)),
  });
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'agenda_send_terminal',
    body: { failedSend: expect.objectContaining({ state: 'failed' }) },
  });
  expect(deps.recordTerminalFailure).toHaveBeenCalledWith(
    expect.objectContaining({ operation_id: OPERATION_ID }),
    expect.objectContaining({ statuscode }),
    expect.stringContaining(`status ${statuscode}`),
  );
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('a terminal failed row requires a new preview and cannot be sent again', async () => {
  const baseRow = row(undefined, {
    state: 'failed',
    dynamics_email_id: EMAIL_ID,
    dynamics_statuscode: 8,
    last_error_code: 'agenda_send_terminal',
  });
  const deps = sendDependencies(baseRow);
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 409,
    code: 'agenda_send_terminal',
  });
  expect(deps.getLatestUnresolvedAgenda).not.toHaveBeenCalled();
  expect(deps.claimSend).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('lease contention and stale schedules fail closed without transport', async () => {
  const baseRow = row();
  const held = sendDependencies(baseRow, { claimSend: jest.fn(async () => null) });
  await expect(sendAgendaEmail(actorInput, held)).rejects.toMatchObject({
    httpStatus: 409, code: 'agenda_send_in_progress',
  });
  expect(held.createEmailActivity).not.toHaveBeenCalled();

  const stale = sendDependencies(baseRow, {
    getSession: jest.fn(async () => ({
      session: session({ scheduledStartIso: '2026-09-14T17:00:00.000Z' }),
      slots: slots(),
    })),
  });
  await expect(sendAgendaEmail(actorInput, stale)).rejects.toMatchObject({
    httpStatus: 409, code: 'agenda_operation_stale',
  });
  expect(stale.createEmailActivity).not.toHaveBeenCalled();
  expect(stale.recordFailure).toHaveBeenCalled();
});

test('an unaccepted status leaves the durable send_requested state retryable', async () => {
  const baseRow = row();
  const deps = sendDependencies(baseRow, {
    getEmailActivity: jest.fn(async () => emailActivity(baseRow, 1)),
  });
  await expect(sendAgendaEmail(actorInput, deps)).rejects.toMatchObject({
    httpStatus: 202, code: 'agenda_send_unconfirmed',
  });
  expect(deps.recordSent).not.toHaveBeenCalled();
  expect(deps.recordFailure).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'send_requested' }),
    expect.anything(),
    'agenda_send_unconfirmed',
  );
});
