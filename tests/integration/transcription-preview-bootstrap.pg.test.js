/** @jest-environment node */
const crypto = require('node:crypto');
const { Client } = require('pg');
const { bootstrapFreshDatabase } = require('../../scripts/lib/fresh-database-bootstrap');
const { getBootstrapGroups } = require('../../scripts/setup-database');
const { seedAdmin, verifyBootstrapReadback, verifySeedReadback } = require('../../scripts/bootstrap-transcription-preview');

const raw = process.env.DATABASE_BOOTSTRAP_TEST_URL;
const url = raw ? new URL(raw) : null;
if (url && (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/ledger' || url.search || url.hash)) {
  throw new Error('Only the approved loopback scratch service is permitted.');
}

(url ? test : test.skip)('public bootstrap preserves existing provider schema and admin seed is atomic', async () => {
  const admin = new Client({ connectionString: raw });
  const name = `preview_${crypto.randomUUID().replaceAll('-', '')}`;
  let client;
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
    created = true;
    const scratch = new URL(raw);
    scratch.pathname = `/${name}`;
    client = new Client({ connectionString: scratch.toString() });
    await client.connect();
    await client.query('CREATE SCHEMA neon_auth');
    await client.query('CREATE TABLE neon_auth.project_config (id INTEGER PRIMARY KEY, sentinel TEXT)');
    await client.query("INSERT INTO neon_auth.project_config VALUES (1, 'synthetic-preserve-me')");
    // Deliberately hostile session path: bootstrap and seed must still use public.
    await client.query('SET search_path TO neon_auth, pg_catalog');
    await bootstrapFreshDatabase(client, getBootstrapGroups());
    await verifyBootstrapReadback(client);
    expect((await client.query('SELECT * FROM neon_auth.project_config')).rows)
      .toEqual([{ id: 1, sentinel: 'synthetic-preserve-me' }]);
    // Force failure after profile INSERT; both profile and role writes must roll back.
    await client.query("ALTER TABLE public.dynamics_user_roles ADD CONSTRAINT seed_failure CHECK (role <> 'superuser')");
    await expect(seedAdmin(client)).rejects.toThrow();
    expect((await client.query('SELECT COUNT(*)::int AS n FROM public.user_profiles')).rows[0].n).toBe(0);
    expect((await client.query('SELECT COUNT(*)::int AS n FROM public.dynamics_user_roles')).rows[0].n).toBe(0);
    await client.query('ALTER TABLE public.dynamics_user_roles DROP CONSTRAINT seed_failure');
    await seedAdmin(client);
    await verifySeedReadback(client);
    await expect(seedAdmin(client)).rejects.toThrow('profile_seed_guard_failed');
    expect((await client.query('SELECT COUNT(*)::int AS n FROM public.user_profiles')).rows[0].n).toBe(1);
    expect((await client.query('SELECT COUNT(*)::int AS n FROM public.dynamics_user_roles')).rows[0].n).toBe(1);
    expect((await client.query('SELECT * FROM neon_auth.project_config')).rows)
      .toEqual([{ id: 1, sentinel: 'synthetic-preserve-me' }]);
  } finally {
    if (client) await client.end();
    if (created) await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
  }
}, 120000);
