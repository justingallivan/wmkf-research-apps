/** @jest-environment node */
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Pool } from 'pg';
import { saveCycle } from '../../lib/services/board-writeups/config';
import { PROGRAM_ID } from '../../lib/services/board-writeups/model';
import { mutateCycle } from '../../lib/services/board-writeups/store';
// Explicit isolated localhost-only database. Never discovers project credentials.
const connectionString = process.env.BOARD_TEST_DATABASE_URL;
const suite = connectionString ? describe : describe.skip;
suite('Board journal real Postgres transaction boundaries', () => {
  let pool;
  const schema = `board_workflow_${crypto.randomUUID().replaceAll('-', '')}`;
  beforeAll(async () => {
    const url = new URL(connectionString);
    if (url.hostname !== '127.0.0.1' || url.pathname !== '/postgres') throw new Error('Use an isolated local test container');
    pool = new Pool({ connectionString, max: 8, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query(fs.readFileSync('lib/db/migrations/085_board_writeup_runs.sql', 'utf8'));
  });
  afterAll(async () => { if (pool) { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); } });
  test('overlapping writers serialize and preserve every receipt', async () => {
    await Promise.all(Array.from({ length: 24 }, (_, i) => mutateCycle('J00', state => { state.releases[String(i)] = { state: 'queued' }; }, () => pool.connect())));
    const { rows } = await pool.query("SELECT revision,state FROM board_writeup_runs WHERE cycle_code='J00'");
    expect(Number(rows[0].revision)).toBe(24);
    expect(Object.keys(rows[0].state.releases)).toHaveLength(24);
  });
  test('failed transaction rolls back intent and first-row insertion', async () => {
    await expect(mutateCycle('D00', state => { state.archiveStartedAt = 'now'; throw new Error('crash'); }, () => pool.connect())).rejects.toThrow('crash');
    const { rows } = await pool.query("SELECT state FROM board_writeup_runs WHERE cycle_code='D00'");
    expect(rows).toHaveLength(0);
  });
  test('Dataverse configuration readback reconciles after JSONB reorders object keys', async () => {
    const identity = '11111111-1111-4111-8111-111111111111';
    let setting = { found: false };
    const value = { version: 1, cycle: 'D02', programId: PROGRAM_ID, active: false, rosterConfirmed: false, requestIds: [], materialsDue: null, boardEnds: null, adminId: null };
    const deps = { getUser: async () => ({ isdisabled: false, internalemailaddress: 'admin@wmkeck.org' }), resolveSystemUserToProfile: async () => 'profile', profile: async () => ({ is_active: true, superuser: true }),
      getSettingStrict: async () => setting, setSettingIfUnchanged: async (_key, serialized) => { setting = { found: true, value: serialized, revision: 'new-etag' }; },
      mutateCycle: (cycle, fn) => mutateCycle(cycle, fn, () => pool.connect()) };
    await saveCycle({ profileId: 'profile', systemUserId: identity }, value, null, '', deps);
    const { rows } = await pool.query("SELECT state FROM board_writeup_runs WHERE cycle_code='D02'");
    expect(rows[0].state.configIntent).toBeNull();
    expect(rows[0].state.configHistory[0].value).toEqual(value);
  });
  test('concurrent archive and release cannot both cross the shared fence', async () => {
    const results = await Promise.allSettled([
      mutateCycle('J01', state => { if (state.archiveStartedAt) throw new Error('closed'); state.releases.one = { state: 'queued' }; }, () => pool.connect()),
      mutateCycle('J01', state => { if (Object.keys(state.releases).length) throw new Error('pending'); state.archiveStartedAt = 'now'; }, () => pool.connect()),
    ]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const { rows } = await pool.query("SELECT state FROM board_writeup_runs WHERE cycle_code='J01'");
    expect(Boolean(rows[0].state.archiveStartedAt) && Boolean(rows[0].state.releases.one)).toBe(false);
  });
});
