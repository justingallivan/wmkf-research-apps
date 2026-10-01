/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({ readSseStream: jest.fn() }));

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';
const first = {
  candidateKey: 'candidate:first',
  name: 'Persisted Reviewer',
  email: 'persisted@example.edu',
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
};
const second = {
  candidateKey: 'candidate:second',
  name: 'Failed Reviewer',
  email: 'failed@example.edu',
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
};
const third = {
  candidateKey: 'candidate:third',
  name: 'Existing Reviewer',
  email: 'existing@example.edu',
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
};

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, body: {} };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function rosterSnapshot(active = []) {
  return {
    success: true,
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: active.map((row) => row.name),
    retention: { version: 1, rows: active.map(({ candidateKey }) => ({ candidateKey, status: 'active' })) },
  };
}

function streamSearch(candidates) {
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: candidates, unverified: [] } });
    });
  if (candidates.length) {
    readSseStream.mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: candidates } });
    });
  }
}

afterEach(() => {
  jest.clearAllMocks();
  readSseStream.mockReset();
  global.fetch = jest.fn();
});

test('partial save keeps exact server buckets authoritative through the next search and remount', async () => {
  let persisted = [];
  let rosterReads = 0;
  let postCount = 0;
  const exclusions = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterReads += 1;
      return Promise.resolve(response(rosterSnapshot(persisted)));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      postCount += 1;
      persisted = [first];
      return Promise.resolve(response({
        success: false,
        recorded: 1,
        outcomeVersion: 1,
        error: 'Some search results could not be saved.',
        results: [
          { inputIndex: 0, candidateKey: first.candidateKey, existingAtAttempt: false, outcome: 'written' },
          { inputIndex: 1, candidateKey: second.candidateKey, existingAtAttempt: false, outcome: 'failed', code: 'roster_write_failed' },
        ],
      }));
    }
    if (target === '/api/reviewer-finder/analyze') {
      exclusions.push(JSON.parse(options.body).excludedNames);
      return Promise.resolve(response({}));
    }
    if (target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  streamSearch([first, second]);
  const view = render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByText('Not saved to this request')).toBeInTheDocument();
  expect(screen.getByText(first.name)).toBeInTheDocument();
  expect(screen.getByText(second.name)).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Retry saving results' })).toBeInTheDocument();

  streamSearch([]);
  fireEvent.click(screen.getByRole('button', { name: 'Run another search' }));
  await waitFor(() => expect(exclusions).toHaveLength(2));
  expect(exclusions[1]).toEqual([first.name]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(postCount).toBe(1);

  view.unmount();
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeEnabled());
  expect(screen.getByText(first.name)).toBeInTheDocument();
  expect(screen.queryByText(second.name)).not.toBeInTheDocument();
  expect(rosterReads).toBeGreaterThanOrEqual(3);
});

