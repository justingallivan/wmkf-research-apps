/**
 * @jest-environment jsdom
 *
 * ReviewerSearchSection — unverified-suggestion rescue (S402). An "Unverified
 * suggestions" card (a Claude suggestion the searched databases couldn't
 * verify) previously rendered with NO handlers — a dead end with no rescue
 * affordance (request 1003046, S400 triage finding 3). It must now carry the
 * same confirm-identity and exclude affordances as the needs-identity-review
 * section. Because unverified rows are EPHEMERAL (deliberately never recorded
 * on the durable roster, S224) while the server confirm_identity action only
 * updates an existing ACTIVE roster row, the confirm flow must record the row
 * on the roster FIRST — and must not attempt the confirmation if that record
 * write fails.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = 'bbbbbbbb-2222-2222-2222-222222222222';

// A Claude suggestion the discovery databases could not verify — the exact
// shape verification.js pushes onto `unverified` (unresolved markers, no
// contact, no identity anchors).
const unverifiedSuggestion = {
  name: 'Yamuna Krishnan',
  affiliation: 'University of Chicago',
  suggestedInstitution: 'University of Chicago',
  verified: false,
  verificationStatus: 'unresolved',
  identityStatus: 'unresolved',
  reason: 'No publications found matching expertise',
};

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, body: {} };
}

function emptyRoster() {
  return response({
    success: true,
    active: [],
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: [],
  });
}

// Drive one search run whose discovery returns ONLY an unverified suggestion
// (no ranked candidates → no enrichment / roster-write legs fire).
function mockSearchStreams() {
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'chemistry', authorInstitution: 'Example U' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [], unverified: [unverifiedSuggestion] } });
    });
}

function mockSearchStreamsWithRankedCandidate() {
  const rankedCandidate = {
    name: 'Active Reviewer',
    email: 'active@example.edu',
    affiliation: 'Example U',
    identityStatus: 'confirmed',
    verificationStatus: 'verified',
    verified: true,
  };
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', keywords: 'chemistry', authorInstitution: 'Example U' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [rankedCandidate], unverified: [unverifiedSuggestion] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [rankedCandidate] } });
    });
}

async function runSearchToUnverified() {
  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByText(/Unverified suggestions \(1\)/);
  await screen.findByText('Yamuna Krishnan');
}

// Fill and submit the confirm modal (email + both attestation checkboxes +
// the evidence link the default evidence type requires).
async function submitConfirmModal(email) {
  fireEvent.click(screen.getByRole('button', { name: /confirm identity for Yamuna Krishnan/i }));
  await screen.findByRole('button', { name: /add to candidates/i });
  fireEvent.change(screen.getByPlaceholderText('researcher@university.edu'), { target: { value: email } });
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
    target: { value: 'https://example.edu/paper' },
  });
  fireEvent.click(screen.getByRole('button', { name: /add to candidates/i }));
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('an unverified suggestion card carries confirm-identity and exclude affordances (no checkbox)', async () => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  mockSearchStreams();

  await runSearchToUnverified();

  expect(screen.getByRole('button', { name: /confirm identity for Yamuna Krishnan/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /not a fit: Yamuna Krishnan/i })).toBeInTheDocument();
  // Still not directly selectable — rescue goes through the confirm modal.
  expect(screen.queryByLabelText('Select Yamuna Krishnan')).not.toBeInTheDocument();
});

test('renders a named admin-only identity comparison from the discovery response', async () => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: { proposalInfo: { title: 'Proposal', primaryResearchArea: 'Physics' } },
      });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: {
          ranked: [],
          unverified: [],
          identityComparison: {
            runId: '11111111-1111-4111-8111-111111111111',
            resolverMode: 'shadow',
            candidates: [{
              candidateKey: 'abcd1234abcd1234',
              reviewerName: 'Different Reviewer',
              claimedInstitution: 'Example University',
              legacyDecision: 'abstain',
              worksDecision: 'bind',
              combinedDecision: 'bind',
              combinedReason: 'works_rescue',
              anchorsAgree: false,
            }],
          },
        },
      });
    });

  const { rerender } = render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText('Identity resolver comparison (admin)')).toBeInTheDocument();
  expect(screen.getByText('Different Reviewer')).toBeInTheDocument();
  expect(screen.getByText('Example University')).toBeInTheDocument();
  expect(screen.getByText(/Works-first corroborated an identity that Legacy missed/)).toBeInTheDocument();
  expect(screen.getByText(/This search still used Legacy results/)).toBeInTheDocument();

  rerender(
    <ReviewerSearchSection
      requestId="cccccccc-3333-3333-3333-333333333333"
      blobUrl="blob-2"
      proposalKey="proposal-2"
    />,
  );
  await waitFor(() => {
    expect(screen.queryByTestId('identity-comparison-panel')).not.toBeInTheDocument();
  });
});

test('renders PubMed diagnostics without implying Legacy or Combined ran', async () => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', primaryResearchArea: 'Biology' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({
        event: 'result',
        data: {
          ranked: [],
          unverified: [],
          identityComparison: {
            runId: '22222222-2222-4222-8222-222222222222',
            resolverMode: 'diagnostic',
            baselineKind: 'pubmed',
            candidates: [{
              candidateKey: 'dcba4321dcba4321',
              reviewerName: 'PubMed Diagnostic Reviewer',
              claimedInstitution: 'Example University',
              baselineDecision: 'bind',
              worksDecision: 'review',
              comparisonStatus: 'available',
              differenceReason: 'works_did_not_confirm',
            }],
          },
        },
      });
    });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));

  expect(await screen.findByText(/This search used PubMed results/)).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: 'PubMed' })).toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Legacy' })).not.toBeInTheDocument();
  expect(screen.queryByRole('columnheader', { name: 'Combined' })).not.toBeInTheDocument();
  expect(screen.getByText(/not part of W2 shadow telemetry/)).toBeInTheDocument();
});

test('drops a late PubMed diagnostic after the request context changes', async () => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('dddddddd-4444-4444-4444-444444444444')) {
      return Promise.resolve(response({
        success: true,
        active: [{
          name: 'Current Request Reviewer',
          email: 'current@example.edu',
          identityStatus: 'confirmed',
          verificationStatus: 'verified',
          verified: true,
        }],
        excluded: [],
        ineligible: [],
        blocked: [],
        handled: [],
        savedKeys: [],
        allNames: ['Current Request Reviewer'],
      }));
    }
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  let releaseOldDiscovery;
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', primaryResearchArea: 'Biology' } } });
    })
    .mockImplementationOnce((_response, onEvent) => new Promise((resolve) => {
      releaseOldDiscovery = () => {
        onEvent({
          event: 'result',
          data: {
            ranked: [],
            unverified: [],
            identityComparison: {
              resolverMode: 'diagnostic',
              baselineKind: 'pubmed',
              candidates: [{
                reviewerName: 'Stale Diagnostic Reviewer',
                baselineDecision: 'bind',
                worksDecision: 'review',
                comparisonStatus: 'available',
                differenceReason: 'works_did_not_confirm',
              }],
            },
          },
        });
        resolve();
      };
    }));

  const { rerender } = render(<ReviewerSearchSection requestId={REQ} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(releaseOldDiscovery).toEqual(expect.any(Function)));

  rerender(
    <ReviewerSearchSection
      requestId="dddddddd-4444-4444-4444-444444444444"
      blobUrl="blob-2"
      proposalKey="proposal-2"
    />,
  );
  releaseOldDiscovery();

  await waitFor(() => {
    expect(screen.getByText('Current Request Reviewer')).toBeInTheDocument();
    expect(screen.queryByText('Stale Diagnostic Reviewer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('identity-comparison-panel')).not.toBeInTheDocument();
  });
});

test('confirming an unverified suggestion records it on the roster BEFORE confirm_identity, then renders it as a confirmed active card', async () => {
  const calls = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      calls.push({ kind: 'record', body });
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      calls.push({ kind: body.action, body });
      // Echo the submitted candidate as the server-authoritative confirmed row
      // (same candidateKey), as the real store does.
      return Promise.resolve(response({
        success: true,
        confirmationId: 'conf-1',
        candidate: {
          ...body.candidate,
          pdIdentityConfirmed: true,
          pdIdentityConfirmationId: 'conf-1',
          manualContactFields: ['email', 'website', 'affiliation'],
          staffIdentityConfirmation: { confirmationId: 'conf-1', source: 'staff_confirmed' },
        },
      }));
    }
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      calls.push({ kind: 'address_trust', body });
      const confirmed = calls.find((call) => call.kind === 'confirm_identity').body.candidate;
      return Promise.resolve(response({
        success: true,
        candidate: {
          ...confirmed,
          pdIdentityConfirmed: true,
          pdIdentityConfirmationId: 'conf-1',
          manualContactFields: ['email', 'website', 'affiliation'],
          staffIdentityConfirmation: { confirmationId: 'conf-1', source: 'staff_confirmed' },
          addressTrustReceipt: { receiptId: 'receipt-1', personConfirmed: true, email: body.email },
        },
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  mockSearchStreams();

  await runSearchToUnverified();
  await submitConfirmModal('krishnan@uchicago.edu');

  // The row became a durable, selectable candidate and left the ephemeral
  // Unverified section.
  await waitFor(() => expect(screen.getByLabelText('Select Yamuna Krishnan')).toBeInTheDocument());
  expect(screen.queryByText(/Unverified suggestions/)).not.toBeInTheDocument();

  // Ordering contract: the roster record write lands BEFORE confirm_identity,
  // and both use ONE stable candidate key (survives the contact edits).
  const kinds = calls.map((call) => call.kind);
  expect(kinds.indexOf('record')).toBeGreaterThanOrEqual(0);
  expect(kinds.indexOf('record')).toBeLessThan(kinds.indexOf('confirm_identity'));
  const recorded = calls.find((call) => call.kind === 'record').body.candidates[0];
  const confirmed = calls.find((call) => call.kind === 'confirm_identity').body.candidate;
  expect(recorded.candidateKey).toBeTruthy();
  expect(confirmed.candidateKey).toBe(recorded.candidateKey);
  expect(confirmed.email).toBe('krishnan@uchicago.edu');
});

test('a failed roster record write blocks confirm_identity and keeps the card rescuable', async () => {
  const patchActions = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({ error: 'store unavailable' }, false));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      patchActions.push(JSON.parse(options.body).action);
      return Promise.resolve(response({ success: true }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  mockSearchStreams();

  await runSearchToUnverified();
  await submitConfirmModal('krishnan@uchicago.edu');

  // The modal surfaces the record failure and no confirmation was attempted.
  await waitFor(() => expect(screen.getByText('store unavailable')).toBeInTheDocument());
  expect(patchActions).not.toContain('confirm_identity');
  expect(screen.getByText(/Unverified suggestions \(1\)/)).toBeInTheDocument();
});

test('excluding an unverified suggestion persists the durable exclusion and moves the card to Excluded', async () => {
  const patches = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      patches.push(JSON.parse(options.body));
      return Promise.resolve(response({ success: true }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  mockSearchStreams();

  await runSearchToUnverified();
  fireEvent.click(screen.getByRole('button', { name: /not a fit: Yamuna Krishnan/i }));

  await waitFor(() => expect(screen.getByText(/Excluded \(1\)/)).toBeInTheDocument());
  expect(screen.queryByText(/Unverified suggestions/)).not.toBeInTheDocument();
  expect(patches).toHaveLength(1);
  expect(patches[0].action).toBe('exclude');
  expect(patches[0].candidate.name).toBe('Yamuna Krishnan');

  // The name joins the exclusion union so a re-run won't re-suggest it.
  expect(patches[0].candidate.candidateKey).toBeTruthy();
});

test('a failed exclusion restores the prior name membership before the next search payload', async () => {
  const analyzeBodies = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(emptyRoster());
    if (target === '/api/reviewer-finder/analyze') {
      analyzeBodies.push(JSON.parse(options.body));
      return Promise.resolve(response({}));
    }
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      return Promise.resolve(response({ error: 'store unavailable' }, false));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  mockSearchStreamsWithRankedCandidate();
  mockSearchStreamsWithRankedCandidate();

  await runSearchToUnverified();
  const unverifiedCard = screen.getByText('Yamuna Krishnan').closest('.border');
  fireEvent.click(within(unverifiedCard).getByRole('button', { name: /not a fit: Yamuna Krishnan/i }));

  await waitFor(() => expect(screen.getByText(/Couldn't exclude that reviewer/)).toBeInTheDocument());
  // Back in Unverified; NOT promoted into an actionable/selectable card.
  expect(screen.getByText(/Unverified suggestions \(1\)/)).toBeInTheDocument();
  expect(screen.queryByText(/Excluded \(1\)/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Select Yamuna Krishnan')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /run another search/i }));
  await waitFor(() => expect(analyzeBodies).toHaveLength(2));
  expect(analyzeBodies[1].excludedNames).not.toContain('Yamuna Krishnan');
});
