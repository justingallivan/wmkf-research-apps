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

function digestDeps(claimResult, existing = null) {
  return {
    claimDigestRun: jest.fn(async () => claimResult),
    recordDigestRunActivity: jest.fn(async () => undefined),
    markDigestRunAccepted: jest.fn(async () => undefined),
    markDigestRunFyiStamped: jest.fn(async () => undefined),
    findEmailByCorrelation: jest.fn(async () => (existing ? [existing] : [])),
    createEmailActivity: jest.fn(async () => 'digest-email-1'),
    getEmailActivity: jest.fn(async () => ({ activityid: 'digest-email-1', statuscode: 1 })),
    sendEmail: jest.fn(async () => undefined),
    markDigestFyi: jest.fn(async (ids) => ids.length),
  };
}

function digestGroup(sentFyi) {
  return {
    pdSystemUserId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    pdName: 'Jean Kim',
    pdEmail: 'jean@example.org',
    approvalPending: [digestRow({ approval_required: true })],
    upcoming: [digestRow({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2' })],
    sentFyi,
  };
}

const FYI_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
const FYI_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';

test('digest claims the run, records the activity before transport, mentions each section, and stamps the run membership', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps({
    claimed: true,
    run: { fyi_message_ids: [FYI_A], activity_id: null, accepted_at: null },
  });
  const group = digestGroup([digestRow({ id: FYI_A, status: 'sent' })]);
  const outcome = await sendScheduledEmailDigest(group, deps);
  expect(outcome).toEqual({ sent: true, fyiStamped: 1 });
  expect(deps.claimDigestRun.mock.calls[0][0].fyiMessageIds).toEqual([FYI_A]);
  const created = deps.createEmailActivity.mock.calls[0][0];
  expect(created.to).toBe('jean@example.org');
  expect(created.correlationKey).toMatch(/^wmkf-scheduled-digest:dddddddd-dddd-4ddd-8ddd-dddddddddddd:\d{4}-\d{2}-\d{2}$/);
  expect(created.body).toContain('Waiting on your approval');
  expect(created.body).toContain('Sending soon unless you act');
  expect(created.body).toContain('Sent on your behalf');
  // Activity identity persisted BEFORE the transport request.
  expect(deps.recordDigestRunActivity.mock.invocationCallOrder[0])
    .toBeLessThan(deps.sendEmail.mock.invocationCallOrder[0]);
  expect(deps.sendEmail).toHaveBeenCalledWith('digest-email-1');
  expect(deps.markDigestRunAccepted).toHaveBeenCalled();
  expect(deps.markDigestFyi).toHaveBeenCalledWith([FYI_A]);
  expect(deps.markDigestRunFyiStamped).toHaveBeenCalled();
});

test('recovery of an accepted run stamps ONLY the frozen membership — a row sent after the digest stays unreceipted', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps({
    claimed: false,
    run: { fyi_message_ids: [FYI_A], activity_id: 'digest-email-1', accepted_at: '2026-08-26T08:00:00Z' },
  });
  // The freshly built group ALSO contains FYI_B, sent after the digest went
  // out. The old (defective) code stamped it; the fix must not.
  const group = digestGroup([
    digestRow({ id: FYI_A, status: 'sent' }),
    digestRow({ id: FYI_B, status: 'sent' }),
  ]);
  const outcome = await sendScheduledEmailDigest(group, deps);
  expect(outcome).toEqual({ sent: false, recovered: true, fyiStamped: 1 });
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.markDigestFyi).toHaveBeenCalledWith([FYI_A]);
  expect(deps.markDigestFyi).not.toHaveBeenCalledWith(expect.arrayContaining([FYI_B]));
});

test('a live concurrent invocation holding the lease is skipped without any Dynamics work or stamping', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps({
    claimed: false,
    run: { fyi_message_ids: [FYI_A], activity_id: null, accepted_at: null },
  });
  const outcome = await sendScheduledEmailDigest(digestGroup([digestRow({ id: FYI_A, status: 'sent' })]), deps);
  expect(outcome).toEqual({ sent: false, skipped: true, fyiStamped: 0 });
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).not.toHaveBeenCalled();
  expect(deps.markDigestFyi).not.toHaveBeenCalled();
});

