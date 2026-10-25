/** @jest-environment node */
import { createMockReq, createMockRes } from '../helpers/auth-mock';
import { requireAppAccess } from '../../lib/utils/auth';
import { getDistributionPreferences, saveDistributionPreference, clearDistributionPreference } from '../../lib/services/pre-site-visit/distribution-personalization';
import handler, { config } from '../../pages/api/workbench/pre-site-visit/distribution/email-preferences';
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_name, fn) => fn()) }));
jest.mock('../../lib/services/pre-site-visit/distribution-personalization', () => ({ getDistributionPreferences: jest.fn(), saveDistributionPreference: jest.fn(), clearDistributionPreference: jest.fn() }));
const OWNER = '33333333-3333-4333-8333-333333333333';
const call = (method, body = {}, query = {}) => ({ req: createMockReq({ method, body, query }), res: createMockRes() });
beforeEach(() => {
  jest.clearAllMocks(); process.env.MEETING_TRACKER_SCHEMA_READY = 'on';
  requireAppAccess.mockResolvedValue({ session: { user: { dynamicsSystemuserId: OWNER } }, profileId: 42 });
  getDistributionPreferences.mockResolvedValue({ ownSystemId: OWNER, defaults: { personalStatus: 'configured' } });
  saveDistributionPreference.mockResolvedValue({ ok: true }); clearDistributionPreference.mockResolvedValue({ ok: true });
});
afterEach(() => { delete process.env.MEETING_TRACKER_SCHEMA_READY; });
test('app-gated exact-owner read; invalid row repair remains accessible with shared data', async () => {
  const { req, res } = call('GET'); await handler(req, res);
  expect(requireAppAccess).toHaveBeenCalledWith(req, res, 'reviewers'); expect(getDistributionPreferences).toHaveBeenCalledWith(OWNER);
  getDistributionPreferences.mockResolvedValue({ defaults: { personalStatus: 'invalid', sharedStatus: 'available' }, shared: { subject: 'Shared', body: '' } });
  await handler(req, res); expect(res.statusCode).toBe(200); expect(res._data.shared.subject).toBe('Shared');
});
test.each([{ ownerId: 'other' }, { template: {}, extra: true }, [], null])('refuses forged/unexpected body %p before write', async (body) => {
  const { req, res } = call('PUT', body); await handler(req, res); expect(res.statusCode).toBe(400); expect(saveDistributionPreference).not.toHaveBeenCalled();
});
test('PUT/DELETE use only session identity and do not depend on shared availability', async () => {
  getDistributionPreferences.mockResolvedValue({ defaults: { personalStatus: 'configured', sharedStatus: 'unavailable' } });
  const put = call('PUT', { template: { subject: 'Own', body: '' } }); await handler(put.req, put.res);
  expect(saveDistributionPreference).toHaveBeenCalledWith(OWNER, { subject: 'Own', body: '' }); expect(put.res.statusCode).toBe(200);
  const del = call('DELETE'); await handler(del.req, del.res); expect(clearDistributionPreference).toHaveBeenCalledWith(OWNER);
});
test('missing identity and denied access prevent preference operations', async () => {
  requireAppAccess.mockResolvedValueOnce({ session: { user: {} } }); const missing = call('GET'); await handler(missing.req, missing.res); expect(missing.res.statusCode).toBe(503);
  requireAppAccess.mockResolvedValueOnce(null); const denied = call('GET'); await handler(denied.req, denied.res); expect(getDistributionPreferences).not.toHaveBeenCalled();
});
test('rejects caller-selected owner queries and private cache is unconditional', async () => {
  const c = call('GET', {}, { owner: 'other' }); await handler(c.req, c.res);
  expect(c.res.statusCode).toBe(400); expect(getDistributionPreferences).not.toHaveBeenCalled();
  expect(c.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});
test('confirmed write stays confirmed when independent refresh fails', async () => {
  getDistributionPreferences.mockRejectedValueOnce(new Error('refresh failed'));
  const c = call('PUT', { template: { subject: 'X', body: 'Y' } }); await handler(c.req, c.res);
  expect(c.res.statusCode).toBe(200); expect(c.res._data).toEqual({ ok: true, refreshUnavailable: true });
});

test('parser permits worst-case escaped bounded Unicode template without weakening field validation', () => {
  expect(config.api.bodyParser.sizeLimit).toBe('256kb');
  const serialized = JSON.stringify({ template: { subject: 'x'.repeat(500), body: '\u0001'.repeat(20000) } });
  expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(256 * 1024);
});
