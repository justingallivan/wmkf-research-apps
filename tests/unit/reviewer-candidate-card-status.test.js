import {
  getCandidateCardStatus,
  isCandidateSelectable,
} from '../../shared/components/reviewers/reviewer-search-logic';

// One status per Find-tab card (DESIGN.md Status-Once Rule). The helper is
// presentation only: it must never call a row Ready unless the promotion and
// email-readiness helpers that gate selection already agree.
const READY = {
  name: 'Maria Okafor',
  affiliation: 'Example University',
  identityStatus: 'confirmed',
  pdIdentityConfirmed: true,
  email: 'okafor@example.edu',
  emailSource: 'orcid',
};

const UNRESOLVED = {
  name: 'Ben Namesake',
  identityStatus: 'unresolved',
  needsIdentification: true,
  provenance: { kind: 'proposal_named', sources: ['proposal'], seedRole: 'query_seed', groundingWorkIds: [] },
  publications: [{ title: 'A paper', year: 2024 }],
};

const CASES = [
  ['ready', READY, { key: 'ready', label: 'Ready', primary: 'add_to_invite' }],
  ['staff-confirmed ready', { ...READY, emailSource: 'manual', addressTrustReceipt: { personConfirmed: true, email: 'okafor@example.edu' } }, { key: 'ready', matchIncludes: 'Confirmed by staff' }],
  ['strong coauthor conflict beats ready', { ...READY, hasCoauthorCOI: true, coauthorCOIStrength: 'likely', coauthorships: [{ proposalAuthor: 'Dr PI', paperCount: 4 }] }, { key: 'conflict', tone: 'red', primary: null, matchIncludes: 'Coauthored 4 papers with Dr PI' }],
  ['institution conflict beats identity review', { ...UNRESOLVED, hasInstitutionCOI: true, institutionCOIDetails: { reviewerInstitution: 'PI University' } }, { key: 'conflict', matchIncludes: 'Same institution as the PI (PI University)' }],
  ['possible coauthor overlap on an otherwise ready row', { ...READY, hasCoauthorCOI: true, coauthorCOIStrength: 'possible', coauthorships: [{ proposalAuthor: 'Dr PI', paperCount: 1 }] }, { key: 'possible_conflict', tone: 'amber', primary: 'add_to_invite' }],
  ['inactive linked record', { ...READY, isApplicantRecommended: true, applicantKnownReviewer: { status: 'inactive' } }, { key: 'fix_record', primary: 'retry_record_check', matchIncludes: 'inactive' }],
  ['linked record email conflict', { ...READY, isApplicantRecommended: true, applicantKnownReviewer: { status: 'email_conflict' } }, { key: 'email_conflict', tone: 'red', primary: 'retry_record_check' }],
  ['unknown linked record status', { ...READY, isApplicantRecommended: true, applicantKnownReviewer: { status: 'unexpected_status' } }, { key: 'fix_record', primary: null }],
  ['unrecorded address conflict', { ...READY, conflictRecordUnavailable: true }, { key: 'check_unavailable', primary: 'retry_conflict_check' }],
  ['identity plus pending address conflict', { ...UNRESOLVED, email: 'a@example.edu', emailSource: 'pubmed', addressConflictPending: true }, { key: 'check_identity', primary: 'review_and_confirm' }],
  ['unresolved identity', UNRESOLVED, { key: 'confirm_identity', primary: 'confirm_identity', matchIncludes: 'Check the 1 paper' }],
  ['ORCID and email split', { ...READY, pdIdentityConfirmed: false, serverIdentityReviewReason: 'orcid_email_split' }, { key: 'check_identity', primary: 'confirm_identity' }],
  ['manual contact change is thin, not contradictory', { ...READY, pdIdentityConfirmed: false, serverIdentityReviewReason: 'manual_contact_changed' }, { key: 'confirm_identity' }],
  ['missing email', { ...READY, email: null, emailSource: null }, { key: 'check_email', matchIncludes: 'No email address found' }],
  ['pending stored/found address conflict', { ...READY, addressConflictPending: true }, { key: 'check_email', primary: 'review_email_choice' }],
  ['search-only address', { ...READY, emailSource: 'serp_search' }, { key: 'check_email', primary: 'verify_address', matchIncludes: "hasn't been confirmed yet" }],
  ['deceased beats ready', { ...READY, eligibilityStatus: 'deceased' }, { key: 'not_eligible', primary: null }],
  ['single-paper address', { ...READY, emailSource: 'pubmed' }, { key: 'check_email', primary: 'verify_address' }],
];

