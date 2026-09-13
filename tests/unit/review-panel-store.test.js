/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() }, sql: { query: jest.fn() } }));
import { db, sql } from '@vercel/postgres';
import {
  createAttempt, markAttemptDispatched, finalizeAttempt, reapExpiredAttempts, reapAllDispatchedAttempts,
  selectWinners, sumAttemptCosts, sumEntryAttemptCosts, createReviewPanelEntry, mutateReviewPanelEntry,
  claimReviewPanelRun, requestReviewPanelRetry, listRetryRequestedEntries, requestReviewPanelCancel,
  ATTEMPT_COST_UNKNOWN_SQL, isAttemptCostUnknown, stopRevokedReviewPanelRun, requestReviewPanelRerender,
} from '../../lib/services/review-panel-store';

let client;
beforeEach(() => {
  jest.clearAllMocks();
  client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
  db.connect.mockResolvedValue(client);
});

const LIVE_RUN = { lease_token: 'lease-1', locked_until: new Date(Date.now() + 60000) };
const EXPIRED_RUN = { lease_token: 'lease-1', locked_until: new Date(Date.now() - 1000) };

test('createAttempt requires the current run lease and computes attempt_no per seat', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT e.id, r.lease_token')) return { rows: [{ id: 'entry-1', ...LIVE_RUN }] };
    if (q.startsWith('INSERT INTO review_panel_seat_attempts')) return { rows: [{ id: 'att-1', seat_key: 'seat.claude', attempt_no: 1 }] };
    return { rows: [] };
  });
  const row = await createAttempt({ entryId: 'entry-1', seatKey: 'seat.claude', leaseToken: 'lease-1', provider: 'anthropic', model: 'claude-fable-5-1' });
  expect(row.id).toBe('att-1');
  expect(client.query).toHaveBeenCalledWith('COMMIT');
});

test('createAttempt rejects a stale lease token before any insert', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT e.id, r.lease_token')) return { rows: [{ id: 'entry-1', ...LIVE_RUN }] };
    return { rows: [] };
  });
  await expect(createAttempt({ entryId: 'entry-1', seatKey: 'seat.claude', leaseToken: 'wrong-lease' }))
    .rejects.toMatchObject({ httpStatus: 409 });
  expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO review_panel_seat_attempts'), expect.anything());
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
});

