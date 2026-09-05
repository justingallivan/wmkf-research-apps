/**
 * @jest-environment jsdom
 *
 * Stage 0 baseline: exercise the actual status handler through the rendered
 * ManagePanel. Tests named KNOWN DEFECT pin current behavior until Stage 1E/6B
 * deliberately replace it; they do not assert the desired fixed behavior.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

const reviewer = {
  suggestionId: '11111111-1111-4111-8111-111111111111',
  name: 'Dr. Baseline Reviewer',
  reviewStatus: 'materials_sent',
  tokenState: 'active',
};
const proposal = { proposalId: '22222222-2222-4222-8222-222222222222' };
let statusFetch;
const originalFetch = global.fetch;

function changeStatus() {
  fireEvent.click(screen.getByRole('button', { name: 'Manage Dr. Baseline Reviewer' }));
  fireEvent.change(screen.getByLabelText('Correct status for Dr. Baseline Reviewer'), {
    target: { value: 'under_review' },
  });
}

beforeEach(() => {
  statusFetch = jest.fn();
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/reviewers') return statusFetch(url, options);
    // The mounted materials modal has two independent read-only loaders.
    if (url === '/api/review-manager/release-settings' || url.startsWith('/api/review-manager/materials-preflight?')) {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    throw new Error(`Unexpected UI request: ${url}`);
  });
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('Stage 0 status mutation outcome baseline', () => {
  test.each([
    [403, { error: 'Forbidden' }],
    [500, { error: 'Persistence failed' }],
    [200, { success: false, error: 'Rejected' }],
  ])('KNOWN DEFECT F5: HTTP %i / rejected payload still refreshes with no failure notice', async (status, body) => {
    const json = jest.fn(async () => body);
    statusFetch.mockResolvedValue({ ok: status < 400, status, json });
    const onRefresh = jest.fn();
    render(<ReviewerManagePanel proposal={proposal} reviewers={[reviewer]} mode="track" onRefresh={onRefresh} />);

    changeStatus();
    await act(async () => {});

    expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/reviewers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: reviewer.suggestionId, reviewStatus: 'under_review' }),
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(json).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('KNOWN DEFECT F5: rejected fetch only logs and gives no user-visible failure', async () => {
    const failure = new Error('offline');
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    statusFetch.mockRejectedValue(failure);
    const onRefresh = jest.fn();
    render(<ReviewerManagePanel proposal={proposal} reviewers={[reviewer]} mode="track" onRefresh={onRefresh} />);

    changeStatus();
    await act(async () => {});

    expect(onRefresh).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('Failed to update status:', failure);
    expect(window.alert).not.toHaveBeenCalled();
  });

  test.each(['request-switch', 'unmount'])('KNOWN DEFECT async baseline: pending status success invokes the old refresh after %s', async (change) => {
    let resolveFetch;
    statusFetch.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const oldRefresh = jest.fn();
    const newRefresh = jest.fn();
    const view = render(<ReviewerManagePanel proposal={proposal} reviewers={[reviewer]} mode="track" onRefresh={oldRefresh} />);
    changeStatus();
    expect(oldRefresh).not.toHaveBeenCalled();

    if (change === 'unmount') view.unmount();
    else view.rerender(<ReviewerManagePanel proposal={{ proposalId: 'another-request' }} reviewers={[]} mode="track" onRefresh={newRefresh} />);
    await act(async () => resolveFetch({ ok: true, json: async () => ({ success: true }) }));

    expect(oldRefresh).toHaveBeenCalledTimes(1);
    expect(newRefresh).not.toHaveBeenCalled();
  });

  test.each(['request-switch', 'unmount'])('pending status failure after %s still logs without refreshing either context', async (change) => {
    let rejectFetch;
    const failure = new Error('late network failure');
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    statusFetch.mockImplementation(() => new Promise((_resolve, reject) => { rejectFetch = reject; }));
    const oldRefresh = jest.fn();
    const newRefresh = jest.fn();
    const view = render(<ReviewerManagePanel proposal={proposal} reviewers={[reviewer]} mode="track" onRefresh={oldRefresh} />);
    changeStatus();

    if (change === 'unmount') view.unmount();
    else view.rerender(<ReviewerManagePanel proposal={{ proposalId: 'another-request' }} reviewers={[]} mode="track" onRefresh={newRefresh} />);
    await act(async () => rejectFetch(failure));

    expect(errorLog).toHaveBeenCalledWith('Failed to update status:', failure);
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });
});
