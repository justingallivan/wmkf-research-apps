/** @jest-environment node */
// Real-Postgres proof for the staff discussion sentiment store (migration 082).
// Runs only when DISCUSSION_SENTIMENT_PG_TEST_URL points at a loopback PostgreSQL; creates and drops its own schema.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

let mockPool = null;
jest.mock('@vercel/postgres', () => {
  const sql = (strings, ...values) => mockPool.query(strings.reduce((text, part, i) => text + (i ? `$${i}` : '') + part, ''), values);
  sql.query = (text, params) => mockPool.query(text, params);
  return { sql, db: { connect: () => mockPool.connect() } };
});

import {
  reserveRun, recordFailedRun, completeRun, failRun, acceptRun, withdrawRun, getRun, getLatestRun,
  getLatestCurrentReadyRun, getAcceptedRun, SENTIMENT_GENERATION_ABANDONED_SECONDS,
} from '../../lib/services/post-presentation-materials/discussion-sentiment-store.js';

const { Client, Pool } = pg;
const TEST_URL = process.env.DISCUSSION_SENTIMENT_PG_TEST_URL || '';
if (TEST_URL) {
  let parsed;
  try { parsed = new URL(TEST_URL); } catch { throw new Error('DISCUSSION_SENTIMENT_PG_TEST_URL must be a valid local PostgreSQL URL.'); }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    throw new Error('Refusing the sentiment store proof unless the database host is localhost/loopback.');
  }
  if (/neon\.tech|vercel-storage/i.test(TEST_URL) || (process.env.POSTGRES_URL && TEST_URL === process.env.POSTGRES_URL)) {
    throw new Error('Refusing the sentiment store proof against a shared Production/Preview database.');
  }
}
const describeIf = TEST_URL ? describe : describe.skip;
const uuid = () => crypto.randomUUID();
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);
const PROMPT = 'meeting-transcript.staff-discussion-sentiment';
const RECORD = { schemaVersion: 1, enthusiasm: 'moderate', reception: 'mixed', headline: 'h', supportPoints: [], concernPoints: [], disagreements: [], uncertainties: [] };

