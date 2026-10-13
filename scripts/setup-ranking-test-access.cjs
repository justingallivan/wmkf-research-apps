#!/usr/bin/env node
/** Dedicated ranking Preview access setup. Read-only by default; --execute applies
 * tracked migrations and adds missing real Microsoft profiles and sandbox grants.
 * Never changes an existing profile, grants a role, or authenticates as a user.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { validateTarget } = require('./bootstrap-meeting-transcription-test.js');
const ROOT = path.resolve(__dirname, '..');
const TARGET = 'https://orgd9e66399.crm.dynamics.com';
const STAFF = [
  ['29b0de0d-4ff7-ee11-a1fd-000d3a3621c7', '893369cc-1925-40ec-bbc6-6f12b0684a31'],
  ['1d49fd66-803e-f111-88b4-6045bd015cb0', 'efb729ef-4f9a-45fa-9f16-1c50c31f77cf'],
  ['a83a3bf8-507f-ee11-8179-000d3a341e8f', 'e12b0338-341a-4871-a623-80b8126c4c50'],
  ['b53a3bf8-507f-ee11-8179-000d3a341e8f', '6bc0ee71-4069-42cb-8edf-26b050988997'],
];
async function main() {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  assert(args.length === (execute ? 3 : 2) && args[0] === '--env-file' && (!execute || args[2] === '--execute'), 'Use --env-file PATH [--execute]');
  const env = parseEnv(fs.readFileSync(args[1], 'utf8'));
  assert(env.POSTGRES_URL, 'Explicit POSTGRES_URL is required');
  validateTarget(env);
  for (const value of [env.POSTGRES_URL, env.DATABASE_URL].filter(Boolean)) {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) assert(['sslmode', 'channel_binding'].includes(key), 'Unexpected database URL option');
  }
  assert.equal(env.DYNAMICS_URL, TARGET);
  assert.equal(env.NEXTAUTH_URL, 'https://wmkf-meeting-transcription-test.vercel.app');
  assert.equal(env.DATAVERSE_TARGET_INTERLOCK, 'on');
  const local = parseEnv(fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8'));
  // Only the application's existing Dataverse OAuth credentials are used locally.
  for (const key of ['DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET', 'DYNAMICS_TENANT_ID']) {
    assert(local[key] && local[key] !== '[SENSITIVE]', `Missing ${key}`);
    process.env[key] = local[key];
  }
  Object.assign(process.env, { DYNAMICS_URL: TARGET, DYNAMICS_SANDBOX_URL: TARGET,
    DATAVERSE_TARGET_INTERLOCK: 'on', DATAVERSE_DAL_ENFORCEMENT: 'on', DATAVERSE_ALLOW_PROD_READS: 'no' });
  const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
  const { withDalContext } = await import('../lib/dataverse/core/context.js');
  const dv = createClient({ resourceUrl: TARGET, token: await getAccessToken(TARGET) });
  const staff = [];
  for (const [id, oid] of STAFF) {
    const r = await dv.get(`/systemusers(${id})?$select=systemuserid,azureactivedirectoryobjectid,isdisabled,fullname,internalemailaddress`);
    assert(r.ok && r.body.systemuserid === id && r.body.azureactivedirectoryobjectid === oid && r.body.isdisabled === false, 'Staff identity mismatch');
    assert(r.body.internalemailaddress && r.body.fullname, 'Staff profile incomplete');
    staff.push(r.body);
  }
  const db = new Client({ connectionString: env.POSTGRES_URL });
  await db.connect();
  try {
    const tracked = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const pending = fs.readdirSync(path.join(ROOT, 'lib/db/migrations')).filter(n => n.endsWith('.sql') && !tracked.has(n)).sort();
    const profiles = (await db.query('SELECT id,azure_id,dynamics_systemuser_id,is_active,needs_linking FROM user_profiles')).rows;
    for (const person of staff) {
      const matches = profiles.filter(p => p.azure_id === person.azureactivedirectoryobjectid || p.dynamics_systemuser_id === person.systemuserid);
      assert(matches.length <= 1, 'Duplicate profile link');
      if (matches.length) assert(matches[0].azure_id === person.azureactivedirectoryobjectid && matches[0].dynamics_systemuser_id === person.systemuserid && matches[0].is_active === true && matches[0].needs_linking === false, 'Existing profile differs; refusing replacement');
    }
    console.log(JSON.stringify({ mode: execute ? 'execute' : 'preflight', target: TARGET, databaseHost: new URL(env.POSTGRES_URL).hostname, verifiedStaff: staff.length, existingProfiles: profiles.length, pendingMigrations: pending }));
    if (!execute) return;
    // Explicit primary connection prevents repository dotenv fallback to another DB.
    const migration = spawnSync(process.execPath, [path.join(ROOT, 'scripts/apply-migrations.js')], {
      cwd: ROOT, env: { ...process.env, POSTGRES_URL: env.POSTGRES_URL, DATABASE_URL: env.POSTGRES_URL,
        APPLY_MIGRATIONS_APPLIED_BY: 'ranking-test-access-2026-10-13' }, encoding: 'utf8',
    });
    console.log(migration.stdout);
    assert.equal(migration.status, 0, 'Migration failed; inspect tracker before retrying');
    await db.query('BEGIN');
    try {
      await db.query('LOCK TABLE user_profiles IN SHARE ROW EXCLUSIVE MODE');
      for (const person of staff) {
        const existing = await db.query('SELECT id,azure_id,dynamics_systemuser_id,is_active,needs_linking FROM user_profiles WHERE azure_id=$1 OR dynamics_systemuser_id=$2', [person.azureactivedirectoryobjectid, person.systemuserid]);
        assert(existing.rows.length <= 1, 'Duplicate profile link');
        if (existing.rows.length) {
          const p = existing.rows[0];
          assert(p.azure_id === person.azureactivedirectoryobjectid && p.dynamics_systemuser_id === person.systemuserid && p.is_active === true && p.needs_linking === false, 'Profile changed during setup');
          continue;
        }
        await db.query('INSERT INTO user_profiles(name, display_name, azure_id, azure_email, dynamics_systemuser_id, is_active, needs_linking) VALUES($1,$1,$2,$3,$4,true,false)', [person.fullname, person.azureactivedirectoryobjectid, person.internalemailaddress, person.systemuserid]);
      }
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
    await withDalContext('ranking-test-access-setup', async () => {
      for (const person of staff) for (const app of ['proposal-ranking', 'meeting-tracker']) {
        const r = await dv.get(`/wmkf_appuserappaccesses?$select=wmkf_appuserappaccessid&$filter=_wmkf_user_value eq ${person.systemuserid} and wmkf_appkey eq '${app}'`);
        assert(r.ok && !r.body['@odata.nextLink'], 'Grant lookup failed');
        if (!r.body.value.length) {
          const created = await dv.post('/wmkf_appuserappaccesses', { wmkf_appkey: app, 'wmkf_User@odata.bind': `/systemusers(${person.systemuserid})` });
          assert(created.ok, 'Grant create failed; preflight before retry');
        }
      }
    });
    console.log(JSON.stringify({ setup: 'profiles-and-grants-written', independentSignIns: 'not-tested' }));
  } finally { await db.end(); }
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : 'Setup failed; inspect scoped state before retrying.'); process.exitCode = 1; });
