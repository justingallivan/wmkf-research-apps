/**
 * @jest-environment jsdom
 */
// The Review Panel tab slot (between Reviews and Staff Deliberations) is
// visible ONLY with the `review-panel` app grant, and a deep link to it
// without the grant falls back to Overview — the client projection of the
// route's requireAppAccess('review-panel') (feedback-ui-gates-must-mirror-server-guards).

import { act, fireEvent, render, screen, within } from '@testing-library/react';

const mockPush = jest.fn();
let mockQuery = { requestId: 'request-1', tab: 'review-panel' };
let mockAccess = { isSuperuser: false, hasAccess: () => false };

jest.mock('next/router', () => ({ useRouter: () => ({ query: mockQuery, pathname: '/workbench/[requestId]', push: mockPush }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { dynamicsSystemuserId: 'user-1' } } }) }));
jest.mock('next/link', () => function LinkStub({ href, children, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; });
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Card: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/components/RequireAppAccess', () => function Stub({ children }) { return children; });
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => mockAccess }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({ readEmailSignaturePreference: () => ({}) }));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({ computeCanManage: () => true }));
jest.mock('../../lib/dataverse/core/interlock', () => ({ classifyTarget: () => 'sandbox' }));
jest.mock('../../shared/components/workbench/ReviewsTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/ProposalTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/StatusTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/AwardeeTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/InitialAssessmentRationale', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/InitialAssessmentTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/StaffDeliberationsTab', () => function Stub({ presentationContext }) {
  return <><h2>Presentation and staff discussion</h2>{presentationContext}</>;
});
jest.mock('../../shared/components/workbench/FinalWriteupTab', () => function Stub() {
  return <h2>Draft Writeup</h2>;
});
jest.mock('../../shared/components/workbench/IntegrityTab', () => function Stub() { return <div />; });
jest.mock('../../shared/components/workbench/StaffVisitAssessment', () => function Stub() {
  return <h3>Staff assessment of the presentation</h3>;
});
jest.mock('../../shared/components/workbench/MeetingRoster', () => function Stub() {
  return <h3>Meeting roster</h3>;
});
jest.mock('../../shared/components/workbench/StaffReviewSummary', () => function Stub({ onOpenReports }) {
  if (onOpenReports) return <h3>Staff interpretation from Reports</h3>;
  return <h3>Staff review summary</h3>;
});
jest.mock('../../shared/components/reviewers/ReviewersTab', () => function ReviewerStub() { return <div data-testid="reviewer-roster" />; });
jest.mock('../../shared/components/workbench/OverviewTab', () => function OverviewStub() { return <div data-testid="overview-tab" />; });
jest.mock('../../shared/components/workbench/ReviewPanelTab', () => function ReviewPanelStub(props) { return <div data-testid="review-panel-tab" data-request-id={props.requestId} data-title={props.title} />; });

import { WorkbenchRequest, visibleTabsFor } from '../../pages/workbench/[requestId]';

beforeEach(() => {
  mockPush.mockClear();
  mockAccess = { isSuperuser: false, hasAccess: () => false };
  mockQuery = { requestId: 'request-1', tab: 'review-panel' };
  global.fetch = jest.fn(() => new Promise(() => {}));
});

test('visibleTabsFor: the gated tab sits between Reviews and Staff Deliberations only when hasAccess grants it; a missing hasAccess is fail-closed', () => {
  const withGrant = visibleTabsFor((key) => key === 'review-panel').map((t) => t.key);
  const i = withGrant.indexOf('review-panel');
  expect(withGrant[i - 1]).toBe('reviews');
  expect(withGrant[i + 1]).toBe('staff-deliberations');
  expect(visibleTabsFor(() => false).map((t) => t.key)).not.toContain('review-panel');
  expect(visibleTabsFor(undefined).map((t) => t.key)).not.toContain('review-panel');
  expect(visibleTabsFor(() => 'yes').map((t) => t.key)).not.toContain('review-panel'); // strict true only
  // Every ungated tab survives regardless of access.
  const gatedCount = visibleTabsFor(() => true).filter((tab) => tab.gate).length;
  expect(visibleTabsFor(() => false)).toHaveLength(visibleTabsFor(() => true).length - gatedCount);
});

test('Integrity is gated by the integrity-screener app grant and follows Proposal', () => {
  const withGrant = visibleTabsFor((key) => key === 'integrity-screener').map((t) => t.key);
  expect(withGrant[withGrant.indexOf('integrity') - 1]).toBe('proposal');
  expect(visibleTabsFor(() => false).map((t) => t.key)).not.toContain('integrity');
  expect(visibleTabsFor(() => true)).toContainEqual(expect.objectContaining({ key: 'integrity', gate: 'integrity-screener' }));
});

test.each([['review-panel', 'Review Panel'], ['status', 'Status']])('unavailable %s deep-links fall back to Overview without a tab button', (tab, label) => {
  mockQuery.tab = tab;
  mockAccess = { isSuperuser: true, hasAccess: () => false }; // superuser alone is NOT the gate — the grant is
  render(<WorkbenchRequest />);
  expect(screen.queryByRole('button', { name: label })).toBeNull();
  expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  expect(screen.queryByTestId('review-panel-tab')).toBeNull();
});

