/** @jest-environment jsdom */
import React, { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssessmentWorkflow from '../../shared/components/proposal-ranking/AssessmentWorkflow';
import {
  loadProposalRanking,
  sendProposalRankingAction,
} from '../../shared/components/proposal-ranking/client';
jest.mock('../../shared/components/proposal-ranking/client', () => ({
  createOperationId: () => 'operation',
  loadProposalRanking: jest.fn(),
  sendProposalRankingAction: jest.fn(),
}));
jest.mock('../../shared/components/Layout', () => ({
  Button: ({ children, variant, size, ...props }) => (
    <button {...props}>{children}</button>
  ),
}));
const list = { order: [], boundaries: [0, 0], confidence: {}, version: 1 };
const view = () => ({
  mode: 'round',
  workflowVersion: 2,
  roundId: 'round',
  cycleCode: 'J27',
  viewer: { isFacilitator: true, systemUserId: 'alice' },
  round: {
    etag: '1',
    state: 'active',
    policyRevision: 1,
    snapshot: {
      proposals: [],
      roster: [{ systemUserId: 'alice', name: 'Alice' }],
    },
  },
  workflow: { stage: 'private', preparationVersion: 1, revealId: null },
  own: {
    mr: list,
    se: list,
    co: { ...list, sourceVersions: { mr: 1, se: 1 }, confirmed: true },
    ready: null,
  },
  collective: null,
  progress: [],
  confirmations: {
    restartWalkthrough: { fingerprint: 'fp', message: 'Start again?' },
  },
});
beforeEach(() => {
  jest.clearAllMocks();
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
test('StrictMode refresh resolves and re-enables controls', async () => {
  loadProposalRanking.mockResolvedValue(view());
  render(
    <StrictMode>
      <AssessmentWorkflow
        initial={view()}
        cycleOptions={[{ code: 'J27', label: 'J27' }]}
        onCycleChange={() => {}}
      />
    </StrictMode>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(loadProposalRanking).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(
      false,
    ),
  );
  expect(screen.getByRole('status').textContent).toBe('All changes saved');
});
test('restart while combined is selected returns to source preparation without dereferencing absent combined', async () => {
  const next = view();
  next.roundId = 'new-round';
  next.own.co = null;
  sendProposalRankingAction.mockResolvedValue(next);
  render(
    <AssessmentWorkflow
      initial={view()}
      cycleOptions={[{ code: 'J27', label: 'J27' }]}
      onCycleChange={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Combined list' }));
  fireEvent.click(screen.getByText('Round controls'));
  fireEvent.click(screen.getByRole('button', { name: 'Restart walkthrough' }));
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Restart walkthrough' }).at(-1),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create combined list' }),
    ).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: 'Combined list' }).disabled).toBe(
    true,
  );
});