describe('markAttemptDispatched', () => {
  test('sets the dispatch token only from pending with no existing token, under the current lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT r.lease_token')) return { rows: [LIVE_RUN] };
      if (q.startsWith('UPDATE review_panel_seat_attempts SET state=\'dispatched\'')) return { rows: [{ id: 'att-1', state: 'dispatched' }] };
      return { rows: [] };
    });
    const row = await markAttemptDispatched('att-1', { dispatchToken: 'tok-1', leaseToken: 'lease-1', dispatchExpiresAt: new Date() });
    expect(row.state).toBe('dispatched');
    const call = client.query.mock.calls.find(([q]) => q.includes("state='pending'"));
    expect(call[0]).toContain("state='pending'");
    expect(call[0]).toContain('dispatch_token IS NULL');
  });

  test('rejects an expired run lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT r.lease_token')) return { rows: [EXPIRED_RUN] };
      return { rows: [] };
    });
    await expect(markAttemptDispatched('att-1', { dispatchToken: 'tok-1', leaseToken: 'lease-1', dispatchExpiresAt: new Date() }))
      .rejects.toMatchObject({ httpStatus: 409 });
  });

  test('rejects an empty/non-string dispatchToken before opening a transaction', async () => {
    await expect(markAttemptDispatched('att-1', { dispatchToken: '', leaseToken: 'lease-1', dispatchExpiresAt: new Date() }))
      .rejects.toMatchObject({ httpStatus: 400 });
    await expect(markAttemptDispatched('att-1', { dispatchToken: '   ', leaseToken: 'lease-1', dispatchExpiresAt: new Date() }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('rejects an invalid dispatchExpiresAt before opening a transaction', async () => {
    await expect(markAttemptDispatched('att-1', { dispatchToken: 'tok-1', leaseToken: 'lease-1', dispatchExpiresAt: 'not-a-date' }))
      .rejects.toMatchObject({ httpStatus: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });
});

describe('finalizeAttempt fences', () => {
  test('finaliser within lease completes: outcome finalized', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE') && q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [{ id: 'att-1' }] };
      if (q.includes("dispatch_expires_at > clock_timestamp()")) return { rows: [{ id: 'att-1', state: 'completed' }] };
      return { rows: [] };
    });
    const result = await finalizeAttempt('att-1', 'tok-1', { state: 'completed', result: { ok: true }, usage: { input_tokens: 1 }, costState: 'known', costCents: 5 });
    expect(result.outcome).toBe('finalized');
  });

  test('rejects a non-terminal state (e.g. "pending") before touching the database, so a caller can never re-open a dispatched row this way', async () => {
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'pending', costState: 'unknown' })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'dispatched', costState: 'unknown' })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'unknown_outcome', costState: 'unknown' })).rejects.toMatchObject({ httpStatus: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('rejects costState "known" with a missing costCents before touching the database', async () => {
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'known' })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'known', costCents: null })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'known', costCents: -1 })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'known', costCents: NaN })).rejects.toMatchObject({ httpStatus: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('rejects a costState outside {known, unknown}', async () => {
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: undefined })).rejects.toMatchObject({ httpStatus: 400 });
    await expect(finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'free' })).rejects.toMatchObject({ httpStatus: 400 });
  });

  test('CAS SQL uses clock_timestamp() and never now() in the fence predicate', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [{ id: 'att-1' }] };
      return { rows: [] };
    });
    await finalizeAttempt('att-1', 'tok-1', { state: 'completed', costState: 'unknown' });
    const casCall = client.query.mock.calls.find(([q]) => q.includes("state='dispatched'") && q.includes('dispatch_token=$2'));
    expect(casCall[0]).toContain('clock_timestamp()');
    // Isolate the fence predicate itself (the WHERE clause), not incidental
    // occurrences of "now" elsewhere (e.g. updated_at=NOW()).
    const wherePredicate = casCall[0].slice(casCall[0].indexOf('WHERE'));
    expect(wherePredicate.toLowerCase()).not.toContain('now()');
  });

  test('finaliser after expiry, before the reaper: lands unknown_outcome with late usage, never completed', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [{ id: 'att-1' }] };
      if (q.includes('clock_timestamp()')) return { rows: [] }; // expired: CAS matches nothing
      if (q.includes('late_result_json')) return { rows: [{ id: 'att-1', state: 'unknown_outcome', late_usage_json: { input_tokens: 3 } }] };
      return { rows: [] };
    });
    const result = await finalizeAttempt('att-1', 'tok-1', { state: 'completed', usage: { input_tokens: 3 }, costState: 'unknown' });
    expect(result.outcome).toBe('late');
    expect(result.attempt.state).toBe('unknown_outcome');
  });

  test('reaper then finaliser: stays unknown_outcome and appends late usage (CASE preserves the reaped state)', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [{ id: 'att-1' }] };
      if (q.includes('clock_timestamp()')) return { rows: [] };
      if (q.includes('late_result_json')) return { rows: [{ id: 'att-1', state: 'unknown_outcome', late_usage_json: { input_tokens: 3 } }] };
      return { rows: [] };
    });
    const result = await finalizeAttempt('att-1', 'tok-1', { state: 'completed', usage: { input_tokens: 3 }, costState: 'unknown' });
    expect(result.outcome).toBe('late');
    const lateCall = client.query.mock.calls.find(([q]) => q.includes('late_result_json'));
    expect(lateCall[0]).toContain("CASE WHEN state='dispatched' THEN 'unknown_outcome' ELSE state END");
  });

  test('wrong dispatch_token: no_match, and the late-path UPDATE genuinely filters on the attempt id and the (wrong) token', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [{ id: 'att-1' }] };
      return { rows: [] }; // both CAS and late path match nothing for a foreign token
    });
    const result = await finalizeAttempt('att-1', 'wrong-token', { state: 'completed', costState: 'unknown' });
    expect(result.outcome).toBe('no_match');
    expect(result.attempt).toBeNull();
    const lateCall = client.query.mock.calls.find(([q]) => q.includes('late_result_json'));
    expect(lateCall[0]).toContain('WHERE id=$1 AND dispatch_token=$2');
    expect(lateCall[1][0]).toBe('att-1');
    expect(lateCall[1][1]).toBe('wrong-token');
  });

  test('attempt row missing entirely: no_match without attempting either UPDATE', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT id FROM review_panel_seat_attempts')) return { rows: [] };
      return { rows: [] };
    });
    const result = await finalizeAttempt('missing', 'tok-1', { state: 'completed', costState: 'unknown' });
    expect(result.outcome).toBe('no_match');
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('clock_timestamp()'), expect.anything());
  });
});

