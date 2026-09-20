/**
 * @jest-environment jsdom
 *
 * useReviewerRoster — T4 client-request-layer matrix (Stage 4) addendum.
 * The non-2xx / success reload-and-retry flow is already pinned by
 * tests/unit/reviewer-search-history-controls.test.js ("a failed initial
 * roster load offers Retry..."). This file adds the request-shape and
 * malformed-2xx (axis e) pin for the file's 1 fetch site
 * (GET /api/workbench/reviewer-roster) ahead of migrating onto
 * shared/utils/api-request.js.
 */
import { render, screen } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ = '11111111-1111-1111-1111-111111111111';

afterEach(() => { global.fetch = jest.fn(); });

test('reloadRoster: GET has no body; a malformed 2xx body is tolerated to {} and treated as a load failure', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      sentOpts = opts;
      return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  expect(await screen.findByText(/Reviewer engagement could not be reconciled/i)).toBeInTheDocument();
  expect(sentOpts?.body).toBeUndefined();
  expect(sentOpts?.method === undefined || sentOpts?.method === 'GET').toBe(true);
});
