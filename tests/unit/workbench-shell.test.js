/**
 * @jest-environment jsdom
 *
 * Request Workbench shell — the URL owns the view, program, cycle, and Request
 * list filters, so back navigation and shared links land where the PD was.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
jest.mock('../../shared/components/workbench/RequestLocator', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({ __esModule: true, default: () => null }));

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
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));
  expect(replace).toHaveBeenCalledWith('/workbench?cycleCode=D26', undefined, { shallow: true, scroll: false });
  expect(push).not.toHaveBeenCalled();
  await waitFor(() => expect(rowFetches()).toEqual(['/api/workbench/dashboard?cycleCode=D26&scope=my&programId=p1']));
});

test('a deep-linked cycle the program lists is honored without rewriting the URL', async () => {
  routerState.query = { cycleCode: 'J26', scope: 'all', setAside: '1' };
  routerState.asPath = '/workbench?cycleCode=J26&scope=all&setAside=1';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('J26'));
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Show set aside')).toBeChecked();
  await waitFor(() => expect(rowFetches()).toEqual(['/api/workbench/dashboard?cycleCode=J26&scope=all&programId=p1&includeSetAside=1']));
});

test('an unlisted deep-linked cycle falls back to the working cycle and corrects the URL', async () => {
  routerState.query = { cycleCode: 'J25' };
  routerState.asPath = '/workbench?cycleCode=J25';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));
  expect(replace).toHaveBeenCalledWith('/workbench?cycleCode=D26', undefined, expect.any(Object));
  expect(rowFetches().some((u) => u.includes('cycleCode=J25'))).toBe(false);
});

test('cycle and program changes push history entries; filter changes replace', async () => {
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));

  fireEvent.change(screen.getByLabelText('Cycle'), { target: { value: 'J26' } });
  expect(push).toHaveBeenLastCalledWith('/workbench?cycleCode=J26', undefined, expect.any(Object));

  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(replace).toHaveBeenLastCalledWith('/workbench?cycleCode=J26&scope=all', undefined, expect.any(Object));
  fireEvent.click(screen.getByLabelText('Show set aside'));
  expect(replace).toHaveBeenLastCalledWith('/workbench?cycleCode=J26&scope=all&setAside=1', undefined, expect.any(Object));

  fireEvent.change(screen.getByLabelText('Grant Program'), { target: { value: 'p2' } });
  // The program change drops the cycle; the new program's working cycle is written back.
  expect(push).toHaveBeenLastCalledWith('/workbench?programId=p2&scope=all&setAside=1', undefined, expect.any(Object));
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('J27'));
  expect(replace).toHaveBeenLastCalledWith('/workbench?programId=p2&cycleCode=J27&scope=all&setAside=1', undefined, expect.any(Object));
  await waitFor(() => expect(rowFetches().at(-1)).toBe('/api/workbench/dashboard?cycleCode=J27&scope=all&programId=p2&includeSetAside=1'));
});

test('an external navigation (back button) is adopted from the URL', async () => {
  const { rerender } = render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));
  routerState.query = { cycleCode: 'J26', scope: 'all' };
  routerState.asPath = '/workbench?cycleCode=J26&scope=all';
  rerender(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('J26'));
  expect(screen.getByRole('button', { name: 'All' })).toHaveClass('bg-gray-900');
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
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));
});

test('a non-panel view in the URL keeps the shell toolbar and points at the tabs', async () => {
  routerState.query = { view: 'awardees', cycleCode: 'D26' };
  routerState.asPath = '/workbench?view=awardees&cycleCode=D26';
  render(<WorkbenchShell />);
  await waitFor(() => expect(screen.getByLabelText('Cycle')).toHaveValue('D26'));
  expect(screen.getByText(/opens on its own page/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Awardees' })).toHaveAttribute('aria-current', 'page');
  expect(rowFetches()).toEqual([]);
});
