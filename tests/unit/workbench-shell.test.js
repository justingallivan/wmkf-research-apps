/**
 * @jest-environment jsdom
 *
 * Request Workbench shell — the URL owns the view, program, cycle, and Request
 * list filters, so back navigation and shared links land where the PD was.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkbenchShell } from '../../shared/components/workbench/WorkbenchShell';

const routerState = { pathname: '/workbench', asPath: '/workbench', query: {}, isReady: true };
const applyHref = (href) => {
  const url = new URL(href, 'http://localhost');
  routerState.asPath = href;
  routerState.query = Object.fromEntries(url.searchParams.entries());
  return Promise.resolve(true);
};
const push = jest.fn(applyHref);
const replace = jest.fn(applyHref);
jest.mock('next/router', () => ({ useRouter: () => ({ ...routerState, push, replace }) }));

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  PageHeader: ({ title }) => <h1>{title}</h1>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/workbench/RequestLocator', () => ({
  __esModule: true,
  RequestLocator: (props) => <div data-testid="request-locator-mock" data-program-id={props.programId || ''} />,
}));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/reviewers/EmailTemplatesModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/workbench/ArtifactFileMetadata', () => ({ __esModule: true, default: () => null }));

const response = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
const CYCLES = [
  { code: 'D26', label: 'December 2026', count: 4, myCount: 2, mySetAsideCount: 0 },
  { code: 'J26', label: 'June 2026', count: 9, myCount: 1, mySetAsideCount: 0 },
];
const programs = [{ programId: 'p1', name: 'Research' }, { programId: 'p2', name: 'Southern California' }];

function mockFetch(overrides = {}) {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    if (overrides[href]) return overrides[href]();
    if (href === '/api/workbench/dashboard' || href === '/api/workbench/dashboard?programId=p1') {
      return response({ success: true, programs, programId: 'p1', cycles: CYCLES, defaultCycleCode: 'D26', lastDecidedCycleCode: 'J26' });
    }
    if (href === '/api/workbench/dashboard?programId=p2') {
      return response({ success: true, programs, programId: 'p2', cycles: [{ code: 'J27', label: 'June 2027', count: 1 }], defaultCycleCode: 'J27' });
    }
    if (href.startsWith('/api/workbench/dashboard?cycleCode=')) {
      return response({ success: true, proposals: [], rollup: { total: 0, stages: {} } });
    }
    if (href.startsWith('/api/review-manager/reviewers?')) return response({ success: true, proposals: [] });
    if (href === '/api/workbench/grantee-deliverables/awardees') {
      return response({ cycles: [{ code: 'D26', label: 'December 2026', count: 0 }, { code: 'J26', label: 'June 2026', count: 14 }], defaultCycleCode: 'D26', lastDecidedCycleCode: 'J26', uncycledCount: 0 });
    }
    if (href.startsWith('/api/workbench/grantee-deliverables/awardees?')) {
      const code = new URL(href, 'http://x').searchParams.get('cycleCode');
      return code === 'J26'
        ? response({ cycleCode: 'J26', cycleLabel: 'June 2026', count: 1, awardees: [{ requestId: 'a1', requestNumber: '1', title: 'June awardee', pi: { name: 'PI' }, liaison: { name: 'L' }, statusLabel: null }], scope: 'mine', pdResolved: true })
        : response({ cycleCode: code, cycleLabel: 'December 2026', count: 0, awardees: [], scope: 'mine', pdResolved: true });
    }
    if (href.startsWith('/api/workbench/initial-assessment?')) {
      return response({ success: true, artifacts: [{ artifactId: 'x1', requestId: 'r1', requestNumber: '1003001', title: 'Assessed proposal', institution: 'U', programDirector: 'PD', operationLabel: 'Generated', lifecycleLabel: 'Current', file: null }] });
    }
    if (href.startsWith('/api/workbench/final-writeups?')) {
      const code = new URL(href, 'http://x').searchParams.get('cycleCode');
      const empty = code === 'D26';
      return response({
        success: true,
        viewer: { id: 'v', name: 'V', personas: [], personaLensesEnabled: false, isSuperuser: false },
        cycles: { selected: code, available: [{ code: 'D26', label: 'December 2026' }, { code: 'J26', label: 'June 2026' }], hasUncycled: true, defaultResolvedBy: 'explicit' },
        limits: { maximumRows: 100, scope: 'cycle' },
        counts: empty ? { total: 0, open: 0, history: 0, stewardship: 0 } : { total: 1, open: 1, history: 0, stewardship: 0 },
        queues: { open: empty ? [] : [{ requestId: 'r1', requestNumber: '1', title: 'June writeup', bucket: 'open', personalState: 'unreviewed', stage: { key: 'group-review', label: 'Group review' }, cycleLabel: 'June 2026', responsibleProgramDirector: { id: '33333333-3333-4333-8333-333333333331', name: 'PD A' }, document: { url: 'https://example.sharepoint.com/final.docx', publicationVersionId: '1.0', lastModified: '2026-08-31T12:00:00.000Z' }, reviewers: [], primaryAction: { key: 'review', label: 'Open review' }, supportingMaterials: [] }], history: [], stewardship: [] },
        coordinatorMatrix: null,
        selected: null,
        navigation: null,
      });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  routerState.asPath = '/workbench';
  routerState.query = {};
  mockFetch();
});

const rowFetches = () => global.fetch.mock.calls.map(([url]) => String(url)).filter((u) => u.includes('cycleCode='));

test('plain visit resolves the working cycle and writes it into the URL with replace', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  expect(replace).toHaveBeenCalledWith('/workbench?cycleCode=D26', undefined, { shallow: true, scroll: false });
  expect(push).not.toHaveBeenCalled();
  await waitFor(() => expect(rowFetches()).toEqual(['/api/workbench/dashboard?cycleCode=D26&scope=my&programId=p1']));
});

test('a deep-linked cycle the program lists is honored without rewriting the URL', async () => {
  routerState.query = { cycleCode: 'J26', scope: 'all', setAside: '1' };
  routerState.asPath = '/workbench?cycleCode=J26&scope=all&setAside=1';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J26'));
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Include set-aside requests')).toBeChecked();
  await waitFor(() => expect(rowFetches()).toEqual(['/api/workbench/dashboard?cycleCode=J26&scope=all&programId=p1&includeSetAside=1']));
});

test('an unlisted deep-linked cycle is honored and rendered as an extra option (a Final writeups or Awardees cycle need not have pending requests)', async () => {
  routerState.query = { cycleCode: 'J25' };
  routerState.asPath = '/workbench?cycleCode=J25';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J25'));
  expect(screen.getByRole('option', { name: 'June 2025' })).toBeInTheDocument();
  expect(replace).not.toHaveBeenCalled();
  await waitFor(() => expect(rowFetches()).toEqual(['/api/workbench/dashboard?cycleCode=J25&scope=my&programId=p1']));
});

test('cycle and program changes push history entries; filter changes replace', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));

  fireEvent.change(screen.getByLabelText('Grant cycle'), { target: { value: 'J26' } });
  expect(push).toHaveBeenLastCalledWith('/workbench?cycleCode=J26', undefined, expect.any(Object));

  fireEvent.click(screen.getByRole('button', { name: 'All in program' }));
  expect(replace).toHaveBeenLastCalledWith('/workbench?cycleCode=J26&scope=all', undefined, expect.any(Object));
  fireEvent.click(screen.getByLabelText('Include set-aside requests'));
  expect(replace).toHaveBeenLastCalledWith('/workbench?cycleCode=J26&scope=all&setAside=1', undefined, expect.any(Object));

  fireEvent.change(screen.getByLabelText('Grant program'), { target: { value: 'p2' } });
  // The program change drops the cycle; the new program's working cycle is written back.
  expect(push).toHaveBeenLastCalledWith('/workbench?programId=p2&scope=all&setAside=1', undefined, expect.any(Object));
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J27'));
  expect(replace).toHaveBeenLastCalledWith('/workbench?programId=p2&cycleCode=J27&scope=all&setAside=1', undefined, expect.any(Object));
  await waitFor(() => expect(rowFetches().at(-1)).toBe('/api/workbench/dashboard?cycleCode=J27&scope=all&programId=p2&includeSetAside=1'));
});

test('an external navigation (back button) is adopted from the URL', async () => {
  const { rerender } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  routerState.query = { cycleCode: 'J26', scope: 'all' };
  routerState.asPath = '/workbench?cycleCode=J26&scope=all';
  rerender(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J26'));
  expect(screen.getByRole('button', { name: 'All in program' })).toHaveClass('bg-gray-900');
  await waitFor(() => expect(rowFetches().at(-1)).toBe('/api/workbench/dashboard?cycleCode=J26&scope=all&programId=p1'));
});

test('a cycle-list failure shows an alert with Try again and never loads rows', async () => {
  let attempts = 0;
  mockFetch({
    '/api/workbench/dashboard': () => {
      attempts += 1;
      return attempts === 1
        ? response({ error: 'Dataverse unavailable' }, false)
        : response({ success: true, programs, programId: 'p1', cycles: CYCLES, defaultCycleCode: 'D26' });
    },
  });
  render(<WorkbenchShell />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Dataverse unavailable');
  expect(rowFetches()).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
});

test('a cycle-list failure on the Final writeups view shows only the shell alert, never a stuck loading surface', async () => {
  mockFetch({ '/api/workbench/dashboard': () => response({ error: 'Dataverse unavailable' }, false) });
  routerState.query = { view: 'final-writeups' };
  routerState.asPath = '/workbench?view=final-writeups';
  render(<WorkbenchShell />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Dataverse unavailable');
  expect(screen.queryByText(/Loading Final Writeups/)).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('final-writeups'))).toBe(false);
});

test('the Awardees view shows the working cycle, links the last decided cycle when empty, and shares scope with the shell', async () => {
  routerState.query = { view: 'awardees' };
  routerState.asPath = '/workbench?view=awardees';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('aria-current', 'page');
  expect(await screen.findByText('No awardees for December 2026 yet.')).toBeInTheDocument();
  expect(rowFetches().some((u) => u.startsWith('/api/workbench/dashboard?'))).toBe(false);

  fireEvent.click(await screen.findByRole('button', { name: '14 awardees in June 2026' }));
  expect(push).toHaveBeenLastCalledWith('/workbench?view=awardees&cycleCode=J26', undefined, expect.any(Object));
  expect(await screen.findByText('June awardee')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'All program directors' }));
  expect(replace).toHaveBeenLastCalledWith('/workbench?view=awardees&cycleCode=J26&scope=all', undefined, expect.any(Object));
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith('/api/workbench/grantee-deliverables/awardees?cycleCode=J26&scope=all', expect.any(Object)));
});

test('the Initial assessments view renders the D26 card without calling the API, and loads artifacts for a later cycle', async () => {
  routerState.query = { view: 'initial-assessments', cycleCode: 'D26' };
  routerState.asPath = '/workbench?view=initial-assessments&cycleCode=D26';
  const { unmount } = render(<WorkbenchShell />);
  expect(await screen.findByText(/not part of the D26 dual-phase workflow/)).toBeInTheDocument();
  // The tab is hidden for D26, but the deep link still renders the explanation.
  expect(screen.queryByRole('link', { name: 'Initial assessments' })).not.toBeInTheDocument();
  expect(global.fetch.mock.calls.some(([u]) => String(u).includes('initial-assessment'))).toBe(false);
  unmount();

  routerState.query = { view: 'initial-assessments', cycleCode: 'J27' };
  routerState.asPath = '/workbench?view=initial-assessments&cycleCode=J27';
  render(<WorkbenchShell />);
  expect(await screen.findByText(/#1003001 — Assessed proposal/)).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/initial-assessment?cycleCode=J27');
  expect(screen.getByRole('link', { name: 'Initial assessments' })).toHaveAttribute('aria-current', 'page');
});

test('the legacy artifacts route redirects into the shell', async () => {
  const { getServerSideProps } = require('../../pages/workbench/artifacts');
  await expect(getServerSideProps({ query: { cycleCode: 'J27' } })).resolves.toEqual({
    redirect: { destination: '/workbench?view=initial-assessments&cycleCode=J27', permanent: false },
  });
});

test('the Reviewer follow-up view carries its reviewer-state view and search in the URL, sharing request scope', async () => {
  jest.useFakeTimers();
  try {
    routerState.query = { view: 'reviewer-follow-up', cycleCode: 'J26', scope: 'all' };
    routerState.asPath = '/workbench?view=reviewer-follow-up&cycleCode=J26&scope=all';
    render(<WorkbenchShell />);
    await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J26'));
    expect(screen.getByRole('link', { name: 'Reviewer follow-up' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'All in program' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/reviewers?cycleCode=J26&scope=all&programId=p1'));

    fireEvent.click(screen.getByRole('button', { name: 'All (0)' }));
    expect(replace).toHaveBeenLastCalledWith('/workbench?view=reviewer-follow-up&cycleCode=J26&scope=all&reviewers=all', undefined, expect.any(Object));

    fireEvent.change(screen.getByLabelText('Filter reviewer follow-up'), { target: { value: 'north' } });
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining('q=north'), undefined, expect.any(Object));
    await act(async () => { jest.advanceTimersByTime(400); });
    expect(replace).toHaveBeenLastCalledWith('/workbench?view=reviewer-follow-up&cycleCode=J26&scope=all&reviewers=all&q=north', undefined, expect.any(Object));
  } finally {
    jest.useRealTimers();
  }
});

test('the Final writeups view carries writeups/pd/uncycled in the URL, keeps them across a cycle change, and the empty-cycle link changes the shell cycle', async () => {
  routerState.query = { view: 'final-writeups' };
  routerState.asPath = '/workbench?view=final-writeups';
  render(<WorkbenchShell />);
  // Working cycle D26 has nothing visible: the in-place notice names it and links June.
  expect(await screen.findByText('No current writeups visible to you in December 2026.')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith('/api/workbench/final-writeups?cycleCode=D26');

  fireEvent.click(screen.getByRole('button', { name: 'June 2026' }));
  expect(push).toHaveBeenLastCalledWith('/workbench?view=final-writeups&cycleCode=J26', undefined, expect.any(Object));
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J26'));
  expect(await screen.findByText('June writeup')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /All writeups/ }));
  expect(replace).toHaveBeenLastCalledWith('/workbench?view=final-writeups&cycleCode=J26&writeups=all', undefined, expect.any(Object));
  fireEvent.change(screen.getByLabelText('Responsible program director'), { target: { value: '33333333-3333-4333-8333-333333333331' } });
  expect(replace).toHaveBeenLastCalledWith('/workbench?view=final-writeups&cycleCode=J26&writeups=all&pd=33333333-3333-4333-8333-333333333331', undefined, expect.any(Object));

  // A cycle change keeps the view's filters.
  fireEvent.change(screen.getByLabelText('Grant cycle'), { target: { value: 'D26' } });
  expect(push).toHaveBeenLastCalledWith('/workbench?view=final-writeups&cycleCode=D26&writeups=all&pd=33333333-3333-4333-8333-333333333331', undefined, expect.any(Object));

  fireEvent.click(await screen.findByRole('button', { name: 'Writeups without a cycle' }));
  expect(push).toHaveBeenLastCalledWith('/workbench?view=final-writeups&cycleCode=D26&writeups=all&pd=33333333-3333-4333-8333-333333333331&uncycled=1', undefined, expect.any(Object));
  await waitFor(() => expect(global.fetch).toHaveBeenLastCalledWith('/api/workbench/final-writeups?cycleCode=none'));
});

test('the legacy Final writeups route redirects into the shell, translating its old keys', async () => {
  const { getServerSideProps } = require('../../pages/workbench/final-writeups/index');
  await expect(getServerSideProps({ query: { cycleCode: 'j26', view: 'reviewed', pd: ' 33333333-3333-4333-8333-333333333331 ' } })).resolves.toEqual({
    redirect: { destination: '/workbench?view=final-writeups&cycleCode=J26&writeups=reviewed&pd=33333333-3333-4333-8333-333333333331', permanent: false },
  });
  await expect(getServerSideProps({ query: { cycleCode: 'none', view: 'bogus', pd: 'not-a-guid' } })).resolves.toEqual({
    redirect: { destination: '/workbench?view=final-writeups&uncycled=1', permanent: false },
  });
  await expect(getServerSideProps({ query: {} })).resolves.toEqual({
    redirect: { destination: '/workbench?view=final-writeups', permanent: false },
  });
});

test('cycle options never show a count suffix', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  expect(screen.getByRole('option', { name: 'December 2026' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'June 2026' })).toBeInTheDocument();
  expect(screen.queryByText(/\(4\)/)).not.toBeInTheDocument();
  expect(screen.queryByText(/\(9\)/)).not.toBeInTheDocument();
});

test('the Grant program select stays enabled with a note on Final writeups and Awardees, and has no note on Request list', async () => {
  routerState.query = { view: 'final-writeups' };
  routerState.asPath = '/workbench?view=final-writeups';
  const { unmount } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant program')).not.toBeDisabled());
  expect(screen.getByText('Not filtered by program')).toBeInTheDocument();
  unmount();

  routerState.query = { view: 'awardees' };
  routerState.asPath = '/workbench?view=awardees';
  const { unmount: unmountAwardees } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant program')).not.toBeDisabled());
  expect(screen.getByText('Research programs only')).toBeInTheDocument();
  unmountAwardees();

  routerState.query = {};
  routerState.asPath = '/workbench';
  const { unmount: unmountRequestList } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant program')).not.toBeDisabled());
  expect(screen.queryByText('Not filtered by program')).not.toBeInTheDocument();
  expect(screen.queryByText('Research programs only')).not.toBeInTheDocument();
  unmountRequestList();

  routerState.query = { view: 'reviewer-follow-up' };
  routerState.asPath = '/workbench?view=reviewer-follow-up';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant program')).not.toBeDisabled());
  expect(screen.queryByText('Not filtered by program')).not.toBeInTheDocument();
  expect(screen.queryByText('Research programs only')).not.toBeInTheDocument();
});

test('the "Find and open a request" disclosure is closed by default on Request list and does not mount the locator body', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  const toggle = screen.getByRole('button', { name: 'Find and open a request' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('request-locator-mock')).not.toBeInTheDocument();
});

test('the "Find and open a request" disclosure is closed by default on Awardees, and opening it mounts the locator body with the shell programId', async () => {
  routerState.query = { view: 'awardees' };
  routerState.asPath = '/workbench?view=awardees';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  const toggle = screen.getByRole('button', { name: 'Find and open a request' });
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByTestId('request-locator-mock')).not.toBeInTheDocument();

  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('request-locator-mock')).toHaveAttribute('data-program-id', 'p1');
});

test('opening the locator on a non-Request-list view mounts the body, and it survives a shallow view switch', async () => {
  routerState.query = { view: 'reviewer-follow-up' };
  routerState.asPath = '/workbench?view=reviewer-follow-up';
  const { rerender } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/reviewers?cycleCode=D26&scope=my&programId=p1'));
  fireEvent.click(screen.getByRole('button', { name: 'Find and open a request' }));
  expect(screen.getByTestId('request-locator-mock')).toBeInTheDocument();

  // The shell does not remount on a view switch (same component instance, no
  // `key`), so the open disclosure stays open; simulate the switch the way
  // the nav link's shallow navigation would (see the "external navigation"
  // test above for the same rerender pattern).
  routerState.query = { view: 'final-writeups' };
  routerState.asPath = '/workbench?view=final-writeups';
  rerender(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByRole('link', { name: 'Final writeups' })).toHaveAttribute('aria-current', 'page'));
  expect(screen.getByRole('button', { name: 'Find and open a request' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByTestId('request-locator-mock')).toBeInTheDocument();
});

test('opening the disclosure before the shell\'s program resolves defers mounting the locator body until it does', async () => {
  let resolveDashboard;
  const pending = new Promise((resolve) => { resolveDashboard = resolve; });
  mockFetch({ '/api/workbench/dashboard': () => pending });
  render(<WorkbenchShell />);

  const toggle = screen.getByRole('button', { name: 'Find and open a request' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // The seed guard (programId={programId}) would be inert if the body mounted
  // before the dashboard fetch resolved a program to seed it with.
  expect(screen.queryByTestId('request-locator-mock')).not.toBeInTheDocument();

  await act(async () => {
    resolveDashboard(response({ success: true, programs, programId: 'p1', cycles: CYCLES, defaultCycleCode: 'D26' }));
    await pending;
  });
  await waitFor(() => expect(screen.getByTestId('request-locator-mock')).toHaveAttribute('data-program-id', 'p1'));
});

test('changing the shell\'s Grant program remounts the open locator with the new programId', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('D26'));
  fireEvent.click(screen.getByRole('button', { name: 'Find and open a request' }));
  expect(screen.getByTestId('request-locator-mock')).toHaveAttribute('data-program-id', 'p1');

  fireEvent.change(screen.getByLabelText('Grant program'), { target: { value: 'p2' } });
  await waitFor(() => expect(screen.getByLabelText('Grant cycle')).toHaveValue('J27'));
  // key={programId} on the shell's <RequestLocator> forces a remount (fresh
  // seed) rather than leaving a stale program mounted behind the disclosure.
  expect(screen.getByTestId('request-locator-mock')).toHaveAttribute('data-program-id', 'p2');
});
