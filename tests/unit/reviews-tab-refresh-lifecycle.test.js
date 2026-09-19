/**
 * @jest-environment jsdom
 *
 * S3 same-request refresh and retained child lifetime regressions.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    />
  ),
}));

const REQUEST_ID = 'req-s3-refresh';
const REVIEWER = {
  suggestionId: 'reviewer-s3-refresh',
  name: 'Baseline Reviewer',
  reviewReceivedAt: '2026-09-18T00:00:00Z',
  reviewerOverallAssessment: 5,
  answers: [],
};

const PROPOSAL = {
  proposalId: REQUEST_ID,
  reviewers: [REVIEWER],
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

const FULL_PROPOSAL = {
  ...PROPOSAL,
  reviewers: [
    ...PROPOSAL.reviewers,
    { suggestionId: 'reviewer-s3-pending', name: 'Pending Reviewer', reviewStatus: 'materials_sent' },
  ],
};

function reviewerResponse(proposal = FULL_PROPOSAL) {
  return { success: true, proposals: [proposal], liveQuestions: [] };
}

afterEach(() => {
  jest.restoreAllMocks();
});

test('same-mount synthesis success retains the full review surface during a held refresh', async () => {
  let reviewerGets = 0;
  let resolveRefresh;
  const refreshPending = new Promise((resolve) => {
    resolveRefresh = resolve;
  });

  jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets === 1) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, proposals: [PROPOSAL], liveQuestions: [{ key: 'q1', text: 'Question one' }] }),
        });
      }
      return refreshPending;
    }
    if (href === '/api/review-manager/synthesize-reviews' && options.method === 'POST') {
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true }),
      });
    }
    if (href.includes('/api/workbench/consultant-feedback/consultants')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    if (href.includes('/api/workbench/consultant-feedback?requestId=')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  render(<ReviewsTab requestId={REQUEST_ID} />);

  expect((await screen.findAllByText('Baseline Reviewer')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));

  await waitFor(() => expect(reviewerGets).toBe(2));
  expect(screen.getAllByText('Baseline Reviewer').length).toBeGreaterThan(0);
  expect(document.querySelector('.animate-spin')).toBeNull();
  expect(screen.getByText(/Updating reviews/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generate synthesis' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/review-manager/synthesize-reviews')).toHaveLength(1);

  await act(async () => {
    resolveRefresh({
      ok: true,
      json: async () => ({ success: true, proposals: [PROPOSAL] }),
    });
    await Promise.resolve();
  });
});

test.each([
  ['ordinary failure', 500, { error: 'temporary outage' }, true],
  ['denial', 403, { error: 'forbidden' }, false],
  ['unauthenticated', 401, { error: 'sign in' }, false],
  ['null proposal', 200, { success: true, proposals: [null] }, false],
  ['invalid roster', 200, { success: true, proposals: [{ ...PROPOSAL, reviewers: {} }] }, false],
  ['null reviewer', 200, { success: true, proposals: [{ ...PROPOSAL, reviewers: [null] }] }, false],
  ['malformed wrong-context success', 200, { success: true, proposals: [{ proposalId: 'other-request', reviewers: [] }] }, false],
])('seeded refresh %s retains or clears the protected snapshot', async (_label, status, body, retains) => {
  let reviewerGets = 0;
  jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets === 1) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [PROPOSAL], liveQuestions: [] }) });
      }
      return Promise.resolve({ ok: status === 200, status, json: async () => body });
    }
    if (href === '/api/review-manager/synthesize-reviews' && options.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (href.includes('/api/workbench/consultant-feedback')) {
      return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    }
    throw new Error(`Unexpected fetch: ${href}`);
  });

  render(<ReviewsTab requestId={REQUEST_ID} />);
  expect((await screen.findAllByText('Baseline Reviewer')).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reviewerGets).toBe(2));
  if (retains) {
    expect(screen.getAllByText('Baseline Reviewer').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  } else {
    expect(screen.queryByText('Baseline Reviewer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate synthesis' })).not.toBeInTheDocument();
  }
});

test('manual draft survives refresh and manual success keeps the form until its awaited GET settles', async () => {
  let reviewerGets = 0;
  let releaseRefresh;
  const refreshReady = new Promise((resolve) => { releaseRefresh = resolve; });
  jest.spyOn(global, 'fetch').mockImplementation((url, options = {}) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets > 1) return refreshReady.then(() => ({ ok: true, json: async () => reviewerResponse() }));
      return Promise.resolve({ ok: true, json: async () => reviewerResponse() });
    }
    if (href.includes('/api/review-manager/manual-review-entry') && options.method === 'POST') {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    if (href.includes('/api/review-manager/manual-review-entry')) {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, setVersion: 'v1', questions: [{ key: 'q1', order: 1, label: 'Question one', type: 'richtext', required: true, maxLength: 500 }] }) });
    }
    if (href === '/api/review-manager/synthesize-reviews') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    if (href.includes('/api/workbench/consultant-feedback')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    throw new Error(`Unexpected fetch: ${href}`);
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Enter review manually' }));
  const draft = await screen.findByLabelText('Question one');
  fireEvent.change(draft, { target: { value: 'Keep this draft.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reviewerGets).toBe(2));
  expect(screen.getByLabelText('Question one')).toHaveValue('Keep this draft.');
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  await waitFor(() => expect(reviewerGets).toBe(3));
  expect(screen.getByLabelText('Question one')).toBeInTheDocument();
  releaseRefresh();
  await waitFor(() => expect(screen.queryByLabelText('Question one')).not.toBeInTheDocument());
});

test('held copy completes on the retained writeup card during refresh', async () => {
  let releaseCopy;
  const copyReady = new Promise((resolve) => { releaseCopy = resolve; });
  let reviewerGets = 0;
  let releaseRefresh;
  const refreshReady = new Promise((resolve) => { releaseRefresh = resolve; });
  const write = jest.fn(() => copyReady);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
  window.ClipboardItem = function ClipboardItem(items) { this.items = items; };
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets > 1) return refreshReady.then(() => ({ ok: true, json: async () => reviewerResponse() }));
      return Promise.resolve({ ok: true, json: async () => reviewerResponse() });
    }
    if (href === '/api/review-manager/synthesize-reviews') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    if (href.includes('/api/workbench/consultant-feedback')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    throw new Error(`Unexpected fetch: ${href}`);
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reviewerGets).toBe(2));
  releaseCopy();
  await screen.findByRole('button', { name: 'Copied' });
  releaseRefresh();
});

test('held Word export remains disabled through refresh and downloads once released', async () => {
  let releaseExport;
  const exportReady = new Promise((resolve) => { releaseExport = resolve; });
  let releaseRefresh;
  const refreshReady = new Promise((resolve) => { releaseRefresh = resolve; });
  let reviewerGets = 0;
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  global.URL.createObjectURL = jest.fn(() => 'blob:reviews');
  global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets > 1) return refreshReady.then(() => ({ ok: true, json: async () => reviewerResponse() }));
      return Promise.resolve({ ok: true, json: async () => reviewerResponse() });
    }
    if (href.includes('/api/review-manager/export-reviews')) return exportReady.then(() => ({ ok: true, headers: { get: () => 'attachment; filename="reviews.docx"' }, blob: async () => new Blob(['doc']) }));
    if (href === '/api/review-manager/synthesize-reviews') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    if (href.includes('/api/workbench/consultant-feedback')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    throw new Error(`Unexpected fetch: ${href}`);
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Word (.docx)' }));
  const exportButton = screen.getByRole('button', { name: 'Generating…' });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reviewerGets).toBe(2));
  expect(exportButton).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generating…' })).toBe(exportButton);
  expect(exportButton).toBeDisabled();
  releaseExport();
  await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
  releaseRefresh();
});

test('consultant feedback draft survives a retained Reviews refresh', async () => {
  let reviewerGets = 0;
  let releaseRefresh;
  const refreshReady = new Promise((resolve) => { releaseRefresh = resolve; });
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      if (reviewerGets > 1) return refreshReady.then(() => ({ ok: true, json: async () => reviewerResponse() }));
      return Promise.resolve({ ok: true, json: async () => reviewerResponse() });
    }
    if (href === '/api/review-manager/synthesize-reviews') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    if (href.includes('/api/workbench/consultant-feedback/consultants')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    if (href.includes('/api/workbench/consultant-feedback')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    throw new Error(`Unexpected fetch: ${href}`);
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add feedback' }));
  const feedback = await screen.findByRole('textbox', { name: 'Consultant feedback' });
  fireEvent.change(feedback, { target: { value: 'Draft consultant note.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reviewerGets).toBe(2));
  expect(screen.getByRole('textbox', { name: 'Consultant feedback' })).toHaveValue('Draft consultant note.');
  releaseRefresh();
});

test('unmount during synthesis POST does not start a follow-up reviewers GET', async () => {
  let resolveSynthesis;
  const synthesis = new Promise((resolve) => { resolveSynthesis = resolve; });
  let reviewerGets = 0;
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/api/review-manager/reviewers?proposalId=')) {
      reviewerGets += 1;
      return Promise.resolve({ ok: true, json: async () => reviewerResponse() });
    }
    if (href === '/api/review-manager/synthesize-reviews') return synthesis;
    if (href.includes('/api/workbench/consultant-feedback')) return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
    throw new Error(`Unexpected fetch: ${href}`);
  });
  const view = render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate synthesis' }));
  view.unmount();
  resolveSynthesis({ ok: true, json: async () => ({ ok: true }) });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(reviewerGets).toBe(1);
});

test('accepts uppercase request ID with a lowercase proposal DTO', async () => {
  jest.spyOn(global, 'fetch').mockImplementation((url) => Promise.resolve({
    ok: true,
    json: async () => String(url).includes('/review-manager/reviewers?')
      ? reviewerResponse() : { items: [] },
  }));
  render(<ReviewsTab requestId={REQUEST_ID.toUpperCase()} />);
  expect((await screen.findAllByText('Baseline Reviewer')).length).toBeGreaterThan(0);
});

test('accepts a valid empty proposal result', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ success: true, proposals: [] }) });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await screen.findByText(/No reviews submitted yet/i);
});

test('a late old-request synthesis callback cannot replace the new request or start an old GET', async () => {
  let resolveSynthesis;
  const synthesis = new Promise((resolve) => { resolveSynthesis = resolve; });
  const reads = [];
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/review-manager/reviewers?')) {
      const id = new URL(href, 'http://test').searchParams.get('proposalId');
      reads.push(id);
      return Promise.resolve({ ok: true, json: async () => ({ success: true, proposals: [{ ...PROPOSAL, proposalId: id, reviewers: [{ ...REVIEWER, name: id === REQUEST_ID ? 'Baseline Reviewer' : 'New Reviewer' }] }] }) });
    }
    if (href === '/api/review-manager/synthesize-reviews') return synthesis;
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  });
  const view = render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate synthesis' }));
  view.rerender(<ReviewsTab requestId="request-b" />);
  await screen.findAllByText('New Reviewer');
  await act(async () => { resolveSynthesis({ ok: true, json: async () => ({ ok: true }) }); });
  expect(reads).toEqual([REQUEST_ID, 'request-b']);
  expect(screen.queryByText('Baseline Reviewer')).not.toBeInTheDocument();
  expect(screen.getAllByText('New Reviewer').length).toBeGreaterThan(0);
});

test('partial synthesis success waits for the held reload before showing its warning', async () => {
  let reads = 0;
  let release;
  const refresh = new Promise((resolve) => { release = resolve; });
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/review-manager/reviewers?')) {
      reads += 1;
      return reads === 1
        ? Promise.resolve({ ok: true, json: async () => reviewerResponse() }) : refresh;
    }
    if (href === '/api/review-manager/synthesize-reviews') return Promise.resolve({
      ok: false, status: 502,
      json: async () => ({ ok: false, writtenToDynamics: true, reason: 'tracking_completion_failed' }),
    });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(reads).toBe(2));
  expect(screen.queryByText(/saved, but its generation status could not be recorded/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Generating…' })).toBeDisabled();
  await act(async () => { release({ ok: true, json: async () => reviewerResponse() }); });
  await screen.findByText(/saved, but its generation status could not be recorded/i);
});


test('a sent reminder cannot be sent again while its refresh is held', async () => {
  let reads = 0;
  let release;
  const refresh = new Promise((resolve) => { release = resolve; });
  const body = { success: true, proposals: [{ ...PROPOSAL, reviewers: [{
    ...REVIEWER, reviewReceivedAt: null, reviewStatus: 'materials_sent',
    materialsSentAt: '2026-09-01', reviewDueReminderEligibility: 'eligible',
  }] }] };
  jest.spyOn(global, 'fetch').mockImplementation((url) => {
    const href = String(url);
    if (href.includes('/review-manager/reviewers?')) {
      reads += 1;
      return reads === 1 ? Promise.resolve({ ok: true, json: async () => body }) : refresh;
    }
    if (href === '/api/review-manager/send-review-reminder') return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send reminder' }));
  await waitFor(() => expect(reads).toBe(2));
  const reminder = screen.getByRole('button', { name: 'Send reminder' });
  expect(reminder).toBeDisabled();
  fireEvent.click(reminder);
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/review-manager/send-review-reminder')).toHaveLength(1);
  await act(async () => { release({ ok: true, json: async () => body }); });
});
