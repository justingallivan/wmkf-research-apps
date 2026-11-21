import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidateCard } from '../../shared/components/reviewers/ReviewerSearchSection';

const baseCandidate = {
  name: 'Dr Contact Ready',
  affiliation: 'Example University',
  identityStatus: 'confirmed',
  sources: ['pubmed'],
  publications: [],
};

function renderCandidate(candidate) {
  return render(
    <CandidateCard
      candidate={{ ...baseCandidate, pdIdentityConfirmed: true, ...candidate }}
      checked={false}
      onToggle={jest.fn()}
    />
  );
}

describe('CandidateCard email readiness', () => {
  test('surfaces a high-confidence email with its authoritative reason', () => {
    renderCandidate({
      email: 'ready@example.edu',
      contactEnrichment: {
        emailSource: 'scholarly_multi',
        emailYear: 2025,
        emailEvidence: {
          publicationCount: 2,
          publications: [
            {
              url: 'https://example.org/work/1',
              year: 2025,
              title: 'First corroborating work',
            },
          ],
        },
      },
    });

    expect(screen.getByRole('link', { name: 'Email ready@example.edu' })).toHaveAttribute('href', 'mailto:ready@example.edu');
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Ready');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent('Confirmed: ready@example.edu');
    expect(screen.getByText(/multiple recent papers, 2025/)).toBeInTheDocument();
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent('listed on a paper from 2025');
    expect(screen.getByRole('link', { name: '2025' })).toHaveAttribute('href', 'https://example.org/work/1');
  });

  test('explains an institution-page ownership decision after roster reload', () => {
    renderCandidate({
      email: 'prhemmer@tamu.edu',
      contactEnrichment: {
        emailSource: 'institution_page',
        emailEvidence: {
          sourceKind: 'institution_page',
          sourceUrl: 'https://engineering.tamu.edu/electrical/profiles/phemmer.html',
          ownershipProof: 'mailbox_initials_surname_unverified_middle',
          matchClass: 'initials_surname',
          alternatives: [{ email: 'easa@tamu.edu', matchClass: 'unmatched' }],
        },
      },
    });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Ready');
    expect(screen.getByRole('link', { name: 'official profile' })).toHaveAttribute(
      'href',
      'https://engineering.tamu.edu/electrical/profiles/phemmer.html',
    );
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent(/initials \+ surname mailbox match/);
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent('1 other page address not selected');
  });

  test('surfaces manual and unknown provenance as needing confirmation', () => {
    renderCandidate({
      email: 'manual@example.edu',
      emailSource: 'manual',
    });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check email');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent("manual@example.edu hasn't been confirmed yet");
    expect(screen.queryByRole('link', { name: /manual@example.edu/ })).not.toBeInTheDocument();
  });

  test('lets a current address-trust receipt override stale enrichment readiness', () => {
    renderCandidate({
      email: 'verified@example.edu',
      emailSource: 'manual',
      addressTrustReceipt: {
        personConfirmed: true,
        email: 'verified@example.edu',
      },
      contactEnrichment: {
        email: 'verified@example.edu',
        emailSource: 'affiliation',
        emailAction: 'quick_check',
        emailActionReason: 'Derived from an affiliation string — not verified against the identity',
      },
    });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Ready');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent('Confirmed by staff: verified@example.edu');
    expect(screen.queryByText(/hasn't been confirmed yet/)).not.toBeInTheDocument();
  });

  test('surfaces missing contact instead of implying enrichment succeeded', () => {
    renderCandidate({ email: null, contactEnrichment: {} });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check email');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent('No email address found');
  });

  test('keeps search-derived addresses visibly quarantined as research-only', () => {
    renderCandidate({
      email: 'lead@example.edu',
      emailSource: 'serp_search',
    });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check email');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent("lead@example.edu hasn't been confirmed yet");
    expect(screen.getByText(/Google search/, { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /lead@example.edu/ })).not.toBeInTheDocument();
  });

  test('does not surface contact readiness for an unresolved proposal-named identity', () => {
    renderCandidate({
      email: 'namesake@example.edu',
      emailSource: 'pubmed',
      identityStatus: 'unresolved',
      pdIdentityConfirmed: false,
      provenance: {
        kind: 'proposal_named',
        sources: ['proposal'],
        seedRole: 'query_seed',
        groundingWorkIds: [],
      },
    });

    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Confirm identity');
    expect(screen.queryByText(/Confirmed:/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /namesake@example.edu/ })).not.toBeInTheDocument();
  });
});

describe('CandidateCard affiliation and Dataverse evidence', () => {
  test('keeps exact applicant linkage distinct from general-search Dataverse evidence', () => {
    renderCandidate({
      isApplicantRecommended: true,
      applicantKnownReviewer: {
        status: 'known',
        potentialReviewerId: 'person-1',
        name: 'Dr Contact Ready',
        affiliation: 'Example University',
        email: 'linked@example.edu',
        emailSource: null,
        emailReadiness: {
          level: 'low',
          action: 'quick_check',
          reason: 'Email source not recorded — confirm before sending',
        },
        orcid: '0000-0001-2345-6789',
      },
    });

    expect(screen.getByRole('columnheader', { name: 'AkoyaGO record' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /linked@example.edu/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check email');
    expect(screen.queryByText(/AkoyaGO person record matches/)).not.toBeInTheDocument();
  });

  test('shows the Sarah Shackleton linked-record case as one actionable address issue', async () => {
    const user = userEvent.setup();
    const onEdit = jest.fn();
    const { container } = render(
      <CandidateCard
        candidate={{
          ...baseCandidate,
          name: 'Sarah Shackleton',
          affiliation: 'Woods Hole Oceanographic Institution',
          isApplicantRecommended: true,
          applicantKnownReviewer: {
            status: 'known',
            potentialReviewerId: 'e9bdceb0-test',
            affiliation: 'Woods Hole Oceanographic Institution',
            email: 'sarah.shackleton@whoi.edu',
            emailSource: 'claude_search',
            emailReadiness: {
              level: 'low',
              action: 'research_only',
              reason: 'Search lead lacks address-specific first-party evidence',
            },
            addressTrustVerified: false,
          },
        }}
        checked={false}
        onToggle={jest.fn()}
        onEdit={onEdit}
      />,
    );

    expect(screen.getByRole('columnheader', { name: 'AkoyaGO record' })).toBeInTheDocument();
    expect(screen.getAllByTestId('candidate-status-chip')).toHaveLength(1);
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check email');
    expect(screen.getByText(/Claude web search/, { selector: 'span' })).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/research_only/);
    expect(screen.queryByRole('link', { name: /sarah.shackleton@whoi.edu/ })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.bg-green-50')).toHaveLength(0);
    // One remedy: Verify address is the primary and is not repeated.
    expect(screen.getAllByRole('button', { name: /Verify address/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Verify address for Sarah Shackleton' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Search lead lacks address-specific/)).not.toBeInTheDocument();
  });

  test('turns a staff-verified linked record into a single verified identity state', () => {
    renderCandidate({
      isApplicantRecommended: true,
      applicantKnownReviewer: {
        status: 'known',
        potentialReviewerId: 'person-verified',
        email: 'verified-linked@example.edu',
        emailSource: 'staff_verified',
        emailReadiness: {
          level: 'high',
          action: 'ready',
          reason: 'Staff verified this exact person and address for promotion',
        },
        addressTrustVerified: true,
      },
    });

    expect(screen.getAllByTestId('candidate-status-chip')).toHaveLength(1);
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Ready');
    expect(screen.getByTestId('candidate-match-line')).toHaveTextContent('Confirmed by staff: verified-linked@example.edu');
    expect(screen.getByRole('link', { name: 'Email verified-linked@example.edu' })).toBeInTheDocument();
  });

  test('labels publication and OpenAlex evidence without claiming both are current', () => {
    const { rerender } = renderCandidate({ affiliationSource: 'pubmed_recency' });
    expect(screen.getByText(/publication affiliation/)).toBeInTheDocument();

    rerender(
      <CandidateCard
        candidate={{ ...baseCandidate, affiliationSource: 'openalex_current' }}
        checked={false}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByText(/last known \(per OpenAlex\)/)).toBeInTheDocument();
    expect(screen.queryByText(/current \(per OpenAlex\)/)).not.toBeInTheDocument();
  });

  test('surfaces exact-key known status and multiple institution records neutrally', () => {
    renderCandidate({
      affiliation: 'Northwestern University',
      affiliationSource: 'pubmed_recency',
      contactEnrichment: {
        dataverseContactEvidence: {
          status: 'known',
          matchKey: 'email',
          checkedAt: '2026-07-21T12:00:00.000Z',
          institutions: [
            { value: 'Stanford University', source: 'organization' },
            { value: 'Northwestern University', source: 'primary_affiliation' },
          ],
        },
      },
    });

    expect(screen.getByText(/An AkoyaGO person record matches this reviewer's email exactly/)).toBeInTheDocument();
    const recordCell = screen.getByText('May include joint appointments or history.').closest('td');
    expect(recordCell).toHaveTextContent('Stanford University (organization)');
    expect(recordCell).toHaveTextContent('Northwestern University (primary affiliation)');
  });

  test('surfaces review-required exact-key reconciliation without making a known claim', () => {
    renderCandidate({
      contactEnrichment: {
        dataverseContactEvidence: {
          status: 'review_required',
          matchKey: 'orcid',
          checkedAt: '2026-07-21T12:00:00.000Z',
          institutions: [],
        },
      },
    });

    expect(screen.getByTestId('akoyago-review-required')).toBeInTheDocument();
    expect(screen.getByTestId('candidate-compare-details')).toHaveAttribute('open');
    expect(screen.queryByText(/AkoyaGO person record matches this reviewer/)).not.toBeInTheDocument();
  });
});
