import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RequestLocator } from '../../shared/components/workbench/RequestLocator';
import ToolbarSelect from '../../shared/components/ToolbarSelect';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const STORAGE_KEY = 'wmkf-workbench-request-locator-program-v4';
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const options = {
  programs: [{ programId: PROGRAM_ID, name: 'Research' }],
  programId: PROGRAM_ID,
  defaultProgramId: PROGRAM_ID,
  programName: 'Research',
  cycles: [{ value: 'J26', label: 'June 2026' }],
  statuses: ['Active'],
};
const emptyResults = { results: [], totalCount: 0 };
const queryInput = () => screen.getByRole('searchbox');
const searchOptionsToggle = () => screen.getByRole('button', { name: 'Search options' });
const openSearchOptions = () => {
  if (searchOptionsToggle().getAttribute('aria-expanded') === 'false') fireEvent.click(searchOptionsToggle());
};
const cycleSelect = () => screen.getByRole('combobox', { name: 'Grant cycle' });
const statusSelect = () => screen.getByRole('combobox', { name: 'Request status' });
const programSelect = () => screen.getByRole('combobox', { name: 'Grant program' });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function saveCriteria() {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    criteria: { query: 'University', cycle: 'D26', status: 'Phase II Pending', programId: PROGRAM_ID },
    results: [],
    totalCount: 0,
  }));
}

beforeEach(() => {
  window.sessionStorage.clear();
  global.fetch.mockReset();
});

test('both select sizes keep native labels, option values, events and disabled semantics', () => {
  const onChange = jest.fn((event) => event.target.value);
  const { rerender } = render(
    <ToolbarSelect id="test-cycle" label="Cycle" value="" onChange={onChange}>
      <option value="">All cycles</option>
      <option value="J26">June 2026</option>
    </ToolbarSelect>,
  );
  expect(screen.getByRole('combobox', { name: 'Cycle' })).toHaveClass('h-12', 'rounded-xl', 'appearance-none');
  fireEvent.change(screen.getByRole('combobox', { name: 'Cycle' }), { target: { value: 'J26' } });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.results[0].value).toBe('J26');

  rerender(
    <>
      <p id="filter-help">Loading filters</p>
      <ToolbarSelect id="test-cycle" label="Cycle" size="compact" value="J26" disabled
        aria-describedby="filter-help" onChange={onChange}>
        <option value="J26">June 2026</option>
      </ToolbarSelect>
    </>,
  );
  const select = screen.getByRole('combobox', { name: 'Cycle' });
  expect(select).toHaveClass('h-11', 'rounded-lg', 'appearance-none');
  expect(select).not.toHaveClass('h-12');
  expect(select).toHaveValue('J26');
  expect(select).toBeDisabled();
  expect(select).toHaveAccessibleDescription('Loading filters');
});

test('Search options is closed by default and reveals the filter selects when opened', async () => {
  const pending = deferred();
  fetch.mockReturnValue(pending.promise);
  render(<RequestLocator />);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox', { name: 'Grant cycle' })).not.toBeInTheDocument();
  expect(searchOptionsToggle()).toHaveAttribute('aria-expanded', 'false');

  fireEvent.click(searchOptionsToggle());
  expect(searchOptionsToggle()).toHaveAttribute('aria-expanded', 'true');
  expect(cycleSelect()).toBeDisabled();
  expect(statusSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveAccessibleDescription('Loading cycle and status filters…');
  expect(queryInput()).toBeEnabled();

  await act(async () => pending.resolve(response({ ...options, cycles: [], statuses: [] })));
  expect(cycleSelect()).toBeEnabled();
  expect(statusSelect()).toBeEnabled();
  expect(cycleSelect()).toHaveValue('');
  expect(cycleSelect()).not.toHaveAttribute('aria-describedby');
  expect(screen.queryByRole('button', { name: 'Retry filters' })).not.toBeInTheDocument();
});

test('failed options retain saved filters in searches, and Clear filters preserves the query', async () => {
  saveCriteria();
  fetch.mockResolvedValueOnce(response({ error: 'Unavailable' }, false))
    .mockResolvedValue(response(emptyResults));
  render(<RequestLocator />);
  // A restored cycle/status criterion opens Search options automatically.
  await waitFor(() => expect(cycleSelect()).toHaveValue('D26'));
  await screen.findByRole('button', { name: 'Retry filters' });
  expect(cycleSelect()).toBeDisabled();
  expect(statusSelect()).toBeDisabled();
  expect(screen.getByRole('option', { name: 'D26 (saved)' })).toBeInTheDocument();
  expect(statusSelect()).toHaveValue('Phase II Pending');
  expect(cycleSelect()).toHaveAccessibleDescription(/Selected filters still apply/);

  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
    `/api/workbench/search-requests?q=University&cycle=D26&status=Phase+II+Pending&programId=${PROGRAM_ID}`,
  ));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search requests', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters', exact: true }));
  expect(queryInput()).toHaveValue('University');
  expect(cycleSelect()).toHaveValue('');
  expect(statusSelect()).toHaveValue('');
  expect(cycleSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveAccessibleDescription(/You can still search/);

  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(`/api/workbench/search-requests?q=University&programId=${PROGRAM_ID}`));
});

