/**
 * @jest-environment jsdom
 */

import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import TestRequestStatusControl from '../../shared/components/admin/TestRequestStatusControl';
import TestRequestFactorySection from '../../shared/components/admin/TestRequestFactorySection';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const CHANGE_ID = '9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a';
const BASE = `/api/admin/test-requests/runs/${RUN_ID}/status`;

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const readyRun = { runId: RUN_ID, destinationRequestNumber: '1004000', destinationEnvironment: 'production', status: 'ready' };

const OPTIONS = {
  phase1: [{ value: 100000000, label: 'Pending committee review' }, { value: 100000003, label: 'Invited' }],
  phase2: [{ value: 100000001, label: 'Not invited' }, { value: 100000002, label: 'Recommended' }, { value: 100000003, label: 'Awarded' }],
};

const change = (overrides = {}) => ({
  changeId: CHANGE_ID, sequence: 1, field: 'wmkf_phaseiistatus', optionBefore: 100000001, optionAfter: 100000002, status: 'complete',
  dispatchedAt: '2026-10-01T12:00:00.000Z', completedAt: '2026-10-01T12:05:00.000Z', createdAt: '2026-10-01T11:59:00.000Z', ...overrides,
});

const statusBody = (changes = [], current = { phase1: 100000000, phase2: 100000001 }) => ({
  status: 200, body: { runId: RUN_ID, runStatus: 'ready', options: OPTIONS, current, changes },
});

function makeServer() {
  const routes = new Map();
  const calls = [];
  const server = {
    calls,
    on(method, path, ...replies) { routes.set(`${method} ${path}`, replies); return server; },
    bodies(method, path) { return calls.filter((c) => c.method === method && c.path === path).map((c) => c.body); },
    count(method, path) { return calls.filter((c) => c.method === method && c.path === path).length; },
  };
  global.fetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url);
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const replies = routes.get(`${method} ${path}`);
    if (!replies) throw new Error(`unrouted ${method} ${path}`);
    const next = replies.length > 1 ? replies.shift() : replies[0];
    const value = typeof next === 'function' ? await next() : next;
    return jsonResponse(value.status, value.body);
  });
  return server;
}

const scope = () => ({ signal: new AbortController().signal, isCurrent: () => true });

async function renderControl(server, { formEnabled = true, run = readyRun } = {}) {
  const view = render(<TestRequestStatusControl run={run} formEnabled={formEnabled} getScope={scope} />);
  await screen.findByLabelText('Status field');
  return view;
}

const choose = (field, label) => {
  fireEvent.change(screen.getByLabelText('Status field'), { target: { value: field } });
  const option = within(screen.getByLabelText('New status')).getByRole('option', { name: label });
  fireEvent.change(screen.getByLabelText('New status'), { target: { value: option.value } });
};

beforeEach(() => { global.fetch.mockReset(); });

