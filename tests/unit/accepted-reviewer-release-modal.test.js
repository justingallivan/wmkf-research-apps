/** @jest-environment jsdom */

import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import AcceptedReviewerReleaseModal from '../../shared/components/reviewers/AcceptedReviewerReleaseModal';

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const SUGGESTION_ID = '22222222-2222-4222-8222-222222222222';

const reviewer = {
  suggestionId: SUGGESTION_ID,
  name: 'Dr. Reviewer',
  honorariumRequestId: '33333333-3333-4333-8333-333333333333',
};

function response(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: jest.fn(async () => body) };
}

beforeEach(() => {
  window.confirm = jest.fn(() => true);
  global.fetch = jest.fn();
});

afterEach(() => jest.restoreAllMocks());

test('records the fixed reason, editable note, reviewed email, and retained-honorarium consequence', async () => {
  global.fetch.mockResolvedValue(response({
    ok: true,
    reason: 'sufficient_reviews_received',
    drafts: [{
      suggestionId: SUGGESTION_ID,
      status: 'ok',
      name: 'Dr. Reviewer',
      to: 'reviewer@example.org',
      from: 'pd@example.org',
      senderId: 'pd-1',
      subject: 'Thank you',
      bodyText: 'Thank you for agreeing to help.',
      expectedNotes: 'Existing note',
      existingNotes: 'Existing note',
    }],
  }));
  const onRelease = jest.fn(async () => ({
    ok: true,
    data: { transitioned: 1, results: [{ status: 'released_emailed' }] },
  }));

  render(
    <AcceptedReviewerReleaseModal
      reviewer={reviewer}
      requestId={REQUEST_ID}
      onClose={jest.fn()}
      onRelease={onRelease}
    />,
  );

  expect(await screen.findByText('Reason: Sufficient reviews received')).toBeInTheDocument();
  expect(screen.getByText(/Outcome: Review not received/)).toBeInTheDocument();
  expect(screen.getAllByText(/retained and marked Withdrawn/).length).toBeGreaterThan(0);
  const note = await screen.findByDisplayValue('Existing note');
  expect(note).toHaveValue('Existing note');
  fireEvent.change(note, { target: { value: 'Overdue after multiple reminders.' } });
  fireEvent.change(screen.getByDisplayValue('Thank you'), { target: { value: 'Thank you for your time' } });
  fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));

  await waitFor(() => expect(onRelease).toHaveBeenCalledWith({
    releaseReason: 'sufficient_reviews_received',
    internalNotes: { [SUGGESTION_ID]: 'Overdue after multiple reminders.' },
    sendEmail: true,
    overrides: {
      [SUGGESTION_ID]: {
        expectedNotes: 'Existing note',
        subject: 'Thank you for your time',
        bodyText: 'Thank you for agreeing to help.',
        to: 'reviewer@example.org',
        from: 'pd@example.org',
        senderId: 'pd-1',
      },
    },
  }));
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
});

test('still permits release when email is unavailable and submits an expected-notes guard', async () => {
  global.fetch.mockResolvedValue(response({
    ok: true,
    drafts: [{
      suggestionId: SUGGESTION_ID,
      status: 'no_email',
      name: 'Dr. Reviewer',
      expectedNotes: '',
      existingNotes: '',
    }],
  }));
  const onRelease = jest.fn(async () => ({
    ok: true,
    data: { transitioned: 1, results: [{ status: 'released_no_email_by_choice' }] },
  }));
  render(
    <AcceptedReviewerReleaseModal
      reviewer={reviewer}
      requestId={REQUEST_ID}
      onClose={jest.fn()}
      onRelease={onRelease}
    />,
  );
  const checkbox = await screen.findByRole('checkbox', { name: 'Send a thank-you email' });
  expect(checkbox).not.toBeChecked();
  expect(checkbox).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));
  await waitFor(() => expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({
    sendEmail: false,
    overrides: { [SUGGESTION_ID]: { expectedNotes: '' } },
  })));
});

test('shows a friendly commit-time honorarium failure instead of a raw status code', async () => {
  global.fetch.mockResolvedValue(response({
    ok: true,
    drafts: [{
      suggestionId: SUGGESTION_ID,
      status: 'ok',
      name: 'Dr. Reviewer',
      to: 'reviewer@example.org',
      from: 'pd@example.org',
      senderId: 'pd-1',
      subject: 'Thank you',
      bodyText: 'Thank you.',
      expectedNotes: '',
      existingNotes: '',
    }],
  }));
  const onRelease = jest.fn(async () => ({
    ok: false,
    error: 'honorarium_authorized',
    data: { transitioned: 0, results: [{ status: 'honorarium_authorized' }] },
  }));

  render(
    <AcceptedReviewerReleaseModal
      reviewer={reviewer}
      requestId={REQUEST_ID}
      onClose={jest.fn()}
      onRelease={onRelease}
    />,
  );

  await screen.findByDisplayValue('Thank you');
  fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));
  expect(await screen.findByText(
    'The honorarium is already authorized for payment and cannot be cancelled here.',
  )).toBeInTheDocument();
  expect(screen.queryByText('honorarium_authorized')).not.toBeInTheDocument();
});

