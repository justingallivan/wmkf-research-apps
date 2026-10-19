/** @jest-environment node */
jest.mock('../../lib/utils/auth.js', () => ({ requireAppAccess: jest.fn() }));
jest.mock('../../lib/dataverse/core/context.js', () => ({ withDalContext: jest.fn((_label, fn) => fn()) }));
jest.mock('../../lib/services/meeting-tracker/program-briefing-service.js', () => ({ loadProgramBriefing: jest.fn() }));
import { requireAppAccess } from '../../lib/utils/auth.js';
import { withDalContext } from '../../lib/dataverse/core/context.js';
import { loadProgramBriefing } from '../../lib/services/meeting-tracker/program-briefing-service.js';
import handler from '../../pages/api/meeting-tracker/program-briefing.js';
const call = async (query = {}, method = 'GET') => {
  const res = { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  await handler({ method, query }, res); return res;
};
beforeEach(() => { jest.clearAllMocks(); requireAppAccess.mockResolvedValue({ profileId: 7 }); loadProgramBriefing.mockResolvedValue({ groups: [] }); });
test('requires Meeting Tracker app access before reads', async () => {
  requireAppAccess.mockImplementationOnce(async (_req, res) => { res.status(403).json({ error: 'Forbidden' }); return null; });
  expect((await call()).statusCode).toBe(403); expect(loadProgramBriefing).not.toHaveBeenCalled();
});
test('passes session identity inside trusted DAL context and prevents caching', async () => {
  const res = await call({ cycleCode: 'D26' });
  expect(requireAppAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'meeting-tracker');
  expect(loadProgramBriefing).toHaveBeenCalledWith({ cycleCode: 'D26', profileId: 7 });
  expect(withDalContext).toHaveBeenCalled(); expect(res.headers['Cache-Control']).toBe('private, no-store');
});
test.each([{ profileId: '1' }, { requestIds: 'ids' }, { cycleCode: ['D26', 'J27'] }])('refuses spoofed/unsupported query %j', async (query) => {
  expect((await call(query)).statusCode).toBe(400); expect(loadProgramBriefing).not.toHaveBeenCalled();
});
test('unlinked profile and write methods cannot reach the reader', async () => {
  requireAppAccess.mockResolvedValueOnce({ profileId: null });
  expect((await call()).statusCode).toBe(401);
  expect((await call({}, 'POST')).statusCode).toBe(405);
  expect(loadProgramBriefing).not.toHaveBeenCalled();
});
test('hides infrastructure errors', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  loadProgramBriefing.mockRejectedValueOnce(new Error('private credential details'));
  const res = await call(); expect(res.statusCode).toBe(500); expect(JSON.stringify(res.body)).not.toContain('credential'); spy.mockRestore();
});
