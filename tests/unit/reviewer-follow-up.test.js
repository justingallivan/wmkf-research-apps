import {
  filterReviewerFollowUpProposals,
  isReviewerOverdue,
  mergeReviewerFollowUpProposals,
  proposalNeedsAttention,
  summarizeReviewerFollowUp,
} from '../../shared/utils/reviewer-follow-up';
import { getServerSideProps } from '../../pages/workbench/reviewer-follow-up';
import { ReviewerFollowUpDashboard } from '../../pages/workbench/reviewer-follow-up';
import { PRODUCTION_HOSTS, SANDBOX_HOSTS } from '../../lib/dataverse/core/target-registry';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => {
  const React = require('react');
  const Layout = ({ children }) => React.createElement('main', null, children);
  const Card = ({ children }) => React.createElement('section', null, children);
  const PageHeader = ({ title, subtitle }) => React.createElement(
    'header',
    null,
    React.createElement('h1', null, title),
    React.createElement('p', null, subtitle),
  );
  return { __esModule: true, default: Layout, Card, PageHeader };
});

jest.mock('../../shared/components/reviewers/ReviewerManagePanel', () => {
  const React = require('react');
  return function MockReviewerManagePanel({ canManage, degraded, loading, onRefresh }) {
    return React.createElement(
      'div',
      {
        'data-testid': 'reviewer-manage-panel',
        'data-can-manage': String(canManage),
        'data-degraded': degraded ? 'true' : 'false',
        'data-loading': loading ? 'true' : 'false',
      },
      React.createElement('button', { type: 'button', onClick: onRefresh }, 'Mock refresh'),
    );
  };
});

const dashboardProposals = [
  {
    requestId: 'request-a',
    requestNumber: '1001',
    title: 'Active proposal',
    institution: 'North University',
    projectLeader: 'Alex North',
    programDirector: 'Pat Director',
    cycleCode: 'D26',
    canManage: true,
    setAside: false,
  },
  {
    requestId: 'request-b',
    requestNumber: '1002',
    title: 'No accepted reviewers yet',
    institution: 'South University',
    cycleCode: 'D26',
    canManage: true,
    setAside: false,
  },
  {
    requestId: 'request-c',
    requestNumber: '1003',
    title: 'Set aside proposal',
    institution: 'West University',
    cycleCode: 'D26',
    canManage: true,
    setAside: true,
  },
];

const reviewerProposals = [
  {
    proposalId: 'request-a',
    proposalTitle: 'Active proposal',
    reviewDeadline: '2026-09-09',
    reviewers: [
      {
        suggestionId: 'reviewer-1',
        name: 'Ada Reviewer',
        reviewStatus: 'materials_sent',
        effectiveReviewDeadline: '2026-08-31',
      },
      {
        suggestionId: 'reviewer-2',
        name: 'Bea Reviewer',
        reviewStatus: 'review_received',
        reviewReceivedAt: '2026-08-30T10:00:00Z',
        submitted: true,
      },
    ],
  },
  {
    proposalId: 'request-c',
    proposalTitle: 'Set aside proposal',
    reviewers: [
      {
        suggestionId: 'reviewer-3',
        name: 'Casey Reviewer',
        reviewStatus: 'accepted',
      },
    ],
  },
];

describe('reviewer follow-up projection', () => {
  const merged = mergeReviewerFollowUpProposals(dashboardProposals, reviewerProposals);

  test('keeps every assigned request, including one with no accepted reviewers', () => {
    expect(merged).toHaveLength(3);
    expect(merged.find((proposal) => proposal.proposalId === 'request-b')).toMatchObject({
      proposalTitle: 'No accepted reviewers yet',
      reviewers: [],
      proposalInstitution: 'South University',
    });
  });

  test('defines attention from open reviewer engagements, not completed or empty requests', () => {
    expect(proposalNeedsAttention(merged[0])).toBe(true);
    expect(proposalNeedsAttention(merged[1])).toBe(false);
    expect(proposalNeedsAttention({ reviewers: [{ reviewStatus: 'complete' }] })).toBe(false);
  });

  test('filters set-aside requests and searches proposal or reviewer content', () => {
    expect(filterReviewerFollowUpProposals(merged, { view: 'all' })).toHaveLength(2);
    expect(filterReviewerFollowUpProposals(merged, {
      view: 'all',
      includeSetAside: true,
      search: 'casey',
    }).map((proposal) => proposal.proposalId)).toEqual(['request-c']);
    expect(filterReviewerFollowUpProposals(merged, {
      view: 'all',
      search: 'south university',
    }).map((proposal) => proposal.proposalId)).toEqual(['request-b']);
  });

  test('summarizes the visible request population without double-counting status categories', () => {
    expect(summarizeReviewerFollowUp(merged.slice(0, 2), '2026-09-01')).toEqual({
      assignedRequests: 2,
      activeReviewers: 1,
      overdueReviewers: 1,
      reviewsReceived: 1,
      attentionRequests: 1,
    });
  });

  test('only calls an open reviewer overdue when the effective deadline is before today', () => {
    expect(isReviewerOverdue(reviewerProposals[0].reviewers[0], '2026-09-01')).toBe(true);
    expect(isReviewerOverdue({
      reviewStatus: 'materials_sent',
      effectiveReviewDeadline: '2026-09-01',
    }, '2026-09-01')).toBe(false);
    expect(isReviewerOverdue({
      reviewStatus: 'review_received',
      effectiveReviewDeadline: '2026-08-01',
      reviewReceivedAt: '2026-08-02',
    }, '2026-09-01')).toBe(false);
  });
});

