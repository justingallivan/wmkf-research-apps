/**
 * /api/cron/grantee-deliverable-reminders
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/cron-auth', () => ({ verifyCronSecret: jest.fn(() => true) }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (_label, fn) => Promise.resolve().then(fn),
}));
jest.mock('../../lib/services/dynamics-service', () => ({
  DynamicsService: {
    queryAllRecords: jest.fn(),
    getRecord: jest.fn(),
    updateRecord: jest.fn(),
    createAndSendEmail: jest.fn(),
  },
}));
jest.mock('../../lib/services/settings-service', () => ({
  getSettingStrict: jest.fn(),
}));
jest.mock('../../lib/services/notification-service', () => ({
  __esModule: true,
  default: { notify: jest.fn(async () => ({ id: 1 })) },
}));
jest.mock('../../lib/external/grantee-token-lifecycle', () => ({
  mintForRequest: jest.fn(async ({ requestId }) => ({ url: `https://app.example.org/external/grantee/${requestId}` })),
}));
jest.mock('../../lib/services/email-signature', () => ({
  resolveSignatureForRequest: jest.fn(async () => ({
    signature: 'Assigned PD\nW. M. Keck Foundation',
    name: 'Assigned PD',
    email: 'assigned.pd@wmkeck.org',
  })),
}));
jest.mock('../../lib/services/email-automation-preferences', () => ({
  getEmailAutomationPreferenceForSystemUser: jest.fn(async () => null),
}));
jest.mock('../../lib/services/scheduled-email-store', () => ({
  createOrGetScheduledEmail: jest.fn(),
  listScheduledEmailsNeedingNotification: jest.fn(async () => []),
  listDueScheduledEmails: jest.fn(async () => []),
  listUnfinalizedScheduledEmails: jest.fn(async () => []),
}));
jest.mock('../../lib/services/scheduled-email-service', () => ({
  scheduledSendAtForInvitation: jest.fn((value) => new Date(new Date(value).getTime() + 12 * 86400000)),
  notifyScheduledEmailReview: jest.fn(),
  deliverScheduledEmail: jest.fn(),
  finalizeScheduledEmail: jest.fn(),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import { getSettingStrict } from '../../lib/services/settings-service';
import NotificationService from '../../lib/services/notification-service';
import { resolveSignatureForRequest } from '../../lib/services/email-signature';
import { getEmailAutomationPreferenceForSystemUser } from '../../lib/services/email-automation-preferences';
import * as scheduledEmailStore from '../../lib/services/scheduled-email-store';
import {
  deliverScheduledEmail,
  finalizeScheduledEmail,
  notifyScheduledEmailReview,
} from '../../lib/services/scheduled-email-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import handler from '../../pages/api/cron/grantee-deliverable-reminders';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

const req = () => ({ method: 'GET', query: {}, headers: {} });
const SUBJECT_KEY = 'email.grantee_reminder.subject';
const BODY_KEY = 'email.grantee_reminder.body';
const SUBJECT = 'Reminder: your W. M. Keck Foundation abstract';
const BODY =
  'Dear Professor [Name],\n\n' +
  'I’m following up on the abstract for your recent W. M. Keck Foundation award entitled “[title]”. ' +
  'We’d welcome any changes to the draft, and an image to accompany it, before we post your award on the ' +
  'Foundation’s website.\n\n' +
  'Please use your secure link below by COB [date]. If we have not heard from you by then, we will post ' +
  'the draft abstract as written. If you have already submitted, thank you — no further action is needed.\n\n' +
  'Please do not hesitate to contact me if you need additional information.\n\n' +
  'Thank you,\n\n' +
  '[Program Director signature]';
const deliv = (n, invitedDate = '2026-06-08T00:00:00.000Z') => ({
  wmkf_granteedeliverableid: `d${n}`,
  _wmkf_request_value: `r${n}`,
  wmkf_inviteddate: invitedDate,
  _etag: `W/"${n}"`,
});
const requestRow = (n, over = {}) => ({
  akoya_requestid: `r${n}`,
  akoya_requestnum: `100${n}`,
  akoya_title: `Award ${n}`,
  _wmkf_projectleader_value: `pi${n}`,
  _akoya_primarycontactid_value: `liaison${n}`,
  _wmkf_programdirector_value: `pd${n}`,
  ...over,
});
const contactRow = (id) => ({
  contactid: id,
  fullname: id.startsWith('pi') ? `Professor ${id}` : `Liaison ${id}`,
  emailaddress1: `${id}@example.edu`,
});
const pdRow = (id) => ({
  systemuserid: id,
  fullname: `PD ${id}`,
  internalemailaddress: `${id}@wmkeck.org`,
  title: 'Program Director',
  isdisabled: false,
});

beforeEach(() => {
  verifyCronSecret.mockReset().mockReturnValue(true);
  getSettingStrict.mockReset().mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: SUBJECT };
    if (key === BODY_KEY) return { found: true, value: BODY };
    throw new Error(`unexpected setting ${key}`);
  });
  NotificationService.notify.mockClear().mockResolvedValue({ id: 1 });
  DynamicsService.queryAllRecords.mockReset().mockResolvedValue({ records: [], totalCount: 0, capped: false });
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  DynamicsService.createAndSendEmail.mockReset().mockResolvedValue({ emailId: 'email-1' });
  resolveSignatureForRequest.mockClear();
  getEmailAutomationPreferenceForSystemUser.mockClear().mockResolvedValue(null);
  scheduledEmailStore.createOrGetScheduledEmail.mockReset().mockResolvedValue({ id: 'scheduled-1' });
  scheduledEmailStore.listScheduledEmailsNeedingNotification.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listDueScheduledEmails.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listUnfinalizedScheduledEmails.mockReset().mockResolvedValue([]);
  notifyScheduledEmailReview.mockReset();
  deliverScheduledEmail.mockReset();
  finalizeScheduledEmail.mockReset();
  DynamicsService.getRecord.mockReset().mockImplementation((entitySet, id) => {
    if (entitySet === 'akoya_requests') return Promise.resolve(requestRow(id.slice(1)));
    if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
    if (entitySet === 'systemusers') return Promise.resolve(pdRow(id));
    return Promise.reject(new Error(`unexpected ${entitySet}`));
  });
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-06-20T00:00:00.000Z'));
});

afterEach(() => {
  Date.now.mockRestore();
});

test('selection scans all Invited rows so per-PD review windows can be calculated', async () => {
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(200);
  const { filter } = DynamicsService.queryAllRecords.mock.calls[0][1];
  expect(filter).toContain(`wmkf_deliverablestatus eq ${GRANTEE_DELIVERABLE_STATUS.INVITED}`);
  expect(filter).toContain('wmkf_inviteddate ne null');
  expect(filter).not.toContain('wmkf_inviteddate le');
});

test('unconfigured rollout compatibility still excludes a day-11 reminder', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [deliv(1, '2026-06-09T00:00:00.000Z')], totalCount: 1, capped: false,
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.reminded).toBe(0);
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('claims before sending and sends with noFallback as the PD', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.reminded).toBe(1);
  const claimCall = DynamicsService.updateRecord.mock.calls[0];
  expect(claimCall).toEqual([
    'wmkf_granteedeliverables',
    'd1',
    { wmkf_deliverablestatus: GRANTEE_DELIVERABLE_STATUS.REMINDER_SENT },
    { ifMatch: 'W/"1"' },
  ]);
  expect(DynamicsService.updateRecord.mock.invocationCallOrder[0])
    .toBeLessThan(DynamicsService.createAndSendEmail.mock.invocationCallOrder[0]);
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0]).toMatchObject({
    subject: SUBJECT,
    from: 'pd1@wmkeck.org',
    to: 'pi1@example.edu',
    cc: 'liaison1@example.edu',
    regardingId: 'r1',
    regardingType: 'akoya_request',
    actingUserSystemId: 'pd1',
    noFallback: true,
  });
  expect(resolveSignatureForRequest).toHaveBeenCalledWith('r1');
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].body).toContain('Assigned PD');
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].body).toContain(
    'This automated reminder was sent by the W. M. Keck Foundation on behalf of PD pd1.',
  );
});

test('default read is applied to grantee reminder subject and body', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: 'Custom grantee reminder subject' };
    if (key === BODY_KEY) return {
      found: true,
      value: 'Hello Professor [Name]\n\nAward [title] is due by COB [date].\n\n[Program Director signature]',
    };
    throw new Error(`unexpected setting ${key}`);
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.reminded).toBe(1);
  const email = DynamicsService.createAndSendEmail.mock.calls[0][0];
  expect(email.subject).toBe('Custom grantee reminder subject');
  // [Name] now renders the SURNAME only (consistent with the grantee invite),
  // so "Professor pi1" → "pi1" — no doubled title.
  expect(email.body).toContain('Hello Professor pi1');
  expect(email.body).toContain('Award Award 1 is due by COB June 22, 2026.');
  expect(email.body).toContain('Assigned PD');
});

test('a review-mode PD gets a durable draft three days before the established send without an early recipient email', async () => {
  getEmailAutomationPreferenceForSystemUser.mockResolvedValue({ mode: 'review', leadDays: 3 });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.scheduled).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
    workflowType: 'grantee_abstract_reminder',
    sourceRecordId: 'd1',
    pdSystemUserId: 'pd1',
    reviewLeadDays: 3,
    scheduledSendAt: '2026-06-20T00:00:00.000Z',
    reviewAvailableAt: '2026-06-17T00:00:00.000Z',
  }));
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('a preference read failure never falls through to the legacy automatic send', async () => {
  getEmailAutomationPreferenceForSystemUser.mockRejectedValue(new Error('Dataverse preference read failed'));
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.preferenceFailed).toBe(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('blank grantee reminder default skips before claim and alerts admins', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: '   ' };
    if (key === BODY_KEY) return { found: true, value: BODY };
    throw new Error(`unexpected setting ${key}`);
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.skippedMisconfigured).toBe(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'email_default_misconfigured',
    emailAdmins: true,
    autoResolveKey: `email-default-misconfigured:${SUBJECT_KEY}`,
    metadata: expect.objectContaining({ reason: 'blank' }),
  }));
});

test('unavailable grantee reminder default skips before claim and alerts admins', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: SUBJECT };
    if (key === BODY_KEY) throw new Error('Dynamics 503');
    throw new Error(`unexpected setting ${key}`);
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.skippedMisconfigured).toBe(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'email_default_misconfigured',
    emailAdmins: true,
    autoResolveKey: `email-default-misconfigured:${BODY_KEY}`,
    metadata: expect.objectContaining({ reason: 'unavailable' }),
  }));
  expect(NotificationService.notify.mock.invocationCallOrder[0])
    .toBeLessThan(DynamicsService.queryAllRecords.mock.invocationCallOrder[0]);
});

test('a frozen due message still sends when the current shared defaults are unavailable', async () => {
  getSettingStrict.mockRejectedValue(new Error('Dynamics settings unavailable'));
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  scheduledEmailStore.listDueScheduledEmails.mockResolvedValue([{ id: 'scheduled-due-1' }]);
  deliverScheduledEmail.mockResolvedValue({ sent: true });

  const res = mockRes();
  await handler(req(), res);

  expect(res.body.skippedMisconfigured).toBe(1);
  expect(res.body.reminded).toBe(1);
  expect(deliverScheduledEmail).toHaveBeenCalledWith('scheduled-due-1');
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('send failure after claim is reported and not finalized, preventing next-run double-send', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.createAndSendEmail.mockRejectedValue(new Error('403 impersonation rejected'));
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.sendFailed).toBe(1);
  expect(res.body.reminded).toBe(0);
  expect(DynamicsService.updateRecord).toHaveBeenCalledTimes(1); // claim only; no finalize
  expect(DynamicsService.createAndSendEmail.mock.calls[0][0].noFallback).toBe(true);
});

test('missing PD skips before claim or send', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.getRecord.mockImplementation((entitySet, id) => {
    if (entitySet === 'akoya_requests') return Promise.resolve(requestRow(1, { _wmkf_programdirector_value: null }));
    if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
    return Promise.reject(new Error('unexpected'));
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.skippedNoPd).toBe(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('missing PD title no longer skips the reminder', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.getRecord.mockImplementation((entitySet, id) => {
    if (entitySet === 'akoya_requests') return Promise.resolve(requestRow(1));
    if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
    if (entitySet === 'systemusers') return Promise.resolve({ ...pdRow(id), title: null });
    return Promise.reject(new Error('unexpected'));
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.reminded).toBe(1);
  expect(res.body.skippedNoPd).toBe(0);
  expect(DynamicsService.createAndSendEmail).toHaveBeenCalled();
});

test('missing recipient skips before claim or send', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.getRecord.mockImplementation((entitySet, id) => {
    if (entitySet === 'akoya_requests') return Promise.resolve(requestRow(1));
    if (entitySet === 'contacts' && id === 'pi1') return Promise.resolve({ ...contactRow(id), emailaddress1: null });
    if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
    if (entitySet === 'systemusers') return Promise.resolve(pdRow(id));
    return Promise.reject(new Error('unexpected'));
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.skippedNoRecipient).toBe(1);
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('capped query reports deferred unreturned rows', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 3, capped: true });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.capped).toBe(true);
  expect(res.body.deferred).toBe(2);
});

// ── Stage 5 Phase A gap fill — envelope pins ────────────────────────────────
test('405s a disallowed method with Allow header + pinned envelope, before the cron gate', async () => {
  const res = mockRes();
  await handler({ method: 'PUT', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.body).toEqual({ error: 'Method not allowed' });
  expect(res.headers.Allow).toBe('GET, POST');
  expect(verifyCronSecret).not.toHaveBeenCalled();
});

test('cron secret rejection short-circuits before any query', async () => {
  verifyCronSecret.mockReturnValue(false);
  const res = mockRes();
  await handler(req(), res);
  expect(DynamicsService.queryAllRecords).not.toHaveBeenCalled();
  expect(getSettingStrict).not.toHaveBeenCalled();
});

test('query failure → 503 pinned envelope (whole run retried next tick)', async () => {
  DynamicsService.queryAllRecords.mockRejectedValue(new Error('dataverse down'));
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: 'Deliverable query failed.' });
});

test('200 summary envelope pinned exactly', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({
    totalCount: 1,
    scanned: 1,
    reminded: 1,
    skippedNoPd: 0,
    skippedNoRecipient: 0,
    skippedMisconfigured: 0,
    claimFailed: 0,
    sendFailed: 0,
    scheduled: 0,
    notified: 0,
    notificationFailed: 0,
    stoppedNoLongerEligible: 0,
    preferenceFailed: 0,
    finalizeFailed: 0,
    capped: false,
    deferred: 0,
    failures: [],
  });
});

test('IDEMPOTENCY (claim-before-send): 412 on the claim means another run owns the row — no email', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.updateRecord.mockRejectedValueOnce(Object.assign(new Error('precondition failed'), { status: 412 }));
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.claimFailed).toBe(1);
  expect(res.body.reminded).toBe(0);
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('per-row send failure is isolated from a later successful row', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1), deliv(2)], totalCount: 2, capped: false });
  DynamicsService.createAndSendEmail
    .mockRejectedValueOnce(new Error('send down'))
    .mockResolvedValueOnce({ emailId: 'email-2' });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.sendFailed).toBe(1);
  expect(res.body.reminded).toBe(1);
});
