/**
 * @jest-environment jsdom
 *
 * CandidateEditModal — T4 client-request-layer matrix (Stage 4). Pins request
 * bytes and body-parse-failure behavior for the file's 3 fetch sites ahead of
 * migrating onto shared/utils/api-request.js:
 *   - handleSave (save)   PATCH /api/reviewer-finder/my-candidates (body read
 *     ONLY on !ok today — a 2xx never calls response.json())
 *   - fetchPlan            POST  /api/reviewer-finder/merge-candidates (plan)
 *   - confirmMerge         POST  /api/reviewer-finder/merge-candidates (confirm)
 * The 409+conflictingRecordId merge-entry branch, Swap re-plan, and confirm
 * flows are covered by tests/unit/candidate-edit-modal-merge.test.js; this
 * file adds the request-byte and malformed/network-rejection pins.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CandidateEditModal from '../../shared/components/reviewers/CandidateEditModal';

const KEEPER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOSER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const TARGET = 'josh@princeton.edu';

const candidate = {
  name: 'Joshua Rabinowitz',
  affiliation: 'Princeton',
  email: 'old@princeton.edu',
  website: '',
  hIndex: 10,
  suggestionId: 'S1',
  potentialReviewerId: KEEPER,
};

const resp = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });
const parse = (opts) => (opts?.body ? JSON.parse(opts.body) : {});

const triggerMerge = () => {
  fireEvent.change(screen.getByDisplayValue('old@princeton.edu'), { target: { value: TARGET } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
};

afterEach(() => { if (global.fetch && global.fetch.mockRestore) global.fetch.mockRestore(); jest.restoreAllMocks(); });

test('save: PATCH sends exact body bytes/headers, and a 2xx success never calls response.json (unread on success today)', async () => {
  let jsonCalled = false;
  const onSaved = jest.fn(async () => {});
  const onClose = jest.fn();
  jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
    expect(url).toBe('/api/reviewer-finder/my-candidates');
    expect(opts.method).toBe('PATCH');
    expect(opts.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(parse(opts)).toMatchObject({ suggestionId: 'S1', email: 'other@princeton.edu' });
    return {
      ok: true,
      status: 200,
      json: async () => { jsonCalled = true; throw new Error('should not be called on this path'); },
    };
  });
  render(<CandidateEditModal candidate={candidate} onClose={onClose} onSaved={onSaved} />);
  fireEvent.change(screen.getByDisplayValue('old@princeton.edu'), { target: { value: 'other@princeton.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  expect(onClose).toHaveBeenCalled();
});

test('save: network rejection surfaces e.message as the inline error', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
  render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
  fireEvent.change(screen.getByDisplayValue('old@princeton.edu'), { target: { value: 'other@princeton.edu' } });
  fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
  expect(await screen.findByText('offline')).toBeInTheDocument();
});

test('fetchPlan (loadPlan): POST sends exact keeperId/loserId bytes; a malformed 2xx body is tolerated to {} and treated as no-plan', async () => {
  let planCallOpts = null;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
    if (url === '/api/reviewer-finder/my-candidates') {
      return resp(
        { error: 'duplicate_key', message: 'dup', field: 'wmkf_emailaddress', value: TARGET, conflictingRecordId: LOSER },
        { ok: false, status: 409 },
      );
    }
    planCallOpts = opts;
    return { ok: true, status: 200, json: async () => { throw new Error('bad json'); } };
  });
  render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
  triggerMerge();
  expect(await screen.findByText(/Could not load the merge plan\./i)).toBeInTheDocument();
  expect(planCallOpts.method).toBe('POST');
  expect(planCallOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(planCallOpts.body)).toEqual({ keeperId: KEEPER, loserId: LOSER });
});

test('confirmMerge: POST sends exact keeperId/loserId/fieldChoices/confirm bytes', async () => {
  let confirmOpts = null;
  jest.spyOn(global, 'fetch').mockImplementation(async (url, opts) => {
    if (url === '/api/reviewer-finder/my-candidates') {
      return resp(
        { error: 'duplicate_key', message: 'dup', field: 'wmkf_emailaddress', value: TARGET, conflictingRecordId: LOSER },
        { ok: false, status: 409 },
      );
    }
    const body = parse(opts);
    if (body.confirm) { confirmOpts = opts; return resp({ mergedId: KEEPER }); }
    return resp({
      plan: {
        blocked: false, reasons: [],
        keeper: { id: KEEPER, name: 'Joshua Rabinowitz', email: 'old@princeton.edu', identityStatus: null },
        loser: { id: LOSER, name: 'Joshua Ravinowitz', email: TARGET, identityStatus: null, statecode: 0 },
        fields: [{ field: 'email', keeper: 'old@princeton.edu', loser: TARGET, differs: true }],
        repointCount: 1, collisionCount: 0,
      },
    });
  });
  render(<CandidateEditModal candidate={candidate} onClose={jest.fn()} onSaved={jest.fn()} />);
  triggerMerge();
  const mergeBtn = await screen.findByRole('button', { name: /merge records/i });
  fireEvent.click(mergeBtn);
  await waitFor(() => expect(confirmOpts).not.toBeNull());
  expect(confirmOpts.method).toBe('POST');
  expect(confirmOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(confirmOpts.body)).toEqual({
    keeperId: KEEPER, loserId: LOSER, fieldChoices: { email: 'loser' }, confirm: true,
  });
});
