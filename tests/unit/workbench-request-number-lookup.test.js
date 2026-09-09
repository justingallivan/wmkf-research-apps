/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkbenchShell as WorkbenchDashboard } from '../../shared/components/workbench/WorkbenchShell';
import { TRIAGE_STATUS } from '../../shared/config/triageStatus';

// A stateful router: the shell mirrors its view/program/cycle/filters into the
// URL, so replace/push update the query the next render reads back.
const routerState = { pathname: '/workbench', asPath: '/workbench', query: {}, isReady: true };
const applyHref = (href) => {
  const url = new URL(href, 'http://localhost');
  routerState.asPath = href;
  routerState.query = Object.fromEntries(url.searchParams.entries());
  return Promise.resolve(true);
};
const push = jest.fn((href) => (typeof href === 'string' && href.startsWith('/workbench?') ? applyHref(href) : Promise.resolve(true)));
const replace = jest.fn(applyHref);

jest.mock('next/router', () => ({
  useRouter: () => ({ ...routerState, push, replace }),
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
  if (url === '/api/workbench/search-requests?mode=options'
    || String(url).startsWith('/api/workbench/search-requests?mode=options&')) {
    return response({
      body: {
        success: true,
        programId: 'program-1',
        programName: 'Research',
        programs: [{ programId: 'program-1', name: 'Research' }],
        cycles: [{ value: 'December 2026', label: 'December 2026' }],
        statuses: ['Active', 'Phase II Pending'],
      },
    });
  }
  throw new Error(`Unexpected fetch: ${url}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  routerState.asPath = '/workbench';
  routerState.query = {};
  window.sessionStorage.clear();
  global.fetch = jest.fn(async (url) => baseResponse(url));
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderReady() {
  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getAllByLabelText('Cycle').at(-1)).not.toBeDisabled());
}

test('shows the signed-in PD request count for the selected cycle and set-aside state', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/dashboard') {
      return response({ body: {
        success: true,
        cycles: [{
          code: 'D26',
          label: 'December 2026',
          count: 5,
          setAsideCount: 3,
          myCount: 2,
          mySetAsideCount: 1,
        }],
        defaultCycleCode: 'D26',
      } });
    }
    if (String(url).startsWith('/api/workbench/dashboard?cycleCode=')) {
      return response({ body: { proposals: [] } });
    }
    return baseResponse(url);
  });

  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (2)' })).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'My requests (2)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText('Show set aside'));
  expect(screen.getByRole('button', { name: 'My requests (3)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
});

test('updates the personal count when a personal request moves into and out of Set Aside', async () => {
  let setAside = false;
  const requestId = 'request-mine';
  const proposal = () => ({
    requestId,
    requestNumber: '1001',
    canManage: true,
    isMine: true,
    setAside,
    workRemaining: 'find',
    reviewers: {},
  });
  global.fetch.mockImplementation(async (url, options = {}) => {
    if (url === '/api/workbench/dashboard') {
      return response({ body: {
        success: true,
        cycles: [{ code: 'D26', label: 'December 2026', count: 1, setAsideCount: 0, myCount: 1, mySetAsideCount: 0 }],
        defaultCycleCode: 'D26',
      } });
    }
    if (String(url).startsWith('/api/workbench/dashboard?cycleCode=')) {
      return response({ body: { proposals: setAside && !String(url).includes('includeSetAside=1') ? [] : [proposal()] } });
    }
    if (url === '/api/workbench/triage') {
      setAside = JSON.parse(options.body).triageStatus === TRIAGE_STATUS.SET_ASIDE;
      return response({ body: { success: true } });
    }
    return baseResponse(url);
  });

  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTitle('Set triage status')).toBeInTheDocument());
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'setAside' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (0)' })).toBeInTheDocument());

  fireEvent.click(screen.getByLabelText('Show set aside'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTitle('Set triage status')).toBeInTheDocument());
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Show set aside'));
  expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument();
});

test('keeps the personal count transition when set-aside visibility changes during triage', async () => {
  const triage = deferred();
  let serverSetAside = false;
  let triageStarted = false;
  const proposal = () => ({
    requestId: 'request-mine',
    requestNumber: '1001',
    canManage: true,
    isMine: true,
    setAside: serverSetAside,
    workRemaining: 'find',
    reviewers: {},
  });
  global.fetch.mockImplementation((url, options = {}) => {
    if (url === '/api/workbench/dashboard') {
      return Promise.resolve(response({ body: {
        success: true,
        cycles: [{ code: 'D26', label: 'December 2026', count: 2, setAsideCount: 0, myCount: 2, mySetAsideCount: 0 }],
        defaultCycleCode: 'D26',
      } }));
    }
    if (String(url).startsWith('/api/workbench/dashboard?cycleCode=')) {
      return Promise.resolve(response({ body: {
        proposals: serverSetAside && !String(url).includes('includeSetAside=1') ? [] : [proposal()],
      } }));
    }
    if (url === '/api/workbench/triage') {
      serverSetAside = JSON.parse(options.body).triageStatus === TRIAGE_STATUS.SET_ASIDE;
      triageStarted = true;
      return triage.promise;
    }
    return baseResponse(url);
  });

  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (2)' })).toBeInTheDocument());
  await waitFor(() => expect(screen.getByTitle('Set triage status')).toBeInTheDocument());
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'setAside' } });
  await waitFor(() => expect(triageStarted).toBe(true));
  fireEvent.click(screen.getByLabelText('Show set aside'));

  await act(async () => {
    triage.resolve(response({ body: { success: true } }));
    await triage.promise;
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (2)' })).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Show set aside'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());
});

test('does not apply a delayed triage count patch after returning to the original program', async () => {
  const triage = deferred();
  let triageStarted = false;
  let serverSetAside = true;
  const proposal = () => ({
    requestId: 'request-mine',
    requestNumber: '1001',
    canManage: true,
    isMine: true,
    setAside: serverSetAside,
    workRemaining: 'find',
    reviewers: {},
  });
  const programs = [
    { programId: 'p1', name: 'Research' },
    { programId: 'p2', name: 'Southern California' },
  ];
  const cycleBody = (programId, active) => ({
    success: true,
    programs,
    programId,
    cycles: [{
      code: programId === 'p1' ? 'A' : 'B',
      label: programId === 'p1' ? 'Cycle A' : 'Cycle B',
      count: 1,
      setAsideCount: active ? 0 : 1,
      myCount: active ? 1 : 0,
      mySetAsideCount: active ? 0 : 1,
    }],
    defaultCycleCode: programId === 'p1' ? 'A' : 'B',
  });
  global.fetch.mockImplementation((url, options = {}) => {
    const href = String(url);
    if (url === '/api/workbench/dashboard') return Promise.resolve(response({ body: cycleBody('p1', false) }));
    if (href === '/api/workbench/dashboard?programId=p2') {
      return Promise.resolve(response({ body: cycleBody('p2', true) }));
    }
    if (href === '/api/workbench/dashboard?programId=p1') {
      serverSetAside = false;
      return Promise.resolve(response({ body: cycleBody('p1', true) }));
    }
    if (href.startsWith('/api/workbench/dashboard?cycleCode=')) {
      return Promise.resolve(response({ body: { proposals: href.includes('programId=p1') ? [proposal()] : [] } }));
    }
    if (url === '/api/workbench/triage') {
      triageStarted = true;
      expect(JSON.parse(options.body).triageStatus).toBe(TRIAGE_STATUS.ADVANCING);
      return triage.promise;
    }
    return baseResponse(url);
  });

  render(<WorkbenchDashboard />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (0)' })).toBeInTheDocument());
  fireEvent.click(screen.getByLabelText('Show set aside'));
  await waitFor(() => expect(screen.getByTitle('Set triage status')).toBeInTheDocument());
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await waitFor(() => expect(triageStarted).toBe(true));

  const mainProgram = () => screen.getAllByLabelText('Grant Program')[0];
  fireEvent.change(mainProgram(), { target: { value: 'p2' } });
  await waitFor(() => expect(mainProgram()).toHaveValue('p2'));
  fireEvent.change(mainProgram(), { target: { value: 'p1' } });
  await waitFor(() => expect(mainProgram()).toHaveValue('p1'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());

  await act(async () => {
    triage.resolve(response({ body: { success: true } }));
    await triage.promise;
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'My requests (1)' })).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'My requests (2)' })).not.toBeInTheDocument();
});

test('opens an exact historical Research request through the scoped search', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=1002379&programId=program-1') {
      return response({ body: { success: true, results: [{ requestId: REQUEST_ID, requestNumber: '1002379' }] } });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: '1002379' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/search-requests?q=1002379&programId=program-1',
  ));
  await waitFor(() => expect(push).toHaveBeenCalledWith(
    `/workbench/${REQUEST_ID}?n=1002379`,
  ));
  expect(screen.getByText(/without changing their status/i)).toBeInTheDocument();
});

test('keeps an unknown or excluded exact request on the dashboard', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=9999999&programId=program-1') {
      return response({
        body: { success: true, results: [], totalCount: 0 },
      });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: '9999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('No requests matched.')).toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
});

test('shows a minimal AkoyaGO handoff for an exact request outside Research', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=1009999&programId=program-1') {
      return response({
        body: {
          success: true,
          results: [],
          totalCount: 0,
          outsideProgramRequest: { requestNumber: '1009999', program: 'Community Grants' },
        },
      });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: '1009999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByRole('heading', {
    name: 'Request #1009999 is valid, but it is outside Research.',
  })).toBeInTheDocument();
  expect(screen.getByText('Program: Community Grants')).toBeInTheDocument();
  expect(screen.getByText('Search for request #1009999 in AkoyaGO for more details.')).toBeInTheDocument();
  expect(screen.getByText('0 Research results')).toBeInTheDocument();
  expect(screen.getByRole('status', { name: 'Request search status' })).toHaveTextContent(
    /outside Research\. Program: Community Grants\. Search for request #1009999 in AkoyaGO/,
  );
  expect(screen.queryByText(/Sensitive title|11111111-1111-1111-1111-111111111111/)).not.toBeInTheDocument();
  expect(push).not.toHaveBeenCalled();
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-program-v4')))
    .toMatchObject({ outsideProgramRequest: { requestNumber: '1009999', program: 'Community Grants' } });
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
    if (url === '/api/workbench/search-requests?q=University+of+Washington&cycle=December+2026&status=Active&programId=program-1') {
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
  fireEvent.change(screen.getAllByLabelText('Cycle').at(-1), { target: { value: 'December 2026' } });
  fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'Active' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText('Regenerative medicine study')).toBeInTheDocument();
  expect(screen.getByText('PI: Manuel Müller')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open request/ })).toHaveAttribute(
    'href',
    `/workbench/${REQUEST_ID}?n=1002959`,
  );
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-program-v4')))
    .toMatchObject({ criteria: { cycle: 'December 2026', status: 'Active' } });
  expect(screen.getByRole('status', { name: 'Request search status' }))
    .toHaveTextContent('Search complete. 1 result; 1 shown.');
});

test('shows the generalized limit warning when a bounded source is incomplete', async () => {
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=Smith&programId=program-1') {
      return response({ body: {
        success: true,
        results: [],
        totalCount: 0,
        hasMore: false,
        capped: true,
      } });
    }
    return baseResponse(url);
  });
  await renderReady();

  fireEvent.change(screen.getByLabelText(SEARCH_LABEL), { target: { value: 'Smith' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));

  expect(await screen.findByText(
    'Results are limited; narrow the search to see more precise matches',
  )).toBeInTheDocument();
  expect(screen.getByText('No requests matched.')).toBeInTheDocument();
});

test('loads the next bounded page and appends it to the restored search state', async () => {
  const firstPage = Array.from({ length: 25 }, (_, index) => ({
    requestId: `request-${index}`,
    requestNumber: `100${String(index).padStart(4, '0')}`,
    title: `Matching request ${index}`,
  }));
  global.fetch.mockImplementation(async (url) => {
    if (url === '/api/workbench/search-requests?q=university&programId=program-1') {
      return response({ body: {
        success: true,
        results: firstPage,
        totalCount: 26,
        hasMore: true,
        nextOffset: 25,
        capped: false,
      } });
    }
    if (url === '/api/workbench/search-requests?q=university&programId=program-1&offset=25') {
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
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-program-v4')).results)
    .toHaveLength(26);
});

test('keeps restored filters visible when live options are missing', async () => {
  window.sessionStorage.setItem('wmkf-workbench-request-locator-program-v4', JSON.stringify({
    criteria: { query: 'regeneration', cycle: 'June 2024', status: 'Archived', programId: 'program-1' },
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

  render(<WorkbenchDashboard />);

  await waitFor(() => expect(screen.getAllByLabelText('Cycle').at(-1)).toHaveValue('June 2024'));
  expect(screen.getByRole('option', { name: 'June 2024 (saved)' })).toBeInTheDocument();
  expect(screen.getByLabelText('Request status')).toHaveValue('Archived');
  expect(screen.getByRole('option', { name: 'Archived (saved)' })).toBeInTheDocument();
});

test('restores the last broad result set after returning to the dashboard', async () => {
  window.sessionStorage.setItem('wmkf-workbench-request-locator-program-v4', JSON.stringify({
    criteria: { query: 'regeneration', cycle: '', status: '', programId: 'program-1' },
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
    if (url === '/api/workbench/search-requests?q=1002000&programId=program-1') {
      return new Promise((resolve) => { resolveFirst = resolve; });
    }
    if (url === '/api/workbench/search-requests?q=1002379&programId=program-1') {
      return Promise.resolve(response({
        body: { success: true, results: [{ requestId: REQUEST_ID, requestNumber: '1002379' }] },
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
        results: [{ requestId: '22222222-2222-2222-2222-222222222222', requestNumber: '1002000' }],
      },
    }));
  });
  expect(push).toHaveBeenCalledTimes(1);
});

test('a slower superseded broad search cannot replace newer results or saved criteria', async () => {
  const first = deferred();
  global.fetch.mockImplementation((url) => {
    if (url === '/api/workbench/search-requests?q=older&programId=program-1') return first.promise;
    if (url === '/api/workbench/search-requests?q=newer&programId=program-1') {
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
  expect(JSON.parse(window.sessionStorage.getItem('wmkf-workbench-request-locator-program-v4')))
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
    if (url === '/api/workbench/search-requests?q=initial&programId=program-1') {
      return Promise.resolve(response({ body: {
        success: true,
        results: firstPage,
        totalCount: 26,
        hasMore: true,
        nextOffset: 25,
        capped: false,
      } }));
    }
    if (url === '/api/workbench/search-requests?q=initial&programId=program-1&offset=25') return nextPage.promise;
    if (url === '/api/workbench/search-requests?q=fresh&programId=program-1') {
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
    if (url === '/api/workbench/search-requests?q=delayed&programId=program-1') return pending.promise;
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
  expect(window.sessionStorage.getItem('wmkf-workbench-request-locator-program-v4')).toBeNull();
});
