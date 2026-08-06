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
      { error: 'A temporary system error kept us from checking your access to the Reviewers app. Your account is unaffected — please retry in a moment' },
      { ok: false, status: 503 },
    );
  openModal();

  await waitFor(() =>
    expect(
      screen.getByText(/A temporary system error kept us from checking your access to the Reviewers app.*No emails have been sent — retrying is safe\./),
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