test('a crashed run with a recorded activity resumes: no second create, send completes, frozen membership stamped', async () => {
  process.env.NEXTAUTH_URL = 'https://apps.example.org';
  process.env.NOTIFICATION_EMAIL_FROM = 'apps@wmkeck.org';
  const deps = digestDeps({
    claimed: true,
    run: { fyi_message_ids: [FYI_A], activity_id: 'digest-email-1', accepted_at: null },
  });
  const group = digestGroup([
    digestRow({ id: FYI_A, status: 'sent' }),
    digestRow({ id: FYI_B, status: 'sent' }),
  ]);
  const outcome = await sendScheduledEmailDigest(group, deps);
  expect(outcome).toEqual({ sent: true, fyiStamped: 1 });
  expect(deps.createEmailActivity).not.toHaveBeenCalled();
  expect(deps.sendEmail).toHaveBeenCalledWith('digest-email-1');
  expect(deps.markDigestFyi).toHaveBeenCalledWith([FYI_A]);
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
  // Editing a draft must clear approval: an edited approval-required draft
  // re-enters approval-pending instead of sending the unreviewed edit.
  const editSection = store.slice(
    store.indexOf('updateScheduledEmailDraft'),
    store.indexOf('approveScheduledEmail'),
  );
  expect(editSection).toContain('approved_at = NULL');
});

test('the digest-run claim SQL freezes membership and the reassign SQL guards atomically', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  // MEMBERSHIP FREEZE: the ON CONFLICT lease re-claim must never rewrite
  // fyi_message_ids — an unrecorded activity may already hold the first
  // render, and recovery stamps at most the first claim's membership.
  const claimSection = store.slice(
    store.indexOf('export async function claimDigestRun'),
    store.indexOf('export async function recordDigestRunActivity'),
  );
  const doUpdate = claimSection.slice(claimSection.indexOf('DO UPDATE'), claimSection.indexOf('RETURNING'));
  expect(doUpdate).not.toContain('fyi_message_ids');
  expect(doUpdate).toContain('accepted_at IS NULL');
  expect(doUpdate).toMatch(/locked_until IS NULL\s*\n\s*OR scheduled_email_digest_runs\.locked_until < NOW\(\)/);
  // PD HANDOFF: the rebuild guard is atomic in SQL — only an unsent,
  // transport-free, unleased row owned by a DIFFERENT PD is rebuilt;
  // approval is cleared.
  const reassignSection = store.slice(
    store.indexOf('export async function reassignScheduledEmail'),
    store.indexOf('/* --------------------------- digest run ledger'),
  );
  expect(reassignSection).toContain('pd_systemuser_id <> ${input.pdSystemUserId}');
  expect(reassignSection).toContain("status IN ('scheduled', 'failed')");
  expect(reassignSection).toContain('dynamics_email_id IS NULL');
  expect(reassignSection).toContain('send_requested_at IS NULL');
  expect(reassignSection).toContain('(locked_until IS NULL OR locked_until < NOW())');
  expect(reassignSection).toContain('approved_at = NULL');
  expect(reassignSection).toContain('version = version + 1');
});

test('reviewer VIP flag SQL keys on potential_reviewer_id, never contact_id', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const section = store.slice(
    store.indexOf('export async function setReviewerVipFlag'),
    store.indexOf('/** Returns the subset of contactIds'),
  );
  expect(section).toContain('scheduled_email_reviewer_vip_flags');
  expect(section).toContain('potential_reviewer_id');
  expect(section).not.toContain('contact_id');
});

/* ------------------- reviewer workflow dispatch (ledger slice) ------------------- */

jest.mock('../../lib/services/reviewer-reminder-workflows', () => ({
  REVIEWER_REMINDER_STRATEGIES: {
    reviewer_respond_reminder: {
      checkEligibility: jest.fn(),
      buildActivityInput: jest.fn(),
      finalize: jest.fn(async () => null),
      previewHtml: jest.fn(() => '<p>reviewer preview</p>'),
      noticeText: jest.fn(() => 'reviewer notice'),
    },
  },
}));

