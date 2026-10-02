#!/usr/bin/env node
'use strict';

// Read-only by default. --execute performs only the fixed sandbox actor-map
// CAS and missing Meeting Tracker / Workbench grants for the approved user.
// It never creates profiles, assigns local roles, or writes deployment config.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const {
  EXPECTED_NEON_PROJECT_ID,
  EXPECTED_HOST: EXPECTED_NEON_HOST,
} = require('./bootstrap-meeting-transcription-test');
const {
  IDENTITY,
  createClientConfig,
  readTargetEnvFromObject,
} = require('./seed-meeting-transcription-test-identity');

const DYNAMICS_URL = 'https://orgd9e66399.crm.dynamics.com';
const DYNAMICS_HOST = new URL(DYNAMICS_URL).hostname;
const TEST_PROJECT_ID = 'prj_v9lOh6NdInOGxIPSmcX8IYiBPVQB';
const TEST_PROJECT_NAME = 'wmkf-meeting-transcription-test';
const TEST_PROJECT_SCOPE = 'justin-gallivans-projects';
const TEST_PROFILE_VALUE = 'meeting-transcription-test';
const CREDENTIAL_KEYS = ['DYNAMICS_TENANT_ID', 'DYNAMICS_CLIENT_ID', 'DYNAMICS_CLIENT_SECRET'];
const APP_KEYS = ['meeting-tracker', 'reviewers'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseArgs(argv) {
  const options = { execute: false, selfTest: false, envFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--execute' && !options.execute && !options.selfTest) options.execute = true;
    else if (arg === '--self-test' && !options.selfTest && !options.execute) options.selfTest = true;
    else if (arg === '--env-file' && !options.envFile && argv[index + 1]) options.envFile = argv[++index];
    else throw new Error('invalid_arguments');
  }
  if (options.selfTest && options.envFile) throw new Error('invalid_arguments');
  if (!options.selfTest && !options.envFile) throw new Error('env_file_required');
  return options;
}

function readEnvFile(filePath) {
  try { return parseEnv(fs.readFileSync(filePath, 'utf8')); }
  catch { throw new Error('environment_file_unreadable'); }
}

function inspectDedicatedProject() {
  const result = spawnSync('vercel', [
    'project', 'inspect', TEST_PROJECT_NAME,
    '--scope', TEST_PROJECT_SCOPE,
    '--format', 'json', '--non-interactive',
  ], { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('vercel_project_inspection_failed');
  let project;
  try { project = JSON.parse(result.stdout); } catch { throw new Error('vercel_project_metadata_invalid'); }
  if (project.id !== TEST_PROJECT_ID || project.name !== TEST_PROJECT_NAME
      || project.owner?.slug !== TEST_PROJECT_SCOPE) {
    throw new Error('vercel_project_identity_mismatch');
  }
  return { id: project.id, name: project.name, scope: project.owner.slug };
}

function validatePreviewEnv(env, inspectedProject) {
  if (inspectedProject?.id !== TEST_PROJECT_ID || inspectedProject?.name !== TEST_PROJECT_NAME
      || inspectedProject?.scope !== TEST_PROJECT_SCOPE
      || (env.VERCEL_PROJECT_ID && env.VERCEL_PROJECT_ID !== TEST_PROJECT_ID)
      || env.VERCEL_ENV !== 'preview'
      || env.MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE !== TEST_PROFILE_VALUE) {
    throw new Error('dedicated_preview_profile_mismatch');
  }
  const isCanonicalSandboxOrigin = (value) => {
    if (value === undefined) return true;
    try {
      const target = new URL(value);
      return target.origin === DYNAMICS_URL && ['','/'].includes(target.pathname)
        && !target.search && !target.hash && !target.username && !target.password;
    } catch { return false; }
  };
  if (!isCanonicalSandboxOrigin(env.DYNAMICS_URL)
      || !isCanonicalSandboxOrigin(env.DYNAMICS_SANDBOX_URL)
      || env.DYNAMICS_URL === undefined) {
    throw new Error('sandbox_target_mismatch');
  }
  return readTargetEnvFromObject(env);
}

function completeCredentials(source) {
  return CREDENTIAL_KEYS.every((key) => typeof source[key] === 'string'
    && source[key].trim()
    && !/^\[(?:SENSITIVE|ENCRYPTED)\]$/i.test(source[key].trim()));
}

function chooseCredentials(previewEnv, localEnv) {
  if (completeCredentials(previewEnv)) return Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, previewEnv[key]]));
  if (completeCredentials(localEnv)) return Object.fromEntries(CREDENTIAL_KEYS.map((key) => [key, localEnv[key]]));
  throw new Error('dynamics_credentials_missing');
}

function validateActorRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('sandbox_actor_not_unique');
  const row = rows[0];
  if (String(row.azureactivedirectoryobjectid || '').toLowerCase() !== IDENTITY.azureId.toLowerCase()
      || row.isdisabled !== false || !UUID_RE.test(row.systemuserid || '')) {
    throw new Error('sandbox_actor_not_enabled_match');
  }
  return row.systemuserid.toLowerCase();
}

function validateProfileRows(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('dedicated_profile_not_unique');
  const row = rows[0];
  if (row.azure_id !== IDENTITY.azureId || row.name !== IDENTITY.name
      || String(row.azure_email || '').toLowerCase() !== IDENTITY.email.toLowerCase()
      || row.display_name !== IDENTITY.displayName || row.is_active !== true
      || row.needs_linking !== false || Number(row.id) !== 1) {
    throw new Error('dedicated_profile_mismatch');
  }
  return row;
}

function profileMappingAction(storedId, actorId) {
  if (storedId == null || storedId === '') return 'map';
  if (String(storedId).toLowerCase() === String(actorId).toLowerCase()) return 'already_mapped';
  throw new Error('profile_actor_conflict');
}

function assertNoSuperuser(rows) {
  if (rows.some((row) => row.role === 'superuser')) throw new Error('profile_has_superuser_role');
}

function grantAction(rows) {
  if (!Array.isArray(rows) || rows.length > 1) throw new Error('app_grant_not_unique');
  return rows.length === 1 ? 'preserve_existing' : 'create';
}

function classifyGrantReadback(attemptedId, rows) {
  if (!Array.isArray(rows) || rows.length !== 1) {
    return rows?.length === 0 ? 'write_not_confirmed_no_retry' : 'write_outcome_unverified_no_retry';
  }
  return String(rows[0].wmkf_appuserappaccessid).toLowerCase() === attemptedId.toLowerCase()
    ? 'created_confirmed' : 'write_outcome_unverified_no_retry';
}

function safeErrorCode(error) {
  if (/^[a-z0-9_:-]{1,80}$/i.test(error?.code || '')) return error.code;
  if (/^[a-z0-9_:-]{1,80}$/i.test(error?.message || '')) return error.message;
  return 'unexpected_error';
}

