/**
 * @jest-environment jsdom
 *
 * T4 matrix for ReviewerInvitePanel's removeCandidate (DELETE) and
 * restoreCandidate (PATCH) sites against /api/reviewer-finder/my-candidates.
 * No prior test rendered the panel to exercise these two call sites
 * directly (Stage 4, CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md).
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/InviteEmailModal', () => function InviteEmailModal() {
  return null;
});

const candidate = {
  suggestionId: 'S1',
  name: 'Dr. Test Reviewer',
  email: 'reviewer@example.org',
  invited: false,
  accepted: false,
  declined: false,
};
const removedCandidate = { suggestionId: 'S2', name: 'Dr. Test Reviewer', declined: false };

function vipFlagsResponse() {
  return { ok: true, status: 200, json: async () => ({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }) };
}

function clickRemove(name = 'Dr. Test Reviewer') {
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
  fireEvent.click(screen.getByRole('menuitem', { name: /Remove from this proposal/ }));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});

describe('removeCandidate', () => {
  function mockFetch(deleteHandler) {
    return jest.fn((url, options) => {
      if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) return Promise.resolve(vipFlagsResponse());
      if (url === '/api/reviewer-finder/my-candidates' && options?.method === 'DELETE') return deleteHandler(url, options);
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  test('T4 request bytes: DELETE sends exact method, headers, and body; success refreshes', async () => {
    const onRefresh = jest.fn();
    global.fetch = mockFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[candidate]} removedCandidates={[]} onRefresh={onRefresh} />);
    clickRemove();
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const [, init] = global.fetch.mock.calls.find(([u, o]) => u === '/api/reviewer-finder/my-candidates' && o?.method === 'DELETE');
    expect(init).toEqual({
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: 'S1' }),
    });
  });

  test('declining the confirm dialog never dispatches a request', async () => {
    window.confirm.mockReturnValue(false);
    global.fetch = mockFetch(() => Promise.reject(new Error('should not be called')));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[candidate]} removedCandidates={[]} onRefresh={jest.fn()} />);
    clickRemove();
    await Promise.resolve();
    expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false);
  });

  test('T4 axis (b): a non-2xx body surfaces its error verbatim', async () => {
    global.fetch = mockFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'remove blew up' }) }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[candidate]} removedCandidates={[]} onRefresh={jest.fn()} />);
    clickRemove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not remove candidate: remove blew up'));
  });

  test('T4 axis (c): a network rejection surfaces its message', async () => {
    global.fetch = mockFetch(() => Promise.reject(new Error('offline')));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[candidate]} removedCandidates={[]} onRefresh={jest.fn()} />);
    clickRemove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Network error removing candidate: offline'));
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the status, never silently', async () => {
    global.fetch = mockFetch(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[candidate]} removedCandidates={[]} onRefresh={jest.fn()} />);
    clickRemove();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not remove candidate: 502'));
  });
});

describe('restoreCandidate', () => {
  function mockFetch(patchHandler) {
    return jest.fn((url, options) => {
      if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) return Promise.resolve(vipFlagsResponse());
      if (url === '/api/reviewer-finder/my-candidates' && options?.method === 'PATCH') return patchHandler(url, options);
      throw new Error(`Unexpected fetch: ${url}`);
    });
  }

  test('T4 request bytes: PATCH sends exact method, headers, and body; success refreshes', async () => {
    const onRefresh = jest.fn();
    global.fetch = mockFetch(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[]} removedCandidates={[removedCandidate]} onRefresh={onRefresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const [, init] = global.fetch.mock.calls.find(([u, o]) => u === '/api/reviewer-finder/my-candidates' && o?.method === 'PATCH');
    expect(init).toEqual({
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: 'S2', restore: true }),
    });
  });

  test('T4 axis (b): a non-2xx body surfaces its error verbatim', async () => {
    global.fetch = mockFetch(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'restore blew up' }) }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[]} removedCandidates={[removedCandidate]} onRefresh={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not restore candidate: restore blew up'));
  });

  test('T4 axis (c): a network rejection surfaces its message', async () => {
    global.fetch = mockFetch(() => Promise.reject(new Error('offline')));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[]} removedCandidates={[removedCandidate]} onRefresh={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Network error restoring candidate: offline'));
  });

  test('T4 axis (e): a non-2xx body that fails to parse falls back to the status, never silently', async () => {
    global.fetch = mockFetch(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad gateway html'); } }));
    render(<ReviewerInvitePanel requestId="REQ-1" candidates={[]} removedCandidates={[removedCandidate]} onRefresh={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('Could not restore candidate: 502'));
  });
});
