/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAuthWithProfile: jest.fn(async () => 7),
}));
jest.mock('../../lib/services/dataverse-identity-map', () => ({
  resolveProfileToSystemUser: jest.fn(async () => ({
    systemuserid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  })),
}));
jest.mock('../../lib/services/scheduled-email-store', () => ({
  listScheduledEmailsForPd: jest.fn(),
  getScheduledEmailForPd: jest.fn(),
  updateScheduledEmailDraft: jest.fn(),
  approveScheduledEmail: jest.fn(),
  stopScheduledEmail: jest.fn(),
}));
jest.mock('../../lib/services/scheduled-email-service', () => ({
  projectScheduledEmail: jest.fn((row) => row ? ({ id: row.id, version: row.version, status: row.status }) : null),
  deliverScheduledEmail: jest.fn(),
}));

import listHandler from '../../pages/api/scheduled-emails/index';
import actionHandler from '../../pages/api/scheduled-emails/[id]';
import * as store from '../../lib/services/scheduled-email-store';
import { deliverScheduledEmail } from '../../lib/services/scheduled-email-service';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PD_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const row = { id: ID, version: 2, status: 'scheduled' };

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  store.listScheduledEmailsForPd.mockResolvedValue([row]);
  store.getScheduledEmailForPd.mockResolvedValue(row);
  store.updateScheduledEmailDraft.mockResolvedValue({ ...row, version: 3 });
  store.approveScheduledEmail.mockResolvedValue({ ...row, version: 3 });
  store.stopScheduledEmail.mockResolvedValue({ ...row, version: 3, status: 'stopped' });
  deliverScheduledEmail.mockResolvedValue({ sent: true, message: { id: ID, version: 2, status: 'sent' } });
});

test('list route scopes rows to the authenticated profile Dynamics user', async () => {
  const res = mockRes();
  await listHandler({ method: 'GET', query: {}, body: {} }, res);
  expect(store.listScheduledEmailsForPd).toHaveBeenCalledWith(PD_ID);
  expect(res.body.messages).toEqual([{ id: ID, version: 2, status: 'scheduled' }]);
});

test('edit action uses PD scope and an optimistic version fence', async () => {
  const res = mockRes();
  await actionHandler({
    method: 'PATCH',
    query: { id: ID },
    body: { action: 'edit', version: 2, subject: 'Updated subject', bodyText: 'Updated body text.' },
  }, res);
  expect(store.updateScheduledEmailDraft).toHaveBeenCalledWith({
    id: ID,
    pdSystemUserId: PD_ID,
    profileId: 7,
    expectedVersion: 2,
    subject: 'Updated subject',
    bodyText: 'Updated body text.',
  });
  expect(res.statusCode).toBe(200);
});

test('send-now action cannot escape PD scope and uses the viewed version', async () => {
  const res = mockRes();
  await actionHandler({
    method: 'PATCH', query: { id: ID }, body: { action: 'send_now', version: 2 },
  }, res);
  expect(deliverScheduledEmail).toHaveBeenCalledWith(ID, {
    force: true,
    pdSystemUserId: PD_ID,
    expectedVersion: 2,
  });
  expect(res.body.message.status).toBe('sent');
});

test('a message outside the PD scope is indistinguishable from missing', async () => {
  store.getScheduledEmailForPd.mockResolvedValue(null);
  const res = mockRes();
  await actionHandler({ method: 'GET', query: { id: ID }, body: {} }, res);
  expect(res.statusCode).toBe(404);
});

test('a stale version returns conflict without mutating the row', async () => {
  store.approveScheduledEmail.mockResolvedValue(null);
  const res = mockRes();
  await actionHandler({
    method: 'PATCH', query: { id: ID }, body: { action: 'approve', version: 1 },
  }, res);
  expect(res.statusCode).toBe(409);
});
