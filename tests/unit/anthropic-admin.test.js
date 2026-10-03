/** @jest-environment node */
import { getCostReport, getMessagesUsageReport } from '../../lib/services/anthropic-admin';
const originalFetch = global.fetch; const originalKey = process.env.ANTHROPIC_ADMIN_API_KEY;
const window = { startingAt: '2026-09-01T00:00:00Z', endingAt: '2026-10-01T00:00:00Z' };
beforeEach(() => { process.env.ANTHROPIC_ADMIN_API_KEY = 'sk-ant-admin-test'; global.fetch = jest.fn(); });
afterEach(() => { global.fetch = originalFetch; if (originalKey === undefined) delete process.env.ANTHROPIC_ADMIN_API_KEY; else process.env.ANTHROPIC_ADMIN_API_KEY = originalKey; });
const response = data => ({ ok: true, json: async () => data });
it('retrieves every usage page with a fixed window and all billing dimensions', async () => {
  global.fetch.mockResolvedValueOnce(response({ data: [{ starting_at: window.startingAt, ending_at: window.endingAt, results: [] }], has_more: true, next_page: 'next' }))
    .mockResolvedValueOnce(response({ data: [{ starting_at: window.startingAt, ending_at: window.endingAt, results: [] }], has_more: false }));
  expect(await getMessagesUsageReport(window)).toHaveLength(2);
  const urls = global.fetch.mock.calls.map(([url]) => new URL(url));
  expect(urls[0].pathname).toBe('/v1/organizations/usage_report/messages');
  expect(urls[0].searchParams.getAll('group_by[]')).toEqual(['model', 'service_tier', 'context_window', 'inference_geo', 'workspace_id']);
  expect(urls[1].searchParams.get('page')).toBe('next');
  expect(urls[1].searchParams.get('ending_at')).toBe(window.endingAt);
});
it('fails closed when the provider says more pages exist without a continuation', async () => {
  global.fetch.mockResolvedValue(response({ data: [], has_more: true }));
  await expect(getCostReport(window)).rejects.toThrow('Incomplete Anthropic report pagination');
});
it('does not return a partial report at the safety cap', async () => {
  let n = 0; global.fetch.mockImplementation(async () => response({ data: [], has_more: true, next_page: String(++n) }));
  await expect(getMessagesUsageReport(window)).rejects.toThrow('pagination limit');
});
it('does not include provider response bodies or credentials in errors', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 403 });
  await expect(getCostReport(window)).rejects.toThrow('returned HTTP 403');
});

it.each([{ data: [], has_more: undefined }, { data: [{}], has_more: false }])('rejects malformed report completeness metadata: %j', async body => {
  global.fetch.mockResolvedValue(response(body));
  await expect(getCostReport(window)).rejects.toThrow('Invalid Anthropic report response');
});
