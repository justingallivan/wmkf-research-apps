/**
 * @jest-environment jsdom
 *
 * Stage 6B1: bind handleRegenerateToken, handleRevokeToken, handleRemoveReviewer
 * and transitionTerminal's outcomes (alerts, prompt, clipboard, onRefresh) to
 * the UI context that started them. Mirrors
 * reviewer-status-mutation-characterization.test.js's fixture pattern: real
 * ReviewerManagePanel, real TokenActionsMenu, isolated deferred transport.
 */
import { StrictMode } from 'react';
import { flushSync } from 'react-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

const reviewer = {
  suggestionId: 'aabbccdd-1111-4111-8111-111111111111',
  name: 'Dr. Baseline Reviewer',
  email: 'reviewer@example.org',
  reviewStatus: 'materials_sent', // in TERMINAL_SOURCE_STATUSES, canTransitionToTerminal() === true
  tokenState: 'active',
  responseType: 'accepted',
};
const otherReviewer = { ...reviewer, suggestionId: '33333333-3333-4333-8333-333333333333', name: 'Dr. Other Reviewer' };
const proposal = { proposalId: '22222222-2222-4222-8222-222222222222', proposalTitle: 'Action lifetime test request' };
const REGEN_URL = 'https://example.org/r/abc';
const originalFetch = global.fetch;

let regenerateFetch;
let revokeFetch;
let removeFetch;
let terminalFetch;
let originalClipboard;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(body = {}, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body) };
}

function openMenu(row = reviewer) {
  fireEvent.click(screen.getByRole('button', { name: `Manage ${row.name || 'reviewer'}` }));
}
function clickItem(text) {
  fireEvent.click(screen.getByText(text));
}
function regenerate(row = reviewer) {
  openMenu(row);
  clickItem(row.tokenState === 'not_minted' ? 'Generate link & copy' : 'Regenerate link & copy');
}
function revoke(row = reviewer) {
  openMenu(row);
  clickItem('Revoke link');
}
function remove(row = reviewer) {
  openMenu(row);
  clickItem('Remove from this request');
}
function withdraw(row = reviewer) {
  openMenu(row);
  clickItem('Record reviewer withdrawal');
}
function release(row = reviewer) {
  openMenu(row);
  clickItem('Release from assignment');
}

const contextChanges = ['request switch', 'request away and back', 'mode away and back', 'row disappears and returns', 'management permission away and back', 'read-only away and back', 'unmount'];

function invalidate(view, change) {
  if (change === 'unmount') view.unmount();
  else if (change.startsWith('request')) {
    view.update({ proposal: { ...proposal, proposalId: 'another-request' } });
    if (change === 'request away and back') view.update({ proposal: { ...proposal } });
  } else if (change === 'mode away and back') {
    view.update({ mode: 'all' });
    view.update({ mode: 'track' });
  } else if (change === 'row disappears and returns') {
    view.update({ reviewers: [] });
    view.update({ reviewers: [{ ...reviewer }] });
  } else if (change === 'management permission away and back') {
    view.update({ canManage: false });
    view.update({ canManage: true });
  } else {
    view.update({ previewReadOnly: true });
    view.update({ previewReadOnly: false });
  }
}

beforeEach(() => {
  regenerateFetch = jest.fn(() => { throw new Error('Unconfigured regenerate-token POST'); });
  revokeFetch = jest.fn(() => { throw new Error('Unconfigured revoke-token POST'); });
  removeFetch = jest.fn(() => { throw new Error('Unconfigured my-candidates DELETE'); });
  terminalFetch = jest.fn(() => { throw new Error('Unconfigured terminal-transition POST'); });
  global.fetch = jest.fn((url, options) => {
    const method = options?.method;
    if (url === '/api/review-manager/regenerate-token' && method === 'POST') return regenerateFetch(url, options);
    if (url === '/api/review-manager/revoke-token' && method === 'POST') return revokeFetch(url, options);
    if (url === '/api/reviewer-finder/my-candidates' && method === 'DELETE') return removeFetch(url, options);
    if (url === '/api/review-manager/terminal-transition' && method === 'POST') return terminalFetch(url, options);
    if (url === '/api/review-manager/release-settings') return Promise.resolve(response({ attachProposalEmail: false }));
    if (url.startsWith('/api/review-manager/materials-preflight?')) return Promise.resolve(response({ ok: true, fileCount: 1 }));
    if (url.startsWith('/api/user-preferences')) return Promise.resolve(response({}));
    if (url === '/api/review-manager/render-emails') return Promise.resolve(response({ drafts: [] }));
    throw new Error(`Unexpected UI request: ${url}`);
  });
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: jest.fn(() => Promise.resolve()) },
    configurable: true,
  });
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  jest.spyOn(window, 'prompt').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete navigator.clipboard;
  jest.restoreAllMocks();
});

