/** @jest-environment node */
import handler from '../../pages/api/cycle-calendar';
import { requireAuth } from '../../lib/utils/auth';
import { loadCalendar, saveDate } from '../../lib/services/cycle-calendar-service';

jest.mock('../../lib/utils/auth', () => ({ requireAuth: jest.fn() }));
jest.mock('../../lib/dataverse/core/context', () => ({ withDalContext: jest.fn((_name, fn) => fn()) }));
jest.mock('../../lib/services/cycle-calendar-service', () => ({ loadCalendar: jest.fn(), saveDate: jest.fn() }));

const response = () => { const res = { setHeader: jest.fn(), status: jest.fn(), json: jest.fn() }; res.status.mockReturnValue(res); return res; };
const staffSession = { user: { profileId: 7, dynamicsSystemuserId: 'server-id', userType: 'staff' } };

beforeEach(() => { jest.clearAllMocks(); requireAuth.mockResolvedValue(staffSession); loadCalendar.mockResolvedValue({ cycles: [] }); });

test('staff read derives the actor from the session', async () => {
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(loadCalendar).toHaveBeenCalledWith({ profileId: 7, systemUserId: 'server-id' });
});

test('staff without a linked Dynamics identity can still read', async () => {
  requireAuth.mockResolvedValue({ user: { profileId: 7 } });
  await handler({ method: 'GET', query: {} }, response());
  expect(loadCalendar).toHaveBeenCalledWith({ profileId: 7, systemUserId: null });
});

test.each([
  ['applicant session', { user: { userType: 'applicant', profileId: 7 } }],
  ['session without a staff profile', { user: {} }],
  ['auth bypass', { user: {}, authBypassed: true }],
])('%s is refused before any read', async (_name, session) => {
  requireAuth.mockResolvedValue(session);
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(loadCalendar).not.toHaveBeenCalled();
});

test('unauthenticated requests stop at requireAuth', async () => {
  requireAuth.mockResolvedValue(null);
  await handler({ method: 'GET', query: {} }, response());
  expect(loadCalendar).not.toHaveBeenCalled();
});

test('save passes the body with the server-derived actor and preserves service status', async () => {
  saveDate.mockRejectedValue({ httpStatus: 409, code: 'calendar_conflict', message: 'This cycle changed since you opened it. Reload to see the latest dates.' });
  const body = { cycleCode: 'J27', column: 'wmkf_researchreviewsduedate', value: '2027-03-17', etag: 'W/"1"' };
  const res = response();
  await handler({ method: 'POST', body }, res);
  expect(saveDate).toHaveBeenCalledWith({ profileId: 7, systemUserId: 'server-id' }, body);
  expect(res.status).toHaveBeenCalledWith(409);
});

test('unexpected errors are not leaked', async () => {
  loadCalendar.mockRejectedValue(new Error('secret detail'));
  const res = response();
  await handler({ method: 'GET', query: {} }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret detail');
});

test('other methods and query parameters are rejected', async () => {
  const put = response();
  await handler({ method: 'PUT', query: {} }, put);
  expect(put.status).toHaveBeenCalledWith(405);
  const query = response();
  await handler({ method: 'GET', query: { cycle: 'J27' } }, query);
  expect(query.status).toHaveBeenCalledWith(400);
});
