import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProposalRankingApp from '../../shared/components/proposal-ranking/ProposalRankingApp';
import { buildCumulativeTotals, formatMoney, formatScore, moveProposal } from '../../shared/components/proposal-ranking/model';
import { conventionalCycles, resolveWorkingCycle } from '../../lib/utils/cycle-code';

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

  test('serializes saves and keeps the latest queued drag order visible', async () => {
    const firstSave = deferred();
    mockLoad.mockResolvedValue(roundResponse());
    mockSend.mockImplementation((action) => mockSend.mock.calls.length === 1
      ? firstSave.promise
      : Promise.resolve(roundResponse({ order: action.order, etag: 'list-v3' })));
    render(<ProposalRankingApp />);

    let list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    fireEvent.click(within(list).getByRole('button', { name: 'Move proposal 1001 down' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    const firstOrder = ['request-2', 'request-1', 'request-3', 'request-4'];
    expect(mockSend.mock.calls[0][0]).toMatchObject({ action: 'save', order: firstOrder, etag: 'list-v1', policyRevision: 4 });

    fireEvent.click(within(list).getByRole('button', { name: 'Move proposal 1003 down' }));
    const latestOrder = ['request-2', 'request-1', 'request-4', 'request-3'];
    expect(within(list).getByText(/Position 3 of 4 · #1004/)).toBeInTheDocument();
    expect(within(list).getByText(/Position 4 of 4 · #1003/)).toBeInTheDocument();

    await act(async () => {
      firstSave.resolve(roundResponse({ order: firstOrder, etag: 'list-v2' }));
      await firstSave.promise;
    });
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    expect(mockSend.mock.calls[1][0]).toMatchObject({ action: 'save', order: latestOrder, etag: 'list-v2', policyRevision: 4 });
    await screen.findByText('Order saved.');
    expect(within(list).getByText(/Position 3 of 4 · #1004/)).toBeInTheDocument();
  });

  test('a failed save stays visible as unsaved until refresh and retry use the current ETag', async () => {
    const initial = roundResponse();
    mockLoad.mockResolvedValueOnce(initial).mockResolvedValueOnce(roundResponse({ etag: 'list-v2' }));
    const conflict = Object.assign(new Error('This round changed elsewhere.'), { status: 409, code: 'conflict' });
    mockSend.mockRejectedValueOnce(conflict).mockImplementationOnce((action) => Promise.resolve(roundResponse({ order: action.order, etag: 'list-v3' })));
    render(<ProposalRankingApp />);

    let list = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    fireEvent.click(within(list).getByRole('button', { name: 'Move proposal 1001 down' }));
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
    fireEvent.click(within(list).getByRole('button', { name: 'Move proposal 1001 down' }));
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

  test('a facilitator who is a PD can save and submit only their own list', async () => {
    const response = roundResponse({ facilitator: true });
    response.viewer.systemUserId = 'pd-self';
    response.viewer.isRosterParticipant = true;
    response.viewer.capabilities.saveOwnList = true;
    response.viewer.capabilities.submitOwnList = true;
    mockLoad.mockResolvedValue(response);
    mockSend.mockImplementation((action) => {
      const next = JSON.parse(JSON.stringify(response));
      next.programs.se.facilitatorLists[0].order = action.order;
      next.programs.se.facilitatorLists[0].etag = 'list-v2';
      return Promise.resolve(next);
    });
    render(<ProposalRankingApp />);
    const own = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    const other = screen.getByRole('region', { name: 'Private Other PD SE ranking' });
    expect(within(other).queryByRole('button', { name: /Move proposal/ })).not.toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: 'Submit and lock list' })).not.toBeInTheDocument();
    fireEvent.click(within(own).getByRole('button', { name: 'Move proposal 1001 down' }));
    await screen.findByText('Order saved.');
    fireEvent.click(within(own).getByRole('button', { name: 'Submit and lock list' }));
    await waitFor(() => expect(mockSend).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'submit', etag: 'list-v2' })));
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
    fireEvent.click(within(own).getByRole('button', { name: 'Move proposal 1001 down' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh current state' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(3));
    await act(async () => { readback.resolve(roundResponse({ order: savedOrder, etag: 'list-v2' })); await readback.promise; });
    await act(async () => { lateRefresh.resolve(roundResponse()); await lateRefresh.promise; });
    const current = await screen.findByRole('region', { name: 'Current PD SE ranking' });
    expect(within(current).getByText(/Position 1 of 4 · #1002/)).toBeInTheDocument();
    fireEvent.click(within(current).getByRole('button', { name: 'Move proposal 1003 down' }));
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

  test('an uncertain opening retries the exact original operation and preview', async () => {
    mockLoad.mockResolvedValue({ mode: 'preview', cycleCode: CYCLE, viewer: { capabilities: { open: true } },
      preview: { proposals: REQUESTS, seedOrders: { se: INITIAL_ORDER, mr: [] }, roster: [],
        outstandingReviewCount: 0, canOpen: true, warnings: [], previewFingerprint: 'frozen-preview' } });
    mockSend.mockRejectedValueOnce(Object.assign(new Error('Opening uncertain'), { status: 409, code: 'uncertain_outcome' }))
      .mockResolvedValueOnce(roundResponse({ facilitator: true }));
    render(<ProposalRankingApp />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /I reviewed the proposal pool/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Open round' }));
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
    fireEvent.click(within(own).getByRole('button', { name: 'Move proposal 1001 down' }));
    expect(await screen.findByText(/Your save completed, but a newer order is now current/)).toBeInTheDocument();
    expect(within(own).getByRole('button', { name: 'Submit and lock list' })).toBeDisabled();
    expect(within(own).getByText(/Position 1 of 4 · #1002/)).toBeInTheDocument();
    expect(screen.queryByText('Order saved.')).not.toBeInTheDocument();
  });

  test('a published participant gets named PD ranks and can reorder the shared meeting order', async () => {
    mockLoad.mockResolvedValue(roundResponse({ published: true }));
    mockSend.mockImplementation((action) => Promise.resolve(roundResponse({ published: true, order: action.order, etag: 'meeting-v2' })));
    render(<ProposalRankingApp />);

    expect(await screen.findByText('Shared meeting order')).toBeInTheDocument();
    expect(screen.queryByText('Your private ranking')).not.toBeInTheDocument();
    expect(screen.getByText('Disagreement')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move proposal 1001 down' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit', programKey: 'se', etag: 'meeting-v1' })));
  });
});

describe('proposal ranking list calculations', () => {
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
