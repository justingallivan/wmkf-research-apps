/**
 * @jest-environment jsdom
 */

import {
  act, fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import TestRequestFactorySection from '../../shared/components/admin/TestRequestFactorySection';
import { BLIP_COPY } from '../../shared/components/admin/test-request-factory-copy';

const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';
const BASE = '/api/admin/test-requests/runs';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const makeRun = (overrides = {}) => ({
  runId: RUN_A,
  testLabel: 'Run A',
  sourceRequestNumber: '1001000',
  destinationRequestNumber: null,
  destinationEnvironment: 'production',
  status: 'prepared',
  currentStep: 'fence_source',
  stepIndex: 0,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const SUMMARY = {
  dataverseHost: 'prod.example', requestNumber: '1001000', requestId: 'r', revision: '1', fiscalYear: 'December 2026', meetingDate: '2026-12-01',
  hasPurpose: true, hasRequestedAmount: true,
  documents: [{ kind: 'projectDescription', name: 'ProjectDescription.pdf', size: 2048, sha256Prefix: 'abcd1234' }],
};

/** A tiny router over the global fetch mock: queue replies per "METHOD path"; the last one repeats. */
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
  // A reply may carry `bodyGate`, a promise the body read waits on (headers received, body still streaming).
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
      return {
        ok: value.status >= 200 && value.status < 300,
        status: value.status,
        json: async () => { if (value.bodyGate) await value.bodyGate; return value.body; },
      };
    })());
  });
  return server;
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

const listBody = (runs, extra = {}) => ({ status: 200, body: { runs, formEnabled: true, target: 'production', ...extra } });
const runBody = (run, extra = {}) => ({ status: 200, body: { run, resources: [], foundationCapturedAt: null, ...extra } });

let uuidCounter = 0;
beforeAll(() => {
  // jsdom has no crypto.randomUUID; the component requires it, so the test supplies a counter.
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { randomUUID: () => `key-${++uuidCounter}` } });
});
beforeEach(() => { uuidCounter = 0; global.fetch.mockReset(); localStorage.clear(); sessionStorage.clear(); });

async function renderSection(server, runs = [makeRun()], extra = {}) {
  server.on('GET', BASE, listBody(runs, extra));
  const view = render(<TestRequestFactorySection />);
  await screen.findByText(runs.length ? runs[0].testLabel : 'No runs yet.');
  return view;
}

const selectRun = async (label) => {
  fireEvent.click(screen.getByRole('button', { name: label }));
  await screen.findByRole('heading', { name: label });
};

async function lookup(server, number = '1001000', response = { status: 200, body: { draftId: DRAFT_ID, summary: SUMMARY, defaults: { fiscalYear: 'December 2026', meetingDate: '2026-12-01' } } }) {
  server.on('POST', `${BASE}/source`, response);
  fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: 'Look up source' }));
}

const fillConfirm = ({ label = 'My test', typed = '1001000' } = {}) => {
  fireEvent.change(screen.getByLabelText('Test label'), { target: { value: label } });
  fireEvent.change(screen.getByLabelText(/Type Request number/), { target: { value: typed } });
};

const confirmButton = () => screen.getByRole('button', { name: /Confirm and reserve run/ });

describe('on load', () => {
  test('lists the runs with their words, and the form-off banner disables every write control with its reason while read controls work', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun()));
    await renderSection(server, [makeRun()], { formEnabled: false, target: 'sandbox' });
    expect(screen.getByText('Creating test Requests is switched off on this deployment. Existing runs can still be inspected.', { selector: '[role="status"]' })).toBeTruthy();
    expect(screen.getByText('Reserved, not started')).toBeTruthy();
    // Look up (needs a valid number first so the reason is the form-off one)
    fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1001000' } });
    expect(screen.getByRole('button', { name: 'Look up source' }).disabled).toBe(true);
    expect(screen.getAllByText(/switched off on this deployment/i).length).toBeGreaterThan(1);
    // Read control: opening a run still works; Start is disabled with a reason.
    await selectRun('Run A');
    const start = screen.getByRole('button', { name: 'Start production run' });
    expect(start.disabled).toBe(true);
    expect(document.getElementById(start.getAttribute('aria-describedby')).textContent).toMatch(/switched off/i);
    expect(screen.getByRole('button', { name: 'Download run files' }).disabled).toBe(false);
  });

  test('a failed list load says so and offers a reload', async () => {
    const server = makeServer();
    server.on('GET', BASE, { status: 500, body: { error: 'The Test Request run could not be processed.' } }, listBody([makeRun()]));
    render(<TestRequestFactorySection />);
    expect((await screen.findByRole('alert')).textContent).toBe(BLIP_COPY);
    fireEvent.click(screen.getByRole('button', { name: 'Reload list' }));
    await screen.findByText('Run A');
  });

  test('reports the target to the host', async () => {
    const server = makeServer();
    server.on('GET', BASE, listBody([], { target: 'sandbox' }));
    const onTarget = jest.fn();
    render(<TestRequestFactorySection onTarget={onTarget} />);
    await waitFor(() => expect(onTarget).toHaveBeenCalledWith('sandbox'));
  });
});

