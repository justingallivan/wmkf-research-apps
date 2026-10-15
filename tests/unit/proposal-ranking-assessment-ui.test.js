/** @jest-environment jsdom */
import Router from 'next/router';
import React, { StrictMode } from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AssessmentWorkflow, { AssessmentList } from '../../shared/components/proposal-ranking/AssessmentWorkflow';
import { initialPreparation } from '../../lib/services/proposal-ranking/workflow';
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
jest.mock('next/router', () => ({ __esModule: true, default: { router: null, asPath: '/ranking', beforePopState: jest.fn(), events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } } }));
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
function saved(base, body) {
  const next = JSON.parse(JSON.stringify(base));
  next.own[body.programKey] = { ...next.own[body.programKey], ...body.assessment, version: body.listVersion + 1 };
  if (next.own.co) next.own.co.confirmed = false;
  next.operation = { status: 'confirmed', operationId: body.operationId };
  return next;
}
beforeEach(() => {
  jest.resetAllMocks();
  Router.router = null;
  window.history.replaceState(null, "", "/");
  createOperationId.mockReturnValue("operation");
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
  expect(screen.queryByRole('button', { name: 'Create combined list' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Medical Research' }).textContent).toContain('Not started');
  expect(screen.getByRole('heading', { name: 'mr institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'se institution' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  expect(screen.getByRole('heading', { name: 'se institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'mr institution' })).toBeNull();
  let current = initial;
  sendProposalRankingAction.mockImplementation(async body => (current = saved(current, body)));
  fireEvent.click(screen.getByRole('radio', { name: 'Confident' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));
  expect(screen.getByRole('heading', { name: 'se institution' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'mr institution' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Science & Engineering' }).textContent).toContain('All confidence choices answered');
  expect(screen.queryByRole('button', { name: 'Create combined list' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Continue to Medical Research →' })[0]);
  expect(screen.getByRole('heading', { name: 'mr institution' })).toBeTruthy();
  fireEvent.click(screen.getByRole('radio', { name: 'Confident' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Create combined list' })[0].disabled).toBe(false));
  expect(screen.queryByRole('button', { name: /Continue to/ })).toBeNull();
  expect(screen.getByText('You can keep editing, or create your combined list. Only Ready marks your preparation finished.')).toBeTruthy();
});
test('fresh preparation leaves every MR and SE confidence choice unselected', () => {
  const initial = view();
  initial.round.snapshot.version = 2;
  initial.round.snapshot.proposals = [
    { requestId: 'mr-1', programKey: 'mr', organization: 'MR institution', amountMinorUnits: 10000, currency: { code: 'USD', precision: 2 } },
    { requestId: 'se-1', programKey: 'se', organization: 'SE institution', amountMinorUnits: 10000, currency: { code: 'USD', precision: 2 } },
  ];
  initial.round.snapshot.seedOrders = { mr: ['mr-1'], se: ['se-1'] };
  initial.own = initialPreparation(initial.round.snapshot).participants.alice;

  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);

  const expectCurrentConfidenceUnselected = () => {
    const confidenceChoices = screen.getAllByRole('radio');
    expect(confidenceChoices).toHaveLength(2);
    expect(confidenceChoices.every(choice => !choice.checked)).toBe(true);
  };
  expect(screen.getByRole('heading', { name: 'MR institution' })).toBeTruthy();
  expectCurrentConfidenceUnselected();

  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  expect(screen.getByRole('heading', { name: 'SE institution' })).toBeTruthy();
  expectCurrentConfidenceUnselected();

  fireEvent.click(screen.getByRole('button', { name: 'Medical Research' }));
  expect(screen.getByRole('heading', { name: 'MR institution' })).toBeTruthy();
  expectCurrentConfidenceUnselected();
  expect(sendProposalRankingAction).not.toHaveBeenCalled();
  expect(screen.getByText('Choose one')).toBeTruthy();
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
  expect(screen.queryByRole('button', { name: 'Combined list' })).toBeNull();
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

test('a changed completed source list routes back to rebuilding and confirming the combined list', async () => {
  const initial = populatedView();
  for (const key of ['mr', 'se']) {
    initial.own[key] = { ...initial.own[key], confidence: Object.fromEntries(initial.own[key].order.map(id => [id, 'confident'])) };
  }
  initial.own.co = {
    ...list,
    order: proposals.map(({ requestId }) => requestId),
    boundaries: [1, 3],
    confidence: Object.fromEntries(proposals.map(({ requestId }) => [requestId, 'confident'])),
    sourceVersions: { mr: initial.own.mr.version, se: initial.own.se.version },
    confirmed: true,
  };
  initial.confirmations.buildCombined = { fingerprint: 'build-fp', message: 'Replace the combined order?' };

  let current = initial;
  sendProposalRankingAction.mockImplementation(async body => {
    current = JSON.parse(JSON.stringify(current));
    if (body.action === 'saveAssessment') {
      current = saved(current, body);
    } else if (body.action === 'buildCombined') {
      current.own.co.sourceVersions = { mr: current.own.mr.version, se: current.own.se.version };
      current.own.co.version++;
      current.own.co.confirmed = false;
      current.operation = { status: 'confirmed', operationId: body.operationId };
    } else if (body.action === 'confirmCombined') {
      current.own.co.confirmed = true;
      current.operation = { status: 'confirmed', operationId: body.operationId };
    } else if (body.action === 'ready') {
      current.own.ready = { combinedVersion: current.own.co.version, operationId: body.operationId };
      current.operation = { status: 'confirmed', operationId: body.operationId };
    }
    return current;
  });

  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  expect(screen.queryByText(/rebuild it from your latest assessments/i)).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset SE preparation' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Review combined list →' })[0]);
  expect(screen.getByRole('button', { name: 'Ready' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Reset SE preparation' })).toBeNull();
  expect(sendProposalRankingAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Science & Engineering' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Set boundary…' })[0]);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));

  expect(screen.getByText(/rebuild the combined list from your latest assessments/i)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Combined list' }).textContent).toContain('Needs rebuild');
  expect(screen.queryByRole('button', { name: 'Review combined list →' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset SE preparation' })).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Rebuild combined list' })[0]);
  expect(sendProposalRankingAction).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'buildCombined' }), expect.anything());
  expect(screen.getByText('Replace the combined order?')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Build combined list' }));
  expect(sendProposalRankingAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'buildCombined', confirmationFingerprint: 'build-fp' }), expect.anything());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm combined order' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Reset SE preparation' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm combined order' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ready' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Ready' }));
  await waitFor(() => expect(screen.getByText('Ready for group discussion')).toBeTruthy());
});

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
  sendProposalRankingAction.mockImplementationOnce(async body => saved(initial, body));
  fireEvent.click(screen.getByRole('button', { name: 'Check and retry change' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));
  expect(sendProposalRankingAction.mock.calls[1][0]).toEqual(original);
  expect(createOperationId).toHaveBeenCalledTimes(1);
});

test('group cards keep assessments attached to each PD when lead-first display order changes', () => {
  const proposal = { requestId: 'p', requestNumber: '2026-041', organization: 'Example University', title: 'Example research', leadSystemUserId: 'morgan', programKey: 'mr', institutionGeography: 'West', amountMinorUnits: 120000, currency: { code: 'USD', precision: 2 }, score: { distribution: { Excellent: 1, Fair: 1 }, average: 3 }, researchFunding: { status: 'available', qualifyingGrantCount: 2, latestAwardYear: 2023, totalAmountMinorUnits: 250000000 } };
  const individuals = [
    { systemUserId: 'dana', name: 'Dana Smith', order: ['p'], boundaries: [0, 0], confidence: { p: 'confident' } },
    { systemUserId: 'alex', name: 'Alex Jones', order: ['p'], boundaries: [1, 1], confidence: { p: 'confident' } },
    { systemUserId: 'morgan', name: 'Morgan Brown', order: ['p'], boundaries: [0, 1], confidence: { p: 'not-sure' } },
  ];
  const assessment = { order: ['p'], boundaries: [1, 1], confidence: {} };
  const { container, rerender } = render(<AssessmentList assessment={assessment} proposals={[proposal]} roster={[]} collective={{ individuals, baseline: { scores: { p: { averageRank: 1 } } } }} editable={false} onChange={jest.fn()} />);
  const judgments = [...container.querySelectorAll('[aria-label*="grade "]')];
  expect(judgments.map((node) => node.getAttribute('aria-label'))).toEqual([
    'Morgan Brown, lead PD: grade B, not sure', 'Alex Jones: grade A, confident', 'Dana Smith: grade C, confident',
  ]);
  expect(judgments[0].querySelector('span').className).toContain('border-dashed');
  expect(judgments[1].querySelector('span').className).toContain('border-solid');
  expect(screen.getByText('Morgan').className).toContain('underline');
  expect(screen.queryByText(/Cumulative requested|Grades differ|Lead:/)).toBeNull();
  expect(screen.getByText('Morgan Brown: #1').closest('details').open).toBe(false);
  expect(screen.getByText('$2,500,000.00').closest('details').open).toBe(false);
  expect(screen.getByText('Recommended')).toBeTruthy();
  expect(screen.getByText('East 0 · West 1')).toBeTruthy();
  expect(screen.getAllByText('$1,200.00')).toHaveLength(2); // Requested and cutoff only.
  delete proposal.researchFunding.totalAmountMinorUnits;
  rerender(<AssessmentList assessment={assessment} proposals={[proposal]} roster={[]} collective={{ individuals, baseline: { scores: { p: { averageRank: 1 } } } }} editable={false} onChange={jest.fn()} />);
  expect(screen.queryByText('$2,500,000.00')).toBeNull();
  expect(screen.getByText(/Total Research funding:/).textContent).toBe('Total Research funding: Not available');
});

test('private grade border follows confidence and leaves unanswered confidence unmarked', () => {
  const assessment = { ...list, order: ['one'], boundaries: [1, 1], confidence: {} };
  const props = { proposals: [proposals[0]], roster: [], editable: true, onChange: jest.fn() };
  const { container, rerender } = render(<AssessmentList {...props} assessment={assessment} />);
  const tile = () => container.querySelector('fieldset > span');
  expect(tile().className).toContain('border-transparent');
  rerender(<AssessmentList {...props} assessment={{ ...assessment, confidence: { one: 'not-sure' } }} />);
  expect(tile().className).toContain('border-dashed');
  rerender(<AssessmentList {...props} assessment={{ ...assessment, confidence: { one: 'confident' } }} />);
  expect(tile().className).toContain('border-solid');
});


test('unanswered navigation follows current order, wraps, and skips saved choices', async () => {
  Element.prototype.scrollIntoView = jest.fn();
  const initial = populatedView();
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  expect(screen.getByText('2 proposals need a confidence choice')).toBeTruthy();
  const jump = screen.getByRole('button', { name: 'Go to next unanswered' });
  fireEvent.click(jump);
  expect(document.activeElement.name).toBe('confidence-one');
  fireEvent.click(jump);
  expect(document.activeElement.name).toBe('confidence-two');
  fireEvent.click(jump);
  expect(document.activeElement.name).toBe('confidence-one');
  sendProposalRankingAction.mockImplementation(async body => saved(initial, body));
  fireEvent.click(document.activeElement);
  await waitFor(() => expect(screen.getByText('1 proposal needs a confidence choice')).toBeTruthy());
  await waitFor(() => expect(jump.disabled).toBe(false));
  fireEvent.click(jump);
  expect(document.activeElement.name).toBe('confidence-two');
  expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' });
});


test.each(['confident', 'not-sure'])('Continue preserves saved %s and identifies missing cards without submitting', confidence => {
  Element.prototype.scrollIntoView = jest.fn();
  const initial = populatedView();
  initial.own.mr.confidence = { one: confidence };
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  const savedChoices = document.getElementById('proposal-one').querySelectorAll('input[type=radio]');
  expect(Array.from(savedChoices, choice => choice.checked)).toEqual([confidence === 'confident', confidence === 'not-sure']);
  const freshChoices = document.getElementById('proposal-two').querySelectorAll('input[type=radio]');
  expect(Array.from(freshChoices, choice => choice.checked)).toEqual([false, false]);
  fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
  expect(screen.getByRole('alert').textContent).toContain('Institution two');
  expect(screen.getByRole('alert').textContent).not.toContain('Institution one');
  expect(document.getElementById('proposal-two').className).toContain('ring-red-600');
  expect(document.getElementById('proposal-one').className).not.toContain('ring-red-600');
  expect(document.activeElement.name).toBe('confidence-two');
  expect(sendProposalRankingAction).not.toHaveBeenCalled();
});


test('uncertain rebased save retries the exact final operation supplied by the client', async () => {
  const initial = populatedView();
  let rebased;
  sendProposalRankingAction.mockImplementationOnce(async (body, options) => {
    expect(options.baseView).toBe(initial);
    rebased = { ...body, operationId: 'rebased-operation', roundEtag: 'new-round' };
    throw Object.assign(new Error('Outcome uncertain'), { pendingAction: rebased });
  });
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  fireEvent.click(screen.getAllByRole('radio', { name: 'Not sure' })[0]);
  await screen.findByRole('button', { name: 'Check and retry change' });
  sendProposalRankingAction.mockImplementationOnce(async body => saved(initial, body));
  fireEvent.click(screen.getByRole('button', { name: 'Check and retry change' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('All changes saved'));
  expect(sendProposalRankingAction.mock.calls[1][0]).toEqual(rebased);
});

test('confidence stays interactive while a move saves, coalesces later choices and guards leaving', async () => {
  const initial = populatedView();
  const pending = [];
  sendProposalRankingAction.mockImplementation(body => new Promise(resolve => pending.push({ body, resolve })));
  render(<StrictMode><AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} /></StrictMode>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Set boundary…' })[0]);
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move', exact: true }));
  expect(pending).toHaveLength(1);
  const started = performance.now();
  fireEvent.click(screen.getAllByRole('radio', { name: 'Confident' })[0]);
  fireEvent.click(screen.getAllByRole('radio', { name: 'Not sure' })[1]);
  expect(performance.now() - started).toBeLessThan(200);
  expect(screen.getAllByRole('radio', { name: 'Confident' })[0].checked).toBe(true);
  expect(screen.getAllByRole('radio', { name: 'Not sure' })[1].checked).toBe(true);
  expect(pending).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Refresh' }).disabled).toBe(true);
  expect(screen.getByRole('button', { name: 'Science & Engineering' }).disabled).toBe(true);
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  const guard = Router.events.on.mock.calls.filter(([name]) => name === 'routeChangeStart').at(-1)[1];
  expect(() => guard('/apps', {})).toThrow('Unsaved ranking preparation');
  const first = saved(initial, pending[0].body);
  await act(async () => pending[0].resolve(first));
  expect(pending).toHaveLength(2);
  expect(pending[1].body.assessment).toEqual({ order: ['one', 'two'], boundaries: [0, 2], confidence: { one: 'confident', two: 'not-sure' } });
  expect(pending[1].body.listVersion).toBe(2);
  await act(async () => pending[1].resolve(saved(first, pending[1].body)));
  expect(screen.getByRole('status').textContent).toBe('All changes saved');
  expect(() => guard('/apps', {})).not.toThrow();
});

test('keyboard drop keeps its drag handle and confidence usable while saving', async () => {
  const initial = populatedView();
  sendProposalRankingAction.mockImplementation(() => new Promise(() => {}));
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  const handle = screen.getByRole('button', { name: 'Move Institution one, position 1' });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await waitFor(() => expect(sendProposalRankingAction).toHaveBeenCalledTimes(1));
  expect(document.activeElement).toBe(handle);
  expect(handle.isConnected).toBe(true);
  const confidence = screen.getAllByRole('radio', { name: 'Confident' })[0];
  confidence.focus();
  fireEvent.click(confidence);
  expect(confidence.checked).toBe(true);
  expect(document.activeElement).toBe(confidence);
  expect(sendProposalRankingAction).toHaveBeenCalledTimes(1);
});

test('loading a previous run locks preparation until its response arrives', async () => {
  const initial = populatedView();
  sendProposalRankingAction.mockResolvedValueOnce({ entries: [], before: null, previousRoundId: 'previous' });
  let resolve;
  loadProposalRanking.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  const open = await screen.findByRole('button', { name: 'Open previous run' });
  fireEvent.click(open);
  expect(screen.getByRole('button', { name: 'My preparation' }).disabled).toBe(true);
  const previous = { ...initial, roundId: 'previous', round: { ...initial.round, state: 'closed' } };
  await act(async () => resolve(previous));
  expect(screen.getByText(/Read-only historical run/)).toBeTruthy();
});

test('a normal save acknowledgement during a keyboard drag does not cancel the drop', async () => {
  const initial = populatedView();
  const pending = [];
  sendProposalRankingAction.mockImplementation(body => new Promise(resolve => pending.push({ body, resolve })));
  render(<AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} />);
  fireEvent.click(screen.getAllByRole('radio', { name: 'Confident' })[0]);
  const handle = screen.getByRole('button', { name: 'Move Institution one, position 1' });
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  await act(async () => pending[0].resolve(saved(initial, pending[0].body)));
  fireEvent.keyDown(handle, { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 });
  fireEvent.keyDown(handle, { key: ' ', code: 'Space', keyCode: 32 });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(pending[1].body.listVersion).toBe(2);
  expect(pending[1].body.assessment.confidence.one).toBe('confident');
  expect(pending[1].body.assessment.boundaries).not.toEqual(initial.own.mr.boundaries);
});

test('dirty history restores Next metadata and suite links wait until the queue drains', async () => {
  Router.router = {};
  const metadata = { __N: true, url: '/ranking', as: '/ranking', key: 'ranking-key', options: {} };
  window.history.replaceState(metadata, '', '/ranking');
  let resolve, body;
  sendProposalRankingAction.mockImplementation(request => { body = request; return new Promise(r => { resolve = r; }); });
  const initial = populatedView();
  render(<><a href="/other">Suite destination</a><AssessmentWorkflow initial={initial} cycleOptions={[]} onCycleChange={() => {}} /></>);
  fireEvent.click(screen.getAllByRole('radio', { name: 'Confident' })[0]);
  expect(fireEvent.click(screen.getByRole('link', { name: 'Suite destination' }))).toBe(false);
  const pop = Router.beforePopState.mock.calls[0][0];
  window.history.replaceState({ __N: true, url: '/other' }, '', '/other');
  act(() => expect(pop()).toBe(false));
  expect(window.location.pathname).toBe('/ranking'); expect(window.history.state).toEqual(metadata);
  await act(async () => resolve(saved(initial, body)));
  expect(pop()).toBe(true);
  expect(screen.queryByText(/Finish saving or resolve/)).toBeNull();
});