describe('getCandidateCardStatus', () => {
  test.each(CASES)('%s', (_name, candidate, expected) => {
    const status = getCandidateCardStatus(candidate);
    expect(status.key).toBe(expected.key);
    if ('label' in expected) expect(status.label).toBe(expected.label);
    if ('tone' in expected) expect(status.tone).toBe(expected.tone);
    if ('primary' in expected) expect(status.primary).toBe(expected.primary);
    if (expected.matchIncludes) expect(status.match.text).toContain(expected.matchIncludes);
    expect(typeof status.match.text).toBe('string');
    expect(status.match.text.length).toBeGreaterThan(0);
  });

  test.each(CASES)('never calls %s Ready unless the row is selectable', (_name, candidate) => {
    const status = getCandidateCardStatus(candidate);
    if (status.key === 'ready' || status.primary === 'add_to_invite') {
      expect(isCandidateSelectable(candidate)).toBe(true);
    }
  });

  test('an empty candidate falls back to a non-Ready status', () => {
    const status = getCandidateCardStatus({});
    expect(status.key).not.toBe('ready');
    expect(status.primary).not.toBe('add_to_invite');
  });

  test('never renders pipeline vocabulary in the match line', () => {
    for (const [, candidate] of CASES) {
      expect(getCandidateCardStatus(candidate).match.text).not.toMatch(/Dataverse|enrichment|gate|resolver|research_only|quick_check/i);
    }
  });
});

describe('CandidateCard status rendering', () => {
  // eslint-disable-next-line global-require
  const { render, screen } = require('@testing-library/react');
  // eslint-disable-next-line global-require
  const { CandidateCard } = require('../../shared/components/reviewers/ReviewerSearchSection');

  test('a selectable coauthor-conflict row keeps Add to Invite as a non-primary action', () => {
    const onAddToInvite = jest.fn();
    render(
      <CandidateCard
        candidate={{ ...READY, hasCoauthorCOI: true, coauthorCOIStrength: 'likely', coauthorships: [{ proposalAuthor: 'Dr PI', paperCount: 4 }] }}
        checked={false}
        onToggle={() => {}}
        onAddToInvite={onAddToInvite}
      />,
    );
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Conflict');
    screen.getByRole('button', { name: 'Add Maria Okafor to Invite' }).click();
    expect(onAddToInvite).toHaveBeenCalledTimes(1);
  });

  test('Compare details opens when a re-render turns a card into Check identity', () => {
    const { rerender } = render(<CandidateCard candidate={READY} checked={false} onToggle={() => {}} />);
    expect(screen.getByTestId('candidate-compare-details')).not.toHaveAttribute('open');
    rerender(
      <CandidateCard
        candidate={{ ...READY, pdIdentityConfirmed: false, serverIdentityReviewReason: 'orcid_email_split' }}
        checked={false}
        onToggle={() => {}}
        onConfirmIdentity={() => {}}
      />,
    );
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Check identity');
    expect(screen.getByTestId('candidate-compare-details')).toHaveAttribute('open');
  });

  test('source line follows provenance', () => {
    const { rerender } = render(<CandidateCard candidate={{ ...READY, provenance: { kind: 'proposal_named', sources: ['proposal'], seedRole: 'query_seed', groundingWorkIds: [] } }} checked={false} onToggle={() => {}} />);
    expect(screen.getByText('Named in the proposal')).toBeInTheDocument();
    rerender(<CandidateCard candidate={{ ...READY, sources: ['staff_manual'] }} checked={false} onToggle={() => {}} />);
    expect(screen.getByText('Added by staff')).toBeInTheDocument();
  });
});