describe('reviewer follow-up request scope', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    window.history.replaceState({}, '', '/workbench/reviewer-follow-up');
  });

  test('keeps request scope separate from reviewer-state view and refetches both feeds for All requests', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return {
          ok: true,
          json: async () => ({ cycles: [{ code: 'D26', label: 'December 2026' }], defaultCycleCode: 'D26' }),
        };
      }
      return {
        ok: true,
        json: async () => ({ proposals: [] }),
      };
    });

    render(<ReviewerFollowUpDashboard />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/workbench/dashboard?cycleCode=D26&scope=my'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/review-manager/reviewers?cycleCode=D26&scope=my'));
    });

    expect(screen.getByRole('button', { name: 'My requests' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All reviewers' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'All requests' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/workbench/dashboard?cycleCode=D26&scope=all'));
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/review-manager/reviewers?cycleCode=D26&scope=all'));
    });
    expect(screen.getByRole('button', { name: 'All requests' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'All reviewers' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('uses the server default even when it is not the first cycle, while honoring a valid URL override', async () => {
    const cycleResponse = {
      cycles: [
        { code: 'D26', label: 'December 2026', count: 44, setAsideCount: 6 },
        { code: 'J26', label: 'June 2026', count: 0, setAsideCount: 3 },
      ],
      defaultCycleCode: 'J26',
    };
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => url === '/api/workbench/dashboard' ? cycleResponse : { proposals: [] },
    }));

    const { unmount } = render(<ReviewerFollowUpDashboard />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cycle' })).toHaveValue('J26'));
    expect(screen.getByRole('option', { name: 'December 2026 (44 active + 6 set aside)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'June 2026 (0 active + 3 set aside)' })).toBeInTheDocument();
    unmount();

    window.history.replaceState({}, '', '/workbench/reviewer-follow-up?cycleCode=D26');
    render(<ReviewerFollowUpDashboard />);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Cycle' })).toHaveValue('D26'));
  });

  test('guides an unassigned user to All requests from the initial My requests view', async () => {
    global.fetch = jest.fn(async (url) => ({
      ok: true,
      json: async () => url === '/api/workbench/dashboard'
        ? { cycles: [{ code: 'D26', label: 'December 2026', count: 44, setAsideCount: 0 }], defaultCycleCode: 'D26' }
        : { proposals: [] },
    }));

    render(<ReviewerFollowUpDashboard />);
    expect(await screen.findByText('No requests are assigned to you in this cycle.')).toBeInTheDocument();
    expect(screen.getByText('Select All requests to view the full cycle.')).toBeInTheDocument();
  });

  test('missing canManage projection fails closed in the rendered reviewer controls', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => ({ cycles: [{ code: 'D26', label: 'December 2026', count: 1 }], defaultCycleCode: 'D26' }) };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return {
          ok: true,
          json: async () => ({
            proposals: [{ requestId: 'request-a', requestNumber: '1001', title: 'Foreign request', setAside: false }],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ proposals: [{ proposalId: 'request-a', reviewers: [{ suggestionId: 'reviewer-1', reviewStatus: 'materials_sent' }] }] }),
      };
    });

    render(<ReviewerFollowUpDashboard />);
    expect(await screen.findByText('Foreign request')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show reviewer activity' }));
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-can-manage', 'false');
    expect(screen.queryByRole('button', { name: 'Campaign settings' })).not.toBeInTheDocument();
  });
});

