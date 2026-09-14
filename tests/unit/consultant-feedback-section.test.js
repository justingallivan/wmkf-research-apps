/**
 * ConsultantFeedbackSection — default-checked share box, add-person expands
 * fields, delete confirms once (docs/plans/CONSULTANT_FEEDBACK_PLAN_2026-09-14.md §3.5, §7).
 *
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConsultantFeedbackSection, { formBelongsToCurrentRequest } from '../../shared/components/workbench/ConsultantFeedbackSection';

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

test('previewReadOnly disables the Add feedback button', async () => {
  mockFetchSequence();
  render(<ConsultantFeedbackSection requestId={REQUEST_ID} previewReadOnly />);
  await waitFor(() => expect(screen.getByText('No consultant feedback recorded yet.')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Add feedback' })).toBeDisabled();
});