test('retry disables the controls, makes one request and preserves saved values absent from new options', async () => {
  saveCriteria();
  const retry = deferred();
  fetch.mockRejectedValueOnce(new Error('Offline')).mockReturnValueOnce(retry.promise);
  render(<RequestLocator />);
  await waitFor(() => expect(cycleSelect()).toHaveValue('D26'));
  const button = await screen.findByRole('button', { name: 'Retry filters' });
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Retrying filters…' })).toBeDisabled();
  fireEvent.click(button);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(cycleSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveValue('D26');
  expect(queryInput()).toHaveValue('University');
  expect(screen.getByText('No requests matched.')).toBeInTheDocument();

  await act(async () => retry.resolve(response(options)));
  expect(cycleSelect()).toBeEnabled();
  expect(statusSelect()).toBeEnabled();
  expect(cycleSelect()).toHaveValue('D26');
  expect(statusSelect()).toHaveValue('Phase II Pending');
  expect(screen.getByRole('option', { name: 'June 2026' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'D26 (saved)' })).toBeInTheDocument();
  expect(screen.queryByText(/could not load/)).not.toBeInTheDocument();
});

test('a failed retry stays disabled and can be retried again', async () => {
  fetch.mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(response({ error: 'Still unavailable' }, false))
    .mockResolvedValueOnce(response(options));
  render(<RequestLocator />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry filters' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry filters' }));
  openSearchOptions();
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([true, false])('changing a compact filter suppresses a stale search response (ok=%s)', async (ok) => {
  const search = deferred();
  fetch.mockResolvedValueOnce(response(options)).mockReturnValueOnce(search.promise);
  render(<RequestLocator />);
  openSearchOptions();
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  fireEvent.change(queryInput(), { target: { value: 'University' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  fireEvent.change(cycleSelect(), { target: { value: 'J26' } });
  expect(screen.getByRole('button', { name: 'Search requests', exact: true })).toBeEnabled();

  await act(async () => search.resolve(response({
    results: [{ requestId: 'stale-fixture', title: 'Stale proposal' }],
    totalCount: 1,
    error: 'Stale request error',
  }, ok)));
  expect(screen.queryByText('Stale proposal')).not.toBeInTheDocument();
  expect(screen.queryByText('Stale request error')).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(cycleSelect()).toHaveValue('J26');
});


test('does not restore broad-program results or off-cycle selections from the previous cache', async () => {
  window.sessionStorage.setItem('wmkf-workbench-request-locator-v1', JSON.stringify({
    criteria: { query: 'University', cycle: 'March 2025 (off-cycle)', status: 'Active' },
    results: [{ requestId: 'directors', title: "Directors' Directed Grant Program" }],
    totalCount: 1,
  }));
  fetch.mockResolvedValue(response(options));
  render(<RequestLocator />);
  openSearchOptions();
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  expect(cycleSelect()).toHaveValue('');
  expect(queryInput()).toHaveValue('');
  expect(screen.queryByText(/Directors' Directed/)).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /off-cycle/ })).not.toBeInTheDocument();
});

test('switching Grant program clears dependent state and requests fresh scoped options', async () => {
  const socalId = '22222222-2222-4222-8222-222222222222';
  const socalOptions = {
    programs: [
      { programId: PROGRAM_ID, name: 'Research' },
      { programId: socalId, name: 'Southern California' },
    ],
    programId: socalId,
    defaultProgramId: PROGRAM_ID,
    programName: 'Southern California',
    cycles: [{ value: 'D26', label: 'December 2026' }],
    statuses: ['Closed'],
  };
  const nextOptions = deferred();
  fetch.mockResolvedValueOnce(response({
    ...options,
    programs: [
      { programId: PROGRAM_ID, name: 'Research' },
      { programId: socalId, name: 'Southern California' },
    ],
  })).mockReturnValueOnce(nextOptions.promise);
  render(<RequestLocator />);
  openSearchOptions();
  await waitFor(() => expect(programSelect()).toBeEnabled());
  fireEvent.change(programSelect(), { target: { value: socalId } });
  expect(cycleSelect()).toHaveValue('');
  expect(screen.queryByText(/No requests matched/)).not.toBeInTheDocument();
  expect(fetch).toHaveBeenLastCalledWith(`/api/workbench/search-requests?mode=options&programId=${socalId}`);
  await act(async () => nextOptions.resolve(response(socalOptions)));
  await waitFor(() => expect(cycleSelect()).toHaveValue(''));
  expect(screen.getByRole('option', { name: 'December 2026' })).toBeInTheDocument();
  expect(statusSelect()).toHaveValue('');
});

test('cached Research results cannot revive after switching to Southern California', async () => {
  const socalId = '22222222-2222-4222-8222-222222222222';
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    criteria: { query: 'cached', cycle: '', status: '', programId: PROGRAM_ID },
    results: [{ requestId: 'research-row', title: 'Research-only cached row' }],
    totalCount: 1,
  }));
  const pending = deferred();
  fetch.mockResolvedValueOnce(response({
    ...options,
    programs: [
      { programId: PROGRAM_ID, name: 'Research' },
      { programId: socalId, name: 'Southern California' },
    ],
  })).mockReturnValueOnce(pending.promise);
  render(<RequestLocator />);
  await waitFor(() => expect(screen.getByText('Research-only cached row')).toBeInTheDocument());
  openSearchOptions();
  await waitFor(() => expect(programSelect()).toBeEnabled());
  fireEvent.change(programSelect(), { target: { value: socalId } });
  expect(screen.queryByText('Research-only cached row')).not.toBeInTheDocument();
  await act(async () => pending.resolve(response({
    ...options,
    programs: [
      { programId: PROGRAM_ID, name: 'Research' },
      { programId: socalId, name: 'Southern California' },
    ],
    programId: socalId,
    programName: 'Southern California',
  })));
  await waitFor(() => expect(programSelect()).toHaveValue(socalId));
});

test('the shell programId seeds the locator program on first mount', async () => {
  fetch.mockResolvedValue(response(options));
  render(<RequestLocator programId={PROGRAM_ID} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/workbench/search-requests?mode=options&programId=${PROGRAM_ID}`));
});

test('a saved search for a different program is not restored when the shell passes another programId', async () => {
  const socalId = '22222222-2222-4222-8222-222222222222';
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    criteria: { query: 'cached', cycle: 'D26', status: 'Active', programId: socalId },
    results: [{ requestId: 'socal-row', title: 'Southern California cached row' }],
    totalCount: 1,
  }));
  fetch.mockResolvedValue(response(options));
  render(<RequestLocator programId={PROGRAM_ID} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/workbench/search-requests?mode=options&programId=${PROGRAM_ID}`));
  expect(queryInput()).toHaveValue('');
  expect(screen.queryByText('Southern California cached row')).not.toBeInTheDocument();
  expect(searchOptionsToggle()).toHaveAttribute('aria-expanded', 'false');
});

test('Search options is closed by default and opens automatically when restoring a saved cycle or status', async () => {
  saveCriteria();
  fetch.mockResolvedValue(response(options));
  render(<RequestLocator />);
  await waitFor(() => expect(searchOptionsToggle()).toHaveAttribute('aria-expanded', 'true'));
  expect(cycleSelect()).toHaveValue('D26');
});

test('Search options stays closed by default without a restored cycle or status', async () => {
  fetch.mockResolvedValue(response(options));
  render(<RequestLocator />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(searchOptionsToggle()).toHaveAttribute('aria-expanded', 'false');
});

test('the results block is labeled "Request search results"', async () => {
  fetch.mockResolvedValueOnce(response(options)).mockResolvedValueOnce(response({
    success: true,
    results: [{ requestId: 'r1', requestNumber: '1002959', title: 'A proposal' }],
    totalCount: 1,
  }));
  render(<RequestLocator />);
  await waitFor(() => expect(queryInput()).toBeEnabled());
  fireEvent.change(queryInput(), { target: { value: '1002000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search requests', exact: true }));
  await screen.findByText('A proposal');
  expect(screen.getByRole('heading', { name: 'Request search results' })).toBeInTheDocument();
});
