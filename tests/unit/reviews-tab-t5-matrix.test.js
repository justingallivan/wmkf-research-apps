/**
 * @jest-environment jsdom
 *
 * ReviewsTab — T5 client-request-layer matrix (Stage 5a). Fills the gaps the
 * existing reviews-tab.test.js / reviews-tab-refresh-lifecycle.test.js suites
 * don't already pin, ahead of migrating the file's 3 non-blob fetch sites
 * onto shared/utils/api-request.js (the export-reviews blob download at
 * :318 stays raw, allowlisted per plan §2.6):
 *   - load                GET  /api/review-manager/reviewers
 *   - generate (synthesis) POST /api/review-manager/synthesize-reviews
 *   - review-due reminder preview + explicit send in the shared composer
 *
 * All three already parse with `.json().catch(() => ({}))`, so a malformed
 * or empty body was already tolerant pre-migration at both 2xx and non-2xx —
 * axis (e) (a 502 with an unparseable body) is pinned here as a no-op
 * behavior change, never silent.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ReviewsTab from '../../shared/components/workbench/ReviewsTab';

jest.mock('../../shared/components/Layout', () => ({
  __esModule: true,
  default: ({ children }) => <div>{children}</div>,
  Card: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../shared/components/external/RichReviewEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel, disabled }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
  ),
}));

const REQUEST_ID = 'req-t5';

const PROPOSAL = {
  proposalId: REQUEST_ID,
  reviewers: [{
    suggestionId: 'reviewer-1',
    name: 'Dr. Pending',
    reviewStatus: 'materials_sent',
    materialsSentAt: '2026-08-01T00:00:00Z',
    reminderCount: 0,
    reviewDueReminderEligibility: 'eligible',
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

function reviewersOk(proposal = PROPOSAL) {
  return { ok: true, status: 200, json: async () => ({ success: true, proposals: [proposal], liveQuestions: [] }) };
}

const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

// --- reviewers GET ---------------------------------------------------

test('reviewers GET: 2xx success renders the reviewer row', async () => {
  global.fetch = jest.fn().mockResolvedValue(reviewersOk());
  render(<ReviewsTab requestId={REQUEST_ID} />);
  expect(await screen.findByText('Dr. Pending')).toBeInTheDocument();
});

async function findByTextContent(text) {
  await waitFor(() => {
    expect(document.querySelector('.text-amber-700')?.textContent).toBe(text);
  });
}

test('reviewers GET: non-2xx {error} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false, status: 403, json: async () => ({ error: 'Forbidden' }),
  });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await findByTextContent("Couldn’t load reviews: Forbidden");
});

test('reviewers GET: network rejection surfaces the rejection message', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await findByTextContent("Couldn’t load reviews: network down");
});

test('reviewers GET: malformed 2xx body (bare .json().catch) falls back to today\'s status message', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await findByTextContent("Couldn’t load reviews: Failed to load reviews (200)");
});

test('reviewers GET axis (e): 502 with an unparseable body is never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: unparseable });
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await findByTextContent("Couldn’t load reviews: Failed to load reviews (502)");
});

// --- synthesize-reviews POST ------------------------------------------

async function renderReady() {
  global.fetch = jest.fn().mockResolvedValue(reviewersOk());
  render(<ReviewsTab requestId={REQUEST_ID} />);
  await screen.findByText('Dr. Pending');
}

test('synthesize POST: 2xx success clears busy state and reloads', async () => {
  await renderReady();
  global.fetch.mockResolvedValueOnce(reviewersOk()); // won't be hit again; queue below
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('synthesize-reviews')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    return Promise.resolve(reviewersOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate synthesis' })).not.toBeDisabled());
});

test('synthesize POST: non-2xx body-flag reason maps to durable copy (verbatim)', async () => {
  await renderReady();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('synthesize-reviews')) {
      return Promise.resolve({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'already_exists' }) });
    }
    return Promise.resolve(reviewersOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  expect(await screen.findByText(/A synthesis already exists/i)).toBeInTheDocument();
});

test('synthesize POST: network rejection is never silent', async () => {
  await renderReady();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('synthesize-reviews')) return Promise.reject(new Error('offline'));
    return Promise.resolve(reviewersOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('synthesize POST axis (e): 502 unparseable body falls to the generic failure copy, never silent', async () => {
  await renderReady();
  global.fetch = jest.fn((url) => {
    if (String(url).includes('synthesize-reviews')) return Promise.resolve({ ok: false, status: 502, json: unparseable });
    return Promise.resolve(reviewersOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  expect(await screen.findByText('Failed to generate synthesis.')).toBeInTheDocument();
});

test('synthesize POST: request bytes (url, method, headers, exact body) unchanged', async () => {
  await renderReady();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('synthesize-reviews')) {
      captured = [url, opts];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    return Promise.resolve(reviewersOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Generate synthesis' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/review-manager/synthesize-reviews');
  expect(opts.method).toBe('POST');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({ requestId: REQUEST_ID, overwrite: false, confirmEarly: false }));
});

// --- review-due reminder composer -------------------------------------

const REMINDER_TEMPLATE = { subject: 'Review reminder', body: '{{greeting}} {{reviewDueDate}} {{signature}}' };
const REMINDER_DRAFT = {
  name: 'Dr. Pending', from: 'pd@example.org', to: 'reviewer@example.org', senderId: 'pd-1',
  subject: REMINDER_TEMPLATE.subject, previewHtml: '<p>Due soon</p>', template: REMINDER_TEMPLATE, proof: 'proof-1',
};
function installReminderFetch(sendResult = { ok: true, status: 200, json: async () => ({ ok: true }) }) {
  global.fetch = jest.fn((url, opts) => {
    if (String(url).includes('reminder-email-preferences?')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, ownSystemId: 'pd-1' }) });
    if (String(url).includes('send-review-reminder')) {
      const body = JSON.parse(opts.body);
      if (body.action === 'preview') return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, draft: REMINDER_DRAFT }) });
      return typeof sendResult === 'function' ? sendResult() : Promise.resolve(sendResult);
    }
    return Promise.resolve(reviewersOk());
  });
}
async function sendFromPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  const sendButtons = screen.getAllByRole('button', { name: 'Send reminder' });
  fireEvent.click(sendButtons[sendButtons.length - 1]);
}

test('Workbench review-due reminder previews before a proof-bound send', async () => {
  await renderReady();
  installReminderFetch();
  fireEvent.click(screen.getByRole('button', { name: 'Send reminder' }));
  expect(await screen.findByText('Email preview')).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url, opts]) => String(url).includes('send-review-reminder') && JSON.parse(opts.body).action === 'send')).toHaveLength(0);
  const sendButtons = screen.getAllByRole('button', { name: 'Send reminder' });
  fireEvent.click(sendButtons[sendButtons.length - 1]);
  expect(await screen.findByText('Sent for delivery.')).toBeInTheDocument();
  const actions = global.fetch.mock.calls.filter(([url]) => String(url).includes('send-review-reminder')).map(([, opts]) => JSON.parse(opts.body));
  expect(actions).toEqual([
    { requestId: REQUEST_ID, suggestionId: 'reviewer-1', kind: 'reviewdue', action: 'preview' },
    { requestId: REQUEST_ID, suggestionId: 'reviewer-1', kind: 'reviewdue', action: 'send', template: REMINDER_TEMPLATE, proof: 'proof-1' },
  ]);
});

test('an unconfirmed send stays uncertain in the composer', async () => {
  await renderReady();
  installReminderFetch({ ok: false, status: 502, json: async () => ({ ok: false, reason: 'send_unconfirmed' }) });
  await sendFromPreview();
  expect(await screen.findByText(/Dynamics did not confirm the send/i)).toBeInTheDocument();
});

test('a network rejection after explicit Send stays uncertain', async () => {
  await renderReady();
  installReminderFetch(() => Promise.reject(new Error('offline')));
  await sendFromPreview();
  expect(await screen.findByText(/The app could not confirm the result/i)).toBeInTheDocument();
});

test('an unparseable send failure is visible', async () => {
  await renderReady();
  installReminderFetch({ ok: false, status: 502, json: unparseable });
  await sendFromPreview();
  expect(await screen.findByText(/Could not send the reminder/i)).toBeInTheDocument();
});
