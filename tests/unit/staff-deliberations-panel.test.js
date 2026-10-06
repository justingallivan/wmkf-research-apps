/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import StaffDeliberationsPanel from '../../shared/components/workbench/StaffDeliberationsPanel';
jest.mock('next/link', () => function MockLink({ children, href }) { return <a href={href}>{children}</a>; });
const PROGRAM = '11111111-1111-4111-8111-111111111111';
const props = { programId: PROGRAM, cycleCode: 'D26', scope: 'my', loadingCycles: false };
const response = (artifacts, extra = {}) => ({ ok: true, status: 200, json: async () => ({ artifacts, requestCounts: { ordinary: artifacts.length, test: 0, total: artifacts.length }, ...extra }) });
function row(extra = {}) { return { requestId: 'r1', requestNumber: '1002903', title: 'Living cells', institution: 'University', programDirector: 'PD', timing: { availability: 'available', endIso: '2026-09-28T18:00:00Z', timeZone: 'America/Los_Angeles' }, preparation: { due: false, state: 'none' }, brief: { availability: 'missing' }, writeup: { availability: 'missing' }, ...extra }; }
beforeEach(() => { global.fetch = jest.fn(); });

test('documentless requests are visible and the query preserves program cycle and ownership scope', async () => {
  global.fetch.mockResolvedValue(response([row()])); render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/#1002903/)).toBeInTheDocument();
  const url = global.fetch.mock.calls[0][0];
  expect(url).toContain(`programId=${PROGRAM}`); expect(url).toContain('cycleCode=D26'); expect(url).toContain('scope=my');
  expect(screen.getByRole('link', { name: 'Open request details' })).toHaveAttribute('href', expect.stringContaining('tab=staff-deliberations'));
  expect(screen.queryByText(/Sharing history|No sharing recorded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Deliberation session:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Materials status/)).not.toBeInTheDocument();
});