test('with the grant, the tab button renders and the deep link mounts ReviewPanelTab keyed to the route request id', () => {
  mockAccess = { isSuperuser: false, hasAccess: (key) => key === 'review-panel' };
  render(<WorkbenchRequest />);
  const button = screen.getByRole('button', { name: 'Review Panel' });
  expect(button).toHaveAttribute('aria-current', 'page');
  expect(screen.getByTestId('review-panel-tab')).toHaveAttribute('data-request-id', 'request-1');
});

test('a deep-linked tab is centered in the horizontally overflowing mobile tab strip', () => {
  mockAccess = { isSuperuser: false, hasAccess: (key) => key === 'review-panel' };
  const descriptors = {
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
    offsetLeft: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft'),
    offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
  };
  Object.defineProperties(HTMLElement.prototype, {
    clientWidth: { configurable: true, get() { return this.querySelector?.('[aria-label="Request sections"]') ? 320 : 100; } },
    scrollWidth: { configurable: true, get() { return this.querySelector?.('[aria-label="Request sections"]') ? 1033 : 100; } },
    offsetLeft: { configurable: true, get() { return this.getAttribute?.('aria-current') === 'page' ? 500 : 0; } },
    offsetWidth: { configurable: true, get() { return this.getAttribute?.('aria-current') === 'page' ? 110 : 100; } },
  });

  try {
    render(<WorkbenchRequest />);
    const scroller = screen.getByRole('navigation', { name: 'Request sections' }).parentElement;
    expect(scroller.scrollLeft).toBe(395);
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
      else delete HTMLElement.prototype[name];
    }
  }
});