test('reapExpiredAttempts requires the current run lease and moves only dispatched+expired rows', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
    if (q.includes("state='unknown_outcome'")) return { rows: [{ id: 'att-1', state: 'unknown_outcome' }] };
    return { rows: [] };
  });
  const rows = await reapExpiredAttempts('run-1', 'lease-1');
  expect(rows).toEqual([{ id: 'att-1', state: 'unknown_outcome' }]);
  const reapCall = client.query.mock.calls.find(([q]) => q.includes("state='unknown_outcome'"));
  expect(reapCall[0]).toContain("state='dispatched'");
  expect(reapCall[0]).toContain('dispatch_expires_at <= NOW()');
});

test('reapExpiredAttempts rejects a stale lease token', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
    return { rows: [] };
  });
  await expect(reapExpiredAttempts('run-1', 'wrong')).rejects.toMatchObject({ httpStatus: 409 });
});

test('reapAllDispatchedAttempts requires the current run lease and moves every dispatched row regardless of expiry', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
    if (q.includes("state='unknown_outcome'")) return { rows: [{ id: 'att-1', state: 'unknown_outcome' }, { id: 'att-2', state: 'unknown_outcome' }] };
    return { rows: [] };
  });
  const rows = await reapAllDispatchedAttempts('run-1', 'lease-1');
  expect(rows).toEqual([{ id: 'att-1', state: 'unknown_outcome' }, { id: 'att-2', state: 'unknown_outcome' }]);
  const reapCall = client.query.mock.calls.find(([q]) => q.includes("state='unknown_outcome'"));
  expect(reapCall[0]).toContain("state='dispatched'");
  expect(reapCall[0]).not.toContain('dispatch_expires_at'); // unconditional — not gated on expiry, unlike reapExpiredAttempts
});

test('reapAllDispatchedAttempts rejects a stale lease token', async () => {
  client.query.mockImplementation(async (q) => {
    if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
    return { rows: [] };
  });
  await expect(reapAllDispatchedAttempts('run-1', 'wrong')).rejects.toMatchObject({ httpStatus: 409 });
});

describe('selectWinners', () => {
  test('picks the highest attempt_no among completed attempts per seat and ignores a later failed/unknown_outcome', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT e.id, r.lease_token')) return { rows: [{ id: 'entry-1', ...LIVE_RUN }] };
      if (q.includes('DISTINCT ON (seat_key)')) {
        // Simulate: seat.claude attempt 1 completed, attempt 2 failed (ignored because state != 'completed');
        // seat.openai attempt 1 completed, attempt 2 completed (attempt 2 wins as the highest attempt_no).
        return { rows: [{ id: 'att-claude-1', seat_key: 'seat.claude' }, { id: 'att-openai-2', seat_key: 'seat.openai' }] };
      }
      if (q.startsWith('UPDATE review_panel_entries')) return { rows: [{ id: 'entry-1', winners_json: { 'seat.claude': 'att-claude-1', 'seat.openai': 'att-openai-2' } }] };
      return { rows: [] };
    });
    const row = await selectWinners('entry-1', 'lease-1');
    expect(row.winners_json).toEqual({ 'seat.claude': 'att-claude-1', 'seat.openai': 'att-openai-2' });
    const selectCall = client.query.mock.calls.find(([q]) => q.includes('DISTINCT ON (seat_key)'));
    expect(selectCall[0]).toContain("state='completed'");
    expect(selectCall[0]).toContain('ORDER BY seat_key, attempt_no DESC');
  });

  test('rejects a stale lease token before reading any attempts', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT e.id, r.lease_token')) return { rows: [{ id: 'entry-1', ...LIVE_RUN }] };
      return { rows: [] };
    });
    await expect(selectWinners('entry-1', 'wrong-lease')).rejects.toMatchObject({ httpStatus: 409 });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('DISTINCT ON (seat_key)'), expect.anything());
  });
});

