/**
 * @jest-environment jsdom
 */
/**
 * "Prepare for review" for prepared J27 test Requests (owner, 2026-11-15): one ordered action
 * (Phase I Invited → Phase II Pending Committee Review → ready), the general menus under More options,
 * a plain stop for a Request set in the wrong order, and Continue that resumes the same open change.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import TestRequestStatusControl from '../../shared/components/admin/TestRequestStatusControl';
import { preparationState } from '../../shared/components/admin/TestRequestPrepareForReview';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CHANGE_ID = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
const STATUS = `/api/admin/test-requests/runs/${RUN_ID}/status`;
const READINESS = `/api/admin/test-requests/runs/${RUN_ID}/readiness`;
const run = { runId: RUN_ID, destinationRequestNumber: '1003517', destinationEnvironment: 'production', status: 'ready' };
const INVITED = 100000003;
const PCR1 = 100000000;
const PCR2 = 100000002;
const PAIR = { phase1: INVITED, phase2: PCR2 };
const OPTIONS = (blockInvited = null) => ({
  phase1: [{ value: PCR1, label: 'Pending Committee Review', blocked: null }, { value: INVITED, label: 'Invited', blocked: blockInvited }],
  phase2: [{ value: PCR2, label: 'Phase II Pending Committee Review', blocked: null }],
});
const readiness = (over = {}) => ({ applies: true, manifestStored: true, ready: false, attemptStatus: null, requiredPair: PAIR, ...over });
const body = ({ current = { phase1: null, phase2: null }, r = readiness(), changes = [], blockInvited = null } = {}) => ({
  status: 200, body: { runId: RUN_ID, runStatus: 'ready', options: OPTIONS(blockInvited), current, changes, readiness: r },
});
const json = (status, b) => ({ ok: status >= 200 && status < 300, status, json: async () => b });
const scope = () => ({ signal: new AbortController().signal, isCurrent: () => true });

function serve({ status, posts = {} }) {
  const calls = [];
  global.fetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
    const list = method === 'GET' ? status : posts[url];
    const next = list.length > 1 ? list.shift() : list[0];
    return json(next.status, next.body);
  });
  return calls;
}
const posts = (calls) => calls.filter((c) => c.method === 'POST').map((c) => (c.url === READINESS ? 'readiness' : `${c.body.field}:${c.body.optionLabel}${c.body.changeId ? ':resume' : ''}`));
const complete = { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 1 } };

async function renderControl() {
  render(<TestRequestStatusControl run={run} writeBlock="" getScope={scope} />);
  await screen.findByLabelText('Status field');
}
const prepareButton = () => screen.queryByRole('button', { name: /^(Prepare for review|Continue)$/ });

beforeEach(() => { global.fetch.mockReset(); });

test('a non-J27 run keeps the status menus as they were, with no Prepare for review', async () => {
  serve({ status: [body({ r: readiness({ applies: false }) })] });
  await renderControl();
  expect(screen.queryByRole('heading', { name: 'Prepare for review' })).toBeNull();
  expect(screen.queryByText(/More options/)).toBeNull();
});

test('asks once, then runs Phase I, Phase II and readiness in order and reports the Workbench', async () => {
  const calls = serve({
    status: [
      body(),
      body({ current: { phase1: INVITED, phase2: null } }),
      body({ current: PAIR }),
      body({ current: PAIR, r: readiness({ ready: true, attemptStatus: 'complete' }) }),
    ],
    posts: { [STATUS]: [complete], [READINESS]: [{ status: 200, body: { outcome: 'complete', ready: true, written: true } }] },
  });
  await renderControl();
  expect(screen.getByText(/More options: set any Phase I or Phase II status/)).toBeTruthy();
  fireEvent.click(prepareButton());
  expect(screen.getByText(/can't be undone/)).toBeTruthy();
  expect(posts(calls)).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, prepare it' }));
  expect(await screen.findByText('Request 1003517 is ready for review. It now appears in the Workbench.')).toBeTruthy();
  expect(posts(calls)).toEqual(['phase1:Invited', 'phase2:Phase II Pending Committee Review', 'readiness']);
});

test('a check-again answer stops; Continue resumes the same open change without asking again', async () => {
  const open = { changeId: CHANGE_ID, sequence: 1, field: 'wmkf_phaseistatus', optionBefore: null, optionAfter: INVITED, status: 'applied', dispatchedAt: '2026-11-15T22:00:00Z' };
  const calls = serve({
    status: [
      body(),
      body({ changes: [open] }),
      body({ current: { phase1: INVITED, phase2: null }, changes: [{ ...open, status: 'complete' }] }),
      body({ current: PAIR }),
      body({ current: PAIR, r: readiness({ ready: true, attemptStatus: 'complete' }) }),
    ],
    posts: {
      [STATUS]: [{ status: 202, body: { outcome: 'jobs_open', code: 'status_change_jobs_open', message: 'The change was written. Background jobs on the Request are still finishing; check again.', changeId: CHANGE_ID } }, complete],
      [READINESS]: [{ status: 200, body: { outcome: 'complete', ready: true, written: true } }],
    },
  });
  await renderControl();
  fireEvent.click(prepareButton());
  fireEvent.click(screen.getByRole('button', { name: 'Yes, prepare it' }));
  expect(await screen.findByText(/still finishing; check again\. Press Continue to pick up from here\./)).toBeTruthy();
  await waitFor(() => expect(prepareButton().textContent).toBe('Continue'));
  fireEvent.click(prepareButton());
  expect(screen.queryByRole('button', { name: 'Yes, prepare it' })).toBeNull();
  expect(await screen.findByText(/It now appears in the Workbench/)).toBeTruthy();
  expect(posts(calls)).toEqual(['phase1:Invited', 'phase1:Invited:resume', 'phase2:Phase II Pending Committee Review', 'readiness']);
});

test('a Request set in the wrong order says it cannot be prepared and offers no button', async () => {
  const calls = serve({ status: [body({ current: { phase1: PCR1, phase2: PCR2 }, blockInvited: 'status_change_edge' })] });
  await renderControl();
  expect(screen.getByText(/Phase II was set before Phase I was Invited/)).toBeTruthy();
  expect(prepareButton()).toBeNull();
  expect(posts(calls)).toEqual([]);
});

test('readiness needing attention, or stored files gone, stops with the reason', () => {
  const data = (r, current = PAIR) => ({ options: OPTIONS(), current, changes: [], readiness: r });
  expect(preparationState(data(readiness({ attemptStatus: 'needs_attention' }))).blocked).toMatch(/needs the owner to inspect it/);
  expect(preparationState(data(readiness({ manifestStored: false }))).blocked).toMatch(/stored files are gone/);
  expect(preparationState(data(readiness({ attemptStatus: 'applied', ready: true }))).readinessResumable).toBe(true);
  expect(preparationState(data(readiness({ attemptStatus: 'applied', ready: true }))).blocked).toBe('');
});

test('readiness unavailable keeps the menus and says why Prepare for review is missing', async () => {
  serve({ status: [{ status: 200, body: { runId: RUN_ID, runStatus: 'ready', options: OPTIONS(), current: { phase1: null, phase2: null }, changes: [], readiness: { unavailable: true } } }] });
  await renderControl();
  expect(screen.getByText(/Prepare for review isn't shown/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Set status' })).toBeTruthy();
});

test('an already prepared Request shows it is in the Workbench and offers no action', async () => {
  serve({ status: [body({ current: PAIR, r: readiness({ ready: true, attemptStatus: 'complete' }) })] });
  await renderControl();
  expect(screen.getByText('Request 1003517 is ready for review and appears in the Workbench.')).toBeTruthy();
  expect(prepareButton()).toBeNull();
});

test('a status change needing attention stops everything (Codex); a no-write 412 does not', () => {
  const failed = (error) => ({ options: OPTIONS(), current: { phase1: INVITED, phase2: null }, readiness: readiness(), changes: [{ changeId: CHANGE_ID, sequence: 1, field: 'wmkf_phaseistatus', status: 'needs_attention', error }] });
  expect(preparationState(failed('status_change_effects')).blocked).toMatch(/status change on this Request needs the owner/);
  expect(preparationState(failed("The Request changed since it was read (412); nothing was written.")).blocked).toBe('');
});

test('an unrelated open change, then all three steps: four calls end in success, not "stopped" (Codex)', async () => {
  const other = { changeId: CHANGE_ID, sequence: 1, field: 'wmkf_phaseistatus', optionBefore: null, optionAfter: PCR1, status: 'applied', dispatchedAt: '2026-11-15T22:00:00Z' };
  const done = { ...other, status: 'complete' };
  const calls = serve({
    status: [
      body({ changes: [other] }),
      body({ current: { phase1: PCR1, phase2: null }, changes: [done] }),
      body({ current: { phase1: INVITED, phase2: null }, changes: [done] }),
      body({ current: PAIR, changes: [done] }),
      body({ current: PAIR, changes: [done], r: readiness({ ready: true, attemptStatus: 'complete' }) }),
    ],
    posts: { [STATUS]: [complete], [READINESS]: [{ status: 200, body: { outcome: 'complete', ready: true, written: true } }] },
  });
  await renderControl();
  fireEvent.click(prepareButton());
  fireEvent.click(screen.getByRole('button', { name: 'Yes, prepare it' }));
  expect(await screen.findByText('Request 1003517 is ready for review. It now appears in the Workbench.')).toBeTruthy();
  expect(screen.queryByText(/Stopped after the expected steps/)).toBeNull();
  expect(posts(calls)).toEqual(['phase1:Pending Committee Review:resume', 'phase1:Invited', 'phase2:Phase II Pending Committee Review', 'readiness']);
});

test('a ready Request with a later open or failed status change is not shown as finished (Codex round 2)', async () => {
  const later = (status, error = null) => ({ changeId: CHANGE_ID, sequence: 3, field: 'wmkf_phaseiistatus', optionBefore: PCR2, optionAfter: PCR2 + 2, status, error, dispatchedAt: '2026-11-15T23:00:00Z' });
  const ready = readiness({ ready: true, attemptStatus: 'complete' });
  const state = (change) => preparationState({ options: OPTIONS(), current: PAIR, readiness: ready, changes: [change] });
  expect(state(later('needs_attention', 'status_change_effects'))).toMatchObject({ allDone: false, blocked: expect.stringMatching(/needs the owner/) });
  expect(state(later('applied'))).toMatchObject({ allDone: false, finished: true, laterChange: expect.stringMatching(/still open/) });
  serve({ status: [body({ current: PAIR, r: ready, changes: [later('applied')] })] });
  await renderControl();
  expect(screen.getByText(/A later status change on this Request is still open/)).toBeTruthy();
  expect(screen.queryByText(/is ready for review and appears in the Workbench/)).toBeNull();
  expect(prepareButton()).toBeNull();
});