test('successful Retry saving posts only the absent insert, preserves invalid and existing-row warnings, and ignores a repeated click', async () => {
  let posts = 0;
  const postBodies = [];
  const providerCalls = [];
  const reboundFirst = { ...first, candidateKey: 'candidate:receipt-bound' };
  const retryPost = deferred();
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (posts === 0) return Promise.resolve(response(rosterSnapshot([])));
      return Promise.resolve(response(rosterSnapshot(posts === 1 ? [third] : [reboundFirst, third])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      const body = JSON.parse(options.body);
      postBodies.push(body);
      if (posts === 1) {
        return Promise.resolve(response({
          success: false, recorded: 0, outcomeVersion: 1,
          results: [
            { inputIndex: 0, candidateKey: reboundFirst.candidateKey, existingAtAttempt: false, outcome: 'failed', code: 'roster_write_failed' },
            { inputIndex: 1, candidateKey: null, existingAtAttempt: null, outcome: 'invalid', code: 'invalid_candidate' },
            { inputIndex: 2, candidateKey: third.candidateKey, existingAtAttempt: true, outcome: 'failed', code: 'roster_write_failed' },
          ],
        }));
      }
      return retryPost.promise;
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') {
      providerCalls.push(target);
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  streamSearch([first, second, third]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  const retry = await screen.findByRole('button', { name: 'Retry saving results' });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(screen.getByText(third.name)).toBeInTheDocument();

  const providerCallCountBeforeRetry = providerCalls.length;
  expect(providerCalls).toEqual([
    '/api/reviewer-finder/analyze', '/api/reviewer-finder/discover', '/api/reviewer-finder/enrich-contacts',
  ]);
  fireEvent.click(retry);
  await waitFor(() => expect(posts).toBe(2));
  expect(postBodies[1].writeMode).toBe('insert_missing');
  expect(postBodies[1].candidates).toHaveLength(1);
  expect(postBodies[1].candidates[0].name).toBe(first.name);
  expect(postBodies[1].candidates[0].candidateKey).toBe(reboundFirst.candidateKey);
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(posts).toBe(2);

  await act(async () => {
    retryPost.resolve(response({
      success: true, recorded: 1, outcomeVersion: 1,
      results: [{ inputIndex: 0, candidateKey: reboundFirst.candidateKey, existingAtAttempt: false, outcome: 'written' }],
    }));
    await retryPost.promise;
  });

  expect(await screen.findByText(/Another result is retained, but the latest details were not saved/)).toBeInTheDocument();
  expect(screen.getByText(second.name)).toBeInTheDocument();
  expect(screen.getByText(third.name)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry saving results' })).not.toBeInTheDocument();
  expect(posts).toBe(2);
  expect(providerCalls).toHaveLength(providerCallCountBeforeRetry);
});

test('malformed post-save inventory gives checking-only recovery instructions', async () => {
  let rosterReads = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterReads += 1;
      if (rosterReads === 1) return Promise.resolve(response(rosterSnapshot([])));
      return Promise.resolve(response({ success: true, active: [first], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [first.name] }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({
        success: true, recorded: 1, outcomeVersion: 1,
        results: [{ inputIndex: 0, candidateKey: first.candidateKey, existingAtAttempt: false, outcome: 'written' }],
      }));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('We couldn’t confirm the saved results. Retry checking before leaving this page.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry checking saves' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Use saved results' })).not.toBeInTheDocument();
});

test('contradictory recorded count enters lost-correlation recovery without retrying the write', async () => {
  let posts = 0;
  let rosterReads = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterReads += 1;
      return Promise.resolve(response(rosterSnapshot(rosterReads === 1 ? [] : [first])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({
        success: true, recorded: 0, outcomeVersion: 1,
        results: [{ inputIndex: 0, candidateKey: first.candidateKey, existingAtAttempt: false, outcome: 'written' }],
      }));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText("Couldn't confirm which results were saved. Use saved results to replace this search with the server roster.")).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry checking saves' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Use saved results' }));
  await waitFor(() => expect(screen.queryByTestId('reviewer-roster-persistence-summary')).not.toBeInTheDocument());
  expect(screen.getByText(first.name)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Retry saving results' })).not.toBeInTheDocument();
  expect(posts).toBe(1);
  expect(rosterReads).toBe(3);
});

test('Use saved discards the whole attempted search when a previously written row disappears before the fresh GET', async () => {
  let posts = 0;
  let rosterReads = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterReads += 1;
      return Promise.resolve(response(rosterSnapshot(rosterReads === 2 ? [first] : [])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({
        success: false, recorded: 1, outcomeVersion: 1,
        results: [
          { inputIndex: 0, candidateKey: first.candidateKey, existingAtAttempt: false, outcome: 'written' },
          { inputIndex: 1, candidateKey: second.candidateKey, existingAtAttempt: false, outcome: 'failed', code: 'roster_write_failed' },
        ],
      }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first, second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByRole('button', { name: 'Use saved results' })).toBeInTheDocument();
  expect(screen.getByText(first.name)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Use saved results' }));

  await waitFor(() => expect(screen.queryByTestId('reviewer-roster-persistence-summary')).not.toBeInTheDocument());
  expect(rosterReads).toBe(3);
  expect(screen.queryByText(first.name)).not.toBeInTheDocument();
  expect(screen.queryByText(second.name)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeEnabled();
  expect(posts).toBe(1);
  expect(rosterReads).toBe(3);
});

test('removal PATCH snapshot renders a newly handled reviewer as read-only', async () => {
  const suggestionId = '22222222-2222-4222-8222-222222222222';
  const anchored = {
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
    name: 'Already Invited Reviewer',
    email: 'invited@example.edu',
    emailSource: 'staff_verified',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    verificationStatus: 'verified',
    verified: true,
    verificationConfidence: 0.9,
    addressTrustReceipt: { receiptId: 'receipt-invited', personConfirmed: true, email: 'invited@example.edu' },
    rosterUpdatedAt: '2026-09-30T00:00:00.000Z',
    provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
  };
  const retention = (status) => ({ version: 1, rows: [{ candidateKey: anchored.candidateKey, status }] });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true, active: [anchored], excluded: [], ineligible: [], blocked: [], handled: [],
        savedKeys: [], allNames: [anchored.name], retention: retention('active'),
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({
        success: true, active: [], excluded: [], ineligible: [], blocked: [],
        handled: [{ candidateKey: anchored.candidateKey, suggestionId, name: anchored.name, stage: 'invited' }],
        savedKeys: [], allNames: [anchored.name], retention: retention('active'),
        repairRequests: [], repairRequestsUnavailable: false,
        removed: 1, removedKeys: ['candidate:other-previous-result'],
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);

  expect(await screen.findByRole('checkbox', { name: `Select ${anchored.name}` })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  expect(await screen.findByText('Already handled')).toBeInTheDocument();
  expect(screen.getByText('Not actionable in Find')).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: `Select ${anchored.name}` })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Add .* to Invite/ })).not.toBeInTheDocument();
});

test('results-phase removal failure can retry reviewer state and unlock another search', async () => {
  const previous = { ...first, rosterUpdatedAt: '2026-09-30T00:00:00.000Z' };
  let rosterReads = 0;
  let patches = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterReads += 1;
      return Promise.resolve(response(rosterSnapshot(rosterReads === 1 ? [previous] : rosterReads === 2 ? [previous, second] : [second])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({
        success: true, recorded: 1, outcomeVersion: 1,
        results: [{ inputIndex: 0, candidateKey: second.candidateKey, existingAtAttempt: false, outcome: 'written' }],
      }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      patches += 1;
      return Promise.resolve(response({ error: 'refresh failed after removal' }, false));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  streamSearch([second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByRole('button', { name: 'Run another search' });
  const remove = screen.getByRole('button', { name: 'Remove previous results' });
  await waitFor(() => expect(remove).toBeEnabled());
  fireEvent.click(remove);

  expect(await screen.findByRole('button', { name: 'Retry reviewer state' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry reviewer state' }));

  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: 'Retry reviewer state' })).not.toBeInTheDocument();
  expect(patches).toBe(1);
  expect(rosterReads).toBe(3);
  expect(screen.getByText(second.name)).toBeInTheDocument();
});

const missingReads = [
  ['returns null', () => Promise.resolve(null)],
  ['throws', () => { throw new Error('roster read failed'); }],
];

test.each(missingReads)('retry saving treats a GET that %s as unresolved and blocks new search', async (_label, failedRead) => {
  let posts = 0;
  let failNextRead = false;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (failNextRead) { failNextRead = false; return failedRead(); }
      return Promise.resolve(response(rosterSnapshot([])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({
        success: false, recorded: 0, outcomeVersion: 1,
        results: [
          { inputIndex: 0, candidateKey: first.candidateKey, existingAtAttempt: false, outcome: 'failed', code: 'roster_write_failed' },
          { inputIndex: 1, candidateKey: second.candidateKey, existingAtAttempt: false, outcome: 'failed', code: 'roster_write_failed' },
        ],
      }));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first, second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  const retry = await screen.findByRole('button', { name: 'Retry saving results' });
  failNextRead = true;
  fireEvent.click(retry);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry checking saves' })).toBeInTheDocument());
  expect(posts).toBe(1);
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();
});

test.each(missingReads)('Retry checking keeps the page blocked when GET %s', async (_label, failedRead) => {
  let posts = 0;
  let failNextRead = false;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (failNextRead) { failNextRead = false; return failedRead(); }
      return Promise.resolve(response(rosterSnapshot([])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({ success: false, error: 'save response unavailable' }, false));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first, second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  const check = await screen.findByRole('button', { name: 'Retry checking saves' });
  failNextRead = true;
  fireEvent.click(check);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry checking saves' })).toBeEnabled());
  expect(posts).toBe(1);
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();
  expect(screen.getAllByText('Save not confirmed').length).toBeGreaterThan(0);
});

test.each(missingReads)('Use saved results keeps unresolved cards and search blocked when GET %s', async (_label, failedRead) => {
  let posts = 0;
  let failNextRead = false;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (failNextRead) { failNextRead = false; return failedRead(); }
      return Promise.resolve(response(rosterSnapshot([])));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({ success: false, error: 'save response unavailable' }, false));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first, second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry checking saves' }));
  const useSaved = await screen.findByRole('button', { name: 'Use saved results' });
  failNextRead = true;
  fireEvent.click(useSaved);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retry checking saves' })).toBeEnabled());
  expect(posts).toBe(1);
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();
  expect(screen.getAllByText('Save not confirmed').length).toBeGreaterThan(0);
});

test('successful Use saved recovery restores roster readiness and allows the next search', async () => {
  const analyses = [];
  let posts = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(response(rosterSnapshot([])));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      posts += 1;
      return Promise.resolve(response({ error: 'lost POST outcome' }, false));
    }
    if (target === '/api/reviewer-finder/analyze') {
      analyses.push(JSON.parse(options.body));
      return Promise.resolve(response({}));
    }
    if (target === '/api/reviewer-finder/discover' || target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  streamSearch([first, second]);
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  const useSaved = await screen.findByRole('button', { name: 'Use saved results' });
  await waitFor(() => expect(useSaved).toBeEnabled());
  fireEvent.click(useSaved);
  await waitFor(() => expect(screen.queryByText('Save not confirmed')).not.toBeInTheDocument());
  const searchButton = screen.getByRole('button', { name: /run .*search/i });
  expect(searchButton).toBeEnabled();

  streamSearch([]);
  fireEvent.click(searchButton);
  await waitFor(() => expect(analyses).toHaveLength(2));
  expect(posts).toBe(1);
});