describe('status control', () => {
  test('the option equal to the current value is disabled and says so', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    const already = within(screen.getByLabelText('New status')).getByRole('option', { name: 'Not invited (already set)' });
    expect(already.disabled).toBe(true);
    expect(within(screen.getByLabelText('New status')).getByRole('option', { name: 'Recommended' }).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase1' } });
    expect(within(screen.getByLabelText('New status')).getByRole('option', { name: 'Pending committee review (already set)' }).disabled).toBe(true);
  });

  test('Set status needs a choice, then an inline confirmation naming the Request, field, old and new labels; only the second click sends', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    const setButton = screen.getByRole('button', { name: 'Set status' });
    expect(setButton.disabled).toBe(true);
    expect(screen.getByText('Choose the status to set.')).toBeTruthy();
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const group = screen.getByRole('group', { name: 'Confirm the status change' });
    expect(group.textContent).toContain('Request 1004000');
    expect(group.textContent).toContain('Phase II status from Not invited to Recommended');
    expect(group.textContent).toContain('This changes a real status on the test Request and can send emails or create payment and tracking rows.');
    expect(server.count('POST', BASE)).toBe(0);
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 1, tracking: 2, payments: 0, jobs: 3 } });
    server.on('GET', BASE, statusBody([change()], { phase1: 100000000, phase2: 100000002 }));
    fireEvent.click(within(group).getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText('Status changed. Emails: 1, tracking rows: 2, payments: 0, background jobs: 3.');
    expect(server.bodies('POST', BASE)).toEqual([{ field: 'phase2', optionLabel: 'Recommended' }]);
    // The journal was reloaded and shows the change with labels, not numbers.
    await screen.findByText('Not invited to Recommended');
    expect(screen.getByText('Phase II status', { selector: 'td' })).toBeTruthy();
  });

  test('Cancel leaves nothing sent', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm the status change' })).toBeNull();
    expect(server.count('POST', BASE)).toBe(0);
  });

  test.each([
    ['jobs_open', 'The change was written. Background jobs on the Request are still finishing; check again.'],
    ['unconfirmed', 'The change was sent but its result could not be read. Check again; do not start a different change.'],
  ])('202 %s shows the message and Check again repeats the SAME body', async (outcome, message) => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 202, body: { outcome, code: `status_change_${outcome}`, message, changeId: CHANGE_ID } });
    server.on('GET', BASE, statusBody([change({ status: outcome === 'jobs_open' ? 'applied' : 'dispatched', completedAt: null })]));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText(message);
    const check = await screen.findByRole('button', { name: 'Check again' });
    // The change is open: the selects are locked to it and Set status is gone.
    expect(screen.getByLabelText('Status field').disabled).toBe(true);
    expect(screen.getByLabelText('New status').disabled).toBe(true);
    expect(screen.getByLabelText('New status').value).toBe('100000002');
    expect(screen.queryByRole('button', { name: 'Set status' })).toBeNull();
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 1 } });
    server.on('GET', BASE, statusBody([change()]));
    fireEvent.click(check);
    await screen.findByText(/^Status changed\./);
    const bodies = server.bodies('POST', BASE);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toEqual(bodies[0]);
  });

  test('202 in_progress shows the message and the read-only command with Copy, and offers no retry', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const command = `node scripts/rehearse-test-request-sandbox.mjs --target=production --status-abandon=${RUN_ID} --change-id=${CHANGE_ID}`;
    const message = 'This change is being sent, or was sent and its result is not yet known. Do not retry.';
    server.on('POST', BASE, { status: 202, body: { outcome: 'in_progress', code: 'status_change_in_progress', message, changeId: CHANGE_ID, abandonCommand: command } });
    server.on('GET', BASE, statusBody([change({ status: 'dispatched', completedAt: null })]));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText(message);
    // The journal was reloaded, so the sent change is open and the selects are locked; still no retry.
    await waitFor(() => expect(screen.getByLabelText('New status').disabled).toBe(true));
    const field = screen.getByLabelText(/Owner command to close it/);
    expect(field.value).toBe(command);
    expect(field.readOnly).toBe(true);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    const writeText = jest.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    await screen.findByText('Copied.');
    expect(writeText).toHaveBeenCalledWith(command);
    // Even when the journal now shows the open (sent) change, a retry is never offered after in_progress.
    server.on('POST', `${BASE}/recheck`, { status: 200, body: { sequence: 1, status: 'dispatched', ok: true, openJobs: 0, failedJobs: 0, lateEffects: { emails: 0, tracking: 0, payments: 0 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Recheck status effects' }));
    await screen.findByText('No late effects, and no open or failed background jobs.');
    await waitFor(() => expect(screen.getByLabelText('New status').disabled).toBe(true));
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(server.count('POST', BASE)).toBe(1);
  });

  test.each(['status_change_concurrent', 'status_change_open'])('409 %s reloads the journal and shows the copy', async (code) => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 409, body: { error: 'raw', code } });
    server.on('GET', BASE, statusBody([change({ status: 'applied', completedAt: null })]));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/journal has been reloaded/));
    await waitFor(() => expect(server.count('GET', BASE)).toBe(2));
    await screen.findByRole('button', { name: 'Check again' });
  });

  test('status_change_replay shows the owner copy and sends nothing more', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 409, body: { error: 'raw', code: 'status_change_replay' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the owner; it can't be done from this form."));
    expect(server.count('POST', BASE)).toBe(1);
  });

  test('an open change loaded from the journal locks the selects and the only action is Check again, which sends that change', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change({ status: 'planned', completedAt: null, dispatchedAt: null })]));
    await renderControl(server);
    expect(screen.getByLabelText('Status field').value).toBe('phase2');
    expect(screen.getByLabelText('New status').value).toBe('100000002');
    expect(screen.getByLabelText('Status field').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Set status' })).toBeNull();
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 0 } });
    server.on('GET', BASE, statusBody([change()]));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText(/^Status changed\./);
    expect(server.bodies('POST', BASE)).toEqual([{ field: 'phase2', optionLabel: 'Recommended' }]);
  });

  test('no control sends rerun, and none is named for it', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change({ status: 'needs_attention' })]));
    await renderControl(server);
    expect(screen.queryByRole('button', { name: /rerun|retry|again/i })).toBeNull();
    choose('phase1', 'Invited');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText(/^Status changed\./);
    for (const body of server.bodies('POST', BASE)) expect(Object.keys(body).sort()).toEqual(['field', 'optionLabel']);
  });

  test('Recheck status effects shows late effects and open or failed jobs', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change()]));
    await renderControl(server);
    server.on('POST', `${BASE}/recheck`, { status: 200, body: { sequence: 1, status: 'complete', ok: false, openJobs: 1, failedJobs: 2, lateEffects: { emails: 3, tracking: 0, payments: 1 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Recheck status effects' }));
    await screen.findByText('Late emails: 3, tracking rows: 0, payments: 1. Open jobs: 1, failed jobs: 2.');
  });

  test('with the form off, Set status, Check again and Recheck are disabled with the reason; the journal still loads', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change()]));
    await renderControl(server, { formEnabled: false });
    choose('phase2', 'Awarded');
    const set = screen.getByRole('button', { name: 'Set status' });
    expect(set.disabled).toBe(true);
    expect(document.getElementById(set.getAttribute('aria-describedby')).textContent).toMatch(/switched off/);
    const recheck = screen.getByRole('button', { name: 'Recheck status effects' });
    expect(recheck.disabled).toBe(true);
    expect(document.getElementById(recheck.getAttribute('aria-describedby')).textContent).toMatch(/switched off/);
    expect(screen.getByText('Not invited to Recommended')).toBeTruthy();
  });

  test('with the form off, an open change\'s Check again is disabled with the reason', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change({ status: 'applied', completedAt: null })]));
    await renderControl(server, { formEnabled: false });
    const check = screen.getByRole('button', { name: 'Check again' });
    expect(check.disabled).toBe(true);
    expect(document.getElementById(check.getAttribute('aria-describedby')).textContent).toMatch(/switched off/);
  });

  test('a failed load says so and can be retried', async () => {
    const server = makeServer().on('GET', BASE, { status: 500, body: { error: 'x' } }, statusBody());
    render(<TestRequestStatusControl run={readyRun} formEnabled getScope={scope} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Status field');
    expect(server.count('GET', BASE)).toBe(2);
  });

  test('a late answer after the scope is no longer current changes nothing', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    let live = true;
    render(<TestRequestStatusControl run={readyRun} formEnabled getScope={() => ({ signal: new AbortController().signal, isCurrent: () => live })} />);
    await screen.findByLabelText('Status field');
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    let release;
    server.on('POST', BASE, () => new Promise((resolve) => { release = () => resolve({ status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 0 } }); }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await waitFor(() => expect(server.count('POST', BASE)).toBe(1));
    live = false;
    await act(async () => { release(); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText(/^Status changed\./)).toBeNull();
    expect(server.count('GET', BASE)).toBe(1);
  });
});

