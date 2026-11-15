/**
 * @jest-environment jsdom
 */
/**
 * "Mark ready for review" in the Factory status panel (owner, 2026-11-15): offered for a
 * prepared J27+ run once Phase I is Invited and Phase II is Pending Committee Review;
 * asks first (readiness cannot be undone); a check-again answer resumes without a new confirm.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import TestRequestStatusControl from '../../shared/components/admin/TestRequestStatusControl';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const STATUS = `/api/admin/test-requests/runs/${RUN_ID}/status`;
const READINESS = `/api/admin/test-requests/runs/${RUN_ID}/readiness`;
const run = { runId: RUN_ID, destinationRequestNumber: '1003517', destinationEnvironment: 'production', status: 'ready' };
const PAIR = { phase1: 100000003, phase2: 100000002 };
const OPTIONS = { phase1: [{ value: 100000003, label: 'Invited' }], phase2: [{ value: 100000002, label: 'Phase II Pending Committee Review' }] };
const readiness = (over = {}) => ({ applies: true, manifestStored: true, ready: false, attemptStatus: null, requiredPair: PAIR, ...over });
const statusBody = (r, current = PAIR, changes = []) => ({ runId: RUN_ID, runStatus: 'ready', options: OPTIONS, current, changes, readiness: r });
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const scope = () => ({ signal: new AbortController().signal, isCurrent: () => true });

function serve({ status: statusReplies, readiness: readinessReplies = [] }) {
  const calls = [];
  global.fetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push(`${method} ${url}`);
    const list = url === STATUS ? statusReplies : readinessReplies;
    const next = list.length > 1 ? list.shift() : list[0];
    return json(next.status, next.body);
  });
  return calls;
}

const markButton = () => screen.queryByRole('button', { name: 'Mark ready for review' });
async function renderControl() {
  render(<TestRequestStatusControl run={run} writeBlock="" getScope={scope} />);
  await screen.findByLabelText('Status field');
}

beforeEach(() => { global.fetch.mockReset(); });

test('not shown for a run that is not a prepared J27 fixture, nor before the run is ready', async () => {
  serve({ status: [{ status: 200, body: statusBody(readiness({ applies: false })) }] });
  await renderControl();
  expect(screen.queryByRole('heading', { name: 'Ready for review' })).toBeNull();
});

test('disabled with the reason until both statuses are set', async () => {
  serve({ status: [{ status: 200, body: statusBody(readiness(), { phase1: 100000003, phase2: null }) }] });
  await renderControl();
  expect(markButton().disabled).toBe(true);
  expect(screen.getByText('Set Phase I to Invited, then Phase II to Phase II Pending Committee Review, first.')).toBeTruthy();
});

test('asks first, then POSTs once and reports the Request is in the Workbench', async () => {
  const calls = serve({
    status: [{ status: 200, body: statusBody(readiness()) }, { status: 200, body: statusBody(readiness({ ready: true, attemptStatus: 'complete' })) }],
    readiness: [{ status: 200, body: { outcome: 'complete', ready: true, written: true } }],
  });
  await renderControl();
  fireEvent.click(markButton());
  expect(screen.getByText(/This can't be undone/)).toBeTruthy();
  expect(calls.filter((c) => c === `POST ${READINESS}`)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Yes, mark it ready' }));
  expect(await screen.findByText('Request 1003517 is ready for review. It now appears in the Workbench.')).toBeTruthy();
  expect(calls.filter((c) => c === `POST ${READINESS}`)).toHaveLength(1);
  expect(markButton()).toBeNull();
});

test('a check-again answer shows its message and offers Check again without a new confirm', async () => {
  const calls = serve({
    status: [{ status: 200, body: statusBody(readiness()) }, { status: 200, body: statusBody(readiness({ ready: true, attemptStatus: 'applied' })) }],
    readiness: [{ status: 202, body: { outcome: 'jobs_open', code: 'readiness_jobs_open', message: 'Marked ready. Background jobs on the Request are still finishing; check again.' } }],
  });
  await renderControl();
  fireEvent.click(markButton());
  fireEvent.click(screen.getByRole('button', { name: 'Yes, mark it ready' }));
  expect(await screen.findByText(/Background jobs on the Request are still finishing/)).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
  expect(screen.queryByRole('button', { name: 'Yes, mark it ready' })).toBeNull();
  await screen.findAllByText(/Background jobs/);
  expect(calls.filter((c) => c === `POST ${READINESS}`)).toHaveLength(2);
});

test.each([
  ['an attempt needing owner inspection', readiness({ attemptStatus: 'needs_attention' }), /needs the owner to inspect it/],
  ['stored files gone', readiness({ manifestStored: false }), /stored files are gone/],
])('disabled for %s', async (_label, state, reason) => {
  serve({ status: [{ status: 200, body: statusBody(state) }] });
  await renderControl();
  expect(markButton().disabled).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
});
