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
  ['unresolved identity with the server\'s generic text and no papers', { ...UNRESOLVED, publications: [], reasoning: 'Could not confirm this is the right person because the identity resolver did not establish a probable match. Confirm or correct the identity before selecting this reviewer.' }, { key: 'confirm_identity', matchIncludes: 'No publications found under this name' }],
  ['unresolved identity with the server\'s generic text and papers', { ...UNRESOLVED, reasoning: 'Could not confirm this is the right person because the identity resolver did not establish a probable match.' }, { key: 'confirm_identity', matchIncludes: 'Check the 1 paper' }],
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
  const { render, screen, cleanup } = require('@testing-library/react');
  afterEach(cleanup);
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

describe('Applicant listed column', () => {
  // eslint-disable-next-line global-require
  const { render, screen, within, cleanup } = require('@testing-library/react');
  afterEach(cleanup);
  // eslint-disable-next-line global-require
  const { CandidateCard } = require('../../shared/components/reviewers/ReviewerSearchSection');
  const APPLICANT = {
    ...READY,
    email: 'okafor@harvard.edu',
    affiliation: 'Harvard University',
    isApplicantRecommended: true,
    suggestionId: 'row-1',
    applicantKnownReviewer: {
      status: 'known',
      affiliation: 'Harvard University',
      email: 'okafor@harvard.edu',
      emailSource: 'orcid',
      emailReadiness: { level: 'high', action: 'ready', reason: 'x' },
    },
  };

  test('is absent when the applicant row carried no listed details', () => {
    render(<CandidateCard candidate={APPLICANT} applicantListed={null} checked={false} onToggle={() => {}} />);
    expect(screen.queryByRole('columnheader', { name: 'Applicant listed' })).not.toBeInTheDocument();
  });

  test('shows what the applicant typed and highlights only an exact email difference', () => {
    render(
      <CandidateCard
        candidate={APPLICANT}
        applicantListed={{ institution: 'Department of Chemistry, Stanford University, Stanford CA', email: 'mokafor@stanford.edu' }}
        checked={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Applicant listed' })).toBeInTheDocument();
    expect(screen.getByText('Department of Chemistry, Stanford University, Stanford CA')).toBeInTheDocument();
    const listedEmail = screen.getByTestId('applicant-listed-email');
    expect(listedEmail).toHaveTextContent('mokafor@stanford.edu');
    expect(listedEmail).toHaveClass('bg-amber-50');
    // Institution text in a different format is never highlighted.
    expect(screen.getByText('Department of Chemistry, Stanford University, Stanford CA').closest('td')).not.toHaveClass('bg-amber-50');
    // Plain text, never a mail link.
    expect(within(listedEmail).queryByRole('link')).not.toBeInTheDocument();
    // Display only: the status is unchanged by the applicant's values.
    expect(screen.getByTestId('candidate-status-chip')).toHaveTextContent('Ready');
  });

  test('a matching email is not highlighted and does not open the disclosure', () => {
    render(
      <CandidateCard
        candidate={APPLICANT}
        applicantListed={{ institution: 'Harvard', email: 'OKAFOR@harvard.edu' }}
        checked={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('applicant-listed-email')).not.toHaveClass('bg-amber-50');
    expect(screen.getByTestId('candidate-compare-details')).not.toHaveAttribute('open');
  });

  test('an applicant email difference alone does not auto-open Compare details', () => {
    render(
      <CandidateCard
        candidate={APPLICANT}
        applicantListed={{ institution: null, email: 'other@stanford.edu' }}
        checked={false}
        onToggle={() => {}}
      />,
    );
    expect(screen.getByTestId('candidate-compare-details')).not.toHaveAttribute('open');
  });
});

describe('saved institution note comparing a value with itself', () => {
  // eslint-disable-next-line global-require
  const { render, screen, cleanup } = require('@testing-library/react');
  // eslint-disable-next-line global-require
  const { CandidateCard } = require('../../shared/components/reviewers/ReviewerSearchSection');
  afterEach(() => { cleanup(); delete process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION; });
  const presentation = (evidence, recorded) => ({
    version: 'institution-stage2-presentation/v1',
    visible: true,
    kind: 'unresolved',
    tone: 'neutral',
    heading: 'Institution comparison unresolved',
    detail: `The available evidence could not establish whether ${evidence} and ${recorded} are compatible.`,
    evidenceInstitution: evidence,
    recordedInstitution: recorded,
    remedies: [],
  });

  test('is hidden when both sides are the same text', () => {
    process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'on';
    const lab = 'The Laboratory of Signaling, University of Texas Southwestern Medical Center, Dallas…';
    render(<CandidateCard candidate={{ ...READY, institutionPresentation: presentation(lab, lab) }} checked={false} onToggle={() => {}} />);
    expect(screen.queryByTestId('institution-stage2-presentation')).not.toBeInTheDocument();
  });

  test('is still shown when the two sides differ', () => {
    process.env.NEXT_PUBLIC_INSTITUTION_STAGE2_PRESENTATION = 'on';
    render(<CandidateCard candidate={{ ...READY, institutionPresentation: presentation('Old University', 'New University') }} checked={false} onToggle={() => {}} />);
    expect(screen.getByTestId('institution-stage2-presentation')).toBeInTheDocument();
  });
});
