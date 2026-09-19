/**
 * @jest-environment jsdom
 *
 * P4 prerequisite: exercise the public ReviewerSearchSection facade with the
 * real SSE reader. Existing history tests intentionally mock readSseStream;
 * reviewer-sse.test.js covers parser framing only.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'util';
import { ReadableStream as NodeReadableStream } from 'stream/web';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

if (typeof global.TextEncoder === 'undefined') global.TextEncoder = NodeTextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = NodeTextDecoder;
if (typeof global.ReadableStream === 'undefined') global.ReadableStream = NodeReadableStream;

const REQUEST_ID = '11111111-1111-1111-1111-111111111111';

const rosterSnapshot = {
  success: true,
  active: [],
  excluded: [],
  ineligible: [],
  blocked: [],
  handled: [],
  savedKeys: [],
  allNames: [],
};

const response = (body, { ok = true, status = ok ? 200 : 500, stream = null } = {}) => ({
  ok,
  status,
  body: stream,
  json: async () => body,
});

function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Build a fetch-like response whose body is an actual fragmented
 * ReadableStream. Byte-by-byte chunks deliberately split UTF-8 and SSE lines.
 */
function streamResponse(text, { failAfter = false, ok = true, status = ok ? 200 : 500, body = true } = {}) {
  if (!body) return response({}, { ok, status, stream: null });
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream({
    start() {},
    pull(controller) {
      if (offset < bytes.length) {
        controller.enqueue(bytes.slice(offset, offset + 1));
        offset += 1;
        return;
      }
      if (failAfter) controller.error(new Error('transport closed after terminal frame'));
      else controller.close();
    },
  });
  return response({}, { ok, status, stream });
}

