/** @jest-environment node */
import handler from '../../pages/api/landing-cycle';
import { requireAuth } from '../../lib/utils/auth';
import { withDalContext } from '../../lib/dataverse/core/context';
import {
  getLandingCycle,
  loadLandingCycleEditor,
  resolveBoardDefaultCycle,
  saveLandingCycle,
} from '../../lib/services/landing-cycle-service';

jest.mock('../../lib/utils/auth', () => ({ requireAuth: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/landing-cycle-service', () => ({
  getLandingCycle: jest.fn(),
  loadLandingCycleEditor: jest.fn(),
  resolveBoardDefaultCycle: jest.fn(),
  saveLandingCycle: jest.fn(),
}));

const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
const staffSession = { user: { profileId: 7, dynamicsSystemuserId: 'server-id', userType: 'staff' } };
const ACTOR = { profileId: 7, systemUserId: 'server-id' };

beforeEach(() => {
  jest.clearAllMocks();
  requireAuth.mockResolvedValue(staffSession);
  getLandingCycle.mockResolvedValue({ code: 'J27', reason: null });
  resolveBoardDefaultCycle.mockResolvedValue('D26');
  loadLandingCycleEditor.mockResolvedValue({ status: 'active' });
  saveLandingCycle.mockResolvedValue({ status: 'active' });
});

test('plain GET returns only the effective landing code inside a DAL context', async () => {
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(withDalContext).toHaveBeenCalledWith('landing-cycle', expect.any(Function));
  expect(res.json).toHaveBeenCalledWith({ landingCycleCode: 'J27' });
});

test('board and editor views', async () => {
  const board = response();
  await handler({ method: 'GET', query: { view: 'board' } }, board);
  expect(board.json).toHaveBeenCalledWith({ cycleCode: 'D26' });
  const editor = response();
  await handler({ method: 'GET', query: { view: 'editor' } }, editor);
  expect(loadLandingCycleEditor).toHaveBeenCalledWith(ACTOR);
});

test.each([
  [{ view: 'other' }],
  [{ view: 'board', extra: '1' }],
  [{ cycle: 'J27' }],
  [{ view: ['board', 'editor'] }],
])('unsupported query %j is a 400 with no read', async (query) => {
  const res = response();
  await handler({ method: 'GET', query }, res);
  expect(res.status).toHaveBeenCalledWith(400);
  expect(getLandingCycle).not.toHaveBeenCalled();
  expect(resolveBoardDefaultCycle).not.toHaveBeenCalled();
  expect(loadLandingCycleEditor).not.toHaveBeenCalled();
});

test.each([
  ['applicant session', { user: { userType: 'applicant', profileId: 7 } }],
  ['session without a staff profile', { user: {} }],
  ['auth bypass', { user: { profileId: 7 }, authBypassed: true }],
])('%s is refused before any read or save', async (_name, session) => {
  requireAuth.mockResolvedValue(session);
  for (const req of [{ method: 'GET', query: {} }, { method: 'POST', query: {}, body: { cycleCode: 'J27', revision: null } }]) {
    const res = response();
    await handler(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  }
  expect(getLandingCycle).not.toHaveBeenCalled();
  expect(saveLandingCycle).not.toHaveBeenCalled();
});

test('unauthenticated requests stop at requireAuth', async () => {
  requireAuth.mockResolvedValue(null);
  await handler({ method: 'GET', query: {} }, response());
  expect(getLandingCycle).not.toHaveBeenCalled();
});

test('save passes the body with the server-derived actor, never a client identity', async () => {
  const res = response();
  const body = { cycleCode: 'J27', revision: 'W/"5"' };
  await handler({ method: 'POST', query: {}, body }, res);
  expect(saveLandingCycle).toHaveBeenCalledWith(ACTOR, body);
});

test('service status and message are preserved; unexpected errors are generic 500s', async () => {
  saveLandingCycle.mockRejectedValueOnce(Object.assign(new Error('Only editors.'), { httpStatus: 403, code: 'landing_edit_denied' }));
  const denied = response();
  await handler({ method: 'POST', query: {}, body: {} }, denied);
  expect(denied.status).toHaveBeenCalledWith(403);
  expect(denied.json).toHaveBeenCalledWith({ error: 'Only editors.', code: 'landing_edit_denied' });

  loadLandingCycleEditor.mockRejectedValueOnce(new Error('secret internals'));
  const broken = response();
  await handler({ method: 'GET', query: { view: 'editor' } }, broken);
  expect(broken.status).toHaveBeenCalledWith(500);
  expect(broken.json).toHaveBeenCalledWith({ error: 'The landing cycle is unavailable. Reload and try again.', code: 'landing_unavailable' });
});

test('other methods are 405', async () => {
  const res = response();
  await handler({ method: 'DELETE', query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(405);
});
