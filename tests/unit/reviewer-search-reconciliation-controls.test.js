/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';

const REQ_A = 'aaaaaaaa-1111-1111-1111-111111111111';
const REQ_B = 'bbbbbbbb-2222-2222-2222-222222222222';
const KEY_A = 'candidate:alex%20reviewer|email:alex%40example.edu|orcid:-|affiliation:example%20university';
const KEY_B = 'candidate:bea%20reviewer|email:bea%40example.edu|orcid:-|affiliation:example%20university';

const CURRENT_STAGES = [
  'applicant_anchor', 'identity', 'institution_domains', 'institution_coi',
  'coauthor_coi', 'eligibility', 'contact', 'address_trust', 'roster_persistence',
];

function candidate(name, candidateKey, email) {
  return {
    candidateKey,
    name,
    email,
    emailSource: 'pubmed',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    rosterUpdatedAt: '2026-08-03T12:00:00.000Z',
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
  };
}

const CANDIDATE_A = candidate('Alex Reviewer', KEY_A, 'alex@example.edu');
const CANDIDATE_B = candidate('Bea Reviewer', KEY_B, 'bea@example.edu');

function warmRoster(requestId, active) {
  return {
    success: true,
    authorityState: 'current',
    warmValidation: {
      state: 'current',
      candidatePlans: active.map((row) => ({
        candidateKey: row.candidateKey,
        cacheOutcome: 'hit',
        currentStages: CURRENT_STAGES,
        pendingStages: [],
        refreshes: [],
        promotionAuthority: 'requires_promotion_checks',
      })),
    },
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: active.map((row) => row.name),
  };
}

function parentRosterSnapshot(requestId, active, rosterVersion = 'v1') {
  return {
    requestId,
    rosterVersion,
    authorityState: 'current',
    data: warmRoster(requestId, active),
  };
}

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function reconciliationResponse({
  outcome = 'partial',
  candidates = [{ candidateKey: KEY_A, outcome: 'current' }, { candidateKey: KEY_B, outcome: 'failed_retryable' }],
  continuationCandidateKeys = [KEY_B],
  remainingStageBudget = 0,
} = {}) {
  const counts = candidates.reduce((all, row) => {
    all[row.outcome] = (all[row.outcome] || 0) + 1;
    return all;
  }, {});
  if (candidates.length === 0 && outcome === 'current') counts.current = 0;
  return {
    success: outcome === 'current' || outcome === 'partial',
    outcome,
    requestId: REQ_A,
    candidates,
    counts,
    continuationCandidateKeys,
    remainingStageBudget,
  };
}

