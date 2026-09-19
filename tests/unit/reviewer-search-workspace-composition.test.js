/**
 * @jest-environment jsdom
 *
 * P1 presentation/composition prerequisites for the reviewer-search workspace
 * move.  The roster boundary is mocked with a complete competing snapshot so
 * the assertions cover each rendered status without live providers or stores.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewerSearchSection from '../../shared/components/reviewers/ReviewerSearchSection';
import { readSseStream } from '../../shared/components/reviewers/sse';

jest.mock('../../shared/components/reviewers/sse', () => ({
  readSseStream: jest.fn(),
}));

const REQ = '11111111-1111-1111-1111-111111111111';

function response(body, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

function readyCandidate(name, candidateKey, overrides = {}) {
  return {
    name,
    candidateKey,
    affiliation: 'Example University',
    email: `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`,
    emailSource: 'staff_verified',
    emailPersistAllowed: true,
    identityStatus: 'probable',
    addressTrustReceipt: {
      receiptId: `receipt-${candidateKey}`,
      personConfirmed: true,
      email: `${candidateKey.replace(/[^a-z0-9]/gi, '')}@example.edu`,
    },
    publications: [{ title: `${name} paper`, year: 2025 }],
    provenance: {
      kind: 'literature_retrieved',
      sources: ['pubmed'],
      seedRole: 'query_seed',
      groundingWorkIds: [],
    },
    ...overrides,
  };
}

function rosterSnapshot(overrides = {}) {
  return {
    success: true,
    active: [],
    excluded: [],
    ineligible: [],
    blocked: [],
    handled: [],
    savedKeys: [],
    allNames: [],
    ...overrides,
  };
}

function useRosterSnapshot(snapshot) {
  global.fetch = jest.fn((url) => {
    if (String(url).includes('/api/workbench/reviewer-roster?')) {
      return Promise.resolve(response(snapshot));
    }
    if (String(url).includes('/api/reviewer-finder/prompt-override?')) {
      return Promise.resolve(response({
        name: 'reviewer-finder.analyze',
        version: 1,
        templateBody: 'Use the shared reviewer-analysis template.',
        userOverride: null,
      }));
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

test('composes active, same-name, excluded, ineligible, blocked, handled, and applicant status rows', async () => {
  const user = userEvent.setup();
  const onNavigate = jest.fn();
  const sameNameA = readyCandidate('Same Name', 'search:same-a');
  const sameNameB = readyCandidate('Same Name', 'search:same-b');
  const activeReady = readyCandidate('Alpha Ready', 'search:alpha');
  const applicantActive = readyCandidate('Applicant Ready', 'suggestion:active', {
    isApplicantRecommended: true,
    suggestionId: 'active-suggestion',
    enrichedProposalKey: 'proposal-1',
    applicantKnownReviewer: {
      status: 'known',
      name: 'Applicant Ready',
      email: 'applicant@example.edu',
      emailSource: 'staff_verified',
    },
    provenance: {
      kind: 'applicant_suggested',
      sources: ['applicant_form'],
      seedRole: 'applicant_suggested',
      groundingWorkIds: [],
    },
  });
  const needsReview = {
    ...readyCandidate('Needs Review', 'search:needs-review'),
    identityStatus: 'unresolved',
    addressTrustReceipt: null,
  };
  const excluded = readyCandidate('Excluded Person', 'search:excluded');
  const ineligible = readyCandidate('Deceased Person', 'search:deceased', {
    eligibilityStatus: 'deceased',
    eligibilityEvidence: { url: 'https://example.edu/official-status' },
  });
  const blocked = readyCandidate('Blocked Applicant', 'search:blocked');
  const handled = { candidateKey: 'handled:one', name: 'Handled Person', stage: 'selected' };
  const handledApplicant = { suggestionId: 'handled-suggestion', name: 'Applicant Handled', selected: true };

  useRosterSnapshot(rosterSnapshot({
    active: [sameNameA, sameNameB, activeReady, applicantActive, needsReview],
    excluded: [excluded],
    ineligible: [ineligible],
    blocked: [blocked],
    handled: [handled],
    allNames: [sameNameA.name, sameNameB.name, activeReady.name, applicantActive.name, needsReview.name],
  }));

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob://proposal"
      proposalKey="proposal-1"
      recommended={[handledApplicant]}
      slotsPopulated={1}
      manualAddSlot={<div data-testid="manual-add-slot">Manual reviewer slot</div>}
      onNavigate={onNavigate}
    />,
  );

  expect(await screen.findByText('Alpha Ready')).toBeInTheDocument();
  expect(screen.getAllByLabelText('Select Same Name')).toHaveLength(2);
  expect(screen.getByText(/Ready to add to Invite \(\d+\)/)).toBeInTheDocument();
  expect(screen.getByText(/Needs review \(\d+\)/)).toBeInTheDocument();
  expect(screen.getByTestId('manual-add-slot')).toHaveTextContent('Manual reviewer slot');

  expect(screen.getByText('Already handled')).toBeInTheDocument();
  expect(screen.getByText('Applicant-referred reviewers')).toBeInTheDocument();
  expect(screen.getAllByText('Applicant Handled').length).toBeGreaterThanOrEqual(2);

  await user.click(screen.getByText(/Excluded \(1\)/));
  expect(screen.getByText('Excluded Person')).toBeInTheDocument();
  await user.click(screen.getByText(/Not eligible \(1\)/));
  expect(screen.getByText('Deceased Person')).toBeInTheDocument();
  await user.click(screen.getByText(/Cannot add to Invite \(1\)/));
  expect(screen.getByText('Blocked Applicant')).toBeInTheDocument();

  await user.click(screen.getAllByRole('button', { name: 'Open Invite' })[0]);
  expect(onNavigate).toHaveBeenCalledTimes(1);
  expect(onNavigate).toHaveBeenCalledWith('candidates');

  await user.click(screen.getAllByLabelText('Select Same Name')[0]);
  expect(screen.getAllByText(/1 selected/).length).toBeGreaterThanOrEqual(1);
  expect(screen.getByRole('button', { name: 'Add 1 selected to Invite' })).toBeInTheDocument();
});

test('keeps search controls, ordering, prompt editor, and contact modal lifecycle in the facade', async () => {
  const user = userEvent.setup();
  const contact = readyCandidate('Needs Address', 'search:needs-address', {
    emailSource: 'pubmed',
    addressTrustReceipt: null,
  });
  const alpha = readyCandidate('Zed Reviewer', 'search:zed');
  const beta = readyCandidate('Ada Reviewer', 'search:ada');
  useRosterSnapshot(rosterSnapshot({ active: [contact, alpha, beta], allNames: [contact.name, alpha.name, beta.name] }));

  render(
    <ReviewerSearchSection
      requestId={REQ}
      blobUrl="blob://proposal"
      proposalKey="proposal-1"
    />,
  );

  await screen.findByText('Zed Reviewer');
  const pubmed = screen.getByRole('button', { name: /PubMed Biomedical/i });
  expect(pubmed).toHaveAttribute('aria-pressed', 'true');
  await user.click(pubmed);
  expect(pubmed).toHaveAttribute('aria-pressed', 'false');

  fireEvent.change(screen.getByLabelText(/Number of candidates to find/i), { target: { value: '7' } });
  expect(screen.getByText('7')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Additional context for Claude/i), { target: { value: 'Prioritize clinical trialists.' } });
  expect(screen.getByLabelText(/Additional context for Claude/i)).toHaveValue('Prioritize clinical trialists.');

  await user.click(screen.getByRole('button', { name: 'A–Z' }));
  expect(screen.getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true');
  const cards = screen.getByTestId('reviewer-candidate-list');
  expect(cards.textContent.indexOf('Ada Reviewer')).toBeLessThan(cards.textContent.indexOf('Zed Reviewer'));

  await user.click(screen.getByRole('button', { name: /Edit prompts/i }));
  expect(await screen.findByRole('heading', { name: 'Edit my prompts' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('heading', { name: 'Edit my prompts' })).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Verify address for Needs Address' }));
  expect(screen.getByRole('heading', { name: 'Edit candidate' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('heading', { name: 'Edit candidate' })).not.toBeInTheDocument();
});

test('renders explicit empty, loading, and ingestion-error states', async () => {
  const retry = jest.fn();
  const { rerender } = render(<ReviewerSearchSection requestId={null} blobUrl={null} />);
  expect(screen.getByText(/Load a proposal document above to search/)).toBeInTheDocument();

  rerender(<ReviewerSearchSection requestId={null} blobUrl={null} ingestLoading />);
  expect(screen.getByText(/Materializing the applicant's recommended reviewers/)).toBeInTheDocument();

  rerender(
    <ReviewerSearchSection
      requestId={null}
      blobUrl={null}
      ingestError="Applicant import failed"
      onRetryIngestion={retry}
    />,
  );
  expect(screen.getByText(/Couldn't ingest applicant reviewers: Applicant import failed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('keeps unverified suggestions read-only and separate from selectable roster cards', async () => {
  const unverified = {
    candidateKey: 'search:unverified',
    name: 'Unverified Suggestion',
    identityStatus: 'unresolved',
    affiliation: 'Example University',
    publications: [{ title: 'Unverified paper', year: 2024 }],
  };
  useRosterSnapshot(rosterSnapshot());
  readSseStream.mockImplementation(async (_response, handler) => {
    const call = readSseStream.mock.calls.length;
    if (call === 1) handler({ event: 'message', data: { proposalInfo: { title: 'Proposal' } } });
    if (call === 2) handler({ event: 'message', data: { ranked: [], unverified: [unverified] } });
  });
  global.fetch = jest.fn((url) => {
    const target = String(url);
    if (target.includes('/api/workbench/reviewer-roster?')) return Promise.resolve(response(rosterSnapshot()));
    if (target === '/api/reviewer-finder/analyze') return Promise.resolve(response({}));
    if (target === '/api/reviewer-finder/discover') return Promise.resolve(response({}));
    throw new Error(`unexpected fetch ${target}`);
  });

  render(<ReviewerSearchSection requestId={REQ} blobUrl="blob://proposal" />);
  await userEvent.setup().click(await screen.findByRole('button', { name: 'Run reviewer search' }));
  expect(await screen.findByText(/Unverified suggestions \(1\)/)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByText(/Unverified suggestions \(1\)/));
  expect(screen.getByText('Unverified Suggestion')).toBeInTheDocument();
  expect(screen.queryByLabelText('Select Unverified Suggestion')).not.toBeInTheDocument();
});
