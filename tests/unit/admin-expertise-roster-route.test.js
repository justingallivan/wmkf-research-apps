/** @jest-environment node */
jest.mock('../../lib/utils/auth', () => ({ requireSuperuser: jest.fn(), getSession: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-service', () => ({ listRoster: jest.fn(), saveRoster: jest.fn() }));
jest.mock('../../lib/services/expertise-finder/roster-contact-link-service', () => ({ searchRosterContacts: jest.fn(), getRosterContactById: jest.fn() }));
import { requireSuperuser, getSession } from '../../lib/utils/auth';
import { listRoster, saveRoster } from '../../lib/services/expertise-finder/roster-service';
import { searchRosterContacts } from '../../lib/services/expertise-finder/roster-contact-link-service';
import handler from '../../pages/api/admin/expertise-roster';
const guid = '11111111-1111-4111-8111-111111111111';
const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(c => { res.code = c; return res; }), json: jest.fn(b => { res.body = b; return res; }) }; return res; };
beforeEach(() => { jest.clearAllMocks(); process.env.EXPERTISE_ROSTER_BACKEND = 'dataverse'; requireSuperuser.mockResolvedValue({ profileId: 7 }); getSession.mockResolvedValue({ user: { profileId: 7, dynamicsSystemuserId: guid } }); });
afterEach(() => { delete process.env.EXPERTISE_ROSTER_BACKEND; });
test('denied admin cannot read, search or write', async () => {
  requireSuperuser.mockResolvedValue(null);
  for (const method of ['GET','POST','PATCH']) await handler({ method, query: { q: 'Ada' } }, response());
  expect(listRoster).not.toHaveBeenCalled(); expect(searchRosterContacts).not.toHaveBeenCalled(); expect(saveRoster).not.toHaveBeenCalled();
});
test('admin independent of Expertise Finder grants; actor only comes from trusted session', async () => {
  saveRoster.mockResolvedValue({ member: { id: guid } }); const res = response();
  await handler({ method: 'PATCH', body: { id: guid, actor: 'spoofed' } }, res);
  expect(saveRoster).toHaveBeenCalledWith({ id: guid, actor: 'spoofed' }, guid, { create: false }); expect(res.code).toBe(200);
});
test('mismatched session fails before mutation; provider bodies do not leak', async () => {
  getSession.mockResolvedValueOnce({ user: { profileId: 8, dynamicsSystemuserId: guid } });
  const denied = response(); await handler({ method: 'POST', body: {} }, denied); expect(denied.code).toBe(403); expect(saveRoster).not.toHaveBeenCalled();
  const spy = jest.spyOn(console,'error').mockImplementation(() => {});
  listRoster.mockRejectedValue(Object.assign(Error('private provider response'), { status: 403, serviceName: 'Dataverse' }));
  const res = response(); await handler({ method: 'GET', query: {} }, res); expect(res.body.error).not.toContain('private'); spy.mockRestore();
});