test('sumAttemptCosts withholds the total (unknownCount > 0) when any attempt has cost_state unknown or an unknown_outcome state', async () => {
  sql.query.mockResolvedValue({ rows: [
    { cost_cents: '10', cost_state: 'known' },
    { cost_cents: null, cost_state: 'unknown' },
    { cost_cents: null, cost_state: null }, // e.g. an unknown_outcome attempt with no ledger write
  ] });
  const { totalCents, unknownCount } = await sumAttemptCosts('run-1');
  expect(totalCents).toBe(10);
  expect(unknownCount).toBe(2);
});

test('sumAttemptCosts treats a "known" row with a NULL cost_cents as unknown, never as $0 (defense in depth behind the DB CHECK)', async () => {
  sql.query.mockResolvedValue({ rows: [
    { cost_cents: '10', cost_state: 'known' },
    { cost_cents: null, cost_state: 'known' },
  ] });
  const { totalCents, unknownCount } = await sumAttemptCosts('run-1');
  expect(totalCents).toBe(10);
  expect(unknownCount).toBe(1);
});

test('sumAttemptCosts reports zero unknowns when every attempt has a known cost', async () => {
  sql.query.mockResolvedValue({ rows: [{ cost_cents: '10', cost_state: 'known' }, { cost_cents: '5', cost_state: 'known' }] });
  const { totalCents, unknownCount } = await sumAttemptCosts('run-1');
  expect(totalCents).toBe(15);
  expect(unknownCount).toBe(0);
});

describe('isAttemptCostUnknown / ATTEMPT_COST_UNKNOWN_SQL — the ONE unified predicate consumed by spend-check and admin stats too', () => {
  test('an unknown_outcome-state row is unknown even with cost_state NULL (reaped/late attempt)', () => {
    expect(isAttemptCostUnknown({ state: 'unknown_outcome', cost_state: null, cost_cents: null })).toBe(true);
  });
  test('a completed/failed row with cost_state="unknown" is unknown (ambiguous paid-call confirmation)', () => {
    expect(isAttemptCostUnknown({ state: 'failed', cost_state: 'unknown', cost_cents: null })).toBe(true);
    expect(isAttemptCostUnknown({ state: 'completed', cost_state: 'unknown', cost_cents: null })).toBe(true);
  });
  test('a completed row with cost_state="known" and a real cost_cents is NOT unknown', () => {
    expect(isAttemptCostUnknown({ state: 'completed', cost_state: 'known', cost_cents: 10 })).toBe(false);
  });
  test('the SQL fragment names both the unknown_outcome state and the cost_state clause', () => {
    expect(ATTEMPT_COST_UNKNOWN_SQL).toMatch(/state\s*=\s*'unknown_outcome'/);
    expect(ATTEMPT_COST_UNKNOWN_SQL).toMatch(/cost_state\s+IS\s+DISTINCT\s+FROM\s+'known'/i);
  });
});

