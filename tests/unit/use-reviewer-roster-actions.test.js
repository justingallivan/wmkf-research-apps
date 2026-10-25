/**
 * useReviewerRosterActions — T4 client-request-layer matrix (Stage 4). This
 * hook has no dedicated render test today; this file adds a minimal harness
 * ahead of migrating its 4 fetch sites onto shared/utils/api-request.js:
 *   - excludeCandidate           PATCH /api/workbench/reviewer-roster (body
 *     never read on success today — only `!res.ok` is checked)
 *   - excludeUnverifiedCandidate PATCH /api/workbench/reviewer-roster (same)
 *   - promoteCandidate           PATCH /api/workbench/reviewer-roster (409 +
 *     data.code allowlist, then !ok||!data.success)
 *   - removePreviousResults      PATCH /api/workbench/reviewer-roster
 */
import { StrictMode, useCallback, useRef, useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import useReviewerRosterActions from '../../shared/components/reviewers/search/useReviewerRosterActions';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const OTHER = { candidateKey: 'candidate:grace-hopper', name: 'Grace Hopper' };
const CAND = { candidateKey: 'candidate:ada-lovelace', name: 'Ada Lovelace' };

window.confirm = jest.fn(() => true);

function Harness({
  reloadRoster = jest.fn(async () => true),
  previousSearchRefs = [{ candidateKey: 'suggestion:s-2' }],
  includeActive = true,
  includeCandidate = true,
  initialNames = [CAND.name],
  initialSelected = [],
  otherCandidate = OTHER,
}) {
  const genRef = useRef(0);
  const [rosterActive, setRosterActive] = useState(includeActive ? [CAND] : []);
  const [rosterExcluded, setRosterExcluded] = useState([]);
  const [rosterIneligible, setRosterIneligible] = useState([]);
  const [rosterBlocked, setRosterBlocked] = useState([]);
  const [rosterHandled, setRosterHandled] = useState([]);
  const [rosterSavedKeys, setRosterSavedKeys] = useState([]);
  const rosterNamesRevisionRef = useRef(0);
  const selectionRevisionRef = useRef(0);
  const [rosterNames, setExclusionNames] = useState(initialNames);
  const setRosterNames = useCallback((value) => {
    rosterNamesRevisionRef.current++;
    setExclusionNames(value);
  }, []);
  const [selected, setExclusionSelection] = useState(new Set(initialSelected));
  const setSelected = useCallback((value) => {
    selectionRevisionRef.current++;
    setExclusionSelection(value);
  }, []);
  const [rosterNote, setRosterNote] = useState(null);
  const [removingPrevious, setRemovingPrevious] = useState(false);
  const [candidates, setCandidates] = useState(includeCandidate ? [CAND] : []);
  const [recCandidates, setRecCandidates] = useState([]);
  const [unverified, setUnverified] = useState([CAND]);

  const reloadAndApplySnapshot = async (...args) => {
    const snapshot = await reloadRoster(...args);
    if (snapshot && typeof snapshot === 'object') {
      setRosterActive(Array.isArray(snapshot.active) ? snapshot.active : []);
      setRosterExcluded(Array.isArray(snapshot.excluded) ? snapshot.excluded : []);
      setRosterIneligible(Array.isArray(snapshot.ineligible) ? snapshot.ineligible : []);
      setRosterBlocked(Array.isArray(snapshot.blocked) ? snapshot.blocked : []);
      setRosterHandled(Array.isArray(snapshot.handled) ? snapshot.handled : []);
      setRosterSavedKeys(Array.isArray(snapshot.savedKeys) ? snapshot.savedKeys : []);
      setRosterNames(Array.isArray(snapshot.allNames) ? snapshot.allNames : []);
    }
    return snapshot;
  };

  const actions = useReviewerRosterActions({
    requestId: REQ, genRef, busy: false, removingPrevious,
    rosterNames, selected, selectionRevisionRef, rosterNamesRevisionRef,
    setExclusionNames, setExclusionSelection, previousSearchKeys: new Set(previousSearchRefs.map((r) => r.candidateKey)),
    previousSearchRefs, reloadRoster: reloadAndApplySnapshot,
    setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setRosterIneligible,
    setRosterBlocked, setRosterHandled, setRosterSavedKeys, setRosterNames, setSelected,
    setRosterNote, setRemovingPrevious, setUnverified,
  });

  return (
    <div>
      <div data-testid="roster-note">{rosterNote ?? ''}</div>
      <div data-testid="roster-active">{JSON.stringify(rosterActive)}</div>
      <div data-testid="roster-excluded">{JSON.stringify(rosterExcluded)}</div>
      <div data-testid="roster-saved">{JSON.stringify(rosterSavedKeys)}</div>
      <div data-testid="candidates-visible">{JSON.stringify(candidates)}</div>
      <div data-testid="rec-candidates-visible">{JSON.stringify(recCandidates)}</div>
      <div data-testid="unverified-visible">{JSON.stringify(unverified)}</div>
      <div data-testid="roster-names">{JSON.stringify(rosterNames)}</div>
      <div data-testid="selected">{JSON.stringify([...selected])}</div>
      <button data-testid="select-other" onClick={() => setSelected((prev) => new Set([...prev, 'other']))}>select other</button>
      <button data-testid="clear-selection" onClick={() => setSelected(new Set())}>clear</button>
      <button data-testid="switch-context" onClick={() => {
        genRef.current++;
        setRosterActive([]); setRosterExcluded([]); setRosterNames(['New request']);
        setSelected(new Set(['new-request'])); setRosterNote(null);
      }}>switch</button>
      <button data-testid="exclude" onClick={() => actions.excludeCandidate(CAND)}>exclude</button>
      <button data-testid="exclude-other" onClick={() => actions.excludeCandidate(otherCandidate)}>exclude other</button>
      <button data-testid="exclude-both" onClick={() => {
        actions.excludeCandidate(CAND); actions.excludeCandidate(otherCandidate);
      }}>exclude both</button>
      <button data-testid="refresh-roster" onClick={() => {
        setRosterNames([CAND.name, 'Fresh']);
        setRosterExcluded([CAND]); setRosterActive([]);
      }}>refresh</button>
      <button data-testid="exclude-unverified" onClick={() => actions.excludeUnverifiedCandidate(CAND)}>exclude-unverified</button>
      <button data-testid="promote" onClick={() => actions.promoteCandidate(CAND)}>promote</button>
      <button data-testid="remove-previous" onClick={() => actions.removePreviousResults()}>remove-previous</button>
    </div>
  );
}

afterEach(() => { jest.restoreAllMocks(); });

test('excludeCandidate: PATCH sends exact body bytes/headers; a 2xx malformed body does not roll back (body never read on success)', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    sentOpts = opts;
    return Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-excluded').textContent).toContain(CAND.candidateKey));
  expect(screen.getByTestId('roster-note').textContent).toBe('');
  expect(sentOpts.method).toBe('PATCH');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toMatchObject({ requestId: REQ, action: 'exclude' });
  expect(JSON.parse(sentOpts.body).candidate.candidateKey).toBe(CAND.candidateKey);
});

