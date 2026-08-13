/**
 * @jest-environment jsdom
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import InviteEmailModal, {
  applySubjectTiming,
  validateInvitationTimeline,
} from '../../shared/components/reviewers/InviteEmailModal';
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
            htmlBody: '<table><tr><td><a href="https://reviews.wmkeck.org/external/review/token.value?action=accept">Yes, I Can Review</a></td></tr></table>',
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

describe('InviteEmailModal invitation timing contract', () => {
  const today = new Date(2026, 6, 24);

  test('uses the current campaign fields and accepts a chronological timeline', () => {
    expect(validateInvitationTimeline({
      respondOffsetDays: 7,
      proposalSendDate: '2026-08-18',
      reviewDueDate: '2026-09-15',
    }, today)).toBeNull();
  });

  test('allows a late invitation whose response deadline falls after proposal release', () => {
    // today + 7 = 2026-07-31, which is AFTER the already-fixed 07-30 release
    // date. This is the late-cycle invite that used to disable Send with no
    // visible reason (S422 owner decision: release needs a PD action and the
    // date is email-only copy, so the ordering is odd but permitted).
    expect(validateInvitationTimeline({
      respondOffsetDays: 7,
      proposalSendDate: '2026-07-30',
      reviewDueDate: '2026-09-15',
    }, today)).toBeNull();
  });

  test('still rejects a review due date on or before the proposal release date', () => {
    expect(validateInvitationTimeline({
      respondOffsetDays: 7,
      proposalSendDate: '2026-08-18',
      reviewDueDate: '2026-08-18',
    }, today)).toMatch(/due date must be after the proposal release date/i);
  });

  test('rejects a review due date on or before the response deadline even when a release date is set', () => {
    // Discriminating fixture for the widened rule: release 07-28 < due 07-30,
    // so the release-date rule does NOT fire, and respondBy is 07-31, so the
    // review would be due before the reviewer has even RSVP'd. Restoring the
    // old `!proposalSendDate` guard makes this return null and fails here.
    expect(validateInvitationTimeline({
      respondOffsetDays: 7,
      proposalSendDate: '2026-07-28',
      reviewDueDate: '2026-07-30',
    }, today)).toMatch(/due date must be after the response deadline/i);
  });

  test('rejects a review due date on or before the response deadline with no release date', () => {
    expect(validateInvitationTimeline({
      respondOffsetDays: 7,
      proposalSendDate: '',
      reviewDueDate: '2026-07-30',
    }, today)).toMatch(/due date must be after the response deadline/i);
  });

  test('renders the campaign response deadline in the subject and degrades cleanly when unset', () => {
    const subject = 'Action needed by {{respondBy}}: Review invitation from W. M. Keck Foundation';
    expect(applySubjectTiming(subject, { respondOffsetDays: 7 }))
      .toMatch(/^Action needed by .+: Review invitation/);
    expect(applySubjectTiming(subject, { respondOffsetDays: '' }))
      .toBe('Review invitation from W. M. Keck Foundation');
  });
});

describe('InviteEmailModal capture-mode result display', () => {
  test('lets staff adjudicate a promoted address conflict in place and keeps a repair fallback', async () => {
    const conflictedDraft = {
      suggestionId: 'S1',
      candidateName: 'Dr. Test Reviewer',
      candidateEmail: 'reviewer@example.org',
      skipped: 'address_conflict_pending',
      addressConflict: {
        storedEmail: 'reviewer@example.org',
        foundEmail: 'reviewer@new.example.org',
        reason: 'email_mismatch',
      },
    };
    global.fetch.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/user-preferences')) return mockJson({});
      if (url === '/api/review-manager/campaign-timeline-defaults') {
        return mockJson({ timeline: {}, isDefault: true, malformed: false });
      }
      if (url === '/api/review-manager/campaign-config?requestId=request-guid') {
        return mockJson({ config: {} });
      }
      if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [conflictedDraft] });
      if (url === '/api/workbench/reviewer-address-trust') {
        return mockJson({ success: true, decision: 'person_address_verified' });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <InviteEmailModal
        requestId="request-guid"
        candidates={[{ suggestionId: 'S1', name: 'Dr. Test Reviewer', email: 'reviewer@example.org' }]}
        settings={{ signature: 'Program Director' }}
        onClose={jest.fn()}
        onSent={jest.fn()}
      />,
    );

    expect(await screen.findByText(/resolve the stored-versus-found address/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'reviewer@new.example.org' }));
    fireEvent.change(screen.getByLabelText(/evidence link for dr\. test reviewer/i), {
      target: { value: 'https://example.org/corresponding-author' },
    });
    fireEvent.click(screen.getByRole('button', { name: /record verified address/i }));
    await waitFor(() => {
      const verifyCall = global.fetch.mock.calls.find(([url, options]) => (
        url === '/api/workbench/reviewer-address-trust'
        && JSON.parse(options.body).action === 'verify_person_and_address'
      ));
      expect(JSON.parse(verifyCall[1].body)).toMatchObject({
        requestId: 'request-guid',
        suggestionId: 'S1',
        email: 'reviewer@new.example.org',
        evidenceUrl: 'https://example.org/corresponding-author',
      });
    });
    expect(screen.getByRole('button', { name: /create repair request/i })).toBeEnabled();
  });

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
    expect(screen.getByDisplayValue(/Yes, I Can Review/)).toBeInTheDocument();

    const sendCall = global.fetch.mock.calls.find(([url]) => url === '/api/review-manager/send-emails');
    expect(JSON.parse(sendCall[1].body)).toMatchObject({
      templateType: 'invitation',
      drafts: [{ suggestionId: 'S1', subject: 'Invitation' }],
    });
  });

  test('explains a research-only skip and fails closed when preview has no live manual link', async () => {
    const researchOnlyDraft = {
      suggestionId: 'S1',
      candidateName: 'Joan S. Brugge',
      candidateEmail: 'joan_brugge@hms.harvard.edu',
      skipped: 'email_research_only',
      emailConfidence: { action: 'research_only' },
      manualLink: null,
    };
    const onClose = jest.fn();
    const onSent = jest.fn();
    global.fetch.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/user-preferences')) return mockJson({});
      if (url === '/api/review-manager/campaign-timeline-defaults') {
        return mockJson({ timeline: {}, isDefault: true, malformed: false });
      }
      if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [researchOnlyDraft] });
      throw new Error(`Unexpected fetch: ${url}`);
    });

    render(
      <InviteEmailModal
        candidates={[{ suggestionId: 'S1', name: 'Joan S. Brugge', email: 'joan_brugge@hms.harvard.edu' }]}
        settings={{ signature: 'Program Director' }}
        onClose={onClose}
        onSent={onSent}
      />,
    );

    expect(await screen.findByText(/address is research-only, not invite-ready/i)).toBeInTheDocument();
    expect(screen.queryByText(/email_research_only/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send invitations$/i })).toBeDisabled();

    expect(screen.queryByLabelText('Secure invitation link for Joan S. Brugge')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /copy secure invitation link/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark manually sent/i })).not.toBeInTheDocument();
    expect(screen.getByText(/secure links are now minted only at send time/i)).toBeInTheDocument();
    expect(screen.getByText(/separate reviewer token regeneration workflow/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith('/api/review-manager/send-emails', expect.anything());
    expect(onSent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  // S400 finding 2 (post-send refresh): onSent must carry the SERVER-confirmed
  // invited rows so the parent can paint them on top of its refetch. A row the
  // server flagged inviteRecorded:false ("sent but the wmkf_invited stamp
  // failed — verify before retry") is genuinely still unstamped and must NOT be
  // painted invited.
  test('onSent receives confirmed invited ids and excludes inviteRecorded:false rows', async () => {
    const draftS2 = { ...draft, suggestionId: 'S2', candidateName: 'Dr. Second', body: draft.body };
    const onSent = jest.fn();
    global.fetch.mockImplementation(async (url) => {
      if (String(url).startsWith('/api/user-preferences')) return mockJson({});
      if (url === '/api/review-manager/campaign-timeline-defaults') {
        return mockJson({ timeline: {}, isDefault: true, malformed: false });
      }
      if (url === '/api/review-manager/render-emails') return mockJson({ drafts: [draft, draftS2] });
      if (url === '/api/review-manager/send-emails') return { ok: true, body: { getReader: () => ({ read: jest.fn() }) } };
      throw new Error(`Unexpected fetch: ${url}`);
    });
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: {
          sent: [
            { suggestionId: 'S1', candidateName: 'Dr. Test Reviewer', emailId: 'e1', inviteRecorded: true },
            { suggestionId: 'S2', candidateName: 'Dr. Second', emailId: 'e2', inviteRecorded: false },
          ],
          failed: [],
          skipped: [],
        },
      });
    });

    render(
      <InviteEmailModal
        candidates={[
          { suggestionId: 'S1', name: 'Dr. Test Reviewer', email: 'reviewer@example.org' },
          { suggestionId: 'S2', name: 'Dr. Second', email: 'second@example.org' },
        ]}
        settings={{ signature: 'Program Director' }}
        onClose={jest.fn()}
        onSent={onSent}
      />,
    );

    await screen.findAllByDisplayValue('Invitation');
    fireEvent.click(await screen.findByRole('button', { name: /send 2 invitations/i }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSent).toHaveBeenCalledWith({
      invitedSuggestionIds: ['S1'],
      sentAt: expect.any(String),
    });
  });

  test('onSent falls back to accumulated email_sent events when the stream ends without a result frame', async () => {
    const onSent = jest.fn();
    readSseStream.mockImplementation(async (_response, onEvent) => {
      onEvent({
        event: 'email_sent',
        data: { suggestionId: 'S1', candidateName: 'Dr. Test Reviewer', emailId: 'e1', inviteRecorded: true },
      });
      // no `result` frame — e.g. the stream was cut after the last per-email event
    });

    render(
      <InviteEmailModal
        candidates={[{ suggestionId: 'S1', name: 'Dr. Test Reviewer', email: 'reviewer@example.org' }]}
        settings={{ signature: 'Program Director' }}
        onClose={jest.fn()}
        onSent={onSent}
      />,
    );

    await screen.findByDisplayValue('Invitation');
    fireEvent.click(await screen.findByRole('button', { name: /send 1 invitation/i }));

    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(onSent).toHaveBeenCalledWith({
      invitedSuggestionIds: ['S1'],
      sentAt: expect.any(String),
    });
  });
});