describe('where the control appears', () => {
  const RUNS = '/api/admin/test-requests/runs';
  async function openRun(run) {
    const server = makeServer();
    server.on('GET', RUNS, { status: 200, body: { runs: [run], formEnabled: true, target: 'production' } });
    server.on('GET', `${RUNS}/${run.runId}`, { status: 200, body: { run, resources: [], foundationCapturedAt: null } });
    server.on('GET', `${RUNS}/${run.runId}/status`, statusBody());
    render(<TestRequestFactorySection />);
    await screen.findByText(run.testLabel);
    fireEvent.click(screen.getByRole('button', { name: run.testLabel }));
    await screen.findByRole('heading', { name: run.testLabel });
    return server;
  }
  const base = { ...readyRun, testLabel: 'Status run', sourceRequestNumber: '1001000', currentStep: 'verify', stepIndex: 6, createdAt: '2026-10-01T10:00:00.000Z' };

  test('shown for a ready production run', async () => {
    const server = await openRun(base);
    await screen.findByLabelText('Status field');
    expect(server.count('GET', BASE)).toBe(1);
  });

  test.each([
    ['a ready sandbox run', { destinationEnvironment: 'sandbox' }],
    ['a production run that is not ready', { status: 'creating' }],
  ])('not shown, and its status is never requested, for %s', async (_name, overrides) => {
    const server = await openRun({ ...base, ...overrides });
    expect(screen.queryByText('Phase I and Phase II status')).toBeNull();
    expect(screen.queryByLabelText('Status field')).toBeNull();
    expect(server.count('GET', BASE)).toBe(0);
  });
});