function candidate(name, overrides = {}) {
  const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.edu`;
  return {
    name,
    affiliation: 'Example University',
    email,
    emailSource: 'institution_page',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    verificationStatus: 'verified',
    addressTrustReceipt: { receiptId: `receipt-${name}`, personConfirmed: true, email },
    publicationCount5yr: 3,
    publications: [{ title: `${name} study`, year: 2025 }],
    source: 'pubmed',
    verificationSource: 'pubmed',
    expertiseAreas: ['immunology'],
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: ['PMID:1'],
    },
    ...overrides,
  };
}

function installSearchFetch({ analyze, discover, enrich, roster = null, onRosterPost } = {}) {
  const calls = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(roster || rosterSnapshot));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(analyze);
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(discover);
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(enrich);
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      if (onRosterPost) return onRosterPost(options);
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  return calls;
}

function renderSearch() {
  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob://proposal" proposalKey="proposal" />);
}

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = jest.fn();
});

test('runs analyze, discover, enrich through real fragmented SSE and awaits pruned roster persistence', async () => {
  const active = candidate('Ada Active', { publicationCount5yr: 1 });
  const offTopic = candidate('Zed Off Topic', {
    publicationCount5yr: 5,
    aiFlaggedNotRelevant: true,
  });
  const deceased = candidate('Dora Deceased', {
    eligibilityStatus: 'deceased',
    eligibilityEvidence: { url: 'https://example.edu/deceased' },
  });
  const enrichedActive = {
    ...active,
    contactEnrichment: {
      email: active.email,
      emailSource: 'institution_page',
      tierResults: {
        openalex_author: { rawPayload: 'must not persist' },
        serp_search: { rawPayload: 'must not persist' },
      },
      contactLeads: [],
    },
  };
  let rosterPostSettled = false;
  let resolveRosterPost;
  const rosterPost = new Promise((resolve) => { resolveRosterPost = resolve; });

  const calls = installSearchFetch({
    analyze: streamResponse([
      sseFrame('progress', { message: 'Analyzing 🧪 proposal' }),
      sseFrame('result', { proposalInfo: { title: 'Proposal', keywords: 'immunology', authorInstitution: 'Example University' } }),
    ].join('')),
    discover: streamResponse([
      sseFrame('progress', { message: 'Searching databases' }),
      sseFrame('result', { ranked: [offTopic, active, deceased], unverified: [] }),
    ].join('')),
    enrich: streamResponse([
      sseFrame('progress', { type: 'progress', overall: { current: 1, total: 3 } }),
      sseFrame('complete', { type: 'complete', results: [offTopic, enrichedActive, deceased] }),
    ].join('')),
    onRosterPost: (options) => {
      rosterPost.then(() => { rosterPostSettled = true; });
      return rosterPost;
    },
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('Ada Active')).toBeInTheDocument();
  expect(screen.getByText('Analyzing 🧪 proposal')).toBeInTheDocument();
  expect(screen.getByText('Zed Off Topic')).toBeInTheDocument();
  expect(screen.queryByLabelText('Select Dora Deceased')).not.toBeInTheDocument();
  expect(screen.getByText(/Not eligible \(1\)/)).toBeInTheDocument();
  const listText = screen.getByTestId('reviewer-candidate-list').textContent;
  expect(listText.indexOf('Ada Active')).toBeLessThan(listText.indexOf('Zed Off Topic'));
  expect(rosterPostSettled).toBe(false);
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();

  const rosterCall = calls.find(({ target, options }) => (
    target === '/api/workbench/reviewer-roster' && options.method === 'POST'
  ));
  expect(rosterCall).toBeDefined();
  const rosterBody = JSON.parse(rosterCall.options.body);
  expect(rosterBody.requestId).toBe(REQUEST_ID);
  expect(rosterBody.candidates.map(({ name }) => name)).toEqual([
    'Ada Active',
    'Dora Deceased',
    'Zed Off Topic',
  ]);
  expect(rosterBody.candidates[0].contactEnrichment).toEqual(expect.objectContaining({ contactLeads: [] }));
  expect(rosterBody.candidates[0].contactEnrichment.tierResults).toBeUndefined();
  expect(rosterBody.candidates[0].contactEnrichment.emailSource).toBe('institution_page');

  await act(async () => {
    resolveRosterPost(response({ success: true, recorded: 3 }));
    await rosterPost;
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(rosterPostSettled).toBe(true);
  expect(calls.map(({ target, options }) => `${options.method || 'GET'} ${target}`)).toEqual([
    `GET /api/workbench/reviewer-roster?requestId=${encodeURIComponent(REQUEST_ID)}`,
    'POST /api/reviewer-finder/analyze',
    'POST /api/reviewer-finder/discover',
    'POST /api/reviewer-finder/enrich-contacts',
    'POST /api/workbench/reviewer-roster',
  ]);
});

test.each(['discovery', 'enrichment'])('accepts a %s transport error after its terminal result', async (failedPhase) => {
  const found = candidate('Grace Found');
  const calls = installSearchFetch({
    analyze: streamResponse(sseFrame('result', { proposalInfo: { title: 'Proposal', keywords: 'immunology' } })),
    discover: streamResponse(sseFrame('result', { ranked: [found], unverified: [] }), { failAfter: failedPhase === 'discovery' }),
    enrich: streamResponse(sseFrame('complete', { type: 'complete', results: [found] }), { failAfter: failedPhase === 'enrichment' }),
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('Grace Found')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(calls.some(({ target }) => target === '/api/reviewer-finder/enrich-contacts')).toBe(true);
});

test('refuses discovery when the real stream fails before a ranked terminal frame', async () => {
  installSearchFetch({
    analyze: streamResponse(sseFrame('result', { proposalInfo: { title: 'Proposal', keywords: 'immunology' } })),
    discover: streamResponse(sseFrame('progress', { message: 'Searching' }), { failAfter: true }),
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('The candidate discovery connection was interrupted before results arrived. Please run the search again.')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalledWith('/api/reviewer-finder/enrich-contacts', expect.anything());
});

test('surfaces explicit analysis errors and rejects missing-body/non-OK SSE responses', async () => {
  installSearchFetch({
    analyze: streamResponse(sseFrame('error', { message: 'Analysis provider refused this proposal.', status: 'analysis_refused' })),
  });
  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByText('The analysis model declined this request.')).toBeInTheDocument();

  await expect(readSseStream(streamResponse('', { body: false }), jest.fn())).rejects.toThrow(
    'response has no readable stream body',
  );
  await expect(readSseStream(streamResponse('', { ok: false, status: 503 }), jest.fn())).rejects.toThrow(
    'SSE request failed (503)',
  );
});
