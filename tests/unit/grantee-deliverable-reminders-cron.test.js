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
jest.mock('../../lib/external/grantee-token-lifecycle', () => ({
  mintForRequest: jest.fn(async ({ requestId }) => ({ url: `https://app.example.org/external/grantee/${requestId}` })),
}));

import { verifyCronSecret } from '../../lib/utils/cron-auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
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
  DynamicsService.queryAllRecords.mockReset().mockResolvedValue({ records: [], totalCount: 0, capped: false });
  DynamicsService.updateRecord.mockReset().mockResolvedValue({});
  DynamicsService.createAndSendEmail.mockReset().mockResolvedValue({ emailId: 'email-1' });
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

test('selection window includes day 12 and excludes day 11 by using inviteddate <= now-12d', async () => {
  const res = mockRes();
  await handler(req(), res);
  expect(res.statusCode).toBe(200);
  const { filter } = DynamicsService.queryAllRecords.mock.calls[0][1];
  expect(filter).toContain(`wmkf_deliverablestatus eq ${GRANTEE_DELIVERABLE_STATUS.INVITED}`);
  expect(filter).toContain('wmkf_inviteddate ne null');
  expect(filter).toContain('wmkf_inviteddate le 2026-06-08T00:00:00.000Z');
  expect(filter).not.toContain('2026-06-09T00:00:00.000Z');
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
    subject: 'Reminder: your W. M. Keck Foundation abstract',
    from: 'pd1@wmkeck.org',
    to: 'pi1@example.edu',
    cc: 'liaison1@example.edu',
    regardingId: 'r1',
    regardingType: 'akoya_request',
    actingUserSystemId: 'pd1',
    noFallback: true,
  });
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
