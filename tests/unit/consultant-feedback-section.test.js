/**
 * ConsultantFeedbackSection — default-checked share box, add-person expands
 * fields, delete confirms once (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.5, §7).
 *
 * @jest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react';
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

test('an old request save cannot clear a newer request save that is still in flight', async () => {
  let resolveFirstPost;
  let resolveSecondPost;
  const firstPost = new Promise((resolve) => { resolveFirstPost = resolve; });
  const secondPost = new Promise((resolve) => { resolveSecondPost = resolve; });
  let postCount = 0;
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'POST') {
      postCount += 1;
      return postCount === 1 ? firstPost : secondPost;
    }
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

  // Start a second save for B before A's stale response arrives.
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Grace Hopper');
  await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Current request note.');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  // A's completion must not clear B's current-generation busy state.
  await act(async () => { resolveFirstPost(jsonResponse({ item: { id: '1' } })); });
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();

  await act(async () => { resolveSecondPost(jsonResponse({ item: { id: '2' } })); });
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument());
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
    expect(screen.getByRole('link', { name: 'Open notes.pdf' })).toHaveAttribute(
      'href',
      `/api/workbench/consultant-feedback/attachment?requestId=${REQUEST_ID}&entryId=5`,
    );

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

  test('upload progress from request A cannot paint request B state', async () => {
    let reportProgress;
    let resolvePut;
    const pendingPut = new Promise((resolve) => { resolvePut = resolve; });
    put.mockImplementationOnce((_pathname, _file, options) => {
      reportProgress = options.onUploadProgress;
      return pendingPut;
    });
    global.fetch = jest.fn((url) => {
      const href = String(url);
      if (href.includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
      if (href.includes('/upload-token')) {
        return Promise.resolve(jsonResponse({ ok: true, stagingId: 'staging-1', pathname: 'x', clientToken: 'tok', contentType: 'application/pdf' }));
      }
      if (href.includes('/finalize')) return Promise.resolve(jsonResponse({ ok: true }));
      return Promise.resolve(jsonResponse({ items: [] }));
    });

    const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await screen.findByText('No consultant feedback recorded yet.');
    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
    await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
    await userEvent.upload(document.getElementById('consultant-feedback-attachment'), pdfFile());
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(put).toHaveBeenCalled());

    rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
    await screen.findByText('No consultant feedback recorded yet.');
    await act(async () => {
      reportProgress({ percentage: 37 });
      resolvePut({});
    });
    expect(screen.queryByText('Uploading… 37%')).not.toBeInTheDocument();
    expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/finalize'))).toBe(false);
  });
});

describe('slice 3 polish', () => {
  const ITEMS = [
    {
      id: '9', receivedOn: '2026-09-01', bodyHtml: '<p>Shared note.</p>', shared: true,
      consultant: { rosterId: 1, name: 'Ada Lovelace', affiliation: 'Analytical Engines' }, oneOff: false,
      attachment: { requestdocumentId: 'doc-1', filename: 'ada.pdf', contentType: 'application/pdf', size: 10 },
      updatedAt: '2026-09-01T00:00:00Z',
    },
    {
      id: '10', receivedOn: '2026-09-02', bodyHtml: '<p>Private note.</p>', shared: false,
      consultant: { rosterId: 2, name: 'Grace Hopper', affiliation: 'US Navy' }, oneOff: false,
      attachment: { requestdocumentId: 'doc-2', filename: 'grace.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 20 },
      updatedAt: '2026-09-02T00:00:00Z',
    },
  ];

  test('filters All/Shared/Not shared locally with honest counts', async () => {
    mockFetchSequence({ items: ITEMS });
    render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'All (2)' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Shared (1)' }));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Not shared (1)' }));
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'All (2)' }));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  test('resets the local visibility filter to All when the request changes', async () => {
    mockFetchSequence({ items: ITEMS });
    const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await screen.findByText('Ada Lovelace');

    await userEvent.click(screen.getByRole('button', { name: 'Shared (1)' }));
    expect(screen.queryByText('Grace Hopper')).not.toBeInTheDocument();

    rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'All (2)' })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });

  test('hides request A rows synchronously while request B is still loading', async () => {
    let resolveSecondRequest;
    const secondRequest = new Promise((resolve) => { resolveSecondRequest = resolve; });
    global.fetch = jest.fn((url) => {
      const href = String(url);
      if (href.includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
      if (href.includes(OTHER_REQUEST_ID)) return secondRequest;
      return Promise.resolve(jsonResponse({ items: [ITEMS[0]] }));
    });

    const { rerender } = render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    const oldLink = await screen.findByRole('link', { name: 'Open ada.pdf' });
    expect(oldLink).toHaveAttribute('href', expect.stringContaining(REQUEST_ID));

    rerender(<ConsultantFeedbackSection requestId={OTHER_REQUEST_ID} />);
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open ada.pdf' })).not.toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    await act(async () => {
      resolveSecondRequest(jsonResponse({ items: [ITEMS[1]] }));
    });
    await waitFor(() => expect(screen.getByText('Grace Hopper')).toBeInTheDocument());
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download grace.docx' })).toHaveAttribute(
      'href',
      `/api/workbench/consultant-feedback/attachment?requestId=${OTHER_REQUEST_ID}&entryId=10`,
    );
  });

  test('attachment links use only request and entry identity; PDF opens a new tab and DOCX downloads in place', async () => {
    mockFetchSequence({ items: ITEMS });
    render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    const pdf = await screen.findByRole('link', { name: 'Open ada.pdf' });
    const docx = screen.getByRole('link', { name: 'Download grace.docx' });
    expect(pdf).toHaveAttribute('href', `/api/workbench/consultant-feedback/attachment?requestId=${REQUEST_ID}&entryId=9`);
    expect(pdf).toHaveAttribute('target', '_blank');
    expect(docx).toHaveAttribute('href', `/api/workbench/consultant-feedback/attachment?requestId=${REQUEST_ID}&entryId=10`);
    expect(docx).not.toHaveAttribute('target');
    expect(pdf.getAttribute('href')).not.toContain('drive');
    expect(pdf.getAttribute('href')).not.toContain('item');
  });

  test('the consultant chooser searches name/affiliation and supports Arrow, Enter, and Escape', async () => {
    mockFetchSequence({
      consultants: [
        { id: 1, name: 'Ada Lovelace', affiliation: 'Analytical Engines' },
        { id: 2, name: 'Grace Hopper', affiliation: 'US Navy' },
      ],
    });
    render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
    await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));

    const combobox = screen.getByRole('combobox', { name: 'Consultant' });
    await userEvent.type(combobox, 'Navy');
    expect(screen.getByRole('option', { name: /Grace Hopper/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ada Lovelace/ })).not.toBeInTheDocument();
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(combobox).toHaveValue('Grace Hopper');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');

    await userEvent.keyboard('{ArrowDown}');
    expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(combobox).toHaveAttribute('aria-expanded', 'false');
    expect(combobox).toHaveValue('Grace Hopper');
  });
});

test('previewReadOnly disables the Add feedback button', async () => {
  mockFetchSequence();
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} previewReadOnly />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add feedback' })).toBeDisabled();
});

// --- Stage 2 T2 contract matrix (client-request-layer migration pins) ---
//
// This file had no failure-path coverage at all before this pass: every
// existing test mocks only 2xx responses. These tests pin the visible
// outcome of every ConsultantFeedbackSection fetch site under a non-2xx
// response (including the dynamic `(${status})` fallback text three sites
// build), a network rejection, a malformed 2xx body (tolerant sites), and
// the upload-token body-level `ok` flag and delete's
// `attachment_removal_pending` body-flag branch. Run green against the
// UNMIGRATED component and again, unchanged, after migration onto
// shared/utils/api-request.js. See
// docs/plans/CLIENT_REQUEST_LAYER_PLAN_2026-09-19.md §5/§6.

function sampleEntry(overrides = {}) {
  return {
    id: '9', receivedOn: '2026-09-01', bodyHtml: '<p>Great work.</p>', shared: true,
    consultant: { rosterId: 1, name: 'Ada Lovelace', affiliation: 'Analytical Engines' }, oneOff: false,
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

test('T2 load(): non-2xx entries response surfaces the dynamic status fallback', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.resolve(jsonResponse({}, false));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Failed to load consultant feedback (400)')).toBeInTheDocument());
});

test('T2 load(): non-2xx entries response with a body error uses that message', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.resolve(jsonResponse({ error: 'entries down for maintenance' }, false));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('entries down for maintenance')).toBeInTheDocument());
});

test('T2 load(): a network rejection on either fetch surfaces the raw error message', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.reject(new Error('network down'));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
});

test('T2 load(): a malformed 2xx entries body is tolerated as {} (no crash, empty list)', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    return Promise.resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } });
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.queryByText(/failed to load/i)).not.toBeInTheDocument();
});

test('T2 load(): consultants non-2xx is silent (no error, empty roster) — branches on ok without throwing', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ error: 'roster down' }, false));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.queryByText(/roster down/i)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('combobox'));
  expect(screen.getByRole('listbox').children).toHaveLength(1);
  expect(screen.getByText('No matching consultants.')).toBeInTheDocument();
});

test('T2 handleSave PATCH (edit): non-2xx with no body error uses the dynamic status fallback', async () => {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'PATCH') return Promise.resolve(jsonResponse({}, false));
    return Promise.resolve(jsonResponse({ items: [sampleEntry()] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('Save failed (400)')).toBeInTheDocument());
});

test('T2 handleSave POST (create): non-2xx with a body error uses that message', async () => {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'POST' && String(url) === '/api/workbench/consultant-feedback') {
      return Promise.resolve(jsonResponse({ error: 'duplicate mutation' }, false));
    }
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Great work.');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('duplicate mutation')).toBeInTheDocument());
});

test('T2 handleSave: a network rejection surfaces the raw error message', async () => {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'POST' && String(url) === '/api/workbench/consultant-feedback') {
      return Promise.reject(new Error('network down'));
    }
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.type(screen.getByRole('textbox', { name: 'Consultant feedback' }), 'Great work.');
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
});

test('T2 upload-token: a 2xx body with {ok:false} still throws (body-level flag branch)', async () => {
  put.mockClear();
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (String(url).includes('/upload-token')) {
      return Promise.resolve(jsonResponse({ ok: false, error: 'upload window closed' }));
    }
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.upload(document.getElementById('consultant-feedback-attachment'), pdfFile());
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('upload window closed')).toBeInTheDocument());
  expect(put).not.toHaveBeenCalled();
});

test('T2 finalize (attachment-only create): non-2xx falls back to the fixed attachment message', async () => {
  put.mockResolvedValue({});
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (String(url).includes('/upload-token')) {
      return Promise.resolve(jsonResponse({ ok: true, stagingId: 'staging-1', pathname: 'x', clientToken: 'tok', contentType: 'application/pdf' }));
    }
    if (String(url).includes('/finalize')) return Promise.resolve(jsonResponse({}, false));
    return Promise.resolve(jsonResponse({ items: [] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Add feedback' }));
  await userEvent.click(screen.getByRole('button', { name: 'Add person…' }));
  await userEvent.type(screen.getByPlaceholderText('Name'), 'Jane Doe');
  await userEvent.upload(document.getElementById('consultant-feedback-attachment'), pdfFile());
  await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByText('The attachment could not be saved.')).toBeInTheDocument());
});

test('T2 handleDelete: attachment_removal_pending clears the row via reload (the branch never throws)', async () => {
  // The branch calls setError('Attachment removed, delete again.') and then
  // immediately await load(), whose own setError(null) at the top of the
  // same synchronous call wins the batch — so today this message never
  // renders; the observable outcome is just the reload clearing the row
  // with no error surfaced. This test pins that ACTUAL behavior, not the
  // apparent intent of the inline comment.
  let deleteAttempts = 0;
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'DELETE') {
      deleteAttempts += 1;
      return Promise.resolve(jsonResponse({ error: 'attachment removal pending', reason: 'attachment_removal_pending' }, false));
    }
    return Promise.resolve(jsonResponse({ items: deleteAttempts > 0 ? [] : [sampleEntry()] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.queryByText(/attachment removed/i)).not.toBeInTheDocument();
});

test('T2 handleDelete: a generic non-2xx with no body error uses the dynamic status fallback', async () => {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'DELETE') return Promise.resolve(jsonResponse({}, false));
    return Promise.resolve(jsonResponse({ items: [sampleEntry()] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.getByText('Delete failed (400)')).toBeInTheDocument());
});

test('T2 handleDelete: a network rejection surfaces the raw error message', async () => {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/consultants')) return Promise.resolve(jsonResponse({ items: [] }));
    if (options?.method === 'DELETE') return Promise.reject(new Error('network down'));
    return Promise.resolve(jsonResponse({ items: [sampleEntry()] }));
  });
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} />);
  await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await userEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(screen.getByText('network down')).toBeInTheDocument());
});
