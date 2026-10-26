/** @jest-environment node */
// Real requireAuth + route; mocked session and stores. No credential or DB reads.
import handler from '../../pages/api/scheduled-emails/email-preferences';
import { getServerSession } from 'next-auth/next';
import { sql } from '@vercel/postgres';
import { resolveProfileToSystemUser } from '../../lib/services/dataverse-identity-map';
import { getScheduledGranteeReminderPreferences as get } from '../../lib/services/scheduled-grantee-reminder-personalization';
import { createMockReq, createMockRes } from '../helpers/auth-mock';
jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('../../pages/api/auth/[...nextauth]', () => ({ authOptions: {} }));
jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('../../lib/utils/auth-policy', () => ({ isAuthRequired: () => true }));
jest.mock('../../lib/services/app-access-service', () => ({ listAppKeysForUser: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: async (_label, fn) => fn() }));
jest.mock('../../lib/services/dataverse-identity-map', () => ({ resolveProfileToSystemUser: jest.fn() }));
jest.mock('../../lib/services/scheduled-grantee-reminder-personalization', () => ({ getScheduledGranteeReminderPreferences: jest.fn(), saveScheduledGranteeReminderPreference: jest.fn(), clearScheduledGranteeReminderPreference: jest.fn() }));
const OWNER = 'abcdefab-1111-4111-8111-111111111111';
let original;
beforeEach(() => {
  original = process.env.NEXTAUTH_URL; process.env.NEXTAUTH_URL = 'https://fixture.example.org';
  jest.resetAllMocks(); getServerSession.mockResolvedValue({ user: { userType: 'staff', profileId: 42, dynamicsSystemuserId: OWNER } });
  sql.mockResolvedValue({ rows: [{ is_active: true }] }); resolveProfileToSystemUser.mockResolvedValue({ systemuserid: OWNER }); get.mockResolvedValue({ ownStatus: 'absent' });
});
afterEach(() => { if (original === undefined) delete process.env.NEXTAUTH_URL; else process.env.NEXTAUTH_URL = original; });
test.each(['PUT', 'DELETE'])('real Origin guard refuses %s before preference/identity access', async method => {
  const req = createMockReq({ method, query: {}, body: method === 'PUT' ? { template: {} } : {}, headers: { cookie: 'fixture-session', origin: 'https://foreign.example.org' } }), res = createMockRes();
  await handler(req, res); expect(res.statusCode).toBe(403); expect(getServerSession).not.toHaveBeenCalled(); expect(resolveProfileToSystemUser).not.toHaveBeenCalled();
});
test.each([{ rows: [] }, { rows: [{ is_active: false }] }])('real revocation guard denies missing/disabled profile %p', async ({ rows }) => {
  sql.mockResolvedValue({ rows }); const res = createMockRes(); await handler(createMockReq({ method: 'GET', query: {}, body: {} }), res);
  expect(res.statusCode).toBe(403); expect(get).not.toHaveBeenCalled();
});
test('real unauthenticated session returns 401', async () => {
  getServerSession.mockResolvedValue(null); const res = createMockRes(); await handler(createMockReq({ method: 'GET', query: {}, body: {} }), res);
  expect(res.statusCode).toBe(401); expect(get).not.toHaveBeenCalled();
});
