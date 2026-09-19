/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import RequestListPanel from '../../shared/components/workbench/RequestListPanel';

jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
}));
jest.mock('../../shared/components/workbench/ReviewerStatusIndicator', () => ({
  __esModule: true,
  default: () => null,
}));

const CYCLE = { code: 'J26', label: 'June 2026', myCount: 1, mySetAsideCount: 0 };
const row = (overrides = {}) => ({
  requestId: 'request-a',
  requestNumber: '1001',
  cycleLabel: 'June 2026',
  grantProgram: 'Research',
  institution: 'Example University',
  workRemaining: 'find',
  reviewers: [],
  canManage: true,
  isMine: true,
  setAside: false,
  advancing: false,
  ...overrides,
});

function renderPanel(overrides = {}) {
  return render(
    <RequestListPanel
      programId="program-a"
      cycleCode="J26"
      cycles={[CYCLE]}
      cyclesGeneration={1}
      patchCycleCounts={jest.fn()}
      loadingCycles={false}
      scope="my"
      includeSetAside={false}
      onScopeChange={jest.fn()}
      onIncludeSetAsideChange={jest.fn()}
      {...overrides}
    />,
  );
}

function response(body, status = 200) {
  const payload = body && Array.isArray(body.proposals)
    ? { programId: 'program-a', cycleCode: 'J26', scope: 'my', includeSetAside: false, ...body }
    : body;
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.useRealTimers();
  global.fetch = jest.fn();
});

test('retains same-key rows while triage refresh is held, then accepts a successful empty response', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1, stages: { find: 1 } } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockImplementationOnce(async () => {
      await held;
      return response({ proposals: [], rollup: { total: 0, stages: {} } });
    });
  renderPanel();
  await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());

  await act(async () => {
    fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  });
  expect(screen.getByText('#1001')).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.getByText('No requests to show for this cycle and scope.')).toBeInTheDocument());
});

test('retains same-key rows and shows an error when the refresh fails ordinarily', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1, stages: { find: 1 } } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockImplementationOnce(async () => {
      await held;
      return response({ error: 'temporary outage' }, 500);
    });
  renderPanel();
  await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());
  await act(async () => {
    fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  });
  expect(screen.getByText('#1001')).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.getByText('temporary outage')).toBeInTheDocument());
  expect(screen.getByText('#1001')).toBeInTheDocument();
});

test('surfaces a concurrent triage error after another row starts a replacement load', async () => {
  const firstPost = deferred();
  const secondPost = deferred();
  const rows = [
    row(),
    row({ requestId: 'request-b', requestNumber: '1002' }),
  ];
  global.fetch
    .mockResolvedValueOnce(response({ proposals: rows, rollup: { total: 2, stages: { find: 2 } } }))
    .mockImplementationOnce(() => firstPost.promise)
    .mockImplementationOnce(() => secondPost.promise)
    .mockResolvedValueOnce(response({ proposals: rows, rollup: { total: 2, stages: { find: 2 } } }));
  renderPanel();
  await waitFor(() => expect(screen.getByText('#1002')).toBeInTheDocument());

  const controls = screen.getAllByTitle('Set triage status');
  fireEvent.change(controls[0], { target: { value: 'advancing' } });
  fireEvent.change(controls[1], { target: { value: 'advancing' } });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));

  await act(async () => {
    firstPost.resolve(response({ success: true }));
    await firstPost.promise;
  });
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));

  await act(async () => {
    secondPost.resolve(response({ error: 'B failed' }, 500));
    await secondPost.promise;
  });
  await waitFor(() => expect(screen.getByText('B failed')).toBeInTheDocument());
  expect(screen.getByText('#1002')).toBeInTheDocument();
});

test('clears same-key rows for a protected refresh response', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1, stages: { find: 1 } } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockImplementationOnce(async () => {
      await held;
      return response({ error: 'forbidden' }, 403);
    });
  renderPanel();
  await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());
  await act(async () => {
    fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  });
  release();
  await waitFor(() => expect(screen.queryByText('#1001')).not.toBeInTheDocument());
  expect(screen.getByText('forbidden')).toBeInTheDocument();
});

test('clears a seeded snapshot when a 200 response is malformed', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1, stages: { find: 1 } } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockImplementationOnce(async () => {
      await held;
      return response(null);
    });
  renderPanel();
  await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());
  await act(async () => {
    fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  });
  release();
  await waitFor(() => expect(screen.queryByText('#1001')).not.toBeInTheDocument());
  expect(screen.getByText('The request list response was malformed.')).toBeInTheDocument();
});

