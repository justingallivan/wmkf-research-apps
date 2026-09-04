/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkbenchDashboard } from '../../pages/workbench';

const push = jest.fn();

jest.mock('next/router', () => ({
  useRouter: () => ({ push, pathname: '/workbench' }),
}));

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../shared/components/RequireAppAccess', () => ({
  __esModule: true,
  default: ({ children }) => children,
}));

jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({
  __esModule: true,
  default: () => null,
}));

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const SEARCH_LABEL = 'Request number, institution, PI, or proposal title';

function response({ ok = true, status = 200, body = {} } = {}) {
  return { ok, status, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function baseResponse(url) {
  if (url === '/api/workbench/dashboard') {
    return response({ body: { success: true, cycles: [], defaultCycleCode: null } });
  }
  if (url === '/api/workbench/search-requests?mode=options') {
    return response({
      body: {
        success: true,
        cycles: [{ value: 'December 2026', label: 'December 2026' }],
        statuses: ['Active', 'Phase II Pending'],
      },
    });
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  global.fetch = jest.fn(async (url) => baseResponse(url));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderReady() {
  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getAllByLabelText('Cycle')[0]).not.toBeDisabled());
}

test('opens an exact historical request through the existing request-number resolver', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/resolve-request?requestNumber=1002379') {
      return response({ body: { success: true, requestId: REQUEST_ID, requestNumber: '1002379' } });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: '1002379' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/resolve-request?requestNumber=1002379',
  ));
  await waitFor(() => expect(push).toHaveBeenCalledWith(
    `/workbench/${REQUEST_ID}?n=1002379`,
  ));
  expect(screen.getByText(/without changing their status/i)).toBeInTheDocument();
});

test('keeps an unknown exact request on the dashboard with the server error', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/resolve-request?requestNumber=9999999') {
      return response({
        ok: false,
        status: 404,
        body: { error: 'No request found for number 9999999' },
      });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: '9999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No request found for number 9999999',
  );
  expect(push).not.toHaveBeenCalled();
});

test('requires a term or filter without issuing a search request', async () => {
  await renderReady();
  global.fetch.mockClear();

  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByRole('alert')).toHaveTextContent(/enter a request number/i);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});

test('renders broad results with live cycle/status filters and semantic open links', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=University+of+Washington&cycle=December+2026&status=Active') {
      return response({ body: {
        success: true,
        results: [{
          requestId: REQUEST_ID,
          requestNumber: '1002959',
          title: 'Regenerative medicine study',
          institution: 'University of Washington',
          projectLeader: 'Manuel Müller',
          cycleLabel: 'December 2026',
          requestStatus: 'Active',
          program: 'Medical Research',
        }],
        totalCount: 1,
        hasMore: false,
        capped: false,
      } });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), {
    target: { value: 'University of Washington' },
  });
  fireEvent.change(screen.getAllByLabelText('Cycle')[0], { target: { value: 'December 2026' } });
  fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'Active' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('Regenerative medicine study')).toBeInTheDocument();
  expect(screen.getByText('PI: Manuel Müller')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open request/ })).toHaveAttribute(
    'href',
    `/workbench/${REQUEST_ID}?n=1002959`,
  );
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-v1')))
    .toMatchObject({ criteria: { cycle: 'December 2026', status: 'Active' } });
  expect(screen.getByRole('status', { name: 'Request search status' }))
    .toHaveTextContent('Search complete. 1 result; 1 shown.');
});

test('loads the next bounded page and appends it to the restored search state', async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    requestId: `request-${index}`,
    requestNumber: `100${String(index).padStart(4, '0')}`,
    title: `Matching request ${index}`,
  }));
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=university') {
      return response({ body: {
        success: true,
        results: firstPage,
        totalCount: 26,
        hasMore: true,
        nextOffset: 25,
        capped: false,
      } });
    }
    if (url === '/api/workbench/search-requests?q=university&offset=25') {
      return response({ body: {
        success: true,
        results: [
          firstPage[24],
          { requestId: 'request-25', requestNumber: '1000025', title: 'Final match' },
        ],
        totalCount: 26,
        hasMore: false,
        nextOffset: null,
        capped: false,
      } });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'university' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Matching request 24')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load 25 more' }));

  expect(await screen.findByText('Final match')).toBeInTheDocument();
  expect(screen.getByText(/showing 26/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Load 25 more' })).not.toBeInTheDocument();
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-v1')).results)
    .toHaveLength(26);
});

test('keeps restored filters visible when live options are missing', async () => {
  window.sessionStorage.setItem('wmkf-workbench-request-locator-v1', JSON.stringify({
    criteria: { query: 'regeneration', cycle: 'June 2024', status: 'Archived' },
    results: [{ requestId: REQUEST_ID, requestNumber: '1002959', title: 'Restored request' }],
    totalCount: 1,
    capped: false,
    unavailableCount: 0,
    hasMore: false,
    nextOffset: null,
  }));
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?mode=options') {
      return response({ ok: false, status: 503, body: { error: 'Unavailable' } });
    }
    return baseResponse(url);
  });

  await renderReady();

  await waitFor(() => expect(screen.getAllByLabelText('Cycle')[0]).toHaveValue('June 2024'));
  expect(screen.getByRole('option', { name: 'June 2024 (saved)' })).toBeInTheDocument();
  expect(screen.getByLabelText('Request status')).toHaveValue('Archived');
  expect(screen.getByRole('option', { name: 'Archived (saved)' })).toBeInTheDocument();
});

