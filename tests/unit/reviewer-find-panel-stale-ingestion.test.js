/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockOnRetryRoster;

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/ReviewerSearchSection', () => function SearchStub({
  recommended,
  ingestError,
  proposalKey,
  blobUrl,
  rosterSnapshot,
  displayOnly,
  onRetryRoster,
  onRetryIngestion,
}) {
  mockOnRetryRoster = onRetryRoster;
  return (
    <>
    <div
      data-testid="search"
      data-recommended={JSON.stringify(recommended || [])}
      data-error={ingestError || ''}
      data-proposal-key={proposalKey || ''}
      data-blob-url={blobUrl || ''}
      data-roster-state={rosterSnapshot?.authorityState || ''}
      data-roster-names={(rosterSnapshot?.data?.active || []).map((candidate) => candidate.name).join(',')}
      data-roster-error={rosterSnapshot?.error || ''}
      data-display-only={String(!!displayOnly)}
    />
    <button type="button" onClick={onRetryRoster}>Retry warm roster</button>
    <button type="button" onClick={onRetryIngestion}>Load applicant input</button>
    </>
  );
});

import ReviewerFindPanel from '../../shared/components/reviewers/ReviewerFindPanel';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function response(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => data,
  };
}

function renderedRecommendations() {
  return JSON.parse(screen.getByTestId('search').getAttribute('data-recommended'));
}

function proposalBinding() {
  const search = screen.getByTestId('search');
  return {
    proposalKey: search.getAttribute('data-proposal-key'),
    blobUrl: search.getAttribute('data-blob-url'),
  };
}

function rosterBinding() {
  const search = screen.getByTestId('search');
  return {
    state: search.getAttribute('data-roster-state'),
    names: search.getAttribute('data-roster-names'),
    error: search.getAttribute('data-roster-error'),
    displayOnly: search.getAttribute('data-display-only'),
  };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('warm revisit renders its cached roster with zero proposal, applicant, or provider work', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('mode=cached')) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }));
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);

  await waitFor(() => expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'current', names: 'Cached Reviewer' })));
  const targets = global.fetch.mock.calls.map(([url]) => String(url));
  expect(targets).toHaveLength(2);
  expect(targets.every((target) => target.includes('/api/workbench/reviewer-roster?') && target.includes('mode='))).toBe(true);
  expect(targets.some((target) => /load-proposal|applicant-reviewers|analyze|discover|enrich|coauthor|material/i.test(target))).toBe(false);
});

test('no-history mount is idle and performs only the cached/reconciled roster reads', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('mode=cached')) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'empty', active: [], allNames: [] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'empty', active: [], allNames: [] }));
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);

  await waitFor(() => expect(rosterBinding().state).toBe('current'));
  expect(screen.getByRole('button', { name: 'Prepare search' })).toBeEnabled();
  expect(global.fetch.mock.calls).toHaveLength(2);
  expect(renderedRecommendations()).toEqual([]);
});

test('explicit preparation and applicant input refresh call only their intended endpoints', async () => {
  const fileKey = 'akoya_request::REQ/Phase I::ProjectDescription.pdf';
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('mode=cached')) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v1', active: [] }));
    if (target === '/api/reviewer-finder/load-proposal') return Promise.resolve(response({
      success: true,
      blobUrl: 'https://blob.example/project-description.pdf',
      filename: 'ProjectDescription.pdf',
      picked: fileKey,
      allFiles: [],
    }));
    if (target.includes('/api/workbench/applicant-reviewers')) return Promise.resolve(response({
      success: true,
      recommended: [{ suggestionId: 's-a', name: 'Applicant Reviewer' }],
      slotsPopulated: 1,
    }));
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} proposalFileKey={fileKey} />);
  await waitFor(() => expect(rosterBinding().state).toBe('current'));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare search' }));
  await waitFor(() => expect(proposalBinding()).toEqual({ proposalKey: fileKey, blobUrl: 'https://blob.example/project-description.pdf' }));
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/load-proposal')).toHaveLength(1);
  expect(global.fetch.mock.calls.some(([url]) => String(url).includes('/api/workbench/applicant-reviewers'))).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Load applicant input' }));
  await waitFor(() => expect(renderedRecommendations()).toEqual([{ suggestionId: 's-a', name: 'Applicant Reviewer' }]));
  expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/workbench/applicant-reviewers'))).toHaveLength(1);
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/load-proposal')).toHaveLength(1);
});

