/**
 * @jest-environment jsdom
 */

import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';
import { reviewerSaveKey } from '../../lib/utils/reviewer-save-key';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';

const candidate = (name, email) => ({
  name,
  email,
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  addressTrustReceipt: { receiptId: `receipt-${email}`, personConfirmed: true, email },
  identityStatus: 'probable',
  provenance: {
    kind: 'literature_retrieved',
    sources: ['pubmed'],
    seedRole: 'query_seed',
    groundingWorkIds: [],
  },
});

const CANDIDATE_A = candidate('Dr Candidate A', 'a@example.edu');
const CANDIDATE_B = candidate('Dr Candidate B', 'b@example.edu');
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function response(body, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
    blob: async () => new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    headers: { get: () => 'attachment; filename="reviewers.xlsx"' },
  };
}

function rosterResponse(active) {
  return response({
    success: true,
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: active.map((row) => row.name),
  });
}

function reactHandler(node, name) {
  const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  if (!propsKey || typeof node[propsKey]?.[name] !== 'function') {
    throw new Error(`React ${name} handler not found on test node`);
  }
  return node[propsKey][name];
}

beforeEach(() => {
  jest.clearAllMocks();
  window.confirm = jest.fn(() => true);
  global.fetch = jest.fn();
});

afterEach(() => {
  delete window.confirm;
  HTMLAnchorElement.prototype.click = originalAnchorClick;
  if (originalCreateObjectURL) URL.createObjectURL = originalCreateObjectURL;
  else delete URL.createObjectURL;
  if (originalRevokeObjectURL) URL.revokeObjectURL = originalRevokeObjectURL;
  else delete URL.revokeObjectURL;
  jest.restoreAllMocks();
});

test('a rejected exclusion from request A cannot restore its candidate into request B', async () => {
  const exclusion = deferred();
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(target.includes(REQ_A) ? rosterResponse([CANDIDATE_A]) : rosterResponse([CANDIDATE_B]));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') return exclusion.promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: `Not a fit: ${CANDIDATE_A.name}` }));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  expect(await screen.findByLabelText(`Select ${CANDIDATE_B.name}`)).toBeInTheDocument();

  await act(async () => {
    exclusion.reject(new Error('exclude failed'));
    await exclusion.promise.catch(() => {});
  });
  await waitFor(() => expect(screen.getByLabelText(`Select ${CANDIDATE_B.name}`)).toBeInTheDocument());
  expect(screen.queryByLabelText(`Select ${CANDIDATE_A.name}`)).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't exclude that reviewer — please try again.")).not.toBeInTheDocument();
});

test('a rejected unverified exclusion from request A cannot restore state into request B', async () => {
  const exclusion = deferred();
  const unverified = {
    name: 'Unverified A',
    affiliation: 'Example U',
    verified: false,
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    reason: 'No matching publications',
  };
  readSseStream
    .mockImplementationOnce(async (_response, handler) => {
      handler({ event: 'result', data: { proposalInfo: { title: 'A' } } });
    })
    .mockImplementationOnce(async (_response, handler) => {
      handler({ event: 'result', data: { ranked: [], unverified: [unverified] } });
    });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([]));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') return exclusion.promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByText(/Unverified suggestions \(1\)/);
  fireEvent.click(screen.getByRole('button', { name: 'Not a fit: Unverified A' }));
  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  await act(async () => {
    exclusion.reject(new Error('exclude failed'));
    await exclusion.promise.catch(() => {});
  });
  expect(screen.queryByText('Unverified A')).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn't exclude that reviewer — please try again.")).not.toBeInTheDocument();
});

test('late stream progress from request A cannot paint request B', async () => {
  const streams = [deferred(), deferred()];
  const analysisHandlers = [];
  readSseStream.mockImplementation(async (_response, handler) => {
    const stream = streams[analysisHandlers.length];
    analysisHandlers.push(handler);
    await stream.promise;
  });
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([]));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender, unmount } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(analysisHandlers).toHaveLength(1));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(analysisHandlers).toHaveLength(2));
  await act(async () => {
    analysisHandlers[0]({ event: 'message', data: { message: 'old request progress' } });
  });
  expect(screen.queryByText('old request progress')).not.toBeInTheDocument();
  unmount();
});

