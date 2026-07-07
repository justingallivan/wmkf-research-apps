/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteEmailModal from '../../shared/components/reviewers/InviteEmailModal';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const draft = {
  suggestionId: 'S1',
  candidateName: 'Dr. Test Reviewer',
  candidateEmail: 'reviewer@example.org',
  subject: 'Invitation',
  body: 'Please use your secure personal link:\nhttps://reviews.wmkeck.org/external/review/token.value',
};

function mockJson(data, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch.mockImplementation(async (url, options = {}) => {
    if (String(url).startsWith('/api/user-preferences')) return mockJson({});
    if (url === '/api/review-manager/campaign-timeline-defaults') {
      return mockJson({ timeline: {}, isDefault: true, malformed: false });
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
            htmlBody: '<table><tr><td><a href="https://reviews.wmkeck.org/external/review/token.value">Respond to Invitation</a></td></tr></table>',
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

describe('InviteEmailModal capture-mode result display', () => {
  test('shows captured email artifacts returned by send-emails', async () => {
    render(
      <InviteEmailModal
        candidates={[{ suggestionId: 'S1', name: 'Dr. Test Reviewer', email: 'reviewer@example.org' }]}
        settings={{ signature: 'Program Director' }}
        onClose={jest.fn()}
        onSent={jest.fn()}
      />,
    );

    await screen.findByDisplayValue('Invitation');
    // The "Send 1 invitation" label carries the recipient COUNT, which settles in a
    // later render tick than the subject field — so wait for that exact label rather
    // than querying synchronously (the count lags the subject under CPU load → the
    // button still reads "Send invitations", which was the parallel-worker flake).
    fireEvent.click(await screen.findByRole('button', { name: /send 1 invitation/i }));

    await waitFor(() => expect(screen.getByText(/captured 1 invitation email for rehearsal/i)).toBeInTheDocument());
    expect(screen.getByText(/no dynamics email was sent/i)).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Test Reviewer <reviewer@example\.org>/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Respond to Invitation/)).toBeInTheDocument();

    const sendCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
    expect(JSON.parse(sendCall[1].body)).toMatchObject({
      templateType: 'invitation',
      drafts: [{ suggestionId: 'S1', subject: 'Invitation' }],
    });
  });
});
