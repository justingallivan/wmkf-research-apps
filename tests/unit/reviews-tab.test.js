/**
 * @jest-environment jsdom
 *
 * ReviewsTab — read-back of submitted reviews. Renders against the mocked
 * /api/review-manager/reviewers GET: shows only reviewers with a submitted
 * review (reviewReceivedAt), decodes the ratings, and links the file download.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/external/RichReviewEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel, disabled }) => (
    <textarea
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const REVIEWERS = [
  {
    suggestionId: 'g1',
    name: 'Dr. Submitted',
    reviewerAffiliation: 'MIT',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewSharePointFolder: 'akoya_request/123/Reviewer_Uploads/x',
    reviewFilename: 'review.pdf',
    reviewerRiskLevel: 2,
    reviewerOverallAssessment: 5,
  },
  // Pending — no reviewReceivedAt: must be filtered out.
  { suggestionId: 'g2', name: 'Dr. Pending', reviewStatus: 'materials_sent' },
  // Submitted via "mark received (no file)": ratings present, no SharePoint folder.
  {
    suggestionId: 'g3',
    name: 'Dr. NoFile',
    reviewReceivedAt: '2026-06-19T00:00:00Z',
    reviewUploadedByStaff: true,
    reviewerRiskLevel: null,
    reviewerOverallAssessment: 99,
  },
];

afterEach(() => fetch.mockReset());

test('renders submitted reviews with decoded ratings + download link; pending lands in Outstanding', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: REVIEWERS }] }),
  });

  render(<ReviewsTab requestId="req1" />);

  // Count line counts submitted (2) against accepted (3).
  expect(await screen.findByText(/2 of 3 accepted reviewers submitted a review/i)).toBeInTheDocument();

  // Submitted reviewers shown as cards; the pending one is NOT hidden anymore —
  // since Phase 1 (outstanding tracking) it renders in the Outstanding section
  // above the cards, and the two lists are disjoint (keyed on reviewReceivedAt).
  expect(screen.getByText('Dr. Submitted')).toBeInTheDocument();
  expect(screen.getByText('Dr. NoFile')).toBeInTheDocument();
  expect(screen.getByText(/Outstanding \(1\)/)).toBeInTheDocument();
  expect(screen.getByText('Dr. Pending')).toBeInTheDocument();

  // Decoded ratings (not raw numbers).
  expect(screen.getByText('Medium risk (parts may succeed, others may fail)')).toBeInTheDocument();
  expect(screen.getByText('Excellent')).toBeInTheDocument(); // overall 5
  // NoFile has risk = null and an invalid historical overall value; both
  // decode to "Not provided".
  expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(2);

  // Download link reuses the existing endpoint, keyed by suggestionId.
  const link = screen.getByTitle('Download: review.pdf');
  expect(link.getAttribute('href')).toContain('/api/review-manager/download-review?suggestionId=g1');

  // The no-file submission shows the explicit no-file marker, not a broken link.
  expect(screen.getByText('No file on record')).toBeInTheDocument();
});

test('renders every answered question in order, including picklist rows inline', async () => {
  const reviewer = {
    suggestionId: 'g1',
    name: 'Dr. Narrative',
    reviewReceivedAt: '2026-06-20T00:00:00Z',
    reviewerRiskLevel: 2,
    reviewerOverallAssessment: 4,
    answers: [
      // Picklist rows render BOTH in the fixed rating cells and inline in the
      // answer details (owner decision 2026-08-09: no question skipped in the flow).
      { questionKey: 'riskLevel', questionOrder: 4, questionType: 'picklist', questionText: 'Q4 — How risky is the project overall?', answerHtml: '', answerText: 'Medium risk (parts may succeed, others may fail)', answerValue: 2 },
      { questionKey: 'impactAreas', questionOrder: 3, questionType: 'multiselect', questionText: 'Q3 — Impact areas', answerHtml: '', answerText: 'Tools; Broad interest', answerValue: null, answerValues: [{ value: 1, label: 'Tools' }, { value: 3, label: 'Broad interest' }] },
      { questionKey: 'foreseenImpacts', questionOrder: 2, questionType: 'richtext', questionText: 'Q2 — What specific significant impacts do you foresee?', answerHtml: '<p>This could <strong>reshape</strong> the field.</p>', answerText: '...', answerValue: null },
      // Empty optional richtext: skipped.
      { questionKey: 'additionalComments', questionOrder: 11, questionType: 'richtext', questionText: 'Q11 — Anything else?', answerHtml: '', answerText: '', answerValue: null },
    ],
  };
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: [reviewer] }] }),
  });

  render(<ReviewsTab requestId="req1" />);

  // The richtext question label + its rendered HTML show.
  expect(await screen.findByText('Q2 — What specific significant impacts do you foresee?')).toBeInTheDocument();
  expect(screen.getByText('reshape')).toBeInTheDocument(); // <strong> rendered
  // The empty optional question is not rendered.
  expect(screen.queryByText('Q11 — Anything else?')).not.toBeInTheDocument();
  // Once in the fixed RISK rating cell, once inline as the Q4 answer.
  expect(screen.getAllByText('Medium risk (parts may succeed, others may fail)')).toHaveLength(2);
  expect(screen.getByText('Q4 — How risky is the project overall?')).toBeInTheDocument();
  expect(screen.getByText('Q3 — Impact areas')).toBeInTheDocument();
  expect(screen.getByText('Tools')).toBeInTheDocument();
  expect(screen.getByText('Broad interest')).toBeInTheDocument();
});

test('shows an empty state when no reviewer has submitted', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{ proposalId: 'req1', reviewers: [{ suggestionId: 'g2', name: 'Dr. Pending', reviewStatus: 'materials_sent' }] }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);
  expect(await screen.findByText(/No reviews submitted yet/i)).toBeInTheDocument();
  // Phase 3: no submitted reviews → no export affordance at all.
  expect(screen.queryByText('Export:')).not.toBeInTheDocument();
});

test.each([
  ['removed', /removed from the proposal.*restore them first/i],
  ['revoked', /access was withdrawn.*reissue their link/i],
  ['not_found', /no longer available.*refresh to update/i],
  ['conflict', /already claimed.*refresh to see/i],
  ['read_failed', /couldn't verify.*no reminder was sent/i],
  ['prepare_failed', /could not prepare.*no reminder was sent/i],
])('maps the %s reminder refusal to durable actionable copy without erasing the row', async (reason, copy) => {
  const proposal = {
    proposalId: 'req1',
    reviewers: [{
      suggestionId: 'g2',
      name: 'Dr. Pending',
      reviewStatus: 'materials_sent',
      materialsSentAt: '2026-08-01T00:00:00Z',
      reminderCount: 0,
      reviewDueReminderEligibility: 'eligible',
    }],
  };
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, proposals: [proposal] }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ ok: false, reason }),
    });

  render(<ReviewsTab requestId="req1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send reminder now' }));

  expect(await screen.findByText(copy)).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.getByText('Dr. Pending')).toBeInTheDocument();
  expect(screen.queryByText(reason, { exact: true })).not.toBeInTheDocument();
});

test.each([
  ['token_revoked', /deliberately restore access/i],
  ['token_not_minted', /investigate the Materials history/i],
  ['token_invalid_data', /needs technical review/i],
  ['token_expired', /send an explicit replacement link/i],
  ['token_insufficient_window', /does not cover the deadline/i],
  ['due_date_missing', /set a review due date/i],
])('disables review-due reminder for %s and explains the required recovery', async (eligibility, title) => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{
        proposalId: 'req1',
        reviewers: [{
          suggestionId: 'g2',
          name: 'Dr. Pending',
          reviewStatus: 'materials_sent',
          materialsSentAt: '2026-08-01T00:00:00Z',
          reviewDueReminderEligibility: eligibility,
          reminderCount: 0,
        }],
      }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);
  const button = await screen.findByRole('button', { name: 'Send reminder now' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('title', expect.stringMatching(title));
});

test('keeps a stored synthesis visible even when there are no accepted reviewer rows', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{
        proposalId: 'req1',
        reviewers: [],
        reviewSynthesis: {
          consensus: ['Historical consensus'],
          disagreements: [],
          keyConcerns: [],
          ratingSummaries: [],
          overall: 'Historical overall assessment.',
        },
        reviewSynthesisState: {
          current: false,
          status: 'not_started',
          ready: false,
          canRunManually: false,
          blockingCount: 1,
        },
      }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);
  expect(await screen.findByText('Historical consensus')).toBeInTheDocument();
  expect(screen.getByText('Historical overall assessment.')).toBeInTheDocument();
  expect(screen.getByText('Stale')).toBeInTheDocument();
  expect(screen.getByText(/stale or predates lifecycle tracking/i)).toBeInTheDocument();
});

test('lists submitted reviewer names and accepted affiliations beside the anonymous synthesis', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{
        proposalId: 'req1',
        reviewers: [{
          suggestionId: 'g1',
          name: 'John Hackett',
          reviewerAffiliation: 'Florida International University',
          affiliation: 'Prior Institution',
          reviewReceivedAt: '2026-08-10T00:00:00Z',
          answers: [],
        }],
        reviewSynthesis: {
          consensus: ['A reviewer found the approach compelling.'],
          disagreements: [],
          keyConcerns: [],
          ratingSummaries: [],
          overall: 'The reviewers were positive overall.',
        },
        reviewSynthesisState: { current: true },
      }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);

  expect(await screen.findByText((_, element) => (
    element.tagName === 'LI'
      && element.textContent === 'John Hackett — Florida International University'
  ))).toBeInTheDocument();
  expect(screen.getByText('A reviewer found the approach compelling.')).toBeInTheDocument();
  expect(screen.queryByText('Prior Institution')).not.toBeInTheDocument();
});

test('manual early generation requires confirmation and sends confirmEarly:true', async () => {
  const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);
  const proposal = {
    proposalId: 'req1',
    reviewers: [{
      suggestionId: 'g1',
      name: 'Dr. Submitted',
      reviewReceivedAt: '2026-07-20T00:00:00Z',
      answers: [],
    }],
    reviewSynthesis: null,
    reviewSynthesisState: {
      current: false,
      status: 'not_started',
      ready: false,
      canRunManually: true,
      submittedCount: 1,
      blockingCount: 1,
    },
  };
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, proposals: [proposal] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, synthesis: { overall: 'Generated' } }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, proposals: [proposal] }),
    });

  render(<ReviewsTab requestId="req1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate synthesis' }));

  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/before every participating reviewer is resolved/i));
  const post = fetch.mock.calls.find(([url, options]) =>
    url === '/api/review-manager/synthesize-reviews' && options?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({
    requestId: 'req1',
    overwrite: false,
    confirmEarly: true,
  });
  confirmSpy.mockRestore();
});

test('refreshes stored output and shows an actionable warning after partial tracking failure', async () => {
  const initial = {
    proposalId: 'req1',
    reviewers: [{
      suggestionId: 'g1',
      name: 'Dr. Submitted',
      reviewReceivedAt: '2026-07-20T00:00:00Z',
      answers: [],
    }],
    reviewSynthesis: null,
    reviewSynthesisState: {
      current: false,
      status: 'not_started',
      ready: true,
      canRunManually: true,
      submittedCount: 1,
      blockingCount: 0,
    },
  };
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, proposals: [initial] }),
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({
        ok: false,
        reason: 'tracking_completion_failed',
        writtenToDynamics: true,
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        proposals: [{
          ...initial,
          reviewSynthesis: {
            consensus: ['Saved despite tracking failure'],
            disagreements: [],
            keyConcerns: [],
            ratingSummaries: [],
            overall: 'Refresh recovered the memo.',
          },
        }],
      }),
    });

  render(<ReviewsTab requestId="req1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate synthesis' }));

  expect(await screen.findByText(/saved, but its generation status could not be recorded/i))
    .toBeInTheDocument();
  expect(await screen.findByText('Saved despite tracking failure')).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('terminal reviewers are excluded from Outstanding even without reviewReceivedAt', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      proposals: [{
        proposalId: 'req1',
        reviewers: [
          { suggestionId: 'pending', name: 'Dr. Pending', reviewStatus: 'materials_sent' },
          { suggestionId: 'withdrew', name: 'Dr. Withdrew', reviewStatus: 'withdrew' },
          { suggestionId: 'released', name: 'Dr. Released', reviewStatus: 'released' },
        ],
      }],
    }),
  });

  render(<ReviewsTab requestId="req1" />);

  expect(await screen.findByText(/Outstanding \(1\)/)).toBeInTheDocument();
  expect(screen.getByText('Dr. Pending')).toBeInTheDocument();
  expect(screen.queryByText('Dr. Withdrew')).not.toBeInTheDocument();
  expect(screen.queryByText('Dr. Released')).not.toBeInTheDocument();
});

test('Phase 3: only the Word export affordance appears once a review is submitted', async () => {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: REVIEWERS }] }),
  });

  render(<ReviewsTab requestId="req1" />);

  expect(await screen.findByText('Export:')).toBeInTheDocument();
  expect(screen.getByText('Word (.docx)')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'PDF' })).not.toBeInTheDocument();
});

test('opens the dedicated full manual-entry rescue from Outstanding and refreshes after success', async () => {
  const pending = {
    suggestionId: '11111111-1111-4111-8111-111111111111',
    name: 'Dr. Portal Trouble',
    affiliation: 'Original University',
    reviewStatus: 'materials_sent',
  };
  fetch
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, proposals: [{ proposalId: 'req1', reviewers: [pending] }] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        setVersion: 'v1',
        affiliation: 'Authoritative University',
        questions: [
          { key: 'affiliation', order: 0, label: 'Affiliation', type: 'string', required: true },
          { key: 'comments', order: 1, label: 'Comments', type: 'richtext', required: true },
        ],
      }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, receivedAt: '2026-07-22T12:00:00Z' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        proposals: [{
          proposalId: 'req1',
          reviewers: [{ ...pending, reviewReceivedAt: '2026-07-22T12:00:00Z', answers: [] }],
        }],
      }),
    });

  render(<ReviewsTab requestId="req1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enter review manually' }));

  expect(await screen.findByText(/Recording a complete review for Dr. Portal Trouble/i)).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /Affiliation/i })).toHaveValue('Authoritative University');
  fireEvent.change(screen.getByRole('textbox', { name: /Comments/i }), { target: { value: '<p>Review received by email.</p>' } });

  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  expect(await screen.findByText(/1 of 1 accepted reviewer submitted a review/i)).toBeInTheDocument();

  const post = fetch.mock.calls.find(([url, options]) =>
    url === '/api/review-manager/manual-review-entry' && options?.method === 'POST');
  expect(JSON.parse(post[1].body)).toEqual({
    suggestionId: pending.suggestionId,
    answers: {
      affiliation: 'Authoritative University',
      comments: '<p>Review received by email.</p>',
    },
    setVersion: 'v1',
  });
});
