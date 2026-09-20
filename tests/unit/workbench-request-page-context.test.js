/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';

let routeId = 'request-a';
let tabName = 'overview';
const pending = new Map();

jest.mock('next/router', () => ({
  useRouter: () => ({ query: { requestId: routeId, tab: tabName }, push: jest.fn() }),
}));
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { profileName: 'Test User', dynamicsSystemuserId: 'user-1' } } }) }));
jest.mock('next/link', () => function LinkStub({ children }) { return <a href="#">{children}</a>; });
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Card: ({ children }) => <div>{children}</div> }));
jest.mock('../../shared/components/RequireAppAccess', () => function RequireAppAccessStub({ children }) { return children; });
jest.mock('../../shared/context/AppAccessContext', () => ({ useAppAccess: () => ({ isSuperuser: false, hasAccess: () => true }) }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ preferences: {} }) }));
jest.mock('../../shared/config/reviewerFinderPreferences', () => ({ readEmailSignaturePreference: () => ({}) }));
jest.mock('../../shared/components/reviewers/reviewer-modes', () => ({
  computeCanManage: ({ isSuperuser, pdId, myUserId }) => Boolean(isSuperuser || (pdId && myUserId && pdId === myUserId)),
}));
jest.mock('../../lib/dataverse/core/interlock', () => ({ classifyTarget: () => 'sandbox' }));

jest.mock('../../shared/components/workbench/OverviewTab', () => function OverviewStub({ context }) {
  return <div data-testid="overview" data-context={context?.requestId || ''} data-title={context?.title || ''} />;
});
jest.mock('../../shared/components/reviewers/ReviewersTab', () => function ReviewersStub({ context, canManage }) {
  return <div data-testid="reviewers" data-context={context?.requestId || ''} data-can-manage={String(canManage)} />;
});
jest.mock('../../shared/components/workbench/ReviewsTab', () => function TabStub() { return <div />; });
jest.mock('../../shared/components/workbench/ProposalTab', () => function ProposalStub({ context }) { return <div data-testid="proposal" data-context={context?.requestId || ''} />; });
jest.mock('../../shared/components/workbench/StatusTab', () => function StatusStub({ context }) { return <div data-testid="status" data-context={context?.requestId || ''} />; });
jest.mock('../../shared/components/workbench/AwardeeTab', () => function AwardeeStub({ context }) { return <div data-testid="awardee" data-context={context?.requestId || ''} />; });
jest.mock('../../shared/components/workbench/InitialAssessmentTab', () => function TabStub() { return <div />; });
jest.mock('../../shared/components/workbench/StaffDeliberationsTab', () => function TabStub() { return <div />; });
jest.mock('../../shared/components/workbench/ReviewPanelTab', () => function TabStub() { return <div />; });
jest.mock('../../shared/components/workbench/FinalWriteupTab', () => function TabStub() { return <div />; });

import { WorkbenchRequest } from '../../pages/workbench/[requestId]';

beforeEach(() => {
  routeId = 'request-a';
  tabName = 'overview';
  pending.clear();
  global.fetch = jest.fn((url) => new Promise((resolve) => pending.set(String(url), resolve)));
});

test('hides the prior request context synchronously when the route changes', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: true,
      json: async () => ({ success: true, requestId: 'REQUEST-A', title: 'Request A' }),
    });
  });
  await waitFor(() => expect(screen.getByTestId('overview')).toHaveAttribute('data-context', 'REQUEST-A'));

  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  expect(screen.getByTestId('overview')).toHaveAttribute('data-context', '');
  expect(screen.getByTestId('overview')).toHaveAttribute('data-title', '');
});

test('does not publish a stale request response after navigation', async () => {
  const view = render(<WorkbenchRequest />);
  const resolveA = pending.get('/api/workbench/resolve-request?requestId=request-a');
  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  const resolveB = pending.get('/api/workbench/resolve-request?requestId=request-b');
  await act(async () => {
    resolveB({
      ok: true,
      json: async () => ({ success: true, requestId: 'request-b', title: 'Fresh B' }),
    });
    resolveA({ ok: true, json: async () => ({ success: true, requestId: 'request-a', title: 'Stale A' }) });
  });
  expect(screen.getByTestId('overview')).toHaveAttribute('data-context', 'request-b');
});