// Per-action descriptors used by the generic matrices below.
const actionDefs = [
  {
    kind: 'regenerate',
    trigger: regenerate,
    needsConfirm: false,
    fetchMock: () => regenerateFetch,
    endpointBody: (row = reviewer) => JSON.stringify({ suggestionId: row.suggestionId }),
    successResponse: () => response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' }),
    failureResponse: () => response({ ok: false, reason: 'boom' }, 200),
    failureAlertRe: /Could not generate a new link: boom/,
    networkAlertRe: /Network error generating link: offline/,
    refreshFailAlertRe: /link was generated, but the reviewer list could not be refreshed/,
  },
  {
    kind: 'revoke',
    trigger: revoke,
    needsConfirm: true,
    fetchMock: () => revokeFetch,
    endpointBody: (row = reviewer) => JSON.stringify({ suggestionId: row.suggestionId }),
    successResponse: () => response({ ok: true }),
    failureResponse: () => response({ ok: false, reason: 'boom' }, 200),
    failureAlertRe: /Revoke failed: boom/,
    networkAlertRe: /Network error: offline/,
    refreshFailAlertRe: /link was revoked, but the reviewer list could not be refreshed/,
  },
  {
    kind: 'remove',
    trigger: remove,
    needsConfirm: true,
    fetchMock: () => removeFetch,
    endpointBody: (row = reviewer) => JSON.stringify({ suggestionId: row.suggestionId }),
    successResponse: () => response({}),
    failureResponse: () => response({ error: 'boom' }, 500),
    failureAlertRe: /Could not remove the reviewer: boom/,
    networkAlertRe: /Network error removing reviewer: offline/,
    refreshFailAlertRe: /reviewer was removed, but the reviewer list could not be refreshed/,
  },
  {
    kind: 'terminal',
    trigger: withdraw,
    needsConfirm: true,
    fetchMock: () => terminalFetch,
    endpointBody: (row = reviewer) => JSON.stringify({ requestId: proposal.proposalId, suggestionIds: [row.suggestionId], terminalStatus: 'withdrew' }),
    successResponse: () => response({ transitioned: 1 }),
    failureResponse: () => response({ transitioned: 0, results: [{ status: 'write_failed' }] }, 409),
    failureAlertRe: /Could not end the engagement: write_failed\. Reload and try again\./,
    networkAlertRe: /Network error ending engagement: offline/,
    refreshFailAlertRe: /engagement change was recorded, but the reviewer list could not be refreshed/,
  },
];