test('named Word links cannot confuse the briefing and full writeup', async () => {
  global.fetch.mockResolvedValue(response([row({ brief: { availability: 'available', lifecycleState: 100000001, file: { webUrl: 'https://sp/brief' } }, writeup: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/full' } } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByRole('link', { name: 'Open Pre-site briefing in Word' })).toHaveAttribute('href','https://sp/brief');
  expect(screen.getByRole('link', { name: 'Open request details' })).toBeInTheDocument();
  expect(screen.getByText('Briefing ready')).toBeInTheDocument();
});

test('due preparation never labels an absent document ready and never writes', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'pending' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Queued for preparation')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request details' })).toHaveAttribute('href',expect.stringContaining('staff-deliberations'));
  expect(global.fetch.mock.calls.every(([,options]) => !options?.method || options.method === 'GET')).toBe(true);
});

test.each(['unavailable', 'ambiguous'])('a %s schedule classification problem does not present an unverified event time as authoritative', async (availability) => {
  global.fetch.mockResolvedValue(response([row({ timing: { availability, endIso: '2026-09-28T18:00:00Z', timeZone: 'America/Los_Angeles' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Needs attention',{selector:'p'})).toBeInTheDocument();
  expect(screen.getByText(/Recorded presentation end \(unverified\).*11:00 AM PDT/)).toBeInTheDocument();
  expect(screen.queryByText(/Scheduled presentation end/)).not.toBeInTheDocument();
});

test('task filter and search keep review and working requests distinct', async () => {
  global.fetch.mockResolvedValue(response([row(),row({requestId:'r2',requestNumber:'1002912',title:'Ubiquitin',finalPhase:'group-review'})]));
  render(<StaffDeliberationsPanel {...props} />); await screen.findByText(/#1002903/);
  fireEvent.change(screen.getByLabelText('Task'),{target:{value:'review'}});
  expect(screen.queryByText(/#1002903/)).not.toBeInTheDocument(); expect(screen.getByText(/#1002912/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'),{target:{value:'absent'}});
  expect(screen.getByText(/No requests match/)).toBeInTheDocument();
});

test('late old-scope results cannot replace the new selection', async () => {
  let resolveOld; global.fetch.mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce(response([row({requestNumber:'1002912'})]));
  const {rerender}=render(<StaffDeliberationsPanel {...props} />);
  rerender(<StaffDeliberationsPanel {...props} scope="all" />); await screen.findByText(/#1002912/);
  await act(async()=>resolveOld(response([row()])));
  expect(screen.queryByText(/#1002903/)).not.toBeInTheDocument();
});

test('ordinary total excludes separately reported test rows', async () => {
  global.fetch.mockResolvedValue(response([row(),row({requestId:'test',requestNumber:'1002788',isTestRequest:true})],{requestCounts:{ordinary:1,test:1,total:2}}));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/1 requests in this program/)).toHaveTextContent('1 test requests also shown');
});


test('disabled preparation reports the draft fact without treating configuration as a task failure', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'disabled' }, briefSharing: { availability: 'available', sentAtIso: '2026-09-27T18:00:00Z', sourceVersionId: '3.0' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('No working writeup yet')).toBeInTheDocument();
  expect(screen.queryByText(/Sent through app/)).not.toBeInTheDocument();
  expect(screen.queryByText('Preparation paused')).not.toBeInTheDocument();
});

test('a Final source without verified review lineage needs attention', async () => {
  global.fetch.mockResolvedValue(response([row({ finalPhase: 'none', finalReview: { availability: 'unavailable' }, writeup: { availability: 'available', lifecycleState: 100000004 } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Needs attention', { selector: 'p' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open review details' })).not.toBeInTheDocument();
});


test('reopened corrections remain a staff task even when an older preparation receipt is complete', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000000, correctionInProgress: true } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Corrections in progress')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request details' })).toHaveAttribute('href', expect.stringContaining('staff-deliberations'));
  expect(screen.queryByText('Post-visit editing')).not.toBeInTheDocument();
});

test('after presentation, a missing writeup never opens the pre-site briefing as a substitute', async () => {
  global.fetch.mockResolvedValue(response([row({
    preparation: { due: true, state: 'disabled' },
    brief: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/brief' } },
    writeup: { availability: 'missing' },
  })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect((await screen.findByText('No current document')).closest('p')).toHaveTextContent('Working writeup: No current document');
  expect(screen.getByRole('link', { name: 'Open request details' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open Pre-site briefing in Word' })).not.toBeInTheDocument();
});

test('queued and running preparation have different labels', async () => {
  global.fetch.mockResolvedValue(response([
    row({ requestId: 'queued', preparation: { due: true, state: 'pending' } }),
    row({ requestId: 'running', preparation: { due: true, state: 'running' } }),
  ]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Queued for preparation')).toBeInTheDocument();
  expect(screen.getByText('Preparing working writeup')).toBeInTheDocument();
});

test('corrections open the writeup rather than the pre-site briefing', async () => {
  global.fetch.mockResolvedValue(response([row({
    writeup: { availability: 'available', lifecycleState: 100000000, correctionInProgress: true, file: { webUrl: 'https://sp/writeup' } },
    brief: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/brief' } },
  })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByRole('link', { name: 'Open Working writeup in Word' })).toHaveAttribute('href', 'https://sp/writeup');
  expect(screen.queryByRole('link', { name: 'Open Pre-site briefing in Word' })).not.toBeInTheDocument();
});

 test('due automatic work waits without claiming a missing staff action', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'due' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Waiting for automatic preparation')).toBeInTheDocument();
  expect(screen.queryByText('Working writeup needed')).not.toBeInTheDocument();
});

test('a prepared receipt cannot make an incomplete document ready', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000001, milestoneComplete: false } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Needs attention', { selector: 'p' })).toBeInTheDocument();
  expect(screen.queryByText('Post-visit editing')).not.toBeInTheDocument();
});
