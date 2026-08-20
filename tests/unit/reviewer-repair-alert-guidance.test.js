/** @jest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react';
import ReviewerRepairAlertDetails from '../../shared/components/admin/ReviewerRepairAlertDetails';
import { CandidateCard } from '../../shared/components/reviewers/ReviewerSearchSection';
import ReviewerInvitePanel from '../../shared/components/reviewers/ReviewerInvitePanel';

const alert = {
  id: 491,
  message: 'Staff requested reviewer identity/address repair.',
  metadata: {
    requestId: 'request-guid',
    candidateKey: 'candidate:reviewer',
    candidateName: 'Reviewer Name',
    code: 'address_conflict_pending',
  },
};

beforeEach(() => {
  Element.prototype.scrollIntoView = jest.fn();
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({
      context: {
        request: { id: 'request-guid', number: '1000001', title: 'Repair test request' },
        reviewer: {
          candidateKey: 'candidate:reviewer',
          name: 'Reviewer Name',
          affiliation: 'Example University',
        },
        issue: {
          code: 'address_conflict_pending',
          status: 'conflict_pending',
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@lab.example.edu',
          source: 'scholarly_multi',
          detectedAt: '2026-08-20T20:00:00.000Z',
          recommendedAction: 'review_address_conflict',
        },
        evidenceLinks: [{ label: 'Institution profile', url: 'https://example.edu/reviewer' }],
        workbenchUrl: '/workbench/request-guid?tab=reviewers&sub=find&repairCandidate=candidate%3Areviewer',
      },
    }),
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders the repair decision context and explicit closeout sequence', async () => {
  render(<ReviewerRepairAlertDetails alert={alert} />);

  expect(await screen.findByText('Request 1000001')).toBeInTheDocument();
  expect(screen.getByText('stored@example.edu')).toBeInTheDocument();
  expect(screen.getByText('found@lab.example.edu')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Institution profile' })).toHaveAttribute(
    'href',
    'https://example.edu/reviewer',
  );
  expect(screen.getByText(/Resolve this alert only after/)).toBeInTheDocument();
  expect(screen.getByText(/choose Review address conflict/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open reviewer in Workbench/ })).toHaveAttribute(
    'href',
    expect.stringContaining('repairCandidate='),
  );
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/admin/alerts?repairContext=491',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

test('an unresolved-identity conflict directs staff to Confirm identity without creating another repair request', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      context: {
        request: { id: 'request-guid', number: '1000001', title: 'Repair test request' },
        reviewer: {
          candidateKey: 'candidate:reviewer',
          name: 'Reviewer Name',
          affiliation: 'Example University',
        },
        issue: {
          code: 'address_conflict_pending',
          status: 'conflict_pending',
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@lab.example.edu',
          recommendedAction: 'confirm_identity',
        },
        evidenceLinks: [],
        warnings: [],
        workbenchSurface: 'find',
        workbenchUrl: '/workbench/request-guid?tab=reviewers&sub=find&repairCandidate=candidate%3Areviewer',
      },
    }),
  });

  render(<ReviewerRepairAlertDetails alert={alert} />);

  expect(await screen.findByText(/choose Confirm identity/)).toBeInTheDocument();
  expect(screen.getByText(/Do not create another repair request/)).toBeInTheDocument();
  expect(screen.queryByText(/choose Review address conflict/)).not.toBeInTheDocument();
});

test('an unknown conflict action falls back without naming an unavailable control', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      context: {
        request: { id: 'request-guid', number: '1000001', title: 'Repair test request' },
        reviewer: { candidateKey: 'candidate:reviewer', name: 'Reviewer Name' },
        issue: {
          code: 'address_conflict_pending',
          status: 'conflict_pending',
          storedEmail: 'stored@example.edu',
          foundEmail: 'found@lab.example.edu',
          recommendedAction: 'future_action',
        },
        evidenceLinks: [],
        warnings: [],
        workbenchSurface: 'find',
        workbenchUrl: '/workbench/request-guid?tab=reviewers&sub=find&repairCandidate=candidate%3Areviewer',
      },
    }),
  });

  render(<ReviewerRepairAlertDetails alert={alert} />);

  expect(await screen.findByText(/use the primary repair or retry action shown on the card/)).toBeInTheDocument();
  expect(screen.queryByText(/choose Confirm identity/)).not.toBeInTheDocument();
  expect(screen.queryByText(/choose Review address conflict/)).not.toBeInTheDocument();
});

test('a sparse historical alert keeps a safe identifier-based fallback when refresh fails', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ error: 'Current reviewer repair context not found' }),
  });

  render(<ReviewerRepairAlertDetails alert={alert} />);

  expect(await screen.findByText(/Current details could not be refreshed/)).toBeInTheDocument();
  expect(screen.getByText('Request request-guid')).toBeInTheDocument();
  expect(screen.getAllByText(/Reviewer Name/).length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: /Open reviewer in Workbench/ })).toHaveAttribute(
    'href',
    expect.stringContaining('repairCandidate=candidate%3Areviewer'),
  );
});

test('a sparse Invite-origin alert preserves its suggestion deep link when refresh fails', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({ error: 'Current reviewer repair context not found' }),
  });
  const inviteAlert = {
    ...alert,
    metadata: {
      ...alert.metadata,
      candidateKey: 'suggestion:suggestion-guid',
      suggestionId: 'suggestion-guid',
      repairSurface: 'invite',
    },
  };

  render(<ReviewerRepairAlertDetails alert={inviteAlert} />);

  expect(await screen.findByText(/Current details could not be refreshed/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open reviewer in Invite Reviewers/ })).toHaveAttribute(
    'href',
    expect.stringContaining('sub=candidates&repairSuggestion=suggestion-guid'),
  );
});

test('a cleared conflict tells the administrator to close the alert instead of repairing again', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      context: {
        request: { id: 'request-guid', number: '1000001', title: 'Repair test request' },
        reviewer: { candidateKey: 'candidate:reviewer', name: 'Reviewer Name' },
        issue: {
          code: 'address_conflict_pending',
          status: 'ready_to_close',
          storedEmail: 'stored@example.edu',
          foundEmail: 'stored@example.edu',
        },
        evidenceLinks: [],
        warnings: [],
        workbenchSurface: 'find',
        workbenchUrl: '/workbench/request-guid?tab=reviewers&sub=find&repairCandidate=candidate%3Areviewer',
      },
    }),
  });

  render(<ReviewerRepairAlertDetails alert={alert} />);

  expect(await screen.findByText(/alert is ready for an administrator to close/)).toBeInTheDocument();
  expect(screen.getByText(/No additional reviewer change is required/)).toBeInTheDocument();
  expect(screen.queryByText(/underlying identity or address record needs repair/)).not.toBeInTheDocument();
});

test('repair attention scrolls to and highlights the matching reviewer card', async () => {
  const { container } = render(
    <CandidateCard
      candidate={{
        name: 'Reviewer Name',
        affiliation: 'Example University',
        email: 'reviewer@example.edu',
        identityStatus: 'confirmed',
        pdIdentityConfirmed: true,
        publications: [],
      }}
      checked={false}
      onToggle={jest.fn()}
      repairAttention
    />,
  );

  const card = container.querySelector('[data-repair-target="true"]');
  expect(card).toHaveClass('ring-2', 'ring-amber-400');
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'center',
  }));
});

test('the unresolved conflict card exposes Confirm identity and suppresses direct address review', () => {
  render(
    <CandidateCard
      candidate={{
        name: 'Reviewer Name',
        affiliation: 'Example University',
        email: 'found@lab.example.edu',
        emailSource: 'scholarly_multi',
        identityStatus: 'unresolved',
        addressConflictPending: true,
        publications: [],
      }}
      readOnly
      onRequestRepair={jest.fn()}
      onReviewAddressConflict={jest.fn()}
      onConfirmIdentity={jest.fn()}
    />,
  );

  expect(screen.getByRole('button', { name: 'Confirm identity for Reviewer Name' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Review address conflict for Reviewer Name' })).not.toBeInTheDocument();
});

test('Invite-origin repair attention highlights the saved reviewer and exposes the repair action', async () => {
  const { container } = render(
    <ReviewerInvitePanel
      requestId="request-guid"
      candidates={[{
        suggestionId: 'suggestion-guid',
        name: 'Saved Reviewer',
        email: 'saved@example.edu',
        affiliation: 'Example University',
      }]}
      repairSuggestionId="suggestion-guid"
    />,
  );

  expect(container.querySelector('[data-repair-target="true"]')).toHaveClass('ring-2', 'ring-amber-400');
  expect(screen.getByRole('button', { name: 'Review repair' })).toBeInTheDocument();
  await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
    behavior: 'smooth',
    block: 'center',
  }));
});
