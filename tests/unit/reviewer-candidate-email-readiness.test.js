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
      contactEnrichment: { emailSource: 'pubmed', emailYear: 2025 },
    });

    expect(screen.getByText('📧 ready@example.edu')).toHaveAttribute(
      'title',
      'Email (from pubmed, 2025)'
    );
    expect(screen.getByText('✓ High-confidence email')).toHaveAttribute(
      'title',
      'Address source: pubmed. Confidence reflects address provenance and identity match, not deliverability.'
    );
  });

  test('surfaces manual and unknown provenance as needing confirmation', () => {
    renderCandidate({
      email: 'manual@example.edu',
      emailSource: 'manual',
    });

    expect(screen.getByText('⚠ Email needs confirmation')).toHaveAttribute(
      'title',
      'Manually entered — not verified against the reviewer’s identity. Confidence reflects address provenance and identity match, not deliverability.'
    );
  });

  test('surfaces missing contact instead of implying enrichment succeeded', () => {
    renderCandidate({ email: null, contactEnrichment: {} });

    expect(screen.getByText('Email not found')).toHaveAttribute(
      'title',
      'No email address found during contact enrichment'
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