test('excludeCandidate: non-2xx rolls the optimistic move back and sets the fixed error note', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't exclude that reviewer — please try again."));
  expect(screen.getByTestId('roster-active').textContent).toContain(CAND.candidateKey);
});

test('excludeCandidate: network rejection rolls back the same way', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't exclude that reviewer — please try again."));
});

test.each([
  ['exclude', true, true],
  ['exclude-unverified', false, true],
])('%s: saved conflict reloads roster and clears the exact stale Find key', async (button, includeActive, includeCandidate) => {
  const reloadRoster = jest.fn(async () => ({
    active: [], excluded: [], ineligible: [], blocked: [], handled: [], savedKeys: [], allNames: ['Ada Lovelace'],
  }));
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false,
    status: 409,
    json: async () => ({
      success: false,
      error: 'This reviewer is already on Invite. Remove them from this request on the Invite tab.',
      code: 'candidate_already_saved',
    }),
  }));
  render(<Harness reloadRoster={reloadRoster} includeActive={includeActive} includeCandidate={includeCandidate} />);
  await act(async () => { screen.getByTestId(button).click(); });

  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toMatch(/already on Invite/));
  expect(reloadRoster).toHaveBeenCalledWith(0);
  expect(screen.getByTestId('roster-excluded').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('roster-active').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('candidates-visible').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('rec-candidates-visible').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('unverified-visible').textContent).not.toContain(CAND.candidateKey);
});

test('saved conflict with a failed roster refresh does not run generic rollback or restore the unverified card', async () => {
  const reloadRoster = jest.fn(async () => { throw new Error('refresh unavailable'); });
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false,
    status: 409,
    json: async () => ({ success: false, code: 'candidate_already_saved' }),
  }));
  render(<Harness reloadRoster={reloadRoster} includeActive={false} includeCandidate />);
  await act(async () => { screen.getByTestId('exclude-unverified').click(); });

  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toMatch(/Reload the reviewer roster/));
  expect(screen.getByTestId('roster-excluded').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('candidates-visible').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('unverified-visible').textContent).not.toContain(CAND.candidateKey);
});

