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

function installSearchFetch({ analyze, discover, enrich, roster = null, onRosterPost, onRosterGet } = {}) {
  const calls = [];
  let persistedRoster = roster || rosterSnapshot;
  let rosterGetCount = 0;
  const applyReceipt = (candidates, receipt) => {
    if (!receipt || !Array.isArray(receipt.outcomes)) return;
    const active = [...persistedRoster.active];
    const ineligible = [...persistedRoster.ineligible];
    const allNames = new Set(persistedRoster.allNames);
    receipt.outcomes.forEach((outcome, index) => {
      if (outcome.status !== 'recorded') return;
      const candidate = { ...candidates[index], candidateKey: outcome.candidateKey };
      allNames.add(candidate.name);
      const bucket = candidate.eligibilityStatus === 'deceased' ? ineligible : active;
      if (!bucket.some((row) => row.candidateKey === outcome.candidateKey)) bucket.push(candidate);
    });
    persistedRoster = { ...persistedRoster, active, ineligible, allNames: Array.from(allNames) };
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    calls.push({ target, options });
    if (target.includes('/api/workbench/reviewer-roster?')) {
      rosterGetCount += 1;
      if (onRosterGet) return Promise.resolve(onRosterGet(rosterGetCount, persistedRoster));
      return Promise.resolve(response(persistedRoster));
    }
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(analyze);
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(discover);
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(enrich);
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      const candidates = JSON.parse(options.body).candidates;
      const save = onRosterPost
        ? onRosterPost(options)
        : Promise.resolve(response({
            success: true,
            recorded: candidates.length,
            outcomes: candidates.map((candidate, inputIndex) => ({
              inputIndex,
              candidateKey: candidate.candidateKey,
              status: 'recorded',
            })),
          }));
      return Promise.resolve(save).then(async (savedResponse) => {
        const receipt = await savedResponse.json();
        if (savedResponse.ok) applyReceipt(candidates, receipt);
        return savedResponse;
      });
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
  expect(screen.queryByText(/Not eligible \(1\)/)).not.toBeInTheDocument();
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
    const postedCandidates = JSON.parse(rosterCall.options.body).candidates;
    resolveRosterPost(response({
      success: true,
      recorded: postedCandidates.length,
      outcomes: postedCandidates.map((candidate, inputIndex) => ({
        inputIndex,
        candidateKey: candidate.candidateKey,
        status: 'recorded',
      })),
    }));
    await rosterPost;
  });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Run another search' })).toBeEnabled());
  expect(screen.getByText(/Not eligible \(1\)/)).toBeInTheDocument();
  expect(rosterPostSettled).toBe(true);
  expect(calls.map(({ target, options }) => `${options.method || 'GET'} ${target}`)).toEqual([
    `GET /api/workbench/reviewer-roster?requestId=${encodeURIComponent(REQUEST_ID)}`,
    'POST /api/reviewer-finder/analyze',
    'POST /api/reviewer-finder/discover',
    'POST /api/reviewer-finder/enrich-contacts',
    'POST /api/workbench/reviewer-roster',
    `GET /api/workbench/reviewer-roster?requestId=${encodeURIComponent(REQUEST_ID)}`,
  ]);
});

