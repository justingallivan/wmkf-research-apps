/** @jest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { REQUEST_DOCUMENT_OPERATION_STATUS } from '../../shared/config/requestDocument';
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
  expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', expect.stringMatching(/tab=staff-deliberations.*#deliberations-briefing$/));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByText(/Sharing history|No sharing recorded/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Deliberation session:/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Materials status/)).not.toBeInTheDocument();
});

test('before the presentation the next step names the briefing, and the row has no Word shortcut', async () => {
  global.fetch.mockResolvedValue(response([row({ brief: { availability: 'available', lifecycleState: 100000001, file: { webUrl: 'https://sp/brief' } }, writeup: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/full' } } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Check the briefing in Word, then share it for the presentation.')).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(1);
});

test('due preparation never labels an absent document ready and never writes', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'pending' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Preparation will run automatically. No action is needed now.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', expect.stringMatching(/staff-deliberations.*#deliberations-writeup$/));
  expect(global.fetch.mock.calls.every(([,options]) => !options?.method || options.method === 'GET')).toBe(true);
});

test.each([
  ['unavailable', /couldn’t confirm the presentation time/],
  ['ambiguous', /More than one presentation is scheduled/],
])('a %s schedule classification problem does not present an unverified event time as authoritative', async (availability, reason) => {
  global.fetch.mockResolvedValue(response([row({ timing: { availability, endIso: '2026-09-28T18:00:00Z', timeZone: 'America/Los_Angeles' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Presentation time not confirmed')).toBeInTheDocument();
  expect(screen.getByText(/recorded .*11:00 AM PDT, unverified/)).toBeInTheDocument();
  expect(screen.getByText(reason)).toBeInTheDocument();
  expect(screen.queryByText('Before presentation', { selector: 'span' })).not.toBeInTheDocument();
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
  expect(await screen.findByText('Prepare your working writeup.')).toBeInTheDocument();
  expect(screen.getByText('After presentation')).toBeInTheDocument();
  expect(screen.queryByText(/Sent through app/)).not.toBeInTheDocument();
  expect(screen.queryByText('Preparation paused')).not.toBeInTheDocument();
});

test('a Final source without verified review lineage needs attention', async () => {
  global.fetch.mockResolvedValue(response([row({ finalPhase: 'none', finalReview: { availability: 'unavailable' }, writeup: { availability: 'available', lifecycleState: 100000004 } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/couldn’t load the review status/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', expect.stringMatching(/tab=staff-deliberations.*#deliberations-status$/));
});


test('reopened corrections remain a staff task even when an older preparation receipt is complete', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000000, correctionInProgress: true } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Make the requested corrections in the writeup, then choose Finish corrections.')).toBeInTheDocument();
  expect(screen.getByText('After presentation')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', expect.stringMatching(/staff-deliberations.*#deliberations-writeup$/));
  expect(screen.queryByText('Post-visit editing')).not.toBeInTheDocument();
});

test('after presentation, a missing writeup never opens the pre-site briefing as a substitute', async () => {
  global.fetch.mockResolvedValue(response([row({
    preparation: { due: true, state: 'disabled' },
    brief: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/brief' } },
    writeup: { availability: 'missing' },
  })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Prepare your working writeup.')).toBeInTheDocument();
  expect(screen.queryByText(/briefing/)).not.toBeInTheDocument();
});

test('queued and running preparation have different labels', async () => {
  global.fetch.mockResolvedValue(response([
    row({ requestId: 'queued', preparation: { due: true, state: 'pending' } }),
    row({ requestId: 'running', preparation: { due: true, state: 'running' } }),
  ]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Preparation will run automatically. No action is needed now.')).toBeInTheDocument();
  expect(screen.getByText('Your writeup is being prepared. Check back shortly.')).toBeInTheDocument();
});

test('corrections point at the writeup rather than the pre-site briefing', async () => {
  global.fetch.mockResolvedValue(response([row({
    writeup: { availability: 'available', lifecycleState: 100000000, correctionInProgress: true, file: { webUrl: 'https://sp/writeup' } },
    brief: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/brief' } },
  })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/corrections in the writeup/)).toBeInTheDocument();
  expect(screen.queryByText(/briefing/)).not.toBeInTheDocument();
});

 test('due automatic work waits without claiming a missing staff action', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'due' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Preparation will run automatically. No action is needed now.')).toBeInTheDocument();
  expect(screen.queryByText(/working writeup/)).not.toBeInTheDocument();
});

test('a prepared receipt cannot make an incomplete document ready', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000001, milestoneComplete: false } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/prepared but isn’t ready to edit yet/)).toBeInTheDocument();
  expect(screen.queryByText(/presentation findings/)).not.toBeInTheDocument();
});


test('an existing post-schedule draft names the request-page step that follows, without a Word shortcut', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'disabled' }, writeup: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/full' } } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Prepare the writeup for post-visit editing.')).toBeInTheDocument();
  expect(screen.getByText('After presentation')).toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByText(/Working writeup:|Working draft available/)).not.toBeInTheDocument();
});

test.each(['group-review', 'leadership-review'])('%s opens the review tab from the row', async (finalPhase) => {
  global.fetch.mockResolvedValue(response([row({ finalPhase, writeup: { availability: 'available', file: { webUrl: 'https://sp/full' } } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Read the writeup and follow its review progress.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open review' })).toHaveAttribute('href', expect.stringMatching(/tab=final-writeup[^#]*$/));
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.queryByText(/presentation findings/)).not.toBeInTheDocument();
});


test.each([null, 'https://sp/older-brief'])('a briefing being generated does not ask staff to prepare or share it (file %s)', async (webUrl) => {
  global.fetch.mockResolvedValue(response([row({ brief: { availability: webUrl ? 'available' : 'missing', operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.GENERATING, file: webUrl ? { webUrl } : null } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('The briefing is being prepared. Check back shortly.')).toBeInTheDocument();
  expect(screen.getByText('Before presentation', { selector: 'span' })).toBeInTheDocument();
  expect(screen.queryByText(/share it for the presentation/)).not.toBeInTheDocument();
  expect(screen.queryByText('Generate the pre-site briefing.')).not.toBeInTheDocument();
  expect(screen.getAllByRole('link')).toHaveLength(1);
});

test('a problem is shown beneath the stage, and several problems name the first in precedence', async () => {
  global.fetch.mockResolvedValue(response([row({
    preparation: { due: true, state: 'blocked' },
    brief: { availability: 'available', operationStatus: REQUEST_DOCUMENT_OPERATION_STATUS.FAILED },
    writeup: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/full' } },
  })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText(/preparation stopped before it finished/)).toBeInTheDocument();
  expect(screen.getByText('After presentation')).toBeInTheDocument();
  expect(screen.queryByText(/couldn’t be generated/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'attention' } });
  expect(screen.getByText(/#1002903/)).toBeInTheDocument();
});

test('every row has exactly one link, to the request, whatever the stage', async () => {
  global.fetch.mockResolvedValue(response([
    row({ requestId: 'corr', requestNumber: '1002852', preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000000, correctionInProgress: true, file: { webUrl: 'https://sp/w1' } } }),
    row({ requestId: 'brief', requestNumber: '1002874', brief: { availability: 'available', lifecycleState: 100000000, file: { webUrl: 'https://sp/b2' } } }),
    row({ requestId: 'review', requestNumber: '1002912', finalPhase: 'group-review', writeup: { availability: 'available', file: { webUrl: 'https://sp/w3' } } }),
  ]));
  render(<StaffDeliberationsPanel {...props} />);
  await screen.findByText(/#1002852/);
  for (const item of screen.getAllByRole('listitem')) {
    const links = Array.from(item.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toMatch(/^\/workbench\//);
  }
});

test('a ready post-visit writeup points to group review as the next step', async () => {
  global.fetch.mockResolvedValue(response([row({ preparation: { due: true, state: 'prepared' }, writeup: { availability: 'available', lifecycleState: 100000001, milestoneComplete: true, file: { webUrl: 'https://sp/full' } } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Add your presentation findings to the writeup, then open group review.')).toBeInTheDocument();
  expect(screen.getByText('After presentation')).toBeInTheDocument();
});

test('the row shows institution, PI and PD on one line, and search matches the PI', async () => {
  global.fetch.mockResolvedValue(response([row({ projectLeader: 'Ada Lovelace' }), row({ requestId: 'r2', requestNumber: '1002912', projectLeader: 'Grace Hopper' })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('University · PI: Ada Lovelace · PD: PD')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'hopper' } });
  expect(screen.queryByText(/#1002903/)).not.toBeInTheDocument();
  expect(screen.getByText(/#1002912/)).toBeInTheDocument();
});

test('an unscheduled request opens the status card', async () => {
  global.fetch.mockResolvedValue(response([row({ timing: { availability: 'missing' } })]));
  render(<StaffDeliberationsPanel {...props} />);
  expect(await screen.findByText('Not scheduled')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open request' })).toHaveAttribute('href', expect.stringMatching(/#deliberations-status$/));
});
