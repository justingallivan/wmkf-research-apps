/**
 * @jest-environment jsdom
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ReviewQuestionsSection from '../../shared/components/admin/ReviewQuestionsSection';

const GET_BODY = {
  questions: [
    { id: 'id-1', key: 'impact', label: 'Q1 impact', type: 'picklist', required: true, order: 0, options: [{ value: 1, label: 'Low' }, { value: 2, label: 'High' }] },
    { id: 'id-2', key: 'q2', label: 'Q2 narrative', type: 'richtext', required: true, order: 1 },
  ],
  version: 'v1',
};

function mockFetch({ postResponse } = {}) {
  return jest.fn(async (url, opts = {}) => {
    if (String(url) === '/api/admin/review-questions' && !opts.method) {
      return { ok: true, status: 200, json: async () => GET_BODY };
    }
    if (String(url) === '/api/admin/review-questions' && opts.method === 'POST') {
      return postResponse || { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { created: 0, updated: 1, deleted: 0, reordered: 0 }, version: 'v2' }) };
    }
    throw new Error(`unexpected fetch ${url} ${opts.method}`);
  });
}

beforeEach(() => { global.fetch = mockFetch(); });

test('renders rows; existing keys are locked, new rows get an editable key input', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  // Existing keys are shown locked (no key input for them).
  expect(screen.getByText(/key: impact/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Question key')).not.toBeInTheDocument();

  // Adding a row exposes an editable key input.
  fireEvent.click(screen.getByRole('button', { name: /add question/i }));
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(3));
  expect(screen.getByLabelText('Question key')).toBeInTheDocument();
});

test('save POSTs the full set + baseVersion, then reloads', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  // Edit Q2's text → becomes dirty.
  const q2 = within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text');
  fireEvent.change(q2, { target: { value: 'Q2 edited' } });

  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
    expect(post).toBeTruthy();
    const body = JSON.parse(post[1].body);
    expect(body.baseVersion).toBe('v1');
    expect(body.questions).toHaveLength(2);
    expect(body.questions[1]).toMatchObject({ id: 'id-2', key: 'q2', label: 'Q2 edited' });
  });
  // Reload after success: a second GET fired.
  await waitFor(() => {
    const gets = global.fetch.mock.calls.filter(([, o]) => !o?.method);
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });
});

test('a 409 set_changed shows a reload prompt instead of succeeding', async () => {
  global.fetch = mockFetch({ postResponse: { ok: false, status: 409, json: async () => ({ status: 'set_changed', error: 'The question set changed since you loaded it.' }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));

  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'changed' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  await waitFor(() => expect(screen.getByText(/changed since you loaded it/i)).toBeInTheDocument());
  expect(screen.getByRole('button', { name: /^Reload$/ })).toBeInTheDocument();
  // Codex P2: Save is disabled until reload (re-saving a stale version just 409s again).
  expect(screen.getByRole('button', { name: /reload to save/i })).toBeDisabled();
});

test('clicking Reload after a 409 re-fetches and re-enables editing', async () => {
  global.fetch = mockFetch({ postResponse: { ok: false, status: 409, json: async () => ({ status: 'set_changed', error: 'stale' }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(screen.getByRole('button', { name: /reload to save/i })).toBeInTheDocument());

  fireEvent.click(screen.getByRole('button', { name: /^Reload$/ }));
  // A fresh GET fired and the stale-reload lock cleared (button back to its normal label).
  await waitFor(() => {
    const gets = global.fetch.mock.calls.filter(([, o]) => !o?.method);
    expect(gets.length).toBeGreaterThanOrEqual(2);
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: /reload to save/i })).not.toBeInTheDocument());
});

test('a completed save with auditWritten:false surfaces a persistent audit warning', async () => {
  global.fetch = mockFetch({ postResponse: { ok: true, status: 200, json: async () => ({ status: 'completed', summary: { created: 0, updated: 1, deleted: 0, reordered: 0 }, version: 'v2', auditWritten: false }) } });
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  fireEvent.change(within(screen.getAllByTestId('rq-row')[1]).getByLabelText('Question text'), { target: { value: 'edited' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

  // The warning survives the post-save reload (it's separate from the transient message).
  await waitFor(() => expect(screen.getByTestId('rq-audit-warning')).toBeInTheDocument());
  expect(screen.getByTestId('rq-audit-warning')).toHaveTextContent(/audit record could not be written/i);
});

test('drag-to-reorder changes the submitted order', async () => {
  render(<ReviewQuestionsSection />);
  await waitFor(() => expect(screen.getAllByTestId('rq-row')).toHaveLength(2));
  const rowsEls = screen.getAllByTestId('rq-row');

  // Drag row 0 (impact) onto row 1 (q2) → order becomes [q2, impact].
  fireEvent.dragStart(rowsEls[0]);
  fireEvent.dragOver(rowsEls[1]);
  fireEvent.drop(rowsEls[1]);

  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => {
    const post = global.fetch.mock.calls.find(([, o]) => o?.method === 'POST');
    const body = JSON.parse(post[1].body);
    expect(body.questions.map((q) => q.key)).toEqual(['q2', 'impact']);
  });
});
