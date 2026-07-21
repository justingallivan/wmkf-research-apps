import { render, screen } from '@testing-library/react';
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
      candidate={{ ...baseCandidate, ...candidate }}
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

    expect(screen.getByText('📧 ready@example.edu')).toHaveAttribute(
      'title',
      'Email (from scholarly_multi, 2025)'
    );
    expect(screen.getByText('✓ High-confidence email')).toHaveAttribute(
      'title',
      'Address source: scholarly_multi. Confidence reflects address provenance and identity-grounded evidence, not deliverability.'
    );
    expect(screen.getByText(/Evidence: 2 recent works/)).toHaveTextContent('2025');
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

    expect(screen.getByText('✓ High-confidence email')).toBeInTheDocument();
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

    expect(screen.getByText('⚠ Email needs confirmation')).toHaveAttribute(
      'title',
      'Manually entered — not verified against the reviewer’s identity. Confidence reflects address provenance and identity-grounded evidence, not deliverability.'
    );
  });

  test('surfaces missing contact instead of implying enrichment succeeded', () => {
    renderCandidate({ email: null, contactEnrichment: {} });

    expect(screen.getByText('Email not found')).toHaveAttribute(
      'title',
      'No email address found during contact enrichment'
    );
  });

  test('keeps search-derived addresses visibly quarantined as research-only', () => {
    renderCandidate({
      email: 'lead@example.edu',
      emailSource: 'serp_search',
    });

    expect(screen.getByText('⚠ Research only')).toHaveAttribute(
      'title',
      'Search lead lacks address-specific first-party evidence. Confidence reflects address provenance and identity-grounded evidence, not deliverability.'
    );
  });

  test('does not surface contact readiness for an unresolved proposal-named identity', () => {
    renderCandidate({
      email: 'namesake@example.edu',
      emailSource: 'pubmed',
      identityStatus: 'unresolved',
      provenance: {
        kind: 'proposal_named',
        sources: ['proposal'],
        seedRole: 'query_seed',
        groundingWorkIds: [],
      },
    });

    expect(screen.queryByText('✓ High-confidence email')).not.toBeInTheDocument();
    expect(screen.queryByText('⚠ Email needs confirmation')).not.toBeInTheDocument();
    expect(screen.queryByText('Email not found')).not.toBeInTheDocument();
    expect(screen.getByText(/Verify identity — no contact saved until confirmed/)).toBeInTheDocument();
  });
});

describe('CandidateCard affiliation and Dataverse evidence', () => {
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

    expect(screen.getByText(/Known in Dataverse by exact email/)).toBeInTheDocument();
    expect(screen.getByText(/Multiple affiliation records/)).toHaveTextContent(
      'may include co-affiliations or history',
    );
    expect(screen.getByText(/Multiple affiliation records/)).toHaveTextContent('Stanford University');
    expect(screen.getByText(/Multiple affiliation records/)).toHaveTextContent('Northwestern University');
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

    expect(screen.getByText('⚠ Dataverse identity needs review')).toBeInTheDocument();
    expect(screen.queryByText(/Known in Dataverse/)).not.toBeInTheDocument();
  });
});
