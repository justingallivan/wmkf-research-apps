/** @jest-environment node */

import {
  deliverScheduledEmail,
  renderScheduledEmailPreview,
  scheduledSendAtForInvitation,
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
    review_available_at: '2026-08-27T08:00:00.000Z',
    review_lead_days: 3,
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
