/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
const { reviewerSaveKey } = require('../../lib/utils/reviewer-save-key');

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const candidate = (name, email) => ({
  name,
  email,
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  addressTrustReceipt: {
    receiptId: `receipt-${email}`,
    personConfirmed: true,
    email,
  },
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
const EXCLUDED_CANDIDATE = candidate('Dr Excluded Candidate', 'excluded@example.edu');

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

async function runStaleSave(saveResponse) {
  const save = deferred();
  const onSaved = jest.fn();
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      if (target.includes(REQ_A)) return Promise.resolve(response({ success: true, active: [CANDIDATE_A], excluded: [], allNames: [CANDIDATE_A.name] }));
      if (target.includes(REQ_B)) return Promise.resolve(response({ success: true, active: [CANDIDATE_B], excluded: [], allNames: [CANDIDATE_B.name] }));
    }
    if (target === '/api/reviewer-finder/save-candidates') return save.promise;
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({ success: true }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  const { rerender } = render(<ReviewerSearchSection
    requestId={REQ_A}
    blobUrl="blob-a"
    proposalKey="proposal-a"
    onSaved={onSaved}
  />);
  await screen.findByLabelText('Select Dr Candidate A');
  fireEvent.click(screen.getByLabelText('Select Dr Candidate A'));
  fireEvent.click(screen.getByRole('button', { name: /promote 1 selected to invite/i }));

  await act(async () => {
    rerender(<ReviewerSearchSection
      requestId={REQ_B}
      blobUrl="blob-b"
      proposalKey="proposal-b"
      onSaved={onSaved}
    />);
  });
  await screen.findByLabelText('Select Dr Candidate B');

  await act(async () => {
    save.resolve(saveResponse);
    await save.promise;
  });
  await waitFor(() => expect(screen.getByLabelText('Select Dr Candidate B')).toBeInTheDocument());
  return { onSaved };
}

test('late success from the prior request cannot graduate or complete the new request UI', async () => {
  const { onSaved } = await runStaleSave(response({
    success: true,
    savedCount: 1,
    savedNames: [CANDIDATE_A.name],
    savedKeys: [reviewerSaveKey(CANDIDATE_A)],
  }));
  expect(screen.getByLabelText('Select Dr Candidate B')).toBeInTheDocument();
  expect(screen.queryByText(/Saved 1 of 1/)).not.toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});

test('late failure from the prior request cannot paint an error onto the new request', async () => {
  const { onSaved } = await runStaleSave(response({ error: 'Old request failed' }, false, 500));
  expect(screen.getByLabelText('Select Dr Candidate B')).toBeInTheDocument();
  expect(screen.queryByText(/Old request failed/)).not.toBeInTheDocument();
  expect(onSaved).not.toHaveBeenCalled();
});

test('candidate results use the page scroll instead of a nested fixed-height scroller', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [CANDIDATE_A],
        excluded: [],
        allNames: [CANDIDATE_A.name],
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);

  const list = await screen.findByTestId('reviewer-candidate-list');
  expect(list).not.toHaveClass('max-h-[32rem]');
  expect(list).not.toHaveClass('overflow-y-auto');
});

test('a parent-owned warm snapshot is display-only and does not issue a second roster GET', async () => {
  global.fetch = jest.fn();
  render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      displayOnly
      rosterSnapshot={{
        requestId: REQ_A,
        authorityState: 'current',
        rosterVersion: 'v1',
        data: {
          active: [CANDIDATE_A],
          excluded: [EXCLUDED_CANDIDATE],
          ineligible: [],
          blocked: [],
          savedKeys: [],
          allNames: [CANDIDATE_A.name, EXCLUDED_CANDIDATE.name],
        },
      }}
    />,
  );

  expect(await screen.findByText(CANDIDATE_A.name)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${CANDIDATE_A.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /pubmed/i })).toBeDisabled();
  expect(screen.getByRole('slider', { name: /number of candidates to find/i })).toBeDisabled();
  expect(screen.queryByRole('button', { name: /exclude/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /promote back/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /run reviewer search/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /promote/i })).toBeDisabled();
  expect(global.fetch).not.toHaveBeenCalled();
});

test('a parent-owned request change clears old roster cards before its cached snapshot arrives', async () => {
  const snapshotA = {
    requestId: REQ_A,
    authorityState: 'current',
    rosterVersion: 'v-a',
    data: { active: [CANDIDATE_A], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [CANDIDATE_A.name] },
  };
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" displayOnly rosterSnapshot={snapshotA} />,
  );
  expect(await screen.findByText(CANDIDATE_A.name)).toBeInTheDocument();

  rerender(
    <ReviewerSearchSection
      requestId={REQ_B}
      blobUrl="blob-b"
      proposalKey="proposal-b"
      displayOnly
      rosterSnapshot={{ requestId: REQ_B, authorityState: 'refreshing', data: null }}
    />,
  );
  await waitFor(() => expect(screen.queryByText(CANDIDATE_A.name)).not.toBeInTheDocument());

  // A late parent snapshot for request A is ignored while request B is active.
  rerender(
    <ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" displayOnly rosterSnapshot={snapshotA} />,
  );
  await waitFor(() => expect(screen.queryByText(CANDIDATE_A.name)).not.toBeInTheDocument());
});

test('stopped or stale reconciliation exposes the display-only retry control', async () => {
  const onRetryRoster = jest.fn();
  const snapshot = {
    requestId: REQ_A,
    authorityState: 'cached',
    reconciliationStopped: true,
    error: 'Reviewer roster changed again while checking current status.',
    data: { active: [CANDIDATE_A], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [CANDIDATE_A.name] },
  };
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" displayOnly rosterSnapshot={snapshot} onRetryRoster={onRetryRoster} />,
  );
  expect(await screen.findByText(CANDIDATE_A.name)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(snapshot.error);
  fireEvent.click(screen.getByRole('button', { name: /retry reviewer status/i }));
  expect(onRetryRoster).toHaveBeenCalledTimes(1);

  rerender(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      displayOnly
      rosterSnapshot={{ ...snapshot, authorityState: 'stale', reconciliationStopped: false, error: 'Dataverse status is stale.' }}
      onRetryRoster={onRetryRoster}
    />,
  );
  expect(screen.getByRole('status')).toHaveTextContent('Dataverse status is stale.');
  expect(screen.getByRole('button', { name: /retry reviewer status/i })).toBeEnabled();
});

test('promotion progress and completion stay in a live status beside the action', async () => {
  const save = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({
        success: true,
        active: [CANDIDATE_A],
        excluded: [],
        allNames: [CANDIDATE_A.name],
      }));
    }
    if (target === '/api/reviewer-finder/save-candidates') return save.promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByLabelText('Select Dr Candidate A'));
  fireEvent.click(screen.getByRole('button', { name: /promote 1 selected to invite/i }));

  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Promoting 1 selected reviewer…');
  expect(screen.getByRole('button', { name: /promoting 1 selected reviewer/i })).toBeDisabled();

  await act(async () => {
    save.resolve(response({
      success: true,
      savedCount: 1,
      savedNames: [CANDIDATE_A.name],
      savedKeys: [reviewerSaveKey(CANDIDATE_A)],
    }));
    await save.promise;
  });

  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent("Saved 1 of 1 to this request's candidate pool."));
  expect(screen.queryByLabelText('Select Dr Candidate A')).not.toBeInTheDocument();
});
