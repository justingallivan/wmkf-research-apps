/** @jest-environment node */
import handler from '../../pages/api/workbench/staffing';
import { requireAppAccess } from '../../lib/utils/auth';
import { loadStaffing, staffingCapabilities, saveRole } from '../../lib/services/board-writeups/config';
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/board-writeups/config', () => ({ loadStaffing: jest.fn(), staffingCapabilities: jest.fn(), saveRole: jest.fn() }));
const actor = { profileId: 'profile', systemUserId: 'server-id' };
const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: actor.profileId, session: { user: { dynamicsSystemuserId: actor.systemUserId } } }); });
test('GET and capabilities derive actor from authentication even with Board execution off', async () => {
  const before = process.env.BOARD_WRITEUPS_ENABLED;
  process.env.BOARD_WRITEUPS_ENABLED = 'off';
  try {
    await handler({ method: 'GET', query: {} }, response());
    await handler({ method: 'GET', query: { capabilities: 'true' } }, response());
    expect(loadStaffing).toHaveBeenCalledWith(actor);
    expect(staffingCapabilities).toHaveBeenCalledWith(actor);
    expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'reviewers');
  } finally { if (before === undefined) delete process.env.BOARD_WRITEUPS_ENABLED; else process.env.BOARD_WRITEUPS_ENABLED = before; }
});
test('missing app access stops all staffing reads', async () => {
  requireAppAccess.mockResolvedValue(null);
  await handler({ method: 'GET', query: {} }, response());
  expect(loadStaffing).not.toHaveBeenCalled();
});
test.each([
  { role: 'superuser', value: {}, expectedRevision: null },
  { role: 'cso', value: {}, expectedRevision: null, profileId: 'forged' },
  null,
])('rejects unknown roles and forged actor input: %j', async body => {
  const res = response(); await handler({ method: 'POST', body }, res);
  expect(res.status).toHaveBeenCalledWith(400); expect(saveRole).not.toHaveBeenCalled();
});
test('role save forwards server actor and preserves conflict status', async () => {
  saveRole.mockRejectedValue({ httpStatus: 409, code: 'board_settings_changed', message: 'Reload current settings.' });
  const body = { role: 'cso', value: { version: 1, systemUserId: 'new' }, expectedRevision: 'old' }, res = response();
  await handler({ method: 'POST', body }, res);
  expect(saveRole).toHaveBeenCalledWith(actor, body.role, body.value, 'old');
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ code: 'board_settings_changed', error: 'Reload current settings.' });
});
