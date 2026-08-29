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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

test('Resolve group is only offered once the group is expanded, and sends every member with its full freshness triple', async () => {
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
      { id: 3, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:05:49.354Z', expectedStatusChangedAt: null },
      { id: 2, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T19:00:52.707Z', expectedStatusChangedAt: null },
      { id: 1, expectedStatus: 'open', expectedLastOccurredAt: '2026-08-27T18:57:37.486Z', expectedStatusChangedAt: null },
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
    id: 50, expectedStatus: 'open', expectedLastOccurredAt: prefs.last_occurred_at, expectedStatusChangedAt: '2026-08-28T00:00:00.000Z',
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
    action: 'resolve', id: 50, expectedStatus: 'open', expectedLastOccurredAt: prefs.last_occurred_at, expectedStatusChangedAt: '2026-08-28T00:00:00.000Z',
  });
});
