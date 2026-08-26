/** @jest-environment node */

import fs from 'node:fs';
import path from 'node:path';
import {
  deliverScheduledEmail,
  groupDigestRowsByPd,
  renderScheduledEmailPreview,
  scheduledSendAtForInvitation,
  sendScheduledEmailDigest,
} from '../../lib/services/scheduled-email-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';

function message(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    workflow_type: 'grantee_abstract_reminder',
    request_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    deliverable_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    pd_systemuser_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pd_name: 'Jean Kim',
    pd_email: 'jean@example.org',
    recipient_name: 'Professor Reiter',
    to_recipients: ['reviewer@example.edu'],
    cc_recipients: ['liaison@example.edu'],
    subject: 'Reminder: abstract due',
    body_text: 'Dear Professor Reiter,\n\nPlease review your abstract.\n\nThank you,',
    signature_text: 'Jean Kim\nW. M. Keck Foundation',
    scheduled_send_at: '2026-08-30T08:00:00.000Z',
    approval_required: false,
    recipient_contact_ids: ['11111111-1111-4111-8111-111111111111'],
    status: 'scheduled',
    version: 1,
    lease_token: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    ...overrides,
  };
}

function dependencies(base = message()) {
  const claimed = { ...base, status: 'sending' };
  const withActivity = { ...claimed, dynamics_email_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff' };
  const requested = { ...withActivity, send_requested_at: '2026-08-25T00:00:00.000Z' };
  const sent = { ...requested, status: 'sent', sent_at: '2026-08-25T00:00:01.000Z', lease_token: null };
  const finalized = { ...sent, finalized_at: '2026-08-25T00:00:02.000Z' };
  return {
    claimSend: jest.fn(async () => claimed),
    getDeliverable: jest.fn(async () => ({
      _etag: 'W/"1"',
      wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.INVITED,
    })),
    cancelForSource: jest.fn(),
    findEmailByCorrelation: jest.fn(async () => []),
    getEmailActivity: jest.fn(async () => ({
      activityid: withActivity.dynamics_email_id,
      statuscode: 1,
      statecode: 0,
    })),
    mintForRequest: jest.fn(async () => ({ url: 'https://grantees.example.org/live-token' })),
    createEmailActivity: jest.fn(async () => withActivity.dynamics_email_id),
    recordEmailActivity: jest.fn(async () => withActivity),
    recordSendRequested: jest.fn(async () => requested),
    sendEmail: jest.fn(async () => undefined),
    recordSent: jest.fn(async () => sent),
    updateDeliverable: jest.fn(async () => ({})),
    recordFinalized: jest.fn(async () => finalized),
    recordFailure: jest.fn(async () => null),
  };
}

test('uses the first daily cron tick after a full 12 days have elapsed', () => {
  expect(scheduledSendAtForInvitation('2026-08-18T19:45:00.000Z').toISOString())
    .toBe('2026-08-31T08:00:00.000Z');
  expect(scheduledSendAtForInvitation('2026-08-18T01:00:00.000Z').toISOString())
    .toBe('2026-08-30T08:00:00.000Z');
});

test('preview contains a placeholder link and server-owned automation notice', () => {
  const html = renderScheduledEmailPreview(message());
  expect(html).toContain('secure-link-created-when-sent');
  expect(html).toContain('on behalf of Jean Kim');
  expect(html).toContain('Replies to this email will go directly to Jean Kim at jean@example.org');
  expect(html).not.toContain('live-token');
});

test('send mints the live link only after claim, persists activity identity, and finalizes Dataverse after transport', async () => {
  const deps = dependencies();
  const result = await deliverScheduledEmail(message().id, {}, deps);

  expect(result.sent).toBe(true);
  expect(deps.claimSend).toHaveBeenCalled();
  expect(deps.mintForRequest).toHaveBeenCalledWith({ requestId: message().request_id });
  expect(deps.createEmailActivity).toHaveBeenCalledWith(expect.objectContaining({
    from: 'jean@example.org',
    to: ['reviewer@example.edu'],
    cc: ['liaison@example.edu'],
    actingUserSystemId: message().pd_systemuser_id,
    noFallback: true,
  }));
  expect(deps.createEmailActivity.mock.calls[0][0].body).toContain('https://grantees.example.org/live-token');
  expect(deps.createEmailActivity.mock.calls[0][0].body).toContain('on behalf of Jean Kim');
  expect(deps.recordSendRequested.mock.invocationCallOrder[0])
    .toBeLessThan(deps.sendEmail.mock.invocationCallOrder[0]);
  expect(deps.updateDeliverable).toHaveBeenCalledWith(
    message().deliverable_id,
    expect.objectContaining({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT }),
    { ifMatch: 'W/"1"' },
  );
});

test('a source that is no longer Invited is stopped before token mint or email creation', async () => {
  const deps = dependencies();
  deps.getDeliverable.mockResolvedValue({ wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.SUBMITTED });
  deps.cancelForSource.mockResolvedValue({ ...message(), status: 'stopped', stopped_at: '2026-08-25T00:00:00Z' });

  const result = await deliverScheduledEmail(message().id, {}, deps);
  expect(result.stopped).toBe(true);
  expect(deps.mintForRequest).not.toHaveBeenCalled();
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('a transient eligibility read failure keeps the row retryable instead of stopping it', async () => {
  const deps = dependencies();
  const transient = Object.assign(new Error('dataverse failed (503)'), { status: 503 });
  deps.getDeliverable.mockRejectedValue(transient);

  await expect(deliverScheduledEmail(message().id, {}, deps)).rejects.toThrow('dataverse failed (503)');
  expect(deps.cancelForSource).not.toHaveBeenCalled();
  expect(deps.recordFailure).toHaveBeenCalled();
  expect(deps.mintForRequest).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('a confirmed-deleted source (404) is stopped, not retried', async () => {
  const deps = dependencies();
  const gone = Object.assign(new Error('dataverse failed (404)'), { status: 404 });
  deps.getDeliverable.mockRejectedValue(gone);
  deps.cancelForSource.mockResolvedValue({ ...message(), status: 'stopped', stopped_at: '2026-08-25T00:00:00Z' });

  const result = await deliverScheduledEmail(message().id, {}, deps);
  expect(result.stopped).toBe(true);
  expect(deps.recordFailure).not.toHaveBeenCalled();
  expect(deps.mintForRequest).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
});

test('an accepted correlated Dynamics activity is reconciled without minting or sending again', async () => {
  const base = message({ dynamics_email_id: null });
  const deps = dependencies(base);
  deps.findEmailByCorrelation.mockResolvedValue([{
    activityid: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    statuscode: 6,
    statecode: 1,
  }]);
  deps.recordEmailActivity.mockImplementation(async (claimed) => ({
    ...claimed,
    dynamics_email_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  }));

  await deliverScheduledEmail(base.id, {}, deps);
  expect(deps.mintForRequest).not.toHaveBeenCalled();
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.recordSent).toHaveBeenCalled();
});

/* ------------------------------ digest tests ----------------------------- */

function digestRow(over = {}) {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
    pd_systemuser_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pd_name: 'Jean Kim',
    pd_email: 'jean@example.org',
    recipient_name: 'Professor Reiter',
    subject: 'Reminder: abstract due',
    scheduled_send_at: '2026-08-30T08:00:00.000Z',
    status: 'scheduled',
    approval_required: false,
    approved_at: null,
    ...over,
  };
}

test('digest grouping places each row in exactly one section per PD', () => {
  const rows = [
    digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', approval_required: true }),
    digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' }),
    digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', approval_required: true, approved_at: '2026-08-25T00:00:00Z' }),
    digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', status: 'sent' }),
    digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', pd_systemuser_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1' }),
  ];
  const groups = groupDigestRowsByPd(rows);
  expect(groups).toHaveLength(2);
  const jean = groups.find((g) => g.pdSystemUserId === 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  expect(jean.approvalPending.map((r) => r.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1']);
  // An approved approval_required row is "upcoming", not pending.
  expect(jean.upcoming.map((r) => r.id)).toEqual([
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
  ]);
  expect(jean.sentFyi.map((r) => r.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4']);
});

function digestDeps(existing = null) {
  return {
    findEmailByCorrelation: jest.fn(async () => (existing ? [existing] : [])),
    createEmailActivity: jest.fn(async () => 'digest-email-1'),
    getEmailActivity: jest.fn(async () => ({ activityid: 'digest-email-1', statuscode: 1 })),
    sendEmail: jest.fn(async () => undefined),
    markDigestFyi: jest.fn(async (ids) => ids.length),
  };
}

test('digest sends once per PD per day, mentions each section, and stamps FYI receipts', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps();
  const group = {
    pdSystemUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pdName: 'Jean Kim',
    pdEmail: 'jean@example.org',
    approvalPending: [digestRow({ approval_required: true })],
    upcoming: [digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' })],
    sentFyi: [digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', status: 'sent' })],
  };
  const outcome = await sendScheduledEmailDigest(group, deps);
  expect(outcome).toEqual({ sent: true, fyiStamped: 1 });
  const created = deps.createEmailActivity.mock.calls[0][0];
  expect(created.to).toBe('jean@example.org');
  expect(created.correlationKey).toMatch(/^wmkf-scheduled-digest:dddddddd-dddd-4ddd-8ddd-dddddddddddd:\d{4}-\d{2}-\d{2}$/);
  expect(created.body).toContain('Waiting on your approval');
  expect(created.body).toContain('Sending soon unless you act');
  expect(created.body).toContain('Sent on your behalf');
  expect(deps.sendEmail).toHaveBeenCalledWith('digest-email-1');
  expect(deps.markDigestFyi).toHaveBeenCalledWith(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4']);
});

test('a cron retry after an accepted digest skips the send but still stamps FYIs', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps({ activityid: 'digest-email-1', statuscode: 6 });
  const group = {
    pdSystemUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pdName: 'Jean Kim',
    pdEmail: 'jean@example.org',
    approvalPending: [],
    upcoming: [],
    sentFyi: [digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', status: 'sent' })],
  };
  const outcome = await sendScheduledEmailDigest(group, deps);
  expect(outcome).toEqual({ sent: true, fyiStamped: 1 });
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.markDigestFyi).toHaveBeenCalledWith(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4']);
});

/* --------------------------- approval guard pin -------------------------- */

test('the store claim and due-list SQL both refuse unapproved approval_required rows', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const guard = /approval_required = false\s*\n\s*OR approved_at IS NOT NULL/;
  const claimSection = store.slice(store.indexOf('claimScheduledEmailSend'));
  const dueSection = store.slice(store.indexOf('listDueScheduledEmails'), store.indexOf('listUnfinalizedScheduledEmails'));
  expect(claimSection).toMatch(guard);
  expect(dueSection).toMatch(/approval_required = false OR approved_at IS NOT NULL/);
  // force (the PD's version-fenced send-now) must be the only bypass.
  expect(claimSection).toContain('${force}::boolean = true\n            OR approval_required = false');
});