describe('source lookup', () => {
  test('success shows the summary and documents', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server);
    expect(screen.getByText('Reading the source Request and checking its documents. This can take a few minutes.')).toBeTruthy();
    await screen.findByRole('heading', { name: 'Source Request 1001000' });
    expect(screen.getByText('ProjectDescription.pdf')).toBeTruthy();
    expect(screen.getByText('2.0 KB')).toBeTruthy();
    expect(server.bodies('POST', `${BASE}/source`)).toEqual([{ sourceRequestNumber: '1001000' }]);
    expect(screen.getByLabelText('Fiscal year').value).toBe('December 2026');
  });

  test('the number must be 1 to 10 digits, and the button says so', async () => {
    const server = makeServer();
    await renderSection(server, []);
    fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '12ab' } });
    expect(screen.getByRole('button', { name: 'Look up source' }).disabled).toBe(true);
    expect(screen.getByText('Enter a Request number of 1 to 10 digits.')).toBeTruthy();
  });

  test.each([
    ['factory_source_not_found', 404, 'No Request has that number. Check the number and try again.'],
    ['factory_source_ambiguous', 409, /More than one Request has that number/],
    ['test_request_preview_file_too_large', 413, "This Request's documents are too large to clone here (limit 25 MB per file, 50 MB in total, 7 files). Choose a smaller source Request. Nothing was created."],
    ['test_request_preview_total_size_exceeded', 413, /limit 25 MB per file, 50 MB in total, 7 files/],
    ['test_request_preview_file_count_exceeded', 413, /limit 25 MB per file, 50 MB in total, 7 files/],
    ['factory_deadline_exceeded', 504, "There wasn't enough time left to start that safely, so nothing was started. Try again."],
    ['factory_form_disabled', 503, /switched off on this deployment/i],
  ])('%s renders its copy, not the code', async (code, status, expected) => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server, '1001000', { status, body: { error: 'raw server text', code } });
    const alert = await screen.findByRole('alert');
    if (typeof expected === 'string') expect(alert.textContent).toBe(expected); else expect(alert.textContent).toMatch(expected);
    expect(alert.textContent).not.toBe(code);
  });

  test('the generic 500 and a 504 with no code render the blip copy', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server, '1001000', { status: 500, body: { error: 'The Test Request run could not be processed.' } });
    expect((await screen.findByRole('alert')).textContent).toBe(BLIP_COPY);
    server.on('POST', `${BASE}/source`, { status: 504, body: {} });
    fireEvent.click(screen.getByRole('button', { name: 'Look up source' }));
    await waitFor(() => expect(server.count('POST', `${BASE}/source`)).toBe(2));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(BLIP_COPY));
  });
});

describe('confirm', () => {
  const reserved = (extra = {}) => ({ status: 201, body: { run: makeRun({ testLabel: 'My test', ...extra }), created: true } });

  test('stays disabled, with the reason, until label, both cycle fields and the exact typed number are present', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    const reasonOf = () => document.getElementById(confirmButton().getAttribute('aria-describedby')).textContent;
    // The label is pre-filled; clearing it shows the reason.
    expect(screen.getByLabelText('Test label').value).toBe('Test clone of Request 1001000');
    fireEvent.change(screen.getByLabelText('Test label'), { target: { value: '' } });
    expect(confirmButton().disabled).toBe(true);
    expect(reasonOf()).toBe('Enter a test label.');
    fireEvent.change(screen.getByLabelText('Test label'), { target: { value: 'My test' } });
    expect(reasonOf()).toBe('Type Request number 1001000 exactly to confirm.');
    fireEvent.change(screen.getByLabelText(/Type Request number/), { target: { value: '1001000 ' } });
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Fiscal year'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Type Request number/), { target: { value: '1001000' } });
    expect(reasonOf()).toBe('Enter both the fiscal year and the meeting date.');
    fireEvent.change(screen.getByLabelText('Fiscal year'), { target: { value: 'December 2026' } });
    expect(confirmButton().disabled).toBe(false);
    expect(screen.getByText(/Confirm reserves the run and creates nothing in Dataverse yet/)).toBeTruthy();
    expect(server.count('POST', BASE)).toBe(0);
  });

  test('sends draftId, the key, the typed number, the label and both cycle values; 201 selects the run', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm({ label: '  My test  ' });
    server.on('POST', BASE, reserved());
    fireEvent.click(confirmButton());
    await screen.findByRole('heading', { name: 'My test' });
    expect(server.bodies('POST', BASE)).toEqual([{
      draftId: DRAFT_ID, idempotencyKey: 'key-1', confirmSourceRequestNumber: '1001000', testLabel: 'My test', fiscalYear: 'December 2026', meetingDate: '2026-12-01',
    }]);
    expect(screen.getByText('Nothing has been created in Dataverse yet. Start it from the run panel below.')).toBeTruthy();
  });

  test('a 200 same-key retry also selects the run', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 200, body: { run: makeRun({ testLabel: 'My test' }), created: false } });
    fireEvent.click(confirmButton());
    await screen.findByRole('heading', { name: 'My test' });
  });

  test('the key is kept across a failed Confirm and a retry, and is new after a second lookup and after Create another', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 500, body: { error: 'The Test Request run could not be processed.' } }, reserved());
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(BLIP_COPY));
    fireEvent.click(confirmButton());
    await screen.findByRole('button', { name: 'Create another' });
    expect(server.bodies('POST', BASE).map((b) => b.idempotencyKey)).toEqual(['key-1', 'key-1']);

    // Create another: a new key.
    fireEvent.click(screen.getByRole('button', { name: 'Create another' }));
    await screen.findByLabelText('Test label');
    fillConfirm({ label: 'Second' });
    server.on('POST', BASE, reserved());
    fireEvent.click(confirmButton());
    await screen.findByRole('button', { name: 'Create another' });
    expect(server.bodies('POST', BASE).at(-1).idempotencyKey).toBe('key-2');

    // A second lookup: a new key again.
    fireEvent.click(screen.getByRole('button', { name: 'Look up a different source' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Look up source' }));
    await waitFor(() => expect(server.count('POST', `${BASE}/source`)).toBe(2));
    await screen.findByLabelText('Test label');
    fillConfirm({ label: 'Third' });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(server.count('POST', BASE)).toBe(4));
    expect(server.bodies('POST', BASE).at(-1).idempotencyKey).toBe('key-3');
  });

  test('a coded refusal shows its copy and keeps the form for a retry', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 409, body: { error: 'x', code: 'factory_draft_stale' } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The saved copy of the source is too old to use safely, so nothing was reserved. Look up the source Request again.'));
    expect(confirmButton().disabled).toBe(false);
  });

  test('a source with no cycle: both fields start empty and the body never carries null', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server, '1001000', { status: 200, body: { draftId: DRAFT_ID, summary: { ...SUMMARY, fiscalYear: null, meetingDate: null }, defaults: { fiscalYear: null, meetingDate: null } } });
    await screen.findByLabelText('Test label');
    expect(screen.getByLabelText('Fiscal year').value).toBe('');
    fillConfirm();
    expect(confirmButton().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Fiscal year'), { target: { value: 'June 2027' } });
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2027-06-04' } });
    server.on('POST', BASE, reserved());
    fireEvent.click(confirmButton());
    await screen.findByRole('heading', { name: 'My test' });
    expect(server.bodies('POST', BASE)[0]).toMatchObject({ fiscalYear: 'June 2027', meetingDate: '2027-06-04' });
  });
});

