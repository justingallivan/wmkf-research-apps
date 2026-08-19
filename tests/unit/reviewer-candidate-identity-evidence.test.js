import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  addressTrustFailureMessage,
  CandidateCard,
} from '../../shared/components/reviewers/ReviewerSearchSection';

/**
 * A needs-identity-review card suppresses the normal contact/bibliometric chips,
 * because those read as verified facts about a resolved person. Staff still have
 * to answer "is this the right person?" before clicking "Confirm identity",
 * which commits a durable attestation.
 * These tests pin that the same retrieved evidence is available BEFORE that click,
 * and that it is not dressed up as the verified treatment.
 */
const unresolvedCandidate = {
  name: 'Benjamin Namesake',
  affiliation: 'Department of Biochemistry, Example University',
  affiliationSource: 'pubmed_recency',
  identityStatus: 'unresolved',
  email: 'namesake@example.edu',
  emailSource: 'pubmed',
  publicationCount5yr: 6,
  publications: [
    { title: 'Quantitative MS of histone marks', year: 2024, url: 'https://example.org/work/1' },
    { title: 'Synthetic readers benchmarked', year: 2023 },
  ],
  provenance: {
    kind: 'proposal_named',
    sources: ['proposal'],
    seedRole: 'query_seed',
    groundingWorkIds: [],
  },
  contactEnrichment: {
    emailYear: 2024,
    dataverseContactEvidence: {
      status: 'known',
      matchKey: 'email',
      institutions: [
        { value: 'Example University', source: 'primary_affiliation' },
        { value: 'Other Institute', source: 'organization' },
      ],
    },
  },
};

test('address-trust failure guidance keeps reload as the immediate remedy and repair as a fallback', () => {
  expect(addressTrustFailureMessage({
    message: 'The reviewer changed. Reload the request.',
    remediation: [
      { action: 'retry_check', label: 'Retry check' },
      { action: 'create_repair_request', label: 'Create repair request' },
    ],
  }, 'Fallback')).toBe(
    'The reviewer changed. Reload the request. If the problem persists, use “Create repair request” on this reviewer card.',
  );
});

test('address-trust failure guidance does not duplicate a repair remedy already in the message', () => {
  expect(addressTrustFailureMessage({
    message: 'Retry or create a repair request.',
    remediation: [{ action: 'create_repair_request', label: 'Create repair request' }],
  }, 'Fallback')).toBe('Retry or create a repair request.');
});

test('a failed conflict write suppresses verification and exposes all executable remedies', async () => {
  const user = userEvent.setup();
  const retry = jest.fn();
  const repair = jest.fn();
  const exclude = jest.fn();
  render(
    <CandidateCard
      candidate={{
        ...unresolvedCandidate,
        identityStatus: 'probable',
        conflictRecordUnavailable: true,
      }}
      readOnly
      onEdit={jest.fn()}
      onRetryAddressCheck={retry}
      onRequestRepair={repair}
      onExclude={exclude}
    />
  );

  expect(screen.queryByRole('button', { name: /Verify \/ edit address/i })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Retry conflict check/i }));
  await user.click(screen.getByRole('button', { name: /Create repair request/i }));
  await user.click(screen.getByRole('button', { name: /Not a fit/i }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(repair).toHaveBeenCalledTimes(1);
  expect(exclude).toHaveBeenCalledTimes(1);
});

function renderUnresolved(overrides = {}) {
  return render(
    <CandidateCard
      candidate={{ ...unresolvedCandidate, ...overrides }}
      checked={false}
      onToggle={jest.fn()}
      onConfirmIdentity={jest.fn()}
    />
  );
}

const TOGGLE = /Review evidence before confirming/;

