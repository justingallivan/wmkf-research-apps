/** @jest-environment node */

jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/expertise-finder/roster-contact-link-service', () => ({
  getRosterContactById: jest.fn(),
  normalizeRosterContactSearchQuery: jest.fn((value) => String(value).trim()),
  searchRosterContacts: jest.fn(),
}));

import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { searchRosterContacts } from '../../lib/services/expertise-finder/roster-contact-link-service';
import { getRosterContactById } from '../../lib/services/expertise-finder/roster-contact-link-service';
import handler from '../../pages/api/expertise-finder/contact-search';

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: null };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((key, value) => { res.headers[key] = value; });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAppAccess.mockResolvedValue({ profileId: 7 });
  searchRosterContacts.mockResolvedValue({ contacts: [], truncated: false, limit: 50 });
  getRosterContactById.mockResolvedValue({ contactId: '11111111-1111-4111-8111-111111111111', available: true });
});

test('contact search rejects unsupported methods before auth', async () => {
  const res = mockRes();
  await handler({ method: 'POST', query: {} }, res);
  expect(res.statusCode).toBe(405);
  expect(res.headers.Allow).toBe('GET');
  expect(requireAppAccess).not.toHaveBeenCalled();
});

test('contact search is bound to Expertise Finder access', async () => {
  requireAppAccess.mockResolvedValueOnce(null);
  await handler({ method: 'GET', query: { q: 'Ada' } }, mockRes());
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'expertise-finder');
  expect(searchRosterContacts).not.toHaveBeenCalled();
});

test.each([
  [{}, 'missing'],
  [{ q: ['Ada'] }, 'array'],
  [{ q: 'Ada', extra: '1' }, 'extra key'],
])('contact search rejects %s before entering Dataverse context', async (query) => {
  const res = mockRes();
  await handler({ method: 'GET', query }, res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();
  expect(searchRosterContacts).not.toHaveBeenCalled();
});

test('contact search enters explicit Dataverse context and returns the bounded result', async () => {
  searchRosterContacts.mockResolvedValueOnce({ contacts: [{ contactId: 'id' }], truncated: true, limit: 50 });
  const res = mockRes();
  await handler({ method: 'GET', query: { q: ' Ada ' } }, res);
  expect(withDalContext).toHaveBeenCalledWith('expertise-finder-roster-contact-search', expect.any(Function));
  expect(searchRosterContacts).toHaveBeenCalledWith('Ada');
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual({ success: true, contacts: [{ contactId: 'id' }], truncated: true, limit: 50 });
});

test('exact linked-contact read GUID-validates before entering its Dataverse context', async () => {
  let res = mockRes();
  await handler({ method: 'GET', query: { contactId: 'not-a-guid' } }, res);
  expect(res.statusCode).toBe(400);
  expect(withDalContext).not.toHaveBeenCalled();

  const contactId = '11111111-1111-4111-8111-111111111111';
  res = mockRes();
  await handler({ method: 'GET', query: { contactId: contactId.toUpperCase() } }, res);
  expect(withDalContext).toHaveBeenCalledWith('expertise-finder-roster-contact-read', expect.any(Function));
  expect(getRosterContactById).toHaveBeenCalledWith(contactId);
  expect(res.statusCode).toBe(200);
  expect(res.body.contact).toEqual(expect.objectContaining({ contactId }));
});
