/**
 * @jest-environment jsdom
 *
 * useReviewerDiscovery — T4 client-request-layer matrix (Stage 4). The
 * analyze/discover/enrich-contacts sites (lines 74/117/187) are confirmed SSE
 * (their responses are handed to readSseStream) and stay raw per the §2.6
 * allowlist. Only the runSearch roster-persist POST
 * (/api/workbench/reviewer-roster, line 268) is a JSON site and migrates.
 * It checks ONLY `rRes.ok` (no body read) — this file pins the exact request
 * bytes and both the success and non-2xx-body-never-read outcomes ahead of
 * migrating onto shared/utils/api-request.js.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = '11111111-1111-1111-1111-111111111111';

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, body: {} };
}

const freshCandidate = {
  candidateKey: 'candidate:fresh',
  name: 'Fresh Reviewer',
  email: 'fresh@example.edu',
  emailSource: 'openalex',
  emailPersistAllowed: true,
  addressTrustReceipt: { receiptId: 'receipt-fresh', personConfirmed: true, email: 'fresh@example.edu' },
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
};

function mockPipeline({ rosterPost }) {
  return jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response({ success: true, active: [], excluded: [], allNames: [] }));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') return Promise.resolve(rosterPost(options));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
}

function mockSse() {
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [freshCandidate], unverified: [] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [freshCandidate] } });
    });
}

beforeEach(() => { jest.clearAllMocks(); });
afterEach(() => { global.fetch = jest.fn(); });

test('runSearch roster-persist POST: exact body bytes/headers; success merges into the active roster', async () => {
  let sentOpts = null;
  global.fetch = mockPipeline({
    rosterPost: (opts) => { sentOpts = opts; return response({ success: true, recorded: 1 }); },
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByLabelText(`Select ${freshCandidate.name}`);
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  const body = JSON.parse(sentOpts.body);
  expect(body.requestId).toBe(REQ);
  expect(body.candidates).toHaveLength(1);
  expect(body.candidates[0].candidateKey).toBe(freshCandidate.candidateKey);
});

test('runSearch roster-persist POST: non-2xx (body never read) surfaces the fixed roster-note failure, candidates still shown', async () => {
  global.fetch = mockPipeline({
    rosterPost: () => response({ error: 'db down' }, false, 500),
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByLabelText(`Select ${freshCandidate.name}`);
  expect(await screen.findByText("Couldn't save this search to the request — these candidates may re-appear on a future search.")).toBeInTheDocument();
});

test('runSearch roster-persist POST: network rejection surfaces the same fixed roster-note failure', async () => {
  global.fetch = mockPipeline({
    rosterPost: () => Promise.reject(new Error('offline')),
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByLabelText(`Select ${freshCandidate.name}`);
  expect(await screen.findByText("Couldn't save this search to the request — these candidates may re-appear on a future search.")).toBeInTheDocument();
});
