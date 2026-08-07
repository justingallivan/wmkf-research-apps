/**
 * @jest-environment jsdom
 *
 * ReviewerManagePanel EmailModal preview-failure Retry, single-flight, and
 * modal-session epoch (Plan v3, S404 —
 * outputs/plan-manage-panel-preview-retry-2026-08-06.md). UI pins 1-6 (retain
 * v2 numbering); this file covers the manage-panel variants of pins 1, 2, 3,
 * 4, and 5. Pin 6 (InviteEmailModal Retry disable) lives in
 * invite-preview-error-retry.test.js.
 *
 * Bounded-timeout / release-tail-on-close coverage (Codex adversarial review,
 * medium severity, 2026-08-06): EmailModal stays MOUNTED when closed, so a
 * render whose fetch never settles (no AbortController/timeout, pre-fix) left
 * renderTailRef permanently chained — every later session's preview queued
 * behind it forever. The fix aborts the in-flight render on close/reopen and
 * bounds every render at PREVIEW_RENDER_TIMEOUT_MS. These tests use a fetch
 * that never resolves/rejects on its own (the point — it must be recovered
 * from, not eventually settled by the mock).
 */

import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { act } from 'react';
import { TextDecoder as NodeTextDecoder } from 'util';
import ReviewerManagePanel, { PREVIEW_RENDER_TIMEOUT_MS } from '../../shared/components/reviewers/ReviewerManagePanel';
import { RENDER_PREVIEW_NETWORK_MESSAGE } from '../../shared/components/reviewers/render-preview-failure';

// A render-emails response that never resolves or rejects on its own — only
// settles if the caller's AbortSignal fires. Mirrors real fetch() semantics
// for an AbortController-bound request.
function hangingRenderEmails(init) {
  return new Promise((resolve, reject) => {
    const signal = init && init.signal;
    if (!signal) return;
    if (signal.aborted) {
      reject(makeAbortError());
      return;
    }
    signal.addEventListener('abort', () => reject(makeAbortError()));
  });
}

function makeAbortError() {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

// jsdom's test environment does not provide TextDecoder; ReviewerManagePanel's
// handleSend reads the send-emails SSE stream through one. Polyfill locally
// (test-file scoped) rather than touching the shared jest.setup.js.
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = NodeTextDecoder;
}

const PROPOSAL = {
  proposalId: '00000000-0000-0000-0000-000000000001',
  proposalTitle: 'Proposal Under Review',
  reviewDeadline: '2026-07-22',
};

const REVIEWER_A = {
  suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Accepted A',
  email: 'a@example.org',
  reviewStatus: 'accepted',
};
const REVIEWER_B = {
  suggestionId: 'bbbbbbbb-0000-0000-0000-000000000002',
  name: 'Accepted B',
  email: 'b@example.org',
  reviewStatus: 'accepted',
};

function mockJson(data, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => data };
}

function mockSseFromChunks(chunks) {
  let index = 0;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: jest.fn(async () => {
          if (index < chunks.length) return { value: Buffer.from(chunks[index++]), done: false };
          return { done: true, value: undefined };
        }),
      }),
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

function checkboxForRow(name) {
  const row = screen.getByText(name).closest('tr');
  return within(row).getByRole('checkbox');
}

let renderEmailsBehavior;

function baseFetchImpl(url) {
  const u = String(url);
  if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
  if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
  if (u === '/api/review-manager/render-emails') return renderEmailsBehavior();
  throw new Error(`Unexpected fetch: ${url}`);
}

beforeEach(() => {
  renderEmailsBehavior = () => mockJson({ drafts: [] });
  global.fetch = jest.fn(async (url) => baseFetchImpl(url));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  window.confirm.mockRestore();
});

function renderEmailsCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url) === '/api/review-manager/render-emails');
}

function renderPanel(reviewers = [REVIEWER_A]) {
  return render(
    <ReviewerManagePanel proposal={PROPOSAL} reviewers={reviewers} settings={{ signature: 'PD' }} />,
  );
}

function openReleaseModal(count = 1) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`release proposal to reviewers \\(${count}\\)`, 'i') }));
}

// Pin 1 + 2 ---------------------------------------------------------------

test('pin 1: manage-panel 503 preview failure shows owner-verbatim copy + reassurance + Retry', async () => {
  renderEmailsBehavior = () => mockJson(
    { error: "I'm having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn't resolve, contact an administrator." },
    false,
    503,
  );
  renderPanel();
  openReleaseModal();
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));

  await waitFor(() =>
    expect(
      screen.getByText(/I'm having trouble accessing the server.*No emails have been sent — retrying is safe\./),
    ).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
});

