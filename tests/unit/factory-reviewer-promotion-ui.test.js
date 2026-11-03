/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(async (_response, emit) => emit({ event: 'data', data: { recommended: [] } })),
}));

const REQ = '11111111-1111-4111-8111-111111111111';
const SUG = '22222222-2222-4222-8222-222222222222';
const row = {
  suggestionId: SUG,
  potentialReviewerId: '33333333-3333-4333-8333-333333333333',
  name: 'TEST Factory Reviewer',
  factoryTestReviewer: true,
  applicantKnownReviewer: {
    status: 'known', name: 'TEST Factory Reviewer',
    email: 'test@example.org', emailReadiness: { action: 'quick_check' },
  },
};
const roster = { success: true, active: [], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [] };
const response = (body, ok = true) => ({ ok, status: ok ? 200 : 409, json: async () => body });
function setup(promotion = () => Promise.resolve(response({ success: true, suggestionId: SUG }))) {
  global.fetch = jest.fn((url, options) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) return Promise.resolve(response(roster));
    if (url === '/api/workbench/promote-applicant-reviewer') return promotion(options);
    throw new Error(`Unexpected request ${url}`);
  });
}
const props = { requestId: REQ, blobUrl: 'test-blob', proposalKey: 'proposal', recommended: [row] };

afterEach(() => jest.restoreAllMocks());

test('Factory action uses only exact IDs, skips auto scholarly enrichment and confirms Invite without sending', async () => {
  let payload;
  const onSaved = jest.fn();
  setup((options) => { payload = JSON.parse(options.body); return Promise.resolve(response({ success: true, suggestionId: SUG })); });
  render(<ReviewerSearchSection {...props} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByText('Already added to Invite');
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(payload).toEqual({ requestId: REQ, suggestionId: SUG });
  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeTruthy();
  expect(global.fetch.mock.calls.every(([url]) => String(url).includes('reviewer-roster?') || url === '/api/workbench/promote-applicant-reviewer')).toBe(true);
});

test.each([
  { canManage: false },
  { recommended: [{ ...row, selected: true, wmkf_selected: true }] },
  { recommended: [{ ...row, factoryTestReviewer: false }], blobUrl: null },
])('read-only, handled and ordinary rows have no Factory action (%j)', async (over) => {
  setup();
  render(<ReviewerSearchSection {...props} {...over} />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Add Factory reviewer to Invite' })).toBeNull();
});

test('failed and malformed promotion stay retryable; no saved callback', async () => {
  const onSaved = jest.fn();
  setup(() => Promise.resolve(response({ error: 'Reviewer changed' }, false)));
  render(<ReviewerSearchSection {...props} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByRole('alert');
  expect(screen.getByText('Reviewer changed')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeTruthy();
  expect(screen.queryByText('Already added to Invite')).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
});

test.each([true, false])('old request completion cannot change the next request (success=%s)', async (success) => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  const onSaved = jest.fn();
  setup(() => pending);
  const { rerender } = render(<ReviewerSearchSection {...props} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByRole('button', { name: 'Adding…' });
  rerender(<ReviewerSearchSection {...props} requestId="44444444-4444-4444-8444-444444444444" onSaved={onSaved} />);
  await act(async () => finish(response(success ? { success: true, suggestionId: SUG } : { error: 'Old failure' }, success)));
  expect(screen.queryByText('Already added to Invite')).toBeNull();
  expect(screen.queryByText('Old failure')).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Add Factory reviewer to Invite' }).disabled).toBe(false);
});

test('partial success remains a committed promotion and names the supporting failure', async () => {
  const onSaved = jest.fn();
  setup(() => Promise.resolve(response({ success: true, suggestionId: SUG, partialSuccess: true })));
  render(<ReviewerSearchSection {...props} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByText('Already added to Invite');
  expect(screen.getByRole('status').textContent).toMatch(/could not finish updating/);
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
});

test('malformed successful response never claims the selection committed', async () => {
  const onSaved = jest.fn();
  setup(() => Promise.resolve(response({ success: true, suggestionId: 'wrong-suggestion' })));
  render(<ReviewerSearchSection {...props} onSaved={onSaved} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Already added to Invite')).toBeNull();
  expect(onSaved).not.toHaveBeenCalled();
});

test('pending promotion disables repeated clicks', async () => {
  let finish;
  const pending = new Promise((resolve) => { finish = resolve; });
  setup(() => pending);
  render(<ReviewerSearchSection {...props} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  const adding = await screen.findByRole('button', { name: 'Adding…' });
  expect(adding.disabled).toBe(true);
  fireEvent.click(adding);
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/workbench/promote-applicant-reviewer')).toHaveLength(1);
  await act(async () => finish(response({ success: true, suggestionId: SUG })));
});

test.each(['excluded', 'savedKeys', 'blocked', 'ineligible'])('terminal %s roster entry hides the Factory action before re-ingestion', async (bucket) => {
  global.fetch = jest.fn(() => Promise.resolve(response({ ...roster,
    [bucket]: bucket === 'savedKeys' ? [`suggestion:${SUG}`] : [{ candidateKey: `suggestion:${SUG}`, suggestionId: SUG, name: row.name }],
  })));
  render(<ReviewerSearchSection {...props} />);
  await screen.findByText('Unavailable in Find; check the current reviewer list.');
  expect(screen.queryByRole('button', { name: 'Add Factory reviewer to Invite' })).toBeNull();
});

test('failed parent refresh cannot turn a committed promotion into a retry', async () => {
  setup();
  render(<ReviewerSearchSection {...props} onSaved={() => { throw new Error('refresh failed'); }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Add Factory reviewer to Invite' }));
  await screen.findByText('Added to Invite; reload this request to refresh the reviewer list.');
  expect(screen.getByText('Already added to Invite')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('mixed recommendations still trigger ordinary enrichment and retain the explicit Factory action', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('reviewer-roster?')) return Promise.resolve(response(roster));
    if (url === '/api/workbench/enrich-recommended') return Promise.resolve(response({}));
    throw new Error(`Unexpected request ${url}`);
  });
  const ordinary = { ...row, suggestionId: '55555555-5555-4555-8555-555555555555',
    factoryTestReviewer: false, name: 'Ordinary reviewer' };
  render(<ReviewerSearchSection {...props} recommended={[row, ordinary]} />);
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url === '/api/workbench/enrich-recommended')).toHaveLength(1));
  expect(screen.getByRole('button', { name: 'Add Factory reviewer to Invite' })).toBeTruthy();
});
