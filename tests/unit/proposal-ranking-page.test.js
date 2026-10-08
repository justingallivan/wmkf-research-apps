import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProposalRankingApp from '../../shared/components/proposal-ranking/ProposalRankingApp';
import { buildCumulativeTotals, formatMoney, formatScore, moveProposal, pdRankColor, reviewerScoreIndicator } from '../../shared/components/proposal-ranking/model';
import { conventionalCycles, resolveWorkingCycle } from '../../lib/utils/cycle-code';

async function dragDown(handle) {
  handle.focus();
  fireEvent.keyDown(handle, { key: ' ', keyCode: 32 });
  await screen.findByText(/Drop at position/);
  fireEvent.keyDown(handle, { key: 'ArrowDown', keyCode: 40 });
  fireEvent.keyDown(handle, { key: ' ', keyCode: 32 });
  await waitFor(() => expect(screen.queryByText(/Drop at position/)).not.toBeInTheDocument());
}

const mockLoad = jest.fn();
const mockSend = jest.fn();

jest.mock('../../shared/components/proposal-ranking/client', () => ({
  createOperationId: () => '2f43c138-f64b-47a3-8be1-c90a3ef27622',
  loadProposalRanking: (...args) => mockLoad(...args),
  sendProposalRankingAction: (...args) => mockSend(...args),
}));

const CYCLE = resolveWorkingCycle(conventionalCycles());
const REQUESTS = [
  { requestId: 'request-1', requestNumber: '1001', title: 'First proposal', organization: 'North Institute', programKey: 'se', amountMinorUnits: 10000, currency: { code: 'USD', name: 'US dollar', precision: 2 }, score: { mean: 4.2, displayMean: 4.2, ratedCount: 3, receivedCount: 3, distribution: { Excellent: 2, Good: 1 } } },
  { requestId: 'request-2', requestNumber: '1002', title: 'Second proposal', organization: 'West Institute', programKey: 'se', amountMinorUnits: 20000, currency: { code: 'USD', name: 'US dollar', precision: 2 }, score: null },
  { requestId: 'request-3', requestNumber: '1003', title: 'Third proposal', organization: 'East Institute', programKey: 'se', amountMinorUnits: 30000, currency: { code: 'USD', name: 'US dollar', precision: 2 }, score: null },
  { requestId: 'request-4', requestNumber: '1004', title: 'Fourth proposal', organization: 'South Institute', programKey: 'se', amountMinorUnits: 40000, currency: { code: 'USD', name: 'US dollar', precision: 2 }, score: null },
];

const INITIAL_ORDER = REQUESTS.map((proposal) => proposal.requestId);

function list({ listKey, owner, order = INITIAL_ORDER, etag = 'list-v1', status = 'draft' }) {
  return {
    listKey,
    programKey: 'se',
    owner,
    status,
    order,
    etag,
    version: 1,
    updatedAt: '2026-10-07T12:00:00.000Z',
    totals: [],
  };
}

function roundResponse({ facilitator = false, published = false, order = INITIAL_ORDER, etag = 'list-v1', secretLists = true } = {}) {
  const own = list({ listKey: 'se-pd-self', owner: { systemUserId: 'pd-self', name: 'Current PD' }, order, etag, status: 'draft' });
  const other = list({ listKey: 'se-pd-other', owner: { systemUserId: 'pd-other', name: 'Private Other PD' }, order: [...INITIAL_ORDER].reverse() });
  const meeting = {
    ...list({ listKey: 'se-meeting', owner: null, status: published ? 'published' : 'collecting', order, etag: 'meeting-v1' }),
    composite: published ? {
      sourceSubmissionIds: ['se-pd-self', 'se-pd-other'],
      baselineOrder: INITIAL_ORDER,
      scores: { 'request-1': { rankSum: 2, averageRank: 1, tied: false } },
      ranks: [{ requestId: 'request-1', participants: [{ systemUserId: 'pd-self', name: 'Current PD', rank: 1 }, { systemUserId: 'pd-other', name: 'Other PD', rank: 2 }], minRank: 1, maxRank: 2, disagreement: true }],
    } : null,
  };
  const capabilities = {
    preview: facilitator,
    open: false,
    saveOwnList: !facilitator && !published,
    submitOwnList: !facilitator && !published,
    generate: facilitator && !published,
    editMeetingOrder: published,
    publish: facilitator && !published,
    transferFacilitator: facilitator,
    excuseParticipant: facilitator && !published,
    cancelRound: facilitator && !published,
  };
  return {
    mode: 'round',
    cycleCode: CYCLE,
    roundId: 'round-1',
    viewer: {
      systemUserId: facilitator ? 'facilitator' : 'pd-self',
      isFacilitator: facilitator,
      isSuperuser: false,
      isRosterParticipant: !facilitator,
      capabilities,
    },
    round: {
      etag: 'round-v1',
      policyRevision: 4,
      state: 'active',
      facilitator: { systemUserId: 'facilitator', name: 'Facilitator' },
      snapshot: {
        proposals: REQUESTS,
        seedOrders: { se: INITIAL_ORDER, mr: [] },
        roster: [
          { systemUserId: 'pd-self', name: 'Current PD', excluded: false },
          { systemUserId: 'pd-other', name: 'Other PD', excluded: false },
        ],
      },
    },
    preview: null,
    confirmations: {
      generate: { se: { fingerprint: 'generate-se', message: 'All submitted SE rankings will be used.', outstandingNames: [] }, mr: null },
      publish: { se: { fingerprint: 'publish-se', message: 'Publish the reviewed SE order.', outstandingNames: [] }, mr: null },
      excuse: facilitator ? { fingerprint: 'excuse-round', message: 'This applies to both programs.' } : null,
      cancel: facilitator ? { fingerprint: 'cancel-round', message: 'No published program may be canceled.' } : null,
    },
    programs: {
      se: {
        proposalIds: INITIAL_ORDER,
        progress: { required: 2, submitted: 1, outstandingNames: ['Other PD'] },
        ownList: facilitator ? null : own,
        facilitatorLists: facilitator ? [own, other] : secretLists ? [other] : null,
        meetingStatus: published ? 'published' : 'collecting',
        meeting: facilitator || published ? meeting : null,
      },
      mr: { proposalIds: [], progress: { required: 0, submitted: 0, outstandingNames: [] }, ownList: null, facilitatorLists: facilitator ? [] : null, meetingStatus: null, meeting: null },
    },
    operation: null,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mockLoad.mockReset();
  mockSend.mockReset();
});