test('sandbox shell presents five phases and preserves reviewer deep links', async () => {
  mockAccess = { isSuperuser: false, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab: 'reviews' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  const nav = screen.getByRole('navigation', { name: 'Request sections' });
  expect([...nav.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'Overview', 'Initial Assessment', 'Peer Review', 'Deliberations', 'Final Assessment',
  ]);
  expect(screen.getByRole('button', { name: 'Peer Review', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(screen.getByRole('button', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
});

test.each(['review-panel', 'integrity'])('sandbox legacy %s link cannot mount a gated surface without its grant', async (tab) => {
  mockAccess = { isSuperuser: true, hasAccess: () => false };
  mockQuery = { requestId: 'request-1', tab };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  expect(screen.queryByTestId('review-panel-tab')).toBeNull();
  expect(screen.queryByRole('button', { name: 'AI Review Panel' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Integrity' })).toBeNull();
});

test('the existing group-review link opens the AI Review Panel with its new label', async () => {
  mockAccess = { isSuperuser: false, hasAccess: (key) => key === 'review-panel' };
  mockQuery = { requestId: 'request-1', tab: 'peer-review', section: 'group-review' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  expect(screen.getByTestId('review-panel-tab')).toHaveAttribute('data-request-id', 'request-1');
  expect(screen.getByTestId('review-panel-tab')).toHaveAttribute('data-title', 'AI Review Panel');
  const sections = within(screen.getByRole('navigation', { name: 'Peer Review sections' }));
  expect(sections.getAllByRole('button').map(button => button.textContent)).toEqual(['Panel', 'Reports', 'AI Review Panel']);
  expect(sections.getByRole('button', { name: 'AI Review Panel', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(sections.getByRole('button', { name: 'Panel', exact: true })).not.toHaveAttribute('aria-current');
  expect(screen.queryByRole('button', { name: 'Group review', exact: true })).toBeNull();
});


test('phase navigation writes canonical phase and section links', async () => {
  mockAccess = { isSuperuser: false, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab: 'peer-review', sub: 'track' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  fireEvent.click(screen.getByRole('button', { name: 'Reports', exact: true }));
  expect(mockPush).toHaveBeenLastCalledWith(
    { pathname: '/workbench/request-1', query: { sub: 'track', tab: 'peer-review', section: 'reports' } },
    undefined, { shallow: true },
  );
  fireEvent.click(screen.getByRole('button', { name: 'Final Assessment', exact: true }));
  expect(mockPush).toHaveBeenLastCalledWith(
    { pathname: '/workbench/request-1', query: { tab: 'final-assessment' } },
    undefined, { shallow: true },
  );
});

test('sandbox requests outside J27 retain the existing navigation', async () => {
  mockAccess = { isSuperuser: false, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab: 'reviews' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'D26' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  expect(screen.getByRole('button', { name: 'Reviews', exact: true })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('button', { name: 'Peer Review', exact: true })).toBeNull();
});

test.each([
  ['proposal', 'Initial Assessment', 'Proposal'],
  ['initial-writeup', 'Initial Assessment', 'Assessment'],
  ['reviewers', 'Peer Review', 'Panel'],
  ['review-panel', 'Peer Review', 'AI Review Panel'],
  ['pre-site-visit', 'Deliberations', null],
  ['site-visit', 'Deliberations', null],
  ['staff-deliberations', 'Deliberations', null],
  ['final-writeup', 'Final Assessment', null],
])('J27 legacy %s selects its phase and section', async (tab, phase, section) => {
  mockAccess = { isSuperuser: false, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  expect(screen.getByRole('button', { name: phase, exact: true })).toHaveAttribute('aria-current', 'page');
  if (section) expect(screen.getByRole('button', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
});


test.each([
  ['awardee', undefined],
  ['overview', 'awardee'],
])('J27 Awardee bookmarks open a separate tab only after an award (%s)', async (tab, section) => {
  mockQuery = { requestId: 'request-1', tab, section };
  const mockRequest = (statusClass) => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
      success: true, requestId: 'request-1', cycleCode: 'J27', statusClass,
    }) }));
  };
  mockRequest('IN_FLIGHT');
  const { unmount } = render(<WorkbenchRequest staffReviewSummary />);
  expect(await screen.findByTestId('overview-tab')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Awardee' })).toBeNull();
  expect(screen.queryByRole('navigation', { name: 'Overview sections' })).toBeNull();
  unmount();

  mockRequest('DECIDED_AWARD');
  render(<WorkbenchRequest staffReviewSummary />);
  expect(await screen.findByRole('button', { name: 'Awardee' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByTestId('overview-tab')).toBeNull();
});

test('canonical phase links wait for request context and remain retryable on failure', async () => {
  mockQuery = { requestId: 'request-1', tab: 'peer-review', section: 'reports' };
  let resolve;
  global.fetch = jest.fn(() => new Promise((done) => { resolve = done; }));
  render(<WorkbenchRequest staffReviewSummary />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading request details');
  expect(screen.queryByTestId('overview-tab')).toBeNull();
  await act(async () => { resolve({ ok: false, json: async () => ({ error: 'Unavailable' }) }); });
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.queryByTestId('overview-tab')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await act(async () => { resolve({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }); });
  expect(screen.getByRole('button', { name: 'Reports', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Panel navigation returns to the roster and retains the Finder proposal choice', async () => {
  mockAccess = { isSuperuser: false, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab: 'peer-review', section: 'panel', sub: 'find',
    proposalFile: 'document-key', repairCandidate: 'candidate', repairSuggestion: 'suggestion' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary />); });
  fireEvent.click(screen.getByRole('button', { name: 'Panel', exact: true }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/workbench/request-1', query: {
    tab: 'peer-review', section: 'panel', proposalFile: 'document-key',
  } }, undefined, { shallow: true });
});

test.each([
  [null, true, false],
  [100000005, true, false],
  [100000004, false, false],
  [100000004, true, true],
])('J27 exposes the recommendation to Chairs only after a Scored decision on a test request (%s, %s)', async (phaseIStatus, isTestRequest, visible) => {
  mockAccess = { isSuperuser: true, hasAccess: () => true };
  mockQuery = { requestId: 'request-1', tab: 'initial-assessment' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
    success: true, requestId: 'request-1', cycleCode: 'J27', isTestRequest, phaseIStatus, requestVersion: 'W/"1"',
  }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary initialRationaleEnabled chairsRecommendationEnabled />); });
  expect(Boolean(screen.queryByRole('combobox', { name: 'Recommendation' }))).toBe(visible);
});


test('J27 Deliberations leads with the presentation and keeps staff inputs below it', async () => {
  mockQuery = { requestId: 'request-1', tab: 'deliberations' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary meetingRosterEnabled />); });

  const presentation = screen.getByRole('heading', { name: 'Presentation and staff discussion' });
  const roster = screen.getByRole('heading', { name: 'Meeting roster' });
  const visit = screen.getByRole('heading', { name: 'Staff assessment of the presentation' });
  const interpretation = screen.getByRole('heading', { name: 'Staff interpretation from Reports' });
  expect(presentation.compareDocumentPosition(interpretation)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(interpretation.compareDocumentPosition(roster)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(roster.compareDocumentPosition(visit)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test('J27 Final Assessment leads with the Draft Writeup and groups the three saved records', async () => {
  mockQuery = { requestId: 'request-1', tab: 'final-assessment' };
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true, requestId: 'request-1', cycleCode: 'J27' }) }));
  await act(async () => { render(<WorkbenchRequest staffReviewSummary meetingRosterEnabled />); });

  const recommendation = screen.getByRole('heading', { name: 'Draft Writeup' });
  const evidence = screen.getByText('Supporting evidence').closest('details');
  expect(recommendation.compareDocumentPosition(evidence)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(evidence).not.toHaveAttribute('open');
  expect(evidence.querySelectorAll('details')).toHaveLength(0);
  expect(evidence).toHaveTextContent('Staff review summary');
  expect(evidence).toHaveTextContent('Meeting roster');
  expect(evidence).toHaveTextContent('Staff assessment of the presentation');
});
