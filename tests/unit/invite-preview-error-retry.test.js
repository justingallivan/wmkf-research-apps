/**
 * @jest-environment jsdom
 *
 * Invite-modal preview failure UX (owner report, 2026-08-06): rendering
 * previews failed twice in production ("Unable to verify application access;
 * please retry" — the fail-closed 503 from requireAppAccess — and the bare
 * "Failed to render previews" fallback when the response had no JSON body).
 * The banner gave the PD no reassurance that nothing was sent and no way to
 * retry short of closing the modal. Pins:
 *   1. A server error body surfaces its message plus the "No emails have been
 *      sent — retrying is safe." reassurance, with a Retry button that
 *      re-renders the previews in place.
 *   2. A non-JSON error response (gateway timeout / crashed function) surfaces
 *      the status code instead of a raw parse error.
 *   3. A network failure (fetch rejects) surfaces the reachability message
 *      with the same Retry affordance.
 *
 * Extended for Plan v3 (S404,
 * outputs/plan-manage-panel-preview-retry-2026-08-06.md) UI pin 5 (single-
 * flight: at most one render fetch in flight per modal at a time) and pin 6
 * (Retry disable while its render is pending, re-enabled once it settles).
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/email-template-store', () => ({
  EMPTY_TEMPLATES: { invitation: { subject: '', body: '' } },
  loadEmailTemplates: async () => ({ invitation: { subject: 'Invitation', body: 'Hello {{name}}' } }),
  saveEmailTemplates: async () => {},
}));

import InviteEmailModal from '../../shared/components/reviewers/InviteEmailModal';
import {
  renderPreviewFailureMessage,
  RENDER_PREVIEW_NETWORK_MESSAGE,
} from '../../shared/components/reviewers/render-preview-failure';

const CANDIDATES = [{ suggestionId: 's-1', name: 'Jane Roe', email: 'jane@example.edu' }];

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => data };
}

// The render-emails behavior for the NEXT call; tests reassign it before Retry.
let renderEmailsBehavior;

beforeEach(() => {
  renderEmailsBehavior = () => response({ drafts: [] });
  global.fetch = jest.fn(async (url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/render-emails')) return renderEmailsBehavior();
    return response({});
  });
});

function renderEmailsCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url).includes('render-emails'));
}

function openModal() {
  return render(
    <InviteEmailModal requestId={null} candidates={CANDIDATES} settings={{}} onClose={() => {}} onSent={() => {}} />,
  );
}

test('server error body: message + reassurance + working Retry', async () => {
  renderEmailsBehavior = () =>
    response(
      { error: "I'm having trouble accessing the server. This is usually a temporary blip. Please press retry and if the problem doesn't resolve, contact an administrator." },
      { ok: false, status: 503 },
    );
  openModal();

  await waitFor(() =>
    expect(
      screen.getByText(/I'm having trouble accessing the server.*No emails have been sent — retrying is safe\./),
    ).toBeTruthy(),
  );
  const before = renderEmailsCalls().length;

  // Retry with a now-healthy server: previews land, the banner clears.
  renderEmailsBehavior = () =>
    response({ drafts: [{ suggestionId: 's-1', candidateName: 'Jane Roe', candidateEmail: 'jane@example.edu', subject: 'S', body: 'B' }] });
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));

  await waitFor(() => expect(renderEmailsCalls().length).toBe(before + 1));
  await waitFor(() => expect(screen.queryByText(/retrying is safe/)).toBeNull());
});

test('non-JSON error response surfaces the status code, not a parse error', async () => {
  renderEmailsBehavior = () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } });
  openModal();

  await waitFor(() =>
    expect(screen.getByText(renderPreviewFailureMessage({ status: 502 }))).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
});

test('network failure surfaces the reachability message with Retry', async () => {
  renderEmailsBehavior = () => { throw new TypeError('Failed to fetch'); };
  openModal();

  await waitFor(() => expect(screen.getByText(RENDER_PREVIEW_NETWORK_MESSAGE)).toBeTruthy());
  expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
});

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

test('pin 6: Retry is disabled while its render is pending and re-enables once the render settles', async () => {
  renderEmailsBehavior = () => response({ error: 'boom' }, { ok: false, status: 503 });
  openModal();
  const retryButton = await screen.findByRole('button', { name: /Retry/ });
  expect(retryButton).not.toBeDisabled();

  const pending = deferred();
  global.fetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/render-emails')) return pending.promise;
    return response({});
  });
  fireEvent.click(retryButton);
  await waitFor(() => expect(retryButton).toBeDisabled());

  // The banner (and its Retry button) unmounts while `error` is cleared mid-render
  // and remounts as a new node once the failure lands — re-query rather than
  // reuse the pre-render reference, which would now be a detached stale node.
  pending.resolve(response({ error: 'still broken' }, { ok: false, status: 503 }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Retry/ })).not.toBeDisabled());
});

test('pin 5: single-flight — a pending render cannot be re-triggered into a second concurrent fetch', async () => {
  renderEmailsBehavior = () => response({ error: 'boom' }, { ok: false, status: 503 });
  openModal();
  const retryButton = await screen.findByRole('button', { name: /Retry/ });

  let calls = 0;
  const pending = deferred();
  global.fetch.mockImplementation(async (url) => {
    const u = String(url);
    if (u.includes('/api/review-manager/render-emails')) { calls += 1; return pending.promise; }
    return response({});
  });
  fireEvent.click(retryButton);
  await waitFor(() => expect(calls).toBe(1));
  expect(retryButton).toBeDisabled();

  // Disabled by the DOM: a click while pending must not fire onClick, so no
  // second overlapping fetch (and no second durable render/token-mint call).
  fireEvent.click(retryButton);
  expect(calls).toBe(1);

  pending.resolve(response({ drafts: [] }));
  await waitFor(() => expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull());
  expect(calls).toBe(1);
});