describeIf('staff discussion sentiment store (isolated local Postgres proof)', () => {
  let admin; let pool; let schema; let profileA; let profileB;
  let requestId; let artifactId;

  const reserve = (over = {}) => reserveRun({ id: uuid(), requestId, sourceArtifactId: artifactId, sourceContentHash: HASH, promptName: PROMPT, profileId: profileA, ...over });
  const row = async (id) => (await pool.query('SELECT * FROM staff_discussion_sentiments WHERE id=$1', [id])).rows[0];
  const ready = async (over = {}, version = 1) => {
    const { run } = await reserve(over);
    await completeRun({ id: run.id, record: RECORD, promptName: PROMPT, promptVersion: version, model: 'm' });
    return run.id;
  };
  const expected = (over = {}) => ({ sourceArtifactId: artifactId, sourceContentHash: HASH, promptVersion: 1, ...over });
  const accepted = async () => (await pool.query('SELECT id FROM staff_discussion_sentiments WHERE request_id=$1 AND accepted_at IS NOT NULL AND withdrawn_at IS NULL', [requestId])).rows;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    schema = `sentiment_test_${uuid().replace(/-/g, '')}`;
    await admin.query(`CREATE SCHEMA "${schema}"`);
    pool = new Pool({ connectionString: TEST_URL, options: `-c search_path=${schema}` });
    mockPool = pool;
    await pool.query('CREATE TABLE user_profiles (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
    profileA = (await pool.query("INSERT INTO user_profiles(name) VALUES ('a') RETURNING id")).rows[0].id;
    profileB = (await pool.query("INSERT INTO user_profiles(name) VALUES ('b') RETURNING id")).rows[0].id;
    await pool.query(fs.readFileSync(path.join(process.cwd(), 'lib/db/migrations/082_staff_discussion_sentiments.sql'), 'utf8'));
  });
  beforeEach(() => { requestId = uuid(); artifactId = uuid(); });
  afterAll(async () => {
    if (pool) await pool.end();
    if (schema) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    if (admin) await admin.end();
  });

  it('reserve inserts a generating row; a live one blocks with in_progress', async () => {
    const first = await reserve();
    expect(first.run).toMatchObject({ status: 'generating', requested_by_profile_id: profileA });
    await expect(reserve()).resolves.toEqual({ conflict: { code: 'sentiment_analysis_in_progress' } });
    expect((await pool.query('SELECT count(*)::int AS n FROM staff_discussion_sentiments WHERE request_id=$1', [requestId])).rows[0].n).toBe(1);
  });

  it('an abandoned generating row (real backdated created_at) is reclaimed and marked failed', async () => {
    const { run } = await reserve();
    await pool.query(`UPDATE staff_discussion_sentiments SET created_at = NOW() - ($2 || ' seconds')::INTERVAL WHERE id=$1`, [run.id, SENTIMENT_GENERATION_ABANDONED_SECONDS + 5]);
    const second = await reserve();
    expect(second.run.status).toBe('generating');
    expect(await row(run.id)).toMatchObject({ status: 'failed', failure_code: 'sentiment_run_abandoned' });
  });

  it('a row just inside the window still blocks', async () => {
    const { run } = await reserve();
    await pool.query(`UPDATE staff_discussion_sentiments SET created_at = NOW() - ($2 || ' seconds')::INTERVAL WHERE id=$1`, [run.id, SENTIMENT_GENERATION_ABANDONED_SECONDS - 30]);
    await expect(reserve()).resolves.toMatchObject({ conflict: { code: 'sentiment_analysis_in_progress' } });
  });

  it('two concurrent reserves: exactly one run, one in_progress, one generating row', async () => {
    const results = await Promise.all([reserve(), reserve()]);
    expect(results.filter((r) => r.run)).toHaveLength(1);
    expect(results.filter((r) => r.conflict)).toHaveLength(1);
  });

  it('complete stores the record and prompt version; fail stores a code; both are one-shot', async () => {
    const id = await ready({}, 3);
    expect(await row(id)).toMatchObject({ status: 'ready', prompt_version: 3, model: 'm', record: RECORD });
    expect((await row(id)).completed_at).toBeTruthy();
    await expect(failRun({ id, failureCode: 'late' })).resolves.toBeNull();
    expect(await row(id)).toMatchObject({ status: 'ready', failure_code: null });
    const { run } = await reserve();
    const failed = await failRun({ id: run.id, failureCode: 'Claude Output/Refused!' });
    expect(failed).toMatchObject({ status: 'failed', failure_code: 'claude_output_refused_' });
    await expect(completeRun({ id: run.id, record: RECORD, promptName: PROMPT, promptVersion: 1 })).resolves.toBeNull();
    expect(await row(run.id)).toMatchObject({ status: 'failed', record: null });
  });

  it('late completion and late failure after the run was reclaimed change nothing', async () => {
    const { run: stale } = await reserve();
    await pool.query(`UPDATE staff_discussion_sentiments SET created_at = NOW() - INTERVAL '1 hour' WHERE id=$1`, [stale.id]);
    const { run: fresh } = await reserve();
    await expect(completeRun({ id: stale.id, record: RECORD, promptName: PROMPT, promptVersion: 1 })).resolves.toBeNull();
    await expect(failRun({ id: stale.id, failureCode: 'late' })).resolves.toBeNull();
    expect(await row(stale.id)).toMatchObject({ status: 'failed', failure_code: 'sentiment_run_abandoned', record: null });
    expect(await row(fresh.id)).toMatchObject({ status: 'generating', record: null });
  });

  it('recordFailedRun inserts a failed row outside both live indexes', async () => {
    await reserve();
    const failed = await recordFailedRun({ id: uuid(), requestId, sourceArtifactId: artifactId, sourceContentHash: HASH, promptName: PROMPT, profileId: profileA, failureCode: 'staff_discussion_not_recorded' });
    expect(failed).toMatchObject({ status: 'failed', failure_code: 'staff_discussion_not_recorded' });
  });

  it('accept: only a ready, never-accepted, current row; stale expectations and non-ready rows are refused', async () => {
    const id = await ready();
    await expect(acceptRun({ id, requestId, profileId: profileA, expected: expected({ promptVersion: 2 }) })).resolves.toBeNull();
    await expect(acceptRun({ id, requestId, profileId: profileA, expected: expected({ sourceContentHash: HASH2 }) })).resolves.toBeNull();
    await expect(acceptRun({ id, requestId: uuid(), profileId: profileA, expected: expected() })).resolves.toBeNull();
    const { run } = await reserve();
    await expect(acceptRun({ id: run.id, requestId, profileId: profileA, expected: expected() })).resolves.toBeNull();
    const ok = await acceptRun({ id, requestId, profileId: profileA, expected: expected() });
    expect(ok).toMatchObject({ id, accepted_by_profile_id: profileA });
    await expect(acceptRun({ id, requestId, profileId: profileA, expected: expected() })).resolves.toBeNull();
  });

  it('accepting a newer row withdraws the previous one in the same step; one accepted row remains', async () => {
    const first = await ready();
    await acceptRun({ id: first, requestId, profileId: profileA, expected: expected() });
    const second = await ready();
    await acceptRun({ id: second, requestId, profileId: profileB, expected: expected() });
    expect(await row(first)).toMatchObject({ withdrawn_by_profile_id: profileB });
    expect((await row(first)).withdrawn_at).toBeTruthy();
    expect((await accepted()).map((r) => r.id)).toEqual([second]);
    await expect(getAcceptedRun({ requestId })).resolves.toMatchObject({ id: second });
  });

  it('withdraw has no fallback, a second withdraw is null, and a withdrawn row cannot be accepted again', async () => {
    const first = await ready();
    await acceptRun({ id: first, requestId, profileId: profileA, expected: expected() });
    const second = await ready();
    await acceptRun({ id: second, requestId, profileId: profileA, expected: expected() });
    expect(await withdrawRun({ id: second, requestId, profileId: profileB })).toMatchObject({ withdrawn_by_profile_id: profileB });
    await expect(getAcceptedRun({ requestId })).resolves.toBeNull();
    await expect(withdrawRun({ id: second, requestId, profileId: profileB })).resolves.toBeNull();
    await expect(withdrawRun({ id: first, requestId, profileId: profileB })).resolves.toBeNull();
    await expect(acceptRun({ id: second, requestId, profileId: profileA, expected: expected() })).resolves.toBeNull();
    expect(await accepted()).toHaveLength(0);
  });

  it('the accepted-row index rejects a second accepted, not withdrawn row; the generating index rejects a second live run', async () => {
    const a = await ready();
    const b = await ready();
    await pool.query('UPDATE staff_discussion_sentiments SET accepted_at = NOW(), accepted_by_profile_id = $2 WHERE id=$1', [a, profileA]);
    await expect(pool.query('UPDATE staff_discussion_sentiments SET accepted_at = NOW(), accepted_by_profile_id = $2 WHERE id=$1', [b, profileA]))
      .rejects.toThrow(/idx_staff_discussion_sentiments_accepted/);
    await reserve();
    await expect(pool.query(
      `INSERT INTO staff_discussion_sentiments (id, request_id, source_artifact_id, source_content_hash, status, requested_by_profile_id)
       VALUES ($1,$2,$3,$4,'generating',$5)`, [uuid(), requestId, artifactId, HASH, profileA])).rejects.toThrow(/idx_staff_discussion_sentiments_generating/);
  });

  it('shape constraints reject a ready row without a record and a failed row without a code', async () => {
    const insert = (status, extra = '') => pool.query(
      `INSERT INTO staff_discussion_sentiments (id, request_id, source_artifact_id, source_content_hash, status, requested_by_profile_id ${extra ? ',' + extra.cols : ''})
       VALUES ($1,$2,$3,$4,$5,$6 ${extra ? ',' + extra.vals : ''})`, [uuid(), requestId, artifactId, HASH, status, profileA]);
    await expect(insert('ready')).rejects.toThrow(/ready_shape/);
    await expect(insert('failed')).rejects.toThrow(/failed_shape/);
  });

  it('getLatestCurrentReadyRun orders by completed_at then id and filters source and prompt version', async () => {
    const older = await ready();
    const newer = await ready();
    const otherVersion = await ready({}, 2);
    const otherSource = await ready({ sourceContentHash: HASH2 });
    await pool.query("UPDATE staff_discussion_sentiments SET completed_at = '2026-10-01T00:00:00Z' WHERE id=$1", [older]);
    await pool.query("UPDATE staff_discussion_sentiments SET completed_at = '2026-10-02T00:00:00Z' WHERE id=$1", [newer]);
    await pool.query("UPDATE staff_discussion_sentiments SET completed_at = '2026-10-03T00:00:00Z' WHERE id IN ($1,$2)", [otherVersion, otherSource]);
    const query = (over = {}) => getLatestCurrentReadyRun({ requestId, sourceArtifactId: artifactId, sourceContentHash: HASH, promptVersion: 1, ...over });
    await expect(query()).resolves.toMatchObject({ id: newer });
    await expect(query({ promptVersion: 2 })).resolves.toMatchObject({ id: otherVersion });
    await expect(query({ promptVersion: 9 })).resolves.toBeNull();
    // Tie on completed_at: the larger id wins.
    await pool.query("UPDATE staff_discussion_sentiments SET completed_at = '2026-10-02T00:00:00Z' WHERE id=$1", [older]);
    const winner = [older, newer].sort().pop();
    await expect(query()).resolves.toMatchObject({ id: winner });
  });

  it('getRun is scoped to the request and getLatestRun returns the newest run in any state', async () => {
    const id = await ready();
    await expect(getRun({ id, requestId })).resolves.toMatchObject({ id });
    await expect(getRun({ id, requestId: uuid() })).resolves.toBeNull();
    const { run } = await reserve();
    await expect(getLatestRun({ requestId })).resolves.toMatchObject({ id: run.id });
  });

  it('concurrent accept of a newer row and withdraw of the accepted one end with one consistent state', async () => {
    for (let i = 0; i < 5; i += 1) {
      requestId = uuid(); artifactId = uuid();
      const first = await ready();
      await acceptRun({ id: first, requestId, profileId: profileA, expected: expected() });
      const second = await ready();
      const [acceptResult, withdrawResult] = await Promise.all([
        acceptRun({ id: second, requestId, profileId: profileB, expected: expected() }),
        withdrawRun({ id: first, requestId, profileId: profileA }),
      ]);
      expect(acceptResult).toMatchObject({ id: second });
      expect(withdrawResult === null || withdrawResult.id === first).toBe(true);
      expect((await row(first)).withdrawn_at).toBeTruthy();
      expect((await accepted()).map((r) => r.id)).toEqual([second]);
    }
  });

  it('concurrent accepts of two ready rows serialize: one wins, one accepted row remains, no unique violation surfaces', async () => {
    const a = await ready();
    const b = await ready();
    const results = await Promise.all([
      acceptRun({ id: a, requestId, profileId: profileA, expected: expected() }),
      acceptRun({ id: b, requestId, profileId: profileB, expected: expected() }),
    ]);
    expect(results.every((r) => r && r.accepted_at)).toBe(true);
    expect(await accepted()).toHaveLength(1);
  });
});
