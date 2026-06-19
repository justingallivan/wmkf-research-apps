/**
 * GET /api/workbench/grantee-deliverables/recipients — chunk 3b.
 * Resolves PI (wmkf_projectleader) + liaison (akoya_primarycontactid) contacts.
 *
 * @jest-environment node
 */
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/services/dynamics-service', () => ({ DynamicsService: { getRecord: jest.fn() } }));
jest.mock('../../lib/services/dynamics-context', () => ({
  bypassDynamicsRestrictions: (l, fn) => Promise.resolve().then(() => (typeof l === 'function' ? l() : fn())),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { DynamicsService } from '../../lib/services/dynamics-service';
import handler from '../../pages/api/workbench/grantee-deliverables/recipients';

const GUID = '11111111-1111-1111-1111-111111111111';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

beforeEach(() => {
  requireAppAccess.mockReset().mockResolvedValue({ profileId: 'p', session: { user: {} } });
  DynamicsService.getRecord.mockReset();
});

function wireContacts({ piEmail = 'monika.raj@emory.edu', liaisonId = 'li-1' } = {}) {
  DynamicsService.getRecord.mockImplementation((entity, id) => {
    if (entity === 'akoya_requests') {
      return Promise.resolve({ akoya_requestid: GUID, _wmkf_projectleader_value: 'pi-1', _akoya_primarycontactid_value: liaisonId });
    }
    if (entity === 'contacts' && id === 'pi-1') {
      return Promise.resolve({ contactid: 'pi-1', fullname: 'Monika Raj', emailaddress1: piEmail });
    }
    if (entity === 'contacts' && id === 'li-1') {
      return Promise.resolve({ contactid: 'li-1', fullname: 'Lorena McLaren', emailaddress1: 'lorena.mclaren@emory.edu' });
    }
    return Promise.reject(Object.assign(new Error('404'), { status: 404 }));
  });
}

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {}, headers: {} }, res);
  expect(res.statusCode).toBe(405);
});

test('invalid requestId → 400 (no read)', async () => {
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: 'nope' }, headers: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(DynamicsService.getRecord).not.toHaveBeenCalled();
});

test('resolves PI + liaison with names and emails', async () => {
  wireContacts();
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body.pi).toEqual({ contactId: 'pi-1', name: 'Monika Raj', email: 'monika.raj@emory.edu', hasEmail: true });
  expect(res.body.liaison).toEqual({ contactId: 'li-1', name: 'Lorena McLaren', email: 'lorena.mclaren@emory.edu', hasEmail: true });
});

test('an empty liaison lookup → hasEmail false (no crash)', async () => {
  wireContacts({ liaisonId: null });
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.body.liaison).toEqual({ contactId: null, name: null, email: null, hasEmail: false });
  expect(res.body.pi.hasEmail).toBe(true);
});

test('a contact with no email → hasEmail false', async () => {
  wireContacts({ piEmail: null });
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.body.pi.hasEmail).toBe(false);
  expect(res.body.pi.contactId).toBe('pi-1');
});

test('request not found → 404', async () => {
  DynamicsService.getRecord.mockRejectedValue(new Error('boom'));
  const res = mockRes();
  await handler({ method: 'GET', query: { requestId: GUID }, headers: {} }, res);
  expect(res.statusCode).toBe(404);
});
