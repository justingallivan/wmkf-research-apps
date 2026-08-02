/**
 * @jest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../shared/components/reviewers/reviewer-search-logic', () => {
  const actual = jest.requireActual('../../shared/components/reviewers/reviewer-search-logic');
  return { ...actual, isCandidateSelectable: jest.fn(() => true) };
});

import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

function candidate(name, email) {
  return {
    candidateKey: `person:${email}`,
    name,
    email,
    emailSource: 'pubmed',
    identityStatus: 'probable',
    provenance: { kind: 'literature_retrieved', sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
  };
}

test('a completed export from request A cannot surface its error after switching to request B', async () => {
  const candidateA = candidate('Dr Candidate A', 'a-example-edu');
  const candidateB = candidate('Dr Candidate B', 'b-example-edu');
  const exportRequest = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?') && target.includes(REQ_A)) {
      return Promise.resolve(response({ success: true, active: [candidateA], excluded: [], allNames: [candidateA.name] }));
    }
    if (target.includes('/api/workbench/reviewer-roster?') && target.includes(REQ_B)) {
      return Promise.resolve(response({ success: true, active: [candidateB], excluded: [], allNames: [candidateB.name] }));
    }
    if (target === '/api/workbench/export-candidates') return exportRequest.promise;
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />,
  );
  fireEvent.click(await screen.findByLabelText('Select Dr Candidate A'));
  fireEvent.click(screen.getByRole('button', { name: /export 1 to excel/i }));

  rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  await screen.findByLabelText('Select Dr Candidate B');
  fireEvent.click(screen.getByLabelText('Select Dr Candidate B'));
  await act(async () => {
    exportRequest.resolve(response({ error: 'Old request export failed' }, false, 500));
    await exportRequest.promise;
  });

  await waitFor(() => expect(screen.queryByText(/Old request export failed/)).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: /export 1 to excel/i })).toBeEnabled();
});
