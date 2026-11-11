/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const dotenv = require('dotenv');
const { createRosterPgFixture } = require('../helpers/roster-pg-fixture.cjs');
const { runCutover } = require('../../scripts/lib/expertise-roster-cutover.cjs');
const { main: cutoverCli } = require('../../scripts/rehearse-roster-cutover.cjs');
const { planImport, TEXT_POLICY } = require('../../scripts/lib/expertise-roster-import-plan.cjs');

const host = 'orgd9e66399.crm.dynamics.com';
const envFile = process.env.ROSTER_LIVE_SQL_TEST_ENV;
const live = envFile ? describe : describe.skip;

test.each(['prepare', 'activate', 'pause', 'resume', 'abort'])('%s refuses public before connecting', async phase => {
  const connect = jest.fn();
  await expect(runCutover({ schema: 'public', phase, connect, execute: true })).rejects.toThrow(/public is refused/);
  expect(connect).not.toHaveBeenCalled();
});

test('CLI tags its explicit argument refusal for safe display', async () => {
  await expect(cutoverCli(['--invalid', 'value'])).rejects.toMatchObject({
    code: 'roster_cutover_refused', message: 'Invalid cutover arguments.',
  });
});

live('disposable roster operational phases', () => {
  let db, dir, env, review, snapshot;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roster-cutover-'));
    env = dotenv.parse(fs.readFileSync(envFile));
    db = await createRosterPgFixture(envFile);
    const { rows } = await db.primary.query('SELECT * FROM expertise_roster ORDER BY id');
    const source = { version: 1, datasetId: randomUUID(), sequenceHighWater: 42, rows: JSON.parse(JSON.stringify(rows)) };
    const mapping = { version: 1, datasetId: source.datasetId, targetHost: host, rows: rows.map(row => ({
      legacyId: row.id, confirmed: true, active: row.id !== 35, exclude: row.id === 35,
      staffUserGuid: null, contactGuid: null, leadPdEligible: false,
    })) };
    snapshot = { version: 1, complete: true, targetHost: host, profiles: [] };
    const reviewedPlan = planImport(source, snapshot, mapping, [host]);
    const receiptRows = [];
    for (const row of reviewedPlan.rows) {
      await db.primary.query('INSERT INTO expertise_roster_identity (id) VALUES ($1)', [row.legacyId]);
      const receipt = { legacyId: row.legacyId, rosterId: row.legacyId, creationKey: row.creationKey };
      if (row.action === 'exclude') {
        receipt.status = 'identity-only';
      } else {
        receipt.status = 'bound';
        receipt.profileGuid = randomUUID();
        snapshot.profiles.push({ profileGuid: receipt.profileGuid, values: { ...row.values, '@odata.etag': 'W/"1"' } });
        await db.primary.query('INSERT INTO expertise_roster_binding VALUES ($1,$2,$3)',
          [row.legacyId, host, receipt.profileGuid]);
      }
      receiptRows.push(receipt);
    }
    review = { source, mapping, reviewedPlan, importReceipt: {
      version: 2, success: true, bridgeCommitted: true, targetHost: host, datasetId: source.datasetId,
      textPolicy: TEXT_POLICY, sourceHash: reviewedPlan.sourceHash, mappingHash: reviewedPlan.mappingHash, rows: receiptRows,
    } };
  });
  afterEach(async () => {
    try {
      if (db) await db.cleanup();
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
      db = dir = null;
    }
  });
  const run = (phase, extra = {}) => runCutover({
    env, schema: db.schema, phase, acknowledge: host, manifestPath: path.join(dir, 'baseline.json'),
    receiptPath: path.join(dir, randomUUID() + '.json'), execute: true, review,
    connect: db.connect, readTarget: async () => structuredClone(snapshot), ...extra,
  });

  test('dry-run, freeze, activate, intent refusal, pause, and verified resume', async () => {
    expect(await run('prepare', { execute: false })).toMatchObject({ status: 'dry-run', currentPhase: null });
    expect(fs.readdirSync(dir)).toEqual([]);
    await run('prepare');
    const writer = await db.connect();
    for (const sql of [
      "INSERT INTO expertise_roster (name, role_type) VALUES ('Blocked synthetic profile', 'Consultant')",
      'UPDATE expertise_roster SET is_active=false WHERE id=1',
      'DELETE FROM expertise_roster WHERE id=2',
      'TRUNCATE expertise_roster, consultant_feedback',
    ]) await expect(writer.query(sql)).rejects.toMatchObject({ code: '55000' });
    expect((await writer.query('SELECT last_value FROM expertise_roster_id_seq')).rows[0].last_value).toBe('42');
    expect(await run('activate')).toMatchObject({ status: 'committed', currentPhase: 'active', highWater: 42 });
    const attempt = randomUUID();
    await writer.query('UPDATE expertise_roster_cutover SET pending=$1::jsonb',
      [JSON.stringify({ [attempt]: { kind: 'update', profileGuid: snapshot.profiles[0].profileGuid, etag: 'W/"1"' } })]);
    await expect(run('pause')).rejects.toThrow(/Unsettled/);
    expect((await writer.query('SELECT phase FROM expertise_roster_cutover')).rows[0].phase).toBe('active');
    await writer.query("UPDATE expertise_roster_cutover SET pending='{}'::jsonb"); // Synthetic known completion.
    expect(await run('pause')).toMatchObject({ currentPhase: 'paused' });
    expect(await run('pause')).toMatchObject({ status: 'observed' });
    expect(await run('resume')).toMatchObject({ currentPhase: 'active' });
    expect(await run('resume')).toMatchObject({ status: 'observed' });
  });

  test('prepare refuses pre-cutover Dataverse edits and activate refuses a disabled guard', async () => {
    const before = snapshot.profiles[0].values.wmkf_name;
    snapshot.profiles[0].values.wmkf_name = 'Synthetic edit';
    await expect(run('prepare')).rejects.toThrow(/differs from reviewed import/);
    snapshot.profiles[0].values.wmkf_name = before;
    await db.primary.query('ALTER TABLE consultant_feedback ALTER COLUMN shared SET DEFAULT false');
    await expect(run('prepare')).rejects.toThrow(/Unexpected .* defaults/);
    await db.primary.query('ALTER TABLE consultant_feedback ALTER COLUMN shared SET DEFAULT true');
    await run('prepare');
    snapshot.profiles[0].values['@odata.etag'] = 'W/"2"';
    await expect(run('activate')).rejects.toThrow(/Dataverse census or bridge changed/);
    snapshot.profiles[0].values['@odata.etag'] = 'W/"1"';
    await db.primary.query('ALTER TABLE expertise_roster DISABLE TRIGGER expertise_roster_freeze_dml');
    await expect(run('activate')).rejects.toThrow(/freeze definition differs/);
    expect((await db.primary.query('SELECT phase FROM expertise_roster_cutover')).rows[0].phase).toBe('prepared');
  });

  test('a lost prepare COMMIT response recovers the same generation; abort is terminal', async () => {
    const receiptPath = path.join(dir, 'lost.json');
    const connect = async () => {
      const client = await db.connect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        const result = await query(...args);
        if (args[0] === 'COMMIT') throw Error('Synthetic lost COMMIT response');
        return result;
      };
      return client;
    };
    await expect(run('prepare', { connect, receiptPath })).rejects.toThrow(/lost COMMIT/);
    expect(JSON.parse(fs.readFileSync(receiptPath)).status).toBe('commit-unknown');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json')));
    expect(await run('prepare')).toMatchObject({ status: 'observed', generation: manifest.generation });
    expect(await run('abort')).toMatchObject({ currentPhase: 'legacy' });
    await expect(run('activate')).rejects.toThrow(/incompatible/);
    expect((await db.primary.query(
      "INSERT INTO expertise_roster (name,role_type) VALUES ('After abort','Consultant') RETURNING id",
    )).rows[0].id).toBe(43);
    expect(await run('abort')).toMatchObject({ status: 'observed', generation: manifest.generation });
  });

  test('an unlock failure does not mask the committed result or receipt', async () => {
    const receiptPath = path.join(dir, 'unlock.json');
    const connect = async () => {
      const client = await db.connect();
      const query = client.query.bind(client);
      client.query = async (...args) => {
        if (args[0].startsWith('SELECT pg_advisory_unlock')) throw Error('Synthetic unlock failure');
        return query(...args);
      };
      return client;
    };
    const result = await run('prepare', { connect, receiptPath });
    expect(result).toMatchObject({ status: 'committed', currentPhase: 'prepared' });
    expect(JSON.parse(fs.readFileSync(receiptPath))).toEqual(result);
    expect(await run('prepare')).toMatchObject({ status: 'observed', generation: result.generation });
  });
});