describe('CandidateCard identity evidence disclosure', () => {
  test('offers the evidence collapsed, and only for an unresolved identity', () => {
    renderUnresolved();

    const toggle = screen.getByRole('button', { name: TOGGLE });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText(/may be a different person with this name/)).toBeInTheDocument();
    // Collapsed: the evidence itself is absent from the DOM, not merely hidden.
    expect(screen.queryByText(/Quantitative MS of histone marks/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Address on file/)).not.toBeInTheDocument();
  });

  test('does not offer the disclosure on a resolved candidate', () => {
    render(
      <CandidateCard
        candidate={{ ...unresolvedCandidate, identityStatus: 'confirmed' }}
        checked={false}
        onToggle={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: TOGGLE })).not.toBeInTheDocument();
  });

  test('expanding shows every evidence field staff need to judge the person', async () => {
    const user = userEvent.setup();
    renderUnresolved();

    await user.click(screen.getByRole('button', { name: TOGGLE }));

    expect(screen.getByRole('button', { name: /Hide evidence/ })).toHaveAttribute('aria-expanded', 'true');

    // Affiliation + its provenance label.
    expect(screen.getByText(/Department of Biochemistry, Example University/)).toBeInTheDocument();
    expect(screen.getByText(/publication affiliation/)).toBeInTheDocument();

    // Dataverse evidence states what the match does and does not prove. It is keyed on
    // the email that came from the same retrieval, so it must not read as independent
    // identity confirmation.
    expect(screen.getByText(/already on an existing person record/)).toBeInTheDocument();
    expect(screen.getByText(/does not confirm this is the person the proposal named/)).toBeInTheDocument();
    expect(screen.queryByText(/matched an existing person record by exact/)).not.toBeInTheDocument();
    const institutionRow = screen.getByText(/may include co-affiliations or history/).parentElement;
    expect(institutionRow).toHaveTextContent('Example University (primary affiliation)');
    expect(institutionRow).toHaveTextContent('Other Institute (organization)');

    // Address, shown with its source.
    expect(screen.getByText('namesake@example.edu')).toBeInTheDocument();
    expect(screen.getByText(/from pubmed, 2024/)).toBeInTheDocument();

    // Publications, including the retrieved-vs-counted gap.
    expect(screen.getByText(/showing 2 of 6/)).toBeInTheDocument();
    expect(screen.getByText(/Quantitative MS of histone marks/)).toHaveTextContent('2024');
    expect(screen.getByRole('link', { name: '[link]' })).toHaveAttribute('href', 'https://example.org/work/1');

    // Scholar is a NAME SEARCH, never a stored profile URL.
    const scholar = screen.getByRole('link', { name: /Search Google Scholar for this name/ });
    expect(scholar.getAttribute('href')).toContain('scholar.google.com');
  });

  test('keeps a stored Scholar profile URL out of the disclosure', async () => {
    const user = userEvent.setup();
    renderUnresolved({ googleScholarUrl: 'https://scholar.google.com/citations?user=NAMESAKE123' });

    await user.click(screen.getByRole('button', { name: TOGGLE }));

    const scholar = screen.getByRole('link', { name: /Search Google Scholar for this name/ });
    expect(scholar.getAttribute('href')).not.toContain('NAMESAKE123');
    expect(screen.queryByText(/Scholar Profile/)).not.toBeInTheDocument();
  });

  test('does not restore the verified contact treatment', async () => {
    const user = userEvent.setup();
    renderUnresolved();

    await user.click(screen.getByRole('button', { name: TOGGLE }));

    // No mailto chip, no readiness verdict, no "known in Dataverse" ✓ claim.
    expect(screen.queryByRole('link', { name: 'namesake@example.edu' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Identity:.*high-confidence email/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Email needs confirmation')).not.toBeInTheDocument();
    expect(screen.queryByText(/Existing person record matched by exact/)).not.toBeInTheDocument();
    // The gate itself is untouched.
    expect(screen.getByText(/Identity confirmation required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm identity for Benjamin Namesake' })).toBeInTheDocument();
  });

  test('points the staffer at the papers as the check the panel cannot make', async () => {
    // The papers are the identity control: affiliation, address, and the Dataverse
    // match all descend from one retrieval and agree with each other regardless of
    // whether the right person was found. Only the papers can be checked against the
    // proposal — evidence that retrieval did not produce. Guards against a future
    // tidy-up truncating or dropping the list.
    const user = userEvent.setup();
    renderUnresolved();

    await user.click(screen.getByRole('button', { name: TOGGLE }));

    expect(screen.getByText(/do these match what the proposal is about/)).toBeInTheDocument();
    // Every retrieved paper is listed, not a sample.
    expect(screen.getByText(/Quantitative MS of histone marks/)).toBeInTheDocument();
    expect(screen.getByText(/Synthetic readers benchmarked/)).toBeInTheDocument();
  });

  test('states plainly when a field was never retrieved', async () => {
    const user = userEvent.setup();
    renderUnresolved({
      affiliation: null,
      email: null,
      publications: [],
      publicationCount5yr: null,
      contactEnrichment: {},
    });

    await user.click(screen.getByRole('button', { name: TOGGLE }));

    expect(screen.getAllByText('none retrieved')).toHaveLength(3);
    expect(screen.queryByText(/showing/)).not.toBeInTheDocument();
  });
});