describe('sumEntryAttemptCosts', () => {
  test('scopes to entry_id only, not the run — the run-wide query is never used for a single entry\'s report', async () => {
    sql.query.mockResolvedValue({ rows: [{ cost_cents: '10', cost_state: 'known', state: 'completed' }] });
    const { totalCents, unknownCount } = await sumEntryAttemptCosts('entry-1');
    expect(totalCents).toBe(10);
    expect(unknownCount).toBe(0);
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining('WHERE a.entry_id=$1'), ['entry-1']);
    expect(sql.query).toHaveBeenCalledWith(expect.not.stringContaining('run_id'), expect.anything());
  });

  test('a sibling entry\'s in-flight attempt never leaks into this entry\'s unknown count (entry scoping, not run scoping)', async () => {
    sql.query.mockResolvedValue({ rows: [
      { cost_cents: '10', cost_state: 'known', state: 'completed' },
      { cost_cents: '20', cost_state: 'known', state: 'completed' },
    ] });
    const { totalCents, unknownCount } = await sumEntryAttemptCosts('entry-1');
    expect(totalCents).toBe(30);
    expect(unknownCount).toBe(0);
  });
});

describe('createReviewPanelEntry', () => {
  test('requires the current run lease and computes request_revision per request', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
      if (q.startsWith('INSERT INTO review_panel_entries')) return { rows: [{ id: 'entry-1', request_revision: 1 }] };
      return { rows: [] };
    });
    const row = await createReviewPanelEntry({ runId: 'run-1', requestId: 'req-1', leaseToken: 'lease-1', createdBy: 7 });
    expect(row.id).toBe('entry-1');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects a stale lease token before any insert', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT lease_token, locked_until FROM review_panel_runs')) return { rows: [LIVE_RUN] };
      return { rows: [] };
    });
    await expect(createReviewPanelEntry({ runId: 'run-1', requestId: 'req-1', leaseToken: 'wrong', createdBy: 7 }))
      .rejects.toMatchObject({ httpStatus: 409 });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO review_panel_entries'), expect.anything());
  });
});

describe('mutateReviewPanelEntry', () => {
  test('locks the RUN row (FOR UPDATE OF r), not the entry row — same fence as createAttempt/selectWinners', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('FOR UPDATE OF r') && q.startsWith('SELECT e.*')) {
        return { rows: [{ id: 'entry-1', run_id: 'run-1', request_id: 'req-1', request_revision: 1, status: 'pending', data: {}, winners_json: {}, created_by: 7, run_lease_token: 'lease-1', run_locked_until: LIVE_RUN.locked_until }] };
      }
      return { rows: [{ id: 'entry-1', status: 'running' }] };
    });
    await mutateReviewPanelEntry('entry-1', (e) => { e.status = 'running'; }, 'lease-1');
    const selectCall = client.query.mock.calls.find(([q]) => q.startsWith('SELECT e.*'));
    expect(selectCall[0]).toContain('FOR UPDATE OF r');
    expect(selectCall[0]).not.toContain('FOR UPDATE OF e');
  });

  test('never writes winners_json back — selectWinners is its only writer', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT e.*')) {
        return { rows: [{ id: 'entry-1', run_id: 'run-1', request_id: 'req-1', request_revision: 1, status: 'pending', data: {}, winners_json: { 'seat.claude': 'att-1' }, created_by: 7, run_lease_token: 'lease-1', run_locked_until: LIVE_RUN.locked_until }] };
      }
      return { rows: [{ id: 'entry-1' }] };
    });
    await mutateReviewPanelEntry('entry-1', (e) => { e.status = 'failed'; }, 'lease-1');
    const updateCall = client.query.mock.calls.find(([q]) => q.startsWith('UPDATE review_panel_entries'));
    expect(updateCall[0]).not.toContain('winners_json');
  });

  test('rejects a stale lease token', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT e.*')) {
        return { rows: [{ id: 'entry-1', run_id: 'run-1', status: 'pending', data: {}, winners_json: {}, run_lease_token: 'lease-1', run_locked_until: EXPIRED_RUN.locked_until }] };
      }
      return { rows: [] };
    });
    await expect(mutateReviewPanelEntry('entry-1', () => {}, 'lease-1')).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('claimReviewPanelRun', () => {
  test('returns null when the operator stop is set', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('stop_requested')) return { rows: [{ stop_requested: true }] };
      return { rows: [] };
    });
    expect(await claimReviewPanelRun()).toBeNull();
  });

  test('returns null when another run already holds a live lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.includes('stop_requested')) return { rows: [{ stop_requested: false }] };
      if (q.includes('locked_until>NOW()')) return { rows: [{ id: 'other-run' }] };
      return { rows: [] };
    });
    expect(await claimReviewPanelRun()).toBeNull();
  });
});

