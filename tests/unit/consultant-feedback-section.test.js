/**
 * ConsultantFeedbackSection — default-checked share box, add-person expands
 * fields, delete confirms once (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.5, §7).
 *
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { put } from '@vercel/blob/client';
import ConsultantFeedbackSection, { formBelongsToCurrentRequest } from '../../shared/components/workbench/ConsultantFeedbackSection';

jest.mock('@vercel/blob/client', () => ({ put: jest.fn() }));

function pdfFile(name = 'notes.pdf') {
  return new File(['%PDF-'], name, { type: 'application/pdf' });
}

const OTHER_REQUEST_ID = '22222222-2222-4222-8222-222222222222';

// The real tiptap editor is exercised by manual-review-entry-form.test.js;
// stubbed here (same pattern as reviews-tab.test.js) so these tests can drive
// bodyHtml through a plain textarea instead.
jest.mock('../../shared/components/external/RichReviewEditor', () => ({
  __esModule: true,
  default: ({ value, onChange, ariaLabel }) => (
    <textarea aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body, ok = true) {
  return { ok, status: ok ? 200 : 400, json: async () => body };
}

function mockFetchSequence({ items = [], consultants = [] } = {}) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: consultants }));
    return Promise.resolve(jsonResponse({ items }));
  });
}

afterEach(() => jest.restoreAllMocks());

test('the "Shared on briefing page" checkbox defaults to checked on a new entry', async () => {
  mockFetchSequence();
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  expect(screen.getByRole('checkbox', { name: /Shared on briefing page/ })).toBeChecked();
});

test('"Add person…" expands name/affiliation fields instead of the roster dropdown', async () => {
  mockFetchSequence({ consultants: [{ id: 1, name: 'Ada Lovelace', affiliation: 'Analytical Engines' }] });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  expect(screen.getByRole('combobox')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Name')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  expect(screen.getByPlaceholderText('Name')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Affiliation (optional)')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('delete asks once inline before removing the row', async () => {
  mockFetchSequence({
    items: [{
      id: '9', receivedOn: '2026-09-01', bodyHtml: '<p>Great work.</p>', shared: true,
      consultant: { rosterId: 1, name: 'Ada Lovelace', affiliation: 'Analytical Engines' }, oneOff: false,
      updatedAt: '2026-09-01T00:00:00Z',
    }],
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  expect(screen.getByText('Delete this entry?')).toBeInTheDocument();
  expect(screen.queryByText('Ada Lovelace')).toBeInTheDocument(); // not yet removed

  global.fetch.mockImplementationOnce(() => Promise.resolve(jsonResponse({ ok: true, id: '9' })));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/consultant-feedback',
    expect.objectContaining({ method: 'DELETE' }),
  ));
});

test('a successful save clears "Saving…", closes the form, and Add feedback is enabled again on reopen', async () => {
  let saved = false;
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'POST') {
      saved = true;
      return Promise.resolve(jsonResponse({ item: { id: '1' } }));
    }
    // GET list: empty before save, one row after (post-save reload).
    return Promise.resolve(jsonResponse({ items: saved ? [{
      id: '1', receivedOn: '2026-09-01', bodyHtml: '<p>Great work.</p>', shared: true,
      consultant: { rosterId: null, name: 'Jane Doe', affiliation: null }, oneOff: true,
      updatedAt: '2026-09-01T00:00:00Z',
    }] : [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Great work.');

  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  // Form closed and reloaded with the new row.
  await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add feedback' })).toBeEnabled();

  // Reopening starts a fresh, non-stuck form.
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  const saveButton = screen.getByRole('button', { name: 'Save' });
  expect(saveButton).toBeEnabled();
  expect(saveButton).toHaveTextContent('Save');
});

test('a request switch mid-save clears "Saving…" so the next form is not wedged (round-4 finding 1)', async () => {
  let resolvePost;
  const postPromise = new Promise((resolve) => { resolvePost = resolve; });
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'POST') return postPromise;
    return Promise.resolve(jsonResponse({ items: [] }));
  });

  const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Great work.');
  // Fires the POST, which stays pending on `postPromise`.
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));

  // A request switch lands while the save is still in flight; belt 1 closes
  // the now-stale form immediately.
  rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  // The stale save's response finally arrives.
  resolvePost(jsonResponse({ item: { id: '1' } }));
  await waitFor(() => expect(global.fetch.mock.calls.some(([, o]) => o?.method === 'POST')).toBe(true));

  // Reopening a fresh form for the CURRENT request must not be wedged on
  // "Saving…" — this is the bug: the stale save's own early return used to
  // skip clearing it.
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  const saveButton = await screen.findByRole('button', { name: 'Save' });
  expect(saveButton).toBeEnabled();
  expect(saveButton).toHaveTextContent('Save');
});

test('ReviewsTab is not remounted per request, so a request switch closes any open form (§ round-3 finding 1)', async () => {
  mockFetchSequence();
  const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();

  rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
  // Synchronous, no waitFor: the requestId-change effect closes the form in
  // the same commit as the rerender.
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add feedback' })).toBeInTheDocument();
  // Let the new request's own load() settle before the test ends.
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
});

test('formBelongsToCurrentRequest (the guard handleSave calls before any fetch) rejects a stale form', () => {
  // Belt 1 (the requestId-change effect) closes the form synchronously in
  // this React/testing-library setup, which makes the underlying race
  // impossible to construct through the DOM here — verified directly:
  // rerendering to a different requestId with the form open removes the
  // Save button before any subsequent event can reach it. Belt 2's own
  // predicate is exercised directly instead, so a regression in the
  // comparison itself (e.g. someone loosens `===` to `==` or inverts it)
  // is still caught.
  expect(formBelongsToCurrentRequest(REQUEST_ID, REQUEST_ID)).toBe(true);
  expect(formBelongsToCurrentRequest(REQUEST_ID, OTHER_REQUEST_ID)).toBe(false);
  expect(formBelongsToCurrentRequest(null, REQUEST_ID)).toBe(false);
});

describe('slice 2 attachment', () => {
  beforeEach(() => put.mockReset());

  test('attachment-only save (no body) goes mint -> upload -> finalize with a newEntry, and the row appears with its filename', async () => {
    put.mockResolvedValue({});
    const calls = [];
    let finalized = false;
    global.fetch = jest.fn((url, options) => {
      calls.push({ url: String(url), method: options?.method });
      if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
      if (String(url).includes('/upload-token')) {
        return Promise.resolve(jsonResponse({ ok: true, stagingId: 'staging-1', pathname: 'portal-staging/x', clientToken: 'tok', contentType: 'application/pdf' }));
      }
      if (String(url).includes('/finalize')) {
        finalized = true;
        return Promise.resolve(jsonResponse({ ok: true, requestdocumentId: 'doc-1', feedbackId: '5' }));
      }
      return Promise.resolve(jsonResponse({
        items: finalized ? [{
          id: '5', receivedOn: '2026-09-01', bodyHtml: null, shared: true,
          consultant: { rosterId: null, name: 'Jane Doe', affiliation: null }, oneOff: true,
          attachment: { requestdocumentId: 'doc-1', filename: 'notes.pdf', contentType: 'application/pdf', size: 10 },
          updatedAt: '2026-09-01T00:00:00Z',
        }] : [],
      }));
    });
    render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
    await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
    // No body typed at all — attachment-only create.
    await userEvent.upload(document.getElementById('consultant-feedback-attachment'), pdfFile());

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('Attachment: notes.pdf')).toBeInTheDocument();

    const urls = calls.map((c) => c.url);
    expect(urls.some((u) => u.includes('/consultant-feedback') && !u.includes('/upload-token') && !u.includes('/finalize') && !u.includes('/consultants') && calls.find((c) => c.url === u)?.method === 'POST')).toBe(false);
    const tokenIdx = urls.findIndex((u) => u.includes('/upload-token'));
    const finalizeIdx = urls.findIndex((u) => u.includes('/finalize'));
    expect(tokenIdx).toBeGreaterThanOrEqual(0);
    expect(finalizeIdx).toBeGreaterThan(tokenIdx);
    expect(put).toHaveBeenCalledWith('portal-staging/x', expect.any(File), expect.objectContaining({ token: 'tok', access: 'private' }));

    const finalizeCallBody = JSON.parse(global.fetch.mock.calls.find(([u]) => String(u).includes('/finalize'))[1].body);
    expect(finalizeCallBody.newEntry.oneOff.name).toBe('Jane Doe');
    expect(finalizeCallBody.stagingId).toBe('staging-1');
  });

  test('body-only save (no attachment) never calls upload-token or finalize', async () => {
    let saved = false;
    global.fetch = jest.fn((url, options) => {
      if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
      if (options?.method === 'POST' && String(url) === '/api/workbench/consultant-feedback') {
        saved = true;
        return Promise.resolve(jsonResponse({ item: { id: '1' } }));
      }
      return Promise.resolve(jsonResponse({ items: saved ? [{
        id: '1', receivedOn: '2026-09-01', bodyHtml: '<p>Great work.</p>', shared: true,
        consultant: { rosterId: null, name: 'Jane Doe', affiliation: null }, oneOff: true,
        updatedAt: '2026-09-01T00:00:00Z',
      }] : [] }));
    });
    render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
    await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
    await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Great work.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/upload-token'))).toBe(false);
    expect(global.fetch.mock.calls.some(([u]) => String(u).includes('/finalize'))).toBe(false);
    expect(put).not.toHaveBeenCalled();
  });

  test('an in-flight attachment upload is abandoned on a request switch: no finalize, no put, for the stale request', async () => {
    let resolveToken;
    const tokenPromise = new Promise((resolve) => { resolveToken = resolve; });
    const calls = [];
    global.fetch = jest.fn((url, options) => {
      calls.push({ url: String(url), method: options?.method });
      if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
      if (String(url).includes('/upload-token')) return tokenPromise;
      if (String(url).includes('/finalize')) return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });

    const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
    await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
    await userEvent.upload(document.getElementById('consultant-feedback-attachment'), pdfFile());
    await userEvent.click(screen.getByRole('button', { name: 'Save' })); // fires upload-token, stays pending

    // A request switch lands while the mint is still in flight; belt 1
    // closes the now-stale form immediately (and bumps fetchIdRef via its
    // own load()).
    rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());

    resolveToken(jsonResponse({ ok: true, stagingId: 'staging-1', pathname: 'x', clientToken: 'tok', contentType: 'application/pdf' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/upload-token'))).toBe(true));
    // Let any further microtasks the stale save might have queued settle.
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    expect(put).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.includes('/finalize'))).toBe(false);

    // Reopening a fresh form for the CURRENT request is not wedged on "Saving…".
    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    const saveButton = await screen.findByRole('button', { name: 'Save' });
    expect(saveButton).toBeEnabled();
    expect(saveButton).toHaveTextContent('Save');
  });
});

test('previewReadOnly disables the Add feedback button', async () => {
  mockFetchSequence();
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} previewReadOnly />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add feedback' })).toBeDisabled();
});