test('pin 2: Retry issues exactly one new render-emails request; a healthy response clears the banner and advances to preview', async () => {
  renderEmailsBehavior = () => mockJson({ error: 'boom' }, false, 503);
  renderPanel();
  openReleaseModal();
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  await screen.findByRole('button', { name: /Retry/ });
  const before = renderEmailsCalls().length;

  renderEmailsBehavior = () => mockJson({
    drafts: [{
      suggestionId: REVIEWER_A.suggestionId,
      candidateName: REVIEWER_A.name,
      candidateEmail: REVIEWER_A.email,
      subject: 'S',
      body: 'B',
    }],
  });
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

  await waitFor(() => expect(renderEmailsCalls().length).toBe(before + 1));
  await waitFor(() => expect(screen.queryByText(/retrying is safe/)).toBeNull());
  await screen.findByRole('button', { name: /send 1 email/i });
});

// Pin 3 ---------------------------------------------------------------------

test('pin 3: a terminal send-stream error shows its message without Retry, and previewFailed stays false', async () => {
  renderEmailsBehavior = () => mockJson({
    drafts: [{
      suggestionId: REVIEWER_A.suggestionId,
      candidateName: REVIEWER_A.name,
      candidateEmail: REVIEWER_A.email,
      subject: 'S',
      body: 'B',
    }],
  });
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u === '/api/review-manager/send-emails') {
      return mockSseFromChunks(['event: error\ndata: {"message":"Dynamics rejected the batch"}\n\n']);
    }
    return baseFetchImpl(u);
  });
  renderPanel();
  openReleaseModal();
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  const sendButton = await screen.findByRole('button', { name: /send 1 email/i });
  fireEvent.click(sendButton);

  await waitFor(() => expect(screen.getByText('Dynamics rejected the batch')).toBeTruthy());
  expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
});

// Pin 4 -----------------------------------------------------------------

test('pin 4: deferred-response reopen — stale drafts do not render, and Send posts only the new session\'s suggestion IDs', async () => {
  const first = deferred();
  const second = deferred();
  const renderCalls = [];
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);
    if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
    if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
    if (u === '/api/review-manager/render-emails') {
      renderCalls.push(JSON.parse(init.body));
      if (renderCalls.length === 1) return first.promise;
      if (renderCalls.length === 2) return second.promise;
      throw new Error('unexpected extra render-emails call');
    }
    if (u === '/api/review-manager/send-emails') return mockSseFromChunks(['event: complete\ndata: {}\n\n']);
    throw new Error(`Unexpected fetch: ${url}`);
  });

  renderPanel([REVIEWER_A, REVIEWER_B]);

  // Select only A, open, and start a preview render that will hang.
  fireEvent.click(checkboxForRow('Accepted A'));
  fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  await waitFor(() => expect(renderCalls.length).toBe(1));

  // Close before the first render resolves.
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  // Reopen with a different selection (B only).
  fireEvent.click(checkboxForRow('Accepted A')); // uncheck A
  fireEvent.click(checkboxForRow('Accepted B')); // check B
  fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));

  // The second session's render is QUEUED behind the still-pending first —
  // single-flight serialization means it must not have fetched yet.
  expect(renderCalls.length).toBe(1);

  // Resolve the STALE first response with A's draft.
  first.resolve(mockJson({
    drafts: [{
      suggestionId: REVIEWER_A.suggestionId,
      candidateName: REVIEWER_A.name,
      candidateEmail: REVIEWER_A.email,
      subject: 'Stale A',
      body: 'Stale body',
    }],
  }));

  // The queued (current) session's fetch now runs.
  await waitFor(() => expect(renderCalls.length).toBe(2));
  expect(renderCalls[1].suggestionIds).toEqual([REVIEWER_B.suggestionId]);

  second.resolve(mockJson({
    drafts: [{
      suggestionId: REVIEWER_B.suggestionId,
      candidateName: REVIEWER_B.name,
      candidateEmail: REVIEWER_B.email,
      subject: 'Fresh B',
      body: 'Fresh body',
    }],
  }));

  await screen.findByText('Fresh body');
  expect(screen.queryByText('Stale body')).toBeNull();

  const sendButton = await screen.findByRole('button', { name: /send 1 email/i });
  fireEvent.click(sendButton);
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => url === '/api/review-manager/send-emails')).toBe(true));
  const sendCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
  const payload = JSON.parse(sendCall[1].body);
  expect(payload.drafts.map((d) => d.suggestionId)).toEqual([REVIEWER_B.suggestionId]);
});

// Pin 5 -----------------------------------------------------------------