test('restores the last broad result set after returning to the dashboard', async () => {
  window.sessionStorage.setItem('wmkf-workbench-request-locator-v1', JSON.stringify({
    criteria: { query: 'regeneration', cycle: '', status: '' },
    results: [{ requestId: REQUEST_ID, requestNumber: '1002959', title: 'Restored request' }],
    totalCount: 1,
    capped: false,
    unavailableCount: 0,
    hasMore: false,
  }));

  await renderReady();

  expect(await screen.findByDisplayValue('regeneration')).toBeInTheDocument();
  expect(screen.getByText('Restored request')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalledWith(expect.stringContaining('q=regeneration'));
});

test('a slower superseded exact lookup cannot navigate after a newer request opens', async () => {
  let resolveFirst;
  global.fetch.mockImplementation((url) => {
    if (url === '/api/workbench/resolve-request?requestNumber=1002000') {
      return new Promise((resolve) => { resolveFirst = resolve; });
    }
    if (url === '/api/workbench/resolve-request?requestNumber=1002379') {
      return Promise.resolve(response({
        body: { success: true, requestId: REQUEST_ID, requestNumber: '1002379' },
      }));
    }
    return Promise.resolve(baseResponse(url));
  });
  await renderReady();

  const input = screen.getByLabelText(SEARCH_LABEL);
  fireEvent.change(input, { target: { value: '1002000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.change(input, { target: { value: '1002379' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  expect(push).toHaveBeenLastCalledWith(`/workbench/${REQUEST_ID}?n=1002379`);

  await act(async () => {
    resolveFirst(response({
      body: {
        success: true,
        requestId: '22222222-2222-2222-2222-222222222222',
        requestNumber: '1002000',
      },
    }));
  });
  expect(push).toHaveBeenCalledTimes(1);
});

test('a slower superseded broad search cannot replace newer results or saved criteria', async () => {
  const first = deferred();
  global.fetch.mockImplementation((url) => {
    if (url === '/api/workbench/search-requests?q=older') return first.promise;
    if (url === '/api/workbench/search-requests?q=newer') {
      return Promise.resolve(response({ body: {
        success: true,
        results: [{ requestId: REQUEST_ID, requestNumber: '1002959', title: 'Newer result' }],
        totalCount: 1,
        hasMore: false,
        capped: false,
      } }));
    }
    return Promise.resolve(baseResponse(url));
  });
  await renderReady();

  const input = screen.getByLabelText(SEARCH_LABEL);
  fireEvent.change(input, { target: { value: 'older' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.change(input, { target: { value: 'newer' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('Newer result')).toBeInTheDocument();
  await act(async () => {
    first.resolve(response({ body: {
      success: true,
      results: [{
        requestId: '22222222-2222-2222-2222-222222222222',
        requestNumber: '1002000',
        title: 'Older result',
      }],
      totalCount: 1,
      hasMore: false,
      capped: false,
    } }));
  });

  expect(screen.queryByText('Older result')).not.toBeInTheDocument();
  expect(screen.getByText('Newer result')).toBeInTheDocument();
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-v1')))
    .toMatchObject({ criteria: { query: 'newer' } });
});

test('a superseded load-more response cannot append into a fresh search', async () => {
  const nextPage = deferred();
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    requestId: `request-${index}`,
    requestNumber: `100${String(index).padStart(4, '0')}`,
    title: `Initial result ${index}`,
  }));
  global.fetch.mockImplementation((url) => {
    if (url === '/api/workbench/search-requests?q=initial') {
      return Promise.resolve(response({ body: {
        success: true,
        results: firstPage,
        totalCount: 26,
        hasMore: true,
        nextOffset: 25,
        capped: false,
      } }));
    }
    if (url === '/api/workbench/search-requests?q=initial&offset=25') return nextPage.promise;
    if (url === '/api/workbench/search-requests?q=fresh') {
      return Promise.resolve(response({ body: {
        success: true,
        results: [{ requestId: REQUEST_ID, requestNumber: '1002959', title: 'Fresh result' }],
        totalCount: 1,
        hasMore: false,
        capped: false,
      } }));
    }
    return Promise.resolve(baseResponse(url));
  });
  await renderReady();

  const input = screen.getByLabelText(SEARCH_LABEL);
  fireEvent.change(input, { target: { value: 'initial' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Initial result 24')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load 25 more' }));
  fireEvent.change(input, { target: { value: 'fresh' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText('Fresh result')).toBeInTheDocument();

  await act(async () => {
    nextPage.resolve(response({ body: {
      success: true,
      results: [{
        requestId: '33333333-3333-3333-3333-333333333333',
        requestNumber: '1003000',
        title: 'Late next-page result',
      }],
      totalCount: 26,
      hasMore: false,
      capped: false,
    } }));
  });

  expect(screen.queryByText('Late next-page result')).not.toBeInTheDocument();
  expect(screen.getByText('Fresh result')).toBeInTheDocument();
});

test('clearing during a broad search prevents the late response from restoring results', async () => {
  const pending = deferred();
  global.fetch.mockImplementation((url) => {
    if (url === '/api/workbench/search-requests?q=delayed') return pending.promise;
    return Promise.resolve(baseResponse(url));
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'delayed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

  await act(async () => {
    pending.resolve(response({ body: {
      success: true,
      results: [{ requestId: REQUEST_ID, requestNumber: '1002959', title: 'Late result' }],
      totalCount: 1,
      hasMore: false,
      capped: false,
    } }));
  });

  expect(screen.queryByText('Late result')).not.toBeInTheDocument();
  expect(screen.queryByText(/result(?:s)? · showing/i)).not.toBeInTheDocument();
  expect(window.sessionStorage.getItem('wmkf-workbench-request-locator-v1')).toBeNull();
});