describe('requestReviewPanelRetry', () => {
  const ACTOR_ROW = { rows: [{ id: 7, dynamics_systemuser_id: 'sysid-1' }] };

  test('rejects while the run holds a live lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: 'lease-1', status: 'running' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelRetry('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 409 });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE review_panel_entries'), expect.anything());
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects while the run is queued even with no lease token', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'queued' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelRetry('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 409 });
  });

  test('rejects a cancelled run — an operator stop must never be resurrected by a retry', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'cancelled' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelRetry('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 409, message: expect.stringMatching(/cancelled by the operator/i) });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE review_panel_entries'), expect.anything());
  });

  test('marks only failed entries with retry_requested_at and requeues the run when settled', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'failed' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('SELECT id FROM review_panel_entries')) return { rows: [{ id: 'entry-1' }] };
      if (q.startsWith('UPDATE review_panel_runs')) return { rows: [{ id: 'run-1', status: 'queued' }] };
      return { rows: [] };
    });
    const run = await requestReviewPanelRetry('run-1', 7, ['entry-1', 'entry-not-failed']);
    expect(run.status).toBe('queued');
    const markCall = client.query.mock.calls.find(([q]) => q.startsWith('UPDATE review_panel_entries'));
    expect(markCall[0]).toContain('retry_requested_at=NOW()');
    expect(markCall[1]).toEqual([['entry-1']]);
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects when none of the chosen entries are eligible (not failed)', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'failed' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('SELECT id FROM review_panel_entries')) return { rows: [] };
      return { rows: [] };
    });
    await expect(requestReviewPanelRetry('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 400 });
  });
});

describe('requestReviewPanelRerender', () => {
  const ACTOR_ROW = { rows: [{ id: 7, dynamics_systemuser_id: 'sysid-1' }] };

  test('requires at least one entry id', async () => {
    await expect(requestReviewPanelRerender('run-1', 7, [])).rejects.toMatchObject({ httpStatus: 400 });
    expect(db.connect).not.toHaveBeenCalled();
  });

  test('rejects while the run holds a live lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: 'lease-1', status: 'running' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelRerender('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 409 });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE review_panel_entries'), expect.anything());
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('rejects a cancelled run — an operator stop must never be resurrected by a re-render either', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'cancelled' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelRerender('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 409, message: expect.stringMatching(/cancelled by the operator/i) });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE review_panel_entries'), expect.anything());
  });

  test('rejects a failed (non-completed) entry — the SQL filter only ever selects status=\'completed\' rows', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'failed' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('SELECT id, data, winners_json FROM review_panel_entries')) return { rows: [] }; // the failed entry never matches status='completed'
      return { rows: [] };
    });
    await expect(requestReviewPanelRerender('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 400 });
  });

  test('rejects a completed entry with no chair winner', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'completed' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('SELECT id, data, winners_json FROM review_panel_entries')) {
        return { rows: [{ id: 'entry-1', data: { files: { docx: {}, pdf: {} } }, winners_json: {} }] };
      }
      return { rows: [] };
    });
    await expect(requestReviewPanelRerender('run-1', 7, ['entry-1'])).rejects.toMatchObject({ httpStatus: 400 });
  });

  test('accepts a completed entry with a chair winner: stamps data.rerender (requestedAt/requestedBy only), NEVER touches data.files, requeues the run', async () => {
    const currentFiles = { docx: { pathname: 'review-panel/entry-1/report.docx' }, pdf: { pathname: 'review-panel/entry-1/report.pdf' } };
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) return { rows: [{ id: 'run-1', owner_profile_id: 7, lease_token: null, status: 'completed' }] };
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('SELECT id, data, winners_json FROM review_panel_entries')) {
        return { rows: [{ id: 'entry-1', data: { files: currentFiles, input: { requestNumber: 'R-1' } }, winners_json: { chair: 'att-chair-1' } }] };
      }
      if (q.startsWith('UPDATE review_panel_runs')) return { rows: [{ id: 'run-1', status: 'queued' }] };
      return { rows: [] };
    });
    const run = await requestReviewPanelRerender('run-1', 7, ['entry-1']);
    expect(run.status).toBe('queued');
    const updateCall = client.query.mock.calls.find(([q]) => q.startsWith('UPDATE review_panel_entries'));
    expect(updateCall[0]).toContain('retry_requested_at=NOW()');
    const [entryId, dataJson] = updateCall[1];
    expect(entryId).toBe('entry-1');
    const data = JSON.parse(dataJson);
    // data.files is untouched — the CURRENT edition stays live/downloadable
    // for the entire wait; only the worker's own successful swap replaces it.
    expect(data.files).toEqual(currentFiles);
    expect(data.rerender).toEqual({ requestedAt: expect.any(String), requestedBy: 7 });
    expect(data.input).toEqual({ requestNumber: 'R-1' }); // rest of data preserved
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });
});

