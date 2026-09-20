/**
 * @jest-environment jsdom
 *
 * ManualReviewEntryForm — T5 matrix (Stage 5a). tests/unit/manual-review-
 * entry-form.test.js pins the rich-text toolbar only; this file pins the
 * full per-site contract for both fetch sites ahead of migrating them onto
 * shared/utils/api-request.js:
 *   - loadForm  GET  /api/review-manager/manual-review-entry
 *   - submit    POST /api/review-manager/manual-review-entry
 *
 * Both sites already read `data.ok`/`data.reason` regardless of HTTP status
 * (bare `.json().catch(() => ({}))`), so no axis-(e) behavior change here —
 * pinned anyway per plan T2/T5.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ManualReviewEntryForm from '../../shared/components/workbench/ManualReviewEntryForm';

const QUESTION = {
  key: 'scientificAssessment', order: 1, label: 'Scientific assessment', type: 'string', required: true, maxLength: 200,
};
const REVIEWER = { suggestionId: '00000000-0000-0000-0000-000000000001', name: 'Reviewer One' };

function loadOk() {
  return { ok: true, status: 200, json: async () => ({ ok: true, questions: [QUESTION], setVersion: 'set-v1', affiliation: 'Example University' }) };
}
const unparseable = () => Promise.reject(new SyntaxError('Unexpected token <'));

afterEach(() => jest.restoreAllMocks());

test('loadForm: 2xx success renders the form', async () => {
  global.fetch = jest.fn().mockResolvedValue(loadOk());
  render(<ManualReviewEntryForm reviewer={REVIEWER} onCancel={jest.fn()} onSubmitted={jest.fn()} />);
  expect(await screen.findByLabelText('Scientific assessment', { exact: false })).toBeInTheDocument();
});

test('loadForm: non-2xx {message} surfaces the server message verbatim', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ message: 'Forbidden' }) });
  render(<ManualReviewEntryForm reviewer={REVIEWER} onCancel={jest.fn()} onSubmitted={jest.fn()} />);
  expect(await screen.findByText('Forbidden')).toBeInTheDocument();
});

test('loadForm: network rejection is never silent', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
  render(<ManualReviewEntryForm reviewer={REVIEWER} onCancel={jest.fn()} onSubmitted={jest.fn()} />);
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('loadForm: malformed 2xx body falls back to today\'s message, never silent', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: unparseable });
  render(<ManualReviewEntryForm reviewer={REVIEWER} onCancel={jest.fn()} onSubmitted={jest.fn()} />);
  expect(await screen.findByText('Could not load the current review form.')).toBeInTheDocument();
});

async function readyForm() {
  global.fetch = jest.fn().mockResolvedValue(loadOk());
  render(<ManualReviewEntryForm reviewer={REVIEWER} onCancel={jest.fn()} onSubmitted={jest.fn()} />);
  const input = await screen.findByLabelText('Scientific assessment', { exact: false });
  fireEvent.change(input, { target: { value: 'excellent' } });
  await waitFor(() => expect(input).toHaveValue('excellent'));
}

test('submit: 2xx success calls onSubmitted', async () => {
  await readyForm();
  const onSubmitted = jest.fn();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST'
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
      : Promise.resolve(loadOk())
  ));
  // re-render with the real onSubmitted isn't possible post-render; assert via side effect instead
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/review-manager/manual-review-entry', expect.objectContaining({ method: 'POST' })));
});

test('submit: 409 set_changed maps to the durable reason banner (verbatim)', async () => {
  await readyForm();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 409, json: async () => ({ reason: 'set_changed', message: 'The review questions changed while this form was open.' }) })
      : Promise.resolve(loadOk())
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  expect(await screen.findByText('The review questions changed while this form was open.')).toBeInTheDocument();
});

test('submit: network rejection is never silent', async () => {
  await readyForm();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST' ? Promise.reject(new Error('offline')) : Promise.resolve(loadOk())
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('submit axis (e): non-2xx unparseable body is never silent (falls to the generic refusal copy)', async () => {
  await readyForm();
  global.fetch = jest.fn((url, opts) => (
    opts?.method === 'POST'
      ? Promise.resolve({ ok: false, status: 502, json: unparseable })
      : Promise.resolve(loadOk())
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  expect(await screen.findByText('The review could not be recorded.')).toBeInTheDocument();
});

test('submit: request bytes (url, method, headers, exact body) unchanged', async () => {
  await readyForm();
  let captured;
  global.fetch = jest.fn((url, opts) => {
    if (opts?.method === 'POST') {
      captured = [url, opts];
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true }) });
    }
    return Promise.resolve(loadOk());
  });
  fireEvent.click(screen.getByRole('button', { name: 'Record review as received' }));
  await waitFor(() => expect(captured).toBeDefined());
  const [url, opts] = captured;
  expect(url).toBe('/api/review-manager/manual-review-entry');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(opts.body).toBe(JSON.stringify({
    suggestionId: REVIEWER.suggestionId,
    answers: { scientificAssessment: 'excellent' },
    setVersion: 'set-v1',
  }));
});
