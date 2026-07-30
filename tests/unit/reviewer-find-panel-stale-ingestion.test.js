/**
 * @jest-environment jsdom
 */

import { act, render, screen, waitFor } from '@testing-library/react';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/reviewers/ReviewerSearchSection', () => function SearchStub({
  recommended,
  ingestError,
}) {
  return (
    <div
      data-testid="search"
      data-recommended={JSON.stringify(recommended || [])}
      data-error={ingestError || ''}
    />
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

afterEach(() => {
  jest.clearAllMocks();
});

test('late successful ingestion for request A cannot overwrite request B', async () => {
  const ingestA = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) {
      if (target.includes(REQ_A)) return ingestA.promise;
      return Promise.resolve(response({
        success: true,
        recommended: [{ suggestionId: 's-b', name: 'Reviewer B' }],
        slotsPopulated: 1,
      }));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      return Promise.resolve(response({ success: true, blobUrl: null, allFiles: [] }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerFindPanel requestId={REQ_A} />);
  await act(async () => {
    rerender(<ReviewerFindPanel requestId={REQ_B} />);
  });
  await waitFor(() => expect(renderedRecommendations()).toEqual([
    { suggestionId: 's-b', name: 'Reviewer B' },
  ]));

  await act(async () => {
    ingestA.resolve(response({
      success: true,
      recommended: [{ suggestionId: 's-a', name: 'Reviewer A' }],
      slotsPopulated: 1,
    }));
    await ingestA.promise;
  });

  expect(renderedRecommendations()).toEqual([
    { suggestionId: 's-b', name: 'Reviewer B' },
  ]);
});

test('late failed ingestion for request A cannot paint an error onto request B', async () => {
  const ingestA = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/applicant-reviewers')) {
      if (target.includes(REQ_A)) return ingestA.promise;
      return Promise.resolve(response({
        success: true,
        recommended: [{ suggestionId: 's-b', name: 'Reviewer B' }],
        slotsPopulated: 1,
      }));
    }
    if (target === '/api/reviewer-finder/load-proposal') {
      return Promise.resolve(response({ success: true, blobUrl: null, allFiles: [] }));
    }
    throw new Error(`Unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerFindPanel requestId={REQ_A} />);
  await act(async () => {
    rerender(<ReviewerFindPanel requestId={REQ_B} />);
  });
  await waitFor(() => expect(renderedRecommendations()).toHaveLength(1));

  await act(async () => {
    ingestA.reject(new Error('request A failed'));
    await ingestA.promise.catch(() => {});
  });

  expect(screen.getByTestId('search')).toHaveAttribute('data-error', '');
  expect(renderedRecommendations()[0].suggestionId).toBe('s-b');
});