test.each(['success', 'failure'])('ignores old %s across A to B to A before replacement timers', async (outcome) => {
  jest.useFakeTimers();
  let resolveOld;
  global.fetch.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const props = {
    programId: 'program-a', cycleCode: 'J26', cycles: [CYCLE], cyclesGeneration: 1,
    patchCycleCounts: jest.fn(), loadingCycles: false, scope: 'my', includeSetAside: false,
    onScopeChange: jest.fn(), onIncludeSetAsideChange: jest.fn(),
  };
  const view = render(<RequestListPanel {...props} />);
  await act(async () => { jest.runOnlyPendingTimers(); });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  view.rerender(<RequestListPanel {...props} scope="all" />);
  view.rerender(<RequestListPanel {...props} />);
  await act(async () => {
    resolveOld(outcome === 'success'
      ? response({ proposals: [row({ requestNumber: 'old-a' })], rollup: { total: 1 } })
      : response({ error: 'obsolete error' }, 500));
  });
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('#old-a')).not.toBeInTheDocument();
  expect(screen.queryByText('obsolete error')).not.toBeInTheDocument();
  view.unmount();
  jest.useRealTimers();
});

test('hides the previous snapshot synchronously when the data key changes', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1, stages: { find: 1 } } }))
    .mockImplementationOnce(() => new Promise(() => {}));
  const view = renderPanel();
  await waitFor(() => expect(screen.getByText('#1001')).toBeInTheDocument());
  view.rerender(
    <RequestListPanel
      programId="program-b"
      cycleCode="J26"
      cycles={[CYCLE]}
      cyclesGeneration={2}
      patchCycleCounts={jest.fn()}
      loadingCycles={false}
      scope="my"
      includeSetAside={false}
      onScopeChange={jest.fn()}
      onIncludeSetAsideChange={jest.fn()}
    />,
  );
  expect(screen.queryByText('#1001')).not.toBeInTheDocument();
});

test.each([null, { proposals: 'invalid', rollup: {} }, { rollup: {} }])('clears malformed refresh after seeded success: %j', async (body) => {
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1 } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockResolvedValueOnce(response(body));
  renderPanel();
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await screen.findByText('The request list response was malformed.');
  expect(screen.queryByText('#1001')).not.toBeInTheDocument();
});

test('clears a seeded snapshot for a null-body 403', async () => {
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1 } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockResolvedValueOnce(response(null, 403));
  renderPanel();
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await screen.findByText('Failed to load requests (403)');
  expect(screen.queryByText('#1001')).not.toBeInTheDocument();
});

test('accepts a canonical program GUID response to an uppercase deep link', async () => {
  const id = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
  global.fetch.mockResolvedValue(response({ programId: id.toLowerCase(), proposals: [row()], rollup: { total: 1 } }));
  renderPanel({ programId: id });
  await screen.findByText('#1001');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('settled no-cycle state is empty rather than an endless loading indicator', () => {
  renderPanel({ cycleCode: null, cycles: [], loadingCycles: false });
  expect(screen.getByText('No requests to show for this cycle and scope.')).toBeInTheDocument();
  expect(global.fetch).not.toHaveBeenCalled();
});

test.each(['programId', 'cycleCode', 'scope', 'includeSetAside'])('clears a seeded snapshot when %s is missing', async (field) => {
  const malformed = { programId: 'program-a', cycleCode: 'J26', scope: 'my', includeSetAside: false,
    proposals: [row({ requestNumber: 'wrong-context' })], rollup: { total: 1 } };
  delete malformed[field];
  global.fetch
    .mockResolvedValueOnce(response({ proposals: [row()], rollup: { total: 1 } }))
    .mockResolvedValueOnce(response({ success: true }))
    .mockResolvedValueOnce({ ok: true, status: 200, json: async () => malformed });
  renderPanel();
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  await screen.findByText('The request list response did not match the selected context.');
  expect(screen.queryByText('#1001')).not.toBeInTheDocument();
  expect(screen.queryByText('#wrong-context')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Set triage status')).not.toBeInTheDocument();
});


test('suppresses an obsolete triage failure after a filter A→B→A round trip', async () => {
  const post = deferred();
  global.fetch.mockImplementation((url, options) => {
    if (options?.method === 'POST') return post.promise;
    const scope = new URL(url, 'http://test').searchParams.get('scope');
    return Promise.resolve(response({ scope, proposals: [row()], rollup: { total: 1 } }));
  });
  const props = {
    programId: 'program-a', cycleCode: 'J26', cycles: [CYCLE], cyclesGeneration: 1,
    patchCycleCounts: jest.fn(), loadingCycles: false, includeSetAside: false,
    onScopeChange: jest.fn(), onIncludeSetAsideChange: jest.fn(),
  };
  const view = render(<RequestListPanel {...props} scope="my" />);
  await screen.findByText('#1001');
  fireEvent.change(screen.getByTitle('Set triage status'), { target: { value: 'advancing' } });
  view.rerender(<RequestListPanel {...props} scope="all" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
  view.rerender(<RequestListPanel {...props} scope="my" />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(4));
  await act(async () => { post.resolve(response({ error: 'Obsolete command error' }, 500)); });
  expect(screen.queryByText('Obsolete command error')).not.toBeInTheDocument();
  expect(screen.getByText('#1001')).toBeInTheDocument();
});
