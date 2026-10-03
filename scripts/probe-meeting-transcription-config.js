#!/usr/bin/env node
'use strict';

// Local projection by default; --profile adds a pinned, read-only Neon SELECT.
// No business writes. Run under the explicitly scoped
// Vercel Preview env pull file recorded in the reconnaissance plan.
// Parse that file directly; never merge unrelated local credentials/settings.
const fs = require('node:fs');
const dotenv = require('dotenv');
const envPath = process.argv[2];
if (!envPath) throw new Error('An explicitly pulled Preview environment file is required.');
const env = dotenv.parse(fs.readFileSync(envPath));
const flags = [
  'MEETING_TRANSCRIPTION_REHEARSAL_ENABLED',
  'MEETING_TRANSCRIPTION_SUPERVISED_TEST_ENABLED',
  'MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE',
  'MEETING_TRACKER_TRANSCRIPT_BUNDLE_SCHEMA_READY',
  'MEETING_TRACKER_TRANSCRIPTION_SCHEMA_READY',
  'MEETING_TRACKER_TRANSCRIPTION_ACCESS',
  'POST_PRESENTATION_MATERIALS_SCHEMA_READY', 'POST_PRESENTATION_MATERIALS_ACCESS',
  'TRANSCRIPTION_SUBMISSIONS_ENABLED', 'TRANSCRIPTION_PILOT_ENABLED',
  'DATAVERSE_DAL_ENFORCEMENT', 'DATAVERSE_ALLOW_PROD_READS',
  'DATAVERSE_TARGET_INTERLOCK', 'AUTH_REQUIRED', 'EMERGENCY_AUTH_BYPASS',
];
const allowed = /^(on|off|true|false|yes|no|0|1|meeting-transcription-test|test:[0-9a-f-]{36})$/i;
const report = {};
for (const key of flags) {
  const value = env[key];
  report[key] = !value ? 'unset' : allowed.test(value) ? value : 'unrecognized-redacted';
}
for (const key of ['DYNAMICS_URL', 'POSTGRES_URL', 'NEXTAUTH_URL', 'TRANSCRIPTION_CALLBACK_URL']) {
  try { report[`${key}_hostname`] = new URL(env[key]).hostname; }
  catch { report[`${key}_hostname`] = 'unavailable'; }
}
report.VERCEL_PROJECT_ID = env.VERCEL_PROJECT_ID || 'unset';
report.VERCEL_ENV = env.VERCEL_ENV || 'unset';
console.log(JSON.stringify(report, null, 2));
console.log(JSON.stringify({ configuredKeys: Object.fromEntries([
  'UPLOADS_BLOB_RW_TOKEN', 'ASSEMBLYAI_API_KEY', 'DYNAMICS_CLIENT_ID',
  'DYNAMICS_CLIENT_SECRET', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET',
].map(key => [key, Boolean(env[key])])) }));

async function inspectProfile() {
  const { readTargetEnvFromObject, createClientConfig, IDENTITY } = require('./seed-meeting-transcription-test-identity');
  const { Client } = require('pg');
  const url = readTargetEnvFromObject(env);
  const client = new Client(createClientConfig(url));
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(
      'SELECT id, is_active, needs_linking, dynamics_systemuser_id IS NOT NULL AS actor_mapping_present FROM user_profiles WHERE azure_id = $1 ORDER BY id LIMIT 2',
      [IDENTITY.azureId],
    );
    const rows = result.rows;
    const roles = rows.length === 1
      ? await client.query('SELECT role FROM dynamics_user_roles WHERE user_profile_id = $1 ORDER BY role', [rows[0].id])
      : { rows: [] };
    const safeRoles = roles.rows.map(({ role }) =>
      ['read_only', 'read_write', 'superuser'].includes(role) ? role : 'unrecognized-role');
    const profile = rows.length === 1 ? rows[0] : null;
    console.log(JSON.stringify({ dedicatedProfile: {
      matchingRows: rows.length,
      profileId: profile?.id ?? null,
      isActive: profile?.is_active ?? false,
      needsLinking: profile?.needs_linking ?? null,
      actorMappingPresent: profile?.actor_mapping_present ?? false,
      localRoles: safeRoles,
      localSuperuserRolePresent: safeRoles.includes('superuser'),
    } }));
    await client.query('ROLLBACK');
  } finally { await client.end(); }
}
if (process.argv.includes('--profile')) {
  inspectProfile().catch(() => {
    console.error('Dedicated profile read failed; details redacted.');
    process.exitCode = 1;
  });
}
