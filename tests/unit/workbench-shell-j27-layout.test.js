/**
 * @jest-environment jsdom
 *
 * Workbench shell, J27 Research layout (build plan
 * docs/plans/J27_CYCLE_PAGE_BUILD_PLAN_2026-11-09.md, slice 1): the tab set,
 * the shared request rows, old-link mapping, the scope default, and that
 * earlier cycles and other programs keep today's layout.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/workbench/RequestLocator', () => ({ __esModule: true, RequestLocator: () => null }));
jest.mock('../../shared/components/workbench/IntegrityAlerts', () => ({ __esModule: true, default: () => null }));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({ __esModule: true, default: (props) => <div data-testid="reviewer-progress" data-accepted={props.reviewers?.accepted ?? ''} /> }));
jest.mock('../../shared/components/workbench/RequestListPanel', () => ({ __esModule: true, default: (props) => <div data-testid="legacy-request-list" data-cycle={props.cycleCode || ''} /> }));
jest.mock('../../shared/components/workbench/ReviewerFollowUpPanel', () => ({ __esModule: true, default: (props) => <div data-testid="reviewer-follow-up" data-scope={props.scope} /> }));
jest.mock('../../shared/components/workbench/StaffDeliberationsPanel', () => ({ __esModule: true, default: (props) => <div data-testid="staff-deliberations" data-scope={props.scope} /> }));
jest.mock('../../shared/components/final-writeups/FinalWriteupsViews', () => ({ __esModule: true, FinalWriteupsPanel: (props) => <div data-testid="final-writeups" data-cycle={props.cycleCode || ''} /> }));
jest.mock('../../shared/components/workbench/AwardeesPanel', () => ({ __esModule: true, default: (props) => <div data-testid="awardees" data-scope={props.scope} /> }));
jest.mock('../../shared/components/workbench/InitialAssessmentsPanel', () => ({ __esModule: true, default: () => <div data-testid="initial-assessments" /> }));

const RESEARCH = '94cab30b-958f-ee11-8179-000d3a341e8f';
const SOCAL = '8dcab30b-958f-ee11-8179-000d3a341e8f';
const programs = [{ programId: RESEARCH, name: 'Research' }, { programId: SOCAL, name: 'Southern California' }];
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });

const stage = (over = {}) => ({
  phase: 'initial-assessment', basis: 'partial', primaryTask: 'record-scoring', taskKeys: ['record-scoring', 'identify-reviewers'],
  blockerKeys: [], recorded: { scoring: 'unset', chairsRecommendation: 'unset', chairsOutcome: 'pending', label: null, unmapped: false },
  outcome: 'none', ...over,
});
const ROWS = [
  { requestId: 'r1', requestNumber: '1009001', title: 'Mapping signalling lipids', institution: 'Northfield University', projectLeader: 'Alex Sample', programDirector: 'Jordan Example', workRemaining: 'find', j27: stage() },
  {
    requestId: 'r2', requestNumber: '1009014', title: 'Programmable lattices', institution: 'Lakeshore Institute', projectLeader: 'Morgan Placeholder', programDirector: 'Jordan Example', workRemaining: 'find',
    j27: stage({ primaryTask: 'identify-reviewers', taskKeys: ['identify-reviewers', 'record-offramp'], blockerKeys: ['chairs-outcome-pending'], recorded: { scoring: 'inferred-scored', chairsRecommendation: 'yes', chairsOutcome: 'pending', label: 'Recommended to Chairs', unmapped: false } }),
  },
  {
    requestId: 'r3', requestNumber: '1009020', title: 'Deep-ocean carbon cycling', institution: 'Coastal Research University', projectLeader: 'Taylor Placeholder', programDirector: 'Jordan Example', workRemaining: 'invite',
    j27: stage({ phase: 'peer-review', primaryTask: 'send-invitations', taskKeys: ['identify-reviewers', 'send-invitations', 'record-offramp'], recorded: { scoring: 'inferred-scored', chairsRecommendation: 'inferred-yes', chairsOutcome: 'invited', label: 'Invited', unmapped: false } }),
  },
  {
    requestId: 'r4', requestNumber: '1009030', title: 'A set-aside idea', institution: 'Hillside College', projectLeader: 'Casey Sample', programDirector: 'Jordan Example', workRemaining: 'find',
    j27: stage({ primaryTask: null, taskKeys: [], outcome: 'not-scored', recorded: { scoring: 'not-scored', chairsRecommendation: 'unset', chairsOutcome: 'pending', label: 'Not Scored', unmapped: false } }),
  },
  {
    requestId: 'r5', requestNumber: '1009040', title: 'Presented already', institution: 'Ridgeway University', projectLeader: 'Robin Example', programDirector: 'Jordan Example', workRemaining: 'review',
    reviewers: { accepted: 3, outstanding: 1 },
    j27: stage({ phase: 'deliberations', primaryTask: 'record-offramp', taskKeys: ['record-offramp'], recorded: { scoring: 'inferred-scored', chairsRecommendation: 'inferred-yes', chairsOutcome: 'invited', label: 'Invited', unmapped: false } }),
  },
];

function mockFetch({ myCount = 3, stageProgramIds = [RESEARCH], defaultCycleCode = 'J27' } = {}) {
  global.fetch = jest.fn(async (url) => {
    const href = String(url);
    const params = new URL(href, 'http://localhost').searchParams;
    if (href.startsWith('/api/workbench/dashboard') && !params.get('cycleCode')) {
      const programId = params.get('programId') || RESEARCH;
      return response({
        success: true, programs, programId, stageProgramIds, defaultCycleCode,
        cycles: [{ code: 'J27', label: 'June 2027', count: 4, myCount, mySetAsideCount: 0 }, { code: 'D26', label: 'December 2026', count: 2, myCount: 1, mySetAsideCount: 0 }],
      });
    }
    if (href.startsWith('/api/workbench/dashboard?cycleCode=')) {
      return response({ success: true, programId: params.get('programId'), cycleCode: params.get('cycleCode'), scope: params.get('scope'), includeSetAside: false, proposals: ROWS, rollup: { total: ROWS.length, stages: {} } });
    }
    return response({});
  });
}

const open = (href, props = { phaseRelease: true }) => { applyHref(href); return render(<WorkbenchShell {...props} />); };
const rowFetches = () => global.fetch.mock.calls.map(([u]) => String(u)).filter((u) => u.includes('cycleCode='));
const tabNames = () => within(screen.getByRole('navigation', { name: 'Workbench views' })).getAllByRole('link').map((link) => link.textContent.replace(/\d+$/, ''));

beforeEach(() => {
  jest.clearAllMocks();
  routerState.query = {};
  routerState.asPath = '/workbench';
  mockFetch();
});

test('a J27 Research cycle opens on All requests with the six tabs, one row per request, closed rows hidden', async () => {
  open('/workbench');
  expect(await screen.findByText('Mapping signalling lipids')).toBeInTheDocument();
  expect(tabNames()).toEqual(['All requests', 'Initial Assessment', 'Peer Review', 'Deliberations', 'Final Assessment', 'Awardees']);
  expect(screen.getByRole('link', { name: 'All requests' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByTestId('legacy-request-list')).not.toBeInTheDocument();

  // Standing chip and the line under it.
  expect(screen.getByText('Not yet scored')).toBeInTheDocument();
  expect(screen.getByText('Next: Record Scored or Not Scored')).toBeInTheDocument();
  expect(screen.getByText('Recommended to Chairs')).toBeInTheDocument();
  expect(screen.getByText('Awaiting the Chairs’ outcome')).toBeInTheDocument();
  expect(screen.queryByText('Next: Identify reviewers')).not.toBeInTheDocument();
  expect(screen.getByText('Invite reviewers')).toBeInTheDocument();
  expect(screen.getByText('Next: Send reviewer invitations')).toBeInTheDocument();

  // The closed request is hidden and counted; "Everything" lists it.
  expect(screen.queryByText('A set-aside idea')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '1 closed request hidden' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '1 closed request hidden' }));
  expect(await screen.findByText('A set-aside idea')).toBeInTheDocument();
  expect(screen.getByLabelText('Showing')).toHaveValue('everything');
  expect(routerState.query.showing).toBe('everything');

  // One row read for the page; the tab counts come from the same rows.
  expect(rowFetches()).toEqual([`/api/workbench/dashboard?cycleCode=J27&scope=my&programId=${RESEARCH}`]);
  expect(screen.getByRole('link', { name: /Initial Assessment/ })).toHaveTextContent('Initial Assessment1');
  expect(screen.getByRole('link', { name: /Peer Review/ })).toHaveTextContent('Peer Review1');
});

test('rows link to the request page on the request’s phase', async () => {
  open('/workbench');
  expect(await screen.findByRole('link', { name: '#1009020' })).toHaveAttribute('href', '/workbench/r3?tab=peer-review&n=1009020');
  expect(screen.getByRole('link', { name: '#1009001' })).toHaveAttribute('href', '/workbench/r1?tab=initial-assessment&n=1009001');
});

test('search filters the loaded rows and offers to clear when nothing matches', async () => {
  open('/workbench');
  await screen.findByText('Mapping signalling lipids');
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'lakeshore' } });
  expect(screen.queryByText('Mapping signalling lipids')).not.toBeInTheDocument();
  expect(screen.getByText('Programmable lattices')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'zzz' } });
  expect(screen.getByText(/No requests match “zzz”/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByText('Mapping signalling lipids')).toBeInTheDocument();
  expect(rowFetches()).toHaveLength(1);
});

test('phase tabs list only their phase, with Show closed', async () => {
  open(`/workbench?view=initial-assessment&programId=${RESEARCH}&cycleCode=J27`);
  expect(await screen.findByText('Mapping signalling lipids')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Initial Assessment/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Programmable lattices')).toBeInTheDocument();
  expect(screen.queryByText('Deep-ocean carbon cycling')).not.toBeInTheDocument();
  expect(screen.queryByText('A set-aside idea')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('Show closed'));
  expect(await screen.findByText('A set-aside idea')).toBeInTheDocument();
  expect(routerState.query.closed).toBe('1');
});

test('old links land on the matching tab; Peer Review holds the Reviewer follow-up panel as a section', async () => {
  const first = open(`/workbench?view=reviewer-follow-up&programId=${RESEARCH}&cycleCode=J27`);
  expect(await screen.findByTestId('reviewer-follow-up')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Peer Review/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Reviewers' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Requests' }));
  expect(await screen.findByText('Deep-ocean carbon cycling')).toBeInTheDocument();
  expect(screen.queryByTestId('reviewer-follow-up')).not.toBeInTheDocument();
  first.unmount();

  const second = open(`/workbench?view=staff-deliberations&programId=${RESEARCH}&cycleCode=J27`);
  expect(await screen.findByTestId('staff-deliberations')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Deliberations/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Drafts' })).toHaveAttribute('aria-pressed', 'true');
  second.unmount();

  open(`/workbench?view=final-writeups&programId=${RESEARCH}&cycleCode=J27`);
  expect(await screen.findByTestId('final-writeups')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Final Assessment/ })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Writeup review' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('Not filtered by program')).toBeInTheDocument();
});

test('Deliberations and Final Assessment open on their request list; today’s panels are the second section', async () => {
  const first = open(`/workbench?view=deliberations&programId=${RESEARCH}&cycleCode=J27`);
  // The Deliberations row from the feed is listed; the Staff deliberations panel is not mounted.
  expect(await screen.findByText('Presented already')).toBeInTheDocument();
  expect(screen.queryByTestId('staff-deliberations')).not.toBeInTheDocument();
  expect(screen.queryByText('Deep-ocean carbon cycling')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Requests' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Drafts' }));
  expect(await screen.findByTestId('staff-deliberations')).toBeInTheDocument();
  expect(screen.queryByText('Presented already')).not.toBeInTheDocument();
  first.unmount();

  open(`/workbench?view=final-assessment&programId=${RESEARCH}&cycleCode=J27`);
  // No fixture row is in Final Assessment: the list says so instead of showing the review panel.
  expect(await screen.findByText(/No requests are in Final Assessment yet/)).toBeInTheDocument();
  expect(screen.queryByTestId('final-writeups')).not.toBeInTheDocument();
  // The request list is filtered by program, so the panel's hint does not belong here.
  expect(screen.queryByText('Not filtered by program')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Writeup review' }));
  expect(await screen.findByTestId('final-writeups')).toBeInTheDocument();
  expect(screen.getByText('Not filtered by program')).toBeInTheDocument();
});

test('someone who leads no requests opens on All in program; an explicit Assigned to me is kept in the address', async () => {
  mockFetch({ myCount: 0 });
  const first = open('/workbench');
  await screen.findByText('Mapping signalling lipids');
  expect(rowFetches().at(-1)).toBe(`/api/workbench/dashboard?cycleCode=J27&scope=all&programId=${RESEARCH}`);
  expect(screen.getByRole('button', { name: 'All in program' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Assigned to me (0)' }));
  await waitFor(() => expect(routerState.query.scope).toBe('my'));
  await waitFor(() => expect(rowFetches().at(-1)).toBe(`/api/workbench/dashboard?cycleCode=J27&scope=my&programId=${RESEARCH}`));
  expect(screen.getByRole('button', { name: 'Assigned to me (0)' })).toHaveAttribute('aria-pressed', 'true');
  first.unmount();

  mockFetch({ myCount: 3 });
  open('/workbench');
  await screen.findByText('Mapping signalling lipids');
  expect(rowFetches()).toEqual([`/api/workbench/dashboard?cycleCode=J27&scope=my&programId=${RESEARCH}`]);
});

test('without the release, an explicit J27 Research address reads no J27 rows and keeps today’s tabs, even while metadata is held', async () => {
  const fetchMetadata = (mockFetch(), global.fetch);
  let releaseCycles;
  const cyclesReady = new Promise((resolve) => { releaseCycles = resolve; });
  global.fetch = jest.fn(async (url) => {
    const params = new URL(String(url), 'http://localhost').searchParams;
    if (String(url).startsWith('/api/workbench/dashboard') && !params.get('cycleCode')) await cyclesReady;
    return fetchMetadata(url);
  });
  open(`/workbench?programId=${RESEARCH}&cycleCode=J27`, {});
  expect(await screen.findByTestId('legacy-request-list')).toBeInTheDocument();
  expect(rowFetches()).toEqual([]);
  releaseCycles();
  await waitFor(() => expect(tabNames()).toEqual(['Request list', 'Reviewer follow-up', 'Staff deliberations', 'Final writeups', 'Awardees']));
  expect(screen.getByTestId('legacy-request-list')).toBeInTheDocument();
  expect(rowFetches()).toEqual([]);
});

test('an earlier cycle and another program keep today’s tabs, and a new link maps back', async () => {
  const first = open(`/workbench?programId=${RESEARCH}&cycleCode=D26`);
  expect(await screen.findByTestId('legacy-request-list')).toBeInTheDocument();
  expect(tabNames()).toEqual(['Request list', 'Reviewer follow-up', 'Staff deliberations', 'Final writeups', 'Awardees']);
  first.unmount();

  const second = open(`/workbench?view=deliberations&programId=${RESEARCH}&cycleCode=D26`);
  expect(await screen.findByTestId('staff-deliberations')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Staff deliberations' })).toHaveAttribute('aria-current', 'page');
  second.unmount();

  mockFetch({ stageProgramIds: [RESEARCH] });
  open(`/workbench?programId=${SOCAL}&cycleCode=J27`);
  expect(await screen.findByTestId('legacy-request-list')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Request list' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('link', { name: 'All requests' })).not.toBeInTheDocument();
});

test('Initial Assessment filters by standing; a standing with no requests is disabled', async () => {
  open(`/workbench?view=initial-assessment&programId=${RESEARCH}&cycleCode=J27`);
  await screen.findByText('Mapping signalling lipids');
  const standing = within(screen.getByRole('group', { name: 'Standing' }));
  expect(standing.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  expect(standing.getByRole('button', { name: 'Not yet scored (1)' })).toBeEnabled();
  expect(standing.getByRole('button', { name: 'Scored (0)' })).toBeDisabled();
  fireEvent.click(standing.getByRole('button', { name: 'Recommended to Chairs (1)' }));
  await waitFor(() => expect(screen.queryByText('Mapping signalling lipids')).not.toBeInTheDocument());
  expect(screen.getByText('Programmable lattices')).toBeInTheDocument();
  expect(routerState.query.standing).toBe('recommended');
  expect(screen.queryByRole('group', { name: 'Standing' })).toBeInTheDocument();
});

test('reviewer progress appears on Peer Review rows and nowhere else; a later request says a review is outstanding', async () => {
  const first = open('/workbench');
  await screen.findByText('Presented already');
  expect(screen.queryByTestId('reviewer-progress')).not.toBeInTheDocument();
  expect(screen.getByText('1 review outstanding')).toBeInTheDocument();
  expect(screen.getByText('Deliberations', { selector: 'span' })).toBeInTheDocument();
  expect(screen.queryByText(/Record an offramp/)).not.toBeInTheDocument();
  first.unmount();

  open(`/workbench?view=peer-review&programId=${RESEARCH}&cycleCode=J27`);
  await screen.findByText('Deep-ocean carbon cycling');
  expect(screen.getAllByTestId('reviewer-progress')).toHaveLength(1);
  expect(screen.queryByText('Presented already')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Standing' })).not.toBeInTheDocument();
});

test('details unread on every request are reported once above the list, not on each row', async () => {
  const degraded = ROWS.map((row) => ({ ...row, j27: { ...row.j27, basis: 'degraded' } }));
  global.fetch = jest.fn(async (url) => {
    const params = new URL(String(url), 'http://localhost').searchParams;
    if (!params.get('cycleCode')) {
      return response({ success: true, programs, programId: RESEARCH, stageProgramIds: [RESEARCH], defaultCycleCode: 'J27', cycles: [{ code: 'J27', label: 'June 2027', count: 5, myCount: 5, mySetAsideCount: 0 }] });
    }
    return response({ success: true, programId: params.get('programId'), cycleCode: params.get('cycleCode'), scope: params.get('scope'), proposals: degraded, rollup: {} });
  });
  open('/workbench');
  await screen.findByText('Mapping signalling lipids');
  expect(screen.getAllByText('Some details could not be read for these requests.')).toHaveLength(1);
  expect(screen.queryByText('Some details could not be read.')).not.toBeInTheDocument();
});