test('pin 5: a pending render disables Preview/Retry and a click while pending cannot start a second fetch', async () => {
  const first = deferred();
  let calls = 0;
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
    if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
    if (u === '/api/review-manager/render-emails') {
      calls += 1;
      return first.promise;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  renderPanel();
  openReleaseModal();
  const previewButton = await screen.findByRole('button', { name: /preview 1 email/i });
  fireEvent.click(previewButton);

  await waitFor(() => expect(calls).toBe(1));
  expect(previewButton).toBeDisabled();

  // A second click while the fetch is outstanding must not start a second fetch.
  fireEvent.click(previewButton);
  expect(calls).toBe(1);

  first.resolve(mockJson({ error: 'still broken' }, false, 503));
  const retryButton = await screen.findByRole('button', { name: /Retry/ });
  expect(retryButton).not.toBeDisabled();
  expect(previewButton).not.toBeDisabled();

  const second = deferred();
  global.fetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
    if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
    if (u === '/api/review-manager/render-emails') { calls += 1; return second.promise; }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  fireEvent.click(retryButton);
  await waitFor(() => expect(calls).toBe(2));
  expect(retryButton).toBeDisabled();
  expect(previewButton).toBeDisabled();

  // A second Retry click while pending must not add a fetch.
  fireEvent.click(retryButton);
  expect(calls).toBe(2);

  second.resolve(mockJson({
    drafts: [{
      suggestionId: REVIEWER_A.suggestionId,
      candidateName: REVIEWER_A.name,
      candidateEmail: REVIEWER_A.email,
      subject: 'S',
      body: 'B',
    }],
  }));
  await waitFor(() => expect(screen.queryByText(/retrying is safe/)).toBeNull());
});

// Bounded-timeout / abort-on-close --------------------------------------

test('a hung render (fetch never settles on its own) does not block a later session after close/reopen', async () => {
  let calls = 0;
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);
    if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
    if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
    if (u === '/api/review-manager/render-emails') {
      calls += 1;
      if (calls === 1) return hangingRenderEmails(init); // never resolves/rejects unless aborted
      return mockJson({
        drafts: [{
          suggestionId: REVIEWER_A.suggestionId,
          candidateName: REVIEWER_A.name,
          candidateEmail: REVIEWER_A.email,
          subject: 'S',
          body: 'B',
        }],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  renderPanel();
  openReleaseModal();
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  await waitFor(() => expect(calls).toBe(1));

  // Close while the first render is still hung — the fix aborts it here
  // rather than leaving it to the timeout ceiling.
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

  // Reopen: the new session must be able to start (and complete) a FRESH
  // render — the old, never-settling tail must not still be blocking it.
  fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));

  await waitFor(() => expect(calls).toBe(2));
  await screen.findByRole('button', { name: /send 1 email/i });
});

test('a hung render times out, surfaces the network-failure banner, and Retry recovers', async () => {
  jest.useFakeTimers();
  try {
    let calls = 0;
    global.fetch = jest.fn(async (url, init) => {
      const u = String(url);
      if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
      if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
      if (u === '/api/review-manager/render-emails') {
        calls += 1;
        if (calls === 1) return hangingRenderEmails(init); // never resolves/rejects unless aborted
        return mockJson({
          drafts: [{
            suggestionId: REVIEWER_A.suggestionId,
            candidateName: REVIEWER_A.name,
            candidateEmail: REVIEWER_A.email,
            subject: 'S',
            body: 'B',
          }],
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    renderPanel();
    openReleaseModal();
    fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
    await waitFor(() => expect(calls).toBe(1));

    // Elapse the render's bounded timeout without closing the modal.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(PREVIEW_RENDER_TIMEOUT_MS);
    });

    await waitFor(() => expect(screen.getByText(RENDER_PREVIEW_NETWORK_MESSAGE)).toBeTruthy());
    const retryButton = screen.getByRole('button', { name: /Retry/ });
    expect(retryButton).not.toBeDisabled();

    fireEvent.click(retryButton);
    await waitFor(() => expect(calls).toBe(2));
    await screen.findByRole('button', { name: /send 1 email/i });
  } finally {
    jest.useRealTimers();
  }
});

test('epoch-guard pin: a stale render settling after close/reopen must not clobber the new session\'s rendering state', async () => {
  let calls = 0;
  global.fetch = jest.fn(async (url, init) => {
    const u = String(url);
    if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
    if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
    if (u === '/api/review-manager/render-emails') {
      calls += 1;
      if (calls === 1) return hangingRenderEmails(init); // settles only when its epoch's abort fires
      return new Promise(() => {}); // the new session's render: genuinely pending for this test
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  renderPanel();
  openReleaseModal();
  fireEvent.click(await screen.findByRole('button', { name: /preview 1 email/i }));
  await waitFor(() => expect(calls).toBe(1));

  // Close (aborts the first session's controller, bumping the epoch) and
  // reopen into a new session whose render is still genuinely in flight.
  fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
  fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
  const previewButton2 = await screen.findByRole('button', { name: /preview 1 email/i });
  fireEvent.click(previewButton2);
  await waitFor(() => expect(calls).toBe(2));

  // Let the first session's abort-triggered rejection (and its `finally`)
  // settle in the background — pre-fix this promise never settled at all, so
  // this race was unreachable; the fix's abort makes it real, and the
  // pre-existing epoch guard in `finally` must still hold.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  // The second (current) session's render is still genuinely pending — its
  // Preview button must stay disabled; the first session's stale settle must
  // not have reset `rendering` out from under it.
  expect(previewButton2).toBeDisabled();
});
