/** @jest-environment node */
import workbench from '../../pages/api/workbench/board-writeups';
import admin from '../../pages/api/admin/board-writeup-cycles';
import { requireAppAccess } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import { boardActor, listCycles } from '../../lib/services/board-writeups/config';
jest.mock('../../lib/utils/auth', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/board-writeups/config', () => ({ boardActor: jest.fn(), listCycles: jest.fn() }));
jest.mock('../../lib/services/board-writeups/service', () => ({}));
jest.mock('../../lib/services/board-writeups/source', () => ({}));
jest.mock('../../lib/services/board-writeups/archive', () => ({}));
jest.mock('../../lib/services/board-writeups/recovery', () => ({}));
const original = { ...process.env };
const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.BOARD_WRITEUPS_ENABLED;
  delete process.env.RESEARCH_LEADERSHIP_DIGEST_MODE;
  requireAppAccess.mockResolvedValue({ profileId: 'admin', session: { user: { dynamicsSystemuserId: 'staff' } } });
  boardActor.mockResolvedValue({ canRelease: true, canArchive: true, isSuperuser: true });
  listCycles.mockResolvedValue(['D26']);
});
afterAll(() => { process.env = original; });
test.each([
  [undefined, undefined], ['legacy', 'on'], ['paused', 'on'], ['invalid', 'on'], ['board-release', undefined], ['board-release', 'off'],
])('disabled mode %s / %s blocks every Board entry before data access', async (mode, enabled) => {
  if (mode) process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = mode;
  if (enabled) process.env.BOARD_WRITEUPS_ENABLED = enabled;
  for (const [handler, method, query, body] of [
    [workbench, 'GET', {}, {}], [workbench, 'GET', { cycle: 'D26' }, {}],
    [workbench, 'POST', {}, { cycle: 'D26', selections: [{}] }],
    ...['role', 'save', 'reconcileConfig', 'archive', 'recover', 'resolve'].flatMap(action => ['POST', 'PUT'].map(method => [admin, method, {}, { action, cycle: 'D26' }])),
    ...[undefined, 'reconcile', 'inspectRecovery'].map(action => [admin, 'GET', { cycle: 'D26', action }, {}]),
  ]) {
    const res = response();
    await handler({ method, query, body }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Board writeups are disabled.', code: 'board_disabled' });
  }
  expect(withDalContext).not.toHaveBeenCalled();
  expect(boardActor).not.toHaveBeenCalled();
});
test('enabled capability lookup retains role-based access', async () => {
  process.env.RESEARCH_LEADERSHIP_DIGEST_MODE = 'board-release';
  process.env.BOARD_WRITEUPS_ENABLED = 'on';
  const res = response();
  await workbench({ method: 'GET', query: {} }, res);
  expect(res.json).toHaveBeenCalledWith({ canRelease: true, canArchive: true, isSuperuser: true, cycles: ['D26'] });
  expect(boardActor).toHaveBeenCalledTimes(1);
});
test.each([workbench, admin])('authentication still precedes the feature guard', async handler => {
  requireAppAccess.mockResolvedValue(null);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(requireAppAccess).toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
  expect(withDalContext).not.toHaveBeenCalled();
});
