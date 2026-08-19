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

    expect(screen.getByRole('link', { name: 'ready@example.edu' })).toHaveAttribute(
      'title',
      'Email (from scholarly_multi, 2025)'
    );
    expect(screen.getByText('Identity: verified')).toBeInTheDocument();
    expect(screen.getByText(/Evidence includes high-confidence email/)).toBeInTheDocument();
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent('Address source: multiple recent papers');
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent('2 recent works');
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent('2025');
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

    expect(screen.getByText(/Evidence includes high-confidence email/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'official profile' })).toHaveAttribute(
      'href',
      'https://engineering.tamu.edu/electrical/profiles/phemmer.html',
    );
    expect(screen.getByText(/initials \+ surname mailbox match/)).toHaveTextContent(
      '1 other page address not selected',
    );
  });

  test('surfaces manual and unknown provenance as needing confirmation', () => {
    renderCandidate({
      email: 'manual@example.edu',
      emailSource: 'manual',
    });

    expect(screen.getByText('Identity: address needs confirmation')).toBeInTheDocument();
    expect(screen.getByText(/The available evidence for manual@example.edu is limited/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'manual@example.edu' })).not.toBeInTheDocument();
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

    expect(screen.getByText('Identity: verified')).toBeInTheDocument();
    expect(screen.getByText(/verified@example.edu was verified by staff against recorded evidence/)).toBeInTheDocument();
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent(
      'Staff verified this exact person and address for promotion'
    );
    expect(screen.queryByText('Identity: address needs confirmation')).not.toBeInTheDocument();
  });

  test('surfaces missing contact instead of implying enrichment succeeded', () => {
    renderCandidate({ email: null, contactEnrichment: {} });

    expect(screen.getByText('Identity: verified email required')).toBeInTheDocument();
    expect(screen.getByText(/No verified email address is available/)).toBeInTheDocument();
  });

  test('keeps search-derived addresses visibly quarantined as research-only', () => {
    renderCandidate({
      email: 'lead@example.edu',
      emailSource: 'serp_search',
    });

    expect(screen.getByText('Identity: address not verified')).toBeInTheDocument();
    expect(screen.getByText(/lead@example.edu was found through Google search/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'lead@example.edu' })).not.toBeInTheDocument();
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

    expect(screen.queryByText(/Evidence includes high-confidence email/)).not.toBeInTheDocument();
    expect(screen.queryByText('Identity: address needs confirmation')).not.toBeInTheDocument();
    expect(screen.queryByText('Identity: verified email required')).not.toBeInTheDocument();
    expect(screen.getByText(/Identity confirmation required/)).toBeInTheDocument();
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

    expect(screen.getByText('Existing reviewer record linked.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'linked@example.edu' })).not.toBeInTheDocument();
    expect(screen.getByText('Identity: address needs confirmation')).toBeInTheDocument();
    expect(screen.queryByText(/Existing person record matched by exact/)).not.toBeInTheDocument();
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

    expect(screen.getByText('Existing reviewer record linked.')).toBeInTheDocument();
    expect(screen.getAllByText('Identity: address not verified')).toHaveLength(1);
    expect(screen.getByText(/found through Claude web search/)).toBeInTheDocument();
    expect(screen.queryByText(/research_only/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'sarah.shackleton@whoi.edu' })).not.toBeInTheDocument();
    expect(container.querySelectorAll('.bg-emerald-50')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Verify address for Sarah Shackleton' }));
    expect(onEdit).toHaveBeenCalledTimes(1);

    await user.click(screen.getByText('Details'));
    expect(screen.getByText('Email evidence:').parentElement).toHaveTextContent(
      'Search lead lacks address-specific first-party evidence',
    );
    expect(screen.getByText('Dataverse record:').parentElement).toHaveTextContent(
      'Existing reviewer record linked to this applicant recommendation',
    );
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

    expect(screen.getByText('Identity: verified')).toBeInTheDocument();
    expect(screen.getByText(/verified by staff against recorded evidence and is linked to an existing reviewer record/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'verified-linked@example.edu' })).toBeInTheDocument();
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

    expect(screen.getByText(/Existing person record matched by exact email/)).toBeInTheDocument();
    expect(screen.getByText('Dataverse institutions:').parentElement).toHaveTextContent(
      'may include co-affiliations or history',
    );
    expect(screen.getByText('Dataverse institutions:').parentElement).toHaveTextContent('Stanford University');
    expect(screen.getByText('Dataverse institutions:').parentElement).toHaveTextContent('Northwestern University');
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

    expect(screen.getByText('Dataverse identity needs review')).toBeInTheDocument();
    expect(screen.queryByText(/Existing person record matched by exact/)).not.toBeInTheDocument();
  });
});
