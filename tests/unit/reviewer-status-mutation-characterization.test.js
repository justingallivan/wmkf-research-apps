/**
 * @jest-environment jsdom
 *
 * Stages 1E/6A: real rendered status actions replace the Stage 0 known-defect
 * assertions. Transport is isolated; the handler, menu and lifetime guards are real.
 */
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import ReviewerManagePanel from '../../shared/components/reviewers/ReviewerManagePanel';

jest.mock('../../shared/components/Layout', () => ({
  Card: ({ children }) => <div>{children}</div>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
}));

const reviewer = {
  suggestionId: 'aabbccdd-1111-4111-8111-111111111111',
  name: 'Dr. Baseline Reviewer',
  email: 'reviewer@example.org',
  reviewStatus: 'materials_sent',
  tokenState: 'active',
};
const otherReviewer = { ...reviewer, suggestionId: '33333333-3333-4333-8333-333333333333', name: 'Dr. Other Reviewer' };
const proposal = { proposalId: '22222222-2222-4222-8222-222222222222', proposalTitle: 'Status test request' };
const originalFetch = global.fetch;
let statusFetch;
let materialsRender;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(body = { success: true }, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: jest.fn(async () => body) };
}

function outcomeBody(success = true, id = reviewer.suggestionId) {
  return {
    success,
    savedIds: success ? [id] : [],
    failedIds: success ? [] : [id],
    notAttemptedIds: [],
    ...(success ? {} : { error: 'Failed to update reviewer' }),
  };
}

function outcomeResponse(success = true, id = reviewer.suggestionId) {
  return response(outcomeBody(success, id), success ? 200 : 500);
}

function openStatus(row = reviewer) {
  fireEvent.click(screen.getByRole('button', { name: `Manage ${row.name || 'reviewer'}` }));
  return screen.getByLabelText(`Correct status for ${row.name || 'reviewer'}`);
}

function changeStatus(row = reviewer) {
  fireEvent.change(openStatus(row), { target: { value: 'under_review' } });
}

function expectUnconfirmed(label = reviewer.name, detail) {
  expect(window.alert).toHaveBeenCalledTimes(1);
  const message = window.alert.mock.calls[0][0];
  expect(message).toContain(`Could not confirm the status update for ${label}`);
  expect(message).toMatch(/Reload before trying again/i);
  if (detail) expect(message).toMatch(detail);
}

