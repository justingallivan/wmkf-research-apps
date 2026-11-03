/** @jest-environment node */
// Explicit fixture URL only. Never discovers application/Claude database credentials.
// Migration 095 + reminder-events-store against real Postgres
// (docs/plans/PER_REMINDER_HISTORY_PLAN_2026-11-03.md). The Neon HTTP client is
// replaced by a pool query so the store's exact SQL runs unchanged.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';

let mockQuery;
jest.mock('@neondatabase/serverless', () => ({
  neon: () => (text, params) => mockQuery(text, params),
}));

const store = require('../../lib/services/reviewer-engagement/reminder-events-store');

const URL = process.env.TEST_REQUEST_LEDGER_TEST_URL;
const suite = URL ? describe : describe.skip;
const SUG = '11111111-1111-4111-8111-111111111111';
const SUG2 = '33333333-3333-4333-8333-333333333333';
const REQ = '22222222-2222-4222-8222-222222222222';
const row = (over = {}) => ({
  wmkf_appreviewersuggestionid: SUG, _wmkf_request_value: REQ, wmkf_invited: true, wmkf_emailsentat: null, ...over,
});

suite('reviewer reminder history (real Postgres, migration 095)', () => {
  let pool;
  const schema = `reminders_${crypto.randomBytes(6).toString('hex')}`;
  beforeAll(async () => {
    const parsed = new global.URL(URL);
    if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/ledger') {
      throw new Error('An isolated local ledger fixture is required');
    }
    pool = new Pool({ connectionString: URL, max: 4, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync('lib/db/migrations/095_reviewer_reminder_events.sql', 'utf8'));
    mockQuery = async (text, params) => (await pool.query(text, params)).rows;
  });
  beforeEach(async () => { await pool.query('TRUNCATE reviewer_reminder_events'); });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });

  test('writes one row per reminder; a repeat of the same reminder is a no-op', async () => {
    const at = '2026-11-03T18:04:05.678Z';
    expect(await store.recordReminderEvent({ row: row(), kind: 'review_due', recordedAt: at })).toEqual({ written: true });
    expect(await store.recordReminderEvent({ row: row(), kind: 'review_due', recordedAt: at })).toEqual({ written: true });
    const { rows } = await pool.query('SELECT suggestion_id, request_id, kind, recorded_at FROM reviewer_reminder_events');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ suggestion_id: SUG, request_id: REQ, kind: 'review_due' });
    expect(new Date(rows[0].recorded_at).toISOString()).toBe(at);
  });

  test('reads back grouped by suggestion, newest first, keeping same-second reminders distinct', async () => {
    for (const [id, kind, at] of [
      [SUG, 'review_due', '2026-10-06T10:00:00.000Z'],
      [SUG, 'review_due', '2026-10-13T10:00:00.100Z'],
      [SUG, 'review_due', '2026-10-13T10:00:00.900Z'],
      [SUG, 'respond', '2026-09-20T10:00:00.000Z'],
      [SUG2, 'respond', '2026-09-21T10:00:00.000Z'],
    ]) {
      await store.recordReminderEvent({ row: row({ wmkf_appreviewersuggestionid: id }), kind, recordedAt: at });
    }
    const byId = await store.readReminderHistory([SUG, SUG2]);
    expect(byId.get(SUG).map((e) => e.recordedAt)).toEqual([
      '2026-10-13T10:00:00.900Z', '2026-10-13T10:00:00.100Z', '2026-10-06T10:00:00.000Z', '2026-09-20T10:00:00.000Z',
    ]);
    expect(byId.get(SUG2)).toEqual([{ kind: 'respond', recordedAt: '2026-09-21T10:00:00.000Z' }]);
  });

  test('the table refuses an unknown kind', async () => {
    await expect(pool.query(
      'INSERT INTO reviewer_reminder_events (suggestion_id, request_id, kind, recorded_at) VALUES ($1,$2,$3,NOW())',
      [SUG, REQ, 'thankyou'],
    )).rejects.toThrow(/check constraint/);
  });

  test('a never-invited row writes nothing', async () => {
    await store.recordReminderEvent({ row: row({ wmkf_invited: false }), kind: 'review_due', recordedAt: '2026-11-03T00:00:00Z' });
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM reviewer_reminder_events')).rows[0].n).toBe(0);
  });
});
