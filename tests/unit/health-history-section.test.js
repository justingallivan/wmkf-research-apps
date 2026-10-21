/** @jest-environment jsdom */
import { fireEvent, render, screen, within } from '@testing-library/react';
import HealthHistorySection from '../../shared/components/admin/HealthHistorySection';

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const check = (id, overrides = {}) => ({
  id, created_at: '2026-10-01T10:00:00Z', overall_status: 'healthy',
  response_time_ms: 12, triggered_by: `source-${id}`,
  services: { database: { status: 'ok', message: `message-${id}` } }, ...overrides,
});
const history = (checks) => ({ summary: { uptimePercent: 98, healthy: 4, degraded: 1, unhealthy: 1 }, checks });
const reply = (data) => ({ ok: true, status: 200, json: async () => data });
async function openChecks() {
  fireEvent.click(await screen.findByRole('button', { name: 'Show recent checks' }));
}
const rowFor = (id) => screen.getByText(`source-${id}`).closest('tr');

test('the table starts hidden and displays only the first 50 checks in API order', async () => {
  const checks = Array.from({ length: 51 }, (_, i) => check((i * 20) % 51, { created_at: new Date(Date.UTC(2026, 9, 1, 10, (i * 7) % 51)).toISOString() }));
  global.fetch = jest.fn(async () => reply(history(checks)));
  const { container } = render(<HealthHistorySection />);
  await screen.findByRole('button', { name: 'Show recent checks' });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await openChecks();
  const rows = Array.from(container.querySelector('tbody').children);
  expect(rows).toHaveLength(50);
  expect(rows.every(row => row.tagName === 'TR')).toBe(true);
  expect(rows.map(row => row.children[3].textContent)).toEqual(checks.slice(0, 50).map(c => c.triggered_by));
  expect(screen.queryByText(checks[50].triggered_by)).not.toBeInTheDocument();
});

test('only one check expands and hiding the table preserves its expanded check', async () => {
  global.fetch = jest.fn(async () => reply(history([check(1), check(2)])));
  const { container } = render(<HealthHistorySection />);
  await openChecks();
  fireEvent.click(within(rowFor(1)).getByRole('button', { name: 'Show' }));
  expect(screen.getByText('message-1')).toBeVisible();
  fireEvent.click(within(rowFor(2)).getByRole('button', { name: 'Show' }));
  expect(screen.queryByText('message-1')).not.toBeInTheDocument();
  expect(screen.getByText('message-2')).toBeVisible();
  expect(within(rowFor(1)).getByRole('button', { name: 'Show' })).toHaveAttribute('aria-expanded', 'false');
  expect(within(rowFor(2)).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  expect(rowFor(2).nextElementSibling.firstElementChild).toHaveAttribute('colspan', '5');
  expect(Array.from(container.querySelector('tbody').children).every(row => row.tagName === 'TR')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hide recent checks' }));
  expect(screen.queryByText('message-2')).not.toBeInTheDocument();
  await openChecks();
  expect(screen.getByText('message-2')).toBeVisible();
  fireEvent.click(within(rowFor(2)).getByRole('button', { name: 'Hide' }));
  expect(screen.queryByText('message-2')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test.each([['unhealthy', 'text-red-600'], ['degraded', 'text-yellow-600']])('service details retain labels, colors and escaped messages for %s', async (overall_status, summaryColor) => {
  const services = {
    database: { status: 'ok' }, claude: { status: 'error', message: '<img src=x>', detail: 'Failure detail' },
    azureAd: { status: 'warning' }, encryption: { status: 'skipped' }, custom: { status: 'unrecognized' },
  };
  global.fetch = jest.fn(async () => reply(history([check(1, { overall_status, services })])));
  const { container } = render(<HealthHistorySection />);
  await openChecks();
  expect(within(rowFor(1)).getByText('Claude API, Azure AD (SSO), custom')).toHaveClass(summaryColor);
  fireEvent.click(within(rowFor(1)).getByRole('button', { name: 'Show' }));
  const details = within(rowFor(1).nextElementSibling);
  for (const [label, background, badge] of [
    ['Database', 'bg-green-50', 'ok'], ['Claude API', 'bg-red-50', 'error'],
    ['Azure AD (SSO)', 'bg-yellow-50', 'warning'], ['Encryption Key', 'bg-white', 'skipped'], ['custom', 'bg-white', 'unrecognized'],
  ]) {
    const card = details.getByText(label).closest('div.rounded-lg');
    expect(card).toHaveClass(background);
    expect(within(card).getByText(badge)).toBeVisible();
  }
  expect(details.getByText('<img src=x>')).toHaveAttribute('title', '<img src=x>');
  expect(details.getByText('Failure detail')).toHaveAttribute('title', 'Failure detail');
  expect(container.querySelector('img')).toBeNull();
});

test('a check without services toggles its button without adding a details row', async () => {
  global.fetch = jest.fn(async () => reply(history([check(1, { services: null })])));
  const { container } = render(<HealthHistorySection />);
  await openChecks();
  fireEvent.click(within(rowFor(1)).getByRole('button', { name: 'Show' }));
  expect(within(rowFor(1)).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
  expect(container.querySelector('tbody').children).toHaveLength(1);
});

test('changing the time window refetches and preserves expansion for the same check id', async () => {
  let finishRefetch;
  const refetch = new Promise(resolve => { finishRefetch = resolve; });
  global.fetch = jest.fn(async url => {
    if (String(url).includes('hours=72')) await refetch;
    return reply(history([check(1, {
    services: { database: { status: 'ok', message: String(url).includes('hours=72') ? 'Updated history' : 'Initial history' } },
  })]));
  });
  render(<HealthHistorySection />);
  await openChecks();
  fireEvent.click(within(rowFor(1)).getByRole('button', { name: 'Show' }));
  expect(screen.getByText('Initial history')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '3d' }));
  expect(screen.getByText('Initial history')).toBeVisible();
  expect(screen.getByRole('table')).toBeVisible();
  finishRefetch();
  await screen.findByText('Updated history');
  expect(global.fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/health-history?hours=24', '/api/admin/health-history?hours=72']);
  expect(within(rowFor(1)).getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-expanded', 'true');
});