describe.each([false, true])('Stage 6B1 action lifetimes (StrictMode: %s)', (strict) => {
  function renderPanel(overrides = {}) {
    let props = { proposal, reviewers: [reviewer], mode: 'track', onRefresh: jest.fn(), ...overrides };
    const element = () => strict ? <StrictMode><ReviewerManagePanel {...props} /></StrictMode> : <ReviewerManagePanel {...props} />;
    const view = render(element());
    return { ...view, update: (patch) => { props = { ...props, ...patch }; view.rerender(element()); } };
  }

  describe.each(actionDefs)('$kind', (def) => {
    test('current success dispatches the existing request/success predicate and refreshes once', async () => {
      def.fetchMock().mockResolvedValue(def.successResponse());
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
      expect(def.fetchMock().mock.calls[0][1].body).toBe(def.endpointBody());
      expect(onRefresh.mock.calls).toEqual([[]]);
      if (def.kind === 'regenerate') {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(REGEN_URL);
        expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Link copied to clipboard'));
      } else {
        expect(window.alert).not.toHaveBeenCalled();
      }
    });

    test('current HTTP/payload failure preserves the existing alert text and never refreshes', async () => {
      def.fetchMock().mockResolvedValue(def.failureResponse());
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      expect(window.alert.mock.calls[0][0]).toMatch(def.failureAlertRe);
      expect(onRefresh).not.toHaveBeenCalled();
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
    });

    test('current network rejection reports the existing network-error alert and never refreshes', async () => {
      def.fetchMock().mockRejectedValue(new Error('offline'));
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      expect(window.alert.mock.calls[0][0]).toMatch(def.networkAlertRe);
      expect(onRefresh).not.toHaveBeenCalled();
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
    });

    if (def.needsConfirm) {
      test('declining the confirm dialog never dispatches a request', async () => {
        window.confirm.mockReturnValue(false);
        renderPanel();
        def.trigger();
        await act(async () => {});
        expect(def.fetchMock()).not.toHaveBeenCalled();
      });

      test('confirm returning true after context was invalidated inside the mock never dispatches a request', async () => {
        const view = renderPanel();
        // Leave the row genuinely absent (not restored) when confirm() returns,
        // so beginAttempt's currentness gate — checked at that exact moment —
        // must see it gone and refuse to dispatch.
        window.confirm.mockImplementation(() => {
          // window.confirm blocks synchronously in a real browser; force an
          // immediate commit here (bypassing React's automatic event-handler
          // batching) so the invalidated context is actually in place by the
          // time confirm() returns and beginAttempt reads it.
          flushSync(() => { view.update({ reviewers: [] }); });
          return true;
        });
        def.trigger();
        await act(async () => {});
        expect(def.fetchMock()).not.toHaveBeenCalled();
      });
    }

    test.each(contextChanges.flatMap(change => ([
      { change, name: 'success', settle: (job) => job.resolve(def.successResponse()) },
      { change, name: 'failure', settle: (job) => job.resolve(def.failureResponse()) },
      { change, name: 'network rejection', settle: (job) => job.reject(new Error('late offline')) },
    ])))('pending fetch $name after $change never alerts, copies or refreshes any context', async ({ change, settle }) => {
      const job = deferred();
      def.fetchMock().mockReturnValue(job.promise);
      const oldRefresh = jest.fn();
      const newRefresh = jest.fn();
      const view = renderPanel({ onRefresh: oldRefresh });
      def.trigger();
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
      invalidate(view, change);
      if (change !== 'unmount') view.update({ onRefresh: newRefresh });
      await act(async () => settle(job));
      expect(window.alert).not.toHaveBeenCalled();
      if (def.kind === 'regenerate') expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(oldRefresh).not.toHaveBeenCalled();
      expect(newRefresh).not.toHaveBeenCalled();
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
    });

    test('pending fetch settling after a realistic request switch (a new request supplies its own distinct reviewer rows) never alerts or refreshes', async () => {
      // The generic 'request switch' in `contextChanges` only changes
      // proposalId while leaving the same `reviewers` array in place, which a
      // real host navigation would not do — switching requests replaces the
      // reviewer rows too. This is the case that actually requires the
      // committed epoch/requestId check independently of row presence: here
      // the OLD suggestionId is simply absent from the NEW request's rows,
      // but a same-suggestionId row could coincidentally reappear under an
      // unrelated request without epoch/requestId binding to catch it.
      const job = deferred();
      def.fetchMock().mockReturnValue(job.promise);
      const onRefresh = jest.fn();
      const view = renderPanel({ onRefresh });
      def.trigger();
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
      view.update({
        proposal: { ...proposal, proposalId: 'another-request' },
        reviewers: [{ ...reviewer, name: 'Coincidental same-ID row under another request' }],
      });
      await act(async () => job.resolve(def.successResponse()));
      expect(window.alert).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    test.each(['request switch', 'row disappears and returns', 'unmount'])('pending JSON after %s never alerts, copies or refreshes any context', async (change) => {
      const jsonJob = deferred();
      const json = jest.fn(() => jsonJob.promise);
      // "remove" only reads JSON on its failure branch; force that branch by
      // making the resolved response non-ok for that action alone, from the
      // start (its success branch never calls .json() at all).
      def.fetchMock().mockResolvedValue(def.kind === 'remove'
        ? { ok: false, status: 500, json }
        : { ok: true, status: 200, json });
      const onRefresh = jest.fn();
      const view = renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      invalidate(view, change);
      await act(async () => jsonJob.resolve(def.kind === 'regenerate' || def.kind === 'revoke'
        ? { ok: true }
        : def.kind === 'terminal' ? { transitioned: 1 } : { error: 'late' }));
      expect(window.alert).not.toHaveBeenCalled();
      if (def.kind === 'regenerate') expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
      if (change !== 'unmount') expect(def.fetchMock()).toHaveBeenCalledTimes(1);
    });

    test.each(['throw', 'reject'])('onRefresh %s after success reports a distinct refresh-failure, never the network-error alert', async (kind) => {
      def.fetchMock().mockResolvedValue(def.successResponse());
      const onRefresh = jest.fn(() => {
        if (kind === 'throw') throw new Error('refresh failed');
        return Promise.reject(new Error('refresh failed'));
      });
      renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      expect(onRefresh.mock.calls).toEqual([[]]);
      const alerts = window.alert.mock.calls.map(c => c[0]);
      expect(alerts.some(m => def.refreshFailAlertRe.test(m))).toBe(true);
      expect(alerts.some(m => def.networkAlertRe.test(m))).toBe(false);
      expect(alerts.some(m => def.failureAlertRe.test(m))).toBe(false);
    });

    test('onRefresh void return follows the normal success path with no extra alert', async () => {
      def.fetchMock().mockResolvedValue(def.successResponse());
      const onRefresh = jest.fn(() => undefined);
      renderPanel({ onRefresh });
      def.trigger();
      await act(async () => {});
      expect(onRefresh.mock.calls).toEqual([[]]);
      const alerts = window.alert.mock.calls.map(c => c[0]);
      expect(alerts.some(m => def.refreshFailAlertRe.test(m))).toBe(false);
    });

    test('same-context row-object and onRefresh-identity churn mid-flight still completes and calls only the newest onRefresh', async () => {
      const job = deferred();
      def.fetchMock().mockReturnValue(job.promise);
      const oldRefresh = jest.fn();
      const newRefresh = jest.fn();
      const view = renderPanel({ onRefresh: oldRefresh });
      def.trigger();
      view.update({ proposal: { ...proposal }, reviewers: [{ ...reviewer }], onRefresh: newRefresh });
      await act(async () => job.resolve(def.successResponse()));
      expect(oldRefresh).not.toHaveBeenCalled();
      expect(newRefresh.mock.calls).toEqual([[]]);
      expect(def.fetchMock()).toHaveBeenCalledTimes(1);
    });

    test('a superseding second invocation for the same action+row owns feedback; the older produces none', async () => {
      const first = deferred();
      const second = deferred();
      def.fetchMock().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      def.trigger();
      def.trigger();
      expect(def.fetchMock()).toHaveBeenCalledTimes(2);
      await act(async () => second.resolve(def.successResponse()));
      expect(onRefresh.mock.calls).toEqual([[]]);
      await act(async () => first.resolve(def.successResponse()));
      // The older attempt's completion must not produce a second refresh or
      // any feedback of its own.
      expect(onRefresh.mock.calls).toEqual([[]]);
      if (def.kind === 'regenerate') expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
  });

  test('different reviewers are independent: one pending regenerate does not affect the other row', async () => {
    const first = deferred();
    const second = deferred();
    regenerateFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onRefresh = jest.fn();
    renderPanel({ reviewers: [reviewer, otherReviewer], onRefresh });
    regenerate();
    regenerate(otherReviewer);
    expect(regenerateFetch).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(response({ ok: false, reason: 'other row conflict' })));
    expect(window.alert.mock.calls[0][0]).toMatch(/other row conflict/);
    window.alert.mockClear();
    await act(async () => first.resolve(response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' })));
    expect(onRefresh.mock.calls).toEqual([[]]);
  });

  test('regenerate vs revoke on the same row are independent generations', async () => {
    const regenJob = deferred();
    const revokeJob = deferred();
    regenerateFetch.mockReturnValue(regenJob.promise);
    revokeFetch.mockReturnValue(revokeJob.promise);
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    regenerate();
    revoke();
    expect(regenerateFetch).toHaveBeenCalledTimes(1);
    expect(revokeFetch).toHaveBeenCalledTimes(1);
    await act(async () => revokeJob.resolve(response({ ok: true })));
    expect(onRefresh.mock.calls).toEqual([[]]);
    await act(async () => regenJob.resolve(response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' })));
    expect(onRefresh.mock.calls).toEqual([[], []]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(REGEN_URL);
  });

  test('a pending 6B1 action does not disturb another row\'s status pending state or selection', async () => {
    const accepted = { ...reviewer, reviewStatus: 'accepted' };
    const revokeJob = deferred();
    revokeFetch.mockReturnValue(revokeJob.promise);
    renderPanel({ reviewers: [accepted, otherReviewer] });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    revoke(otherReviewer);
    expect(revokeFetch).toHaveBeenCalledTimes(1);
    // Selection on the unrelated accepted row must be untouched by the
    // pending revoke on a different row.
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    await act(async () => revokeJob.resolve(response({ ok: true })));
  });

  describe('regenerate clipboard', () => {
    test('clipboard resolve while current shows the expiry alert', async () => {
      regenerateFetch.mockResolvedValue(response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' }));
      navigator.clipboard.writeText.mockResolvedValue(undefined);
      renderPanel();
      regenerate();
      await act(async () => {});
      expect(window.alert.mock.calls[0][0]).toContain('Link copied to clipboard');
      expect(window.prompt).not.toHaveBeenCalled();
    });

    test('clipboard reject while current falls back to the manual-copy prompt with the URL', async () => {
      regenerateFetch.mockResolvedValue(response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' }));
      navigator.clipboard.writeText.mockRejectedValue(new Error('insecure context'));
      renderPanel();
      regenerate();
      await act(async () => {});
      expect(window.prompt).toHaveBeenCalledWith('Reviewer link (copy manually):', REGEN_URL);
      expect(window.alert).not.toHaveBeenCalled();
    });

    test('context lost while clipboard is pending suppresses alert, prompt and refresh (copy may still land)', async () => {
      regenerateFetch.mockResolvedValue(response({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' }));
      const clipJob = deferred();
      navigator.clipboard.writeText.mockReturnValue(clipJob.promise);
      const onRefresh = jest.fn();
      const view = renderPanel({ onRefresh });
      regenerate();
      await act(async () => {});
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(REGEN_URL);
      invalidate(view, 'row disappears and returns');
      await act(async () => clipJob.resolve());
      expect(window.alert).not.toHaveBeenCalled();
      expect(window.prompt).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    test('context lost before clipboard starts (during pending JSON) means writeText is never called', async () => {
      const jsonJob = deferred();
      regenerateFetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn(() => jsonJob.promise) });
      const view = renderPanel();
      regenerate();
      invalidate(view, 'row disappears and returns');
      await act(async () => jsonJob.resolve({ ok: true, url: REGEN_URL, expiresAt: '2027-01-01T00:00:00Z' }));
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalled();
      expect(window.prompt).not.toHaveBeenCalled();
    });
  });

  describe('terminal transition specifics', () => {
    test('withdrew and released share one generation for the same row: a later release invalidates a pending withdrawal', async () => {
      const withdrawJob = deferred();
      const releaseJob = deferred();
      terminalFetch.mockReturnValueOnce(withdrawJob.promise).mockReturnValueOnce(releaseJob.promise);
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      withdraw();
      release();
      expect(terminalFetch).toHaveBeenCalledTimes(2);
      await act(async () => withdrawJob.resolve(response({ transitioned: 1 })));
      // The superseded withdrawal must produce no feedback of its own.
      expect(onRefresh).not.toHaveBeenCalled();
      await act(async () => releaseJob.resolve(response({ transitioned: 1 })));
      expect(onRefresh.mock.calls).toEqual([[]]);
    });

    test('payload requestId is the request captured at click time, not a later live proposal prop', async () => {
      const job = deferred();
      terminalFetch.mockReturnValue(job.promise);
      const view = renderPanel();
      withdraw();
      expect(JSON.parse(terminalFetch.mock.calls[0][1].body).requestId).toBe(proposal.proposalId);
      // Switching the request after dispatch must not alter the in-flight
      // payload and must suppress feedback for the now-invalid attempt.
      view.update({ proposal: { ...proposal, proposalId: 'a-different-request' } });
      await act(async () => job.resolve(response({ transitioned: 1 })));
      expect(window.alert).not.toHaveBeenCalled();
    });

    test('HTTP failure with a write_failed result reports it without replay', async () => {
      terminalFetch.mockResolvedValue(response({ transitioned: 0, results: [{ status: 'write_failed' }] }, 409));
      const onRefresh = jest.fn();
      renderPanel({ onRefresh });
      withdraw();
      await act(async () => {});
      expect(window.alert.mock.calls[0][0]).toMatch(/write_failed/);
      expect(onRefresh).not.toHaveBeenCalled();
      expect(terminalFetch).toHaveBeenCalledTimes(1);
    });
  });
});
