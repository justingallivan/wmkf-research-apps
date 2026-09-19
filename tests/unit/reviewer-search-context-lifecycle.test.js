/**
 * @jest-environment jsdom
 *
 * P2 context-lifecycle characterization for the reviewer-search workspace.
 * The roster boundary is deferred or counted explicitly; no provider/store is
 * contacted by these tests.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';

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
  return { ok, status, json: async () => body };
}

function candidate(name, candidateKey) {
  return {
    name,
    candidateKey,
    email: `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`,
    emailSource: 'staff_verified',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    addressTrustReceipt: {
      receiptId: `receipt-${candidateKey}`,
      personConfirmed: true,
      email: `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`,
    },
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
  };
}

function rosterSnapshot(active) {
  return {
    success: true,
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: active.map((row) => row.name),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('a deferred roster response for request A cannot clobber the active request B snapshot', async () => {
  const rosterA = deferred();
  const rosterB = deferred();
  const candidateA = candidate('Request A reviewer', 'search:a');
  const candidateB = candidate('Request B reviewer', 'search:b');

  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (!target.includes('/api/workbench/reviewer-roster?')) throw new Error(`unexpected fetch ${target}`);
    if (target.includes(REQ_A)) return rosterA.promise;
    if (target.includes(REQ_B)) return rosterB.promise;
    throw new Error(`unexpected request ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  expect(global.fetch).toHaveBeenCalledWith(`/api/workbench/reviewer-roster?requestId=${REQ_A}`);

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
    rosterB.resolve(response(rosterSnapshot([candidateB])));
    await rosterB.promise;
  });
  expect(await screen.findByLabelText('Select Request B reviewer')).toBeInTheDocument();
  expect(global.fetch).toHaveBeenCalledWith(`/api/workbench/reviewer-roster?requestId=${REQ_B}`);

  await act(async () => {
    rosterA.resolve(response(rosterSnapshot([candidateA])));
    await rosterA.promise;
  });
  await waitFor(() => expect(screen.getByLabelText('Select Request B reviewer')).toBeInTheDocument());
  expect(screen.queryByLabelText('Select Request A reviewer')).not.toBeInTheDocument();
});

test('a proposalKey-only change preserves current fields and does not reload the roster', async () => {
  const active = candidate('Stable reviewer', 'search:stable');
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterSnapshot([active])));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      excludedNames={['Applicant exclusion']}
    />,
  );
  const checkbox = await screen.findByLabelText('Select Stable reviewer');
  fireEvent.click(checkbox);
  const excludeBox = screen.getByDisplayValue('Applicant exclusion');

  rerender(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-b"
      excludedNames={['Applicant exclusion']}
    />,
  );

  expect(screen.getByLabelText('Select Stable reviewer')).toBeChecked();
  expect(excludeBox).toHaveValue('Applicant exclusion');
  expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/workbench/reviewer-roster?'))).toHaveLength(1);
});

test('a late excludedNames update cannot overwrite a manually edited exclusion list', async () => {
  const { rerender } = render(
    <ReviewerSearchSection
      requestId={null}
      blobUrl="blob-a"
      excludedNames={['Initial applicant exclusion']}
    />,
  );
  const excludeBox = await screen.findByDisplayValue('Initial applicant exclusion');
  fireEvent.change(excludeBox, { target: { value: 'Manual exclusion' } });
  rerender(<ReviewerSearchSection requestId={null} blobUrl="blob-a" excludedNames={['Late applicant exclusion']} />);

  expect(screen.getByDisplayValue('Manual exclusion')).toBeInTheDocument();
  expect(screen.queryByDisplayValue('Late applicant exclusion')).not.toBeInTheDocument();
});

test('ordinary parent rerenders do not start another roster GET', async () => {
  const active = candidate('Rerender-safe reviewer', 'search:rerender-safe');
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterSnapshot([active])));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" onSaved={() => {}} />,
  );
  await screen.findByLabelText('Select Rerender-safe reviewer');
  const rosterGets = () => global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/workbench/reviewer-roster?'));
  expect(rosterGets()).toHaveLength(1);

  rerender(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" onSaved={() => {}} />);
  rerender(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" onSaved={() => {}} />);
  rerender(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" onSaved={() => {}} />);

  await waitFor(() => expect(rosterGets()).toHaveLength(1));
});
