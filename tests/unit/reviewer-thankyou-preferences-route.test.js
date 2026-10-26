/** @jest-environment node */
import handler, { config } from '../../pages/api/reviewer-thankyou-email-preferences';
import { withDalContext } from '../../lib/dataverse/core/context';
import { requireAuth } from '../../lib/utils/auth';
import { resolveProfileToSystemUser } from '../../lib/services/dataverse-identity-map';
import { getReviewerThankYouPreferences as get, saveReviewerThankYouPreference as save, clearReviewerThankYouPreference as clear } from '../../lib/services/reviewer-thankyou-personalization';
import { createMockReq, createMockRes } from '../helpers/auth-mock';
jest.mock('../../lib/utils/auth', () => ({ requireAuth: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn(async (_label, fn) => fn()) }));
jest.mock('../../lib/services/dataverse-identity-map', () => ({ resolveProfileToSystemUser: jest.fn() }));
jest.mock('../../lib/services/reviewer-thankyou-personalization', () => ({ getReviewerThankYouPreferences: jest.fn(), saveReviewerThankYouPreference: jest.fn(), clearReviewerThankYouPreference: jest.fn() }));
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
const pair = { subject: 'Reminder', body: '{{greeting}} {{proposalTitle}} {{signature}}' };
const call = async (method = 'GET', body = {}, query = {}) => { const req = createMockReq({ method, body, query }), res = createMockRes(); await handler(req, res); return res; };
beforeEach(() => { jest.resetAllMocks(); withDalContext.mockImplementation(async (_name, fn) => fn()); requireAuth.mockResolvedValue({ user: { userType: 'staff', profileId: 42, dynamicsSystemuserId: OWNER.toUpperCase() } }); resolveProfileToSystemUser.mockResolvedValue({ systemuserid: OWNER }); get.mockResolvedValue({ ownStatus: 'configured', ownerSystemId: OWNER }); save.mockResolvedValue({ ok: true }); clear.mockResolvedValue({ ok: true }); });
test('GET reads exact session identity, verifies profile mapping and never mutates', async () => {
  const res = await call(); expect(res.statusCode).toBe(200); expect(resolveProfileToSystemUser).toHaveBeenCalledWith(42); expect(get).toHaveBeenCalledWith(OWNER.toUpperCase()); expect(save).not.toHaveBeenCalled();
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
});
test.each([{ authBypassed: true, user: { profileId: 42, dynamicsSystemuserId: OWNER } }, { user: { userType: 'applicant', profileId: 42, dynamicsSystemuserId: OWNER } }])('refuses bypass/applicant even with forged-looking valid identity', async session => { requireAuth.mockResolvedValue(session); expect((await call()).statusCode).toBe(403); expect(resolveProfileToSystemUser).not.toHaveBeenCalled(); });
test('production auth bypass explicitly refuses', async () => { const original = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; try { requireAuth.mockResolvedValue({ authBypassed: true, user: {} }); expect((await call()).statusCode).toBe(403); } finally { process.env.NODE_ENV = original; } });
test.each([{}, { profileId: 42 }, { profileId: 42, dynamicsSystemuserId: 'bad' }, { dynamicsSystemuserId: OWNER }])('missing actor/profile fails closed %p', async user => { requireAuth.mockResolvedValue({ user }); expect((await call()).statusCode).toBe(503); expect(get).not.toHaveBeenCalled(); });
test('denied/revoked auth prevents lookup; mapping mismatch/throw is sanitized', async () => {
  requireAuth.mockResolvedValueOnce(null); await call(); expect(get).not.toHaveBeenCalled();
  resolveProfileToSystemUser.mockResolvedValueOnce({ systemuserid: '22222222-2222-4222-8222-222222222222' }); expect((await call()).statusCode).toBe(403);
  resolveProfileToSystemUser.mockRejectedValueOnce(new Error('private details')); const res = await call(); expect(res.statusCode).toBe(503); expect(JSON.stringify(res._data)).not.toContain('private');
});
test.each([{ ownerId: OWNER }, { template: pair, extra: 1 }, [], null])('rejects unexpected body %p', async body => { expect((await call('PUT', body)).statusCode).toBe(400); expect(save).not.toHaveBeenCalled(); });
test('rejects owner query, GET scalar body, unexpected DELETE fields and unsupported method', async () => {
  expect((await call('GET', {}, { owner: OWNER })).statusCode).toBe(400); expect((await call('GET', 'x')).statusCode).toBe(400);
  expect((await call('DELETE', { key: 'other' })).statusCode).toBe(400); expect((await call('POST')).statusCode).toBe(405);
});
test('PUT/DELETE use owner, not caller data, with private no-store', async () => { expect((await call('PUT', { template: pair })).statusCode).toBe(200); expect(save).toHaveBeenCalledWith(OWNER.toUpperCase(), pair); await call('DELETE'); expect(clear).toHaveBeenCalledWith(OWNER.toUpperCase()); });
test.each(['PUT', 'DELETE'])('unconfirmed %s mutation never succeeds or refreshes', async method => { (method === 'PUT' ? save : clear).mockRejectedValueOnce(new Error('lost')); const res = await call(method, method === 'PUT' ? { template: pair } : {}); expect(res.statusCode).toBe(503); expect(res._data.reason).toBe('persistence_unconfirmed'); expect(get).not.toHaveBeenCalled(); });
test('validation/duplicate responses are distinct from uncertainty', async () => { save.mockResolvedValueOnce({ ok: false, reason: 'validation', errors: { body: 'required' } }); expect((await call('PUT', { template: pair })).statusCode).toBe(400); save.mockResolvedValueOnce({ ok: false, reason: 'duplicates' }); expect((await call('PUT', { template: pair })).statusCode).toBe(409); });
test.each(['throw', 'unavailable'])('confirmed mutation survives %s independent refresh', async kind => { if (kind === 'throw') get.mockRejectedValueOnce(new Error('lost')); else get.mockResolvedValueOnce({ ownStatus: 'unavailable' }); const res = await call('PUT', { template: pair }); expect(res.statusCode).toBe(200); expect(res._data).toEqual({ ok: true, ownerSystemId: OWNER, authenticatedProfileId: 42, refreshUnavailable: true }); });
test('parser accepts bounded escaped content within 256kb', () => expect(config.api.bodyParser.sizeLimit).toBe('256kb'));