test('partial roster receipts render the GET row and only GET names exclude the next discovery', async () => {
  const saved = candidate('Durable Result', { affiliation: 'Search Affiliation' });
  const failed = candidate('Retryable Result');
  const analyzeBodies = [];
  const analyze = streamResponse(sseFrame('result', {
    proposalInfo: { title: 'Proposal', keywords: 'immunology', authorInstitution: 'Example University' },
  }));
  const calls = installSearchFetch({
    analyze,
    discover: streamResponse(sseFrame('result', { ranked: [saved, failed], unverified: [] })),
    enrich: streamResponse(sseFrame('complete', { type: 'complete', results: [saved, failed] })),
    onRosterPost: (options) => {
      const posted = JSON.parse(options.body).candidates;
      return Promise.resolve(response({
        success: false,
        recorded: 1,
        outcomes: [
          { inputIndex: 0, candidateKey: 'server:durable-result', status: 'recorded' },
          { inputIndex: 1, candidateKey: posted[1].candidateKey, status: 'failed' },
        ],
      }));
    },
  });
  const originalFetch = global.fetch;
  global.fetch = jest.fn((url, options = {}) => {
    if (url === '/api/reviewer-finder/analyze') analyzeBodies.push(JSON.parse(options.body));
    return originalFetch(url, options);
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('Durable Result')).toBeInTheDocument();
  expect(await screen.findByText('Retryable Result')).toBeInTheDocument();
  expect(screen.getByText(/1 search result could not be confirmed/)).toBeInTheDocument();
  expect(calls.some(({ target, options }) => target.includes('/api/workbench/reviewer-roster?') && options.method === 'GET')).toBe(true);

  fireEvent.click(screen.getByRole('button', { name: 'Run another search' }));
  await waitFor(() => expect(analyzeBodies).toHaveLength(2));
  expect(analyzeBodies[1].excludedNames).toContain('Durable Result');
  expect(analyzeBodies[1].excludedNames).not.toContain('Retryable Result');
});

test('post-save reconciliation trusts canonical GET rows and never promotes protected or name-only rows', async () => {
  const submitted = [
    candidate('Canonical Reviewer'),
    candidate('Excluded Reviewer'),
    candidate('Ineligible Reviewer'),
    candidate('Blocked Reviewer'),
    candidate('Handled Reviewer'),
    candidate('Saved Name Only'),
    candidate('At Capacity Reviewer'),
  ].map((row, index) => ({ ...row, candidateKey: `candidate:reconciliation-${index}` }));
  const [canonical, excluded, ineligible, blocked, handled, nameOnly] = submitted;
  const authoritative = {
    ...canonical,
    affiliation: 'Authoritative GET affiliation',
    email: 'authoritative@example.edu',
    candidateKey: 'server:canonical-reconciliation',
  };
  const protectedSnapshot = {
    ...rosterSnapshot,
    active: [authoritative],
    excluded: [{ ...excluded, candidateKey: excluded.candidateKey }],
    ineligible: [{ ...ineligible, candidateKey: ineligible.candidateKey }],
    blocked: [{ ...blocked, candidateKey: blocked.candidateKey }],
    handled: [{ ...handled, candidateKey: handled.candidateKey }],
    savedKeys: [],
    allNames: [canonical.name, excluded.name, ineligible.name, blocked.name, handled.name, nameOnly.name],
  };
  const analyze = streamResponse(sseFrame('result', {
    proposalInfo: { title: 'Proposal', keywords: 'immunology' },
  }));
  const discovery = streamResponse(sseFrame('result', { ranked: submitted, unverified: [] }));
  const enrichment = streamResponse(sseFrame('complete', { type: 'complete', results: submitted }));
  installSearchFetch({
    analyze,
    discover: discovery,
    enrich: enrichment,
    onRosterGet: (count) => response(count === 1 ? rosterSnapshot : protectedSnapshot),
    onRosterPost: (options) => {
      const posted = JSON.parse(options.body).candidates;
      return Promise.resolve(response({
        success: false,
        recorded: 2,
        outcomes: posted.map((row, inputIndex) => ({
          inputIndex,
          candidateKey: inputIndex === 0 ? authoritative.candidateKey : row.candidateKey,
          status: inputIndex === 0 || inputIndex === 6
            ? 'recorded'
            : inputIndex === 5 ? 'failed' : 'unchanged',
        })),
      }));
    },
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  const cards = await screen.findByTestId('reviewer-candidate-list');
  await waitFor(() => expect(cards).toHaveTextContent('Authoritative GET affiliation'));
  expect(cards).toHaveTextContent('authoritative@example.edu');
  for (const hidden of submitted.slice(1)) expect(cards).not.toHaveTextContent(hidden.name);
  expect(cards).not.toHaveTextContent('Example University');
  expect(screen.getByText(/2 search results could not be confirmed/)).toBeInTheDocument();
  expect(screen.queryByText(/restored from an earlier search/)).not.toBeInTheDocument();
});

test.each([true, false])('a stale post-write GET (success=%s) cannot replace a new proposal context', async (ok) => {
  const found = candidate('Old Search Result');
  const current = candidate('New Proposal Roster', { candidateKey: 'candidate:new-proposal' });
  let resolvePostWriteGet;
  const pendingGet = new Promise((resolve) => { resolvePostWriteGet = resolve; });
  let postWriteGetStarted = false;
  installSearchFetch({
    analyze: streamResponse(sseFrame('result', { proposalInfo: { title: 'Proposal', keywords: 'immunology' } })),
    discover: streamResponse(sseFrame('result', { ranked: [found], unverified: [] })),
    enrich: streamResponse(sseFrame('complete', { type: 'complete', results: [found] })),
    onRosterGet: (count) => {
      if (count === 2) {
        postWriteGetStarted = true;
        return pendingGet;
      }
      return response(count === 1 ? rosterSnapshot : {
        ...rosterSnapshot, active: [current], allNames: [current.name],
      });
    },
  });
  const { rerender } = render(
    <ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-old" proposalKey="proposal" />,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(postWriteGetStarted).toBe(true));
  expect(screen.getByRole('button', { name: 'Run another search' })).toBeDisabled();

  rerender(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-new" proposalKey="proposal" />);
  expect(await screen.findByText(current.name)).toBeInTheDocument();
  await act(async () => {
    resolvePostWriteGet(response({ ...rosterSnapshot, active: [found], allNames: [found.name] }, { ok }));
    await pendingGet;
  });
  expect(screen.getByText(current.name)).toBeInTheDocument();
  expect(screen.queryByText(found.name)).not.toBeInTheDocument();
  expect(screen.queryByText(/could not be reloaded/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Run reviewer search' })).toBeEnabled();
});

test('malformed post-write GET clears uncertain cards and exposes a working roster-state retry', async () => {
  const found = candidate('Recovered From GET');
  const analyzeFrame = streamResponse(sseFrame('result', {
    proposalInfo: { title: 'Proposal', keywords: 'immunology' },
  }));
  let refreshedSnapshot = null;
  let postCount = 0;
  const calls = installSearchFetch({
    analyze: analyzeFrame,
    discover: streamResponse(sseFrame('result', { ranked: [found], unverified: [] })),
    enrich: streamResponse(sseFrame('complete', { type: 'complete', results: [found] })),
    onRosterGet: (getIndex, persisted) => {
      if (getIndex === 2) return response({ success: true, active: [] }); // malformed authoritative snapshot
      if (getIndex >= 3) return response(refreshedSnapshot || persisted);
      return response(persisted);
    },
    onRosterPost: (options) => {
      postCount += 1;
      const posted = JSON.parse(options.body).candidates;
      const key = 'server:recovered-from-get';
      refreshedSnapshot = {
        success: true,
        active: [{ ...posted[0], candidateKey: key, affiliation: 'GET authority' }],
        excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: [found.name],
      };
      return Promise.resolve(response({
        success: true,
        recorded: 1,
        outcomes: [{ inputIndex: 0, candidateKey: key, status: 'recorded' }],
      }));
    },
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByRole('button', { name: 'Retry reviewer state' })).toBeEnabled();
  expect(screen.queryByText('Recovered From GET')).not.toBeInTheDocument();
  expect(screen.getByText(/could not be reloaded/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry reviewer state' }));
  expect(await screen.findByText('Recovered From GET')).toBeInTheDocument();
  expect(screen.getByText('GET authority')).toBeInTheDocument();
  expect(postCount).toBe(1);
  expect(calls.filter(({ target, options }) => target === '/api/workbench/reviewer-roster' && options.method === 'POST')).toHaveLength(1);
});

test('a non-2xx roster body cannot acknowledge writes and empty results keep a fresh-search control', async () => {
  const found = candidate('Uncertain Result');
  const calls = installSearchFetch({
    analyze: streamResponse(sseFrame('result', { proposalInfo: { title: 'Proposal', keywords: 'immunology' } })),
    discover: streamResponse(sseFrame('result', { ranked: [found], unverified: [] })),
    enrich: streamResponse(sseFrame('complete', { type: 'complete', results: [found] })),
    onRosterPost: (options) => {
      const [posted] = JSON.parse(options.body).candidates;
      return Promise.resolve(response({
        success: true,
        recorded: 1,
        outcomes: [{ inputIndex: 0, candidateKey: posted.candidateKey, status: 'recorded' }],
      }, { ok: false, status: 500 }));
    },
  });

  renderSearch();
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByRole('button', { name: 'Run another search' })).toBeEnabled();
  expect(screen.queryByText('Uncertain Result')).not.toBeInTheDocument();
  expect(screen.getByText(/Could not confirm all search saves/)).toBeInTheDocument();
  expect(calls.filter(({ target, options }) => target === '/api/workbench/reviewer-roster' && options.method === 'POST')).toHaveLength(1);
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