function selfTest() {
  assert.throws(() => parseArgs([]), /env_file_required/);
  assert.throws(() => parseArgs(['--execute', '--self-test']), /invalid_arguments/);
  assert.equal(parseArgs(['--execute', '--env-file', 'preview.env']).execute, true);
  assert.throws(() => validatePreviewEnv({
    VERCEL_PROJECT_ID: TEST_PROJECT_ID, VERCEL_ENV: 'production',
    MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: TEST_PROFILE_VALUE,
  }, { id: TEST_PROJECT_ID, name: TEST_PROJECT_NAME, scope: TEST_PROJECT_SCOPE }), /dedicated_preview_profile_mismatch/);
  const goodProfileEnv = {
    VERCEL_PROJECT_ID: TEST_PROJECT_ID, VERCEL_ENV: 'preview',
    MEETING_TRANSCRIPTION_TEST_DEPLOYMENT_PROFILE: TEST_PROFILE_VALUE,
    DYNAMICS_URL, NEON_PROJECT_ID: EXPECTED_NEON_PROJECT_ID,
    POSTGRES_URL: `postgresql://user:password@${EXPECTED_NEON_HOST}/neondb?sslmode=require`,
  };
  const inspectedProject = { id: TEST_PROJECT_ID, name: TEST_PROJECT_NAME, scope: TEST_PROJECT_SCOPE };
  assert.equal(validatePreviewEnv(goodProfileEnv, inspectedProject).hostname, EXPECTED_NEON_HOST);
  assert.throws(() => validatePreviewEnv({ ...goodProfileEnv, DYNAMICS_SANDBOX_URL: 'https://wmkf.crm.dynamics.com' }, inspectedProject), /sandbox_target_mismatch/);
  assert.throws(() => validatePreviewEnv(goodProfileEnv, { ...inspectedProject, id: 'wrong' }), /dedicated_preview_profile_mismatch/);
  assert.equal(completeCredentials({ DYNAMICS_TENANT_ID: 'tenant', DYNAMICS_CLIENT_ID: 'client', DYNAMICS_CLIENT_SECRET: 'secret' }), true);
  assert.equal(completeCredentials({ DYNAMICS_TENANT_ID: '[SENSITIVE]', DYNAMICS_CLIENT_ID: '[ENCRYPTED]', DYNAMICS_CLIENT_SECRET: 'secret' }), false);
  assert.equal(validateActorRows([{
    systemuserid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    azureactivedirectoryobjectid: IDENTITY.azureId, isdisabled: false,
  }]), 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.throws(() => validateActorRows([]), /sandbox_actor_not_unique/);
  const profile = {
    id: 1, name: IDENTITY.name, display_name: IDENTITY.displayName,
    azure_id: IDENTITY.azureId, azure_email: IDENTITY.email,
    is_active: true, needs_linking: false, dynamics_systemuser_id: null,
  };
  assert.equal(validateProfileRows([profile]).id, 1);
  assert.throws(() => validateProfileRows([{ ...profile, id: 17 }]), /dedicated_profile_mismatch/);
  assert.equal(profileMappingAction(null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'map');
  assert.equal(profileMappingAction('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'), 'already_mapped');
  assert.throws(() => profileMappingAction('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), /profile_actor_conflict/);
  assert.throws(() => assertNoSuperuser([{ role: 'read_write' }, { role: 'superuser' }]), /profile_has_superuser_role/);
  assert.equal(grantAction([]), 'create');
  assert.equal(grantAction([{ wmkf_appuserappaccessid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }]), 'preserve_existing');
  assert.throws(() => grantAction([{}, {}]), /app_grant_not_unique/);
  assert.equal(classifyGrantReadback('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [
    { wmkf_appuserappaccessid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
  ]), 'created_confirmed');
  assert.equal(classifyGrantReadback('cccccccc-cccc-4ccc-8ccc-cccccccccccc', [
    { wmkf_appuserappaccessid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
  ]), 'write_outcome_unverified_no_retry');
  assert.equal(safeErrorCode({ message: 'body contains credential' }), 'unexpected_error');
  process.stdout.write('meeting_transcription_supervised_access_self_test_passed\n');
}

async function getActor(client) {
  const filter = `azureactivedirectoryobjectid eq ${IDENTITY.azureId}`;
  const response = await client.get(
    `/systemusers?$select=systemuserid,azureactivedirectoryobjectid,isdisabled&$filter=${encodeURIComponent(filter)}&$top=2`,
  );
  if (!response.ok) throw Object.assign(new Error('sandbox_actor_lookup_failed'), { code: `http_${response.status}` });
  if (response.body?.['@odata.nextLink']) throw new Error('sandbox_actor_result_capped');
  return validateActorRows(response.body?.value || []);
}

async function getGrantRows(client, actorId, appKey) {
  const filter = `_wmkf_user_value eq ${actorId} and wmkf_appkey eq '${appKey}'`;
  const response = await client.get(
    `/wmkf_appuserappaccesses?$select=wmkf_appuserappaccessid,wmkf_appkey,_wmkf_user_value&$filter=${encodeURIComponent(filter)}&$top=2`,
  );
  if (!response.ok) throw Object.assign(new Error('app_grant_lookup_failed'), { code: `http_${response.status}` });
  if (response.body?.['@odata.nextLink']) throw new Error('app_grant_result_capped');
  const rows = response.body?.value || [];
  if (rows.some((row) => row.wmkf_appkey !== appKey
      || String(row._wmkf_user_value || '').toLowerCase() !== actorId.toLowerCase()
      || !UUID_RE.test(row.wmkf_appuserappaccessid || ''))) {
    throw new Error('app_grant_query_result_mismatch');
  }
  return rows;
}

async function provisionGrant(client, actorId, appKey, grantResult) {
  const before = await getGrantRows(client, actorId, appKey);
  if (grantAction(before) === 'preserve_existing') {
    grantResult.status = 'preexisting_preserved';
    grantResult.rowCount = 1;
    return true;
  }

  const grantId = crypto.randomUUID();
  const body = {
    wmkf_appuserappaccessid: grantId,
    wmkf_appkey: appKey,
    'wmkf_User@odata.bind': `/systemusers(${actorId})`,
  };
  let postStatus = null;
  let postError = null;
  try {
    const response = await client.post('/wmkf_appuserappaccesses', body);
    postStatus = response.status;
    if (!response.ok) postError = `http_${response.status}`;
  } catch (error) {
    postError = safeErrorCode(error);
  }

  // Read back once to resolve the response; never retry a POST after an
  // ambiguous outcome. The client-generated id is retained for cleanup.
  let after;
  try { after = await getGrantRows(client, actorId, appKey); }
  catch {
    Object.assign(grantResult, { status: 'write_outcome_unverified_no_retry', grantId, postStatus });
    return false;
  }
  const readbackStatus = classifyGrantReadback(grantId, after);
  if (readbackStatus === 'created_confirmed') {
    Object.assign(grantResult, { status: readbackStatus, grantId, postStatus });
    return true;
  }
  Object.assign(grantResult, {
    status: readbackStatus,
    attemptedGrantId: grantId,
    ...(after.length === 1 ? { observedExistingGrantId: after[0].wmkf_appuserappaccessid } : {}),
    postStatus,
    safeError: postError,
  });
  return false;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) return selfTest();

  const inspectedProject = inspectDedicatedProject();
  const previewEnv = readEnvFile(options.envFile);
  const neonUrl = validatePreviewEnv(previewEnv, inspectedProject);
  const repoRoot = path.resolve(__dirname, '..');
  const localEnvPath = path.join(repoRoot, '.env.local');
  const localEnv = fs.existsSync(localEnvPath) ? readEnvFile(localEnvPath) : {};
  const credentials = chooseCredentials(previewEnv, localEnv);
  const priorProcessEnv = new Map();
  const scopedEnv = {
    ...credentials,
    DYNAMICS_URL,
    DATAVERSE_TARGET_INTERLOCK: 'on',
    DATAVERSE_ALLOW_PROD_READS: 'no',
    NODE_ENV: 'development',
    VERCEL_ENV: 'local',
  };
  for (const [key, value] of Object.entries(scopedEnv)) {
    priorProcessEnv.set(key, process.env[key]);
    process.env[key] = value;
  }

  const result = {
    mode: options.execute ? 'execute' : 'read_only',
    dynamicsTarget: DYNAMICS_HOST,
    neonProjectId: EXPECTED_NEON_PROJECT_ID,
    actorMatchCount: 0,
    profileId: null,
    profileMapping: null,
    superuserRolePresent: null,
    grants: [],
    partialSuccess: false,
  };
  const { Client } = require('pg');
  const db = new Client({
    ...createClientConfig(neonUrl),
    application_name: 'meeting-transcription-supervised-access-setup',
  });
  let transactionOpen = false;
  try {
    const { getAccessToken, createClient } = require('../lib/dataverse/client.js');
    const token = await getAccessToken(DYNAMICS_URL);
    const dataverse = createClient({ resourceUrl: DYNAMICS_URL, token });
    const actorId = await getActor(dataverse);
    result.actorMatchCount = 1;

    await db.connect();
    await db.query(options.execute ? 'BEGIN' : 'BEGIN READ ONLY');
    transactionOpen = true;
    const profileQuery = `SELECT id, name, display_name, azure_id, azure_email, is_active,
                                 needs_linking, dynamics_systemuser_id
                            FROM public.user_profiles
                           WHERE azure_id = $1
                           ORDER BY id
                           LIMIT 2${options.execute ? ' FOR UPDATE' : ''}`;
    const profileResponse = await db.query(profileQuery, [IDENTITY.azureId]);
    const profile = validateProfileRows(profileResponse.rows);
    result.profileId = profile.id;
    const mapping = profileMappingAction(profile.dynamics_systemuser_id, actorId);
    const roles = await db.query(
      'SELECT role FROM public.dynamics_user_roles WHERE user_profile_id = $1 ORDER BY role',
      [profile.id],
    );
    assertNoSuperuser(roles.rows);
    result.superuserRolePresent = false;

    for (const appKey of APP_KEYS) {
      const rows = await getGrantRows(dataverse, actorId, appKey);
      result.grants.push({ appKey, status: grantAction(rows) === 'create' ? 'missing' : 'preexisting_preserved', rowCount: rows.length });
    }

    if (options.execute) {
      if (mapping === 'map') {
        const updated = await db.query(
          `UPDATE public.user_profiles
              SET dynamics_systemuser_id = $1
            WHERE id = $2 AND azure_id = $3 AND is_active = TRUE
              AND needs_linking = FALSE AND dynamics_systemuser_id IS NULL
          RETURNING dynamics_systemuser_id`,
          [actorId, profile.id, IDENTITY.azureId],
        );
        if (updated.rowCount !== 1 || String(updated.rows[0].dynamics_systemuser_id).toLowerCase() !== actorId) {
          throw new Error('profile_mapping_cas_failed');
        }
        result.profileMapping = 'mapped_by_null_only_cas';
      } else {
        result.profileMapping = 'already_mapped_unchanged';
      }
      await db.query('COMMIT');
      transactionOpen = false;

      const verify = await db.query(
        'SELECT dynamics_systemuser_id FROM public.user_profiles WHERE id = $1 AND azure_id = $2 AND is_active = TRUE AND needs_linking = FALSE',
        [profile.id, IDENTITY.azureId],
      );
      if (verify.rowCount !== 1 || String(verify.rows[0].dynamics_systemuser_id || '').toLowerCase() !== actorId) {
        throw new Error('profile_mapping_readback_failed');
      }
      for (const appKey of APP_KEYS) {
        const grantResult = result.grants.find((grant) => grant.appKey === appKey);
        if (grantResult.status === 'preexisting_preserved') continue;
        const ok = await provisionGrant(dataverse, actorId, appKey, grantResult);
        if (!ok) {
          result.partialSuccess = true;
          break;
        }
      }
    } else {
      result.profileMapping = mapping === 'map' ? 'would_map_null_only' : 'already_mapped_unchanged';
      await db.query('ROLLBACK');
      transactionOpen = false;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.partialSuccess) process.exitCode = 2;
  } catch (error) {
    if (transactionOpen) await db.query('ROLLBACK').catch(() => {});
    result.partialSuccess = options.execute && (result.profileMapping === 'mapped_by_null_only_cas'
      || result.grants.some((grant) => ['created_confirmed', 'write_outcome_unverified_no_retry', 'write_not_confirmed_no_retry'].includes(grant.status)));
    result.error = safeErrorCode(error);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = 1;
  } finally {
    await db.end().catch(() => {});
    for (const [key, value] of priorProcessEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`meeting_transcription_supervised_access_failed:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  APP_KEYS,
  chooseCredentials,
  classifyGrantReadback,
  grantAction,
  parseArgs,
  profileMappingAction,
  selfTest,
  validateActorRows,
  validatePreviewEnv,
  validateProfileRows,
};