test('a deliberate dropdown selection persists only after server validation and does not reload when navigation state catches up', async () => {
  const file = {
    library: 'akoya_request',
    folder: 'REQ/Phase I',
    name: 'ProjectDescription.pdf',
    classification: 'proposal',
  };
  const fileKey = `${file.library}::${file.folder}::${file.name}`;
  const onProposalFileKeyChange = jest.fn();
  let proposalLoads = 0;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) {
      return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      proposalLoads += 1;
      const body = JSON.parse(options.body);
      if (!body.fileKey) {
        return Promise.resolve(response({
          error: 'Canonical reviewer proposal not found.',
          allFiles: [file],
        }, { ok: false, status: 404 }));
      }
      return Promise.resolve(response({
        success: true,
        blobUrl: 'https://blob.example/project-description.pdf',
        filename: file.name,
        picked: fileKey,
        allFiles: [file],
      }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerFindPanel
      requestId={REQ_A}
      onProposalFileKeyChange={onProposalFileKeyChange}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Prepare search' }));
  const picker = await screen.findByRole('combobox');
  await act(async () => {
    picker.value = fileKey;
    picker.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await waitFor(() => expect(onProposalFileKeyChange).toHaveBeenCalledWith(fileKey));
  expect(proposalLoads).toBe(2);

  rerender(
    <ReviewerFindPanel
      requestId={REQ_A}
      proposalFileKey={fileKey}
      onProposalFileKeyChange={onProposalFileKeyChange}
    />,
  );
  await act(async () => {});
  expect(proposalLoads).toBe(2);
});

test('late explicit proposal and applicant results for request A cannot overwrite request B', async () => {
  const proposalA = deferred();
  const ingestionA = deferred();
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('mode=cached') && target.includes(REQ_A)) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v-a', active: [] }));
    if (target.includes('mode=cached') && target.includes(REQ_B)) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v-b', active: [] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: target.includes(REQ_A) ? 'v-a' : 'v-b', active: [] }));
    if (target.includes('/api/workbench/applicant-reviewers')) {
      if (target.includes(REQ_A)) return ingestionA.promise;
      return Promise.resolve(response({ success: true, recommended: [{ suggestionId: 's-b', name: 'Reviewer B' }], slotsPopulated: 1 }));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      const body = JSON.parse(options.body);
      if (body.requestId === REQ_A) return proposalA.promise;
      return Promise.resolve(response({
        success: true,
        blobUrl: 'blob-b',
        picked: 'key-b',
        filename: 'Proposal B.pdf',
        allFiles: [],
      }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerFindPanel requestId={REQ_A} />);
  await waitFor(() => expect(rosterBinding().state).toBe('current'));
  fireEvent.click(screen.getByRole('button', { name: 'Prepare search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load applicant input' }));
  rerender(<ReviewerFindPanel requestId={REQ_B} />);
  await waitFor(() => expect(proposalBinding()).toEqual({ proposalKey: '', blobUrl: '' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load applicant input' }));
  await waitFor(() => expect(renderedRecommendations()).toEqual([{ suggestionId: 's-b', name: 'Reviewer B' }]));

  await act(async () => {
    ingestionA.resolve(response({ success: true, recommended: [{ suggestionId: 's-a', name: 'Reviewer A' }], slotsPopulated: 1 }));
    proposalA.resolve(response({ success: true, blobUrl: 'blob-a', picked: 'key-a', filename: 'Proposal A.pdf', allFiles: [] }));
    await Promise.all([ingestionA.promise, proposalA.promise]);
  });
  expect(proposalBinding()).toEqual({ proposalKey: '', blobUrl: '' });
  expect(renderedRecommendations()).toEqual([{ suggestionId: 's-b', name: 'Reviewer B' }]);
});

test('parent bootstrap renders the cached roster before reconciliation and reaches current without a default roster GET', async () => {
  const cached = deferred();
  const reconciled = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    if (target === '/api/reviewer-finder/load-proposal') return Promise.resolve(response({ success: true, allFiles: [] }));
    if (target.includes('/api/workbench/reviewer-roster') && target.includes('mode=cached')) return cached.promise;
    if (target.includes('/api/workbench/reviewer-roster') && target.includes('mode=reconciled')) return reconciled.promise;
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);
  await act(async () => {
    cached.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }));
    await cached.promise;
  });
  await waitFor(() => expect(rosterBinding()).toEqual({ state: 'refreshing', names: 'Cached Reviewer', error: '', displayOnly: 'true' }));
  await act(async () => {
    reconciled.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }));
    await reconciled.promise;
  });
  await waitFor(() => expect(rosterBinding().state).toBe('current'));
  expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/workbench/reviewer-roster?requestId=')).every(([url]) => String(url).includes('mode='))).toBe(true);
});

test('parent roster retry resolves only after its own cached-to-reconciled terminal snapshot commits', async () => {
  const retryReconciled = deferred();
  let cachedReads = 0;
  let reconciledReads = 0;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('mode=cached')) {
      cachedReads += 1;
      return Promise.resolve(response({
        success: true,
        authorityState: 'cached',
        rosterVersion: `v${cachedReads}`,
        active: [{ name: 'Cached Reviewer' }],
      }));
    }
    if (target.includes('mode=reconciled')) {
      reconciledReads += 1;
      if (reconciledReads === 1) {
        return Promise.resolve(response({
          success: true,
          authorityState: 'current',
          rosterVersion: 'v1',
          active: [{ name: 'Cached Reviewer' }],
        }));
      }
      return retryReconciled.promise;
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);
  await waitFor(() => expect(rosterBinding().state).toBe('current'));

  let acknowledgement;
  act(() => {
    acknowledgement = mockOnRetryRoster();
  });
  let settled = false;
  acknowledgement.then(() => { settled = true; });
  await waitFor(() => expect(reconciledReads).toBe(2));
  expect(settled).toBe(false);

  await act(async () => {
    retryReconciled.resolve(response({
      success: true,
      authorityState: 'current',
      rosterVersion: 'v2',
      active: [{ name: 'Fresh Reviewer' }],
    }));
    await retryReconciled.promise;
  });
  await expect(acknowledgement).resolves.toEqual({ state: 'current', rosterVersion: 'v2' });
  expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'current', names: 'Fresh Reviewer' }));
});