test('saved conflict with a failed roster refresh does not restore the optimistic normal Find card', async () => {
  const reloadRoster = jest.fn(async () => { throw new Error('refresh unavailable'); });
  global.fetch = jest.fn(() => Promise.resolve({
    ok: false,
    status: 409,
    json: async () => ({ success: false, code: 'candidate_already_saved' }),
  }));
  render(<Harness reloadRoster={reloadRoster} />);
  await act(async () => { screen.getByTestId('exclude').click(); });

  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toMatch(/Reload the reviewer roster/));
  expect(screen.getByTestId('roster-active').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('roster-excluded').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('candidates-visible').textContent).not.toContain(CAND.candidateKey);
  expect(screen.getByTestId('unverified-visible').textContent).not.toContain(CAND.candidateKey);
});

test('excludeUnverifiedCandidate: 2xx malformed body does not roll back', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude-unverified').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-excluded').textContent).toContain(CAND.candidateKey));
  expect(screen.getByTestId('roster-note').textContent).toBe('');
});

test('promoteCandidate: 409 + {code: candidate_not_excluded} reloads the roster instead of throwing', async () => {
  const reloadRoster = jest.fn(async () => true);
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 409, json: async () => ({ code: 'candidate_not_excluded', stage: 'invited' }) }));
  render(<Harness reloadRoster={reloadRoster} />);
  await act(async () => { screen.getByTestId('promote').click(); });
  await waitFor(() => expect(reloadRoster).toHaveBeenCalled());
  expect(screen.getByTestId('roster-note').textContent).toMatch(/no longer actionable \(invited\)/);
});

test('promoteCandidate: 200 + {success:false} throws and rolls back to excluded', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({ success: false, error: 'not eligible' }) }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('promote').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't return that reviewer to the active list — please try again."));
});

test('promoteCandidate: request bytes are exact', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    sentOpts = opts;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('promote').click(); });
  await waitFor(() => expect(sentOpts).not.toBeNull());
  expect(sentOpts.method).toBe('PATCH');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toEqual({ requestId: REQ, action: 'promote', candidateKey: CAND.candidateKey });
});

test('removePreviousResults: request bytes exact; success repopulates every roster bucket from the response', async () => {
  let sentOpts = null;
  global.fetch = jest.fn((url, opts) => {
    sentOpts = opts;
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({
        success: true, active: [{ candidateKey: 'a' }], excluded: [], ineligible: [], blocked: [], handled: [],
        savedKeys: [], allNames: ['Ada Lovelace'], removedKeys: [], removed: 1,
      }),
    });
  });
  render(<Harness />);
  await act(async () => { screen.getByTestId('remove-previous').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe('1 previous search result removed.'));
  expect(sentOpts.method).toBe('PATCH');
  expect(JSON.parse(sentOpts.body)).toEqual({
    requestId: REQ, action: 'remove_previous_results', candidateRefs: [{ candidateKey: 'suggestion:s-2' }],
  });
});

test('removePreviousResults: non-2xx unparseable body is tolerated and surfaces the fixed error note', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 502, json: async () => { throw new Error('bad'); } }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('remove-previous').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't remove the previous search results — please try again."));
});

// Keep the request pending so user edits happen between the optimistic move and recovery.
function pendingExclusion(httpFailure = false) {
  let finish;
  global.fetch = jest.fn(() => new Promise((resolve, reject) => {
    finish = () => httpFailure
      ? resolve({ ok: false, status: 500, json: async () => ({ error: 'failed' }) })
      : reject(new Error('offline'));
  }));
  return async () => { await act(async () => { finish(); }); };
}
const state = (id) => JSON.parse(screen.getByTestId(id).textContent);

