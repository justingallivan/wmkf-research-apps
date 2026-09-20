/**
 * @jest-environment jsdom
 *
 * T5 matrix for ReviewAuthoringForm's three fetch sites: the draft GET (load),
 * the draft PUT (autosave persist — reads no body today), and the submit
 * POST. Uses a single required string field to keep isComplete() satisfiable
 * without exercising the rich-text/picklist controls covered elsewhere.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ReviewAuthoringForm from '../../shared/components/external/ReviewAuthoringForm';

const FIELDS = [{ key: 'affiliation', type: 'string', label: 'Affiliation', required: true, order: 1 }];

function renderForm(props = {}) {
  return render(
    <ReviewAuthoringForm
      data={{ questions: FIELDS, questionSetVersion: 'set-v1', prefill: {} }}
      token="tok"
      onSubmitted={jest.fn()}
      {...props}
    />,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// --- draft GET (load) ---

test('(a) a loaded draft overlays the prefill', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, draftJson: { affiliation: 'Saved Uni' } }) });
  renderForm();
  await waitFor(() => expect(screen.getByLabelText('Affiliation', { exact: false })).toHaveValue('Saved Uni'));
  expect(global.fetch).toHaveBeenCalledWith('/api/external/review/tok/draft', { method: 'GET', signal: undefined });
});

test('(b) a non-2xx draft response leaves the prefill untouched', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ ok: false }) });
  renderForm();
  await screen.findByLabelText('Affiliation', { exact: false });
  expect(screen.getByLabelText('Affiliation', { exact: false })).toHaveValue('');
});

test('(c) a network rejection is non-fatal and starts from the prefill', async () => {
  global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
  renderForm();
  await screen.findByLabelText('Affiliation', { exact: false });
  expect(screen.getByLabelText('Affiliation', { exact: false })).toHaveValue('');
});

test('(d)/(e) a malformed draft body (today\'s `.catch(() => ({}))`) is non-fatal and starts from the prefill', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  renderForm();
  await screen.findByLabelText('Affiliation', { exact: false });
  expect(screen.getByLabelText('Affiliation', { exact: false })).toHaveValue('');
});

// --- draft PUT (persist / autosave) ---

test('PUT: a 2xx response shows "Saved" (persist reads no body today)', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) }) // GET draft
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // PUT
  renderForm();
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByLabelText('Affiliation', { exact: false }), { target: { value: 'X' } });
  await act(async () => { jest.advanceTimersByTime(1300); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Saved')).toBeInTheDocument();
  const [url, opts] = global.fetch.mock.calls[1];
  expect(url).toBe('/api/external/review/tok/draft');
  expect(opts.method).toBe('PUT');
  expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(opts.body)).toEqual({ draftJson: { affiliation: 'X' } });
});

test('PUT: a non-2xx response shows the save-error indicator', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: 'nope' }) });
  renderForm();
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByLabelText('Affiliation', { exact: false }), { target: { value: 'X' } });
  await act(async () => { jest.advanceTimersByTime(1300); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/Save failed/i)).toBeInTheDocument();
});

test('PUT: a malformed 2xx body (today never reads the body) still shows "Saved"', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } });
  renderForm();
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByLabelText('Affiliation', { exact: false }), { target: { value: 'X' } });
  await act(async () => { jest.advanceTimersByTime(1300); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText('Saved')).toBeInTheDocument();
});

test('PUT: a network rejection shows the save-error indicator', async () => {
  jest.useFakeTimers();
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    .mockRejectedValueOnce(new Error('network down'));
  renderForm();
  await act(async () => { await Promise.resolve(); });
  fireEvent.change(screen.getByLabelText('Affiliation', { exact: false }), { target: { value: 'X' } });
  await act(async () => { jest.advanceTimersByTime(1300); });
  await act(async () => { await Promise.resolve(); });
  expect(screen.getByText(/Save failed/i)).toBeInTheDocument();
});

// --- submit POST ---

async function primeSubmittable() {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) }); // GET draft
  const view = renderForm();
  await screen.findByLabelText('Affiliation', { exact: false });
  fireEvent.change(screen.getByLabelText('Affiliation', { exact: false }), { target: { value: 'Filled in' } });
  return view;
}

test('(a) a successful submit shows the received state', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true, receivedAt: '2026-09-20T00:00:00Z' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Review received');
  const [url, opts] = global.fetch.mock.calls[1];
  expect(url).toBe('/api/external/review/tok/submit');
  expect(opts.method).toBe('POST');
  expect(JSON.parse(opts.body)).toEqual({ answers: { affiliation: 'Filled in' }, setVersion: 'set-v1' });
});

test('(b) 409 set_changed locks with the reload prompt, keeping submit errors', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, reason: 'set_changed', message: 'Questions changed.' }) });
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // the flush persist() inside set_changed
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText((_, node) => node?.textContent === 'Questions changed. Your saved answers will be kept where they still apply.');
});

test('(b) 409 without set_changed is a terminal conflict', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ ok: false, message: 'Already submitted.' }) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Already submitted.');
  expect(screen.getByText('This review can no longer be submitted here')).toBeInTheDocument();
});

test('(b) 400 with a server errors array surfaces them and stays editable', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ ok: false, errors: ['Affiliation is too long.'] }) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Affiliation is too long.');
});

test('(b) any other non-ok status shows the generic submit-failure copy', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false }) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Something went wrong submitting your review. Please try again.');
});

test('(b) a 2xx body with ok:false is treated the same as the generic failure (body-level flag, not status)', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: false }) });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Something went wrong submitting your review. Please try again.');
});

test('(c) a network rejection shows the network-error copy', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockRejectedValueOnce(new Error('network down'));
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Network error — your review was not submitted. Please try again.');
});

test('(d)/(e) a malformed submit body (today\'s `.catch(() => ({}))`) is tolerated to {} and hits the generic failure', async () => {
  global.fetch = jest.fn();
  await primeSubmittable();
  global.fetch.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new SyntaxError('bad json'); } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit review' }));
  await screen.findByText('Something went wrong submitting your review. Please try again.');
});
