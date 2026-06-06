/**
 * @jest-environment jsdom
 *
 * ReviewerSearchSection — Track C v1 "Also search the web" toggle (read-only web
 * suggestions). Pins the capability gate that CI/lint can't see (cf.
 * feedback-profile-context-runtime-bugs): the toggle MUST be hidden when no
 * Perplexity key (/api/api-capabilities.reviewerWebSearch=false) and shown,
 * default-on, when it's true. Rendered with requestId=null so no roster fetch
 * fires — the only mount fetch is /api/api-capabilities.
 */
import { render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

// global.fetch is a shared jest.fn() from jest.setup.js — set its implementation,
// never reassign/delete it (other suites' beforeEach calls fetch.mockClear()).
function mockCapabilities(reviewerWebSearch) {
  global.fetch.mockImplementation(async (url) => {
    if (typeof url === 'string' && url.includes('/api/api-capabilities')) {
      return { ok: true, json: async () => ({ reviewerWebSearch }) };
    }
    // Any other fetch (none expected with requestId=null) resolves empty.
    return { ok: true, json: async () => ({}) };
  });
}

afterEach(() => { global.fetch.mockReset(); });

const TOGGLE = /Also search the web for current researchers/i;

test('toggle is hidden when reviewerWebSearch capability is false', async () => {
  mockCapabilities(false);
  render(<ReviewerSearchSection blobUrl="blob:x" requestId={null} />);
  // Let the capability effect resolve, then confirm the toggle never appears.
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByText(TOGGLE)).toBeNull();
});

test('toggle is shown and ON by default when reviewerWebSearch is true', async () => {
  mockCapabilities(true);
  render(<ReviewerSearchSection blobUrl="blob:x" requestId={null} />);
  const label = await screen.findByText(TOGGLE);
  expect(label).toBeInTheDocument();
  // The checkbox is the toggle's sibling input — default checked.
  const checkbox = label.closest('label').querySelector('input[type="checkbox"]');
  expect(checkbox).not.toBeNull();
  expect(checkbox.checked).toBe(true);
});
