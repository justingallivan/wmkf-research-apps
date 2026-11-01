/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ProgramBriefingView from '../../shared/components/meeting-tracker/ProgramBriefingView';
jest.mock('../../shared/components/Layout', () => ({ __esModule: true, default: ({ children }) => <div>{children}</div>, Button: ({ children, variant, size, ...props }) => <button {...props}>{children}</button> }));
jest.mock('../../shared/context/ProfileContext', () => ({ useProfile: () => ({ currentProfile: { id: 7 } }) }));
jest.mock('next/link', () => function MockLink({ children, href, ...props }) { return <a href={href} {...props}>{children}</a>; });
const summary = { status: 'current', text: 'A new way to image tissue.', documentId: 'doc', excerpt: true };
const proposal = { requestId: 'req', requestNumber: '1001', institution: 'Example University', title: 'Imaging tissue', proposalSummary: summary, discussionSummary: { ...summary, text: 'Staff supported the method but questioned scale.' }, discussion: { status: 'current', sentiment: { reception: 'mixed', enthusiasm: 'moderate', headline: 'Interest with reservations.', supportPoints: [{ quote: 'The method is promising.', speaker: 'Alex', time: '02:03' }], concernPoints: [{ quote: 'Scaling remains difficult.', speaker: 'Jo', time: '03:03' }], uncertainties: [{ topic: 'Validation at scale' }], disagreements: [] } } };
const briefing = (title = 'Imaging tissue') => ({ cycleCode: 'D26', cycleLabel: 'December 2026', loadedAt: '2026-10-19T12:00:00Z', groups: [{ key: 'se', name: 'Science and Engineering', proposals: [{ ...proposal, title }] }, { key: 'mr', name: 'Medical Research', proposals: [] }] });
const json = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
let read;
beforeEach(() => {
  read = jest.fn(async () => json(briefing()));
  global.fetch = jest.fn(async (url) => String(url).includes('?') ? read(String(url)) : json({ cycles: [{ code: 'D26', label: 'December 2026' }, { code: 'J27', label: 'June 2027' }], defaultCycleCode: 'D26' }));
  window.print = jest.fn();
});
test('renders compact program groups, proposal/discussion summaries and staff signals; print opens browser print', async () => {
  render(<ProgramBriefingView />);
  expect(await screen.findByText('Imaging tissue')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Discussion summaries' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Discussion summary programs' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'December 2026 discussion summaries' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Post-presentation discussion summary' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open research presentation' })).toHaveAttribute('href', '/meeting-tracker/visits/req');
  expect(screen.getByRole('link', { name: 'Review full post-presentation discussion sentiment' })).toHaveAttribute('href', '/meeting-tracker/discussion-sentiment');
  expect(screen.getByRole('heading', { name: 'Science and Engineering (SE)' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Medical Research (MR)' })).toBeInTheDocument();
  expect(screen.getByText('The method is promising.')).toBeInTheDocument(); expect(screen.getByText('Scaling remains difficult.')).toBeInTheDocument();
  expect(screen.getByText('Validation at scale')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Print / save PDF' })); expect(window.print).toHaveBeenCalledTimes(1);
});
test('marks gaps and retains missing proposals', async () => {
  const body = briefing(); const p = body.groups[0].proposals[0];
  p.proposalSummary = { status: 'out_of_date', text: null }; p.discussion = { status: 'none', sentiment: null };
  read.mockResolvedValue(json(body)); render(<ProgramBriefingView />);
  expect(await screen.findByText('Imaging tissue')).toBeInTheDocument();
  expect(screen.getByText(/The saved summary is out of date/)).toBeInTheDocument();
  expect(screen.getByText(/No accepted, current analysis/)).toBeInTheDocument();
  expect(screen.queryByText('The method is promising.')).not.toBeInTheDocument();
});
test('a late prior-cycle success cannot replace the selected cycle; print is disabled while loading', async () => {
  let resolveOld;
  read.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  render(<ProgramBriefingView />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button', { name: 'Print / save PDF' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Grant cycle'), { target: { value: 'J27' } });
  expect(await screen.findByText('Imaging tissue')).toBeInTheDocument();
  await act(async () => resolveOld(json(briefing('OLD CYCLE CONTENT'))));
  expect(screen.queryByText('OLD CYCLE CONTENT')).not.toBeInTheDocument();
});
test('a late prior-cycle failure cannot replace the selected cycle', async () => {
  let rejectOld;
  read.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectOld = reject; }));
  render(<ProgramBriefingView />); await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText('Grant cycle'), { target: { value: 'J27' } });
  expect(await screen.findByText('Imaging tissue')).toBeInTheDocument();
  await act(async () => rejectOld(new Error('OLD FAILURE')));
  expect(screen.queryByText('OLD FAILURE')).not.toBeInTheDocument();
});
test('failure clears previous content, disables print and offers retry', async () => {
  render(<ProgramBriefingView />); await screen.findByText('Imaging tissue');
  read.mockResolvedValueOnce(json({ error: 'Try later.' }, false));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh summaries' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try later.');
  expect(screen.queryByText('Imaging tissue')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Print / save PDF' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Imaging tissue')).toBeInTheDocument();
});
