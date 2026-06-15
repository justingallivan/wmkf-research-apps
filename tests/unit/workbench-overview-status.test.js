/**
 * @jest-environment jsdom
 *
 * Component tests for the Group A Workbench tabs (S260): StatusTab (read-only
 * status reflection + class badge) and OverviewTab (command-center summary +
 * reviewer-progress strip). The reviewer fetch is mocked.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StatusTab from '../../shared/components/workbench/StatusTab';
import OverviewTab from '../../shared/components/workbench/OverviewTab';

const baseCtx = {
  requestId: 'r1',
  requestStatus: 'Phase II Pending',
  statusClass: 'IN_FLIGHT',
  institution: 'Example University',
  grantProgram: 'Medical Research',
  meetingDate: '2026-07-01T00:00:00Z',
  proposalInfo: { pi: 'Dr. Jane Smith', coPIs: ['Dr. Bob Lee'], requestedAmount: 100000, totalProjectBudget: 250000 },
  aiContent: { fitRationale: 'x', summary: null, dataExtract: null, fieldPrimer: null },
};

// Mock the lightweight per-request rollup endpoint (/api/workbench/reviewer-rollup).
function mockRollup({ counts = {}, needed = 3, workRemaining = 'find', hint = 'No reviewer candidates yet — start finding reviewers.' } = {}) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, counts, needed, workRemaining, hint }),
  });
}

afterEach(() => { jest.restoreAllMocks(); });

describe('StatusTab', () => {
  it('renders the raw status, the class badge, and the read-only note', () => {
    render(<StatusTab context={baseCtx} />);
    expect(screen.getByText('Phase II Pending')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument();
    expect(screen.getByText(/Staff recommend; the board decides/i)).toBeInTheDocument();
  });

  it('shows an Unclassified badge for a status absent from the map', () => {
    render(<StatusTab context={{ requestStatus: 'Some New Status', statusClass: 'UNCLASSIFIED' }} />);
    expect(screen.getByText('Some New Status')).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
  });

  it('handles a null status', () => {
    render(<StatusTab context={{ requestStatus: null, statusClass: null }} />);
    expect(screen.getByText('No status on this request.')).toBeInTheDocument();
  });
});

describe('OverviewTab', () => {
  it('renders the request snapshot incl. PI, institution, amount, and status badge', async () => {
    mockRollup();
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    expect(screen.getByText('Dr. Jane Smith')).toBeInTheDocument();
    expect(screen.getByText('Example University')).toBeInTheDocument();
    expect(screen.getByText('$100,000')).toBeInTheDocument();
    expect(screen.getByText('In review')).toBeInTheDocument(); // status badge reused from StatusTab
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('marks present AI artifacts and leaves absent ones muted', async () => {
    mockRollup();
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    expect(screen.getByText('✓ Fit rationale')).toBeInTheDocument();
    expect(screen.getByText('— Field primer')).toBeInTheDocument();
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('renders the rollup funnel counts + the server hint', async () => {
    mockRollup({
      counts: { candidates: 5, invited: 4, accepted: 3, declined: 0, held: 0, completed: 1 },
      needed: 3,
      workRemaining: 'review',
      hint: 'Enough reviewers accepted — reviews in progress.',
    });
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    expect(await screen.findByText('5')).toBeInTheDocument();   // candidates
    expect(screen.getByText('3 / 3')).toBeInTheDocument();      // accepted / needed
    expect(screen.getByText('Enough reviewers accepted — reviews in progress.')).toBeInTheDocument();
  });

  it('shows the find-stage hint when nothing has started', async () => {
    mockRollup(); // defaults: empty counts, workRemaining 'find'
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    expect(await screen.findByText(/start finding reviewers/i)).toBeInTheDocument();
  });

  it('deep-links via onSelectTab', async () => {
    mockRollup();
    const onSelectTab = jest.fn();
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByText('Manage reviewers →'));
    expect(onSelectTab).toHaveBeenCalledWith('reviewers');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('AI artifact chips deep-link to the Proposal tab', async () => {
    mockRollup();
    const onSelectTab = jest.fn();
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={onSelectTab} />);
    fireEvent.click(screen.getByText('✓ Fit rationale'));
    expect(onSelectTab).toHaveBeenCalledWith('proposal');
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  });

  it('tolerates a drifted non-object counts payload without crashing', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, counts: null, needed: 3, workRemaining: 'find', hint: 'No reviewer candidates yet — start finding reviewers.' }),
    });
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    // counts falls back to {} → zeros render, hint still shows, no throw
    expect(await screen.findByText(/start finding reviewers/i)).toBeInTheDocument();
  });

  it('shows an error line when the rollup fetch fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<OverviewTab context={baseCtx} requestId="r1" onSelectTab={() => {}} />);
    expect(await screen.findByText(/Couldn’t load reviewer progress/i)).toBeInTheDocument();
  });
});
