/**
 * @jest-environment jsdom
 *
 * Clickable warning badges on the candidate card (S403, owner report
 * 2026-08-06): "⚠ Email needs confirmation" and the sibling warning pills were
 * inert text, while the remedy ("Verify / edit address", "This is the right
 * person") sat low in the card and read as decoration — the owner reported the
 * link as hard to see. Each warning now routes to the SAME remedy the card
 * already offers.
 *
 * The load-bearing property is fail-closed parity: a badge is clickable only
 * when its remedy control would itself render (canManage, resolved identity,
 * conflict record available). No readiness or address-trust semantics are
 * decided by the badge — it is routing only
 * (`project-reviewer-verify-fail-dangerous`).
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CandidateCard } from '../../shared/components/reviewers/ReviewerSearchSection';

// Reproduces the reported card: identity resolved (so the row is past identity
// review) but a legacy single-publication PubMed address ⇒
// emailReadiness.action === 'quick_check' ⇒ both "⚠ Email needs confirmation"
// and "⚠ Address verification required" render.
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
  render(
    <CandidateCard
      candidate={{ ...QUICK_CHECK, ...overrides }}
      checked={false}
      onToggle={() => {}}
      onEdit={onEdit}
      onConfirmIdentity={onConfirmIdentity}
      {...props}
    />,
  );
  return { onEdit, onConfirmIdentity };
}

afterEach(() => {
  jest.clearAllMocks();
});

test('"Email needs confirmation" is a button that opens the verify/edit address remedy', async () => {
  const user = userEvent.setup();
  const { onEdit } = renderCard();

  const badge = screen.getByRole('button', { name: /Email needs confirmation/ });
  await user.click(badge);

  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit.mock.calls[0][0].name).toBe('Alexander Green');
});

test('"Address verification required" pill opens the same remedy', async () => {
  const user = userEvent.setup();
  const { onEdit } = renderCard();

  await user.click(screen.getByRole('button', { name: /Address verification required/ }));
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

  await user.click(screen.getByRole('button', { name: '⛔ Address conflict' }));
  expect(onReviewAddressConflict).toHaveBeenCalledTimes(1);
  expect(onEdit).not.toHaveBeenCalled();
});

test('read-only (canManage=false) leaves the warning as inert text — no dead action offered', () => {
  renderCard({}, { canManage: false });

  expect(screen.getByText(/Email needs confirmation/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Email needs confirmation/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Address verification required/ })).toBeNull();
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

test('"Existing linked reviewer record needs repair" banner opens the repair remedy', async () => {
  const user = userEvent.setup();
  const onRequestRepair = jest.fn();
  render(
    <CandidateCard
      candidate={{ ...QUICK_CHECK, applicantKnownReviewer: { status: 'inactive' } }}
      checked={false}
      onToggle={() => {}}
      onRequestRepair={onRequestRepair}
    />,
  );

  await user.click(screen.getByRole('button', { name: /needs repair/ }));
  expect(onRequestRepair).toHaveBeenCalledTimes(1);
});

test('a ready email chip stays a plain, non-clickable chip', () => {
  renderCard({ emailSource: 'orcid' });

  expect(screen.getByText(/High-confidence email/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /High-confidence email/ })).toBeNull();
});