test('a pending parent roster retry resolves as superseded after a request switch', async () => {
  const retryCached = deferred();
  let cachedReads = 0;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('mode=cached') && target.includes(REQ_A)) {
      cachedReads += 1;
      return cachedReads === 1
        ? Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [{ name: 'Reviewer A' }] }))
        : retryCached.promise;
    }
    if (target.includes('mode=reconciled') && target.includes(REQ_A)) {
      return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v1', active: [{ name: 'Reviewer A' }] }));
    }
    if (target.includes('mode=cached') && target.includes(REQ_B)) {
      return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v-b', active: [{ name: 'Reviewer B' }] }));
    }
    if (target.includes('mode=reconciled') && target.includes(REQ_B)) {
      return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v-b', active: [{ name: 'Reviewer B' }] }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerFindPanel requestId={REQ_A} />);
  await waitFor(() => expect(rosterBinding().state).toBe('current'));
  let acknowledgement;
  act(() => {
    acknowledgement = mockOnRetryRoster();
  });
  rerender(<ReviewerFindPanel requestId={REQ_B} />);

  await expect(acknowledgement).resolves.toEqual({ state: 'superseded' });
  await waitFor(() => expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'current', names: 'Reviewer B' })));
});

test('one snapshot conflict restarts reconciliation with the fresh cached version, but a repeated conflict stops cached', async () => {
  const retryCached = deferred();
  let cachedReads = 0;
  const reconciledResponses = [
    response({ success: false, code: 'roster_snapshot_changed', authorityState: 'cached', rosterVersion: 'v2', active: [{ name: 'Fresh Reviewer' }] }, { ok: false, status: 409 }),
    response({ success: false, code: 'roster_snapshot_changed', authorityState: 'cached', rosterVersion: 'v3', active: [{ name: 'Freshest Reviewer' }] }, { ok: false, status: 409 }),
  ];
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    if (target === '/api/reviewer-finder/load-proposal') return Promise.resolve(response({ success: true, allFiles: [] }));
    if (target.includes('mode=cached')) {
      cachedReads += 1;
      return cachedReads === 1
        ? Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }))
        : retryCached.promise;
    }
    if (target.includes('mode=reconciled')) return Promise.resolve(reconciledResponses.shift());
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);
  await waitFor(() => expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'cached', names: 'Freshest Reviewer', error: expect.stringMatching(/changed again while checking current status/i), displayOnly: 'true' })));
  expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('mode=reconciled'))).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Retry warm roster' }));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('mode=cached'))).toHaveLength(2));
  expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'refreshing', names: 'Freshest Reviewer', displayOnly: 'true' }));
});

test('reconciliation failure retains cached cards and exposes error state', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    if (target === '/api/reviewer-finder/load-proposal') return Promise.resolve(response({ success: true, allFiles: [] }));
    if (target.includes('mode=cached')) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v1', active: [{ name: 'Cached Reviewer' }] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: false, error: 'Dataverse unavailable' }, { ok: false, status: 503 }));
    throw new Error(`Unexpected fetch ${target}`);
  });

  render(<ReviewerFindPanel requestId={REQ_A} />);
  await waitFor(() => expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'error', names: 'Cached Reviewer', error: 'Dataverse unavailable', displayOnly: 'true' })));
});

test('late cached response for a previous request cannot overwrite the new request roster', async () => {
  const cachedA = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) return Promise.resolve(response({ success: true, recommended: [], slotsPopulated: 0 }));
    if (target === '/api/reviewer-finder/load-proposal') return Promise.resolve(response({ success: true, allFiles: [] }));
    if (target.includes('mode=cached') && target.includes(REQ_A)) return cachedA.promise;
    if (target.includes('mode=cached') && target.includes(REQ_B)) return Promise.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v-b', active: [{ name: 'Reviewer B' }] }));
    if (target.includes('mode=reconciled')) return Promise.resolve(response({ success: true, authorityState: 'current', rosterVersion: 'v-b', active: [{ name: 'Reviewer B' }] }));
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerFindPanel requestId={REQ_A} />);
  rerender(<ReviewerFindPanel requestId={REQ_B} />);
  await waitFor(() => expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'current', names: 'Reviewer B', displayOnly: 'true' })));
  await act(async () => {
    cachedA.resolve(response({ success: true, authorityState: 'cached', rosterVersion: 'v-a', active: [{ name: 'Reviewer A' }] }));
    await cachedA.promise;
  });
  expect(rosterBinding()).toEqual(expect.objectContaining({ state: 'current', names: 'Reviewer B', displayOnly: 'true' }));
});