test('blocks an unsafe honorarium during preview before showing the composer', async () => {
  global.fetch.mockResolvedValue(response({
    ok: true,
    drafts: [{
      suggestionId: SUGGESTION_ID,
      status: 'honorarium_paid',
      expectedNotes: '',
      existingNotes: '',
    }],
  }));
  const onRelease = jest.fn();

  render(
    <AcceptedReviewerReleaseModal
      reviewer={reviewer}
      requestId={REQUEST_ID}
      onClose={jest.fn()}
      onRelease={onRelease}
    />,
  );

  expect(await screen.findByText(
    'The honorarium has a paid amount and cannot be cancelled here.',
  )).toBeInTheDocument();
  expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Release reviewer' })).toBeDisabled();
  expect(onRelease).not.toHaveBeenCalled();
});

test('re-arms mounted feedback state under React StrictMode', async () => {
  global.fetch.mockResolvedValue(response({
    ok: true,
    drafts: [{
      suggestionId: SUGGESTION_ID,
      status: 'no_email',
      name: 'Dr. Reviewer',
      expectedNotes: '',
      existingNotes: '',
    }],
  }));
  const onRelease = jest.fn(async () => ({
    ok: true,
    data: { transitioned: 1, results: [{ status: 'released_no_email_by_choice' }] },
  }));

  render(
    <StrictMode>
      <AcceptedReviewerReleaseModal
        reviewer={reviewer}
        requestId={REQUEST_ID}
        onClose={jest.fn()}
        onRelease={onRelease}
      />
    </StrictMode>,
  );

  await screen.findByRole('checkbox', { name: 'Send a thank-you email' });
  fireEvent.click(screen.getByRole('button', { name: 'Release reviewer' }));
  expect(await screen.findByText('Reviewer released')).toBeInTheDocument();
  expect(screen.queryByText('Releasing…')).not.toBeInTheDocument();
});

test('preview fetch sends the exact request bytes', async () => {
  global.fetch.mockResolvedValue(response({ ok: true, drafts: [{ suggestionId: SUGGESTION_ID, status: 'no_email', expectedNotes: '', existingNotes: '' }] }));
  render(<AcceptedReviewerReleaseModal reviewer={reviewer} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
  await screen.findByRole('checkbox', { name: 'Send a thank-you email' });
  expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/terminal-transition', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requestId: REQUEST_ID,
      suggestionIds: [SUGGESTION_ID],
      terminalStatus: 'released',
      preview: true,
    }),
  });
});

test('axis (b): a non-2xx preview body surfaces its error verbatim', async () => {
  global.fetch.mockResolvedValue(response({ error: 'preview blew up' }, { ok: false, status: 500 }));
  render(<AcceptedReviewerReleaseModal reviewer={reviewer} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
  expect(await screen.findByText('preview blew up')).toBeInTheDocument();
});

test('axis (c): a network rejection on preview surfaces its message', async () => {
  global.fetch.mockRejectedValue(new Error('network down'));
  render(<AcceptedReviewerReleaseModal reviewer={reviewer} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
  expect(await screen.findByText('network down')).toBeInTheDocument();
});

test('axis (d): a malformed 2xx preview body falls back to "no preview returned"', async () => {
  global.fetch.mockResolvedValue({ ok: true, status: 200, json: jest.fn(async () => { throw new Error('bad json'); }) });
  render(<AcceptedReviewerReleaseModal reviewer={reviewer} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
  expect(await screen.findByText('This reviewer cannot be released: no preview returned')).toBeInTheDocument();
});

test('axis (e): a non-2xx preview body that fails to parse falls back to the status message, never silently', async () => {
  global.fetch.mockResolvedValue({ ok: false, status: 502, json: jest.fn(async () => { throw new Error('bad gateway html'); }) });
  render(<AcceptedReviewerReleaseModal reviewer={reviewer} requestId={REQUEST_ID} onClose={jest.fn()} onRelease={jest.fn()} />);
  expect(await screen.findByText('Could not prepare the release (502)')).toBeInTheDocument();
});