describe('reviewer workflow dispatch', () => {
  const { REVIEWER_REMINDER_STRATEGIES } = require('../../lib/services/reviewer-reminder-workflows');
  const strategy = REVIEWER_REMINDER_STRATEGIES.reviewer_respond_reminder;

  function reviewerMessage(overrides = {}) {
    return message({
      workflow_type: 'reviewer_respond_reminder',
      deliverable_id: null,
      ...overrides,
    });
  }

  function reviewerDeps(base) {
    const deps = dependencies(base);
    deps.claimSend = jest.fn(async () => ({ ...base, status: 'sending' }));
    deps.deferSend = jest.fn(async (msg, at) => ({ ...msg, status: 'scheduled', scheduled_send_at: at }));
    return deps;
  }

  beforeEach(() => {
    strategy.checkEligibility.mockReset();
    strategy.buildActivityInput.mockReset();
    strategy.finalize.mockReset().mockResolvedValue(null);
    strategy.previewHtml.mockClear();
    strategy.noticeText.mockClear();
  });

  test('a defer verdict releases the claim to the recomputed time — no activity, no send', async () => {
    const base = reviewerMessage();
    const deps = reviewerDeps(base);
    const newAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    strategy.checkEligibility.mockResolvedValue({ defer: newAt });

    const result = await deliverScheduledEmail(base.id, {}, deps);

    expect(result.deferred).toBe(true);
    expect(deps.deferSend).toHaveBeenCalledWith(expect.objectContaining({ id: base.id }), newAt);
    expect(strategy.buildActivityInput).not.toHaveBeenCalled();
    expect(deps.createEmailActivity).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.cancelForSource).not.toHaveBeenCalled();
  });

  test('a stop verdict cancels the row — no activity, no send', async () => {
    const base = reviewerMessage();
    const deps = reviewerDeps(base);
    deps.cancelForSource = jest.fn(async () => ({ ...base, status: 'stopped', stopped_at: 'now' }));
    strategy.checkEligibility.mockResolvedValue({ stop: true, reason: 'already_reminded' });

    const result = await deliverScheduledEmail(base.id, {}, deps);

    expect(result.stopped).toBe(true);
    expect(deps.cancelForSource).toHaveBeenCalledWith(base.id);
    expect(strategy.buildActivityInput).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  test('an eligible verdict runs the full skeleton with the strategy payload; grantee finalize never touches Dataverse', async () => {
    const base = reviewerMessage();
    const deps = reviewerDeps(base);
    const ctx = { row: { _etag: 'W/"9"' }, request: {} };
    strategy.checkEligibility.mockResolvedValue({ eligible: true, ctx });
    strategy.buildActivityInput.mockResolvedValue({
      subject: base.subject, body: '<p>html-with-token</p>', from: base.pd_email,
      to: ['rev@example.org'], cc: [], regardingId: base.request_id,
      regardingType: 'akoya_request', actingUserSystemId: base.pd_systemuser_id, noFallback: true,
    });

    const result = await deliverScheduledEmail(base.id, {}, deps);

    expect(result.sent).toBe(true);
    expect(strategy.buildActivityInput).toHaveBeenCalledWith(
      expect.objectContaining({ id: base.id }), ctx,
    );
    expect(deps.createEmailActivity).toHaveBeenCalledWith(expect.objectContaining({
      body: '<p>html-with-token</p>',
      noFallback: true,
      correlationKey: expect.stringContaining(base.id),
    }));
    expect(strategy.finalize).toHaveBeenCalled();
    expect(deps.recordFinalized).toHaveBeenCalled();
    // The grantee finalize path (deliverable status write) must NOT run.
    expect(deps.getDeliverable).not.toHaveBeenCalled();
    expect(deps.updateDeliverable).not.toHaveBeenCalled();
  });
});

/* -------------------- new store helper guards (SQL structure) -------------------- */

test('cancelScheduledEmailBySource refuses in-flight rows and held leases', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const section = store.slice(
    store.indexOf('export async function cancelScheduledEmailBySource'),
    store.indexOf('export async function deferScheduledEmailSend'),
  );
  expect(section).toContain("status IN ('scheduled', 'failed')");
  expect(section).not.toContain("'sending'");
  expect(section).toContain('(locked_until IS NULL OR locked_until < NOW())');
});

test('deferScheduledEmailSend is lease-guarded and refuses transport-started rows', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const section = store.slice(
    store.indexOf('export async function deferScheduledEmailSend'),
    store.indexOf('export async function claimScheduledEmailSend'),
  );
  expect(section).toContain('lease_token = ${message.lease_token}');
  expect(section).toContain("status = 'sending'");
  expect(section).toContain('dynamics_email_id IS NULL');
  expect(section).toContain("status = 'scheduled'");
});

test('reviveStoppedScheduledEmail only resurrects stopped, never-transported, unleased rows', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const section = store.slice(
    store.indexOf('export async function reviveStoppedScheduledEmail'),
    store.indexOf('export async function refreshUntouchedScheduledEmail'),
  );
  expect(section).toContain("status = 'stopped'");
  expect(section).toContain('dynamics_email_id IS NULL');
  expect(section).toContain('send_requested_at IS NULL');
  expect(section).toContain('(locked_until IS NULL OR locked_until < NOW())');
  expect(section).toContain('approved_at = NULL');
  expect(section).toContain('version = version + 1');
});

test('refreshUntouchedScheduledEmail defers to any PD touch and never refreshes posture', () => {
  const store = fs.readFileSync(
    path.join(process.cwd(), 'lib/services/scheduled-email-store.js'),
    'utf8',
  );
  const section = store.slice(
    store.indexOf('export async function refreshUntouchedScheduledEmail'),
    store.indexOf('export async function cancelScheduledEmailBySource'),
  );
  expect(section).toContain('edited_at IS NULL');
  expect(section).toContain('approved_at IS NULL');
  expect(section).toContain('dynamics_email_id IS NULL');
  expect(section).toContain('pd_systemuser_id = ${input.pdSystemUserId}');
  // Posture freezes at creation/revive/reassign — a refresh must not touch it.
  expect(section).not.toContain('approval_required =');
});
