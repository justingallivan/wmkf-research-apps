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
import { useRef, useState } from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import useReviewerRosterActions from '../../shared/components/reviewers/search/useReviewerRosterActions';

const REQ = 'aaaaaaaa-1111-1111-1111-111111111111';
const CAND = { candidateKey: 'suggestion:s-1', name: 'Ada Lovelace' };

window.confirm = jest.fn(() => true);

function Harness({ reloadRoster = jest.fn(async () => true), previousSearchRefs = [{ candidateKey: 'suggestion:s-2' }] }) {
  const genRef = useRef(0);
  const [rosterActive, setRosterActive] = useState([CAND]);
  const [rosterExcluded, setRosterExcluded] = useState([]);
  const [rosterIneligible, setRosterIneligible] = useState([]);
  const [rosterBlocked, setRosterBlocked] = useState([]);
  const [rosterHandled, setRosterHandled] = useState([]);
  const [rosterSavedKeys, setRosterSavedKeys] = useState([]);
  const [rosterNames, setRosterNames] = useState(['Ada Lovelace']);
  const [selected, setSelected] = useState(new Set());
  const [rosterNote, setRosterNote] = useState(null);
  const [removingPrevious, setRemovingPrevious] = useState(false);
  const [candidates, setCandidates] = useState([CAND]);
  const [recCandidates, setRecCandidates] = useState([]);

  const actions = useReviewerRosterActions({
    requestId: REQ, genRef, busy: false, removingPrevious,
    rosterNames, previousSearchKeys: new Set(previousSearchRefs.map((r) => r.candidateKey)),
    previousSearchRefs, reloadRoster,
    setCandidates, setRecCandidates, setRosterActive, setRosterExcluded, setRosterIneligible,
    setRosterBlocked, setRosterHandled, setRosterSavedKeys, setRosterNames, setSelected,
    setRosterNote, setRemovingPrevious,
  });

  return (
    <div>
      <div data-testid="roster-note">{rosterNote ?? ''}</div>
      <div data-testid="roster-active">{JSON.stringify(rosterActive)}</div>
      <div data-testid="roster-excluded">{JSON.stringify(rosterExcluded)}</div>
      <button data-testid="exclude" onClick={() => actions.excludeCandidate(CAND)}>exclude</button>
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
  await waitFor(() => expect(screen.getByTestId('roster-excluded').textContent).toContain('suggestion:s-1'));
  expect(screen.getByTestId('roster-note').textContent).toBe('');
  expect(sentOpts.method).toBe('PATCH');
  expect(sentOpts.headers).toEqual({ 'Content-Type': 'application/json' });
  expect(JSON.parse(sentOpts.body)).toMatchObject({ requestId: REQ, action: 'exclude' });
  expect(JSON.parse(sentOpts.body).candidate.candidateKey).toBe('suggestion:s-1');
});

test('excludeCandidate: non-2xx rolls the optimistic move back and sets the fixed error note', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'nope' }) }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't exclude that reviewer — please try again."));
  expect(screen.getByTestId('roster-active').textContent).toContain('suggestion:s-1');
});

test('excludeCandidate: network rejection rolls back the same way', async () => {
  global.fetch = jest.fn(() => Promise.reject(new Error('offline')));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-note').textContent).toBe("Couldn't exclude that reviewer — please try again."));
});

test('excludeUnverifiedCandidate: 2xx malformed body does not roll back', async () => {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }));
  render(<Harness />);
  await act(async () => { screen.getByTestId('exclude-unverified').click(); });
  await waitFor(() => expect(screen.getByTestId('roster-excluded').textContent).toContain('suggestion:s-1'));
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
  expect(JSON.parse(sentOpts.body)).toEqual({ requestId: REQ, action: 'promote', candidateKey: 'suggestion:s-1' });
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
