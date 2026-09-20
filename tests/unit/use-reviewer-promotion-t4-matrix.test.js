/**
 * @jest-environment jsdom
 *
 * useReviewerPromotion — T4 client-request-layer matrix (Stage 4) addendum.
 * The body-level branches (partial non-2xx save results, applicant promotion
 * failures, stale-conflict reload) are already pinned by
 * tests/unit/reviewer-search-promotion-reconciliation.test.js. This file adds
 * the request-byte and malformed-2xx (axis e) pins for the file's 3
 * non-SSE fetch sites ahead of migrating onto shared/utils/api-request.js:
 *   - refreshExpiredVerification's roster POST  /api/workbench/reviewer-roster
 *   - saveSelected's save-candidates POST        /api/reviewer-finder/save-candidates
 *     (D1: unguarded — sData is read regardless of HTTP status; only
 *     synthesizes a failure when `saved === 0`, preserved as-is)
 *   - the applicant-promotion POST               /api/workbench/promote-applicant-reviewer
 * enrich-contacts (line 60) is confirmed SSE (its response is handed to
 * readSseStream) and stays raw per the §2.6 allowlist.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const candidate = (name, email, over = {}) => ({
  name,
  email,
  emailSource: 'pubmed',
  emailPersistAllowed: true,
  addressTrustReceipt: { receiptId: `receipt-${email}`, personConfirmed: true, email },
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['pubmed'], seedRole: 'query_seed', groundingWorkIds: [] },
  ...over,
});

function response(body, ok = true, status = ok ? 200 : 422) {
  return { ok, status, json: async () => body };
}

afterEach(() => {
  jest.clearAllMocks();
  readSseStream.mockReset();
  global.fetch = jest.fn();
});

test('saveSelected: save-candidates POST sends exact body bytes/headers; a malformed 2xx body is tolerated to {} (no crash, D1-preserve)', async () => {
  const c = candidate('Ada Lovelace', 'ada@example.edu');
  let sentOpts = null;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [c], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [c.name] }));
    }
    if (target === '/api/reviewer-finder/save-candidates') {
      sentOpts = options;
      return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${c.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(sentOpts).not.toBeNull());
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  const sentBody = JSON.parse(sentOpts.body);
  expect(sentBody).toMatchObject({ requestId: REQ, proposalTitle: null, programArea: null });
  expect(sentBody.candidates).toHaveLength(1);
  expect(sentBody.candidates[0]).toMatchObject({ name: c.name, email: c.email, emailSource: c.emailSource });
  // Malformed body -> {} -> saved=0, no results, no crash; a generic failure surfaces.
  expect(await screen.findByText(/Save failed \(200\)/)).toBeInTheDocument();
});

test('applicant promotion: POST sends exact body bytes/headers; a malformed 2xx body falls back to the status-embedded message', async () => {
  const suggestionId = '44444444-4444-4444-4444-444444444444';
  const c = candidate('Referred Person', 'ref@example.edu', {
    candidateKey: `suggestion:${suggestionId}`,
    suggestionId,
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: { kind: 'applicant_suggested', sources: ['applicant'], seedRole: 'query_seed', groundingWorkIds: [] },
  });
  let sentOpts = null;
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [c], excluded: [], ineligible: [], blocked: [], savedKeys: [], allNames: [c.name] }));
    }
    if (target === '/api/workbench/promote-applicant-reviewer') {
      sentOpts = options;
      return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByLabelText(`Select ${c.name}`));
  fireEvent.click(screen.getByRole('button', { name: /add 1 selected to invite/i }));

  await waitFor(() => expect(sentOpts).not.toBeNull());
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toEqual({ requestId: REQ, suggestionId });
  expect(await screen.findByText(/Adding to Invite failed \(200\)/)).toBeInTheDocument();
});
