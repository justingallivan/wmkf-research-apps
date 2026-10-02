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
  // Honours init.signal the way real fetch does: an abort rejects a pending request with an AbortError.
  const abortable = (signal, promise) => new Promise((resolve, reject) => {
    const fail = () => reject(new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) { fail(); return; }
    signal?.addEventListener('abort', fail, { once: true });
    promise.then(resolve, reject);
  });
  global.fetch.mockImplementation((url, init = {}) => {
    const method = init.method || 'GET';
    const path = String(url);
    calls.push({ method, path, body: init.body ? JSON.parse(init.body) : undefined });
    const replies = routes.get(`${method} ${path}`);
    if (!replies) return Promise.reject(new Error(`unrouted ${method} ${path}`));
    const next = replies.length > 1 ? replies.shift() : replies[0];
    return abortable(init.signal, (async () => {
      const value = typeof next === 'function' ? await next() : next;
      return jsonResponse(value.status, value.body);
    })());
  });
  return server;
}

const FORM_OFF = 'Creating test Requests is switched off on this deployment.';
const scope = () => ({ signal: new AbortController().signal, isCurrent: () => true });

async function renderControl(server, { writeBlock = '', run = readyRun } = {}) {
  const view = render(<TestRequestStatusControl run={run} writeBlock={writeBlock} getScope={scope} />);
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
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
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
    expect(screen.getAllByText('Choose the field first.').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
    expect(screen.getByText('Choose the status to set.')).toBeTruthy();
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const group = screen.getByRole('group', { name: 'Confirm the status change' });
    expect(group.textContent).toContain('Request 1004000');
    expect(group.textContent).toContain('Phase II status from Not invited to Recommended');
    expect(group.textContent).toContain('It changes a real status on the test Request.');
    expect(server.count('POST', BASE)).toBe(0);
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 1, tracking: 2, payments: 0, jobs: 3 } });
    server.on('GET', BASE, statusBody([change()], { phase1: 100000000, phase2: 100000002 }));
    fireEvent.click(within(group).getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText('Status changed. Emails: 1, tracking rows: 2, payments: 0, background jobs: 3.');
    expect(server.bodies('POST', BASE)).toEqual([{ field: 'phase2', optionLabel: 'Recommended' }]);
    // The journal was reloaded and shows the change with labels, not numbers.
    await screen.findByText('Not invited to Recommended');
    expect(screen.getByText('Phase II status', { selector: 'td' })).toBeTruthy();
    // The option just set is now the current one: no second change can be started for it (the server would refuse a no-op).
    await screen.findAllByText('That status is already set. Choose a different one.');
    // A successful change must not be followed by a list of statuses that "can't be set".
    expect(screen.queryByText(/can't be set now/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Set status' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(screen.queryByRole('group', { name: 'Confirm the status change' })).toBeNull();
    expect(server.count('POST', BASE)).toBe(1);
  });

  test('an option the server marks blocked is disabled, and Set status refuses it with the reason even if it is chosen', async () => {
    const blockedOptions = {
      ...OPTIONS,
      phase2: OPTIONS.phase2.map((option) => (option.label === 'Recommended' ? { ...option, blocked: 'status_change_edge' } : option)),
    };
    const server = makeServer().on('GET', BASE, { status: 200, body: { ...statusBody().body, options: blockedOptions } });
    await renderControl(server);
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
    const option = within(screen.getByLabelText('New status')).getByRole('option', { name: 'Recommended (not available now)' });
    expect(option.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('New status'), { target: { value: option.value } });
    expect(screen.getByRole('button', { name: 'Set status' }).disabled).toBe(true);
    expect(screen.getAllByText(/isn't allowed from the Request's current Phase I and Phase II statuses/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(screen.queryByRole('group', { name: 'Confirm the status change' })).toBeNull();
    expect(server.count('POST', BASE)).toBe(0);
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
    server.on('GET', BASE, statusBody([change({ status: outcome === 'jobs_open' ? 'applied' : 'dispatched', completedAt: null })]), statusBody([change()]));
    fireEvent.click(check);
    await screen.findByText(/^Status changed\./);
    const bodies = server.bodies('POST', BASE);
    expect(bodies).toHaveLength(2);
    // Check again repeats the same field and label, and names the change so the server resumes it or refuses.
    expect(bodies[1]).toEqual({ ...bodies[0], changeId: CHANGE_ID });
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
    const field = screen.getByLabelText(/Command to close this change/);
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
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("An earlier change to this status created, or may have created, a payment or status-tracking row. Repeating it needs the command-line tool; it can't be done from this form."));
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
    server.on('GET', BASE, statusBody([change({ status: 'planned', completedAt: null, dispatchedAt: null })]), statusBody([change()]));
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await screen.findByText(/^Status changed\./);
    expect(server.bodies('POST', BASE)).toEqual([{ field: 'phase2', optionLabel: 'Recommended', changeId: CHANGE_ID }]);
  });

  describe('Check again is built only from the open change', () => {
    const openChange = (extra = {}) => change({ status: 'applied', completedAt: null, ...extra });
    const withOptions = (phase2) => ({ status: 200, body: { runId: RUN_ID, runStatus: 'ready', options: { ...OPTIONS, phase2 }, current: { phase1: 100000000, phase2: 100000001 }, changes: [openChange()] } });

    test('a label missing from the list disables it with the reason, and sends nothing', async () => {
      const server = makeServer().on('GET', BASE, withOptions([{ value: 100000001, label: 'Not invited' }]));
      await renderControl(server);
      const check = screen.getByRole('button', { name: 'Check again' });
      expect(check.disabled).toBe(true);
      expect(document.getElementById(check.getAttribute('aria-describedby')).textContent).toMatch(/missing or ambiguous/);
      expect(screen.getAllByText(/100000002 \(no longer in the list\)/).length).toBeGreaterThan(0);
      expect(server.count('POST', BASE)).toBe(0);
    });

    test('a duplicate label (any case) disables it too', async () => {
      const server = makeServer().on('GET', BASE, withOptions([{ value: 100000001, label: 'Not invited' }, { value: 100000002, label: 'Recommended' }, { value: 100000003, label: 'recommended' }]));
      await renderControl(server);
      expect(screen.getByRole('button', { name: 'Check again' }).disabled).toBe(true);
      expect(server.count('POST', BASE)).toBe(0);
    });

    test('a change closed elsewhere between load and click: one GET, zero POSTs, the message, the reloaded journal', async () => {
      const server = makeServer().on('GET', BASE, statusBody([openChange()]), statusBody([change()]));
      await renderControl(server);
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      await screen.findByText('That change is no longer open. The status list has been reloaded.');
      expect(server.count('GET', BASE)).toBe(2);
      expect(server.count('POST', BASE)).toBe(0);
      expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
      expect(screen.getByText('Complete')).toBeTruthy();
    });

    test('the normal path is one GET then one POST with the open change\'s field and label', async () => {
      const server = makeServer().on('GET', BASE, statusBody([openChange()]));
      await renderControl(server);
      const before = server.count('GET', BASE);
      server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 0 } });
      fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
      await screen.findByText(/^Status changed\./);
      const order = server.calls.slice(before).map((c) => c.method);
      expect(order.slice(0, 2)).toEqual(['GET', 'POST']);
      expect(server.bodies('POST', BASE)).toEqual([{ field: 'phase2', optionLabel: 'Recommended', changeId: CHANGE_ID }]);
    });
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
    await renderControl(server, { writeBlock: FORM_OFF });
    choose('phase2', 'Awarded');
    const set = screen.getByRole('button', { name: 'Set status' });
    expect(set.disabled).toBe(true);
    expect(document.getElementById(set.getAttribute('aria-describedby')).textContent).toMatch(/switched off/i);
    const recheck = screen.getByRole('button', { name: 'Recheck status effects' });
    expect(recheck.disabled).toBe(true);
    expect(document.getElementById(recheck.getAttribute('aria-describedby')).textContent).toMatch(/switched off/);
    expect(screen.getByText('Not invited to Recommended')).toBeTruthy();
  });

  test('with the form off, an open change\'s Check again is disabled with the reason', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change({ status: 'applied', completedAt: null })]));
    await renderControl(server, { writeBlock: FORM_OFF });
    const check = screen.getByRole('button', { name: 'Check again' });
    expect(check.disabled).toBe(true);
    expect(document.getElementById(check.getAttribute('aria-describedby')).textContent).toMatch(/switched off/);
  });

  test('a failed load says so and can be retried', async () => {
    const server = makeServer().on('GET', BASE, { status: 500, body: { error: 'x' } }, statusBody());
    render(<TestRequestStatusControl run={readyRun} writeBlock="" getScope={scope} />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Status field');
    expect(server.count('GET', BASE)).toBe(2);
  });

  test('a late answer after the scope is no longer current changes nothing', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    let live = true;
    render(<TestRequestStatusControl run={readyRun} writeBlock="" getScope={() => ({ signal: new AbortController().signal, isCurrent: () => live })} />);
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

const primaries = () => [...document.querySelectorAll('[data-primary="true"]')].filter((button) => !button.disabled);
const withEffects = (effects = {}) => ({
  status: 200,
  body: {
    ...statusBody().body,
    options: { phase1: OPTIONS.phase1, phase2: OPTIONS.phase2.map((option) => ({ ...option, blocked: null, effects: effects[option.label] ?? [] })) },
  },
});

describe('status choices and confirmation', () => {
  test('the field starts empty and the option select is disabled with the reason until a field is chosen', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    expect(screen.getByLabelText('Status field').value).toBe('');
    expect(screen.getByLabelText('New status').disabled).toBe(true);
    expect(document.getElementById('factory-option-reason').textContent).toBe('Choose the field first.');
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
    expect(screen.getByLabelText('New status').disabled).toBe(false);
  });

  test('blocked options are listed with their reasons in a details under the select; the status already set is not', async () => {
    const blocked = {
      status: 200,
      body: { ...statusBody().body, options: { phase1: OPTIONS.phase1, phase2: OPTIONS.phase2.map((o) => (o.label === 'Recommended' ? { ...o, blocked: 'status_change_edge', effects: null } : o)) } },
    };
    const server = makeServer().on('GET', BASE, blocked);
    await renderControl(server);
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
    const summary = screen.getByText("Why 1 status can't be set now");
    expect(summary.closest('details').open).toBe(false);
    const list = within(summary.closest('details'));
    expect(list.getByText(/Recommended/).parentElement.textContent).toMatch(/can create a payment or a status-tracking row/);
    // The status already set is marked in the menu, not listed here as a refusal.
    expect(list.queryByText(/Not invited/)).toBeNull();
  });

  test.each([
    ['Recommended', [], 'No emails, payments or tracking rows are expected from this change. It changes a real status on the test Request.'],
    ['Awarded', ['emails', 'tracking'], 'This change may: send emails; create a status-tracking row. It changes a real status on the test Request.'],
  ])('the confirmation for %s states the expected effects', async (label, effects, sentence) => {
    const server = makeServer().on('GET', BASE, withEffects({ [label]: effects }));
    await renderControl(server);
    choose('phase2', label);
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(screen.getByRole('group', { name: 'Confirm the status change' }).textContent).toContain(sentence);
  });

  test('with no destination number the confirmation says "this test Request", never the run id', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server, { run: { ...readyRun, destinationRequestNumber: null } });
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const text = screen.getByRole('group', { name: 'Confirm the status change' }).textContent;
    expect(text).toContain('Change this test Request:');
    expect(text).not.toContain(RUN_ID);
  });

  test('opening the confirmation moves focus to its question; Cancel returns focus to Set status; the group is not a second live region', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const group = screen.getByRole('group', { name: 'Confirm the status change' });
    expect(group.hasAttribute('aria-live')).toBe(false);
    await waitFor(() => expect(document.activeElement.textContent).toMatch(/^Change Request 1004000: .* on Production\?$/));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Set status' })));
  });

  test('exactly one enabled primary: Set status once a choice is made, then only "Yes, set this status" while confirming', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    expect(primaries()).toHaveLength(0);
    choose('phase2', 'Recommended');
    expect(primaries().map((b) => b.textContent)).toEqual(['Set status']);
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    expect(primaries().map((b) => b.textContent)).toEqual(['Yes, set this status']);
    expect(screen.getByRole('button', { name: 'Cancel' }).hasAttribute('data-primary')).toBe(false);
  });

  test('an open change makes Check again the one primary and opens the history; with none, the history is closed', async () => {
    const closed = makeServer().on('GET', BASE, statusBody([change()]));
    const first = await renderControl(closed);
    expect(screen.getByText('Status change history (1)').closest('details').open).toBe(false);
    first.unmount();
    const server = makeServer().on('GET', BASE, statusBody([change({ status: 'applied', completedAt: null })]));
    await renderControl(server);
    expect(screen.getByText('Status change history (1)').closest('details').open).toBe(true);
    expect(primaries().map((b) => b.textContent)).toEqual(['Check again']);
  });
});