test('bodyless GET passes through Next real parser and reaches exact-owner service', async () => {
  const { Readable } = require('node:stream');
  const { parseBody } = require('next/dist/server/api-utils/node/parse-body');
  const req = Readable.from([]); req.headers = {}; req.method = 'GET'; req.query = {};
  req.body = await parseBody(req, config.api.bodyParser.sizeLimit);
  expect(req.body).toBe('');
  const res = createMockRes(); await handler(req, res);
  expect(res.statusCode).toBe(200); expect(get).toHaveBeenCalledWith(OWNER.toUpperCase());
});
test.each([undefined, '', {}])('GET accepts only empty transport body %p', async body => {
  const req = createMockReq({ method: 'GET', query: {} }); req.body = body;
  const res = createMockRes(); await handler(req, res); expect(res.statusCode).toBe(200); expect(get).toHaveBeenCalled();
});

 test.each([[], { selector: 'x' }, 'notempty'])('GET refuses nonempty/array transport body %p', async body => expect((await call('GET', body)).statusCode).toBe(400));
 test('successful DTO echoes session-bound profile and normalized actor', async () => { const res = await call(); expect(res._data).toMatchObject({ ownerSystemId: OWNER, authenticatedProfileId: 42 }); });

test.each([true, false, {}, []])('non-scalar session profile %p refuses', async profileId => { requireAuth.mockResolvedValue({ user: { profileId, dynamicsSystemuserId: OWNER } }); expect((await call()).statusCode).toBe(503); });