function reconciliationCalls() {
  return global.fetch.mock.calls.filter(([url]) => String(url) === '/api/workbench/reviewer-reconcile');
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('does not automatically POST reconciliation when restored reviewers mount', async () => {
  global.fetch = jest.fn((url) => {
    if (String(url).includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    throw new Error(`unexpected fetch ${url}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);

  expect(await screen.findByText(CANDIDATE_A.name)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconcile previously found reviewers' })).toBeEnabled();
  expect(reconciliationCalls()).toHaveLength(0);
});

test('uses the server-returned continuation keys only after a partial reconciliation and reloads the roster', async () => {
  let reconciliationAttempt = 0;
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A, CANDIDATE_B])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      reconciliationAttempt += 1;
      return Promise.resolve(response(reconciliationAttempt === 1
        ? reconciliationResponse()
        : reconciliationResponse({
          outcome: 'current',
          candidates: [{ candidateKey: KEY_B, outcome: 'current' }],
          continuationCandidateKeys: [],
          remainingStageBudget: 15,
        })));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);

  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));
  fireEvent.click(screen.getByRole('button', { name: 'Reconciling…' }));
  await waitFor(() => expect(reconciliationCalls()).toHaveLength(1));
  expect(JSON.parse(reconciliationCalls()[0][1].body)).toEqual({ requestId: REQ_A, candidateKeys: [KEY_A, KEY_B] });
  expect(await screen.findByText(/2\/2 processed · 1 current · 0 need staff action · 0 blocked by safeguards · 0 rejected · 1 need retrying · 0 paused at the work limit · 1 queued to continue/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue reconciliation' })).toBeEnabled();

  fireEvent.click(screen.getByRole('button', { name: 'Continue reconciliation' }));
  await waitFor(() => expect(reconciliationCalls()).toHaveLength(2));
  expect(JSON.parse(reconciliationCalls()[1][1].body)).toEqual({ requestId: REQ_A, candidateKeys: [KEY_B] });
  expect(await screen.findByText(/Reviewer reconciliation finished: 1\/1 processed · 1 current · 0 need staff action/i)).toBeInTheDocument();
  expect(global.fetch.mock.calls.filter(([url]) => String(url).includes('/api/workbench/reviewer-roster?')).length).toBeGreaterThanOrEqual(3);
});

test('renders a terminal action-required result without offering an invalid continuation', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response(reconciliationResponse({
        outcome: 'action_required',
        candidates: [{ candidateKey: KEY_A, outcome: 'action_required' }],
        continuationCandidateKeys: [],
      }), false, 409));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/0 current · 1 need staff action/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue reconciliation' })).not.toBeInTheDocument();
});

test('accepts a terminal rejected candidate without classifying it as retryable or offering Continue', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response(reconciliationResponse({
        outcome: 'blocked',
        candidates: [{ candidateKey: KEY_A, outcome: 'rejected' }],
        continuationCandidateKeys: [],
      }), false, 409));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/1\/1 processed · 0 current · 0 need staff action · 0 blocked by safeguards · 1 rejected · 0 need retrying/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue reconciliation' })).not.toBeInTheDocument();
});

test.each([
  ['status mismatch', () => response(reconciliationResponse({ outcome: 'current', candidates: [{ candidateKey: KEY_A, outcome: 'current' }], continuationCandidateKeys: [] }), true, 503)],
  ['missing numeric status', () => ({ ok: true, json: async () => reconciliationResponse({ outcome: 'current', candidates: [{ candidateKey: KEY_A, outcome: 'current' }], continuationCandidateKeys: [] }) })],
])('rejects a reconciliation response with a $0', async (_label, reconcileResponse) => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') return Promise.resolve(reconcileResponse());
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/response was not recognized/i)).toBeInTheDocument();
});

test('accepts the bound empty 503 retry aggregate after posting exact roster keys and shows tailored guidance', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response(reconciliationResponse({
        outcome: 'failed_retryable',
        candidates: [],
        continuationCandidateKeys: [],
      }), false, 503));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  await waitFor(() => expect(reconciliationCalls()).toHaveLength(1));
  expect(JSON.parse(reconciliationCalls()[0][1].body)).toEqual({ requestId: REQ_A, candidateKeys: [KEY_A] });
  expect(await screen.findByText(/temporarily unavailable/i)).toBeInTheDocument();
  expect(screen.queryByText(/response was not recognized/i)).not.toBeInTheDocument();
});

test('rejects an ordinary per-candidate response when its keys do not match the posted roster', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response(reconciliationResponse({
        outcome: 'partial',
        candidates: [{ candidateKey: KEY_B, outcome: 'current' }],
        continuationCandidateKeys: [],
      })));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/response was not recognized/i)).toBeInTheDocument();
  expect(screen.queryByText(/temporarily unavailable/i)).not.toBeInTheDocument();
});

test('renders an actionable integrity message, not a zero-count summary, for an over-cap roster', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response({
        ...reconciliationResponse({
          outcome: 'blocked',
          candidates: [],
          continuationCandidateKeys: [],
        }),
        code: 'roster_active_cap_exceeded',
      }, false, 409));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/more active reviewers than the safe limit/i)).toBeInTheDocument();
  expect(screen.getByText(/contact an administrator/i)).toBeInTheDocument();
  expect(screen.getByText(/Do not run another reviewer search/i)).toBeInTheDocument();
  expect(screen.queryByText(/0 current · 0 need staff action/i)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconcile previously found reviewers' })).toBeDisabled();
});

test('rejects a malformed reconciliation response instead of rendering forged progress or continuation state', async () => {
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target === '/api/workbench/reviewer-reconcile') {
      return Promise.resolve(response({
        success: true,
        outcome: 'partial',
        requestId: REQ_A,
        candidates: [{ candidateKey: KEY_A, outcome: 'current' }],
        counts: { current: 1 },
        continuationCandidateKeys: ['client:forged'],
        remainingStageBudget: 15,
      }));
    }
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));

  expect(await screen.findByText(/response was not recognized/i)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue reconciliation' })).not.toBeInTheDocument();
});

test('aborts an in-flight reconciliation when the request changes and never paints its old summary', async () => {
  const pending = deferred();
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_A}`)) {
      return Promise.resolve(response(warmRoster(REQ_A, [CANDIDATE_A])));
    }
    if (target.includes(`/api/workbench/reviewer-roster?requestId=${REQ_B}`)) {
      return Promise.resolve(response(warmRoster(REQ_B, [CANDIDATE_B])));
    }
    if (target === '/api/workbench/reviewer-reconcile') return pending.promise;
    throw new Error(`unexpected fetch ${target}`);
  });

  const { rerender } = render(<ReviewerSearchSection requestId={REQ_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));
  await waitFor(() => expect(reconciliationCalls()).toHaveLength(1));
  const oldSignal = reconciliationCalls()[0][1].signal;

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQ_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  expect(await screen.findByText(CANDIDATE_B.name)).toBeInTheDocument();
  await waitFor(() => expect(oldSignal.aborted).toBe(true));

  await act(async () => {
    pending.resolve(response(reconciliationResponse()));
    await pending.promise;
  });
  expect(screen.getByText(CANDIDATE_B.name)).toBeInTheDocument();
  expect(screen.queryByText(/Reviewer reconciliation finished:/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Reconciling previously found reviewers/i)).not.toBeInTheDocument();
});

test('shows an explicit stale/retry message when a parent roster snapshot supersedes an in-flight reconciliation', async () => {
  const pending = deferred();
  global.fetch = jest.fn((url) => {
    if (String(url) === '/api/workbench/reviewer-reconcile') return pending.promise;
    throw new Error(`unexpected fetch ${url}`);
  });

  const initialSnapshot = parentRosterSnapshot(REQ_A, [CANDIDATE_A], 'v1');
  const { rerender } = render(
    <ReviewerSearchSection
      requestId={REQ_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      rosterSnapshot={initialSnapshot}
    />,
  );
  await screen.findByText(CANDIDATE_A.name);
  fireEvent.click(screen.getByRole('button', { name: 'Reconcile previously found reviewers' }));
  await waitFor(() => expect(reconciliationCalls()).toHaveLength(1));
  const oldSignal = reconciliationCalls()[0][1].signal;

  await act(async () => {
    rerender(
      <ReviewerSearchSection
        requestId={REQ_A}
        blobUrl="blob-a"
        proposalKey="proposal-a"
        rosterSnapshot={parentRosterSnapshot(REQ_A, [CANDIDATE_A], 'v2')}
      />,
    );
  });
  await waitFor(() => expect(oldSignal.aborted).toBe(true));
  expect(await screen.findByText(/Reviewer status changed while reconciliation was running/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reconcile previously found reviewers' })).toBeEnabled();

  await act(async () => {
    pending.resolve(response(reconciliationResponse()));
    await pending.promise;
  });
  expect(screen.queryByText(/Reviewer reconciliation finished:/i)).not.toBeInTheDocument();
});