const lateOutcomes = [
  { name: 'success', settle: (job) => job.resolve(response()) },
  { name: 'HTTP failure', settle: (job) => job.resolve(response({ error: 'Conflict' }, 409)) },
  { name: 'invalid payload', settle: (job) => job.resolve(response({ success: false })) },
  { name: 'malformed JSON', settle: (job) => job.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad JSON'); } }) },
  { name: 'network failure', settle: (job) => job.reject(new Error('offline')) },
  { name: 'structured success', settle: (job) => job.resolve(outcomeResponse()) },
  { name: 'structured uncertain failure', settle: (job) => job.resolve(outcomeResponse(false)) },
  { name: 'malformed structured result', settle: (job) => job.resolve(response({ success: true, savedIds: [otherReviewer.suggestionId] })) },
];
const contextChanges = ['request switch', 'request away and back', 'mode away and back', 'row disappears and returns', 'management permission away and back', 'read-only away and back', 'unmount'];

function invalidate(view, change) {
  if (change === 'unmount') view.unmount();
  else if (change.startsWith('request')) {
    view.update({ proposal: { ...proposal, proposalId: 'another-request' } });
    if (change === 'request away and back') view.update({ proposal: { ...proposal } });
  } else if (change === 'mode away and back') {
    view.update({ mode: 'all' });
    view.update({ mode: 'track' });
  } else if (change === 'row disappears and returns') {
    view.update({ reviewers: [] });
    view.update({ reviewers: [{ ...reviewer }] });
  } else if (change === 'management permission away and back') {
    view.update({ canManage: false });
    view.update({ canManage: true });
  } else {
    view.update({ previewReadOnly: true });
    view.update({ previewReadOnly: false });
  }
}

beforeEach(() => {
  statusFetch = jest.fn(() => { throw new Error('Unconfigured status PATCH'); });
  materialsRender = jest.fn(() => response({ drafts: [] }));
  global.fetch = jest.fn((url, options) => {
    if (url === '/api/review-manager/reviewers' && options?.method === 'PATCH') return statusFetch(url, options);
    if (url === '/api/review-manager/release-settings') return Promise.resolve(response({ attachProposalEmail: false }));
    if (url.startsWith('/api/review-manager/materials-preflight?')) return Promise.resolve(response({ ok: true, fileCount: 1 }));
    if (url.startsWith('/api/user-preferences')) return Promise.resolve(response({}));
    if (url === '/api/review-manager/render-emails') return Promise.resolve(materialsRender(url, options));
    throw new Error(`Unexpected UI request: ${url}`);
  });
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe.each([false, true])('Stage 1E/6A rendered status contract (StrictMode: %s)', (strict) => {
  function renderPanel(overrides = {}) {
    let props = { proposal, reviewers: [reviewer], mode: 'track', onRefresh: jest.fn(), ...overrides };
    const element = () => strict ? <StrictMode><ReviewerManagePanel {...props} /></StrictMode> : <ReviewerManagePanel {...props} />;
    const view = render(element());
    return { ...view, update: (patch) => { props = { ...props, ...patch }; view.rerender(element()); } };
  }

  test('exact success sends the existing single PATCH and refreshes once without overlay arguments', async () => {
    const result = response();
    statusFetch.mockResolvedValue(result);
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(statusFetch).toHaveBeenCalledWith('/api/review-manager/reviewers', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suggestionId: reviewer.suggestionId, reviewStatus: 'under_review' }),
    });
    expect(result.json).toHaveBeenCalledTimes(1);
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(openStatus()).toBeEnabled();
  });

  test.each([
    [403, { error: 'Forbidden' }, /Forbidden/],
    [409, { message: 'Row changed' }, /Row changed/],
    [500, { reason: 'Persistence failed' }, /Persistence failed/],
    [500, { success: true }, /500/],
    [403, { error: {}, message: 'Useful detail' }, /Useful detail/],
    [409, { error: '  ', message: false, reason: 9 }, /409/],
  ])('HTTP %i never refreshes and supplies useful failure detail', async (status, body, detail) => {
    statusFetch.mockResolvedValue(response(body, status));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(reviewer.name, detail);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(openStatus()).toBeEnabled();
  });

  test.each([false, undefined, 'true', 1, null])('success=%s is not boolean confirmation', async (success) => {
    statusFetch.mockResolvedValue(response({ success }));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(reviewer.name, /response/i);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each([null, true, 1, 'success', []])('body=%s cannot confirm a status update', async (body) => {
    statusFetch.mockResolvedValue(response(body));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(reviewer.name, /response/i);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    { name: 'malformed JSON', result: () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } }), detail: /invalid response/i },
    { name: 'rejected fetch', result: () => Promise.reject(new Error('offline')), detail: /network.*offline/i },
  ])('$name reports an unconfirmed outcome without retry', async ({ result, detail }) => {
    statusFetch.mockImplementation(result);
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(reviewer.name, detail);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each([
    [{ ...reviewer, name: '' }, reviewer.email],
    [{ ...reviewer, name: '', email: '' }, reviewer.suggestionId],
    [{ ...reviewer, name: 'Dr. José 李 ' + 'A'.repeat(100) }, 'Dr. José 李 ' + 'A'.repeat(100)],
  ])('failure identifies the captured reviewer using its name/email/id fallback', async (row, label) => {
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    const view = renderPanel({ reviewers: [row] });
    changeStatus(row);
    view.update({ reviewers: [{ ...row, name: 'Replacement label' }] });
    await act(async () => job.resolve(response({ error: 'Denied' }, 403)));
    expectUnconfirmed(label, /Denied/);
  });

  test.each(contextChanges.flatMap(change => lateOutcomes.map(outcome => ({ change, ...outcome }))))('$name after $change never alerts or refreshes any context', async ({ change, settle }) => {
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    const oldRefresh = jest.fn();
    const newRefresh = jest.fn();
    const view = renderPanel({ onRefresh: oldRefresh });
    changeStatus();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    invalidate(view, change);
    if (change !== 'unmount') view.update({ onRefresh: newRefresh });
    await act(async () => settle(job));
    expect(window.alert).not.toHaveBeenCalled();
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each(contextChanges.flatMap(change => ['success', 'invalid payload', 'rejected JSON', 'structured success', 'structured uncertain failure', 'malformed structured result'].map(outcome => ({ change, outcome }))))('pending JSON $outcome after $change never produces stale feedback', async ({ change, outcome }) => {
    const jsonJob = deferred();
    const json = jest.fn(() => jsonJob.promise);
    statusFetch.mockResolvedValue({ ok: true, status: 200, json });
    const onRefresh = jest.fn();
    const view = renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(json).toHaveBeenCalledTimes(1);
    invalidate(view, change);
    await act(async () => {
      if (outcome === 'rejected JSON') jsonJob.reject(new Error('late invalid JSON'));
      else if (outcome === 'structured success') jsonJob.resolve(outcomeBody());
      else if (outcome === 'structured uncertain failure') jsonJob.resolve(outcomeBody(false));
      else if (outcome === 'malformed structured result') jsonJob.resolve({ success: true, savedIds: [otherReviewer.suggestionId] });
      else jsonJob.resolve({ success: outcome === 'success' });
    });
    expect(onRefresh).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('same-row changes before rerender and after reopening acquire only one pending operation', async () => {
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    renderPanel();
    const select = openStatus();
    act(() => {
      fireEvent.change(select, { target: { value: 'under_review' } });
      fireEvent.change(select, { target: { value: 'review_received' } });
    });
    const pending = openStatus();
    expect(pending).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Updating status…');
    fireEvent.change(pending, { target: { value: 'review_received' } });
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Revoke link' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Regenerate link & copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Release from assignment' })).toBeEnabled();
    await act(async () => job.resolve(response()));
    expect(screen.getByLabelText(`Correct status for ${reviewer.name}`)).toBeEnabled();
    expect(screen.queryByText('Updating status…')).not.toBeInTheDocument();
  });

  test('synchronous reentrant live DOM status events acquire only one mutex', async () => {
    const job = deferred();
    let select;
    statusFetch.mockImplementationOnce(() => {
      // Reenter before the first event can commit its closed/pending menu.
      expect(select).toBeInTheDocument();
      expect(select).toBeEnabled();
      fireEvent.change(select, { target: { value: 'review_received' } });
      return job.promise;
    }).mockReturnValue(job.promise);
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    select = openStatus();
    fireEvent.change(select, { target: { value: 'under_review' } });
    expect(statusFetch).toHaveBeenCalledTimes(1);
    await act(async () => job.resolve(response()));
    expect(onRefresh.mock.calls).toEqual([[]]);
  });

  test('different reviewers can proceed independently and one completion does not unlock the other', async () => {
    const first = deferred();
    const second = deferred();
    statusFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const onRefresh = jest.fn();
    renderPanel({ reviewers: [reviewer, otherReviewer], onRefresh });
    changeStatus();
    changeStatus(otherReviewer);
    expect(statusFetch).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(response({ error: 'Other row conflict' }, 409)));
    expectUnconfirmed(otherReviewer.name, /Other row conflict/);
    expect(openStatus(otherReviewer)).toBeEnabled();
    expect(openStatus()).toBeDisabled();
    await act(async () => first.resolve(response()));
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(screen.getByLabelText(`Correct status for ${reviewer.name}`)).toBeEnabled();
  });

  test.each(contextChanges.filter(change => change.includes('back') || change.includes('returns')))('lock survives %s until its invalidated attempt settles, then explicit action can run', async (change) => {
    const job = deferred();
    statusFetch.mockReturnValueOnce(job.promise).mockResolvedValue(response());
    const onRefresh = jest.fn();
    const view = renderPanel({ onRefresh });
    changeStatus();
    invalidate(view, change);
    const select = openStatus();
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: 'review_received' } });
    expect(statusFetch).toHaveBeenCalledTimes(1);
    await act(async () => job.resolve(response()));
    expect(onRefresh).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByLabelText(`Correct status for ${reviewer.name}`)).toBeEnabled();
    fireEvent.change(screen.getByLabelText(`Correct status for ${reviewer.name}`), { target: { value: 'under_review' } });
    await act(async () => {});
    expect(statusFetch).toHaveBeenCalledTimes(2);
    expect(onRefresh.mock.calls).toEqual([[]]);
  });

  test('fresh same-context objects and callback retain validity and use only the current callback', async () => {
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    const oldRefresh = jest.fn();
    const newRefresh = jest.fn();
    const view = renderPanel({ onRefresh: oldRefresh });
    changeStatus();
    view.update({ proposal: { ...proposal }, reviewers: [{ ...reviewer }], onRefresh: newRefresh });
    await act(async () => job.resolve(response()));
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh.mock.calls).toEqual([[]]);
    expect(window.alert).not.toHaveBeenCalled();
  });

  test.each(['throw', 'reject'])('confirmed save followed by callback %s reports a separate refresh failure', async (kind) => {
    statusFetch.mockResolvedValue(response());
    const onRefresh = jest.fn(() => {
      if (kind === 'throw') throw new Error('refresh failed');
      return Promise.reject(new Error('refresh failed'));
    });
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert.mock.calls[0][0]).toContain(`Status saved for ${reviewer.name}`);
    expect(window.alert.mock.calls[0][0]).toMatch(/could not be refreshed.*Reload to see the current status/s);
    expect(window.alert.mock.calls[0][0]).not.toMatch(/Could not confirm/);
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(openStatus()).toBeEnabled();
  });

  test.each(contextChanges)('refresh rejection after %s stays silent and releases matching pending state', async (change) => {
    const refreshJob = deferred();
    statusFetch.mockResolvedValue(response());
    const onRefresh = jest.fn(() => refreshJob.promise);
    const view = renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(onRefresh).toHaveBeenCalledTimes(1);
    invalidate(view, change);
    await act(async () => refreshJob.reject(new Error('late refresh failure')));
    expect(window.alert).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    if (change !== 'unmount') expect(openStatus()).toBeEnabled();
  });

  test.each(['void', 'absent', 'internally handled'])('%s callback does not fabricate a refresh failure', async (kind) => {
    statusFetch.mockResolvedValue(response());
    const onRefresh = kind === 'absent' ? undefined : jest.fn(() => kind === 'void' ? undefined : Promise.reject(new Error('caught by host')).catch(() => {}));
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    if (onRefresh) expect(onRefresh.mock.calls).toEqual([[]]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each([reviewer.suggestionId, `  ${reviewer.suggestionId.toUpperCase()}  `])('structured success validates canonical ID %s and confirms only after current refresh settles', async (returnedId) => {
    const refreshJob = deferred();
    statusFetch.mockResolvedValue(outcomeResponse(true, returnedId));
    const onRefresh = jest.fn(() => refreshJob.promise);
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(window.alert).not.toHaveBeenCalled();
    expect(openStatus()).toBeDisabled();
    await act(async () => refreshJob.resolve());
    expect(window.alert.mock.calls).toEqual([[`Status saved for ${reviewer.name} (${reviewer.suggestionId}).`]]);
    expect(screen.getByLabelText(`Correct status for ${reviewer.name}`)).toBeEnabled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test('structured single failure identifies the submitted name and ID without claiming no write occurred', async () => {
    statusFetch.mockResolvedValue(outcomeResponse(false, ` ${reviewer.suggestionId.toUpperCase()} `));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(`${reviewer.name} (${reviewer.suggestionId})`, /Failed to update reviewer/);
    expect(window.alert.mock.calls[0][0]).toMatch(/review the current status/i);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(openStatus()).toBeEnabled();
  });

  const protocolKeys = ['savedIds', 'failedIds', 'notAttemptedIds'];
  const malformedOutcomes = [
    ...protocolKeys.map(key => ({ name: `only ${key}`, body: { success: true, [key]: key === 'savedIds' ? [reviewer.suggestionId] : [] } })),
    ...protocolKeys.map(key => ({ name: `missing ${key}`, body: Object.fromEntries(Object.entries(outcomeBody()).filter(([name]) => name !== key)) })),
    ...protocolKeys.flatMap(key => [null, undefined, 'not an array', {}, 7, false].map(value => ({ name: `${key}=${String(value)}`, body: { ...outcomeBody(), [key]: value } }))),
    ...['', ' ', null, 7, {}, 'not-a-guid', 'aabbccdd-1111-4111-8111-111111111111/extra'].map(id => ({ name: `invalid ID ${String(id)}`, body: { ...outcomeBody(), savedIds: [id] } })),
    { name: 'all empty', body: { success: true, savedIds: [], failedIds: [], notAttemptedIds: [] } },
    { name: 'foreign saved ID', body: outcomeBody(true, otherReviewer.suggestionId) },
    { name: 'duplicate saved ID', body: { ...outcomeBody(), savedIds: [reviewer.suggestionId, reviewer.suggestionId] } },
    { name: 'case variant duplicate', body: { ...outcomeBody(), savedIds: [reviewer.suggestionId, ` ${reviewer.suggestionId.toUpperCase()} `] } },
    { name: 'same ID in multiple categories', body: { ...outcomeBody(), failedIds: [reviewer.suggestionId] } },
    { name: 'unsolicited partial batch', body: { success: false, savedIds: [reviewer.suggestionId], failedIds: [otherReviewer.suggestionId], notAttemptedIds: [] }, status: 500 },
    { name: 'reordered foreign prefix', body: { success: false, savedIds: [otherReviewer.suggestionId], failedIds: [reviewer.suggestionId], notAttemptedIds: [] }, status: 500 },
    { name: 'unattempted only', body: { success: false, savedIds: [], failedIds: [], notAttemptedIds: [reviewer.suggestionId] }, status: 500 },
    { name: 'inherited required array', body: Object.assign(Object.create({ failedIds: [] }), { success: true, savedIds: [reviewer.suggestionId], notAttemptedIds: [] }) },
    ...[false, undefined, 'true', 1, null].map(success => ({ name: `saved partition success=${success}`, body: { ...outcomeBody(), success } })),
    { name: 'success with error', body: { ...outcomeBody(), error: 'Contradiction' } },
  ];
  test.each(malformedOutcomes)('malformed outcome $name never refreshes or partially trusts saved identities', async ({ body, status = 200 }) => {
    statusFetch.mockResolvedValue(response(body, status));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(`${reviewer.name} (${reviewer.suggestionId})`, /invalid response/i);
    expect(window.alert.mock.calls[0][0]).not.toMatch(/Status saved/);
    expect(window.alert.mock.calls[0][0]).not.toContain(otherReviewer.suggestionId);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(openStatus()).toBeEnabled();
  });

  test.each([
    [200, false, false], [500, true, true], [200, true, false],
    [500, false, true], [207, true, true], [201, true, true],
    [403, false, false], [409, false, false], [503, false, false],
    [200, false, true], [500, true, false],
  ])('structured HTTP %i ok=%s saved=%s must match the exact 200/500 contract', async (status, ok, saved) => {
    statusFetch.mockResolvedValue({ ...response(outcomeBody(saved), status), ok });
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(`${reviewer.name} (${reviewer.suggestionId})`, /invalid response/i);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test.each(['Rejected', {}, [], true, 1, null, false, ''])('legacy claimed success with own error=%s is contradictory', async (error) => {
    statusFetch.mockResolvedValue(response({ success: true, error }));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });

  test('an array with a success property is never accepted as a legacy object', async () => {
    statusFetch.mockResolvedValue(response(Object.assign([], { success: true })));
    const onRefresh = jest.fn();
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expectUnconfirmed(reviewer.name, /invalid response/i);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test.each(['throw', 'reject'])('structured confirmed save plus refresh %s retains name and ID in separate refresh failure', async (kind) => {
    statusFetch.mockResolvedValue(outcomeResponse());
    const onRefresh = jest.fn(() => {
      if (kind === 'throw') throw new Error('refresh failed');
      return Promise.reject(new Error('refresh failed'));
    });
    renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(window.alert).toHaveBeenCalledTimes(1);
    expect(window.alert.mock.calls[0][0]).toContain(`Status saved for ${reviewer.name} (${reviewer.suggestionId}), but`);
    expect(window.alert.mock.calls[0][0]).toMatch(/could not be refreshed/);
    expect(window.alert.mock.calls[0][0]).not.toMatch(/Could not confirm/);
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(statusFetch).toHaveBeenCalledTimes(1);
    expect(openStatus()).toBeEnabled();
  });

  test.each(contextChanges.flatMap(change => ['resolve', 'reject'].map(completion => ({ change, completion }))))('structured refresh $completion after $change suppresses new success and error feedback', async ({ change, completion }) => {
    const refreshJob = deferred();
    statusFetch.mockResolvedValue(outcomeResponse());
    const onRefresh = jest.fn(() => refreshJob.promise);
    const view = renderPanel({ onRefresh });
    changeStatus();
    await act(async () => {});
    expect(onRefresh.mock.calls).toEqual([[]]);
    invalidate(view, change);
    await act(async () => completion === 'reject' ? refreshJob.reject(new Error('late read failure')) : refreshJob.resolve());
    expect(window.alert).not.toHaveBeenCalled();
    expect(statusFetch).toHaveBeenCalledTimes(1);
    if (change !== 'unmount') expect(openStatus()).toBeEnabled();
  });

  test('structured result uses captured identity and current same-context callback', async () => {
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    const oldRefresh = jest.fn();
    const newRefresh = jest.fn();
    const view = renderPanel({ onRefresh: oldRefresh });
    changeStatus();
    view.update({ proposal: { ...proposal }, reviewers: [{ ...reviewer, name: 'New label' }], onRefresh: newRefresh });
    await act(async () => job.resolve(outcomeResponse()));
    expect(oldRefresh).not.toHaveBeenCalled();
    expect(newRefresh.mock.calls).toEqual([[]]);
    expect(window.alert.mock.calls).toEqual([[`Status saved for ${reviewer.name} (${reviewer.suggestionId}).`]]);
  });

  test('structured pending results keep independent locks, release invalidated work, and allow deliberate retry', async () => {
    const first = deferred();
    const second = deferred();
    statusFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(outcomeResponse());
    const onRefresh = jest.fn();
    const view = renderPanel({ reviewers: [reviewer, otherReviewer], onRefresh });
    changeStatus();
    changeStatus(otherReviewer);
    await act(async () => second.resolve(outcomeResponse(false, otherReviewer.suggestionId)));
    expectUnconfirmed(`${otherReviewer.name} (${otherReviewer.suggestionId})`);
    window.alert.mockClear();
    invalidate(view, 'request away and back');
    expect(openStatus()).toBeDisabled();
    fireEvent.change(screen.getByLabelText(`Correct status for ${reviewer.name}`), { target: { value: 'review_received' } });
    expect(statusFetch).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve(outcomeResponse()));
    expect(window.alert).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
    const select = screen.getByLabelText(`Correct status for ${reviewer.name}`);
    expect(select).toBeEnabled();
    fireEvent.change(select, { target: { value: 'under_review' } });
    await act(async () => {});
    expect(statusFetch).toHaveBeenCalledTimes(3);
    expect(onRefresh.mock.calls).toEqual([[]]);
    expect(window.alert.mock.calls).toEqual([[`Status saved for ${reviewer.name} (${reviewer.suggestionId}).`]]);
  });

  test('pending status preserves accepted selection and the open materials modal with its subset', async () => {
    const accepted = { ...reviewer, reviewStatus: 'accepted' };
    const otherAccepted = { ...otherReviewer, reviewStatus: 'accepted' };
    const job = deferred();
    statusFetch.mockReturnValue(job.promise);
    renderPanel({ reviewers: [accepted, otherAccepted] });
    fireEvent.click(within(screen.getByText(accepted.name).closest('tr')).getByRole('checkbox'));
    changeStatus(accepted);
    expect(within(screen.getByText(accepted.name).closest('tr')).getByRole('checkbox')).toBeChecked();
    expect(within(screen.getByText(otherAccepted.name).closest('tr')).getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: /release proposal to reviewers \(1\)/i }));
    await act(async () => {});
    expect(screen.getByText(/Reviewers access materials via their secure portal link/i)).toBeInTheDocument();
    await act(async () => job.resolve(response()));
    expect(screen.getByText(/Reviewers access materials via their secure portal link/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /preview 1 email/i }));
    await act(async () => {});
    expect(materialsRender).toHaveBeenCalledTimes(1);
    expect(JSON.parse(materialsRender.mock.calls[0][1].body).suggestionIds).toEqual([accepted.suggestionId]);
    expect(statusFetch).toHaveBeenCalledTimes(1);
  });
});
