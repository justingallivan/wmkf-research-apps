/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/CandidateEditModal', () => function CandidateEditModal() {
  return null;
});
jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const candidate = {
  suggestionId: 'S1',
  name: 'Dr. Test Reviewer',
  affiliation: 'Example University',
  email: 'reviewer@example.org',
  invited: false,
  accepted: false,
  declined: false,
  reasoning: 'Strong fit for the proposal topic.',
  keywords: 'reviewer testing, workflow rehearsal',
};

const draft = {
  suggestionId: 'S1',
  candidateName: 'Dr. Test Reviewer',
  candidateEmail: 'reviewer@example.org',
  subject: 'Invitation',
  body: [
    'Please use your secure personal link:',
    'https://reviews.wmkeck.org/external/review/token.value',
    '',
    'Review timeline:',
    '- Respond by {{respondBy}}',
    '- Proposal delivered on {{proposalDelivery}}',
    '- Review due by {{reviewDue}}',
  ].join('\n'),
};

function mockJson(data, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch.mockImplementation(async (url) => {
    if (String(url).startsWith('/api/user-preferences')) return mockJson({});
    if (String(url).startsWith('/api/review-manager/campaign-config')) {
      return mockJson({ config: { respondOffsetDays: 7, reviewDueDate: '2026-07-22' } });
    }
    if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [draft] });
    if (url === '/api/review-manager/send-emails') return { ok: true, body: { getReader: () => ({ read: jest.fn() }) } };
    throw new Error(`Unexpected fetch: ${url}`);
  });
  readSseStream.mockImplementation(async (_response, onEvent) => {
    onEvent({
      event: 'result',
      data: {
        sent: [{
          suggestionId: 'S1',
          candidateName: 'Dr. Test Reviewer',
          emailId: 'captured-S1',
          capturedEmail: {
            suggestionId: 'S1',
            candidateName: 'Dr. Test Reviewer',
            to: 'reviewer@example.org',
            subject: 'Invitation',
            htmlBody: '<a href="https://reviews.wmkeck.org/external/review/token.value">Start Review</a>',
          },
        }],
        failed: [],
        skipped: [],
      },
    });
  });
});

afterEach(() => {
  window.confirm.mockRestore();
});

describe('ReviewerInvitePanel invitation capture rehearsal', () => {
  test('selects a candidate, sends through the modal, and shows the captured artifact', async () => {
    const onRefresh = jest.fn();
    render(
      <ReviewerInvitePanel
        requestId="REQ-1"
        candidates={[candidate]}
        onRefresh={onRefresh}
        settings={{ signature: 'Program Director' }}
      />,
    );

    fireEvent.click(screen.getByLabelText('Select Dr. Test Reviewer'));
    fireEvent.click(screen.getByRole('button', { name: /send invitation \(1\)/i }));

    await screen.findByDisplayValue('Invitation');
    await waitFor(() => expect(screen.getByLabelText('Review due date')).toHaveValue('2026-07-22'));
    expect(screen.getByLabelText('Days to respond')).toHaveValue(7);
    // Reviewer-engagement Phase 1: respond-by is now a "days to respond" offset, not a
    // fixed date. The respond-by date in the email is computed as today + offset, so it
    // can't be asserted as a fixed string here — the campaignConfig payload below is the
    // durable contract. Proposal-delivery and review-due stay fixed dates.
    fireEvent.change(screen.getByLabelText('Days to respond'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Proposal delivered on/i), { target: { value: '2026-07-08' } });
    fireEvent.change(screen.getByLabelText('Review due date'), { target: { value: '2026-07-22' } });
    const sendButton = await screen.findByRole('button', { name: /send 1 invitation/i });
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    await waitFor(() => expect(screen.getByText(/captured 1 invitation email for rehearsal/i)).toBeInTheDocument());
    expect(screen.getByText(/no dynamics email was sent/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Start Review/)).toBeInTheDocument();
    expect(onRefresh).toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('This sends a real email with an accept/decline link and cannot be undone.'));

    const renderCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/render-emails');
    expect(JSON.parse(renderCall[1].body)).toMatchObject({
      suggestionIds: ['S1'],
      templateType: 'invitation',
      settings: { signature: 'Program Director' },
    });

    const sendCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
    expect(JSON.parse(sendCall[1].body)).toMatchObject({
      templateType: 'invitation',
      attachmentUrls: [],
      markAsSent: true,
      allowResend: false,
      drafts: [{ suggestionId: 'S1', subject: 'Invitation' }],
      // Phase 1: the panel sends the per-request campaign config alongside the drafts.
      campaignConfig: { respondOffsetDays: 10, reviewDueDate: '2026-07-22' },
    });
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('July 8, 2026');
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('July 22, 2026');
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('https://reviews.wmkeck.org/external/review/token.value');
  });
});
