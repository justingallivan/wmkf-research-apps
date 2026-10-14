/** @jest-environment jsdom */
import React, { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AssessmentWorkflow, { AssessmentList } from '../../shared/components/proposal-ranking/AssessmentWorkflow';
import {
  createOperationId,
  loadProposalRanking,
  sendProposalRankingAction,
} from '../../shared/components/proposal-ranking/client';
jest.mock('../../shared/components/proposal-ranking/client', () => ({
  createOperationId: jest.fn(() => 'operation'),
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
test('private MR and SE lists render their subsets and saving SE keeps it selected', async () => {
  const initial = view();
  initial.round.snapshot.proposals = ['mr', 'se'].map((programKey) => ({
    requestId: programKey,
    programKey,
    organization: `${programKey} institution`,
    amountMinorUnits: 10000,
    currency: { code: 'USD', precision: 2 },
  }));
  for (const program of ['mr', 'se']) {
    initial.own[program] = { ...list, order: [program], boundaries: [1, 1] };
  }
  initial.own.co = null;
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  expect(screen.getByRole('heading', { name: 'mr institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'se institution' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  expect(screen.getByRole('heading', { name: 'se institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'mr institution' })).toBeNull();
  sendProposalRankingAction.mockResolvedValue({
    ...initial,
    own: { ...initial.own, se: { ...initial.own.se, confidence: { se: 'confident' }, version: 2 } },
  });
  fireEvent.click(screen.getByRole('radio', { name: 'Confident' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));
  expect(screen.getByRole('heading', { name: 'se institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'mr institution' })).toBeNull();
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

const proposals = ['one', 'two', 'three', 'four'].map((id, i) => ({
  requestId: id, requestNumber: i + 1, organization: `Institution ${id}`,
  title: `Proposal ${id}`, programKey: i < 2 ? 'mr' : 'se',
  amountMinorUnits: 10000, currency: { code: 'USD', precision: 2 },
}));
function populatedView() {
  const initial = view();
  initial.round.snapshot.proposals = proposals;
  initial.own.mr = { ...list, order: ['one', 'two'], boundaries: [1, 2] };
  initial.own.se = { ...list, order: ['three', 'four'], boundaries: [1, 2] };
  initial.own.co = null;
  return initial;
}

test('divider validation rejects crossing, empty and fractional values with a recoverable error', () => {
  const onChange = jest.fn();
  render(<AssessmentList assessment={{ ...list, order: proposals.map((p) => p.requestId), boundaries: [1, 3] }} proposals={proposals} roster={[]} editable onChange={onChange} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Set boundary…' })[0]);
  const input = screen.getByRole('spinbutton');
  expect(input.max).toBe('3');
  for (const value of ['4', '', '1.5']) {
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toMatch(/whole number from 0 to 3/);
  }
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ boundaries: [0, 3] }));
});

test('second divider advertises the first divider as minimum and permits an empty middle section', () => {
  const onChange = jest.fn();
  render(<AssessmentList assessment={{ ...list, order: proposals.map((p) => p.requestId), boundaries: [1, 3] }} proposals={proposals} roster={[]} editable onChange={onChange} />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Set boundary…' })[1]);
  const input = screen.getByRole('spinbutton');
  expect(input.min).toBe('1');
  fireEvent.change(input, { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ boundaries: [1, 1] }));
});

test('Find stays in the active program, announces missing results and cycles matching cards with focus', () => {
  Element.prototype.scrollIntoView = jest.fn();
  render(<AssessmentWorkflow initial={populatedView()} cycleOptions={[]} onCycleChange={() => {}} />);
  const find = screen.getByRole('textbox', { name: 'Find proposal' });
  fireEvent.change(find, { target: { value: 'three' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  expect(screen.getByText(/No matching proposal in this list/)).toBeTruthy();
  expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  fireEvent.change(find, { target: { value: 'Institution' } });
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  expect(document.activeElement.id).toBe('proposal-one');
  expect(screen.getByText(/Match 1 of 2/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Find', exact: true }));
  expect(document.activeElement.id).toBe('proposal-two');
  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  expect(screen.queryByText(/Match 2 of 2/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Science & Engineering' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Medical Research' }).getAttribute('aria-pressed')).toBe('false');
});

test('unconfirmed saves explain recovery and retry the same operation rather than a new edit', async () => {
  const initial = populatedView();
  createOperationId.mockReturnValueOnce('first-operation').mockReturnValue('new-operation');
  sendProposalRankingAction.mockRejectedValueOnce(new Error('Connection interrupted'));
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  fireEvent.click(screen.getAllByRole('radio', { name: 'Not sure' })[0]);
  await screen.findByRole('button', { name: 'Check and retry change' });
  expect(screen.getByText(/Your local change is kept here/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(true);
  const original = sendProposalRankingAction.mock.calls[0][0];
  sendProposalRankingAction.mockResolvedValueOnce({ ...initial, own: { ...initial.own, mr: { ...initial.own.mr, confidence: { one: 'not-sure' } } } });
  fireEvent.click(screen.getByRole('button', { name: 'Check and retry change' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));
  expect(sendProposalRankingAction.mock.calls[1][0]).toEqual(original);
  expect(createOperationId).toHaveBeenCalledTimes(1);
});
