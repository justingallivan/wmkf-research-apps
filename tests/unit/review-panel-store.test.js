/** @jest-environment node */
jest.mock('@vercel/postgres', () => ({ db: { connect: jest.fn() }, sql: { query: jest.fn() } }));
import { db, sql } from '@vercel/postgres';
import {
  createAttempt, markAttemptDispatched, finalizeAttempt, reapExpiredAttempts,
  selectWinners, sumAttemptCosts, createReviewPanelEntry, mutateReviewPanelEntry,
  claimReviewPanelRun, requestReviewPanelRetry, listRetryRequestedEntries,
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

describe('listRetryRequestedEntries', () => {
  test('returns entry ids with a pending retry marker', async () => {
    sql.query.mockResolvedValue({ rows: [{ id: 'entry-1' }, { id: 'entry-2' }] });
    expect(await listRetryRequestedEntries('run-1')).toEqual(['entry-1', 'entry-2']);
    expect(sql.query).toHaveBeenCalledWith(expect.stringContaining('retry_requested_at IS NOT NULL'), ['run-1']);
  });
});