test('late applicant enrichment progress from request A cannot paint request B', async () => {
  const streams = [deferred(), deferred()];
  const handlers = [];
  const recommendation = { suggestionId: 'suggestion-a', name: 'Applicant Reviewer' };
  readSseStream.mockImplementation(async (_response, handler) => {
    handlers.push(handler);
    await streams[handlers.length - 1].promise;
  });
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([]));
    if (target === '/api/workbench/enrich-recommended') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      recommended={[recommendation]}
    />,
  );
  await waitFor(() => expect(handlers).toHaveLength(1));
  await act(async () => {
    rerender(
      <ReviewerSearchSection
        requestId={REQ_B}
        blobUrl="blob-b"
        proposalKey="proposal-b"
        recommended={[{ ...recommendation, suggestionId: 'suggestion-b' }]}
      />,
    );
  });
  await waitFor(() => expect(handlers).toHaveLength(2));
  await act(async () => {
    handlers[0]({ event: 'message', data: { message: 'old applicant progress' } });
  });
  expect(screen.queryByText('old applicant progress')).not.toBeInTheDocument();
  await act(async () => {
    streams[0].resolve();
    streams[1].resolve();
  });
});

test('a new request can start while the old search is pending and the old finally cannot clear its lock', async () => {
  const firstStream = deferred();
  const secondStream = deferred();
  let streamCount = 0;
  readSseStream.mockImplementation(async (_response, handler) => {
    streamCount += 1;
    if (streamCount === 1) {
      await firstStream.promise;
      handler({ event: 'result', data: { proposalInfo: { title: 'old' } } });
      return;
    }
    if (streamCount === 2) {
      await secondStream.promise;
      handler({ event: 'result', data: { proposalInfo: { title: 'new' } } });
      return;
    }
    handler({ event: 'result', data: { ranked: [] } });
  });
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([]));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(streamCount).toBe(1));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  const bSearchButton = await screen.findByRole('button', { name: 'Run reviewer search' });
  const bSearchHandler = reactHandler(bSearchButton, 'onClick');
  act(() => { bSearchHandler(); });
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/analyze')).toHaveLength(2));

  await act(async () => {
    firstStream.resolve();
    await firstStream.promise;
  });
  // Invoke the actual React handler captured before B started. This bypasses
  // the view's running-state button removal and exercises the imperative lock
  // after A's finally has run; a stale finally must not permit a third request.
  act(() => { bSearchHandler(); });
  expect(global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/analyze')).toHaveLength(2);

  await act(async () => {
    secondStream.resolve();
    await secondStream.promise;
  });
});

test('stale export response cannot download or leave a new request locked', async () => {
  const exportResponses = [deferred(), deferred()];
  let exportCount = 0;
  const click = jest.fn();
  const createObjectURL = jest.fn(() => 'blob:reviewers');
  const revokeObjectURL = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  HTMLAnchorElement.prototype.click = click;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(target.includes(REQ_A) ? rosterResponse([CANDIDATE_A]) : rosterResponse([CANDIDATE_B]));
    }
    if (target === '/api/workbench/export-candidates') return exportResponses[exportCount++].promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByLabelText(`Select ${CANDIDATE_A.name}`));
  fireEvent.click(screen.getByRole('button', { name: /Export 1 to Excel/i }));
  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  fireEvent.click(await screen.findByLabelText(`Select ${CANDIDATE_B.name}`));
  const bExportButton = screen.getByRole('button', { name: /Export 1 to Excel/i });
  const bExportHandler = reactHandler(bExportButton, 'onClick');
  act(() => { bExportHandler(); });
  expect(exportCount).toBe(2);
  await act(async () => {
    exportResponses[0].resolve(response({}));
    await exportResponses[0].promise;
  });
  expect(click).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByText(/Export failed:/)).not.toBeInTheDocument();
  // Invoke the same actual React handler after A's finally. The B lock must
  // reject the duplicate export even though the view button is disabled.
  act(() => { bExportHandler(); });
  expect(exportCount).toBe(2);
  await act(async () => {
    exportResponses[1].resolve(response({}));
    await exportResponses[1].promise;
  });
  expect(click).toHaveBeenCalledTimes(1);
});

