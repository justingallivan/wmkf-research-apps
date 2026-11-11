/** Opt-in integration fixture. All writes stay in a disposable synthetic schema. */
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { parse } = require('dotenv');
const { Client } = require('pg');
const { assertTarget } = require('../../lib/services/expertise-finder/roster-rehearsal-target.cjs');

const root = path.resolve(__dirname, '../..');
const fixtureSchema = /^roster_rehearsal_[a-f0-9]{32}$/;
const publicRosterTables = ['expertise_roster', 'expertise_roster_identity', 'expertise_roster_binding', 'consultant_feedback'];
const publicCutoverTable = 'expertise_roster_cutover';
const publicSequences = ['expertise_roster_id_seq', 'consultant_feedback_id_seq'];

async function assertDatabase(client) {
  const { rows: [identity] } = await client.query(
    'SELECT current_database() AS database, current_user AS username',
  );
  assert.deepEqual(identity, { database: 'roster_rehearsal', username: 'roster_rehearsal' });
}

async function readSchema(client, schema) {
  const { rows: [namespace] } = await client.query(
    'SELECT oid::text AS oid, nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS owned FROM pg_namespace WHERE nspname = $1',
    [schema],
  );
  return namespace;
}

async function fingerprintPublic(client) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const hash = createHash('sha256');
    const { rows: [{ present }] } = await client.query(
      'SELECT to_regclass($1) IS NOT NULL AS present',
      [`public.${publicCutoverTable}`],
    );
    hash.update(JSON.stringify([publicCutoverTable, present]));
    const tables = present ? [...publicRosterTables, publicCutoverTable] : [...publicRosterTables];
    for (const table of ['user_profiles', 'dynamics_user_roles', 'expertise_matches']) {
      const { rows: [item] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
      hash.update(JSON.stringify([table, item.present]));
      if (item.present) tables.push(table);
    }
    for (const table of tables) {
      const { rows } = await client.query(
        `SELECT to_jsonb(t)::text AS value FROM public."${table}" AS t ORDER BY value`,
      );
      hash.update(JSON.stringify([table, rows]));
    }
    for (const sequence of [...publicSequences, 'expertise_matches_id_seq']) {
      const { rows: [item] } = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${sequence}`]);
      hash.update(JSON.stringify([sequence, item.present]));
      if (!item.present) { assert(!publicSequences.includes(sequence), 'Required public sequence missing'); continue; }
      const { rows } = await client.query(`SELECT last_value, is_called FROM public."${sequence}"`);
      hash.update(JSON.stringify([sequence, rows]));
    }
    const { rows: constraints } = await client.query(
      `SELECT source.relname AS source, c.conname, target_ns.nspname AS target_schema,
              target.relname AS target, c.convalidated, pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class source ON source.oid = c.conrelid
         JOIN pg_namespace source_ns ON source_ns.oid = source.relnamespace
         JOIN pg_class target ON target.oid = c.confrelid
         JOIN pg_namespace target_ns ON target_ns.oid = target.relnamespace
        WHERE source_ns.nspname = 'public' AND source.relname = ANY($1::text[]) AND c.contype = 'f'
        ORDER BY source.relname, c.conname`,
      [tables],
    );
    hash.update(JSON.stringify(constraints));
    const { rows: relations } = await client.query(
      `SELECT c.relname, c.relkind
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY c.relname, c.relkind`,
    );
    hash.update(JSON.stringify(relations));
    const { rows: triggers } = await client.query(
      `SELECT c.relname AS relation, t.tgname, t.tgenabled, t.tgisinternal,
              pg_get_triggerdef(t.oid) AS definition,
              fn_ns.nspname AS function_schema, fn.proname AS function_name,
              pg_get_function_identity_arguments(fn.oid) AS function_arguments,
              pg_get_functiondef(fn.oid) AS function_definition
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_proc fn ON fn.oid = t.tgfoid
         JOIN pg_namespace fn_ns ON fn_ns.oid = fn.pronamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
        ORDER BY c.relname, t.tgname`,
      [tables],
    );
    hash.update(JSON.stringify(triggers));
    await client.query('COMMIT');
    return hash.digest('hex');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function createRosterPgFixture(envFile) {
  const file = statSync(envFile);
  assert(file.isFile() && (file.mode & 0o077) === 0, 'Expected a private rehearsal environment file');
  const { connectionString } = assertTarget(parse(readFileSync(envFile)));
  const schema = `roster_rehearsal_${randomUUID().replaceAll('-', '')}`;
  assert(fixtureSchema.test(schema));
  const quotedSchema = `"${schema}"`;
  const newClient = () => new Client({ connectionString, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  const admin = newClient();
  const clients = new Set();
  let before;
  let namespace;
  let cleanupPromise;

  async function connect() {
    assert(!cleanupPromise, 'Fixture cleanup has started');
    const client = newClient();
    clients.add(client);
    try {
      await client.connect();
      await assertDatabase(client);
      await client.query(`SET search_path TO ${quotedSchema}`);
      const { rows: [resolved] } = await client.query(
        'SELECT current_schema() AS name, current_schemas(false)::text[] AS path',
      );
      assert.deepEqual(resolved, { name: schema, path: [schema] });
      assert.deepEqual(await readSchema(client, schema), namespace);
      return client;
    } catch (error) {
      await client.end();
      clients.delete(client);
      throw error;
    }
  }

  async function cleanupOnce({ retainSchema = false } = {}) {
    const closed = await Promise.allSettled([admin, ...clients].map(client => client.end()));
    clients.clear();
    let after, removed = false;
    if (before) {
      const cleanupClient = newClient();
      try {
        await cleanupClient.connect();
        await assertDatabase(cleanupClient);
        if (namespace) {
          const current = await readSchema(cleanupClient, schema);
          if (current) {
            assert(current.owned && fixtureSchema.test(schema), 'Refusing to drop an unowned fixture schema');
            assert.equal(current.oid, namespace.oid, 'Fixture schema was replaced');
            if (!retainSchema) {
              await cleanupClient.query(`DROP SCHEMA ${quotedSchema} CASCADE`);
              removed = true;
            }
          }
        }
        after = await fingerprintPublic(cleanupClient);
        assert.equal(after, before, 'Public roster fingerprint changed during the fixture');
      } finally {
        await cleanupClient.end();
      }
    }
    const failure = closed.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    return { before, after, removed };
  }

  function cleanup(options) {
    cleanupPromise ??= cleanupOnce(options);
    return cleanupPromise;
  }

  try {
    await admin.connect();
    await assertDatabase(admin);
    before = await fingerprintPublic(admin);
    assert.equal(await readSchema(admin, schema), undefined, 'Fixture schema already exists');
    await admin.query('BEGIN');
    await admin.query(`CREATE SCHEMA ${quotedSchema}`);
    namespace = await readSchema(admin, schema);
    assert(namespace?.owned, 'Fixture schema ownership mismatch');
    await admin.query('COMMIT');
    const primary = await connect();
    await primary.query('CREATE TABLE user_profiles (id INTEGER PRIMARY KEY)');
    await primary.query('INSERT INTO user_profiles (id) VALUES (1)');
    for (const migration of ['004_expertise_finder.sql', '048_consultant_feedback.sql', '050_expertise_roster_contact_link.sql']) {
      await primary.query(readFileSync(path.join(root, 'lib/db/migrations', migration), 'utf8'));
    }
    await primary.query('ALTER TABLE expertise_roster ADD COLUMN preferred_email VARCHAR(320)');
    await primary.query(readFileSync(path.join(root, 'docs/plans/data/expertise-roster/identity-bridge.sql'), 'utf8'));
    await primary.query(
      `INSERT INTO expertise_roster (id, name, role_type)
       VALUES (1, 'Synthetic Consultant', 'Consultant'), (2, 'Synthetic Board Member', 'Board'),
              (35, 'Synthetic excluded profile', 'Consultant')`,
    );
    await primary.query('SELECT setval($1::regclass, 42, true)', [`${quotedSchema}.expertise_roster_id_seq`]);
    await primary.query(
      `INSERT INTO consultant_feedback
         (request_id, consultant_roster_id, body_html, received_on, mutation_id, created_by, updated_by)
       VALUES ($1, 35, 'Synthetic feedback', CURRENT_DATE, $2, 1, 1)`,
      [randomUUID(), randomUUID()],
    );
    return { schema, primary, connect, before, cleanup };
  } catch (error) {
    try {
      await cleanup();
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Roster fixture setup and cleanup failed');
    }
    throw error;
  }
}

module.exports = { createRosterPgFixture };