describe('advance loop', () => {
  const advancePath = (id = RUN_A) => `${BASE}/${id}/advance`;
  const reply = (outcome, extra = {}) => ({
    status: 200,
    body: {
      step: 'create_request', outcome, currentStep: 'create_request', stepIndex: 1, status: 'creating', destinationRequestNumber: null, errorMessage: null, ...extra,
    },
  });
  const setup = async (run = makeRun()) => {
    const server = makeServer();
    server.on('GET', `${BASE}/${run.runId}`, runBody(run));
    await renderSection(server, [run]);
    await selectRun(run.testLabel);
    return server;
  };
  const start = (name = 'Start production run') => fireEvent.click(screen.getByRole('button', { name }));
  const steps = () => within(screen.getByRole('list', { name: 'Steps' }));

  test('advanced continues, updates progress from stepIndex, and ready stops with the number', async () => {
    const server = await setup();
    const gate = deferred();
    server.on('POST', advancePath(),
      reply('advanced', { currentStep: 'create_request', stepIndex: 1 }),
      async () => { await gate.promise; return reply('ready', { status: 'ready', currentStep: 'verify', stepIndex: 6, destinationRequestNumber: '1004000' }); });
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ status: 'ready', currentStep: 'verify', stepIndex: 6, destinationRequestNumber: '1004000' })));
    start();
    await waitFor(() => expect(server.count('POST', advancePath())).toBe(2));
    // Mid-loop: step 1 is done (from stepIndex), step 2 is in progress.
    expect(steps().getAllByText('Done')).toHaveLength(1);
    expect(steps().getByText('In progress')).toBeTruthy();
    expect(screen.getByText('Finished: Check the source Request. Working on: Create the test Request. This can take a few minutes. Leave this page open.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop after this step' })).toBeTruthy();
    await act(async () => { gate.resolve(); });
    await screen.findByText('The test Request is ready.');
    expect(screen.getByText('Request 1004000')).toBeTruthy();
    expect(steps().getAllByText('Done')).toHaveLength(7);
    expect(screen.queryByRole('button', { name: /^(Start|Resume)$/ })).toBeNull();
    // The run is refreshed after the loop stops.
    expect(server.count('GET', `${BASE}/${RUN_A}`)).toBeGreaterThanOrEqual(2);
  });

  test('needs_attention stops, shows the step and the error text, and offers Resume; the text is kept nowhere', async () => {
    const server = await setup();
    server.on('POST', advancePath(), reply('needs_attention', { step: 'copy_file', status: 'needs_attention', currentStep: 'copy_file', stepIndex: 4, errorMessage: 'Graph said no to file X' }));
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ status: 'needs_attention', currentStep: 'copy_file', stepIndex: 4 })));
    start();
    await screen.findByText('Stopped at "Copy the documents (one per step)".');
    expect(screen.getByText('Graph said no to file X')).toBeTruthy();
    await screen.findByRole('button', { name: 'Retry step: Copy the documents (one per step)' });
    expect(steps().getByText('Needs attention')).toBeTruthy();
    expect(server.count('POST', advancePath())).toBe(1);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  test.each(['lease_unavailable', 'lease_lost'])('%s stops with the copy and sends no further POST', async (outcome) => {
    const server = await setup();
    // The second reply is only reachable if the loop wrongly retries.
    server.on('POST', advancePath(), reply(outcome, { status: 'creating' }), reply('ready', { status: 'ready' }));
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ status: 'creating', stepIndex: 1 })));
    start();
    await screen.findByText('Another process is advancing this run. That can be a step you started a moment ago that is still finishing. Try again in a few minutes.');
    await screen.findByRole('button', { name: 'Resume production run' });
    expect(server.count('POST', advancePath())).toBe(1);
  });

  test('not_advanced stops and shows the status', async () => {
    const server = await setup();
    server.on('POST', advancePath(), reply('not_advanced', { status: 'retired' }));
    start();
    await screen.findByText('This run is retired, so nothing was advanced.');
    expect(server.count('POST', advancePath())).toBe(1);
  });

  test('a thrown error stops with its copy (a code with copy, then the blip) and does not retry', async () => {
    const server = await setup();
    server.on('POST', advancePath(), { status: 504, body: { error: 'x', code: 'factory_deadline_exceeded' } });
    start();
    await screen.findByText("There wasn't enough time left to start that safely, so nothing was started. Try again.");
    expect(server.count('POST', advancePath())).toBe(1);
    server.on('POST', advancePath(), { status: 504, body: {} });
    start();
    await screen.findByText(BLIP_COPY);
    expect(server.count('POST', advancePath())).toBe(2);
  });

  test('Stop after this step sends no further POST after the in-flight one', async () => {
    const server = await setup();
    const gate = deferred();
    server.on('POST', advancePath(), async () => { await gate.promise; return reply('advanced', { stepIndex: 1 }); }, reply('ready', { status: 'ready' }));
    start();
    await waitFor(() => expect(server.count('POST', advancePath())).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop after this step' }));
    await act(async () => { gate.resolve(); });
    await screen.findByText('Stopped after that step. Resume when you are ready.');
    expect(server.count('POST', advancePath())).toBe(1);
  });

  describe.each([
    ['the request is aborted while pending (catch path)', false],
    ['the answer was already received and its body resolves after the abort (success path)', true],
  ])('stale guard: selecting run B while A advances, where %s', (_name, bodyAfterAbort) => {
    test('A\'s late answer updates nothing, shows no alert on B, and starts nothing', async () => {
      const runA = makeRun();
      const runB = makeRun({ runId: RUN_B, testLabel: 'Run B', status: 'creating', currentStep: 'provision_location', stepIndex: 3 });
      const server = makeServer();
      server.on('GET', `${BASE}/${RUN_A}`, runBody(runA));
      server.on('GET', `${BASE}/${RUN_B}`, runBody(runB));
      server.on('POST', `${BASE}/${RUN_B}/recheck`, { status: 200, body: { runId: RUN_B, status: 'creating', ok: true, outcome: 'unchanged', failures: [] } });
      await renderSection(server, [runA, runB]);
      await selectRun('Run A');
      const gate = deferred();
      let consumed = false;
      const late = reply('advanced', { stepIndex: 5, currentStep: 'observe', status: 'creating' });
      server.on('POST', advancePath(RUN_A), async () => {
        if (bodyAfterAbort) return { ...late, bodyGate: gate.promise };
        await gate.promise;
        consumed = true;
        return late;
      }, reply('ready', { status: 'ready' })); // only reachable if the loop wrongly continues
      fireEvent.click(screen.getByRole('button', { name: 'Start production run' }));
      await waitFor(() => expect(server.count('POST', advancePath(RUN_A))).toBe(1));
      await selectRun('Run B');
      expect(steps().getAllByText('Done')).toHaveLength(3);
      await act(async () => { gate.resolve(); });
      if (!bodyAfterAbort) await waitFor(() => expect(consumed).toBe(true));
      // Positive sentinel: a request made for B after A's answer is released completes and shows.
      fireEvent.click(screen.getByRole('button', { name: 'Recheck the Foundation record' }));
      await screen.findByText('The Foundation records are as expected.');
      expect(screen.getByRole('heading', { name: 'Run B' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(steps().getAllByText('Done')).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Resume production run' }).disabled).toBe(false);
      expect(server.count('POST', advancePath(RUN_A))).toBe(1);
      expect(server.count('POST', advancePath(RUN_B))).toBe(0);
    });
  });

  test('starting a new lookup aborts the run in flight: its late answer changes nothing and the panel is at rest', async () => {
    const server = await setup();
    const gate = deferred();
    server.on('POST', advancePath(), async () => { await gate.promise; return reply('advanced', { stepIndex: 5 }); }, reply('ready', { status: 'ready' }));
    start();
    await waitFor(() => expect(server.count('POST', advancePath())).toBe(1));
    await lookup(server);
    await screen.findByLabelText('Test label');
    // The panel is gone (the run stays in the list); the late answer cannot revive it.
    expect(screen.queryByRole('heading', { name: 'Run A' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop after this step' })).toBeNull();
    await act(async () => { gate.resolve(); });
    // Positive sentinel: the new draft's form is still there and usable after A's answer is released.
    fireEvent.change(screen.getByLabelText('Test label'), { target: { value: 'After' } });
    expect(screen.getByLabelText('Test label').value).toBe('After');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(server.count('POST', advancePath())).toBe(1);
    expect(screen.queryByRole('heading', { name: 'Run A' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Run A' })).toBeTruthy(); // still in the list
    // Reselecting loads it fresh, at rest.
    fireEvent.click(screen.getByRole('button', { name: 'Run A' }));
    await screen.findByRole('heading', { name: 'Run A' });
    expect(steps().getAllByText('Up next')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Stop after this step' })).toBeNull();
  });

  test('retiring and retired runs show a status line, not per-step states', async () => {
    const server = await setup(makeRun({ status: 'retired', stepIndex: 2 }));
    expect(screen.getByText('This run is retired, so its steps are not shown.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
    expect(server.count('POST', advancePath())).toBe(0);
  });
});

describe('write reasons and reserved values', () => {
  test('with the form off, the reason sits beside Look up source even before a number is typed', async () => {
    const server = makeServer();
    await renderSection(server, [], { formEnabled: false });
    expect(screen.getByRole('button', { name: 'Look up source' }).disabled).toBe(true);
    expect(document.getElementById('factory-lookup-reason').textContent).toMatch(/switched off on this deployment/i);
  });

  test('a retry with edited values that returns the existing run (200, created false) shows the stored values and says so', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE,
      { status: 500, body: { error: 'The Test Request run could not be processed.' } },
      { status: 200, body: { run: makeRun({ testLabel: 'My test', fiscalYear: 'December 2026', meetingDate: '2026-12-01' }), created: false } });
    fireEvent.click(confirmButton());
    await screen.findByRole('alert');
    fireEvent.change(screen.getByLabelText('Meeting date'), { target: { value: '2026-12-15' } });
    fireEvent.click(confirmButton());
    await screen.findByText(/meeting 2026-12-01\)/);
    expect(screen.getByText('This run was already reserved by an earlier attempt, with the values shown here, not the ones you just entered. To use different values, choose Create another.')).toBeTruthy();
    expect(server.bodies('POST', BASE).map((b) => b.idempotencyKey)).toEqual(['key-1', 'key-1']);
  });

  test('G1: a Confirm that resolves after the operator selected another run leaves that selection alone and says to select the new run', async () => {
    const runB = makeRun({ runId: RUN_B, testLabel: 'Run B', status: 'creating', currentStep: 'provision_location', stepIndex: 3 });
    const runA = makeRun({ testLabel: 'My test' });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_B}`, runBody(runB));
    server.on('POST', `${BASE}/${RUN_B}/recheck`, { status: 200, body: { runId: RUN_B, status: 'creating', ok: true, outcome: 'unchanged', failures: [] } });
    await renderSection(server, [runB]);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    const gate = deferred();
    server.on('POST', BASE, async () => { await gate.promise; return { status: 201, body: { run: { ...runA, fiscalYear: 'December 2026', meetingDate: '2026-12-01' }, created: true } }; });
    server.on('GET', BASE, listBody([runB, runA]));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(server.count('POST', BASE)).toBe(1));
    await selectRun('Run B');
    await act(async () => { gate.resolve(); });
    await screen.findByText('Select it in the run list to start it.');
    // A is in the list; B's panel is still shown and B's scope was not aborted.
    await screen.findByRole('button', { name: 'My test' });
    expect(screen.getByRole('heading', { name: 'Run B' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Recheck the Foundation record' }));
    await screen.findByText('The Foundation records are as expected.');
  });

  test('G1: with no selection change the reserved run is auto-selected, with no select-it sentence', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 201, body: { run: makeRun({ testLabel: 'My test', fiscalYear: 'December 2026', meetingDate: '2026-12-01' }), created: true } });
    fireEvent.click(confirmButton());
    await screen.findByRole('heading', { name: 'My test' });
    expect(screen.queryByText('Select it in the run list to start it.')).toBeNull();
  });

  test('an unedited retry that returns the existing run shows no mismatch sentence', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 200, body: { run: makeRun({ testLabel: 'My test', fiscalYear: 'December 2026', meetingDate: '2026-12-01T00:00:00.000Z' }), created: false } });
    fireEvent.click(confirmButton());
    await screen.findByText(/meeting 2026-12-01\)/);
    expect(screen.queryByText(/already reserved by an earlier attempt/)).toBeNull();
  });

  test('Create another with no way to mint a key shows the error and keeps Confirm disabled with that reason', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fillConfirm();
    server.on('POST', BASE, { status: 201, body: { run: makeRun({ testLabel: 'My test', fiscalYear: 'December 2026', meetingDate: '2026-12-01' }), created: true } });
    fireEvent.click(confirmButton());
    await screen.findByRole('button', { name: 'Create another' });
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Create another' }));
      await screen.findByRole('alert');
      fillConfirm({ label: 'Second' });
      expect(confirmButton().disabled).toBe(true);
      expect(document.getElementById('factory-confirm-reason').textContent).toMatch(/can't create the safe request key/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
    }
  });
});

describe('inspect, recheck and files', () => {
  test('selecting a run loads its resources; a production run offers the Foundation recheck with the advisory time; a sandbox run does not', async () => {
    const prod = makeRun({ status: 'ready', currentStep: 'verify', stepIndex: 6, destinationRequestNumber: '1004000' });
    const sandbox = makeRun({ runId: RUN_B, testLabel: 'Sandbox run', destinationEnvironment: 'sandbox', status: 'retired' });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(prod, {
      resources: [{ resourceId: 'x1', step: 'create_request', resourceKind: 'request', outcome: 'created', error: null, sequence: 1 }],
      foundationCapturedAt: '2026-10-01T12:00:00.000Z',
    }));
    server.on('GET', `${BASE}/${RUN_B}`, runBody(sandbox));
    server.on('GET', `${BASE}/${RUN_A}/status`, { status: 200, body: { runId: RUN_A, runStatus: 'ready', options: { phase1: [], phase2: [] }, current: { phase1: null, phase2: null }, changes: [] } });
    await renderSection(server, [prod, sandbox]);
    await selectRun('Run A');
    await screen.findByText('Create the test Request', { selector: 'td' });
    expect(screen.getAllByText('Created').length).toBeGreaterThan(0); // unknown outcome: humanized fallback
    expect(screen.getByText(/^A recheck is meaningful /)).toBeTruthy();
    server.on('POST', `${BASE}/${RUN_A}/recheck`, { status: 200, body: { runId: RUN_A, status: 'ready', ok: false, outcome: 'changed', failures: ['Foundation contacts changed'] } });
    fireEvent.click(screen.getByRole('button', { name: 'Recheck the Foundation record' }));
    await screen.findByText('Foundation contacts changed');
    await selectRun('Sandbox run');
    expect(screen.queryByRole('button', { name: 'Recheck the Foundation record' })).toBeNull();
  });

  test('a recheck with no captured time shows no advisory line', async () => {
    const prod = makeRun({ status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(prod));
    await renderSection(server, [prod]);
    await selectRun('Run A');
    expect(screen.queryByText(/A recheck is meaningful after/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Recheck the Foundation record' })).toBeTruthy();
  });

  test('Download run files downloads two JSON files; a cleaned-up run says its files were removed', async () => {
    const prod = makeRun({ status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(prod));
    await renderSection(server, [prod]);
    await selectRun('Run A');
    const createObjectURL = jest.fn(() => 'blob:x');
    const revokeObjectURL = jest.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    server.on('GET', `${BASE}/${RUN_A}/artifacts`, { status: 200, body: { runId: RUN_A, cleanedUp: false, manifest: { a: 1 }, bundle: { b: 2 } } });
    fireEvent.click(screen.getByRole('button', { name: 'Download run files' }));
    await screen.findByText('Downloaded the manifest and the source bundle.');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    expect(click).toHaveBeenCalledTimes(2);
    server.on('GET', `${BASE}/${RUN_A}/artifacts`, { status: 200, body: { runId: RUN_A, cleanedUp: true, manifest: null, bundle: null } });
    fireEvent.click(screen.getByRole('button', { name: 'Download run files' }));
    await screen.findByText('The run files were removed after the run finished, so there is nothing to download.');
    expect(createObjectURL).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });
});

// ---- design-critique refinements ---------------------------------------------

const primaries = () => [...document.querySelectorAll('[data-primary="true"]')].filter((button) => !button.disabled);

describe('write target and consequence', () => {
  test.each([
    ['production', 'Writes to production', 'Production'],
    ['sandbox', 'Writes to sandbox', 'the sandbox'],
  ])('the band for the %s target names it once the list has answered', async (target, chip, where) => {
    const server = makeServer();
    await renderSection(server, [], { target });
    expect(screen.getByText(chip)).toBeTruthy();
    expect(screen.getByText(`This panel changes real data on ${where}: it creates a test Request step by step and can change its Phase I or Phase II status.`)).toBeTruthy();
  });

  test('the band is not shown before the list answers, and the form-off banner replaces it', async () => {
    const server = makeServer();
    server.on('GET', BASE, { status: 500, body: { error: 'x' } });
    render(<TestRequestFactorySection />);
    await screen.findByRole('alert');
    expect(screen.queryByText('Writes to production')).toBeNull();
    const off = makeServer();
    await renderSection(off, [], { formEnabled: false });
    expect(screen.queryByText(/This panel changes real data/)).toBeNull();
  });

  test.each([
    ['production', 'prepared', 'Start production run', 'Production'],
    ['production', 'creating', 'Resume production run', 'Production'],
    ['sandbox', 'prepared', 'Start sandbox run', 'Sandbox'],
    ['sandbox', 'creating', 'Resume sandbox run', 'Sandbox'],
  ])('a %s %s run: the button names the target and the line above it says what is written', async (env, status, label, where) => {
    const run = makeRun({ destinationEnvironment: env, status, stepIndex: status === 'creating' ? 2 : 0 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(screen.getByRole('button', { name: label })).toBeTruthy();
    expect(screen.getByText(`Writes to ${where} Dataverse and SharePoint: creates the test Request, sets its meeting date, makes its document folder and copies its documents.`)).toBeTruthy();
  });

  test('a ready sandbox run says status changes are production only; a ready production run links to the Workbench by its Request id', async () => {
    const sandbox = makeRun({ destinationEnvironment: 'sandbox', status: 'ready', stepIndex: 6, destinationRequestNumber: '2000' });
    const prod = makeRun({ runId: RUN_B, testLabel: 'Run P', status: 'ready', stepIndex: 6, destinationRequestNumber: '1004000', destinationRequestId: '44444444-4444-4444-8444-444444444444' });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(sandbox));
    server.on('GET', `${BASE}/${RUN_B}`, runBody(prod));
    server.on('GET', `${BASE}/${RUN_B}/status`, { status: 200, body: { runId: RUN_B, runStatus: 'ready', options: { phase1: [], phase2: [] }, current: null, changes: [] } });
    await renderSection(server, [sandbox, prod]);
    await selectRun('Run A');
    expect(screen.getByText('Status changes are available only for production test Requests.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open in the Workbench' })).toBeNull();
    await selectRun('Run P');
    expect(screen.getByRole('link', { name: 'Open in the Workbench' }).getAttribute('href')).toBe('/workbench/44444444-4444-4444-8444-444444444444');
  });
});

describe('source identity', () => {
  test('shows the title and applicant under the heading, human document labels, and the pre-filled label', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server, '1001000', {
      status: 200,
      body: { draftId: DRAFT_ID, summary: SUMMARY, source: { title: 'Gene editing study', applicant: 'Live University' }, defaults: { fiscalYear: 'December 2026', meetingDate: '2026-12-01' } },
    });
    await screen.findByRole('heading', { name: 'Source Request 1001000' });
    expect(screen.getByText('Gene editing study · Live University')).toBeTruthy();
    expect(screen.getByText('Project Description', { selector: 'td' })).toBeTruthy();
    expect(screen.getByLabelText('Test label').value).toBe('Test clone of Request 1001000');
    expect(screen.getByText('For example: December 2026')).toBeTruthy();
  });

  test('falls back to "Untitled Request" and "Applicant unavailable", and shows an unknown kind raw', async () => {
    const server = makeServer();
    await renderSection(server, []);
    await lookup(server, '1001000', {
      status: 200,
      body: { draftId: DRAFT_ID, summary: { ...SUMMARY, documents: [{ kind: 'somethingNew', name: 'X.pdf', size: 1, sha256Prefix: 'aa' }] }, source: { title: null, applicant: null }, defaults: { fiscalYear: null, meetingDate: null } },
    });
    await screen.findByText('Untitled Request · Applicant unavailable');
    expect(screen.getByText('somethingNew', { selector: 'td' })).toBeTruthy();
    expect(screen.queryByText(/^For example:/)).toBeNull();
  });
});

describe('needs attention, recorded steps and run tools', () => {
  const attention = (extra = {}) => makeRun({ status: 'needs_attention', currentStep: 'copy_file', stepIndex: 4, ...extra });

  test('a mapped reason gets its plain copy; an unmapped one gets the default; the technical detail is a closed details; the action is an outline "Retry step"', async () => {
    const run = attention({ needsAttentionReason: 'ambiguous_create_outcome' });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    server.on('POST', `${BASE}/${RUN_A}/advance`, { status: 200, body: { step: 'copy_file', outcome: 'needs_attention', currentStep: 'copy_file', stepIndex: 4, status: 'needs_attention', destinationRequestNumber: null, errorMessage: 'Graph said no' } });
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(screen.getByText(/Don't retry; ask the owner to resolve it, because retrying could create a second Request\./)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Retry step: Copy the documents (one per step)' });
    expect(retry.hasAttribute('data-primary')).toBe(false);
    fireEvent.click(retry);
    const summary = await screen.findByText('Technical detail');
    const details = summary.closest('details');
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Graph said no');
  });

  test('an unmapped reason shows the default copy', async () => {
    const run = attention({ needsAttentionReason: 'file_copy_failed (http 503)' });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(screen.getByText('This step stopped and needs a look before it is retried. Retrying is safe: the run picks up where it stopped and never creates a second Request.')).toBeTruthy();
  });

  test('details defaults: recorded steps open only for needs_attention; run tools and the count are always present', async () => {
    const att = attention();
    const calm = makeRun({ runId: RUN_B, testLabel: 'Run B', status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(att, { resources: [{ resourceId: 'x', step: 'create_request', resourceKind: 'dataverse_request', outcome: 'verified', error: null, sequence: 1 }] }));
    server.on('GET', `${BASE}/${RUN_B}`, runBody(calm));
    await renderSection(server, [att, calm]);
    await selectRun('Run A');
    expect((await screen.findByText('Recorded steps (1)')).closest('details').open).toBe(true);
    expect(screen.getByText('Run tools').closest('details').open).toBe(false);
    await selectRun('Run B');
    expect((await screen.findByText('Recorded steps (0)')).closest('details').open).toBe(false);
  });

  test('resource labels: known kinds and outcomes in words, unknown ones humanized, the error code only inside <code> after "Error"', async () => {
    const run = makeRun({ status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run, {
      resources: [
        { resourceId: '1', step: 'create_request', resourceKind: 'dataverse_request', outcome: 'verified', error: null, sequence: 1 },
        { resourceId: '2', step: 'copy_file', resourceKind: 'brand_new_kind', outcome: 'half_done', error: { code: 'file_copy_failed' }, sequence: 2 },
      ],
    }));
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(await screen.findByText('Test Request', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Verified', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Brand new kind', { selector: 'td' })).toBeTruthy();
    expect(screen.getByText('Half done', { selector: 'td' })).toBeTruthy();
    const code = screen.getByText('file_copy_failed');
    expect(code.tagName).toBe('CODE');
    expect(code.parentElement.textContent).toBe('Error file_copy_failed');
  });

  test('the Foundation recheck is described, and the advisory is a clock time with a relative phrase', async () => {
    const run = makeRun({ status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run, { foundationCapturedAt: new Date(Date.now() - 25 * 60_000).toISOString() }));
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(screen.getByText(/Checks that creating the test Request did not change the Foundation's own account record\. It is meaningful about an hour after the run started\./)).toBeTruthy();
    expect(await screen.findByText(/^A recheck is meaningful after .+ \(in \d+ minutes\)\.$/)).toBeTruthy();
  });
});

describe('focus, selection and primaries', () => {
  test('selecting a run focuses its heading; aria-current and a visible "Selected" mark the row', async () => {
    const run = makeRun();
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    await renderSection(server, [run]);
    const button = screen.getByRole('button', { name: 'Run A' });
    expect(button.getAttribute('aria-current')).toBeNull();
    await selectRun('Run A');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Run A' })));
    expect(screen.getByRole('button', { name: 'Run A' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('button', { name: 'Run A' }).hasAttribute('aria-pressed')).toBe(false);
    expect(screen.getByText('Selected')).toBeTruthy();
  });

  test('a lookup focuses the source heading, and reserving focuses the collapsed reserved line, which keeps both buttons', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'My test' })));
    await renderSection(server, []);
    await lookup(server);
    const heading = await screen.findByRole('heading', { name: 'Source Request 1001000' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.change(screen.getByLabelText(/Type Request number/), { target: { value: '1001000' } });
    server.on('POST', BASE, { status: 201, body: { run: makeRun({ testLabel: 'Test clone of Request 1001000', fiscalYear: 'December 2026', meetingDate: '2026-12-01' }), created: true } });
    fireEvent.click(confirmButton());
    const line = await screen.findByText('Source Request 1001000 · reserved as "Test clone of Request 1001000" (fiscal year December 2026, meeting 2026-12-01)');
    await waitFor(() => expect(document.activeElement).toBe(line));
    expect(screen.getByRole('button', { name: 'Create another' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Look up a different source' })).toBeTruthy();
    expect(screen.queryByLabelText('Source Request number')).toBeNull();
  });

  test('exactly one enabled primary per state: typed number, unreserved draft, reserved resumable run', async () => {
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(makeRun({ testLabel: 'Test clone of Request 1001000' })));
    await renderSection(server, []);
    fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1001000' } });
    expect(primaries().map((b) => b.textContent)).toEqual(['Look up source']);
    await lookup(server);
    await screen.findByLabelText('Test label');
    fireEvent.change(screen.getByLabelText(/Type Request number/), { target: { value: '1001000' } });
    expect(primaries().map((b) => b.textContent)).toEqual(['Confirm and reserve run']);
    server.on('POST', BASE, { status: 201, body: { run: makeRun({ testLabel: 'Test clone of Request 1001000', fiscalYear: 'December 2026', meetingDate: '2026-12-01' }), created: true } });
    fireEvent.click(confirmButton());
    await screen.findByRole('button', { name: 'Start production run' });
    expect(primaries().map((b) => b.textContent)).toEqual(['Start production run']);
  });

  test('a needs_attention run offers only an outline Retry: no primary at all', async () => {
    const run = makeRun({ status: 'needs_attention', currentStep: 'copy_file', stepIndex: 4 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    await renderSection(server, [run]);
    await selectRun('Run A');
    expect(primaries()).toHaveLength(0);
    expect(screen.getByRole('button', { name: /^Retry step:/ }).disabled).toBe(false);
  });

  test('a creating run is blue and its running step is blue', async () => {
    const run = makeRun({ status: 'creating', stepIndex: 2 });
    const server = makeServer();
    server.on('GET', `${BASE}/${RUN_A}`, runBody(run));
    await renderSection(server, [run]);
    await selectRun('Run A');
    const chips = screen.getAllByText('In progress');
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((chip) => chip.className.includes('bg-blue-50'))).toBe(true);
  });
});

describe('lookup wait', () => {
  test('shows elapsed time once a second in a live region, and Stop waiting aborts with the plain message; the timer ends', async () => {
    const server = makeServer();
    await renderSection(server, []);
    const gate = deferred();
    server.on('POST', `${BASE}/source`, async () => { await gate.promise; return { status: 200, body: { draftId: DRAFT_ID, summary: SUMMARY, source: { title: null, applicant: null }, defaults: {} } }; });
    fireEvent.change(screen.getByLabelText('Source Request number'), { target: { value: '1001000' } });
    const live = document.querySelector('[role="status"][aria-live="polite"]');
    expect(live.textContent).toBe('');
    jest.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Look up source' }));
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(screen.getByText('Started 1 s ago')).toBeTruthy();
      await act(async () => { jest.advanceTimersByTime(79_000); });
      expect(screen.getByText('Started 1 min 20 s ago')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
      await screen.findByText("Stopped waiting. The lookup may still finish on the server; nothing was created. Look up the source again when you're ready.");
      expect(jest.getTimerCount()).toBe(0);
      expect(screen.queryByText(/^Started /)).toBeNull();
    } finally {
      jest.useRealTimers();
    }
    gate.resolve();
  });
});
