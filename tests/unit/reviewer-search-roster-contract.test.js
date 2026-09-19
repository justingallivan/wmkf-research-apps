/**
 * @jest-environment jsdom
 *
 * Stage 3 roster/context prerequisites. These cases use mocked HTTP only and
 * keep the roster boundary visible while the controller is still the facade.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function response(body, ok = true, status = ok ? 200 : 500) {
  return { ok, status, json: async () => body, body: {} };
}

function candidate(name, candidateKey, overrides = {}) {
  const email = `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`;
  return {
    name,
    candidateKey,
    email,
    emailSource: 'staff_verified',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    verificationStatus: 'verified',
    verified: true,
    addressTrustReceipt: { receiptId: `receipt-${candidateKey}`, personConfirmed: true, email },
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
    ...overrides,
  };
}

function rosterSnapshot({ active = [], excluded = [], ineligible = [], blocked = [], handled = [], savedKeys = [] } = {}) {
  return {
    success: true,
    active,
    excluded,
    ineligible,
    blocked,
    handled,
    savedKeys,
    allNames: [...active, ...excluded, ...ineligible, ...blocked, ...handled]
      .map((row) => row?.name)
      .filter(Boolean),
  };
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
  delete window.confirm;
});

test('same-request Blob refresh resets roster state and ignores the first GET', async () => {
  const firstRoster = deferred();
  const secondRoster = deferred();
  const firstCandidate = candidate('First Blob reviewer', 'candidate:first-blob');
  const secondCandidate = candidate('Second Blob reviewer', 'candidate:second-blob');
  const rosterGets = [];

  global.fetch = jest.fn((url) => {
    if (!String(url).includes('/api/workbench/reviewer-roster?')) throw new Error(`unexpected fetch ${url}`);
    rosterGets.push(url);
    return rosterGets.length === 1 ? firstRoster.promise : secondRoster.promise;
  });

  const { rerender } = render(
    <ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-first" proposalKey="proposal" />,
  );
  await waitFor(() => expect(rosterGets).toHaveLength(1));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob-second" proposalKey="proposal" />);
  });
  await waitFor(() => expect(rosterGets).toHaveLength(2));

  await act(async () => {
    secondRoster.resolve(response(rosterSnapshot({ active: [secondCandidate] })));
    await secondRoster.promise;
  });
  expect(await screen.findByLabelText(`Select ${secondCandidate.name}`)).toBeInTheDocument();

  await act(async () => {
    firstRoster.resolve(response(rosterSnapshot({ active: [firstCandidate] })));
    await firstRoster.promise;
  });
  expect(screen.getByLabelText(`Select ${secondCandidate.name}`)).toBeInTheDocument();
  expect(screen.queryByLabelText(`Select ${firstCandidate.name}`)).not.toBeInTheDocument();
});

test('a pending roster GET cannot write after the workspace unmounts', async () => {
  const pendingRoster = deferred();
  let activeReads = 0;
  const unmountedSnapshot = {
    success: true,
    get active() {
      activeReads += 1;
      return [candidate('Unmounted reviewer', 'candidate:unmounted')];
    },
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: [],
  };
  global.fetch = jest.fn((url) => {
    if (!String(url).includes('/api/workbench/reviewer-roster?')) throw new Error(`unexpected fetch ${url}`);
    return pendingRoster.promise;
  });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

  const { container, unmount } = render(
    <ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />,
  );
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
  unmount();

  await act(async () => {
    pendingRoster.resolve(response(unmountedSnapshot));
    await pendingRoster.promise;
  });

  expect(container).toBeEmptyDOMElement();
  expect(activeReads).toBe(0);
  expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('unmounted'));
  consoleError.mockRestore();
});

test('removal carries old timestamps but preserves newer active state and every unaffected roster complement', async () => {
  const previous = candidate('Old previous result', 'candidate:old', {
    rosterUpdatedAt: '2026-09-18T10:00:00.000Z',
  });
  const concurrentlyRefreshed = candidate('Concurrently refreshed result', 'candidate:retained', {
    rosterUpdatedAt: '2026-09-18T10:00:00.000Z',
  });
  const applicant = candidate('Applicant saved result', 'suggestion:applicant-saved', {
    suggestionId: 'applicant-saved',
    isApplicantRecommended: true,
    enrichedProposalKey: 'proposal',
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant_form'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  });
  const excluded = candidate('Excluded complement', 'candidate:excluded');
  const ineligible = candidate('Ineligible complement', 'candidate:ineligible', {
    identityStatus: 'unresolved',
    verificationStatus: 'unresolved',
    verified: false,
  });
  const blocked = candidate('Blocked complement', 'candidate:blocked', {
    blockedReason: 'proposal_author',
  });
  const handled = candidate('Handled complement', 'candidate:handled', { stage: 'invited' });
  const newerRetained = { ...concurrentlyRefreshed, rosterUpdatedAt: '2026-09-18T10:05:00.000Z' };
  const initial = rosterSnapshot({
    active: [previous, concurrentlyRefreshed, applicant],
    excluded: [excluded],
    ineligible: [ineligible],
    blocked: [blocked],
    handled: [handled],
    savedKeys: ['suggestion:applicant-saved'],
  });
  const afterRemoval = rosterSnapshot({
    active: [newerRetained, applicant],
    excluded: [excluded],
    ineligible: [ineligible],
    blocked: [blocked],
    handled: [handled],
    savedKeys: ['suggestion:applicant-saved'],
  });
  const afterSecondRemoval = rosterSnapshot({
    active: [applicant],
    excluded: [excluded],
    ineligible: [ineligible],
    blocked: [blocked],
    handled: [handled],
    savedKeys: ['suggestion:applicant-saved'],
  });
  const removalBodies = [];
  window.confirm = jest.fn(() => true);

  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(response(initial));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      expect(body.action).toBe('remove_previous_results');
      removalBodies.push(body);
      if (removalBodies.length === 1) {
        expect(body.candidateRefs).toEqual([
          { candidateKey: previous.candidateKey, updatedAt: previous.rosterUpdatedAt },
          { candidateKey: concurrentlyRefreshed.candidateKey, updatedAt: concurrentlyRefreshed.rosterUpdatedAt },
        ]);
        return Promise.resolve(response({
          ...afterRemoval,
          removed: 1,
          removedKeys: [previous.candidateKey],
        }));
      }
      expect(body.candidateRefs).toEqual([
        { candidateKey: concurrentlyRefreshed.candidateKey, updatedAt: newerRetained.rosterUpdatedAt },
      ]);
      return Promise.resolve(response({
        ...afterSecondRemoval,
        removed: 1,
        removedKeys: [concurrentlyRefreshed.candidateKey],
      }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  const retainedCheckbox = await screen.findByLabelText(`Select ${concurrentlyRefreshed.name}`);
  fireEvent.click(retainedCheckbox);
  expect(retainedCheckbox).toBeChecked();

  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));

  await waitFor(() => expect(screen.queryByLabelText(`Select ${previous.name}`)).not.toBeInTheDocument());
  expect(screen.getByLabelText(`Select ${concurrentlyRefreshed.name}`)).toBeChecked();
  expect(screen.getByText(applicant.name)).toBeInTheDocument();
  expect(screen.getByText(excluded.name)).toBeInTheDocument();
  expect(screen.getByText(ineligible.name)).toBeInTheDocument();
  expect(screen.getByText(blocked.name)).toBeInTheDocument();
  expect(screen.getByText(handled.name)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Remove previous results' }));
  await waitFor(() => expect(removalBodies).toHaveLength(2));
});

test('failed exclusion of a transient active result restores the pruned row to rosterActive', async () => {
  const exclusion = deferred();
  const transient = candidate('Transient search result', 'candidate:transient');
  readSseStream
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'materials' } } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'result', data: { ranked: [transient], unverified: [] } });
    })
    .mockImplementationOnce(async (_response, onEvent) => {
      onEvent({ event: 'complete', data: { type: 'complete', results: [transient] } });
    });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(response(rosterSnapshot()));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      return Promise.resolve(response({ error: 'store unavailable' }, false));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') return exclusion.promise;
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="blob" proposalKey="proposal" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  const card = await screen.findByText(transient.name);
  fireEvent.click(card.closest('.border').querySelector('button[aria-label^="Not a fit"]'));

  await act(async () => {
    exclusion.resolve(response({ error: 'store unavailable' }, false));
    await exclusion.promise;
  });
  expect(screen.getByText(transient.name)).toBeInTheDocument();
  expect(screen.getByText(/Found in an earlier search/)).toBeInTheDocument();
  expect(screen.queryByText(/Unverified suggestions/)).not.toBeInTheDocument();
  expect(screen.getByText("Couldn't exclude that reviewer — please try again.")).toBeInTheDocument();
});


test('a populated roster clears immediately when only blobUrl changes', async () => {
  const replacement = deferred();
  const oldRow = candidate('Loaded old Blob reviewer', 'candidate:loaded-old');
  const newRow = candidate('Loaded new Blob reviewer', 'candidate:loaded-new');
  global.fetch = jest.fn()
    .mockResolvedValueOnce(response(rosterSnapshot({ active: [oldRow] })))
    .mockReturnValueOnce(replacement.promise);
  const { rerender } = render(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="old-blob" proposalKey="same" />);
  expect(await screen.findByLabelText(`Select ${oldRow.name}`)).toBeInTheDocument();
  rerender(<ReviewerSearchSection requestId={REQUEST_ID} blobUrl="new-blob" proposalKey="same" />);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(oldRow.name)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /loading existing candidates/i })).toBeDisabled();
  await act(async () => {
    replacement.resolve(response(rosterSnapshot({ active: [newRow] })));
    await replacement.promise;
  });
  expect(await screen.findByLabelText(`Select ${newRow.name}`)).toBeInTheDocument();
  expect(screen.queryByText(oldRow.name)).not.toBeInTheDocument();
});
