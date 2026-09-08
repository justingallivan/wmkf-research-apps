import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RequestLocator from '../../shared/components/workbench/RequestLocator';
import ToolbarSelect from '../../shared/components/ToolbarSelect';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));

const STORAGE_KEY = 'wmkf-workbench-request-locator-research-v3';
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
const options = { cycles: [{ value: 'J26', label: 'June 2026' }], statuses: ['Active'] };
const emptyResults = { results: [], totalCount: 0 };
const queryInput = () => screen.getByRole('searchbox');
const cycleSelect = () => screen.getByRole('combobox', { name: 'Cycle' });
const statusSelect = () => screen.getByRole('combobox', { name: 'Request status' });

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function saveCriteria() {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    criteria: { query: 'University', cycle: 'D26', status: 'Phase II Pending' },
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
  expect(cycleSelect()).toHaveClass('h-12', 'rounded-xl', 'appearance-none');
  fireEvent.change(cycleSelect(), { target: { value: 'J26' } });
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
  expect(cycleSelect()).toHaveClass('h-11', 'rounded-lg', 'appearance-none');
  expect(cycleSelect()).not.toHaveClass('h-12');
  expect(cycleSelect()).toHaveValue('J26');
  expect(cycleSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveAccessibleDescription('Loading filters');
});

test('loading filters are disabled and described; an empty successful response remains usable', async () => {
  const pending = deferred();
  fetch.mockReturnValue(pending.promise);
  render(<RequestLocator />);
  expect(cycleSelect()).toBeDisabled();
  expect(statusSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveAccessibleDescription('Loading cycle and status filters…');
  expect(queryInput()).toBeEnabled();

  await act(async () => pending.resolve(response({ cycles: [], statuses: [] })));
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
  await waitFor(() => expect(cycleSelect()).toHaveValue('D26'));
  await screen.findByRole('button', { name: 'Retry filters' });
  expect(cycleSelect()).toBeDisabled();
  expect(statusSelect()).toBeDisabled();
  expect(screen.getByRole('option', { name: 'D26 (saved)' })).toBeInTheDocument();
  expect(statusSelect()).toHaveValue('Phase II Pending');
  expect(cycleSelect()).toHaveAccessibleDescription(/Selected filters still apply/);

  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
    '/api/workbench/search-requests?q=University&cycle=D26&status=Phase+II+Pending',
  ));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Search', exact: true })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters', exact: true }));
  expect(queryInput()).toHaveValue('University');
  expect(cycleSelect()).toHaveValue('');
  expect(statusSelect()).toHaveValue('');
  expect(cycleSelect()).toBeDisabled();
  expect(cycleSelect()).toHaveAccessibleDescription(/You can still search/);

  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith('/api/workbench/search-requests?q=University'));
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
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([true, false])('changing a compact filter suppresses a stale search response (ok=%s)', async (ok) => {
  const search = deferred();
  fetch.mockResolvedValueOnce(response(options)).mockReturnValueOnce(search.promise);
  render(<RequestLocator />);
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  fireEvent.change(queryInput(), { target: { value: 'University' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search', exact: true }));
  fireEvent.change(cycleSelect(), { target: { value: 'J26' } });
  expect(screen.getByRole('button', { name: 'Search', exact: true })).toBeEnabled();

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
  await waitFor(() => expect(cycleSelect()).toBeEnabled());
  expect(cycleSelect()).toHaveValue('');
  expect(queryInput()).toHaveValue('');
  expect(screen.queryByText(/Directors' Directed/)).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /off-cycle/ })).not.toBeInTheDocument();
});