describe('where the control appears', () => {
  const RUNS = '/api/admin/test-requests/runs';
  async function openRun(run, { formEnabled = true } = {}) {
    const server = makeServer();
    server.on('GET', RUNS, { status: 200, body: { runs: [run], formEnabled, target: 'production' } });
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

  test('with the form off, the section passes that on: Set status is disabled and the reason says switched off', async () => {
    await openRun(base, { formEnabled: false });
    await screen.findByLabelText('Status field');
    choose('phase2', 'Awarded');
    const set = screen.getByRole('button', { name: 'Set status' });
    expect(set.disabled).toBe(true);
    expect(document.getElementById(set.getAttribute('aria-describedby')).textContent).toMatch(/switched off/i);
  });

  test('with the run list failed to reload, the reason says so, never "switched off"', async () => {
    const server = await openRun(base);
    await screen.findByLabelText('Status field');
    server.on('GET', RUNS, { status: 500, body: { error: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }));
    await screen.findByRole('alert');
    choose('phase2', 'Awarded');
    const set = screen.getByRole('button', { name: 'Set status' });
    expect(set.disabled).toBe(true);
    const reason = document.getElementById(set.getAttribute('aria-describedby')).textContent;
    expect(reason).toMatch(/couldn't check whether this deployment allows/);
    expect(reason).not.toMatch(/switched off/i);
  });

  test('G2: after in_progress, switching to another run and back keeps the no-retry state and the abandon command', async () => {
    const runB = { ...base, runId: '22222222-2222-4222-8222-222222222222', testLabel: 'Other run' };
    const server = await openRun(base);
    server.on('GET', RUNS, { status: 200, body: { runs: [base, runB], formEnabled: true, target: 'production' } });
    server.on('GET', `${RUNS}/${runB.runId}`, { status: 200, body: { run: runB, resources: [], foundationCapturedAt: null } });
    server.on('GET', `${RUNS}/${runB.runId}/status`, statusBody());
    await screen.findByLabelText('Status field');
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const command = `node scripts/rehearse-test-request-sandbox.mjs --target=production --status-abandon=${RUN_ID} --change-id=${CHANGE_ID}`;
    server.on('GET', BASE, statusBody([change({ status: 'dispatched', completedAt: null })]));
    server.on('POST', BASE, { status: 202, body: { outcome: 'in_progress', code: 'status_change_in_progress', message: 'Do not retry.', changeId: CHANGE_ID, abandonCommand: command } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await screen.findByText('Do not retry.');
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }));
    await screen.findByRole('button', { name: 'Other run' });
    fireEvent.click(screen.getByRole('button', { name: 'Other run' }));
    await screen.findByRole('heading', { name: 'Other run' });
    fireEvent.click(screen.getByRole('button', { name: 'Status run' }));
    await screen.findByRole('heading', { name: 'Status run' });
    await waitFor(() => expect(screen.getByLabelText('New status').disabled).toBe(true));
    expect(screen.getByLabelText(/Command to close this change/).value).toBe(command);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(server.count('POST', BASE)).toBe(1);
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

describe('status control refinements', () => {
  test('after "Yes, set this status" focus lands on the result band; for a 202 that offers it, on "Check again"', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 200, body: { outcome: 'complete', emails: 0, tracking: 0, payments: 0, jobs: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    const band = await screen.findByText(/^Status changed\./);
    await waitFor(() => expect(document.activeElement).toBe(band));
    expect(band.getAttribute('tabindex')).toBe('-1');
  });

  test('a jobs_open answer moves focus to Check again', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('POST', BASE, { status: 202, body: { outcome: 'jobs_open', code: 'status_change_jobs_open', message: 'Still finishing.', changeId: CHANGE_ID } });
    server.on('GET', BASE, statusBody([change({ status: 'applied', completedAt: null })]));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Check again' })));
  });

  test('the confirmation says "may" and names Production; the in-progress banner uses plain wording', async () => {
    const server = makeServer().on('GET', BASE, withEffects({ Awarded: ['emails', 'tracking'] }));
    await renderControl(server);
    choose('phase2', 'Awarded');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    const text = screen.getByRole('group', { name: 'Confirm the status change' }).textContent;
    expect(text).toContain('This change may: send emails; create a status-tracking row.');
    expect(text).toContain('to Awarded on Production?');
  });

  test('the in-progress command label says what to check first, without "sender" jargon', async () => {
    const server = makeServer().on('GET', BASE, statusBody());
    await renderControl(server);
    choose('phase2', 'Recommended');
    fireEvent.click(screen.getByRole('button', { name: 'Set status' }));
    server.on('GET', BASE, statusBody([change({ status: 'dispatched', completedAt: null })]));
    server.on('POST', BASE, { status: 202, body: { outcome: 'in_progress', code: 'status_change_in_progress', message: 'Do not retry.', changeId: CHANGE_ID, abandonCommand: 'node x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Yes, set this status' }));
    const label = await screen.findByText(/^Command to close this change\./);
    expect(label.textContent).toBe('Command to close this change. Run it only after making sure nothing is still sending this change: no open form request and no command-line run.');
  });

  test('"Recheck status effects" sits outside the history disclosure, visible after a change; the journal stays inside', async () => {
    const server = makeServer().on('GET', BASE, statusBody([change()]));
    await renderControl(server);
    const button = screen.getByRole('button', { name: 'Recheck status effects' });
    expect(button.closest('details')).toBeNull();
    expect(screen.getByText('Status change history (1)').closest('details').contains(screen.getByRole('table'))).toBe(true);
  });

  test('copy that pointed at "the owner" now names the command-line tool', async () => {
    const server = makeServer().on('GET', BASE, { status: 200, body: { ...statusBody().body, options: { phase1: OPTIONS.phase1, phase2: OPTIONS.phase2.map((o) => (o.label === 'Recommended' ? { ...o, blocked: 'status_change_replay', effects: null } : o)) } } });
    await renderControl(server);
    fireEvent.change(screen.getByLabelText('Status field'), { target: { value: 'phase2' } });
    const list = screen.getByText(/can't be set now/).closest('details');
    expect(list.textContent).toContain('Repeating it needs the command-line tool');
    expect(list.textContent).not.toMatch(/owner/i);
  });
});
