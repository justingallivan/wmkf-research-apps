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
    if (url === '/api/review-manager/campaign-timeline-defaults') {
      return mockJson({
        timeline: {
          cycleLabel: 'D26',
          inviteStartDate: '2026-06-17',
          respondOffsetDays: 14,
          proposalReleaseDate: '2099-08-10',
          reviewDueDate: '2026-08-05',
        },
        isDefault: false,
        malformed: false,
      });
    }
    if (String(url).startsWith('/api/review-manager/campaign-config')) {
      return mockJson({ config: { respondOffsetDays: 7, reviewDueDate: '2099-08-24' } });
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
            htmlBody: '<a href="https://reviews.wmkeck.org/external/review/token.value?action=accept">Yes, I Can Review</a>',
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
    expect(screen.queryByLabelText('Reviews due')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reviewer campaign timeline/i }));
    await waitFor(() => expect(screen.getByLabelText('Reviews due')).toHaveValue('2099-08-24'));
    expect(screen.getByLabelText('Days to respond')).toHaveValue(7);
    expect(screen.getByLabelText('Proposals released to reviewers')).toHaveValue('2099-08-10');
    // Reviewer-engagement Phase 1: respond-by is now a "days to respond" offset, not a
    // fixed date. The respond-by date in the email is computed as today + offset, so it
    // can't be asserted as a fixed string here — the campaignConfig payload below is the
    // durable contract. Proposal-delivery and review-due stay fixed dates.
    fireEvent.change(screen.getByLabelText('Days to respond'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Proposals released to reviewers'), { target: { value: '2099-08-10' } });
    fireEvent.change(screen.getByLabelText('Reviews due'), { target: { value: '2099-08-24' } });
    const sendButton = await screen.findByRole('button', { name: /send 1 invitation/i });
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    await waitFor(() => expect(screen.getByText(/captured 1 invitation email for rehearsal/i)).toBeInTheDocument());
    expect(screen.getByText(/no dynamics email was sent/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Yes, I Can Review/)).toBeInTheDocument();
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
      campaignConfig: { respondOffsetDays: 10, reviewDueDate: '2099-08-24' },
    });
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('August 10, 2099');
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('August 24, 2099');
    expect(JSON.parse(sendCall[1].body).drafts[0].body).toContain('https://reviews.wmkeck.org/external/review/token.value');
  });

  test('keeps declined reviewers visible but excludes them from invitation selection and counts', () => {
    const declinedCandidate = {
      ...candidate,
      suggestionId: 'S-DECLINED',
      name: 'Dr. Declined',
      invited: true,
      declined: true,
      responseType: 'declined',
    };
    const pendingCandidate = {
      ...candidate,
      suggestionId: 'S-PENDING',
      name: 'Dr. Pending',
      invited: true,
    };
    const freshCandidate = {
      ...candidate,
      suggestionId: 'S-FRESH',
      name: 'Dr. Fresh',
    };
    const acceptedCandidate = {
      ...candidate,
      suggestionId: 'S-ACCEPTED',
      name: 'Dr. Accepted',
      invited: true,
      accepted: true,
    };

    render(
      <ReviewerInvitePanel
        requestId="REQ-1"
        candidates={[declinedCandidate, pendingCandidate, freshCandidate, acceptedCandidate]}
      />,
    );

    expect(screen.getByLabelText('Select Dr. Declined')).toBeDisabled();
    expect(screen.getByLabelText('Select Dr. Pending')).toBeEnabled();
    expect(screen.getByLabelText('Select Dr. Fresh')).toBeEnabled();
    expect(screen.getByLabelText('Select Dr. Accepted')).toBeDisabled();
    expect(screen.getByText('1 invitable · 1 accepted')).toBeInTheDocument();
  });

  test('shows archived declines below the active proposal with an explicit reset action', () => {
    render(
      <ReviewerInvitePanel
        requestId="REQ-1"
        candidates={[candidate]}
        removedCandidates={[{
          suggestionId: 'S-DECLINED',
          name: 'Dr. Archived Decline',
          affiliation: 'Example University',
          wasInvited: true,
          declined: true,
          responseType: 'declined',
        }]}
      />,
    );

    expect(screen.getByText('Dr. Archived Decline')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset & restore' })).toBeInTheDocument();
    expect(screen.getByText(/reviewers who declined/i)).toBeInTheDocument();
  });
});
