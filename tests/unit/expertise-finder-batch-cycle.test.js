/**
 * Expertise Finder Batch tab — the grant-cycle selector opens on the working
 * cycle (the upcoming board meeting) and queries by cycle code, not by the
 * akoya_fiscalyear string (owner decision 2026-09-08; the hard-coded
 * 'December 2025' default is gone).
 *
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ExpertiseFinderPage from '../../pages/expertise-finder';
import { conventionalCycles, resolveWorkingCycle } from '../../lib/utils/cycle-code.js';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <section>{children}</section>,
  Button: ({ children, loading: _loading, ...props }) => <button {...props}>{children}</button>,
}));
jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => <>{children}</>,
}));
// T2 (client-request-layer Stage 2, plan §5): exposes a button so tests can
// drive MatchTab's handleMatch without a real upload widget.
// T2: the real ErrorAlert reads a prop named `error`, while every call site
// in this page passes `message` — a pre-existing mismatch outside Stage 2's
// scope, which is why the real component never actually surfaces these error
// strings today. Mocked here (as StaffDeliberationsTab.test.js mocks its own
// children) so the T2 matrix can assert the *state the page computed*
// (`error.message`/derived text) is unchanged by the migration, independent
// of that unrelated display bug.
jest.mock('../../shared/components/ErrorAlert', () => ({
  __esModule: true,
  default: ({ message, error }) => ((message || error) ? <p role="alert">{message || error}</p> : null),
}));

jest.mock('../../shared/components/FileUploaderSimple', () => ({
  __esModule: true,
  default: ({ onFilesUploaded }) => (
    <button type="button" onClick={() => onFilesUploaded([{ url: 'https://example.test/file.pdf', filename: 'file.pdf' }])}>
      mock-upload
    </button>
  ),
}));

beforeEach(() => {
  // `status` is required: requestEnvelope reads `response.status` directly
  // (plan §5 T2 note), unlike the bare `{ ok, json }` this fixture used
  // before Stage 2 migrated any site in this file to requestEnvelope.
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ proposals: [], totalCount: 0 }) }));
});

test('Batch tab opens on the working cycle and loads proposals by cycle code', async () => {
  const expected = resolveWorkingCycle(conventionalCycles());
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));

  const select = screen.getByLabelText('Grant Cycle');
  expect(select.value).toBe(expected);
  expect(select.value).not.toBe('December 2025');
  // Every option is a cycle code, labelled with its month and year.
  const options = [...select.options].map((o) => o.value);
  expect(options).toContain(expected);
  expect(options.every((code) => /^[JD]\d{2}$/.test(code))).toBe(true);
  expect(screen.getByRole('option', { name: 'D26 - December 2026' })).toBeInTheDocument();

  fireEvent.click(screen.getByText('Load Proposals'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/api/expertise-finder/proposals');
  expect(url.searchParams.get('cycleCode')).toBe(expected);
  expect(url.searchParams.has('fiscalYear')).toBe(false);
});

// ── T2 (client-request-layer Stage 2, plan §5) per-call-site matrix for the
// remaining seven sites in pages/expertise-finder.js: MatchTab (handleMatch),
// RosterTab (fetchRoster/handleSaveEdit/handleDelete/handleAdd), BatchTab
// (runBatch), HistoryTab (fetchHistory). Every site here uses a bare
// `.json()` (strict body parse, no `.catch`), so a malformed 2xx body must
// still reject with the native parse error. ──────────────────────────────

function routeFetch(handlers) {
  return jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    for (const h of handlers) {
      if (h.test(String(url), method)) return h.respond(options);
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  });
}
function ok(body, status = 200) { return { ok: true, status, json: async () => body }; }
function fail(body, status = 400) { return { ok: false, status, json: async () => body }; }

test('T2: MatchTab handleMatch — success reads results/metadata and posts exact body', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/match'), respond: () => ok({ results: { proposal_summary: { title: 'T' } }, metadata: { model: 'x' } }) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByText('Find Matches'));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  const [url, options] = global.fetch.mock.calls[0];
  expect(url).toBe('/api/expertise-finder/match');
  expect(options.method).toBe('POST');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(options.body)).toEqual({ file: { url: 'https://example.test/file.pdf', filename: 'file.pdf' } });
  expect(await screen.findByText('T')).toBeInTheDocument();
});

test('T2: MatchTab handleMatch — non-2xx surfaces data.error verbatim', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/match'), respond: () => fail({ error: 'No usable text extracted.' }, 422) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByText('Find Matches'));
  expect(await screen.findByText('No usable text extracted.')).toBeInTheDocument();
});

test('T2: MatchTab handleMatch — non-2xx with no error field falls back to "HTTP <status>"', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/match'), respond: () => fail({}, 500) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByText('Find Matches'));
  expect(await screen.findByText('HTTP 500')).toBeInTheDocument();
});

test('T2: MatchTab handleMatch — network rejection surfaces the native message', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByText('Find Matches'));
  expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
});

test('T2: MatchTab handleMatch — malformed 2xx body (json() rejects) surfaces the native parse error (strict)', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }));
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('mock-upload'));
  fireEvent.click(screen.getByText('Find Matches'));
  expect(await screen.findByText('Unexpected end of JSON input')).toBeInTheDocument();
});

const MEMBER = {
  id: 'm1', name: 'Ada Lovelace', role: 'Professor', affiliation: 'Test U',
  role_type: 'Board', preferred_email: 'ada@example.org', dataverse_contact_id: null,
};

test('T2: RosterTab fetchRoster — success loads members and builds the exact query', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [MEMBER] }) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  expect(await screen.findByText('Ada Lovelace')).toBeInTheDocument();
  const url = new URL(global.fetch.mock.calls[0][0], 'http://localhost');
  expect(url.pathname).toBe('/api/expertise-finder/roster');
  expect(url.searchParams.get('limit')).toBe('500');
});

test('T2: RosterTab fetchRoster — non-2xx surfaces data.error verbatim', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => fail({ error: 'Roster lookup failed.' }, 500) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  expect(await screen.findByText('Roster lookup failed.')).toBeInTheDocument();
});

test('T2: RosterTab fetchRoster — network rejection surfaces the native message', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
});

test('T2: RosterTab handleSaveEdit — PATCH posts exact body/headers and updates the member on success', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [MEMBER] }) },
    { test: (u, m) => m === 'PATCH' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ member: { ...MEMBER, role: 'Emeritus Professor' } }) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('Ada Lovelace'));
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByText('Save Changes'));

  await waitFor(() => expect(global.fetch.mock.calls.some(([, o = {}]) => o.method === 'PATCH')).toBe(true));
  const [, options] = global.fetch.mock.calls.find(([, o = {}]) => o.method === 'PATCH');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(options.body)).toMatchObject({ id: 'm1', name: 'Ada Lovelace' });
  expect(await screen.findByText('Emeritus Professor', { exact: false })).toBeInTheDocument();
});

test('T2: RosterTab handleSaveEdit — non-2xx surfaces data.error verbatim', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [MEMBER] }) },
    { test: (u, m) => m === 'PATCH' && u.includes('/api/expertise-finder/roster'), respond: () => fail({ error: 'Save conflict.' }, 409) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('Ada Lovelace'));
  fireEvent.click(screen.getByText('Edit'));
  fireEvent.click(screen.getByText('Save Changes'));
  expect(await screen.findByText('Save conflict.')).toBeInTheDocument();
});

test('T2: RosterTab handleDelete — DELETE posts exact body and removes the member on success', async () => {
  window.confirm = jest.fn(() => true);
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [MEMBER] }) },
    { test: (u, m) => m === 'DELETE' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ success: true }) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('Ada Lovelace'));
  fireEvent.click(screen.getByText('Deactivate'));

  await waitFor(() => expect(global.fetch.mock.calls.some(([, o = {}]) => o.method === 'DELETE')).toBe(true));
  const [, options] = global.fetch.mock.calls.find(([, o = {}]) => o.method === 'DELETE');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(options.body)).toEqual({ id: 'm1' });
  await waitFor(() => expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument());
});

test('T2: RosterTab handleDelete — non-2xx surfaces data.error verbatim', async () => {
  window.confirm = jest.fn(() => true);
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [MEMBER] }) },
    { test: (u, m) => m === 'DELETE' && u.includes('/api/expertise-finder/roster'), respond: () => fail({ error: 'Cannot deactivate.' }, 409) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('Ada Lovelace'));
  fireEvent.click(screen.getByText('Deactivate'));
  expect(await screen.findByText('Cannot deactivate.')).toBeInTheDocument();
});

test('T2: RosterTab handleAdd — POST posts exact headers and adds the member on success', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [] }) },
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ member: { ...MEMBER, id: 'm2', name: 'Grace Hopper' } }) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('+ Add Member'));
  fireEvent.change(within(screen.getByText('Name *').closest('div')).getByRole('textbox'), { target: { value: 'Grace Hopper' } });
  fireEvent.click(screen.getByText('Add Member'));

  await waitFor(() => expect(global.fetch.mock.calls.some(([, o = {}]) => o.method === 'POST')).toBe(true));
  const [, options] = global.fetch.mock.calls.find(([, o = {}]) => o.method === 'POST');
  expect(options.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(options.body)).toMatchObject({ name: 'Grace Hopper' });
  expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
});

test('T2: RosterTab handleAdd — non-2xx surfaces data.error verbatim', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/roster'), respond: () => ok({ members: [] }) },
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/roster'), respond: () => fail({ error: 'Duplicate name.' }, 409) },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Roster'));
  fireEvent.click(await screen.findByText('+ Add Member'));
  fireEvent.change(within(screen.getByText('Name *').closest('div')).getByRole('textbox'), { target: { value: 'Grace Hopper' } });
  fireEvent.click(screen.getByText('Add Member'));
  expect(await screen.findByText('Duplicate name.')).toBeInTheDocument();
});

test('T2: BatchTab loadProposals — non-2xx surfaces data.error verbatim', async () => {
  global.fetch = jest.fn(async () => fail({ error: 'Cycle lookup failed.' }, 500));
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));
  fireEvent.click(screen.getByText('Load Proposals'));
  expect(await screen.findByText('Cycle lookup failed.')).toBeInTheDocument();
});

test('T2: BatchTab loadProposals — network rejection surfaces the native message', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));
  fireEvent.click(screen.getByText('Load Proposals'));
  expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
});

test('T2: BatchTab runBatch (batch-match) — success and non-2xx both record per-proposal results without throwing, posting the exact body', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/proposals'), respond: () => ok({ proposals: [{ requestId: 'r1', requestNumber: '1001' }, { requestId: 'r2', requestNumber: '1002' }] }) },
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/batch-match'), respond: (options) => {
      const parsed = JSON.parse(options.body);
      return parsed.requestId === 'r1' ? ok({ staff_assignment: {} }) : fail({ error: 'No file found.', availableFiles: [] }, 422);
    } },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));
  fireEvent.click(screen.getByText('Load Proposals'));
  await screen.findAllByText(/1001|1002/);
  fireEvent.click(screen.getByText('Run All'));

  await waitFor(() => expect(global.fetch.mock.calls.filter(([, o = {}]) => o.method === 'POST')).toHaveLength(2));
  const [, firstOptions] = global.fetch.mock.calls.find(([, o = {}]) => o.method === 'POST');
  expect(firstOptions.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(firstOptions.body)).toEqual({ requestId: 'r1', requestNumber: '1001' });
  expect(await screen.findByTitle('No file found.')).toBeInTheDocument();
});

test('T2: BatchTab runBatch (batch-match) — network rejection is recorded per-proposal, not thrown', async () => {
  global.fetch = routeFetch([
    { test: (u, m) => m === 'GET' && u.includes('/api/expertise-finder/proposals'), respond: () => ok({ proposals: [{ requestId: 'r1', requestNumber: '1001' }] }) },
    { test: (u, m) => m === 'POST' && u.includes('/api/expertise-finder/batch-match'), respond: () => { throw new TypeError('Failed to fetch'); } },
  ]);
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('Batch'));
  fireEvent.click(screen.getByText('Load Proposals'));
  await screen.findAllByText(/1001/);
  fireEvent.click(screen.getByText('Run All'));
  expect(await screen.findByTitle('Failed to fetch')).toBeInTheDocument();
});

test('T2: HistoryTab fetchHistory — success renders matches from the response', async () => {
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/api/expertise-finder/history')
      ? ok({ matches: [{ id: 'h1', proposal_title: 'A studied proposal' }] })
      : ok({ proposals: [] })
  ));
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('History'));
  expect(await screen.findByText(/A studied proposal/)).toBeInTheDocument();
});

test('T2: HistoryTab fetchHistory — non-2xx silently leaves matches empty (site never checks !ok to throw)', async () => {
  global.fetch = jest.fn(async (url) => (
    String(url).includes('/api/expertise-finder/history')
      ? fail({ error: 'boom' }, 500)
      : ok({ proposals: [] })
  ));
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('History'));
  expect(await screen.findByText(/No matching history yet/i)).toBeInTheDocument();
  expect(screen.queryByText('boom')).not.toBeInTheDocument();
});

test('T2: HistoryTab fetchHistory — network rejection is swallowed (console.error only), never a thrown alert', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  global.fetch = jest.fn(async () => { throw new TypeError('Failed to fetch'); });
  render(<ExpertiseFinderPage />);
  fireEvent.click(screen.getByText('History'));
  await waitFor(() => expect(console.error).toHaveBeenCalled());
  console.error.mockRestore();
});
