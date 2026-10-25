/** @jest-environment node */
import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { getAgendaPreferences, saveAgendaPreference, clearAgendaPreference } from '../../lib/services/meeting-tracker/agenda-personalization';
import handler from '../../pages/api/meeting-tracker/agenda-email-preferences';
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_name, fn) => fn()) }));
jest.mock('../../lib/services/meeting-tracker/agenda-personalization', () => ({ getAgendaPreferences: jest.fn(), saveAgendaPreference: jest.fn(), clearAgendaPreference: jest.fn() }));
const OWNER = '33333333-3333-4333-8333-333333333333';
const call = (method, body = {}, query = {}) => ({ req: createMockReq({ method, body, query }), res: createMockRes() });
beforeEach(() => {
  jest.clearAllMocks(); process.env.MEETING_TRACKER_SCHEMA_READY = 'on';
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: OWNER } }, profileId: 42 });
  getAgendaPreferences.mockResolvedValue({ ownSystemId: OWNER, defaults: { personalStatus: 'configured' } });
  saveAgendaPreference.mockResolvedValue({ ok: true }); clearAgendaPreference.mockResolvedValue({ ok: true });
});
afterEach(() => { delete process.env.MEETING_TRACKER_SCHEMA_READY; });
test('app-gated exact-owner read; invalid row repair remains accessible with shared data', async () => {
  const { req, res } = call('GET'); await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'meeting-tracker'); expect(getAgendaPreferences).toHaveBeenCalledWith(OWNER);
  getAgendaPreferences.mockResolvedValue({ defaults: { personalStatus: 'invalid', sharedStatus: 'available' }, shared: { subject: 'Shared', body: '' } });
  await handler(req, res); expect(res.statusCode).toBe(409); expect(res._data.shared.subject).toBe('Shared');
});
test.each([{ ownerId: 'other' }, { template: {}, extra: true }, [], null])('refuses forged/unexpected body %p before write', async (body) => {
  const { req, res } = call('PUT', body); await handler(req, res); expect(res.statusCode).toBe(400); expect(saveAgendaPreference).not.toHaveBeenCalled();
});
test('PUT/DELETE use only session identity and do not depend on shared availability', async () => {
  getAgendaPreferences.mockResolvedValue({ defaults: { personalStatus: 'configured', sharedStatus: 'unavailable' } });
  const put = call('PUT', { template: { subject: 'Own', body: '' } }); await handler(put.req, put.res);
  expect(saveAgendaPreference).toHaveBeenCalledWith(OWNER, { subject: 'Own', body: '' }); expect(put.res.statusCode).toBe(200);
  const del = call('DELETE'); await handler(del.req, del.res); expect(clearAgendaPreference).toHaveBeenCalledWith(OWNER);
});
test('missing identity, disabled schema and denied access prevent personal operations', async () => {
  requireAppAccess.mockResolvedValueOnce({ session: { user: {} } }); let c = call('GET'); await handler(c.req, c.res); expect(c.res.statusCode).toBe(503);
  process.env.MEETING_TRACKER_SCHEMA_READY = 'off'; c = call('PUT', { template: {} }); await handler(c.req, c.res); expect(c.res.statusCode).toBe(503);
  requireAppAccess.mockResolvedValueOnce(null); c = call('GET'); await handler(c.req, c.res); expect(getAgendaPreferences).not.toHaveBeenCalled();
});
