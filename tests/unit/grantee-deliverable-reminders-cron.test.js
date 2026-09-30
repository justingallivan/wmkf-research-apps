/**
 * /api/cron/grantee-deliverable-reminders
 *
 * VIP/digest decision layer (docs/SCHEDULED_EMAIL_VIP_DIGEST_PLAN.md): every
 * Invited row becomes a durable ledger entry on first sight; the cron never
 * sends recipient mail directly; digests are the only notification surface.
 * Default fixtures have a blank program (Request-copy Liaison); the Research
 * institution-Liaison cases are in the 'Liaison of record' block
 * (docs/plans/LIAISON_FROM_INSTITUTION_PLAN_2026-09-29.md reader 2).
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
    queryRecords: jest.fn(),
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
  reassignScheduledEmail: jest.fn(),
  filterVipFlaggedContacts: jest.fn(async () => new Set()),
  listScheduledEmailDigestRows: jest.fn(async () => []),
  listDueScheduledEmails: jest.fn(async () => []),
  listUnfinalizedScheduledEmails: jest.fn(async () => []),
  listScheduledEmailReconciliationCandidates: jest.fn(async () => []),
  listStoppedScheduledEmailsWithSendIntent: jest.fn(async () => []),
}));
jest.mock('../../lib/services/scheduled-email-service', () => ({
  scheduledSendAtForInvitation: jest.fn((value) => new Date(new Date(value).getTime() + 12 * 86400000)),
  groupDigestRowsByPd: jest.fn(() => []),
  sendScheduledEmailDigest: jest.fn(),
  deliverScheduledEmail: jest.fn(),
  finalizeScheduledEmail: jest.fn(),
  reconcileScheduledEmailCandidate: jest.fn(),
  reconcileStoppedScheduledEmail: jest.fn(),
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
  groupDigestRowsByPd,
  sendScheduledEmailDigest,
  reconcileScheduledEmailCandidate,
  reconcileStoppedScheduledEmail,
} from '../../lib/services/scheduled-email-service';
import { GRANTEE_DELIVERABLE_STATUS } from '../../shared/config/granteeDeliverableStatus';
import { RESEARCH_PROGRAM_IDS } from '../../shared/config/researchPrograms';
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
  'Please use your secure link below by COB [date].\n\n' +
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
  _akoya_programid_value: null,
  _akoya_applicantid_value: null,
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
  DynamicsService.queryRecords.mockReset().mockRejectedValue(new Error('unexpected account read'));
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  DynamicsService.createAndSendEmail.mockReset().mockResolvedValue({ emailId: 'email-1' });
  resolveSignatureForRequest.mockClear();
  getEmailAutomationPreferenceForSystemUser.mockClear().mockResolvedValue(null);
  // pd_systemuser_id matches the fixtures' current PD (pd1) so the default
  // path exercises no handoff drift.
  scheduledEmailStore.createOrGetScheduledEmail.mockReset().mockResolvedValue({ id: 'scheduled-1', pd_systemuser_id: 'pd1', status: 'scheduled' });
  scheduledEmailStore.reassignScheduledEmail.mockReset();
  scheduledEmailStore.filterVipFlaggedContacts.mockReset().mockResolvedValue(new Set());
  scheduledEmailStore.listScheduledEmailDigestRows.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listDueScheduledEmails.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listUnfinalizedScheduledEmails.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listScheduledEmailReconciliationCandidates.mockReset().mockResolvedValue([]);
  scheduledEmailStore.listStoppedScheduledEmailsWithSendIntent.mockReset().mockResolvedValue([]);
  reconcileScheduledEmailCandidate.mockReset();
  reconcileStoppedScheduledEmail.mockReset();
  groupDigestRowsByPd.mockReset().mockReturnValue([]);
  sendScheduledEmailDigest.mockReset();
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
  delete process.env.TEST_REQUEST_ISOLATION;
});

test('selection scans all Invited rows with an invite date', async () => {
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(200);
  const { filter } = DynamicsService.queryAllRecords.mock.calls[0][1];
  expect(filter).toContain(`wmkf_deliverablestatus eq ${GRANTEE_DELIVERABLE_STATUS.INVITED}`);
  expect(filter).toContain('wmkf_inviteddate ne null');
  expect(filter).not.toContain('wmkf_inviteddate le');
});

test('a newly Invited (day-11) row gets a ledger entry immediately but no recipient email', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({
    records: [deliv(1, '2026-06-09T00:00:00.000Z')], totalCount: 1, capped: false,
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.scheduled).toBe(1);
  expect(res.body.reminded).toBe(0);
  expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
    sourceRecordId: 'd1',
    scheduledSendAt: '2026-06-21T00:00:00.000Z',
  }));
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('the frozen draft carries server-resolved recipients, signature, and day-12 send time', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.scheduled).toBe(1);
  expect(resolveSignatureForRequest).toHaveBeenCalledWith('r1');
  expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
    workflowType: 'grantee_abstract_reminder',
    sourceRecordId: 'd1',
    requestId: 'r1',
    pdSystemUserId: 'pd1',
    pdEmail: 'pd1@wmkeck.org',
    toRecipients: ['pi1@example.edu'],
    ccRecipients: ['liaison1@example.edu'],
    recipientContactIds: ['pi1', 'liaison1'],
    subject: SUBJECT,
    signatureText: 'Assigned PD\nW. M. Keck Foundation',
    scheduledSendAt: '2026-06-20T00:00:00.000Z',
    approvalRequired: false,
  }));
  // The cron itself never creates or sends recipient mail — the ledger
  // due-send worker owns transport.
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
  expect(DynamicsService.updateRecord).not.toHaveBeenCalled();
});

test('the review-all override marks the row approval_required', async () => {
  getEmailAutomationPreferenceForSystemUser.mockResolvedValue({ reviewAll: true });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.scheduled).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(
    expect.objectContaining({ approvalRequired: true }),
  );
});

test('a VIP flag on the liaison alone marks the row approval_required (every recipient counts)', async () => {
  scheduledEmailStore.filterVipFlaggedContacts.mockResolvedValue(new Set(['liaison1']));
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);
  expect(scheduledEmailStore.filterVipFlaggedContacts).toHaveBeenCalledWith('pd1', ['pi1', 'liaison1']);
  expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(
    expect.objectContaining({ approvalRequired: true }),
  );
});

test('a review posture read failure never weakens review: no ledger row is created', async () => {
  getEmailAutomationPreferenceForSystemUser.mockRejectedValue(new Error('Dataverse preference read failed'));
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.preferenceFailed).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  expect(DynamicsService.createAndSendEmail).not.toHaveBeenCalled();
});

test('blank grantee reminder default skips row creation and alerts admins', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: '   ' };
    if (key === BODY_KEY) return { found: true, value: BODY };
    throw new Error(`unexpected setting ${key}`);
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.skippedMisconfigured).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  expect(NotificationService.notify).toHaveBeenCalledWith(expect.objectContaining({
    type: 'email_default_misconfigured',
    emailAdmins: true,
    autoResolveKey: `email-default-misconfigured:${SUBJECT_KEY}`,
    metadata: expect.objectContaining({ reason: 'blank' }),
  }));
});

test('unavailable grantee reminder default skips row creation and alerts admins', async () => {
  getSettingStrict.mockImplementation(async (key) => {
    if (key === SUBJECT_KEY) return { found: true, value: SUBJECT };
    if (key === BODY_KEY) throw new Error('Dynamics 503');
    throw new Error(`unexpected setting ${key}`);
  });
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  const res = mockRes();
  await handler(req(), res);

  expect(res.body.skippedMisconfigured).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
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
});

test('due sends and digests: per-item failures are isolated and counted', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [], totalCount: 0, capped: false });
  scheduledEmailStore.listDueScheduledEmails.mockResolvedValue([{ id: 'due-1' }, { id: 'due-2' }]);
  deliverScheduledEmail
    .mockRejectedValueOnce(new Error('send down'))
    .mockResolvedValueOnce({ sent: true });
  groupDigestRowsByPd.mockReturnValue([
    { pdSystemUserId: 'pd1', sentFyi: [] },
    { pdSystemUserId: 'pd2', sentFyi: [] },
  ]);
  sendScheduledEmailDigest
    .mockRejectedValueOnce(new Error('digest down'))
    .mockResolvedValueOnce({ sent: true });

  const res = mockRes();
  await handler(req(), res);
  expect(res.body.sendFailed).toBe(1);
  expect(res.body.reminded).toBe(1);
  expect(res.body.digestFailed).toBe(1);
  expect(res.body.digestsSent).toBe(1);
});

test('the reconciliation pass runs from its own 25-row query after delivery and never sends (A2/A7)', async () => {
  scheduledEmailStore.listScheduledEmailReconciliationCandidates.mockResolvedValue([
    { id: 'intent-1', send_requested_at: '2026-09-01T00:00:00Z' },
    { id: 'intent-2', send_requested_at: '2026-09-01T00:00:00Z' },
    { id: 'forbidden-1', send_requested_at: null },
    { id: 'skipped-1', send_requested_at: null },
    { id: 'boom-1', send_requested_at: null },
  ]);
  reconcileScheduledEmailCandidate
    .mockResolvedValueOnce({ sent: true })
    .mockResolvedValueOnce({ unresolved: true, reason: 'not_accepted' })
    .mockResolvedValueOnce({ cleared: true })
    .mockResolvedValueOnce({ skipped: true })
    .mockRejectedValueOnce(new Error('ledger down'));
  const res = mockRes();
  await handler(req(), res);
  expect(scheduledEmailStore.listScheduledEmailReconciliationCandidates).toHaveBeenCalledWith({ limit: 25 });
  expect(res.body).toMatchObject({
    reconciled: 3,
    reconciledSent: 1,
    reconcileUnresolved: 1,
    activityReadCleared: 1,
    reconcileFailed: 1,
    reminded: 0,
  });
  expect(res.body.failures).toEqual([{ requestNum: null, reason: 'scheduled reconcile failed for boom-1: ledger down' }]);
  expect(deliverScheduledEmail).not.toHaveBeenCalled();
  // Order: ordinary delivery is listed before reconciliation candidates.
  const dueOrder = scheduledEmailStore.listDueScheduledEmails.mock.invocationCallOrder[0];
  const reconcileOrder = scheduledEmailStore.listScheduledEmailReconciliationCandidates.mock.invocationCallOrder[0];
  expect(dueOrder).toBeLessThan(reconcileOrder);
});

test('stopped rows with send intent are read back for seven days; late acceptance is counted (A2)', async () => {
  scheduledEmailStore.listStoppedScheduledEmailsWithSendIntent.mockResolvedValue([
    { id: 'stopped-1', status: 'stopped' },
    { id: 'stopped-2', status: 'stopped' },
  ]);
  reconcileStoppedScheduledEmail
    .mockResolvedValueOnce({ sent: true })
    .mockResolvedValueOnce({ unresolved: true, reason: 'not_accepted' });
  const res = mockRes();
  await handler(req(), res);
  expect(scheduledEmailStore.listStoppedScheduledEmailsWithSendIntent).toHaveBeenCalledWith({ days: 7 });
  expect(res.body.stoppedLateAccepted).toBe(1);
  expect(deliverScheduledEmail).not.toHaveBeenCalled();
});

test('a PD whose eligible digest rows exceed the per-PD window is counted and warned (A7)', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  scheduledEmailStore.listScheduledEmailDigestRows.mockResolvedValue([{ id: 'r1' }]);
  groupDigestRowsByPd.mockReturnValue([
    { pdSystemUserId: 'pd-big', sentFyi: [], total: 140, capped: true },
    { pdSystemUserId: 'pd-small', sentFyi: [], total: 3, capped: false },
  ]);
  sendScheduledEmailDigest.mockResolvedValue({ sent: true });
  const res = mockRes();
  await handler(req(), res);
  expect(scheduledEmailStore.listScheduledEmailDigestRows).toHaveBeenCalledWith({ perPdLimit: 100 });
  expect(groupDigestRowsByPd).toHaveBeenCalledWith([{ id: 'r1' }], { perPdLimit: 100 });
  expect(res.body.digestPdCapped).toBe(1);
  expect(res.body.digestsSent).toBe(2);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('digest capped for PD pd-big: 140 eligible rows, 100 shown'));
  warn.mockRestore();
});

test('unfinalized sent rows are repaired without another send', async () => {
  scheduledEmailStore.listUnfinalizedScheduledEmails.mockResolvedValue([{ id: 'sent-1', status: 'sent' }]);
  const res = mockRes();
  await handler(req(), res);
  expect(finalizeScheduledEmail).toHaveBeenCalledWith({ id: 'sent-1', status: 'sent' });
  expect(deliverScheduledEmail).not.toHaveBeenCalled();
});

test('missing PD skips before any ledger write', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
  DynamicsService.getRecord.mockImplementation((entitySet, id) => {
    if (entitySet === 'akoya_requests') return Promise.resolve(requestRow(1, { _wmkf_programdirector_value: null }));
    if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
    return Promise.reject(new Error('unexpected'));
  });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.skippedNoPd).toBe(1);
  expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
});

test('missing recipient skips before any ledger write', async () => {
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
  expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
});

test('capped query reports deferred unreturned rows', async () => {
  DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 3, capped: true });
  const res = mockRes();
  await handler(req(), res);
  expect(res.body.capped).toBe(true);
  expect(res.body.deferred).toBe(2);
});

// ── envelope pins ───────────────────────────────────────────────────────────
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
    reminded: 0,
    skippedNoPd: 0,
    skippedNoRecipient: 0,
    skippedMisconfigured: 0,
    skippedTestRequest: 0,
    testStateUnknown: 0,
    claimFailed: 0,
    sendFailed: 0,
    scheduled: 1,
    reassigned: 0,
    digestsSent: 0,
    digestFailed: 0,
    digestPdCapped: 0,
    reconciled: 0,
    reconciledSent: 0,
    reconcileUnresolved: 0,
    reconcileFailed: 0,
    activityReadCleared: 0,
    stoppedLateAccepted: 0,
    stoppedNoLongerEligible: 0,
    preferenceFailed: 0,
    finalizeFailed: 0,
    capped: false,
    deferred: 0,
    failures: [],
  });
});

describe('Test Request isolation', () => {
  const REQ = '11111111-1111-4111-8111-111111111111';
  const RUN = '22222222-2222-4222-8222-222222222222';
  const markers = { test: { wmkf_istestrequest: true, wmkf_testcreationrunid: RUN }, ordinary: { wmkf_istestrequest: null, wmkf_testcreationrunid: null } };

  function withRequest(marker) {
    DynamicsService.queryAllRecords.mockResolvedValue({
      records: [{ ...deliv(1), _wmkf_request_value: REQ }], totalCount: 1, capped: false,
    });
    DynamicsService.getRecord.mockImplementation((entitySet, id, opts) => {
      if (entitySet === 'akoya_requests') {
        if (String(opts?.select).includes('wmkf_istestrequest')) {
          return marker instanceof Error ? Promise.reject(marker) : Promise.resolve(marker);
        }
        return Promise.resolve(requestRow(1));
      }
      if (entitySet === 'contacts') return Promise.resolve(contactRow(id));
      if (entitySet === 'systemusers') return Promise.resolve(pdRow(id));
      return Promise.reject(new Error(`unexpected ${entitySet}`));
    });
  }

  test('a test request is skipped before any recipient read or ledger write', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    withRequest(markers.test);
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.skippedTestRequest).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
    expect(DynamicsService.getRecord.mock.calls.filter(([set]) => set === 'contacts')).toHaveLength(0);
  });

  test('an unreadable marker skips this run and is reported', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    withRequest(new Error('timeout'));
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.testStateUnknown).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  });

  test('a verified ordinary request is scheduled as before', async () => {
    process.env.TEST_REQUEST_ISOLATION = 'on';
    withRequest(markers.ordinary);
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.scheduled).toBe(1);
  });

  test('the switch off reads no marker', async () => {
    withRequest(markers.test);
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.scheduled).toBe(1);
    expect(DynamicsService.getRecord.mock.calls.some(([, , o]) => String(o?.select).includes('wmkf_istestrequest'))).toBe(false);
  });
});

describe('Liaison of record (Research)', () => {
  const ACCOUNT = '22222222-2222-2222-2222-222222222222';
  const research = (over = {}) => requestRow(1, {
    _akoya_programid_value: RESEARCH_PROGRAM_IDS[0],
    _akoya_applicantid_value: ACCOUNT,
    _akoya_primarycontactid_value: 'liaison-copy',
    ...over,
  });
  function wire({ request = research(), primaryContact = 'liaison-inst', contact = contactRow } = {}) {
    DynamicsService.queryAllRecords.mockResolvedValue({ records: [deliv(1)], totalCount: 1, capped: false });
    DynamicsService.queryRecords.mockImplementation(async () => ({
      records: [{ accountid: ACCOUNT, _primarycontactid_value: primaryContact }], totalCount: 1, hasMore: false,
    }));
    DynamicsService.getRecord.mockImplementation((entitySet, id) => {
      if (entitySet === 'akoya_requests') return Promise.resolve(request);
      if (entitySet === 'contacts') return contact(id);
      if (entitySet === 'systemusers') return Promise.resolve(pdRow(id));
      return Promise.reject(new Error(`unexpected ${entitySet}`));
    });
  }

  test('the Request read selects every Liaison helper input', async () => {
    wire();
    await handler(req(), mockRes());
    const select = DynamicsService.getRecord.mock.calls.find(([e]) => e === 'akoya_requests')[2].select.split(',');
    expect(select).toEqual(expect.arrayContaining(['_akoya_programid_value', '_akoya_applicantid_value', '_akoya_primarycontactid_value']));
  });

  test('a new row is Cc the institution Primary Contact, never a differing Request copy', async () => {
    wire();
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.scheduled).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      toRecipients: ['pi1@example.edu'],
      ccRecipients: ['liaison-inst@example.edu'],
      recipientContactIds: ['pi1', 'liaison-inst'],
    }));
    expect(DynamicsService.getRecord).not.toHaveBeenCalledWith('contacts', 'liaison-copy', expect.anything());
  });

  test('none → a new PI-only row with no Cc', async () => {
    wire({ primaryContact: null });
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.scheduled).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      toRecipients: ['pi1@example.edu'],
      ccRecipients: [],
      recipientContactIds: ['pi1'],
    }));
  });

  test.each([
    ['the account read throws', { primaryContact: 'liaison-inst' }, () => DynamicsService.queryRecords.mockRejectedValue(new Error('dataverse 503'))],
    ['the Liaison contact read throws', {
      contact: (id) => (id === 'liaison-inst' ? Promise.reject(new Error('403')) : Promise.resolve(contactRow(id))),
    }, () => {}],
    ['the found Liaison has no email', {
      contact: (id) => Promise.resolve(id === 'liaison-inst' ? { ...contactRow(id), emailaddress1: null } : contactRow(id)),
    }, () => {}],
  ])('%s → the row is skipped this run, never created PI-only', async (_label, options, arrange) => {
    wire(options);
    arrange();
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.skippedNoRecipient).toBe(1);
    expect(res.body.scheduled).toBe(0);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  });

  test('an account row missing its Primary Contact lookup skips the row, never PI-only', async () => {
    wire();
    DynamicsService.queryRecords.mockResolvedValue({ records: [{ accountid: ACCOUNT }], totalCount: 1, hasMore: false });
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.skippedNoRecipient).toBe(1);
    expect(scheduledEmailStore.createOrGetScheduledEmail).not.toHaveBeenCalled();
  });

  test('an existing row with the same PD keeps its stored recipients (the documented gap)', async () => {
    wire();
    scheduledEmailStore.createOrGetScheduledEmail.mockResolvedValue({
      id: 'scheduled-1', pd_systemuser_id: 'pd1', status: 'scheduled', cc_recipients: ['liaison-copy@example.edu'],
    });
    await handler(req(), mockRes());
    expect(scheduledEmailStore.reassignScheduledEmail).not.toHaveBeenCalled();
  });

  test.each([
    ['the institution Liaison', 'liaison-inst', ['liaison-inst@example.edu']],
    ['no Cc for none', null, []],
  ])('a former PD\'s unsent row is rebuilt by the handoff with %s', async (_label, primaryContact, cc) => {
    wire({ primaryContact });
    scheduledEmailStore.createOrGetScheduledEmail.mockResolvedValue({ id: 'scheduled-1', pd_systemuser_id: 'pd-former', status: 'scheduled', version: 4 });
    scheduledEmailStore.reassignScheduledEmail.mockResolvedValue({ id: 'scheduled-1' });
    const res = mockRes();
    await handler(req(), res);
    expect(res.body.reassigned).toBe(1);
    expect(scheduledEmailStore.reassignScheduledEmail).toHaveBeenCalledWith(expect.objectContaining({
      pdSystemUserId: 'pd1',
      toRecipients: ['pi1@example.edu'],
      ccRecipients: cc,
      // A5: fenced on the version the cron just read.
      expectedVersion: 4,
    }));
  });
});
