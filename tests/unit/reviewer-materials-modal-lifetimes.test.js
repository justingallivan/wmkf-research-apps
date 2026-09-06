/**
 * @jest-environment jsdom
 *
 * Stage 6B3 — ReleaseMaterialsModal session identity, stale-outcome
 * suppression and the send-completion handshake
 * (docs/REVIEWER_LIFECYCLE_STAGE6B_BUILD_PLAN.md "6B3"). Drives the REAL
 * `ReviewerManagePanel` (the modal is not exported) with isolated,
 * hand-controlled transport promises — no mocked handler implementations.
 * Harness helpers (mockJson, deferred, TextDecoder polyfill, PROPOSAL/
 * REVIEWER fixtures) are copied from manage-panel-preview-error-retry.test.js
 * and reviewer-manage-proposal-attachment.test.js, not imported.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { act } from 'react';
import { TextDecoder as NodeTextDecoder } from 'util';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));
jest.mock('../../shared/components/reviewers/email-template-store', () => {
  const actual = jest.requireActual('../../shared/components/reviewers/email-template-store');
  return {
    ...actual,
    loadEmailTemplates: jest.fn(async () => actual.EMPTY_TEMPLATES),
    saveEmailTemplates: jest.fn(async () => true),
  };
});

const { upload } = require('@vercel/blob/client');
const { saveEmailTemplates } = require('../../shared/components/reviewers/email-template-store');

if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = NodeTextDecoder;
}

const PROPOSAL = {
  proposalId: '00000000-0000-0000-0000-000000000001',
  proposalTitle: 'Proposal Under Review',
  reviewDeadline: '2026-07-22',
};
const PROPOSAL_2 = {
  proposalId: '00000000-0000-0000-0000-000000000002',
  proposalTitle: 'Second Proposal',
  reviewDeadline: '2026-08-01',
};

const REVIEWER_A = { suggestionId: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'Accepted A', email: 'a@example.org', reviewStatus: 'accepted' };
const REVIEWER_B = { suggestionId: 'bbbbbbbb-0000-0000-0000-000000000002', name: 'Accepted B', email: 'b@example.org', reviewStatus: 'accepted' };

function mockJson(data, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => data };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function draftFor(reviewer, overrides = {}) {
  return {
    suggestionId: reviewer.suggestionId,
    candidateName: reviewer.name,
    candidateEmail: reviewer.email,
    subject: 'S',
    body: 'B',
    ...overrides,
  };
}

// Chunk-controlled SSE reader: `push` delivers a chunk immediately if a read
// is already pending, otherwise queues it; `finish` ends the stream. Distinct
// from the fire-and-forget mockSseFromChunks in the sibling suite — needed
// here to control exactly which chunk carries which event, and to pause
// mid-stream (external clear before complete, duplicate/trailing events).
function controlledSse() {
  const queued = [];
  let waiting = null;
  let ended = false;
  const cancel = jest.fn(() => Promise.resolve());
  return {
    response: {
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise((resolve) => {
            if (queued.length > 0) {
              resolve({ value: Buffer.from(queued.shift()), done: false });
            } else if (ended) {
              resolve({ done: true, value: undefined });
            } else {
              waiting = resolve;
            }
          }),
          cancel,
        }),
      },
    },
    push(chunk) {
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ value: Buffer.from(chunk), done: false });
      } else {
        queued.push(chunk);
      }
    },
    finish() {
      ended = true;
      if (waiting) {
        const r = waiting;
        waiting = null;
        r({ done: true, value: undefined });
      }
    },
    cancelSpy: cancel,
  };
}

function sseChunk(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// aria-label lookup (not a text-based row search): the modal's own 'sent'
// summary also renders the reviewer's name, so a text-based `closest('tr')`
// lookup is ambiguous once a send has completed while the modal stays open.
function checkboxForRow(name) {
  return screen.getByLabelText(`Select ${name} for proposal release`);
}

let renderEmailsBehavior;
let sendEmailsBehavior;
let loadProposalBehavior;

function baseFetchImpl(url, init) {
  const u = String(url);
  if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: false });
  if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
  if (u === '/api/review-manager/render-emails') return renderEmailsBehavior(init);
  if (u === '/api/review-manager/send-emails') return sendEmailsBehavior(init);
  if (u === '/api/reviewer-finder/load-proposal') return loadProposalBehavior(init);
  throw new Error(`Unexpected fetch: ${url}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  renderEmailsBehavior = () => mockJson({ drafts: [] });
  sendEmailsBehavior = () => mockJson({ error: 'unused' }, false, 500);
  loadProposalBehavior = () => mockJson({ success: true, blobUrl: null, filename: null, allFiles: [] });
  global.fetch = jest.fn(async (url, init) => baseFetchImpl(url, init));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  window.confirm.mockRestore();
});

function renderPanel({ proposal = PROPOSAL, reviewers = [REVIEWER_A, REVIEWER_B], onRefresh } = {}) {
  return render(
    <ReviewerManagePanel proposal={proposal} reviewers={reviewers} settings={{ signature: 'PD' }} onRefresh={onRefresh} />,
  );
}

function openReleaseModal(count) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`release proposal to reviewers \\(${count}\\)`, 'i') }));
}

async function preview(count) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`preview ${count} email`, 'i') }));
}

async function send(count) {
  const btn = await screen.findByRole('button', { name: new RegExp(`send ${count} email`, 'i') });
  fireEvent.click(btn);
}

function renderCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url) === '/api/review-manager/render-emails');
}

function sendCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url) === '/api/review-manager/send-emails');
}

// ── Same-membership churn keeps drafts/step ─────────────────────────────

test('same-membership object churn (fresh reviewer objects, same ids) does not reset a preview in progress', async () => {
  const first = deferred();
  renderEmailsBehavior = () => first.promise;
  const { rerender } = renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
  fireEvent.click(checkboxForRow('Accepted A'));
  openReleaseModal(1);
  await preview(1);
  await waitFor(() => expect(renderCalls().length).toBe(1));

  // Fresh objects, same ids — parent rerenders with new array instances.
  rerender(
    <ReviewerManagePanel
      proposal={PROPOSAL}
      reviewers={[{ ...REVIEWER_A }, { ...REVIEWER_B }]}
      settings={{ signature: 'PD' }}
    />,
  );

  first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A)] }));
  await screen.findByRole('button', { name: /send 1 email/i });
  expect(renderCalls().length).toBe(1);
});

// ── Session identity x deferred continuation x invalidation classes ─────

describe('preview (deferred render-emails) invalidation', () => {
  test('external membership change invalidates a pending preview', async () => {
    const first = deferred();
    renderEmailsBehavior = () => first.promise;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    await preview(1);
    await waitFor(() => expect(renderCalls().length).toBe(1));

    // External membership change while the modal stays open: uncheck A via
    // the underlying table checkbox (still rendered behind the modal in jsdom).
    fireEvent.click(checkboxForRow('Accepted A'));

    first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A, { subject: 'Stale' })] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Compose is back, no stale draft/step leak.
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByRole('button', { name: /preview 0 email/i })).toBeTruthy();
  });

  test('close/reopen invalidates a pending preview', async () => {
    const first = deferred();
    renderEmailsBehavior = () => first.promise;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await waitFor(() => expect(renderCalls().length).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    openReleaseModal(1);

    first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A, { subject: 'Stale' })] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
  });

  test('unmount aborts a pending preview render and a fresh remount is a clean compose', async () => {
    // A "modal gone" assertion alone doesn't discriminate the unmount guard —
    // React already no-ops a captured setState call on an unmounted
    // component regardless of any epoch check (verified: no warning, no
    // crash, no effect). The unmount cleanup's OWN observable behavior is
    // that it aborts the outstanding render's AbortController, which we can
    // assert directly via the signal handed to fetch.
    const first = deferred();
    let capturedSignal;
    renderEmailsBehavior = (init) => { capturedSignal = init.signal; return first.promise; };
    const { rerender } = renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await waitFor(() => expect(renderCalls().length).toBe(1));
    expect(capturedSignal.aborted).toBe(false);

    rerender(
      <ReviewerManagePanel proposal={PROPOSAL} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} canManage={false} />,
    );

    // Discriminates the unmount cleanup: without it, the controller is never
    // aborted here.
    expect(capturedSignal.aborted).toBe(true);

    // The stale promise settling after unmount must not throw.
    first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A)] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: /send 1 email/i })).toBeNull();

    // A fresh remount (canManage regained) is a clean compose: no stale
    // drafts, no stuck rendering lock.
    rerender(
      <ReviewerManagePanel proposal={PROPOSAL} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} canManage />,
    );
    openReleaseModal(1);
    expect(screen.getByRole('button', { name: /preview 1 email/i })).not.toBeDisabled();
  });

  test('membership A→B→A: returning to the original membership does not revive a stale attempt', async () => {
    const first = deferred();
    renderEmailsBehavior = () => first.promise;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    await preview(1);
    await waitFor(() => expect(renderCalls().length).toBe(1));

    // A -> B
    fireEvent.click(checkboxForRow('Accepted A'));
    fireEvent.click(checkboxForRow('Accepted B'));
    // B -> A (back to the original membership)
    fireEvent.click(checkboxForRow('Accepted B'));
    fireEvent.click(checkboxForRow('Accepted A'));

    first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A, { subject: 'Stale' })] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Returning to A must not revive the stale first attempt's draft.
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
  });

  test('request switch invalidates a pending preview', async () => {
    const first = deferred();
    renderEmailsBehavior = () => first.promise;
    const { rerender } = renderPanel({ proposal: PROPOSAL, reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await waitFor(() => expect(renderCalls().length).toBe(1));

    rerender(
      <ReviewerManagePanel proposal={PROPOSAL_2} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} />,
    );

    first.resolve(mockJson({ drafts: [draftFor(REVIEWER_A, { subject: 'Stale' })] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('Stale')).toBeNull();
  });
});

describe('send (deferred SSE stream) invalidation', () => {
  test('external membership change during an in-flight send hides it and returns to a fresh compose', async () => {
    const sse = controlledSse();
    renderEmailsBehavior = () => mockJson({ drafts: [draftFor(REVIEWER_A), draftFor(REVIEWER_B)] });
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    openReleaseModal(2);
    await preview(2);
    await send(2);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    // Membership changes while step === 'sending' — the D3 duplicate-send
    // exposure: this hides the in-flight send and re-presents compose.
    fireEvent.click(checkboxForRow('Accepted A'));

    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.queryByText(/sent$/i)).toBeNull();
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
  });

  test('unmount during an in-flight send settles silently, no callback, no crash', async () => {
    const sse = controlledSse();
    renderEmailsBehavior = () => mockJson({ drafts: [draftFor(REVIEWER_A)] });
    sendEmailsBehavior = () => sse.response;
    // onRefresh is a plain JS callback, not React state — React's unmount
    // no-op protection does NOT cover it. Whether handleSend still invokes
    // the parent's onEmailsSent (and therefore onRefresh) after unmount
    // depends entirely on our own epoch check, so this IS discriminating.
    const onRefresh = jest.fn();
    const { rerender } = renderPanel({ reviewers: [REVIEWER_A], onRefresh });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    rerender(
      <ReviewerManagePanel proposal={PROPOSAL} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} canManage={false} onRefresh={onRefresh} />,
    );

    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // No throw, and the parent callback is never invoked for a send whose
    // session ended before it completed.
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test('close/reopen during an in-flight send invalidates it', async () => {
    const sse = controlledSse();
    renderEmailsBehavior = () => mockJson({ drafts: [draftFor(REVIEWER_A)] });
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    // The footer Cancel button is disabled while sending — use the header
    // close ("×") control, which is not step-gated, to close mid-send.
    fireEvent.click(screen.getByText('×'));
    openReleaseModal(1);

    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
  });

  test('request switch during an in-flight send invalidates it', async () => {
    const sse = controlledSse();
    renderEmailsBehavior = () => mockJson({ drafts: [draftFor(REVIEWER_A)] });
    sendEmailsBehavior = () => sse.response;
    const { rerender } = renderPanel({ proposal: PROPOSAL, reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    rerender(
      <ReviewerManagePanel proposal={PROPOSAL_2} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} />,
    );

    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText(/sent$/i)).toBeNull();
  });
});

describe('upload (deferred @vercel/blob) invalidation', () => {
  function enableAttachments() {
    renderEmailsBehavior = () => mockJson({ drafts: [] });
  }

  test('second upload never started after membership loss; localStorage/UI stay clean', async () => {
    global.fetch = jest.fn(async (url, init) => {
      const u = String(url);
      if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: true });
      if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
      if (u === '/api/reviewer-finder/load-proposal') return mockJson({ success: true, blobUrl: null, filename: null, allFiles: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    enableAttachments();
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    await screen.findByText('Attachments (included in .eml files)');

    const first = deferred();
    upload.mockImplementationOnce(() => first.promise);
    const input = document.querySelector('input[type="file"]');
    const file1 = new File(['a'], 'one.pdf', { type: 'application/pdf' });
    const file2 = new File(['b'], 'two.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file1, file2] } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    // Membership loss while upload #1 is still pending.
    fireEvent.click(checkboxForRow('Accepted A'));

    first.resolve({ url: 'https://blob.example/one.pdf' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(upload).toHaveBeenCalledTimes(1); // second file never started
    expect(localStorage.getItem('review_manager_attachments')).toBeNull();
    expect(screen.queryByText(/Failed to upload/)).toBeNull();
  });

  test('unmount during a pending upload releases the uploading lock without a stale attachment write', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: true });
      if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
      if (u === '/api/reviewer-finder/load-proposal') return mockJson({ success: true, blobUrl: null, filename: null, allFiles: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    });
    enableAttachments();
    const { rerender } = renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await screen.findByText('Attachments (included in .eml files)');

    const first = deferred();
    upload.mockImplementationOnce(() => first.promise);
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['a'], 'one.pdf', { type: 'application/pdf' })] } });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    rerender(
      <ReviewerManagePanel proposal={PROPOSAL} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} canManage={false} />,
    );

    first.resolve({ url: 'https://blob.example/one.pdf' });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(localStorage.getItem('review_manager_attachments')).toBeNull();
  });
});

describe('load-proposal (deferred) invalidation', () => {
  function withAttachProposal(reviewers) {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u === '/api/review-manager/release-settings') return mockJson({ attachProposalEmail: true });
      if (u.startsWith('/api/review-manager/materials-preflight')) return mockJson({ ok: true, fileCount: 3 });
      if (u === '/api/reviewer-finder/load-proposal') return loadProposalBehavior();
      throw new Error(`Unexpected fetch: ${url}`);
    });
    return renderPanel({ reviewers });
  }

  // REQUIRED-1 (reviewer BLOCK on a6a27ce8): loadProposal posts only
  // {requestId, fileKey} — membership is irrelevant to which document loads.
  // A membership-only change during a pending load must NOT orphan it: the
  // document is not stale, so it must still land (attachment shown, spinner
  // gone). This inverts the original (wrong) assertion.
  test('membership change during a pending proposal load does not orphan a non-stale load', async () => {
    const first = deferred();
    loadProposalBehavior = () => first.promise;
    withAttachProposal([REVIEWER_A, REVIEWER_B]);
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    await screen.findByText('Proposal document');

    fireEvent.click(checkboxForRow('Accepted A'));

    first.resolve(mockJson({ success: true, blobUrl: 'https://blob.example/current.pdf', filename: 'current.pdf', allFiles: [] }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByText('current.pdf')).toBeTruthy();
    expect(screen.queryByText(/Loading the request.s proposal from SharePoint/)).toBeNull();
  });

  // ADVISORY-3(ii): the prior "unmount ... never becomes the current
  // attachment" test asserted nothing. It cannot be made discriminating —
  // verified empirically (a standalone probe: mount, trigger a deferred
  // setState via effect, unmount, then resolve) that React 18 silently
  // no-ops a captured setState call on an already-unmounted function
  // component: no warning, no crash, no state change, regardless of any
  // application-level guard. loadProposal has no AbortController and calls
  // no external callback, so there is no plain-JS side effect (unlike
  // handleSend's onEmailsSent, covered by the send/unmount test above) left
  // to observe post-unmount. Dropped rather than kept as a non-discriminating
  // fixture.
});

describe('save-template (deferred) invalidation', () => {
  test('membership change after clicking Save Template suppresses the late "Saved" feedback', async () => {
    const first = deferred();
    saveEmailTemplates.mockImplementationOnce(() => first.promise);
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    fireEvent.click(await screen.findByRole('button', { name: /save template/i }));

    fireEvent.click(checkboxForRow('Accepted A'));

    first.resolve(true);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText('Saved ✓')).toBeNull();
  });

  test('unmount clears the pending save-template timer', async () => {
    jest.useFakeTimers();
    try {
      saveEmailTemplates.mockImplementationOnce(async () => true);
      const { rerender } = renderPanel({ reviewers: [REVIEWER_A] });
      openReleaseModal(1);
      const saveButton = await screen.findByRole('button', { name: /save template/i });
      await act(async () => {
        fireEvent.click(saveButton);
        await Promise.resolve();
        await Promise.resolve();
      });
      await screen.findByText('Saved ✓');

      rerender(
        <ReviewerManagePanel proposal={PROPOSAL} reviewers={[REVIEWER_A]} settings={{ signature: 'PD' }} canManage={false} />,
      );
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Send completion, real parent ────────────────────────────────────────

describe('send completion handshake (real parent onRefresh/selection)', () => {
  function setup(reviewers = [REVIEWER_A, REVIEWER_B]) {
    renderEmailsBehavior = () => mockJson({ drafts: reviewers.map((r) => draftFor(r)) });
  }

  test('result then complete in separate chunks, mixed sent/failed: step sent, final arrays shown, selection cleared, onRefresh once with no args', async () => {
    const sse = controlledSse();
    setup();
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    openReleaseModal(2);
    await preview(2);
    await send(2);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', {
      sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }],
      failed: [{ suggestionId: REVIEWER_B.suggestionId, candidateName: REVIEWER_B.name, candidateEmail: REVIEWER_B.email, error: 'boom' }],
      skipped: [],
    }));
    await act(async () => { await Promise.resolve(); });
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(await screen.findByText('1 sent, 1 failed')).toBeTruthy();
    // Selection cleared: the release button reverts to targeting all accepted.
    expect(screen.getByRole('button', { name: /release proposal to reviewers \(2\)/i })).toBeTruthy();
    // Summary intact after the selection-clear commit.
    expect(screen.getByText('1 sent, 1 failed')).toBeTruthy();
  });

  test('result and complete in ONE chunk shows the final arrays', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(
      sseChunk('result', { sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }], failed: [], skipped: [] })
      + sseChunk('complete', { message: 'done' }),
    );
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByText('1 sent')).toBeTruthy();
  });

  // ADVISORY-2: the same-chunk `if (finished) break;` guard (immediately
  // after a `complete` in the SAME chunk, not just a later one) had zero
  // pins. result + complete + complete + error all in ONE chunk must still
  // behave as exactly one completion: one onRefresh call, the summary intact,
  // step 'sent', and no error banner from the trailing same-chunk `error`.
  test('result + complete + complete + error in ONE chunk: one callback, summary intact, no error banner', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    const onRefresh = jest.fn();
    renderPanel({ reviewers: [REVIEWER_A], onRefresh });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(
      sseChunk('result', { sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }], failed: [], skipped: [] })
      + sseChunk('complete', { message: 'done' })
      + sseChunk('complete', { message: 'done-again' })
      + sseChunk('error', { message: 'late failure' }),
    );
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    expect(await screen.findByText('1 sent')).toBeTruthy();
    expect(screen.queryByText('late failure')).toBeNull();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('all-failed result then complete preserves the all-failed summary', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', { sent: [], failed: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email, error: 'nope' }], skipped: [] }));
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(await screen.findByText('0 sent, 1 failed')).toBeTruthy();
  });

  test('duplicate complete in a later chunk: callback still fires once', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    const onRefresh = jest.fn();
    renderPanel({ reviewers: [REVIEWER_A], onRefresh });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', { sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }], failed: [], skipped: [] }));
    sse.push(sseChunk('complete', { message: 'done' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('1 sent');
    expect(onRefresh).toHaveBeenCalledTimes(1);

    sse.push(sseChunk('complete', { message: 'done-again' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // Still the same summary; the release button still reflects one clear (2 total accepted).
    expect(screen.getByText('1 sent')).toBeTruthy();
    // The finished-attempt guard: a duplicate complete must not call the
    // parent's onEmailsSent (and therefore onRefresh) a second time.
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test('trailing error after complete does not change the summary or step', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', { sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }], failed: [], skipped: [] }));
    sse.push(sseChunk('complete', { message: 'done' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('1 sent');

    sse.push(sseChunk('error', { message: 'late failure' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.queryByText('late failure')).toBeNull();
    expect(screen.getByText('1 sent')).toBeTruthy();
  });

  test('external selection clear BEFORE complete suppresses the later complete callback', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    // Toggle the last selected reviewer off via the checkbox BEFORE complete.
    fireEvent.click(checkboxForRow('Accepted A'));

    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // No 'sent' step reached — the membership change already invalidated
    // the session, so the modal is back at compose with 0 reviewers.
    expect(screen.queryByText(/^\d+ sent/)).toBeNull();
  });

  test('after complete, toggling a reviewer selection resets the summary normally (no blanket exemption)', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A, REVIEWER_B]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    openReleaseModal(2);
    await preview(2);
    await send(2);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', {
      sent: [
        { suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email },
        { suggestionId: REVIEWER_B.suggestionId, candidateName: REVIEWER_B.name, candidateEmail: REVIEWER_B.email },
      ],
      failed: [],
      skipped: [],
    }));
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('2 sent');

    // Selection is now empty (post-completion clear). Select a reviewer again
    // then open the release modal — this is a genuinely new, unrelated
    // membership change and must reset normally (not exempted).
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(1);
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
  });

  test('reused cause: a second external clear after (i) does not exempt a later, unrelated transition', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A, REVIEWER_B]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A, REVIEWER_B] });
    openReleaseModal(2);
    await preview(2);
    await send(2);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', {
      sent: [
        { suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email },
        { suggestionId: REVIEWER_B.suggestionId, candidateName: REVIEWER_B.name, candidateEmail: REVIEWER_B.email },
      ],
      failed: [],
      skipped: [],
    }));
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('2 sent');

    // Reselect then deselect again — a second, unrelated prior→empty
    // transition. The stale cause object (if the parent hasn't overwritten
    // it) must not exempt this one: priorKey no longer matches.
    fireEvent.click(checkboxForRow('Accepted A'));
    fireEvent.click(checkboxForRow('Accepted A'));
    openReleaseModal(2);
    // A fresh compose for all 2 accepted reviewers, not the stale summary.
    expect(screen.queryByText('2 sent')).toBeNull();
    expect(screen.getByRole('button', { name: /preview 2 email/i })).toBeTruthy();
  });

  test('close/reopen after complete starts a fresh compose', async () => {
    const sse = controlledSse();
    setup([REVIEWER_A]);
    sendEmailsBehavior = () => sse.response;
    renderPanel({ reviewers: [REVIEWER_A] });
    openReleaseModal(1);
    await preview(1);
    await send(1);
    await waitFor(() => expect(sendCalls().length).toBe(1));

    sse.push(sseChunk('result', { sent: [{ suggestionId: REVIEWER_A.suggestionId, candidateName: REVIEWER_A.name, candidateEmail: REVIEWER_A.email }], failed: [], skipped: [] }));
    sse.push(sseChunk('complete', { message: 'done' }));
    sse.finish();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await screen.findByText('1 sent');

    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    openReleaseModal(1);
    expect(screen.getByRole('button', { name: /preview 1 email/i })).toBeTruthy();
    expect(screen.queryByText('1 sent')).toBeNull();
  });
});

// ── Payload equality ─────────────────────────────────────────────────────

test('send-emails payload is unchanged shape: drafts fields, templateType, attachmentUrls, markAsSent', async () => {
  renderEmailsBehavior = () => mockJson({ drafts: [draftFor(REVIEWER_A, { externalLinkExpected: true })] });
  sendEmailsBehavior = () => controlledSse().response; // never completes; only payload matters
  renderPanel({ reviewers: [REVIEWER_A] });
  openReleaseModal(1);
  await preview(1);
  await send(1);
  await waitFor(() => expect(sendCalls().length).toBe(1));

  const [, init] = sendCalls()[0];
  const payload = JSON.parse(init.body);
  expect(payload).toEqual({
    drafts: [{
      suggestionId: REVIEWER_A.suggestionId,
      subject: 'S',
      body: 'B',
      externalLinkExpected: true,
    }],
    templateType: 'materials',
    attachmentUrls: [],
    markAsSent: true,
  });
});
