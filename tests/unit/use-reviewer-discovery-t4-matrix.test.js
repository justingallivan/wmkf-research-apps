/**
 * @jest-environment jsdom
 *
 * useReviewerDiscovery — T4 client-request-layer matrix (Stage 4). The
 * analyze/discover/enrich-contacts sites (lines 74/117/187) are confirmed SSE
 * (their responses are handed to readSseStream) and stay raw per the §2.6
 * allowlist. Only the runSearch roster-persist POST
 * (/api/workbench/reviewer-roster) is a JSON site. These tests pin the exact
 * request bytes and require a complete per-item receipt followed by an
 * authoritative roster GET before the UI accepts saved state.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = '11111111-1111-1111-1111-111111111111';

function response(body, ok = true, status = ok ? 200 : 500) {
  const payload = body?.success === true && ('active' in body || 'allNames' in body)
    ? { active: [], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [], ...body }
    : body;
  return { ok, status, json: async () => payload, body: {} };
}

const freshCandidate = {
  candidateKey: 'candidate:fresh',
  name: 'Fresh Reviewer',
  email: 'fresh@example.edu',
  emailSource: 'openalex',
  contactEnrichment: { email: 'fresh@example.edu', emailSource: 'openalex' },
  emailPersistAllowed: true,
  addressTrustReceipt: { receiptId: 'receipt-fresh', personConfirmed: true, email: 'fresh@example.edu' },
  identityStatus: 'probable',
  provenance: { kind: 'literature_retrieved', sources: ['openalex'], seedRole: 'query_seed', groundingWorkIds: [] },
};

function mockPipeline({ rosterPost }) {
  const rosterState = { success: true, active: [], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [] };
  return jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(rosterState));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      const posted = JSON.parse(options.body).candidates;
      return Promise.resolve(rosterPost(options)).then(async (savedResponse) => {
        if (savedResponse.ok) {
          const receipt = await savedResponse.json();
          for (const outcome of receipt.outcomes || []) {
            if (outcome.status !== 'recorded') continue;
            // GET restores server-held address evidence, which POST pruning omits.
            const row = { ...posted[outcome.inputIndex], candidateKey: outcome.candidateKey, addressTrustReceipt: freshCandidate.addressTrustReceipt };
            rosterState.active.push(row);
            rosterState.allNames.push(row.name);
          }
        }
        return savedResponse;
      });
    }
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

beforeEach(() => { jest.resetAllMocks(); });
afterEach(() => { global.fetch = jest.fn(); });

test('runSearch roster-persist POST: exact body bytes/headers; recorded rows are adopted from GET', async () => {
  let sentOpts = null;
  global.fetch = mockPipeline({
    rosterPost: (opts) => {
      sentOpts = opts;
      const [row] = JSON.parse(opts.body).candidates;
      return response({ success: true, recorded: 1, outcomes: [{ inputIndex: 0, candidateKey: row.candidateKey, status: 'recorded' }] });
    },
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(screen.getByLabelText(`Select ${freshCandidate.name}`)).toBeInTheDocument();
  expect(sentOpts.method).toBe('POST');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  const body = JSON.parse(sentOpts.body);
  expect(body.requestId).toBe(REQ);
  expect(body.candidates).toHaveLength(1);
  expect(body.candidates[0].candidateKey).toBe(freshCandidate.candidateKey);
});

test('runSearch treats an unchanged receipt as GET-only and does not exclude a name absent from roster state', async () => {
  const fetch = mockPipeline({
    rosterPost: (opts) => {
      const [row] = JSON.parse(opts.body).candidates;
      return response({ success: true, recorded: 0, outcomes: [{ inputIndex: 0, candidateKey: row.candidateKey, status: 'unchanged' }] });
    },
  });
  global.fetch = fetch;
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [freshCandidate], unverified: [] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [freshCandidate] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'materials', authorInstitution: 'Example U' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [], unverified: [] } });
    });
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText(/1 search result could not be confirmed in the request roster/)).toBeInTheDocument();
  expect(screen.queryByText(freshCandidate.name)).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Run another search' }));

  await waitFor(() => {
    const analyzeBodies = fetch.mock.calls
      .filter(([url]) => String(url) === '/api/reviewer-finder/analyze')
      .map(([, options]) => JSON.parse(options.body));
    const discoverBodies = fetch.mock.calls
      .filter(([url]) => String(url) === '/api/reviewer-finder/discover')
      .map(([, options]) => JSON.parse(options.body));
    expect(analyzeBodies).toHaveLength(2);
    expect(discoverBodies).toHaveLength(2);
    expect(analyzeBodies[1].excludedNames).not.toContain(freshCandidate.name);
    expect(discoverBodies[1].excludedNames).not.toContain(freshCandidate.name);
  });
  expect(screen.queryByText(freshCandidate.name)).not.toBeInTheDocument();
});

test('runSearch roster-persist POST with unknown outcome reloads GET and clears unconfirmed cards', async () => {
  global.fetch = mockPipeline({
    rosterPost: () => response({ error: 'db down' }, false, 500),
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByText('Could not confirm all search saves. Reviewer state was reloaded; run a new search to continue.')).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${freshCandidate.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeInTheDocument();
});

test('runSearch roster-persist network rejection reloads GET and clears unconfirmed cards', async () => {
  global.fetch = mockPipeline({
    rosterPost: () => Promise.reject(new Error('offline')),
  });
  mockSse();
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByText('Could not confirm all search saves. Reviewer state was reloaded; run a new search to continue.')).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${freshCandidate.name}`)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeInTheDocument();
});