test('does not resurrect A after A→B→A when the latest A load is denied', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({ ok: true, json: async () => ({ success: true, requestId: 'REQUEST-A', title: 'A' }) });
  });
  await waitFor(() => expect(screen.getByTestId('overview')).toHaveAttribute('data-context', 'REQUEST-A'));

  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  routeId = 'request-a';
  view.rerender(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({ ok: false, json: async () => ({ error: 'Denied' }) });
  });
  expect(screen.getByTestId('overview')).toHaveAttribute('data-context', '');
});

test('suppresses a mismatched successful response', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({ ok: true, json: async () => ({ success: true, requestId: 'request-other', title: 'Wrong' }) });
  });
  expect(screen.getByTestId('overview')).toHaveAttribute('data-context', '');
});

test('clears every context consumer and canManage on B after a valid A snapshot', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: true,
      json: async () => ({ success: true, requestId: 'request-a', title: 'A', programDirectorId: 'user-1' }),
    });
  });
  await waitFor(() => expect(screen.getByTestId('overview')).toHaveAttribute('data-context', 'request-a'));
  tabName = 'reviewers';
  view.rerender(<WorkbenchRequest />);
  expect(screen.getByTestId('reviewers')).toHaveAttribute('data-context', 'request-a');
  expect(screen.getByTestId('reviewers')).toHaveAttribute('data-can-manage', 'true');

  for (const tab of ['overview', 'proposal', 'reviewers', 'status', 'awardee']) {
    routeId = 'request-b';
    tabName = tab;
    view.rerender(<WorkbenchRequest />);
    const probe = screen.getByTestId(tab);
    expect(probe).toHaveAttribute('data-context', '');
    if (tab === 'reviewers') expect(probe).toHaveAttribute('data-can-manage', 'false');
  }
});

test('suppresses a prior request error after navigation', async () => {
  const view = render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: false,
      json: async () => ({ error: 'Request A failed' }),
    });
  });
  await waitFor(() => expect(screen.getByText(/Request A failed/)).toBeInTheDocument());

  routeId = 'request-b';
  view.rerender(<WorkbenchRequest />);
  expect(screen.queryByText(/Request A failed/)).not.toBeInTheDocument();
});


test.each([false, undefined])('rejects a matching context without success=true (%s)', async (success) => {
  tabName = 'reviewers';
  render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: true,
      json: async () => ({ success, requestId: 'request-a', title: 'Invalid A', programDirectorId: 'user-1' }),
    });
  });
  expect(screen.getByTestId('reviewers')).toHaveAttribute('data-context', '');
  expect(screen.getByTestId('reviewers')).toHaveAttribute('data-can-manage', 'false');
  expect(screen.getByText(/Couldn’t load request details/)).toBeInTheDocument();
});

// ── T5 (client-request-layer Stage 5a, plan §5) matrix for the :127
// resolve-request GET, ahead of migrating it onto requestEnvelope
// (differing derivation: the fallback message is templated with the status
// code, so it cannot go through requestJson's static fallbackMessage). ────

test('T5(b) non-2xx with no body error falls back to the status-templated message, as today', async () => {
  render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: false, status: 503, json: async () => ({}),
    });
  });
  await waitFor(() => expect(screen.getByText(/Failed to load request \(503\)/)).toBeInTheDocument());
});

test('T5(c) network rejection surfaces its own message, as today', async () => {
  render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')(Promise.reject(new Error('network down')));
  });
  await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
});

test('T5(d) malformed 2xx body (tolerant) is treated as a mismatched context, as today', async () => {
  render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); },
    });
  });
  await waitFor(() => expect(screen.getByText(/Request context did not match the requested request/)).toBeInTheDocument());
});

test('T5(e) unparseable non-2xx body (e.g. a 502 HTML page) falls back to the status-templated message, as today', async () => {
  render(<WorkbenchRequest />);
  await act(async () => {
    pending.get('/api/workbench/resolve-request?requestId=request-a')({
      ok: false, status: 502, json: async () => { throw new SyntaxError('<html>Bad gateway</html>'); },
    });
  });
  await waitFor(() => expect(screen.getByText(/Failed to load request \(502\)/)).toBeInTheDocument());
});
