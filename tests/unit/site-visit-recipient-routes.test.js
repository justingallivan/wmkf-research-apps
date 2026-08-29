/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({
  requireAppAccess: jest.fn(),
  requireSuperuser: jest.fn(),
}));
jest.mock('../../lib/dataverse/core/context', () => ({
  withDalContext: jest.fn((_label, fn) => fn()),
}));
jest.mock('../../lib/services/site-visit/curated-recipient-service', () => ({
  getCuratedRecipientAdminState: jest.fn(),
  getCuratedRecipientOptions: jest.fn(),
  searchCuratedRecipientContacts: jest.fn(),
  writeCuratedRecipientConfig: jest.fn(),
}));

import { requireAppAccess, requireSuperuser } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  getCuratedRecipientAdminState,
  getCuratedRecipientOptions,
  searchCuratedRecipientContacts,
  writeCuratedRecipientConfig,
} from '../../lib/services/site-visit/curated-recipient-service';
import adminHandler from '../../pages/api/admin/site-visit-recipients';
import workbenchHandler from '../../pages/api/workbench/pre-site-visit/recipient-options';

function response() {
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
  requireSuperuser.mockResolvedValue({ profileId: 42 });
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  getCuratedRecipientAdminState.mockResolvedValue({
    config: { version: 1, entries: [] },
    entries: [],
    staff: [],
  });
  getCuratedRecipientOptions.mockResolvedValue([]);
  searchCuratedRecipientContacts.mockResolvedValue([]);
  writeCuratedRecipientConfig.mockResolvedValue({ config: { version: 1, entries: [] }, entries: [] });
});

test('Admin GET is superuser-gated and runs inside DAL context', async () => {
  const res = response();
  await adminHandler({ method: 'GET', query: {} }, res);
  expect(requireSuperuser).toHaveBeenCalled();
  expect(withDalContext).toHaveBeenCalledWith('admin-site-visit-recipient-directory', expect.any(Function));
  expect(res.body).toEqual({
    success: true,
    config: { version: 1, entries: [] },
    entries: [],
    staff: [],
  });
});

test('Admin Contact search uses the bounded search seam rather than creating Contacts', async () => {
  const res = response();
  await adminHandler({ method: 'GET', query: { search: 'Casey' } }, res);
  expect(searchCuratedRecipientContacts).toHaveBeenCalledWith('Casey');
  expect(writeCuratedRecipientConfig).not.toHaveBeenCalled();
  expect(res.body).toEqual({ success: true, contacts: [] });
});

test('Admin Contact search rejects duplicate or unsupported query parameters', async () => {
  const duplicate = response();
  await adminHandler({ method: 'GET', query: { search: ['Casey', 'Board'] } }, duplicate);
  expect(duplicate.statusCode).toBe(400);

  const unsupported = response();
  await adminHandler({ method: 'GET', query: { search: 'Casey', page: '2' } }, unsupported);
  expect(unsupported.statusCode).toBe(400);
  expect(searchCuratedRecipientContacts).not.toHaveBeenCalled();
});

test('Admin PUT accepts only the config envelope and passes the authenticated profile ID', async () => {
  const config = { version: 1, entries: [] };
  const res = response();
  await adminHandler({ method: 'PUT', query: {}, body: { config } }, res);
  expect(writeCuratedRecipientConfig).toHaveBeenCalledWith(config, 42);

  const rejected = response();
  await adminHandler({ method: 'PUT', query: {}, body: { config, extra: true } }, rejected);
  expect(rejected.statusCode).toBe(400);
});

test('unauthenticated Admin and Workbench callers stop before service reads', async () => {
  requireSuperuser.mockResolvedValueOnce(null);
  await adminHandler({ method: 'GET', query: {} }, response());
  expect(getCuratedRecipientAdminState).not.toHaveBeenCalled();

  requireAppAccess.mockResolvedValueOnce(null);
  await workbenchHandler({ method: 'GET' }, response());
  expect(getCuratedRecipientOptions).not.toHaveBeenCalled();
});

test('Workbench GET returns only the resolved curated options under reviewers access', async () => {
  const recipients = [{ key: 'staff:7', category: 'staff', name: 'Alice', email: 'alice@example.org' }];
  getCuratedRecipientOptions.mockResolvedValueOnce(recipients);
  const res = response();
  await workbenchHandler({ method: 'GET' }, res);
  expect(requireAppAccess).toHaveBeenCalledWith(expect.any(Object), res, 'reviewers');
  expect(withDalContext).toHaveBeenCalledWith('workbench-pre-site-visit-recipient-options', expect.any(Function));
  expect(res.body).toEqual({ success: true, recipients });
});

test('unsupported methods fail before authentication', async () => {
  const adminRes = response();
  await adminHandler({ method: 'POST' }, adminRes);
  expect(adminRes.statusCode).toBe(405);

  const workbenchRes = response();
  await workbenchHandler({ method: 'POST' }, workbenchRes);
  expect(workbenchRes.statusCode).toBe(405);
  expect(requireAppAccess).not.toHaveBeenCalled();
});
