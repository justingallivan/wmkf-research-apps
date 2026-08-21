/**
 * @jest-environment jsdom
 *
 * Actionable evidence states on the candidate card. Address and identity
 * problems expose one clearly labelled status plus a primary remedy instead of
 * requiring staff to infer an action from duplicate warning badges.
 *
 * The load-bearing property is fail-closed parity: the remedy renders only when
 * its exact handler is available (canManage, resolved identity, conflict record
 * available). No readiness or address-trust semantics are decided by the card
 * presentation
 * (`project-reviewer-verify-fail-dangerous`).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidateCard } from '../../shared/components/reviewers/ReviewerSearchSection';

// Reproduces the reported card: identity resolved (so the row is past identity
// review) but a legacy single-publication PubMed address ⇒
// emailReadiness.action === 'quick_check' ⇒ "Email needs confirmation" and the
// primary "Verify address" remedy render.
const QUICK_CHECK = {
  name: 'Alexander Green',
  affiliation: 'Boston University',
  email: 'aagreen@bu.edu',
  emailSource: 'pubmed',
  identityStatus: 'confirmed',
  pdIdentityConfirmed: true,
  publicationCount: 5,
};

function renderCard(overrides = {}, props = {}) {
  const onEdit = jest.fn();
  const onConfirmIdentity = jest.fn();
  const result = render(
    <CandidateCard
      candidate={{ ...QUICK_CHECK, ...overrides }}
      checked={false}
      onToggle={() => {}}
      onEdit={onEdit}
      onConfirmIdentity={onConfirmIdentity}
      {...props}
    />,
  );
  return { ...result, onEdit, onConfirmIdentity };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('address confirmation is shown once as status plus an executable remedy', async () => {
  const user = userEvent.setup();
  const { onEdit } = renderCard();

  expect(screen.getAllByText('Identity: address needs confirmation')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /Email needs confirmation/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Verify address for Alexander Green' }));

  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit.mock.calls[0][0].name).toBe('Alexander Green');
});

test('the primary "Verify address" action opens the same remedy', async () => {
  const user = userEvent.setup();
  const { onEdit } = renderCard();

  await user.click(screen.getByRole('button', { name: 'Verify address for Alexander Green' }));
  expect(onEdit).toHaveBeenCalledTimes(1);
});

test('a pending address conflict routes the badge to the conflict reviewer, not plain edit', async () => {
  const user = userEvent.setup();
  const onEdit = jest.fn();
  const onReviewAddressConflict = jest.fn();
  render(
    <CandidateCard
      candidate={{ ...QUICK_CHECK, addressConflictPending: true }}
      checked={false}
      onToggle={() => {}}
      onEdit={onEdit}
      onReviewAddressConflict={onReviewAddressConflict}
    />,
  );

  await user.click(screen.getByRole('button', { name: 'Review email choice for Alexander Green' }));
  expect(onReviewAddressConflict).toHaveBeenCalledTimes(1);
  expect(onEdit).not.toHaveBeenCalled();
});

test('read-only (canManage=false) leaves the warning as inert text — no dead action offered', () => {
  renderCard({}, { canManage: false });

  expect(screen.getByText(/Identity: address needs confirmation/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Verify address/ })).toBeNull();
});

test('does not render a dead address remedy when only the inactive conflict handler exists', () => {
  const onReviewAddressConflict = jest.fn();
  render(
    <CandidateCard
      candidate={QUICK_CHECK}
      checked={false}
      onToggle={() => {}}
      onReviewAddressConflict={onReviewAddressConflict}
    />,
  );

  expect(screen.getByText(/Identity: address needs confirmation/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Verify address/ })).toBeNull();
});

test('an unrecorded address conflict leaves the badge inert (repair path owns it)', () => {
  renderCard({ conflictRecordUnavailable: true });

  expect(screen.queryByRole('button', { name: /Address conflict/ })).toBeNull();
});

test('"Dataverse identity needs review" banner opens the confirm-identity remedy', async () => {
  const user = userEvent.setup();
  const { onConfirmIdentity } = renderCard({
    contactEnrichment: { dataverseContactEvidence: { status: 'review_required' } },
  });

  await user.click(screen.getByRole('button', { name: /Dataverse identity needs review/ }));
  expect(onConfirmIdentity).toHaveBeenCalledTimes(1);
});

test('"Existing linked reviewer record needs repair" exposes the AkoyaGO retry remedy', async () => {
  const user = userEvent.setup();
  const onRetryAddressCheck = jest.fn();
  render(
    <CandidateCard
      candidate={{ ...QUICK_CHECK, applicantKnownReviewer: { status: 'inactive' } }}
      checked={false}
      onToggle={() => {}}
      onRetryAddressCheck={onRetryAddressCheck}
      canManage
    />,
  );

  expect(screen.getByText(/Fix this reviewer record in AkoyaGO/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /Retry record check/ }));
  expect(onRetryAddressCheck).toHaveBeenCalledTimes(1);
});

test('ready identity evidence is summarized once and is not an action', () => {
  renderCard({ emailSource: 'orcid' });

  expect(screen.getByText(/Evidence includes high-confidence email/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /high-confidence email/ })).toBeNull();
});

test('a trusted address does not render green while the person still needs confirmation', () => {
  const { container } = renderCard({
    emailSource: 'staff_verified',
    serverIdentityReviewReason: 'manual_contact_changed',
    pdIdentityConfirmed: false,
  });

  expect(screen.getByText('Identity: confirmation required')).toBeInTheDocument();
  expect(screen.queryByText('Identity: verified')).not.toBeInTheDocument();
  expect(container.querySelectorAll('.bg-emerald-50')).toHaveLength(0);
});

test('a thin zero-match sample renders as one qualified expertise status with a direct Invite action', async () => {
  const user = userEvent.setup();
  const onAddToInvite = jest.fn();
  const { container } = render(
    <CandidateCard
      candidate={{
        ...QUICK_CHECK,
        name: 'Peter Reiners',
        email: 'reiners@arizona.edu',
        emailSource: 'institution_page',
        orcidUrl: 'https://orcid.org/0000-0002-0000-0000',
        verificationConfidence: 0,
        expertiseMismatch: true,
        expertiseAreas: ['(U-Th)/He geochronology', 'helium diffusion and retention'],
        publications: [
          { title: 'Paper one', year: 2025 },
          { title: 'Paper two', year: 2024 },
          { title: 'Paper three', year: 2023 },
        ],
        reasoning: 'His work addresses the proposal risk.',
      }}
      checked={false}
      onToggle={() => {}}
      onAddToInvite={onAddToInvite}
    />,
  );

  expect(screen.getByText(/0 of 3 retrieved papers matched the stated expertise/)).toBeInTheDocument();
  expect(screen.getByText(/not this person's full publication record/)).toBeInTheDocument();
  expect(screen.getByText(/Suggested because:/).parentElement).toHaveTextContent('His work addresses the proposal risk.');
  expect(screen.getByText(/Evidence includes high-confidence email \+ ORCID/)).toBeInTheDocument();
  expect(screen.queryByText(/0%|Low match|Expertise mismatch|Claude claimed/)).not.toBeInTheDocument();
  expect(container.firstChild).toHaveClass('bg-white');

  await user.click(screen.getByRole('button', { name: 'Add Peter Reiners to Invite' }));
  expect(onAddToInvite).toHaveBeenCalledTimes(1);
});
