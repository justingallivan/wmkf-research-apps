/**
 * @jest-environment jsdom
 *
 * P5/P6 prerequisite contracts for the Reviewer Search workspace.
 *
 * Existing coverage intentionally remains in its owning suites:
 * - P5 cache version/key/proposal/partial/terminal rules:
 *   reviewer-search-logic.test.js
 * - P5 manual refresh and same-proposal Blob refresh:
 *   reviewer-search-history-controls.test.js
 * - P6 ephemeral record failure and basic confirmation ordering:
 *   reviewer-search-unverified-rescue.test.js
 * - P6 authoritative replacement, durable draft, and save reconciliation:
 *   reviewer-search-promotion-reconciliation.test.js
 *
 * This file only adds the missing cross-lane, partial-receipt, and stale-await
 * cases, accepted before the Stage 5 and Stage 6 extractions.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';
import { APPLICANT_ENRICHMENT_CACHE_VERSION } from '../../shared/components/reviewers/reviewer-search-logic';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQUEST_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

function rosterSnapshot(active = [], extra = {}) {
  return response({
    success: true,
    active,
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: active.map((row) => row.name),
    ...extra,
  });
}

function readyCandidate(name, candidateKey, overrides = {}) {
  const email = `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`;
  return {
    name,
    candidateKey,
    email,
    affiliation: 'Example University',
    website: 'https://example.edu/old-profile',
    emailSource: 'institution_page',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    addressTrustReceipt: {
      receiptId: `receipt-${candidateKey}`,
      personConfirmed: true,
      email,
    },
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
    ...overrides,
  };
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('a missing applicant suggestion identity is a cache miss and triggers enrichment', async () => {
  const malformedRecommendation = { name: 'Applicant with no suggestion id', suggestionId: '' };
  const cachedRow = {
    name: malformedRecommendation.name,
    candidateKey: 'suggestion:missing-id',
    enrichedProposalKey: 'proposal-a',
    applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
    isApplicantRecommended: true,
    applicantKnownReviewer: { status: 'known' },
    institutionPresentation: { version: 'institution-stage2-presentation/v1' },
    identityStatus: 'probable',
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(rosterSnapshot([cachedRow]));
    }
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_res, onEvent) => {
    onEvent({ event: 'complete', data: { recommended: [] } });
  });

  render(
    <ReviewerSearchSection
      requestId={REQUEST_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      recommended={[malformedRecommendation]}
    />,
  );

  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  ));
});

function applicantCacheRow(name, suggestionId, overrides = {}) {
  return {
    name,
    suggestionId,
    candidateKey: `suggestion:${suggestionId}`,
    enrichedProposalKey: 'proposal-a',
    applicantEnrichmentCacheVersion: APPLICANT_ENRICHMENT_CACHE_VERSION,
    isApplicantRecommended: true,
    applicantKnownReviewer: { status: 'known' },
    identityStatus: 'probable',
    ...overrides,
  };
}

test.each([
  [
    'an ineligible canonical row counts as a populated cache',
    {
      recommended: [
        { suggestionId: 'active', name: 'Active applicant' },
        { suggestionId: 'deceased', name: 'Deceased applicant' },
      ],
      active: [applicantCacheRow('Active applicant', 'active')],
      ineligible: [applicantCacheRow('Deceased applicant', 'deceased', {
        eligibilityStatus: 'deceased',
        identityStatus: undefined,
      })],
    },
  ],
  [
    'excluded and saved terminal rows satisfy the populated terminal cache',
    {
      recommended: [
        { suggestionId: 'excluded', name: 'Excluded applicant' },
        { suggestionId: 'saved', name: 'Saved applicant' },
      ],
      excluded: [applicantCacheRow('Excluded applicant', 'excluded', {
        excluded: true,
        suggestionId: 'excluded',
      })],
      savedKeys: ['suggestion:saved'],
    },
  ],
  [
    'handled recommendations suppress automatic enrichment',
    {
      recommended: [{ suggestionId: 'handled', name: 'Handled applicant', invited: true }],
    },
  ],
])('%s', async (_label, fixture) => {
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(rosterSnapshot(fixture.active || [], fixture));
    }
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') {
      return Promise.resolve(response({}));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  readSseStream.mockImplementation(async (_res, onEvent) => {
    onEvent({ event: 'complete', data: { recommended: [] } });
  });

  const view = render(
    <ReviewerSearchSection
      requestId={REQUEST_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      recommended={fixture.recommended}
    />,
  );
  await waitFor(() => expect(global.fetch.mock.calls.some(([url]) => (
    String(url).includes('/api/workbench/reviewer-roster?')
  ))).toBe(true));
  await act(async () => {});
  expect(global.fetch).not.toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.anything(),
  );

  if (fixture.active) {
    view.rerender(
      <ReviewerSearchSection
        requestId={REQUEST_A}
        blobUrl="blob-a"
        proposalKey="proposal-a"
        recommended={fixture.recommended}
      />,
    );
    await act(async () => {});
    expect(global.fetch).not.toHaveBeenCalledWith(
      '/api/workbench/enrich-recommended',
      expect.anything(),
    );
  }
});

test('applicant enrichment and discovery remain independent pending streams', async () => {
  const applicantStream = deferred();
  const analysisStream = deferred();
  const discoveryStream = deferred();
  const enrichmentStream = deferred();
  const handlers = [];
  readSseStream.mockImplementation(async (_res, onEvent) => {
    const stream = [applicantStream, analysisStream, discoveryStream, enrichmentStream][handlers.length];
    handlers.push(onEvent);
    await stream.promise;
  });

  const discovered = readyCandidate('Discovered while applicant runs', 'candidate:parallel');
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterSnapshot([]));
    if (target === '/api/workbench/enrich-recommended' && options.method === 'POST') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/analyze' && options.method === 'POST') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover' && options.method === 'POST') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/enrich-contacts' && options.method === 'POST') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') return Promise.resolve(response({ success: true }));
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(
    <ReviewerSearchSection
      requestId={REQUEST_A}
      blobUrl="blob-a"
      proposalKey="proposal-a"
      recommended={[{ suggestionId: 'applicant-a', name: 'Applicant lane' }]}
    />,
  );
  await waitFor(() => expect(handlers).toHaveLength(1));

  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await waitFor(() => expect(handlers).toHaveLength(2));

  await act(async () => {
    handlers[1]({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'biology' } } });
    analysisStream.resolve();
    await analysisStream.promise;
  });
  await waitFor(() => expect(handlers).toHaveLength(3));
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/enrich-recommended',
    expect.objectContaining({ method: 'POST' }),
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/discover',
    expect.objectContaining({ method: 'POST' }),
  );

  // Complete only the discovery lane. Its result must be able to reach the
  // workspace while the independent applicant stream is still pending.
  await act(async () => {
    handlers[2]({ event: 'result', data: { ranked: [discovered] } });
    discoveryStream.resolve();
    await discoveryStream.promise;
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/reviewer-finder/enrich-contacts',
    expect.objectContaining({ method: 'POST' }),
  ));
  expect(handlers).toHaveLength(4);
  let applicantFinished = false;
  applicantStream.promise.then(() => {
    applicantFinished = true;
  });

  await act(async () => {
    handlers[3]({ event: 'complete', data: { type: 'complete', results: [] } });
    enrichmentStream.resolve();
    await enrichmentStream.promise;
  });
  expect(await screen.findByText(discovered.name)).toBeInTheDocument();
  expect(applicantFinished).toBe(false);

  await act(async () => {
    handlers[0]({ event: 'complete', data: { recommended: [{ suggestionId: 'applicant-a', name: 'Applicant lane' }] } });
    applicantStream.resolve();
    await applicantStream.promise;
  });
  expect(applicantFinished).toBe(true);
});

test('draft acknowledgement precedes verification and sends the exact receipt-bound fields', async () => {
  const candidate = readyCandidate('Draft then verify reviewer', 'candidate:draft-verify');
  const draftCandidate = {
    ...candidate,
    website: 'https://example.edu/current-profile',
    addressTrustReceipt: null,
    addressVerificationRequired: true,
    emailSource: 'manual',
  };
  const verifiedCandidate = {
    ...draftCandidate,
    addressVerificationRequired: false,
    addressTrustReceipt: {
      receiptId: 'receipt-current',
      personConfirmed: true,
      email: candidate.email,
    },
  };
  const calls = [];
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterSnapshot([candidate]));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      calls.push({ action: body.action, body });
      return Promise.resolve(response({ success: true, candidate: draftCandidate }));
    }
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      calls.push({ action: body.action, body });
      return Promise.resolve(response({ success: true, candidate: verifiedCandidate }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: /edit contact/i }));
  fireEvent.change(screen.getByDisplayValue(candidate.website), {
    target: { value: draftCandidate.website },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(calls[0]?.action).toBe('update_contact_draft'));
  expect(calls[0].body).toMatchObject({
    requestId: REQUEST_A,
    candidateKey: candidate.candidateKey,
    updates: { website: draftCandidate.website },
  });

  fireEvent.click(await screen.findByRole('button', { name: `Verify address for ${candidate.name}` }));
  fireEvent.click(screen.getByLabelText(new RegExp(`${candidate.email} belongs to this person`)));
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
    target: { value: 'https://example.edu/evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(calls[1]?.action).toBe('verify_person_and_address'));
  expect(calls[1].body).toEqual({
    requestId: REQUEST_A,
    candidateKey: candidate.candidateKey,
    action: 'verify_person_and_address',
    email: candidate.email,
    verifiedContact: {
      website: draftCandidate.website,
      affiliation: candidate.affiliation,
    },
    evidenceType: 'publication_corresponding_author',
    evidenceUrl: 'https://example.edu/evidence',
    note: null,
  });
  expect(calls.map(({ action }) => action)).toEqual([
    'update_contact_draft',
    'verify_person_and_address',
  ]);
});

test('partial receipt is applied to the authoritative card before verification throws', async () => {
  const candidate = readyCandidate('Partial receipt reviewer', 'candidate:partial-receipt', {
    addressTrustReceipt: null,
    addressVerificationRequired: true,
  });
  const authoritative = {
    ...candidate,
    addressVerificationRequired: false,
    addressTrustReceipt: {
      receiptId: 'receipt-partial',
      personConfirmed: true,
      email: candidate.email,
    },
  };
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterSnapshot([candidate]));
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') {
      return Promise.resolve(response({
        success: false,
        partialSuccess: true,
        receiptRecorded: true,
        candidate: authoritative,
        error: 'The address receipt was recorded, but Dataverse verification failed.',
      }, false, 502));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: `Verify address for ${candidate.name}` }));
  fireEvent.click(screen.getByLabelText(new RegExp(`${candidate.email} belongs to this person`)));
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
    target: { value: 'https://example.edu/evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(await screen.findByText(/address receipt was recorded/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByLabelText(`Select ${candidate.name}`)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: `Verify address for ${candidate.name}` })).not.toBeInTheDocument();
});

test('confirmation remains visible and retryable when the committed confirmation is followed by verification failure', async () => {
  const unverified = {
    name: 'Confirm then verify reviewer',
    affiliation: 'Example University',
    verified: false,
    verificationStatus: 'unresolved',
    identityStatus: 'unresolved',
    reason: 'No matching publications',
  };
  const calls = [];
  const handlers = [];
  readSseStream
    .mockImplementationOnce(async (_res, onEvent) => {
      handlers.push(onEvent);
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'biology' } } });
    })
    .mockImplementationOnce(async (_res, onEvent) => {
      handlers.push(onEvent);
      onEvent({ event: 'result', data: { ranked: [], unverified: [unverified] } });
    });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(rosterSnapshot([]));
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      calls.push({ action: 'record' });
      return Promise.resolve(response({ success: true, recorded: 1 }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      calls.push({ action: body.action });
      if (body.action === 'confirm_identity') {
        return Promise.resolve(response({
          success: true,
          confirmationId: 'confirmation-committed',
          candidate: {
            ...body.candidate,
            identityStatus: 'confirmed',
            pdIdentityConfirmed: true,
            pdIdentityConfirmationId: 'confirmation-committed',
            manualContactFields: ['email', 'website', 'affiliation'],
            staffIdentityConfirmation: {
              confirmationId: 'confirmation-committed',
              source: 'staff_confirmed',
            },
            addressVerificationRequired: true,
          },
        }));
      }
    }
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') {
      calls.push({ action: 'verify_person_and_address' });
      return Promise.resolve(response({ success: false, error: 'address verification failed' }, false, 422));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByText(/Unverified suggestions \(1\)/);
  fireEvent.click(screen.getByRole('button', { name: `Confirm identity for ${unverified.name}` }));
  fireEvent.change(screen.getByPlaceholderText('researcher@university.edu'), {
    target: { value: 'confirmed@example.edu' },
  });
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
    target: { value: 'https://example.edu/evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to candidates' }));

  expect(await screen.findByText('address verification failed')).toBeInTheDocument();
  expect(calls.map(({ action }) => action)).toEqual([
    'record',
    'confirm_identity',
    'verify_person_and_address',
  ]);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.getByText(unverified.name)).toBeInTheDocument());
  expect(screen.queryByText(/Unverified suggestions/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: `Verify address for ${unverified.name}` })).toBeInTheDocument();
  expect(handlers).toHaveLength(2);
});

function configureUnverifiedFlow({ unverified, rosterForRequest, recordResponse, confirmResponse }) {
  const calls = [];
  const handlers = [];
  readSseStream.mockImplementation(async (_res, onEvent) => {
    const index = handlers.length;
    handlers.push(onEvent);
    if (index === 0) {
      onEvent({ event: 'result', data: { proposalInfo: { title: 'Proposal', keywords: 'biology' } } });
    } else {
      onEvent({ event: 'result', data: { ranked: [], unverified: [unverified] } });
    }
  });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(rosterSnapshot(rosterForRequest(target)));
    }
    if (target === '/api/reviewer-finder/analyze' || target === '/api/reviewer-finder/discover') {
      return Promise.resolve(response({}));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'POST') {
      calls.push({ action: 'record' });
      return recordResponse?.promise || Promise.resolve(recordResponse || response({ success: true, recorded: 1 }));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') {
      const body = JSON.parse(options.body);
      calls.push({ action: body.action, body });
      return confirmResponse?.promise || Promise.resolve(confirmResponse || response({ success: true }));
    }
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') {
      calls.push({ action: 'verify_person_and_address' });
      return Promise.resolve(response({ success: true }));
    }
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });
  return { calls, handlers };
}

async function submitIdentityConfirmation(email = 'confirmed@example.edu') {
  fireEvent.click(screen.getByRole('button', { name: /Confirm identity for/i }));
  fireEvent.change(screen.getByPlaceholderText('researcher@university.edu'), {
    target: { value: email },
  });
  for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], {
    target: { value: 'https://example.edu/evidence' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add to candidates' }));
}

test('a stale ephemeral record cannot confirm identity after request replacement', async () => {
  const record = deferred();
  const unverified = {
    name: 'Request A unverified reviewer',
    candidateKey: 'candidate:shared-confirm-record',
    affiliation: 'Example University',
    verified: false,
    verificationStatus: 'unresolved',
    identityStatus: 'unresolved',
    reason: 'No matching publications',
  };
  const candidateB = readyCandidate('Request B confirmed roster', unverified.candidateKey);
  const { calls } = configureUnverifiedFlow({
    unverified,
    rosterForRequest: (target) => (target.includes(REQUEST_B) ? [candidateB] : []),
    recordResponse: record,
  });

  const { rerender } = render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByText(/Unverified suggestions \(1\)/);
  await submitIdentityConfirmation();
  await waitFor(() => expect(calls.map(({ action }) => action)).toEqual(['record']));

  rerender(<ReviewerSearchSection requestId={REQUEST_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  expect(await screen.findByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  await act(async () => {
    record.resolve(response({ success: true, recorded: 1 }));
    await record.promise;
  });
  expect(calls.map(({ action }) => action)).toEqual(['record']);
  expect(screen.getByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  expect(screen.queryByText(unverified.name)).not.toBeInTheDocument();
});

test('a stale confirmation cannot verify or replace request B after the commit await', async () => {
  const confirm = deferred();
  const unverified = {
    name: 'Request A confirmation reviewer',
    candidateKey: 'candidate:shared-confirm-patch',
    affiliation: 'Example University',
    verified: false,
    verificationStatus: 'unresolved',
    identityStatus: 'unresolved',
    reason: 'No matching publications',
  };
  const candidateB = readyCandidate('Request B confirmation roster', unverified.candidateKey);
  const { calls } = configureUnverifiedFlow({
    unverified,
    rosterForRequest: (target) => (target.includes(REQUEST_B) ? [candidateB] : []),
    confirmResponse: confirm,
  });

  const { rerender } = render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  await screen.findByText(/Unverified suggestions \(1\)/);
  await submitIdentityConfirmation();
  await waitFor(() => expect(calls.map(({ action }) => action)).toEqual(['record', 'confirm_identity']));

  rerender(<ReviewerSearchSection requestId={REQUEST_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  expect(await screen.findByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  await act(async () => {
    confirm.resolve(response({
      success: true,
      confirmationId: 'late-confirmation',
      candidate: {
        ...unverified,
        identityStatus: 'confirmed',
        pdIdentityConfirmed: true,
        addressVerificationRequired: true,
      },
    }));
    await confirm.promise;
  });
  expect(calls.map(({ action }) => action)).toEqual(['record', 'confirm_identity']);
  expect(screen.getByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  expect(screen.queryByText(unverified.name)).not.toBeInTheDocument();
});

test('a stale draft await cannot write request A contact state into request B', async () => {
  const draft = deferred();
  // The same durable candidate can legitimately appear under two request
  // contexts. Using the same key makes a missing generation check observable:
  // the late A response would replace B's row instead of merely targeting an
  // already-absent key.
  const candidateA = readyCandidate('Request A contact', 'candidate:shared-contact');
  const candidateB = readyCandidate('Request B contact', 'candidate:shared-contact', {
    website: 'https://example.edu/b',
  });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(target.includes(REQUEST_A) ? rosterSnapshot([candidateA]) : rosterSnapshot([candidateB]));
    }
    if (target === '/api/workbench/reviewer-roster' && options.method === 'PATCH') return draft.promise;
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  const { rerender } = render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: /edit contact/i }));
  fireEvent.change(screen.getByDisplayValue(candidateA.website), { target: { value: 'https://example.edu/a' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/reviewer-roster',
    expect.objectContaining({ method: 'PATCH' }),
  ));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQUEST_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  expect(await screen.findByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  await act(async () => {
    draft.resolve(response({ success: true, candidate: { ...candidateA, website: 'https://example.edu/a' } }));
    await draft.promise;
  });
  expect(screen.getByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  expect(screen.queryByText(/contact details saved to this request/i)).not.toBeInTheDocument();
  expect(screen.queryByText(candidateA.name)).not.toBeInTheDocument();
});

test('a stale address-verification await returns false without changing request B', async () => {
  const verify = deferred();
  const candidateA = readyCandidate('Request A verification', 'candidate:shared-verification', {
    addressTrustReceipt: null,
    addressVerificationRequired: true,
  });
  const candidateB = readyCandidate('Request B verification', 'candidate:shared-verification', {
    website: 'https://example.edu/b',
  });
  global.fetch = jest.fn((url, options = {}) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(target.includes(REQUEST_A) ? rosterSnapshot([candidateA]) : rosterSnapshot([candidateB]));
    }
    if (target === '/api/workbench/reviewer-address-trust' && options.method === 'POST') return verify.promise;
    throw new Error(`unexpected fetch ${target} ${options.method || 'GET'}`);
  });

  const { rerender } = render(<ReviewerSearchSection requestId={REQUEST_A} blobUrl="blob-a" proposalKey="proposal-a" />);
  fireEvent.click(await screen.findByRole('button', { name: `Verify address for ${candidateA.name}` }));
  fireEvent.click(screen.getByLabelText(new RegExp(`${candidateA.email} belongs to this person`)));
  fireEvent.change(screen.getAllByPlaceholderText('https://...')[0], { target: { value: 'https://example.edu/evidence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
    '/api/workbench/reviewer-address-trust',
    expect.objectContaining({ method: 'POST' }),
  ));

  await act(async () => {
    rerender(<ReviewerSearchSection requestId={REQUEST_B} blobUrl="blob-b" proposalKey="proposal-b" />);
  });
  expect(await screen.findByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  await act(async () => {
    verify.resolve(response({
      success: true,
      candidate: { ...candidateA, addressTrustReceipt: { receiptId: 'late', personConfirmed: true, email: candidateA.email } },
    }));
    await verify.promise;
  });
  expect(screen.getByLabelText(`Select ${candidateB.name}`)).toBeInTheDocument();
  expect(screen.queryByText(candidateA.name)).not.toBeInTheDocument();
});