describe('Proposal Ranking page', () => {
  test('a PD sees only their private list while the facilitator can inspect every PD list', async () => {
    mockLoad.mockResolvedValue(roundResponse({ secretLists: true }));
    const { unmount } = render(<ProposalRankingApp />);

    expect(await screen.findByText('Your private ranking')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current PD' })).toBeInTheDocument();
    expect(screen.queryByText('Private Other PD')).not.toBeInTheDocument();
    unmount();

    mockLoad.mockResolvedValue(roundResponse({ facilitator: true }));
    render(<ProposalRankingApp />);
    expect(await screen.findByText('Individual PD rankings')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Private Other PD' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generate SE draft' })).toBeInTheDocument();
  });

  test('keeps confirmations and the generated draft above individual lists', async () => {
    const collecting = roundResponse({ facilitator: true });
    collecting.programs.se.progress = { required: 2, submitted: 2, outstandingNames: [] };
    const draft = roundResponse({ facilitator: true, published: true });
    draft.programs.se.meeting.status = 'composite-draft';
    draft.programs.se.meetingStatus = 'composite-draft';
    draft.viewer.capabilities.publish = true;
    draft.confirmations.publish.se = { fingerprint: 'publish-se', message: 'Publish the reviewed SE order.', outstandingNames: [] };
    mockLoad.mockResolvedValue(collecting);
    mockSend.mockResolvedValueOnce(draft).mockResolvedValueOnce(roundResponse({ facilitator: true, published: true }));
    render(<ProposalRankingApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generate SE draft' }));
    const individual = screen.getByText('Individual PD rankings');
    const confirmGenerate = screen.getByRole('button', { name: 'Confirm generate the Science & Engineering draft' });
    expect(confirmGenerate.compareDocumentPosition(individual) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(individual.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(confirmGenerate);
    const draftHeading = await screen.findByRole('heading', { name: 'Facilitator composite draft' });
    const collapsed = screen.getByText('Individual PD rankings').closest('details');
    expect(collapsed).not.toHaveAttribute('open');
    expect(draftHeading.compareDocumentPosition(collapsed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Publish SE' }));
    const confirmPublish = screen.getByRole('button', { name: 'Confirm publish the Science & Engineering order' });
    expect(confirmPublish.compareDocumentPosition(draftHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(confirmPublish);
    expect(await screen.findByRole('heading', { name: 'Shared meeting order' })).toBeInTheDocument();
    expect(mockSend.mock.calls.map(([action]) => action.action)).toEqual(['generate', 'publish']);
  });

  test('tells a participant when all lists are submitted and the facilitator is next', async () => {
    const response = roundResponse();
    response.programs.se.progress = { required: 2, submitted: 2, outstandingNames: [] };
    response.programs.se.ownList.status = 'submitted';
    mockLoad.mockResolvedValue(response);
    render(<ProposalRankingApp />);
    expect(await screen.findByText('Submitted—waiting for the facilitator.')).toBeInTheDocument();
  });

  test('keyboard dragging previews the destination and saves only on drop', async () => {
    mockLoad.mockResolvedValue(roundResponse());
    mockSend.mockImplementation((action) => Promise.resolve(roundResponse({ order: action.order, etag: 'list-v2' })));
    render(<ProposalRankingApp />);
    const handle = await screen.findByRole('button', { name: 'Drag First proposal to reorder' });
    expect(screen.queryByRole('button', { name: /Move proposal/ })).not.toBeInTheDocument();
    expect(screen.getAllByText('Cumulative Budget')).toHaveLength(INITIAL_ORDER.length);
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', keyCode: 32 });
    expect(await screen.findByText('Drop at position 1 of 4')).toBeInTheDocument();
    fireEvent.keyDown(handle, { key: 'ArrowDown', keyCode: 40 });
    expect(await screen.findByText('Drop at position 2 of 4')).toBeInTheDocument();
    expect(mockSend).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: ' ', keyCode: 32 });
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    expect(mockSend.mock.calls[0][0]).toMatchObject({ action: 'save', order: ['request-2', 'request-1', 'request-3', 'request-4'], etag: 'list-v1' });
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
  });

  test('canceling a keyboard drag preserves the order without saving', async () => {
    mockLoad.mockResolvedValue(roundResponse());
    render(<ProposalRankingApp />);
    const handle = await screen.findByRole('button', { name: 'Drag First proposal to reorder' });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ', keyCode: 32 });
    await screen.findByText('Drop at position 1 of 4');
    fireEvent.keyDown(handle, { key: 'ArrowDown', keyCode: 40 });
    await screen.findByText('Drop at position 2 of 4');
    fireEvent.keyDown(handle, { key: 'Escape', keyCode: 27 });
    await waitFor(() => expect(screen.queryByText(/Drop at position/)).not.toBeInTheDocument());
    expect(mockSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Rank 1: First proposal')).toBeInTheDocument();
  });

  test('published dry-run erasure requires explicit confirmation and clears displayed ranking content', async () => {
    const current = roundResponse({ facilitator: true, published: true });
    current.round.dryRun = true;
    current.viewer.capabilities.resetDryRun = true;
    current.confirmations.resetDryRun = { fingerprint: 'erase-current', message: 'Permanently erase trial rankings.' };
    const erased = JSON.parse(JSON.stringify(current));
    erased.round = { ...erased.round, erased: true, state: 'canceled', snapshot: { proposals: [], roster: [], seedOrders: { se: [], mr: [] } } };
    erased.programs = { se: { proposalIds: [], meeting: null }, mr: { proposalIds: [], meeting: null } };
    erased.viewer.capabilities = {};
    erased.confirmations.resetDryRun = null;
    mockLoad.mockResolvedValue(current);
    mockSend.mockResolvedValue(erased);
    render(<ProposalRankingApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Facilitate', exact: true }));
    fireEvent.click(screen.getByText('Round administration'));
    const erase = screen.getByRole('button', { name: 'Permanently erase dry run' });
    expect(erase).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: /all rankings in this dry run will be permanently erased/ }));
    fireEvent.click(erase);
    await screen.findByText(/Dry-run rankings permanently erased/);
    expect(screen.queryByText('First proposal')).not.toBeInTheDocument();
    expect(mockSend.mock.calls[0][0]).toMatchObject({ action: 'resetDryRun', roundId: 'round-1', confirmationFingerprint: 'erase-current', policyRevision: 4 });
  });

  test('serializes saves and keeps the latest queued drag order visible', async () => {
    const firstSave = deferred();
    mockLoad.mockResolvedValue(roundResponse());
    mockSend.mockImplementation((action) => mockSend.mock.calls.length === 1
      ? firstSave.promise
      : Promise.resolve(roundResponse({ order: action.order, etag: 'list-v3' })));
    render(<ProposalRankingApp />);

    let list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    await dragDown(within(list).getByRole('button', { name: 'Drag First proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    const firstOrder = ['request-2', 'request-1', 'request-3', 'request-4'];
    expect(mockSend.mock.calls[0][0]).toMatchObject({ action: 'save', order: firstOrder, etag: 'list-v1', policyRevision: 4 });

    await dragDown(within(list).getByRole('button', { name: 'Drag Third proposal to reorder' }));
    const latestOrder = ['request-2', 'request-1', 'request-4', 'request-3'];
    expect(within(list).getByLabelText('Rank 3: Fourth proposal')).toBeInTheDocument();
    expect(within(list).getByLabelText('Rank 4: Third proposal')).toBeInTheDocument();

    await act(async () => {
      firstSave.resolve(roundResponse({ order: firstOrder, etag: 'list-v2' }));
      await firstSave.promise;
    });
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1][0]).toMatchObject({ action: 'save', order: latestOrder, etag: 'list-v2', policyRevision: 4 });
    await screen.findByText('Order saved.');
    expect(within(list).getByLabelText('Rank 3: Fourth proposal')).toBeInTheDocument();
  });

  test('a failed save stays visible as unsaved until refresh and retry use the current ETag', async () => {
    const initial = roundResponse();
    mockLoad.mockResolvedValueOnce(initial).mockResolvedValueOnce(roundResponse({ etag: 'list-v2' }));
    const conflict = Object.assign(new Error('This round changed elsewhere.'), { status: 409, code: 'conflict' });
    mockSend.mockRejectedValueOnce(conflict).mockImplementationOnce((action) => Promise.resolve(roundResponse({ order: action.order, etag: 'list-v3' })));
    render(<ProposalRankingApp />);

    let list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    await dragDown(within(list).getByRole('button', { name: 'Drag First proposal to reorder' }));
    expect(await screen.findByText(/Another change is newer than this order/)).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Submit and lock list' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh current state' }));
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
    list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    const retry = await within(list).findByRole('button', { name: 'Retry displayed order' });
    fireEvent.click(retry);
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1][0]).toMatchObject({ action: 'save', etag: 'list-v2', order: ['request-2', 'request-1', 'request-3', 'request-4'] });
    expect(await screen.findByText('Order saved.')).toBeInTheDocument();
  });

  test('a late same-scope readback cannot restore private lists after another readback is denied', async () => {
    const readback = deferred();
    const lateReadback = deferred();
    mockLoad.mockResolvedValueOnce(roundResponse());
    mockSend
      .mockRejectedValueOnce(Object.assign(new Error('Temporary server error.'), { status: 500, code: 'uncertain_outcome' }))
      .mockImplementationOnce(() => readback.promise)
      .mockImplementationOnce(() => lateReadback.promise);
    render(<ProposalRankingApp />);

    const list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    await dragDown(within(list).getByRole('button', { name: 'Drag First proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh current state' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(3));

    await act(async () => {
      readback.reject(Object.assign(new Error('Access changed.'), { status: 403, code: 'forbidden' }));
      try { await readback.promise; } catch { /* expected denial */ }
    });
    await act(async () => {
      lateReadback.resolve(roundResponse());
      await lateReadback.promise;
    });

    await waitFor(() => expect(screen.queryByText('Your private ranking')).not.toBeInTheDocument());
    expect(screen.queryByText('Current PD')).not.toBeInTheDocument();
  });

  test('a late save readback cannot restore an erased dry run after refresh', async () => {
    const initial = roundResponse();
    initial.round.dryRun = true;
    const erased = JSON.parse(JSON.stringify(initial));
    erased.round = { ...erased.round, erased: true, state: 'canceled', snapshot: { proposals: [], roster: [], seedOrders: { se: [], mr: [] } } };
    erased.programs = { se: { proposalIds: [], meeting: null }, mr: { proposalIds: [], meeting: null } };
    erased.viewer.capabilities = {};
    erased.viewer.isRosterParticipant = false;
    const lateReadback = deferred();
    mockLoad.mockResolvedValueOnce(initial);
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Lost save response'), { status: 500 }))
      .mockImplementationOnce(() => lateReadback.promise)
      .mockResolvedValueOnce(erased);
    render(<ProposalRankingApp />);
    await dragDown(await screen.findByRole('button', { name: 'Drag First proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current state' }));
    await screen.findByText(/Dry-run rankings permanently erased/);
    await act(async () => { lateReadback.resolve(initial); await lateReadback.promise; });
    expect(screen.queryByText('First proposal')).not.toBeInTheDocument();
    expect(screen.queryByText('Your private ranking')).not.toBeInTheDocument();
    expect(screen.getByText(/Dry-run rankings permanently erased/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled();
  });

  test('shows East and West on shared cards and omits geography for unknown or older snapshot values', async () => {
    const response = roundResponse();
    response.round.snapshot.proposals[0].institutionGeography = 'East';
    response.round.snapshot.proposals[1].institutionGeography = 'West';
    response.round.snapshot.proposals[2].institutionGeography = 'North';
    delete response.round.snapshot.proposals[3].institutionGeography;
    mockLoad.mockResolvedValue(response);
    render(<ProposalRankingApp />);

    expect(await screen.findByRole('img', { name: 'East institution' })).toHaveTextContent('E');
    expect(screen.getByRole('img', { name: 'West institution' })).toHaveTextContent('W');
    expect(screen.getAllByRole('img', { name: /institution$/ })).toHaveLength(2);
  });

  test('renders the reviewer score circle without changing its numeric card score', async () => {
    const response = roundResponse();
    mockLoad.mockResolvedValue(response);
    render(<ProposalRankingApp />);

    const scored = await screen.findByRole('img', {
      name: 'Average reviewer score: 4.2 out of 5 (approximate color)',
    });
    expect(scored).toHaveStyle({ backgroundColor: reviewerScoreIndicator(REQUESTS[0].score).color });
    expect(scored).toHaveAttribute('title', 'Average reviewer score: 4.2 out of 5 (approximate color)');
    expect(screen.getByLabelText('Average reviewer grade: 4.2')).toHaveTextContent('4.2');

    const unscored = await screen.findAllByRole('img', { name: 'Average reviewer score: unscored' });
    expect(unscored[0]).toHaveStyle({ backgroundColor: '#9ca3af' });
  });

  test('a facilitator who is a PD can save and submit only their own list', async () => {
    const response = roundResponse({ facilitator: true });
    response.viewer.systemUserId = 'pd-self';
    response.viewer.isRosterParticipant = true;
    response.viewer.capabilities.saveOwnList = true;
    response.viewer.capabilities.submitOwnList = true;
    response.programs.se.ownList = response.programs.se.facilitatorLists[0];
    mockLoad.mockResolvedValue(response);
    mockSend.mockImplementation((action) => {
      const next = JSON.parse(JSON.stringify(response));
      next.programs.se.facilitatorLists[0].order = action.order;
      next.programs.se.facilitatorLists[0].etag = 'list-v2';
      next.programs.se.ownList = next.programs.se.facilitatorLists[0];
      return Promise.resolve(next);
    });
    render(<ProposalRankingApp />);
    const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    expect(screen.queryByRole('region', { name: 'Private Other PD SE ranking' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate SE draft' })).not.toBeInTheDocument();
    await dragDown(within(own).getByRole('button', { name: 'Drag First proposal to reorder' }));
    await screen.findByText('Order saved.');
    fireEvent.click(within(own).getByRole('button', { name: 'Submit and lock list' }));
    await waitFor(() => expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'submit', etag: 'list-v2' })));
  });

  test('facilitator separates own work, read-only reference lists, and collapsed administration', async () => {
    const response = roundResponse({ facilitator: true });
    response.viewer.systemUserId = 'pd-self';
    response.viewer.isRosterParticipant = true;
    response.viewer.capabilities.saveOwnList = true;
    response.viewer.capabilities.submitOwnList = true;
    response.programs.se.ownList = response.programs.se.facilitatorLists[0];
    mockLoad.mockResolvedValue(response);
    render(<ProposalRankingApp />);
    expect(await screen.findByRole('button', { name: 'My rankings' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Individual PD rankings')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Facilitate', exact: true }));
    expect(screen.getByRole('button', { name: 'Generate SE draft' })).toBeInTheDocument();
    const references = screen.getByText('Individual PD rankings').closest('details');
    expect(references).not.toHaveAttribute('open');
    expect(within(references).queryByRole('button', { name: /Move proposal/, hidden: true })).not.toBeInTheDocument();
    expect(within(references).queryByRole('button', { name: 'Submit and lock list', hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('Round administration').closest('details')).not.toHaveAttribute('open');
    fireEvent.click(screen.getByRole('button', { name: 'My rankings' }));
    expect(screen.getByRole('button', { name: 'Submit and lock list' })).toBeInTheDocument();
    expect(screen.queryByText('Round administration')).not.toBeInTheDocument();
  });

  test('published meeting view stays separate from own ranking and unpublished MR', async () => {
    const response = roundResponse({ published: true });
    response.programs.se.ownList.status = 'submitted';
    response.programs.mr.proposalIds = INITIAL_ORDER;
    response.programs.mr.ownList = { ...response.programs.se.ownList, listKey: 'mr-self', status: 'draft' };
    mockLoad.mockResolvedValue(response);
    render(<ProposalRankingApp />);
    expect(await screen.findByRole('button', { name: 'Meeting list' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Facilitate', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'My rankings' }));
    expect(screen.getByText('Your private ranking')).toBeInTheDocument();
    expect(screen.queryByText('Shared meeting order')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'MR', exact: true }));
    await screen.findByText('Your private ranking');
    expect(screen.getByRole('button', { name: 'My rankings' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Meeting list' }));
    expect(screen.getByText('This program has not been published yet. Your own list is in My rankings.')).toBeInTheDocument();
    expect(screen.queryByText('Shared meeting order')).not.toBeInTheDocument();
  });

  test('opening preview shows the roster, lead assignments and review completeness', async () => {
    mockLoad.mockResolvedValue({
      mode: 'preview', cycleCode: CYCLE, viewer: { capabilities: { open: true } },
      preview: { proposals: [{ ...REQUESTS[0], leadSystemUserId: 'pd-self' }, REQUESTS[1]],
        seedOrders: { se: ['request-1', 'request-2'], mr: [] },
        roster: [{ systemUserId: 'pd-self', name: 'Preview PD', hasAppAccess: true }],
        outstandingReviewCount: 7, canOpen: true, warnings: [] },
    });
    render(<ProposalRankingApp />);
    expect(await screen.findByText('Participating PDs: Preview PD')).toBeInTheDocument();
    expect(screen.getByText('Lead PD: Preview PD')).toBeInTheDocument();
    expect(screen.getByText('7 outstanding external reviews · 1 unscored proposals')).toBeInTheDocument();
  });

  test('confirmed save readback supersedes an older manual refresh', async () => {
    const readback = deferred();
    const lateRefresh = deferred();
    const savedOrder = ['request-2', 'request-1', 'request-3', 'request-4'];
    mockLoad.mockResolvedValueOnce(roundResponse());
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Uncertain'), { status: 500 }))
      .mockImplementationOnce(() => readback.promise)
      .mockImplementationOnce(() => lateRefresh.promise)
      .mockImplementationOnce((action) => Promise.resolve(roundResponse({ order: action.order, etag: 'list-v3' })));
    render(<ProposalRankingApp />);
    const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    await dragDown(within(own).getByRole('button', { name: 'Drag First proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current state' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(3));
    await act(async () => { readback.resolve(roundResponse({ order: savedOrder, etag: 'list-v2' })); await readback.promise; });
    await act(async () => { lateRefresh.resolve(roundResponse()); await lateRefresh.promise; });
    const current = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    expect(within(current).getByLabelText('Rank 1: Second proposal')).toBeInTheDocument();
    await dragDown(within(current).getByRole('button', { name: 'Drag Third proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'save', etag: 'list-v2' })));
  });

  test('canceled round can return directly to the same-cycle preview', async () => {
    const canceled = roundResponse({ facilitator: true });
    canceled.round.state = 'canceled';
    mockLoad.mockResolvedValue(canceled);
    render(<ProposalRankingApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'View current cycle preview' }));
    await waitFor(() => expect(mockLoad).toHaveBeenLastCalledWith({ cycleCode: CYCLE, roundId: undefined }));
  });

  test('does not offer excusal even if an older server advertises the capability', async () => {
    mockLoad.mockResolvedValue(roundResponse({ facilitator: true }));
    render(<ProposalRankingApp />);
    await screen.findByText('Round administration');
    expect(screen.queryByRole('button', { name: 'Excuse PD' })).not.toBeInTheDocument();
    expect(screen.queryByText('Excuse a PD')).not.toBeInTheDocument();
  });

  test.each([true, false])('opening without an acknowledgment preserves canOpen=%s', async (canOpen) => {
    mockLoad.mockResolvedValue({ mode: 'preview', cycleCode: CYCLE, viewer: { capabilities: { open: true } },
      preview: { proposals: [REQUESTS[0]], seedOrders: { se: [INITIAL_ORDER[0]], mr: [] }, roster: [],
        outstandingReviewCount: 0, canOpen, warnings: [], previewFingerprint: 'current-preview' } });
    mockSend.mockResolvedValue(roundResponse({ facilitator: true }));
    render(<ProposalRankingApp />);
    const open = await screen.findByRole('button', { name: 'Open round' });
    expect(screen.getByRole('checkbox', { name: /Open as a dry run/ })).not.toBeChecked();
    expect(screen.queryByText(/outstanding external reviews/)).not.toBeInTheDocument();
    if (canOpen) {
      expect(open).toBeEnabled();
      fireEvent.click(open);
      await waitFor(() => expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
        action: 'open', previewFingerprint: 'current-preview', cycleCode: CYCLE,
      })));
    } else {
      expect(open).toBeDisabled();
      fireEvent.click(open);
      expect(mockSend).not.toHaveBeenCalled();
    }
  });

  test('an uncertain opening retries the exact original operation and preview', async () => {
    mockLoad.mockResolvedValue({ mode: 'preview', cycleCode: CYCLE, viewer: { capabilities: { open: true } },
      preview: { proposals: REQUESTS, seedOrders: { se: INITIAL_ORDER, mr: [] }, roster: [],
        outstandingReviewCount: 0, canOpen: true, warnings: [], previewFingerprint: 'frozen-preview' } });
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Opening uncertain'), { status: 409, code: 'uncertain_outcome' }))
      .mockResolvedValueOnce(roundResponse({ facilitator: true }));
    render(<ProposalRankingApp />);
    const open = await screen.findByRole('button', { name: 'Open round' });
    expect(open).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: /Open as a dry run/ })).not.toBeChecked();
    expect(screen.getByText('Opening saves the current proposals and review scores for this round.')).toBeInTheDocument();
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve opening attempt' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1][0]).toEqual(mockSend.mock.calls[0][0]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Resolve opening attempt' })).not.toBeInTheDocument());
  });

  test('a confirmed save with a newer server order stays visibly conflicted', async () => {
    mockLoad.mockResolvedValue(roundResponse());
    const newer = roundResponse({ order: [...INITIAL_ORDER].reverse(), etag: 'list-v3' });
    newer.operation = { status: 'confirmed', result: 'save' };
    mockSend.mockResolvedValue(newer);
    render(<ProposalRankingApp />);
    const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    await dragDown(within(own).getByRole('button', { name: 'Drag First proposal to reorder' }));
    expect(await screen.findByText(/Your save completed, but a newer order is now current/)).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Submit and lock list' })).toBeDisabled();
    expect(within(own).getByLabelText('Rank 1: Second proposal')).toBeInTheDocument();
    expect(screen.queryByText('Order saved.')).not.toBeInTheDocument();
  });

  test('a published participant gets named PD ranks and can reorder the shared meeting order', async () => {
    mockLoad.mockResolvedValue(roundResponse({ published: true }));
    mockSend.mockImplementation((action) => Promise.resolve(roundResponse({ published: true, order: action.order, etag: 'meeting-v2' })));
    render(<ProposalRankingApp />);

    expect(await screen.findByText('Shared meeting order')).toBeInTheDocument();
    expect(screen.queryByText('Your private ranking')).not.toBeInTheDocument();
    expect(screen.getByText('Disagreement')).toBeInTheDocument();
    await dragDown(screen.getByRole('button', { name: 'Drag First proposal to reorder' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit', programKey: 'se', etag: 'meeting-v1' })));
  });
});

describe('proposal ranking list calculations', () => {
  test('colors frozen raw reviewer means in ten steps and shows gray for unscored values', () => {
    const steps = Array.from({ length: 10 }, (_, index) => reviewerScoreIndicator({
      mean: 1 + (index * 4 / 9), ratedCount: 1, displayMean: 1,
    }).color);
    expect(new Set(steps).size).toBe(10);
    expect(reviewerScoreIndicator({ mean: 4.35, displayMean: 4.4, ratedCount: 20 }).label)
      .toBe('Average reviewer score: 4.4 out of 5 (approximate color)');
    expect(reviewerScoreIndicator({ mean: 1, ratedCount: 1 }).color).toBe(steps[0]);
    expect(reviewerScoreIndicator({ mean: 5, ratedCount: 1 }).color).toBe(steps[9]);
    expect(reviewerScoreIndicator({ mean: 2.99, displayMean: 3, ratedCount: 2 }).color).toBe(steps[4]);
    expect(reviewerScoreIndicator({ mean: 3, displayMean: 3, ratedCount: 0 }).label).toBe('Average reviewer score: unscored');
    expect(reviewerScoreIndicator({ mean: null, ratedCount: 0 }).label).toBe('Average reviewer score: unscored');
    expect(reviewerScoreIndicator({ mean: 5.1, ratedCount: 2 }).label).toBe('Average reviewer score: unscored');
  });

  test('moves a proposal without mutating the source order', () => {
    const original = ['a', 'b', 'c'];
    expect(moveProposal(original, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(original).toEqual(['a', 'b', 'c']);
  });

  test('marks cumulative totals incomplete starting at a missing amount', () => {
    const proposals = [
      { requestId: 'a', amountMinorUnits: 1000, currency: { code: 'USD', precision: 2 } },
      { requestId: 'b', amountMinorUnits: null, currency: null },
      { requestId: 'c', amountMinorUnits: 3000, currency: { code: 'USD', precision: 2 } },
    ];
    expect(buildCumulativeTotals(['a', 'b', 'c'], proposals)).toEqual([
      { requestId: 'a', cumulativeMinorUnits: 1000, complete: true, currencyCode: 'USD' },
      { requestId: 'b', cumulativeMinorUnits: null, complete: false, currencyCode: 'USD' },
      { requestId: 'c', cumulativeMinorUnits: null, complete: false, currencyCode: 'USD' },
    ]);
    expect(formatMoney(12345, { code: 'USD', precision: 2 })).toBe('$123.45');
  });

  test('shows the backend null-mean score shape as not scored', () => {
    expect(formatScore({ mean: null, displayMean: null, ratedCount: 0, receivedCount: 4 })).toBe('Not scored');
    expect(formatScore({ displayMean: 4.25, ratedCount: 2, receivedCount: 4 })).toBe('4.3 · 2/4 rated');
  });
});


test('creates the combined list without ballots or a second publication and falls back to SE for a fresh round', async () => {
  const ready = roundResponse({ facilitator: true, published: true });
  ready.programs.co = { available: true, proposalIds: INITIAL_ORDER, meeting: null, meetingStatus: null };
  ready.confirmations.generate.co = { fingerprint: 'combine-current', message: 'Create a shared combined meeting list.' };
  ready.viewer.capabilities.generate = true;
  const combined = JSON.parse(JSON.stringify(ready));
  combined.programs.co.meeting = { ...combined.programs.se.meeting, programKey: 'co', listKey: 'meeting:co' };
  combined.programs.co.meetingStatus = 'published';
  combined.confirmations.generate.co = null;
  mockLoad.mockResolvedValue(ready);
  mockSend.mockResolvedValueOnce(combined);
  render(<ProposalRankingApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'SE + MR' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create combined meeting list' }));
  expect(screen.queryByRole('button', { name: 'My rankings' })).not.toBeInTheDocument();
  expect(screen.queryByText('Individual PD rankings')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Confirm create the shared combined meeting list' }));
  expect(await screen.findByRole('heading', { name: 'Shared meeting order' })).toBeInTheDocument();
  expect(mockSend.mock.calls[0][0]).toMatchObject({ action: 'combine', confirmationFingerprint: 'combine-current' });
  expect(mockSend.mock.calls[0][0]).not.toHaveProperty('programKey');
  expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  mockLoad.mockResolvedValue(roundResponse());
  fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
  expect(await screen.findByRole('heading', { name: 'Your private ranking' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'SE + MR' })).not.toBeInTheDocument();
});


test('shows each external review as an inline letter grade without a distribution dropdown', async () => {
  mockLoad.mockResolvedValue(roundResponse());
  render(<ProposalRankingApp />);
  const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
  expect(within(own).getAllByText('Reviews')).toHaveLength(4);
  expect(within(own).getAllByLabelText('Excellent')).toHaveLength(2);
  expect(within(own).getByLabelText('Good')).toHaveTextContent('G');
  const average = within(own).getByLabelText('Average reviewer grade: 4.2');
  expect(average).toHaveTextContent(/^4\.2$/);
  expect(average).toHaveClass('font-semibold', 'bg-gray-100');
  expect(within(own).queryByText(/3\/3 rated/)).not.toBeInTheDocument();
  expect(average.parentElement).toHaveTextContent('Reviews');
  expect(within(own).getByLabelText('Good').compareDocumentPosition(average) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(own).queryByText('Review score:')).not.toBeInTheDocument();
  expect(within(own).queryByText('Review rating distribution')).not.toBeInTheDocument();
  expect(within(own).getAllByText('Not scored').length).toBeGreaterThanOrEqual(3);
});


test('shows published PD names and ranks inline without a disclosure', async () => {
  mockLoad.mockResolvedValue(roundResponse({ published: true }));
  render(<ProposalRankingApp />);
  const ranks = await screen.findByRole('list', { name: 'PD ranks' });
  expect(within(ranks).getByText('Current')).toBeInTheDocument();
  expect(within(ranks).getByText('Other')).toBeInTheDocument();
  expect(within(ranks).getByLabelText('Current PD: rank 1 of 4')).toHaveTextContent('1');
  expect(within(ranks).getByLabelText('Current PD: rank 1 of 4')).toHaveStyle({ backgroundColor: '#15803d33' });
  expect(within(ranks).getByLabelText('Other PD: rank 2 of 4')).toHaveTextContent('2');
  expect(ranks.closest('details')).toBeNull();
  expect(screen.queryByText(/Named PD ranks/)).not.toBeInTheDocument();
});


test('PD rank colors normalize within each program from green first to red last', () => {
  expect(pdRankColor(1, 12)).toBe('#15803d');
  expect(pdRankColor(12, 12)).toBe('#b91c1c');
  expect(pdRankColor(1, 1)).toBe('#15803d');
  expect(pdRankColor(2, 3)).toBe('#eab308');
  expect(pdRankColor(0, 12)).toBe('#9ca3af');
});

test('combined cards color PD ranks against the original program length', async () => {
  const response = roundResponse({ published: true });
  response.round.snapshot.proposals = REQUESTS.map((proposal, index) => ({ ...proposal, programKey: index === 3 ? 'mr' : 'se' }));
  response.programs.co = { ...response.programs.se, available: true, ownList: null, meeting: { ...response.programs.se.meeting, programKey: 'co', listKey: 'meeting:co' } };
  mockLoad.mockResolvedValue(response);
  render(<ProposalRankingApp />);
  fireEvent.click(await screen.findByRole('button', { name: 'SE + MR' }));
  const badge = await screen.findByLabelText('Other PD: rank 2 of 3');
  expect(badge).toHaveStyle({ backgroundColor: '#eab30833' });
});


test('uses the linked project title, a prominent rank and a program badge without proposal numbers', async () => {
  mockLoad.mockResolvedValue(roundResponse());
  render(<ProposalRankingApp />);
  const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
  expect(within(own).getByRole('link', { name: 'First proposal' })).toHaveAttribute('href', '/workbench/request-1');
  expect(within(own).getByLabelText('Rank 1: First proposal')).toHaveClass('text-3xl', 'font-bold');
  expect(within(own).getAllByText('SE')).toHaveLength(4);
  expect(own).not.toHaveTextContent('1001');
  expect(own).not.toHaveTextContent('Position');
  expect(within(own).queryByRole('link', { name: /Open proposal/ })).not.toBeInTheDocument();
});


test('shows the fractional average after PD ranks in a matching colored badge', async () => {
  const response = roundResponse({ published: true });
  response.programs.se.meeting.composite.scores['request-1'].averageRank = 2.5;
  mockLoad.mockResolvedValue(response);
  render(<ProposalRankingApp />);
  const ranks = await screen.findByRole('list', { name: 'PD ranks' });
  const average = within(ranks).getByLabelText('Average PD rank: 2.50');
  expect(average).toHaveTextContent('2.50');
  expect(average).toHaveStyle({ backgroundColor: '#eab30833' });
  expect(within(ranks).getAllByRole('listitem').at(-1)).toHaveTextContent('Average2.50');
  expect(screen.queryByText('Composite:')).not.toBeInTheDocument();
  expect(pdRankColor(2.5, 4)).toBe('#eab308');
});


test('places the prominent institution heading above the smaller linked proposal title', async () => {
  mockLoad.mockResolvedValue(roundResponse());
  render(<ProposalRankingApp />);
  const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
  const institution = within(own).getByRole('heading', { name: 'North Institute' });
  const title = within(own).getByRole('link', { name: 'First proposal' });
  expect(institution).toHaveClass('text-base', 'font-semibold');
  expect(title.parentElement).toHaveClass('text-sm');
  expect(institution.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(title).toHaveAttribute('href', '/workbench/request-1');
});
