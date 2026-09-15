/**
 * @jest-environment jsdom
 */
// The Review Panel tab slot (between Reviews and Staff Deliberations) is
// visible ONLY with the `review-panel` app grant, and a deep link to it
// without the grant falls back to Overview — the client projection of the
// route's requireAppAccess('review-panel') (feedback-ui-gates-must-mirror-server-guards).

import { render, screen } from '@testing-library/react';

let mockQuery = { requestId: 'request-1', tab: 'review-panel' };
let mockAccess = { isSuperuser: false, hasAccess: () => false };

jest.mock('next/router', () => ({ useRouter: () => ({ query: mockQuery, pathname: '/workbench/[requestId]', push: jest.fn() }) }));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { dynamicsSystemuserId: 'user-1' } } }) }));
jest.mock('next/link', () => function LinkStub({ href, children, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; });
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Card: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/components/RequireAppAccess', () => function Stub({ children }) { return children; });
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => mockAccess }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({ readEmailSignaturePreference: () => ({}) }));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({ computeCanManage: () => true }));
jest.mock('../../lib/dataverse/core/interlock', () => ({ classifyTarget: () => 'sandbox' }));
for (const name of ['reviewers/ReviewersTab', 'workbench/ReviewsTab', 'workbench/ProposalTab', 'workbench/StatusTab', 'workbench/AwardeeTab',
  'workbench/InitialAssessmentTab', 'workbench/StaffDeliberationsTab', 'workbench/FinalWriteupTab']) {
  jest.mock(`../../shared/components/${name}`, () => function Stub() { return <div />; });
}
jest.mock('../../shared/components/workbench/OverviewTab', () => function OverviewStub() { return <div data-testid="overview-tab" />; });
jest.mock('../../shared/components/workbench/ReviewPanelTab', () => function ReviewPanelStub(props) { return <div data-testid="review-panel-tab" data-request-id={props.requestId} />; });

import { WorkbenchRequest, visibleTabsFor } from '../../pages/workbench/[requestId]';

beforeEach(() => {
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
  expect(visibleTabsFor(() => false)).toHaveLength(visibleTabsFor(() => true).length - 1);
});

test('without the grant, the tab button is absent and ?tab=review-panel deep-links fall back to Overview (never a blank panel)', () => {
  mockAccess = { isSuperuser: true, hasAccess: () => false }; // superuser alone is NOT the gate — the grant is
  render(<WorkbenchRequest />);
  expect(screen.queryByRole('button', { name: 'Review Panel' })).toBeNull();
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