describe('reviewer follow-up refetch resilience', () => {
  const originalFetch = global.fetch;
  const cycleResponse = { cycles: [{ code: 'D26', label: 'December 2026' }], defaultCycleCode: 'D26' };

  afterEach(() => {
    global.fetch = originalFetch;
    window.history.replaceState({}, '', '/workbench/reviewer-follow-up');
  });

  test('initial load failure shows the banner only', async () => {
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        return { ok: false, json: async () => ({ error: 'boom' }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    expect(await screen.findByText('Reviewer follow-up could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.queryByTestId('reviewer-manage-panel')).not.toBeInTheDocument();
    expect(screen.queryByText('No requests are assigned to you in this cycle.')).not.toBeInTheDocument();
    expect(screen.queryByText('No reviewer follow-up needs attention.')).not.toBeInTheDocument();
    expect(screen.queryByText(/No .* requests match this view\./)).not.toBeInTheDocument();
  });

  test('cycles-load failure shows a Try again that reloads cycles, then the proposals load runs (S490)', async () => {
    let cyclesShouldFail = true;
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        if (cyclesShouldFail) return { ok: false, status: 503, json: async () => ({ error: 'cycles down' }) };
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return { ok: true, json: async () => ({ requests: [] }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    expect(await screen.findByText('Reviewer follow-up could not be loaded')).toBeInTheDocument();
    expect(screen.getByText('cycles down')).toBeInTheDocument();
    // Pre-fix: no cycleCode → no button at all, and the proposals effect never ran.
    const retry = screen.getByRole('button', { name: 'Try again' });
    expect(global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/review-manager/reviewers'))).toHaveLength(0);

    cyclesShouldFail = false;
    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByText('Reviewer follow-up could not be loaded')).not.toBeInTheDocument());
    await waitFor(() => expect(
      global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/review-manager/reviewers')),
    ).toHaveLength(1));
    expect(screen.getByRole('combobox', { name: /cycle/i })).toHaveValue('D26');
  });

  test('refetch failure keeps the list and degrades the panel', async () => {
    let reviewersShouldFail = false;
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (reviewersShouldFail) {
          return { ok: false, json: async () => ({ error: 'network blip' }) };
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    expect(await screen.findByText('Active proposal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show reviewer activity' }));
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'false');

    reviewersShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mock refresh' }));

    expect(await screen.findByText('Reviewer follow-up could not be refreshed')).toBeInTheDocument();
    expect(screen.getByText('Showing the last loaded results. Retry before making changes.')).toBeInTheDocument();
    expect(screen.getByText('Active proposal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide reviewer activity' })).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'true');
  });

  test('retry success clears the degraded state', async () => {
    let reviewersShouldFail = false;
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (reviewersShouldFail) {
          return { ok: false, json: async () => ({ error: 'network blip' }) };
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    expect(await screen.findByText('Active proposal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show reviewer activity' }));
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'false');

    reviewersShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mock refresh' }));
    expect(await screen.findByText('Reviewer follow-up could not be refreshed')).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'true');

    reviewersShouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Active proposal')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Reviewer follow-up could not be refreshed')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'false');
  });

  test('a scope change clears the previous last-known-good data on failure', async () => {
    let proposalsShouldFail = false;
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        if (proposalsShouldFail) {
          return { ok: false, json: async () => ({ error: 'boom' }) };
        }
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (proposalsShouldFail) {
          return { ok: false, json: async () => ({ error: 'boom' }) };
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    expect(await screen.findByText('Active proposal')).toBeInTheDocument();

    proposalsShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'All requests' }));

    expect(await screen.findByText('Reviewer follow-up could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Reviewer follow-up could not be refreshed')).not.toBeInTheDocument();
    expect(screen.queryByText('Active proposal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reviewer-manage-panel')).not.toBeInTheDocument();
  });

  test('a superseded load cannot repopulate the list after a scope change', async () => {
    let resolveStaleReviewers;
    const staleReviewersPromise = new Promise((resolve) => { resolveStaleReviewers = resolve; });
    let refreshTriggered = false;
    let newScopeShouldFail = false;

    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      const isAllScope = String(url).includes('scope=all');
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        if (isAllScope && newScopeShouldFail) {
          return { ok: false, json: async () => ({ error: 'boom' }) };
        }
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (isAllScope) {
          if (newScopeShouldFail) {
            return { ok: false, json: async () => ({ error: 'boom' }) };
          }
          return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
        }
        if (refreshTriggered) {
          await staleReviewersPromise;
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);
    expect(await screen.findByText('Active proposal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show reviewer activity' }));

    refreshTriggered = true;
    newScopeShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mock refresh' }));

    fireEvent.click(screen.getByRole('button', { name: 'All requests' }));

    // Resolve the superseded (stale) same-params fetch with the ORIGINAL fixtures
    // after the scope change has already cleared the list and bumped requestIdRef.
    resolveStaleReviewers();

    expect(await screen.findByText('Reviewer follow-up could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Reviewer follow-up could not be refreshed')).not.toBeInTheDocument();
    expect(screen.queryByText('Active proposal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reviewer-manage-panel')).not.toBeInTheDocument();
  });

  test('retry keeps the group mounted and disables Try again while pending', async () => {
    let reviewersMode = 'ok';
    let pendingReject = null;

    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (reviewersMode === 'fail') {
          return { ok: false, json: async () => ({ error: 'network blip' }) };
        }
        if (reviewersMode === 'pending') {
          return new Promise((_resolve, reject) => { pendingReject = reject; });
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);
    expect(await screen.findByText('Active proposal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show reviewer activity' }));

    reviewersMode = 'fail';
    fireEvent.click(screen.getByRole('button', { name: 'Mock refresh' }));
    expect(await screen.findByText('Reviewer follow-up could not be refreshed')).toBeInTheDocument();

    reviewersMode = 'pending';
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: 'Retrying…' })).toBeDisabled();
    expect(screen.getByTestId('reviewer-manage-panel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide reviewer activity' })).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-loading', 'true');

    pendingReject(new Error('still broken'));

    expect(await screen.findByText('still broken')).toBeInTheDocument();
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-degraded', 'true');
    expect(screen.getByTestId('reviewer-manage-panel')).toHaveAttribute('data-loading', 'false');
    expect(screen.getByRole('button', { name: 'Hide reviewer activity' })).toBeInTheDocument();
  });

  test('a mismatched filter renders under a refresh-failure banner', async () => {
    let reviewersShouldFail = false;
    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (reviewersShouldFail) {
          return { ok: false, json: async () => ({ error: 'network blip' }) };
        }
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);
    expect(await screen.findByText('Active proposal')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'All reviewers' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Show reviewer activity' })[0]);

    reviewersShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Mock refresh' }));
    expect(await screen.findByText('Reviewer follow-up could not be refreshed')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search requests and reviewers'), {
      target: { value: 'no such reviewer or institution' },
    });

    expect(screen.queryByText('Active proposal')).not.toBeInTheDocument();
    expect(screen.getByText('No assigned requests match this view.')).toBeInTheDocument();
    expect(screen.getByText('Reviewer follow-up could not be refreshed')).toBeInTheDocument();
  });

  test('an initial load in flight cannot commit under a different scope', async () => {
    let resolveInitialReviewers;
    const initialReviewersPromise = new Promise((resolve) => { resolveInitialReviewers = resolve; });
    let allScopeShouldFail = false;

    global.fetch = jest.fn(async (url) => {
      if (url === '/api/workbench/dashboard') {
        return { ok: true, json: async () => cycleResponse };
      }
      const isAllScope = String(url).includes('scope=all');
      if (String(url).startsWith('/api/workbench/dashboard?')) {
        if (isAllScope && allScopeShouldFail) {
          return { ok: false, json: async () => ({ error: 'boom' }) };
        }
        return { ok: true, json: async () => ({ proposals: dashboardProposals }) };
      }
      if (String(url).startsWith('/api/review-manager/reviewers')) {
        if (isAllScope) {
          if (allScopeShouldFail) {
            return { ok: false, json: async () => ({ error: 'boom' }) };
          }
          return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
        }
        await initialReviewersPromise;
        return { ok: true, json: async () => ({ proposals: reviewerProposals }) };
      }
      return { ok: true, json: async () => ({ proposals: [] }) };
    });

    render(<ReviewerFollowUpDashboard />);

    // Mandatory gate: the initial my-scope reviewers fetch must actually be in
    // flight before we toggle scope, or the effect's cleanup would simply
    // clear the still-pending setTimeout and this would pass trivially.
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('scope=my'));
    });

    allScopeShouldFail = true;
    fireEvent.click(screen.getByRole('button', { name: 'All requests' }));

    // Resolve the superseded initial load's fetch with the ORIGINAL fixtures
    // after the scope change already bumped requestIdRef.
    resolveInitialReviewers();

    expect(await screen.findByText('Reviewer follow-up could not be loaded')).toBeInTheDocument();
    expect(screen.queryByText('Active proposal')).not.toBeInTheDocument();
  });
});

describe('reviewer follow-up preview safety', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalDynamicsUrl = process.env.DYNAMICS_URL;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalDynamicsUrl === undefined) delete process.env.DYNAMICS_URL;
    else process.env.DYNAMICS_URL = originalDynamicsUrl;
  });

  test('makes a Preview backed by production Dataverse read-only', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;

    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: true },
    });
  });

  test('does not suppress controls for sandbox Preview or production deployment', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DYNAMICS_URL = `https://${SANDBOX_HOSTS[0]}`;
    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: false },
    });

    process.env.VERCEL_ENV = 'production';
    process.env.DYNAMICS_URL = `https://${PRODUCTION_HOSTS[0]}`;
    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: false },
    });
  });

  test('fails closed when a Preview target is unknown', async () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.DYNAMICS_URL = 'https://unregistered-target.example';

    await expect(getServerSideProps()).resolves.toEqual({
      props: { previewReadOnly: true },
    });
  });
});
