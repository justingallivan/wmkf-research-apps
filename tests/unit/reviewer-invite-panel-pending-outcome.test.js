/**
 * @jest-environment jsdom
 *
 * Invite Reviewers "Record outcome…" for an invited reviewer who has not
 * answered: menu gating, dialog payload, and failure handling.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

const REQUEST = '11111111-1111-4111-8111-111111111111';
const pending = {
  suggestionId: 'S1',
  name: 'Dr. Pending Reviewer',
  email: 'pending@example.org',
  invited: true,
  accepted: false,
  declined: false,
  responseType: null,
  canRemove: false,
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let outcomeHandler;
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'alert').mockImplementation(() => {});
  outcomeHandler = jest.fn(() => Promise.resolve(response({ status: 'recorded' })));
  global.fetch = jest.fn((url, options) => {
    if (String(url).startsWith('/api/review-manager/reviewer-vip-flags')) {
      return Promise.resolve(response({ pdSystemUserId: 'pd-1', flaggedPotentialReviewerIds: [] }));
    }
    if (url === '/api/review-manager/pending-outcome') return outcomeHandler(url, options);
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

function renderPanel(props = {}) {
  return render(
    <ReviewerInvitePanel requestId={REQUEST} candidates={[pending]} removedCandidates={[]} onRefresh={jest.fn()} {...props} />,
  );
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
}

function openDialog() {
  openMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: /Record outcome/ }));
}

function sentBodies() {
  return global.fetch.mock.calls
    .filter(([url]) => url === '/api/review-manager/pending-outcome')
    .map(([, init]) => JSON.parse(init.body));
}

describe('menu gating', () => {
  test.each([
    ['never invited', { invited: false, canRemove: true }],
    ['accepted', { accepted: true, responseType: 'accepted' }],
    ['declined', { declined: true, responseType: 'declined' }],
    ['released as no longer needed', { responseType: 'withdrawn_sufficient' }],
    ['no response', { responseType: 'no_response' }],
  ])('a %s reviewer has no Record outcome item', (_name, fields) => {
    renderPanel({ candidates: [{ ...pending, ...fields }] });
    openMenu();
    expect(screen.queryByRole('menuitem', { name: /Record outcome/ })).toBeNull();
  });

  test('an invited reviewer with no answer has the item', () => {
    renderPanel();
    openMenu();
    expect(screen.getByRole('menuitem', { name: /Record outcome/ })).toBeInTheDocument();
  });

  test('read-only staff have no row menu at all', () => {
    renderPanel({ canManage: false });
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('dialog', () => {
  test('a conflict of interest raised by the reviewer sends exact bytes and refreshes', async () => {
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    const [, init] = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/pending-outcome');
    expect(init).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: REQUEST,
        suggestionId: 'S1',
        outcome: { kind: 'coi', endedBy: 'reviewer_before_accepting' },
      }),
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('Other needs a note and sends who ended it', async () => {
    renderPanel();
    openDialog();
    fireEvent.click(screen.getByLabelText('Other'));
    fireEvent.click(screen.getByLabelText('Foundation'));
    const record = screen.getByRole('button', { name: 'Record' });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/^Note/), { target: { value: '  Proposal withdrawn  ' } });
    fireEvent.click(record);
    await waitFor(() => expect(sentBodies()).toHaveLength(1));
    expect(sentBodies()[0].outcome).toEqual({ kind: 'other', endedBy: 'foundation', note: 'Proposal withdrawn' });
  });

  test('Cancel sends nothing', () => {
    renderPanel();
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sentBodies()).toHaveLength(0);
  });

  test('the dialog closes without a request when the reviewer answers while it is open', async () => {
    const view = renderPanel();
    openDialog();
    view.rerender(
      <ReviewerInvitePanel
        requestId={REQUEST}
        candidates={[{ ...pending, accepted: true, responseType: 'accepted' }]}
        removedCandidates={[]}
        onRefresh={jest.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(sentBodies()).toHaveLength(0);
  });

  test('a request switch remounts the panel and drops the open dialog', () => {
    const view = renderPanel();
    openDialog();
    view.rerender(
      <ReviewerInvitePanel
        requestId="22222222-2222-4222-8222-222222222222"
        candidates={[pending]}
        removedCandidates={[]}
        onRefresh={jest.fn()}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a stale row reports plainly, closes and refreshes', async () => {
    outcomeHandler.mockResolvedValue(response({ status: 'not_pending' }, 409));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    expect(window.alert.mock.calls[0][0]).toMatch(/already answered/);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('a server error keeps the dialog open for another try', async () => {
    outcomeHandler.mockResolvedValue(response({ error: 'Failed to record the reviewer outcome' }, 500));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    expect(window.alert.mock.calls[0][0]).toMatch(/Failed to record the reviewer outcome/);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test('two submits in the same tick send once', async () => {
    let resolve;
    outcomeHandler.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPanel();
    openDialog();
    const form = screen.getByRole('button', { name: 'Record' }).closest('form');
    fireEvent.submit(form);
    fireEvent.submit(form);
    await act(async () => resolve(response({ status: 'recorded' })));
    expect(sentBodies()).toHaveLength(1);
  });

  test('Record is disabled while saving, so a double click sends once', async () => {
    let resolve;
    outcomeHandler.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPanel();
    openDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
    await act(async () => resolve(response({ status: 'recorded' })));
    expect(sentBodies()).toHaveLength(1);
  });
});
