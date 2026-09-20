/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import AdminOverviewSection, { buildAttentionItems } from '../../shared/components/admin/AdminOverviewSection';

test('healthy source data produces no exceptions', () => {
  const items = buildAttentionItems({
    health: { overall: 'ok', services: { dataverse: { status: 'ok' } } },
    alerts: { alerts: [] },
    maintenance: { jobs: [] },
    secrets: { secrets: [] },
    usage: { summary: { error_count: 0 } },
  }, {});

  expect(items).toEqual([]);
});

test('exceptions link to the workspace that owns the corrective action', () => {
  const items = buildAttentionItems({
    health: { overall: 'error', services: { dataverse: { status: 'error' } } },
    alerts: { alerts: [{ severity: 'critical' }] },
    maintenance: { jobs: [{ jobName: 'daily-maintenance', lastRun: { status: 'failed' } }] },
    secrets: { secrets: [{ status: 'expired' }] },
    usage: { summary: { error_count: 2 } },
  }, {});

  expect(items.map((item) => item.href)).toEqual(expect.arrayContaining([
    '/admin?workspace=operations&view=health',
    '/admin?workspace=operations&view=incidents',
    '/admin?workspace=operations&view=jobs',
    '/admin?workspace=operations&view=credentials',
    '/admin?workspace=ai&view=usage',
  ]));
  expect(items[0].tone).toBe('critical');
});

test('an unavailable source is visible rather than creating a false all-clear', () => {
  const items = buildAttentionItems({}, { usage: 'Request failed' });

  expect(items).toEqual([
    expect.objectContaining({
      key: 'unavailable-usage',
      title: 'API usage could not be checked',
      detail: 'Request failed',
      href: '/admin?workspace=ai&view=usage',
    }),
  ]);
});

// T3 matrix (Stage 3 correction round 1) for the one remaining raw fetch(
// site: loadSource (:29), shared by all five OVERVIEW_SOURCES. All five
// sources default to a healthy 2xx `{}` (yields no attention item for any
// of them, per buildAttentionItems' own defaults) so a single case can
// override just one source (`usage`, /api/admin/stats?period=7d) and the
// rest stay quiet. Run against the unmigrated component first (must pass),
// then unchanged after the migration commit.
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const malformedResponse = (status) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
});

const USAGE_URL = '/api/admin/stats?period=7d';

function mockOverviewFetch(usageHandler) {
  global.fetch = jest.fn((url) => {
    if (url === USAGE_URL) return usageHandler(url);
    return Promise.resolve(jsonResponse(200, {}));
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('(a) all sources healthy 2xx render "No exceptions were found"', async () => {
  mockOverviewFetch(() => Promise.resolve(jsonResponse(200, {})));
  render(<AdminOverviewSection />);
  expect(await screen.findByText('No exceptions were found in the current checks.')).toBeInTheDocument();
});

test('(b) non-2xx {error} body surfaces that message verbatim as the item detail', async () => {
  mockOverviewFetch(() => Promise.resolve(jsonResponse(500, { error: 'Custom check failure' })));
  render(<AdminOverviewSection />);
  expect(await screen.findByText('Custom check failure')).toBeInTheDocument();
});

test('(c) a network rejection surfaces the rejection\'s own message', async () => {
  mockOverviewFetch(() => Promise.reject(new Error('network down')));
  render(<AdminOverviewSection />);
  expect(await screen.findByText('network down')).toBeInTheDocument();
});

test('(d) a malformed/empty 2xx body falls back to today\'s silent success (no item for that source)', async () => {
  mockOverviewFetch(() => Promise.resolve(malformedResponse(200)));
  render(<AdminOverviewSection />);
  expect(await screen.findByText('No exceptions were found in the current checks.')).toBeInTheDocument();
  expect(screen.queryByText(/could not be checked/)).not.toBeInTheDocument();
});

test('(b/d) a malformed non-2xx body (502) falls back to the fixed "could not be checked" text, never silent', async () => {
  mockOverviewFetch(() => Promise.resolve(malformedResponse(502)));
  render(<AdminOverviewSection />);
  const matches = await screen.findAllByText('API usage could not be checked');
  // The fallback message is used as BOTH the item title and its detail
  // (buildAttentionItems' unavailable-source branch: title is fixed text,
  // detail is errors[key], and here they are the same string).
  expect(matches).toHaveLength(2);
});

test('(e) a source whose fetch rejects with AbortError produces no item and is not treated as an error', async () => {
  mockOverviewFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  render(<AdminOverviewSection />);
  expect(await screen.findByText('No exceptions were found in the current checks.')).toBeInTheDocument();
  expect(screen.queryByText(/could not be checked/)).not.toBeInTheDocument();
});