describe('listRetryRequestedEntries', () => {
  test('returns entry ids with a pending retry marker', async () => {
    sql.query.mockResolvedValue({ rows: [{ id: 'entry-1' }, { id: 'entry-2' }] });
    expect(await listRetryRequestedEntries('run-1')).toEqual(['entry-1', 'entry-2']);
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining('retry_requested_at IS NOT NULL'), ['run-1']);
  });
});

describe('requestReviewPanelCancel', () => {
  const ACTOR_ROW = { rows: [{ id: 7, dynamics_systemuser_id: 'sysid-1' }] };

  test('rejects while an active worker lease is held', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) {
        return { rows: [{ id: 'run-1', owner_profile_id: 7, status: 'running', lease_token: 'lease-1', locked_until: new Date(Date.now() + 60000) }] };
      }
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelCancel('run-1', 7)).rejects.toMatchObject({ httpStatus: 409 });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining('UPDATE review_panel_runs'), expect.anything());
  });

  test('cancels a queued run with no live lease', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) {
        return { rows: [{ id: 'run-1', owner_profile_id: 7, status: 'queued', lease_token: null, locked_until: null, data: {} }] };
      }
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      if (q.startsWith('UPDATE review_panel_runs')) return { rows: [{ id: 'run-1', status: 'cancelled' }] };
      return { rows: [] };
    });
    const run = await requestReviewPanelCancel('run-1', 7);
    expect(run.status).toBe('cancelled');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('rejects a run that already settled', async () => {
    client.query.mockImplementation(async (q) => {
      if (q.startsWith('SELECT * FROM review_panel_runs')) {
        return { rows: [{ id: 'run-1', owner_profile_id: 7, status: 'completed', lease_token: null, locked_until: null, data: {} }] };
      }
      if (q.startsWith('SELECT p.id, p.dynamics_systemuser_id')) return ACTOR_ROW;
      return { rows: [] };
    });
    await expect(requestReviewPanelCancel('run-1', 7)).rejects.toMatchObject({ httpStatus: 409 });
  });
});

describe('stopRevokedReviewPanelRun', () => {
  test('fails the run and clears the lease WITHOUT calling assertReviewPanelActor — that check is exactly what just failed', async () => {
    sql.query.mockResolvedValue({ rows: [] });
    await stopRevokedReviewPanelRun('run-1', 'lease-1', 'The run owner no longer has superuser access; no further model calls were made.');
    expect(sql.query).toHaveBeenCalledTimes(1);
    const [text, params] = sql.query.mock.calls[0];
    expect(text).toContain("status='failed'");
    expect(text).toContain('lease_token=NULL');
    expect(text).toContain('locked_until=NULL');
    expect(text).toContain('WHERE id=$1 AND lease_token=$2');
    expect(params).toEqual(['run-1', 'lease-1', 'The run owner no longer has superuser access; no further model calls were made.']);
  });
});