test('an unmounted export response cannot download or write export state', async () => {
  const exportResponse = deferred();
  const click = jest.fn();
  const createObjectURL = jest.fn(() => 'blob:unmounted');
  const revokeObjectURL = jest.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  HTMLAnchorElement.prototype.click = click;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([CANDIDATE_A]));
    if (target === '/api/workbench/export-candidates') return exportResponse.promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  const { unmount } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByLabelText(`Select ${CANDIDATE_A.name}`));
  fireEvent.click(screen.getByRole('button', { name: /Export 1 to Excel/i }));
  unmount();
  await act(async () => {
    exportResponse.resolve(response({}));
    await exportResponse.promise;
  });
  expect(click).not.toHaveBeenCalled();
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
});

test('StrictMode effect cleanup does not invalidate the remounted lifecycle token', async () => {
  readSseStream
    .mockImplementationOnce(async (_response, handler) => {
      handler({ event: 'result', data: { proposalInfo: { title: 'Strict proposal' } } });
    })
    .mockImplementationOnce(async (_response, handler) => {
      handler({ event: 'result', data: { ranked: [], unverified: [] } });
    });
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterResponse([]));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  render(
    <StrictMode>
      <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />
    </StrictMode>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(global.fetch.mock.calls.filter(([url]) => url === '/api/reviewer-finder/analyze')).toHaveLength(1));
});

test('stale refresh stops issuing roster writes after the first row', async () => {
  const expiredRows = [
    {
      ...CANDIDATE_A,
      automatedIdentityAttestation: 'expired-a',
      contactEnrichment: { email: CANDIDATE_A.email, emailSource: 'pubmed' },
      candidateKey: 'candidate:a',
    },
    {
      ...CANDIDATE_B,
      automatedIdentityAttestation: 'expired-b',
      contactEnrichment: { email: CANDIDATE_B.email, emailSource: 'pubmed' },
      candidateKey: 'candidate:b',
    },
  ];
  const firstRosterWrite = deferred();
  let rosterWrites = 0;
  const refreshed = expiredRows.map((row, index) => ({
    ...row,
    email: `${index === 0 ? 'fresh-a' : 'fresh-b'}@example.edu`,
    automatedIdentityAttestation: `fresh-${index}`,
  }));
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(rosterResponse(expiredRows));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      return Promise.resolve(response({
        success: false,
        savedCount: 0,
        savedKeys: [],
        errors: expiredRows.map((row, index) => ({
          name: row.name,
          candidateKey: reviewerSaveKey(row),
          index,
          code: 'identity_attestation_required',
          error: 'Candidate verification has expired or is incomplete.',
        })),
        results: expiredRows.map((row, index) => ({
          name: row.name,
          candidateKey: reviewerSaveKey(row),
          index,
          outcome: 'failed',
          code: 'identity_attestation_required',
        })),
      }, false, 422));
    }
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      rosterWrites += 1;
      if (rosterWrites === 1) return firstRosterWrite.promise;
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_response, handler) => {
    handler({ event: 'complete', data: { type: 'complete', results: refreshed } });
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByLabelText(`Select ${CANDIDATE_A.name}`));
  fireEvent.click(screen.getByLabelText(`Select ${CANDIDATE_B.name}`));
  fireEvent.click(screen.getByRole('button', { name: /Add 2 selected to Invite/i }));
  await waitFor(() => expect(rosterWrites).toBe(1));
  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
    firstRosterWrite.resolve(response({ success: true, recorded: 1 }));
    await firstRosterWrite.promise;
  });
  expect(rosterWrites).toBe(1);
});
