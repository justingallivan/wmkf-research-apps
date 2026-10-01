/** @jest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import useReviewerRoster from '../../shared/components/reviewers/search/useReviewerRoster';
import { requestEnvelope } from '../../shared/utils/api-request';

jest.mock('../../shared/utils/api-request', () => ({ requestEnvelope: jest.fn() }));

const snapshot = { success: true, active: [], retention: { version: 1, rows: [] } };
function setup() {
  const setters = Object.fromEntries([
    'setRosterActive', 'setRosterExcluded', 'setRosterIneligible', 'setRosterBlocked',
    'setRosterHandled', 'setRosterSavedKeys', 'setRosterNames', 'setRosterRetention',
    'setRepairRequestsByCandidateKey', 'setRepairRequestsUnavailable',
    'setRosterLoaded', 'setRosterLoadFailed', 'setRosterNote',
  ].map((name) => [name, jest.fn()]));
  const genRef = { current: 1 };
  const runningRef = { current: null };
  const hook = renderHook(() => useReviewerRoster({ requestId: 'request-test', genRef, runningRef, ...setters }));
  return { ...hook, genRef, runningRef, ...setters };
}
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
beforeEach(() => jest.resetAllMocks());

test.each([
  ['null JSON body', () => Promise.resolve({ ok: true, data: null })],
  ['HTTP failure', () => Promise.resolve({ ok: false, data: { success: false } })],
  ['failure body', () => Promise.resolve({ ok: true, data: { success: false } })],
  ['incomplete retention', () => Promise.resolve({ ok: true, data: { success: true } })],
  ['network failure', () => Promise.reject(new Error('offline'))],
])('reload marks failed state after %s and clears it after a valid read', async (_label, fail) => {
  const hook = setup();
  requestEnvelope.mockImplementationOnce(fail).mockResolvedValueOnce({ ok: true, data: snapshot });
  await act(async () => { await hook.result.current.reloadRoster(); });
  expect(hook.setRosterLoaded).toHaveBeenLastCalledWith(false);
  expect(hook.setRosterLoadFailed).toHaveBeenLastCalledWith(true);
  expect(hook.setRosterActive).not.toHaveBeenCalled();
  await act(async () => { await hook.result.current.reloadRoster(); });
  expect(hook.setRosterLoaded).toHaveBeenLastCalledWith(true);
  expect(hook.setRosterLoadFailed).toHaveBeenLastCalledWith(false);
  expect(hook.setRosterRetention).toHaveBeenCalledWith(snapshot.retention);
});

test.each(['http', 'network'])('older %s failure cannot overwrite a newer successful read in the same generation', async (kind) => {
  const hook = setup();
  const older = deferred();
  requestEnvelope.mockReturnValueOnce(older.promise).mockResolvedValueOnce({ ok: true, data: snapshot });
  let pending;
  await act(async () => { pending = hook.result.current.reloadRoster(); });
  await act(async () => { await hook.result.current.reloadRoster(); });
  hook.setRosterLoaded.mockClear(); hook.setRosterLoadFailed.mockClear();
  await act(async () => {
    if (kind === 'network') older.reject(new Error('late offline'));
    else older.resolve({ ok: false, data: { success: false } });
    await pending;
  });
  expect(hook.setRosterLoaded).not.toHaveBeenCalled();
  expect(hook.setRosterLoadFailed).not.toHaveBeenCalled();
});

test('retry completion cannot restore failed flags after its read is invalidated', async () => {
  const hook = setup();
  const older = deferred();
  requestEnvelope.mockReturnValueOnce(older.promise);
  let pending;
  await act(async () => { pending = hook.result.current.retryRosterLoad(); });
  hook.result.current.invalidateRosterReads();
  hook.setRosterLoaded.mockClear(); hook.setRosterLoadFailed.mockClear(); hook.setRosterNote.mockClear();
  await act(async () => { older.resolve({ ok: false, data: { success: false } }); await pending; });
  expect(hook.setRosterLoaded).not.toHaveBeenCalled();
  expect(hook.setRosterLoadFailed).not.toHaveBeenCalled();
  expect(hook.setRosterNote).not.toHaveBeenCalled();
  expect(hook.runningRef.current).toBeNull();
});

test('a late network failure cannot update a different request generation', async () => {
  const hook = setup();
  const older = deferred();
  requestEnvelope.mockReturnValueOnce(older.promise);
  let pending;
  await act(async () => { pending = hook.result.current.reloadRoster(); });
  hook.genRef.current += 1;
  await act(async () => { older.reject(new Error('late offline')); await pending; });
  expect(hook.setRosterLoaded).not.toHaveBeenCalled();
  expect(hook.setRosterLoadFailed).not.toHaveBeenCalled();
  expect(hook.setRosterActive).not.toHaveBeenCalled();
});
