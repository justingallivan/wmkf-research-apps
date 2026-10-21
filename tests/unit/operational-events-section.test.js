/**
 * @jest-environment jsdom
 */

/**
 * Render/action test for the admin Operational Events section.
 *
 * Exists because the first cut of "Resolve all shown" and grouping was
 * anchored into the neighbouring SystemAlertsSection by a text edit and
 * nothing — lint, types, route/service tests — caught the undefined
 * references (Codex adversarial re-review S468). This renders the real
 * component against a mocked fetch and exercises both batch actions.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import OperationalEventsSection from '../../shared/components/admin/OperationalEventsSection';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const throttle = (id, traceId, at) => ({
  id,
  source: 'vercel-drain',
  environment: 'production',
  event_type: 'runtime_log_error',
  subsystem: '/api/dynamics-explorer/chat',
  severity: 'error',
  status: 'open',
  summary: `[GraphService] searchFiles failed (429): TraceId ${traceId}`,
  first_occurred_at: at,
  last_occurred_at: at,
  status_changed_at: null,
  occurrence_count: 1,
});

const prefs = {
  id: 50,
  source: 'vercel-drain',
  environment: 'production',
  event_type: 'runtime_log_error',
  subsystem: '/api/user-preferences',
  severity: 'error',
  status: 'open',
  summary: '[dataverse-prefs] setUserPreference error: dataverse failed (403)',
  first_occurred_at: '2026-08-27T22:24:15.480Z',
  last_occurred_at: '2026-08-27T22:24:15.480Z',
  status_changed_at: '2026-08-28T00:00:00.000Z',
  occurrence_count: 1,
};

const listBody = {
  events: [
    prefs,
    throttle(3, 'a4535cb5', '2026-08-27T19:05:49.354Z'),
    throttle(2, 'f472ae7f', '2026-08-27T19:00:52.707Z'),
    throttle(1, '8d85ef8a', '2026-08-27T18:57:37.486Z'),
  ],
  summary: [{ status: 'open', severity: 'error', count: 4 }],
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let patchBodies;
const originalFetch = global.fetch; // jest.setup.js owns a global fetch mock; restore, never delete
const originalConfirm = global.confirm;

beforeEach(() => {
  patchBodies = [];
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') {
      patchBodies.push(JSON.parse(init.body));
      return response({ ok: true, action: 'resolve', requested: patchBodies.at(-1).events.length, updated: patchBodies.at(-1).events.length, stale: 0, notFound: 0, invalid: 0 });
    }
    return response(listBody);
  });
  global.confirm = jest.fn(() => true);
});

afterEach(() => {
  global.fetch = originalFetch;
  global.confirm = originalConfirm;
});

test('renders without throwing, folds the storm into one ×3 group, and keeps the single real problem visible', async () => {
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  expect(screen.getByText(prefs.summary)).toBeInTheDocument();
  // Newest storm row is the group header; the older members are not rendered until expanded.
  expect(screen.getByText(/TraceId a4535cb5/)).toBeInTheDocument();
  expect(screen.queryByText(/TraceId f472ae7f/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resolve all 4 shown' })).toBeInTheDocument();
});

test('Resolve group is only offered once expanded, and sends every member with its full freshness snapshot', async () => {
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  expect(screen.queryByRole('button', { name: /Resolve group/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle(/Show 3 rows/));
  expect(screen.getByText(/TraceId f472ae7f/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Resolve group (3)' }));

  await waitFor(() => expect(patchBodies).toHaveLength(1));
  expect(global.confirm).toHaveBeenCalledWith('Resolve the 3 open event(s) in this group?');
  expect(patchBodies[0]).toEqual({
    action: 'resolve',
    events: [
      { id: 3, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:05:49.354Z', expectedStatusChangedAt: null, expectedOccurrenceCount: 1 },
      { id: 2, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:52.707Z', expectedStatusChangedAt: null, expectedOccurrenceCount: 1 },
      { id: 1, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T18:57:37.486Z', expectedStatusChangedAt: null, expectedOccurrenceCount: 1 },
    ],
  });
  await screen.findByText('Resolved 3 of 3');
});

test('Resolve all shown sends every open row, including a previously-changed row with its status_changed_at', async () => {
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  await waitFor(() => expect(patchBodies).toHaveLength(1));
  expect(patchBodies[0].events).toHaveLength(4);
  expect(patchBodies[0].events[0]).toEqual({
    id: 50, expectedStatus: 'open', expectedLastOccurredAt: prefs.last_occurred_at, expectedStatusChangedAt: '2026-08-28T00:00:00.000Z', expectedOccurrenceCount: 1,
  });
});

test('a declined confirm sends nothing', async () => {
  global.confirm = jest.fn(() => false);
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  expect(patchBodies).toHaveLength(0);
});

test('the single-row Resolve button asserts status_changed_at too', async () => {
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  const prefsCard = screen.getByText(prefs.summary).closest('div.rounded-lg');
  fireEvent.click(within(prefsCard).getByRole('button', { name: 'Resolve' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/admin/operational-events', expect.objectContaining({ method: 'PATCH' })));
  const single = JSON.parse(global.fetch.mock.calls.find(([, init]) => init?.method === 'PATCH')[1].body);
  expect(single).toEqual({
    action: 'resolve', id: 50, expectedStatus: 'open', expectedLastOccurredAt: prefs.last_occurred_at, expectedStatusChangedAt: '2026-08-28T00:00:00.000Z', expectedOccurrenceCount: 1,
  });
});

test('a rejected single-row action is visible instead of failing silently', async () => {
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') return response({ error: 'stale bundle' }, 400);
    if (String(url).includes('status=resolved')) return response({ events: [], summary: [] });
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  const prefsCard = screen.getByText(prefs.summary).closest('div.rounded-lg');
  fireEvent.click(within(prefsCard).getByRole('button', { name: 'Resolve' }));
  await screen.findByText('Update failed (400). Reload the admin page and retry.');

  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  await screen.findByText('Bulk resolve failed');
  expect(screen.queryByText('Update failed (400). Reload the admin page and retry.')).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('combobox', { name: 'Status filter' }), { target: { value: 'resolved' } });
  expect(screen.queryByText('Bulk resolve failed')).not.toBeInTheDocument();
  await screen.findByText('No matching operational events.');
});

test('a partially committed batch reports both the successful and failed row counts', async () => {
  global.fetch = jest.fn(async (_url, init) => {
    if (init?.method === 'PATCH') {
      return response({ ok: false, partial: true, action: 'resolve', requested: 4, updated: 1, stale: 0, notFound: 0, invalid: 0, failed: 1 });
    }
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  await screen.findByText(/Resolved 1 of 4.*1 failed \(retryable\)/);
});

test('a batch completion refetches the current filters, not the filters captured when the PATCH began', async () => {
  let finishPatch;
  global.fetch = jest.fn((url, init) => {
    if (init?.method === 'PATCH') {
      return new Promise(resolve => {
        finishPatch = () => resolve(response({
          ok: true, action: 'resolve', requested: 4, updated: 4, stale: 0, notFound: 0, invalid: 0,
        }));
      });
    }
    return Promise.resolve(response(listBody));
  });

  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));

  fireEvent.change(screen.getByRole('combobox', { name: 'Status filter' }), {
    target: { value: 'resolved' },
  });
  await waitFor(() => expect(
    global.fetch.mock.calls.some(([url]) => String(url).includes('status=resolved')),
  ).toBe(true));

  finishPatch();
  await screen.findByText('Resolved 4 of 4');
  await waitFor(() => {
    const getUrls = global.fetch.mock.calls
      .filter(([, init]) => init?.method !== 'PATCH')
      .map(([url]) => url);
    expect(getUrls).toHaveLength(3);
    expect(getUrls.at(-1)).toContain('status=resolved');
  });
});

// T3 matrix (Stage 3, group A) ahead of migrating all three fetch sites onto
// shared/utils/api-request.js. GET fetchEvents (:67) and PATCH resolveBatch
// (:123) branch on `ok` before deciding whether to read the body; PATCH
// handleAction (:90) never reads a body at all.
test('(c) GET: a network rejection clears the list instead of throwing', async () => {
  global.fetch = jest.fn(async () => { throw new Error('network down'); });
  render(<OperationalEventsSection />);
  expect(await screen.findByText('No matching operational events.')).toBeInTheDocument();
});

test('(d) GET: a malformed 2xx body (bare .json()) is caught the same as a rejection', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
  render(<OperationalEventsSection />);
  expect(await screen.findByText('No matching operational events.')).toBeInTheDocument();
});

test('(e) GET: a non-2xx unparseable body (502) never reads the body, same as today', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } }));
  render(<OperationalEventsSection />);
  expect(await screen.findByText('No matching operational events.')).toBeInTheDocument();
});

test('(c) handleAction: a network rejection shows the connection-failure message', async () => {
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') throw new Error('network down');
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  const prefsCard = screen.getByText(prefs.summary).closest('div.rounded-lg');
  fireEvent.click(within(prefsCard).getByRole('button', { name: 'Resolve' }));
  expect(await screen.findByText('Update failed. Check the connection and retry.')).toBeInTheDocument();
});

test('(e) handleAction: a 409 with an unparseable body still refetches (never reads the body, today\'s behavior)', async () => {
  let getCount = 0;
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') return { ok: false, status: 409, json: async () => { throw new SyntaxError('bad json'); } };
    getCount += 1;
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  const prefsCard = screen.getByText(prefs.summary).closest('div.rounded-lg');
  const getCountBefore = getCount;
  fireEvent.click(within(prefsCard).getByRole('button', { name: 'Resolve' }));
  expect(await screen.findByText('Event changed since load; refreshed without applying the action.')).toBeInTheDocument();
  await waitFor(() => expect(getCount).toBeGreaterThan(getCountBefore));
});

test('(c) resolveBatch: a network rejection shows "Bulk resolve failed"', async () => {
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') throw new Error('network down');
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  expect(await screen.findByText('Bulk resolve failed')).toBeInTheDocument();
});

test('(d) resolveBatch: a malformed 2xx body (bare .json()) shows "Bulk resolve failed"', async () => {
  global.fetch = jest.fn(async (url, init) => {
    if (init?.method === 'PATCH') return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } };
    return response(listBody);
  });
  render(<OperationalEventsSection />);
  await screen.findByText('×3');
  fireEvent.click(screen.getByRole('button', { name: 'Resolve all 4 shown' }));
  expect(await screen.findByText('Bulk resolve failed')).toBeInTheDocument();
});

test.each(['resolved', 'recovered', 'superseded'])('%s can be reopened with full freshness and only its action disabled while pending', async (status) => {
  const event = { ...prefs, status, occurrence_count: status === 'recovered' ? 2 : 7 };
  if (status === 'superseded') delete event.status_changed_at;
  const other = { ...prefs, id: 51, summary: 'Another distinct incident', status: 'open' };
  let finish;
  global.fetch = jest.fn((url, init) => init?.method === 'PATCH'
    ? new Promise(resolve => { finish = () => resolve(response({})); })
    : Promise.resolve(response({ events: [event, other], summary: [] })));
  render(<OperationalEventsSection />);
  const card = (await screen.findByText(event.summary)).closest('div.rounded-lg');
  const otherCard = screen.getByText(other.summary).closest('div.rounded-lg');
  expect(within(card).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  fireEvent.click(within(card).getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(within(card).getByRole('button', { name: 'Reopen' })).toBeDisabled();
  expect(within(card).getByTitle('Expand')).toBeEnabled();
  expect(within(otherCard).getByRole('button', { name: 'Resolve' })).toBeEnabled();
  const patches = global.fetch.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(patches).toHaveLength(1);
  expect(JSON.parse(patches[0][1].body)).toEqual({
    action: 'reopen', id: event.id, expectedStatus: status,
    expectedLastOccurredAt: event.last_occurred_at,
    expectedStatusChangedAt: event.status_changed_at ?? null,
    expectedOccurrenceCount: event.occurrence_count,
  });
  await act(async () => { finish(); });
  await waitFor(() => expect(global.fetch.mock.calls.filter(([, init]) => init?.method !== 'PATCH')).toHaveLength(2));
  await waitFor(() => expect(within(screen.getByText(event.summary).closest('div.rounded-lg')).getByRole('button', { name: 'Reopen' })).toBeEnabled());
});

test.each(['info', 'unexpected-status'])('%s stays visible and offers neither resolve nor reopen', async (status) => {
  global.fetch = jest.fn(async () => response({ events: [{ ...prefs, status, severity: status === 'info' ? 'error' : 'unknown-severity' }], summary: [] }));
  render(<OperationalEventsSection />);
  const card = (await screen.findByText(prefs.summary)).closest('div.rounded-lg');
  const badge = within(card).getByText(status);
  expect(badge).toBeVisible();
  expect(card).toHaveClass(...(status === 'info' ? ['bg-red-50', 'text-red-700', 'border-red-200'] : ['bg-blue-50', 'text-blue-700', 'border-blue-200']));
  if (status !== 'info') expect(card.querySelector('span.bg-gray-400')).not.toBeNull();
  expect(badge).toHaveClass(status === 'info' ? 'bg-blue-100' : 'bg-gray-100');
  expect(within(card).queryByRole('button', { name: 'Resolve' })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
});

test('individual expansion is shared across standalone and grouped cards and details stay escaped', async () => {
  const events = listBody.events.map(e => ({ ...e, correlation_id: `correlation-${e.id}`, resolution_note: 'Resolution detail', entity_refs: { request: 'request-ref' }, metadata: { note: '<img src=x onerror=alert(1)>' } }));
  global.fetch = jest.fn(async () => response({ ...listBody, events }));
  render(<OperationalEventsSection />);
  const single = (await screen.findByText(prefs.summary)).closest('div.rounded-lg');
  fireEvent.click(within(single).getByTitle('Expand'));
  expect(screen.getByText('Correlation: correlation-50')).toBeVisible();
  expect(within(single).getByText('Note: Resolution detail')).toBeVisible();
  expect(within(single).getByText(/request-ref/)).toBeVisible();
  const metadata = within(single).getByText(/<img src=x/);
  expect(metadata.tagName).toBe('PRE');
  expect(single.querySelector('img')).toBeNull();
  fireEvent.click(screen.getByTitle(/Show 3 rows/));
  const member = screen.getByText(/TraceId f472ae7f/).closest('div.rounded-lg');
  fireEvent.click(within(member).getByTitle('Expand'));
  expect(screen.queryByText('Correlation: correlation-50')).not.toBeInTheDocument();
  expect(screen.getByText('Correlation: correlation-2')).toBeVisible();
  fireEvent.click(screen.getByTitle('Collapse group'));
  expect(screen.queryByText('Correlation: correlation-2')).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle(/Show 3 rows/));
  expect(screen.getByText('Correlation: correlation-2')).toBeVisible();
  const reopened = screen.getByText(/TraceId f472ae7f/).closest('div.rounded-lg');
  fireEvent.click(within(reopened).getByTitle('Collapse'));
  expect(screen.queryByText('Correlation: correlation-2')).not.toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledTimes(1);
});