test.each([[true, false], [false, false], [true, true], [false, true]])('failed exclusion restores its name/selection changes (existing name: %s, HTTP failure: %s)', async (alreadyPresent, httpFailure) => {
  const fail = pendingExclusion(httpFailure);
  render(<Harness initialNames={alreadyPresent ? [CAND.name, 'Existing'] : ['Existing']} initialSelected={[CAND.candidateKey, 'keep']} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  expect(state('selected')).toEqual(['keep']);
  expect(state('roster-names')).toContain(CAND.name);
  await fail();
  expect(state('roster-active')).toEqual([expect.objectContaining(CAND)]);
  expect(state('roster-excluded')).toEqual([]);
  expect(state('roster-names')).toEqual(alreadyPresent ? [CAND.name, 'Existing'] : ['Existing']);
  expect(state('selected')).toEqual(['keep', CAND.candidateKey]);
});

test('failed exclusion does not select an initially unselected card', async () => {
  const fail = pendingExclusion();
  render(<Harness initialSelected={['keep']} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await fail();
  expect(state('selected')).toEqual(['keep']);
});

test.each(['select-other', 'clear-selection'])('failed exclusion preserves newer selection intent: %s', async (edit) => {
  const fail = pendingExclusion();
  render(<Harness initialNames={[]} initialSelected={[CAND.candidateKey, 'keep']} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await act(async () => { screen.getByTestId(edit).click(); });
  await fail();
  expect(state('selected')).toEqual(edit === 'select-other' ? ['keep', 'other'] : []);
  expect(state('roster-active')).toEqual([expect.objectContaining(CAND)]);
  expect(state('roster-names')).toEqual([]);
});

test('late exclusion failure cannot restore state into a different request', async () => {
  const fail = pendingExclusion();
  render(<Harness initialNames={[]} initialSelected={[CAND.candidateKey]} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await act(async () => { screen.getByTestId('switch-context').click(); });
  await fail();
  expect(state('roster-active')).toEqual([]);
  expect(state('roster-excluded')).toEqual([]);
  expect(state('roster-names')).toEqual(['New request']);
  expect(state('selected')).toEqual(['new-request']);
  expect(screen.getByTestId('roster-note').textContent).toBe('');
});

test.each([true, false])('unverified exclusion keeps its separate rollback (name already present: %s)', async (alreadyPresent) => {
  const fail = pendingExclusion();
  render(<Harness includeActive={false} initialNames={alreadyPresent ? [CAND.name] : []} initialSelected={['keep']} />);
  await act(async () => { screen.getByTestId('exclude-unverified').click(); });
  await fail();
  expect(state('roster-active')).toEqual([]);
  expect(state('roster-excluded')).toEqual([]);
  expect(state('roster-names')).toEqual(alreadyPresent ? [CAND.name] : []);
  expect(state('selected')).toEqual(['keep']);
  expect(state('unverified-visible')).toEqual([CAND]);
});


test('successful exclusion keeps the new name and removes only the excluded selection', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }));
  render(<Harness initialNames={['Existing']} initialSelected={[CAND.candidateKey, 'keep']} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  expect(state('roster-active')).toEqual([]);
  expect(state('roster-excluded')).toEqual([expect.objectContaining(CAND)]);
  expect(state('roster-names')).toEqual(['Existing', CAND.name]);
  expect(state('selected')).toEqual(['keep']);
  expect(screen.getByTestId('roster-note').textContent).toBe('');
});


function pendingRequests() {
  const pending = [];
  global.fetch = jest.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  return async (index, success = false) => {
    await act(async () => {
      if (success) pending[index].resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      else pending[index].reject(new Error('offline'));
    });
  };
}

test.each([false, true])('overlapping selected exclusions compose and recover independently (same render: %s)', async (sameRender) => {
  const finish = pendingRequests();
  render(<StrictMode><Harness initialNames={[]} initialSelected={[CAND.candidateKey, OTHER.candidateKey, 'keep']} /></StrictMode>);
  if (sameRender) {
    await act(async () => { screen.getByTestId('exclude-both').click(); });
  } else {
    await act(async () => { screen.getByTestId('exclude').click(); });
    await act(async () => { screen.getByTestId('exclude-other').click(); });
  }
  expect(state('selected')).toEqual(['keep']);
  await finish(0);
  expect(state('selected')).toEqual(['keep', CAND.candidateKey]);
  expect(state('roster-names')).toEqual([OTHER.name]);
  await finish(1);
  expect(state('selected')).toEqual(['keep', CAND.candidateKey, OTHER.candidateKey]);
  expect(state('roster-names')).toEqual([]);
});

test('excluding an unselected card does not cancel another card recovery', async () => {
  const finish = pendingRequests();
  render(<Harness initialNames={[]} initialSelected={[CAND.candidateKey]} />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await act(async () => { screen.getByTestId('exclude-other').click(); });
  await finish(1, true);
  await finish(0);
  expect(state('selected')).toEqual([CAND.candidateKey]);
  expect(state('roster-names')).toEqual([OTHER.name]);
});

test.each(['exclude', 'exclude-unverified'])('a fresh same-request roster wins over late %s failure', async (button) => {
  const finish = pendingRequests();
  render(<Harness initialNames={[]} initialSelected={[CAND.candidateKey]} />);
  await act(async () => { screen.getByTestId(button).click(); });
  await act(async () => { screen.getByTestId('refresh-roster').click(); });
  await finish(0);
  expect(state('roster-names')).toEqual([CAND.name, 'Fresh']);
  expect(state('roster-excluded')).toEqual([CAND]);
  expect(state('roster-active')).toEqual([]);
  expect(state('selected')).toEqual(button === 'exclude' ? [] : [CAND.candidateKey]);
});

test.each([false, true])('same-name exclusions retain the name until all fail (second succeeds: %s)', async (success) => {
  const finish = pendingRequests();
  render(<Harness initialNames={[]} otherCandidate={{ ...OTHER, name: CAND.name }} />);
  await act(async () => { screen.getByTestId('exclude-both').click(); });
  await finish(0);
  expect(state('roster-names')).toEqual([CAND.name]);
  await finish(1, success);
  expect(state('roster-names')).toEqual(success ? [CAND.name] : []);
});
