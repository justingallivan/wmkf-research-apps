/**
 * Shared Executor trial ledger. Callers supply an isolated PostgreSQL pool and
 * establish authorization before using this server-side store. All external
 * work runs outside transactions; every checkpoint uses the live job lease.
 * Known-failure reservation release is limited to registered synthetic tasks in
 * the test environment. All other task reservations remain permanent, including
 * Summary; this retention rule does not grant admission or publication authority.
 */
import { authorizedTitleDestination, policyDestinationField } from './machine-destination.js';
import { createHash, randomUUID } from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { canonical, exact, hashProfile, MAX_PROFILE_RESPONSE_BYTES, MAX_PROFILE_RESULT_BYTES, MAX_PROFILE_SNAPSHOT_BYTES } from './profile.js';
import { isRecommendationSourceProof, isSandboxRecommendationSourceProof, recommendationSnapshotSourceProof } from './context.js';
import { matchesRecommendationsTrialDefinition, matchesRecommendationsTrialScope, readRecommendationsTrialPolicy, recommendationsTrialCommandHash,
  RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID, RECOMMENDATIONS_TRIAL_SECOND_JOB_ID, RECOMMENDATIONS_TRIAL_THIRD_JOB_ID } from './recommendations-sandbox-policy.js';
import { EXPERTISE_SANDBOX_SCOPE_PREFIX, EXPERTISE_TASK_KEY, getTaskCapability, isExpertiseFixtureScope, isExpertiseMachineScope, isExpertiseSandboxReadScope, isTaskEnabled, PROPOSAL_ENVIRONMENTS, PROPOSAL_TASK_KEYS, validateTaskCapability, validateTaskResult } from './capabilities.js';

import { activeMachinePilot, machinePilotScope, matchesMachinePilotScope, readMachinePilotPolicy } from './machine-pilot-policy.js';
import { MACHINE_TITLE_TASK, MACHINE_TITLE_RECORD_NAMES, machineTitleScope, validateMachineTitleProfile } from './machine-title-contract.js';

const SHA256 = /^[a-f0-9]{64}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const IDENTITY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;
const DAY_MS = 86_400_000;
const CONTENT_LIMITS = {
  configuration: 262_144,
  snapshot: MAX_PROFILE_SNAPSHOT_BYTES,
  response: MAX_PROFILE_RESPONSE_BYTES,
  result: MAX_PROFILE_RESULT_BYTES,
  audit: 65_536,
  publication: 1_048_576,
};

function fail(code, httpStatus = 409) {
  throw new ServiceHttpError(code, { code, httpStatus });
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function guid(value) {
  if (!isGuid(value)) fail('invalid_prompt_job_id', 400);
  return value.toLowerCase();
}

function encode(value, kind) {
  const payload = canonical(value);
  const size = Buffer.byteLength(payload);
  if (size > CONTENT_LIMITS[kind]) fail(kind === 'snapshot' ? 'snapshot_too_large' : 'invalid_prompt_job_content', 400);
  return { payload, size, hash: sha256(payload) };
}

async function putContent(client, jobId, kind, value, expiresAt) {
  const { payload, size, hash } = encode(value, kind);
  const { rows: [row] } = await client.query(
    `INSERT INTO prompt_job_content (job_id, kind, payload, sha256, size_bytes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, sha256`,
    [jobId, kind, payload, hash, size, expiresAt],
  );
  return row;
}

async function getContent(client, jobId, id, expectedHash, { expectedKind = null, expiresAt = null } = {}) {
  const { rows: [row] } = await client.query(
    `SELECT kind, payload, sha256, size_bytes FROM prompt_job_content
     WHERE job_id = $1 AND id = $2 AND expires_at > clock_timestamp()
       AND ($3::timestamptz IS NULL OR $3 > clock_timestamp())`, [jobId, id, expiresAt],
  );
  if (!row) return null;
  if ((expectedKind && (row.kind !== expectedKind || row.size_bytes > CONTENT_LIMITS[expectedKind]))
    || row.sha256 !== expectedHash
    || row.sha256 !== sha256(row.payload) || row.size_bytes !== Buffer.byteLength(row.payload)) {
    fail('prompt_job_content_integrity');
  }
  let parsed;
  try { parsed = JSON.parse(row.payload); }
  catch { fail('prompt_job_content_integrity'); }
  return parsed;
}

async function view(client, job) {
  const { rows: tasks } = await client.query(
    'SELECT * FROM prompt_job_tasks WHERE job_id = $1 ORDER BY task_key', [job.id],
  );
  const { rows: attempts } = await client.query(
    `SELECT a.* FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id = a.task_id
     WHERE t.job_id = $1 ORDER BY t.task_key, a.attempt_number`, [job.id],
  );
  const { rows: [publication] } = await client.query(
    'SELECT * FROM prompt_job_publications WHERE job_id = $1', [job.id],
  );
  const { lease_token: leaseToken, lease_expires_at: leaseExpiresAt, ...receipt } = job;
  return { job: receipt, tasks, attempts, publication: publication || null };
}

async function touch(client, jobId) {
  const { rows: [job] } = await client.query(
    'UPDATE prompt_jobs SET version = version + 1 WHERE id = $1 RETURNING *', [jobId],
  );
  const { lease_token: leaseToken, lease_expires_at: leaseExpiresAt, ...receipt } = job;
  return receipt;
}

async function releaseInitialization(client, jobId, taskId) {
  await client.query(
    `UPDATE prompt_job_initializations SET released_at = clock_timestamp()
     WHERE job_id = $1 AND task_id = $2 AND released_at IS NULL AND initially_blank IS DISTINCT FROM FALSE
       AND NOT EXISTS (SELECT 1 FROM prompt_job_publications WHERE job_id = $1)`,
    [jobId, taskId],
  );
}

async function publicationOutcome(client, publication, state) {
  const { rows: [row] } = await client.query(
    'UPDATE prompt_job_publications SET state = $2 WHERE id = $1 RETURNING *', [publication.id, state],
  );
  await client.query(
    'UPDATE prompt_job_tasks SET writeback_state = $3 WHERE job_id = $1 AND id = ANY($2::uuid[])',
    [publication.job_id, publication.task_ids, state],
  );
  return row;
}

async function clearLease(client, jobId) {
  await client.query(
    `UPDATE prompt_job_attempts a SET audit_state = 'unknown'
     FROM prompt_job_tasks t WHERE t.id = a.task_id AND t.job_id = $1 AND a.audit_state = 'dispatching'`, [jobId],
  );
  await client.query(
    `UPDATE prompt_job_attempts a SET state = 'unknown', error_code = 'provider_outcome_unknown'
     FROM prompt_job_tasks t WHERE t.id = a.task_id AND t.job_id = $1 AND a.state = 'dispatching'`, [jobId],
  );
  await client.query(
    `UPDATE prompt_job_tasks SET state = 'unknown', error_code = 'provider_outcome_unknown'
     WHERE job_id = $1 AND state = 'dispatching'`, [jobId],
  );
  const { rows: [publication] } = await client.query(
    "SELECT * FROM prompt_job_publications WHERE job_id = $1 AND state = 'dispatching'", [jobId],
  );
  if (publication) await publicationOutcome(client, publication, 'unknown');
  await client.query(
    'UPDATE prompt_jobs SET lease_token = NULL, lease_expires_at = NULL, version = version + 1 WHERE id = $1',
    [jobId],
  );
}

function isIdentity(value) {
  return typeof value === 'string' && IDENTITY.test(value);
}

function readScope({ environment, principalKey, authorizationScope, requestId }) {
  if (!isIdentity(environment) || environment.length > 32 || !isIdentity(principalKey) || !isIdentity(authorizationScope)) {
    fail('invalid_prompt_job_read_scope', 400);
  }
  return [environment, principalKey, authorizationScope, guid(requestId)];
}

function validateAdmission({ environment, principalKey, authorizationScope, operation, sourceEventId, tasks }) {
  const proposal = PROPOSAL_ENVIRONMENTS.includes(environment);
  if ((!proposal && environment !== 'test') || !isIdentity(principalKey) || !isIdentity(authorizationScope)
    || authorizationScope.startsWith('pa-short-title:')
    || !['initialize', 'generate-draft'].includes(operation)
    || (sourceEventId != null && !isIdentity(sourceEventId))
    || (operation === 'initialize' && !sourceEventId)
    || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8
    || tasks.some(task => typeof task?.taskKey !== 'string' || task.taskKey === MACHINE_TITLE_TASK || !isTaskEnabled(task.taskKey, { environment, authorizationScope }))
    || new Set(tasks.map(task => task.taskKey)).size !== tasks.length) {
    fail('invalid_prompt_job_admission', 400);
  }
  if (isExpertiseFixtureScope({ environment, authorizationScope })
    && (operation !== 'generate-draft' || sourceEventId != null || tasks.length !== 1 || tasks[0].taskKey !== EXPERTISE_TASK_KEY)) {
    fail('invalid_prompt_job_admission', 400);
  }
  if (proposal && (operation !== 'generate-draft' || tasks.length !== PROPOSAL_TASK_KEYS.length
    || tasks.some(task => !PROPOSAL_TASK_KEYS.includes(task.taskKey)))) {
    fail('invalid_prompt_job_admission', 400);
  }
  return proposal;
}

function scopeMatches(scope, { environment, request_id: requestId, authorization_scope: authorizationScope }) {
  return scope?.environment === environment && scope.requestId === requestId && scope.authorizationScope === authorizationScope;
}

function validateNewJob(input, requestId, trial) {
  const { environment, authorizationScope, tasks, sourceExpiresAt, resultExpiresAt } = input;
  const source = new Date(sourceExpiresAt);
  const result = new Date(resultExpiresAt);
  const now = Date.now();
  if (!(source.getTime() > now && result.getTime() >= source.getTime()
    && source.getTime() <= now + (trial ? 1 : 7) * DAY_MS && result.getTime() <= now + (trial ? 7 : 30) * DAY_MS)) {
    fail('invalid_prompt_job_configuration', 400);
  }
  const frozen = tasks.map(task => {
    const { taskKey, configuration } = task;
    const { promptRow, profile, scope } = configuration || {};
    let { destinationField, resultContract } = getTaskCapability(taskKey);
    if (!scopeMatches(scope, { environment, request_id: requestId, authorization_scope: authorizationScope })
      || promptRow?.wmkf_ai_promptname !== taskKey
      || (task.destinationField != null && taskKey !== MACHINE_TITLE_TASK && task.destinationField !== destinationField)) {
      fail('invalid_prompt_job_configuration', 400);
    }
    let profileHash;
    let promptHash;
    let spec;
    try {
      profileHash = hashProfile(profile);
      promptHash = sha256(canonical(promptRow));
      if (trial) exact(scope, ['environment', 'authorizationScope', 'requestId'], 'recommendations trial scope');
      ({ spec, destinationField } = validateTaskCapability(promptRow, scope, { definitionOnly: Boolean(trial), profile }));
      if (task.destinationField != null && task.destinationField !== destinationField) throw new Error('destination mismatch');
      if (resultContract) {
        exact(configuration, ['promptRow', 'profile', 'scope', 'runSource', 'rosterHash', 'sourceProof'], 'recommendations configuration');
        if (!SHA256.test(configuration.rosterHash || '') || typeof configuration.runSource !== 'string'
          || (trial ? (!isSandboxRecommendationSourceProof(configuration.sourceProof) || configuration.sourceProof.hash !== trial.sourceHash
            || configuration.runSource !== 'Vercel Test' || promptHash !== trial.promptHash
            || !Number.isSafeInteger(promptRow.wmkf_promptversion) || promptRow.wmkf_promptversion < 1
            || !matchesRecommendationsTrialDefinition(promptRow, profile, trial))
            : (Object.hasOwn(configuration, 'sourceProof') && !isRecommendationSourceProof(configuration.sourceProof)))
          || profile.recordNames.length !== 1 || profile.recordNames[0] !== 'roster_block') {
          throw new Error('invalid recommendations configuration');
        }
      }
    } catch {
      fail('invalid_prompt_job_configuration', 400);
    }
    const model = promptRow.wmkf_ai_model;
    if (spec?.profile.sha256 !== profileHash || spec.profile.key !== profile.key || spec.profile.revision !== profile.revision
      || (task.model != null && task.model !== model) || (task.profileHash != null && task.profileHash !== profileHash)
      || (task.promptHash != null && task.promptHash !== promptHash)) fail('invalid_prompt_job_configuration', 400);
    return { taskKey, destinationField, configuration, model, promptHash, profileHash };
  });
  if (frozen.some(task => task.profileHash !== frozen[0].profileHash)) fail('invalid_prompt_job_configuration', 400);
  return { source, result, frozen };
}

function machineJobScope(job) {
  return { environment: job.environment, requestId: job.request_id, principalKey: job.principal_key,
    authorizationScope: job.authorization_scope };
}

function matchesMachineJob(job, policy) {
  return matchesMachinePilotScope(machineJobScope(job), policy)
    && job.operation === 'initialize' && job.source_event_id === policy.sourceEventId;
}

function validateMachineConfiguration(configuration, policy) {
  try {
    exact(configuration, ['promptRow', 'profile', 'manifest'], 'Short Title configuration');
    const { promptRow, profile, manifest } = configuration;
    exact(manifest, ['version', 'requestId', 'hash'], 'Short Title source manifest');
    validateMachineTitleProfile(profile);
    authorizedTitleDestination(promptRow, policy);
    if (manifest.version !== 'request-title-abstract-v1' || manifest.requestId !== policy.requestId
      || typeof manifest.hash !== 'string' || !SHA256.test(manifest.hash)
      || promptRow?.wmkf_ai_promptid !== policy.promptId || promptRow?.wmkf_promptversion !== policy.promptVersion
      || hashProfile(profile) !== policy.profileHash || sha256(canonical(promptRow)) !== policy.promptHash) {
      throw new Error('Short Title configuration pin mismatch');
    }
  } catch {
    fail('machine_pilot_configuration', 503);
  }
}

function machineSnapshotMatches(snapshot, manifest) {
  return snapshot?.version === 1 && Array.isArray(snapshot.documents) && snapshot.documents.length === 0
    && !Object.hasOwn(snapshot, 'rosterSnapshot') && Array.isArray(snapshot.records)
    && snapshot.records.length === MACHINE_TITLE_RECORD_NAMES.length
    && MACHINE_TITLE_RECORD_NAMES.every((name, index) => {
      const record = snapshot.records[index];
      return record?.name === name && record.present === true && typeof record.value === 'string';
    })
    && sha256(canonical(snapshot.records)) === manifest.hash;
}

async function assertTrialDatabase(client, expectedIdentity) {
  if (typeof expectedIdentity !== 'string' || expectedIdentity.length !== 64 || !SHA256.test(expectedIdentity)) {
    fail('recommendations_trial_database_mismatch');
  }
  const { rows: [row] } = await client.query(
    'SELECT current_database() AS database_name, system_identifier::text FROM pg_catalog.pg_control_system()',
  );
  if (!row || sha256(canonical([row.system_identifier, row.database_name])) !== expectedIdentity) {
    fail('recommendations_trial_database_mismatch');
  }
}

const SANDBOX_TRIAL_HISTORY = [
  [RECOMMENDATIONS_TRIAL_PREDECESSOR_JOB_ID, 'profile_output_invalid'],
  [RECOMMENDATIONS_TRIAL_SECOND_JOB_ID, 'claude_output_truncated'],
  [RECOMMENDATIONS_TRIAL_THIRD_JOB_ID, 'profile_output_invalid'],
];

/** Called under the unchanged Sandbox-wide advisory transaction lock. */
async function assertSandboxTrialAdmission(client, trial) {
  const { rows: jobs } = await client.query(
    `SELECT j.* FROM prompt_jobs j WHERE j.environment IN ('local-sandbox','preview-sandbox')
       AND EXISTS (SELECT 1 FROM prompt_job_tasks t WHERE t.job_id = j.id AND t.task_key = $1) LIMIT 4`,
    [EXPERTISE_TASK_KEY],
  );
  const required = trial.predecessorJobId
    ? SANDBOX_TRIAL_HISTORY.findIndex(([id]) => id === trial.predecessorJobId) + 1 : 0;
  if ((trial.predecessorJobId && !required) || jobs.length !== required) fail('prompt_job_trial_limit');
  for (let index = 0; index < required; index++) {
    const [id, expectedError] = SANDBOX_TRIAL_HISTORY[index];
    await assertSandboxTrialPredecessor(client, jobs.find(job => job.id === id), trial, expectedError,
      SANDBOX_TRIAL_HISTORY[index - 1]?.[0]);
  }
}

async function assertSandboxTrialPredecessor(client, job, trial, expectedError, priorPredecessorId) {
  if (!job || job.environment !== trial.environment
    || job.request_id !== trial.requestId || job.principal_key !== trial.principalKey
    || job.operation !== 'generate-draft' || job.idempotency_key === trial.idempotencyKey
    || job.authorization_scope === trial.authorizationScope
    || !isExpertiseSandboxReadScope({environment:job.environment, principalKey:job.principal_key, authorizationScope:job.authorization_scope})) {
    fail('prompt_job_trial_limit');
  }
  const { rows } = await client.query(
    `SELECT t.*, a.state AS attempt_state, a.error_code AS attempt_error_code, a.attempt_number, a.audit_state
     FROM prompt_job_tasks t LEFT JOIN prompt_job_attempts a ON a.task_id = t.id
     WHERE t.job_id = $1 LIMIT 2`, [job.id],
  );
  const [task] = rows;
  if (rows.length !== 1 || task.task_key !== EXPERTISE_TASK_KEY || task.state !== 'failed_validation'
    || task.error_code !== expectedError || task.destination_field !== null || task.writeback_state !== 'not_requested'
    || task.attempt_number !== 1 || task.attempt_state !== 'failed_validation'
    || task.attempt_error_code !== expectedError || task.audit_state !== 'delivered'
    || task.prompt_hash === trial.promptHash || task.profile_hash !== trial.profileHash) {
    fail('prompt_job_trial_limit');
  }
  const priorConfig = await getContent(client, job.id, task.configuration_content_id, task.configuration_hash,
    { expectedKind: 'configuration', expiresAt: job.result_expires_at });
  const priorPrompt = priorConfig?.promptRow;
  if (!priorPrompt || !scopeMatches(priorConfig.scope, job) || priorConfig.runSource !== 'Vercel Test'
    || !isSandboxRecommendationSourceProof(priorConfig.sourceProof) || priorConfig.sourceProof.hash !== trial.sourceHash
    || priorPrompt.wmkf_ai_promptid === trial.promptId) fail('prompt_job_trial_limit');

  // Rebuild the original grant fingerprint from its receipt and the exact
  // bindings shared with the proposed successor (including actor and database).
  const { predecessorJobId, ...shared } = trial;
  const original = {
    ...shared, ...(priorPredecessorId ? { predecessorJobId: priorPredecessorId } : {}),
    authorizationScope: job.authorization_scope,
    scopeId: job.authorization_scope.slice(EXPERTISE_SANDBOX_SCOPE_PREFIX.length),
    idempotencyKey: job.idempotency_key, promptId: priorPrompt.wmkf_ai_promptid, promptHash: task.prompt_hash,
  };
  if (recommendationsTrialCommandHash(original) !== job.payload_hash
    || !matchesRecommendationsTrialDefinition(priorPrompt, priorConfig.profile, original)) fail('prompt_job_trial_limit');
}

export function createPromptJobStore(pool, {
  readMachinePolicy = readMachinePilotPolicy, machineDatabaseEndpoint,
} = {}) {
  async function transaction(work, readOnly = false) {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function withLease(jobId, leaseToken, work) {
    return transaction(async client => {
      const id = guid(jobId);
      const token = guid(leaseToken);
      await client.query('SELECT id FROM prompt_jobs WHERE id = $1 FOR UPDATE', [id]);
      const { rows: [job] } = await client.query(
        'SELECT * FROM prompt_jobs WHERE id = $1 AND lease_token = $2 AND lease_expires_at > clock_timestamp()',
        [id, token],
      );
      return job ? work(client, job) : null;
    });
  }

  async function verifySandboxRecommendationDatabase() {
    const trial = readRecommendationsTrialPolicy();
    if (!trial) fail('recommendations_trial_disabled', 404);
    return transaction(client => assertTrialDatabase(client, trial.databaseIdentity), true);
  }

  function machinePolicy({ allowInactive = false } = {}) {
    const policy = readMachinePolicy();
    if (!policy || (!allowInactive && !activeMachinePilot(policy))) fail('machine_pilot_unavailable', 503);
    if (!machineDatabaseEndpoint || machineDatabaseEndpoint !== policy.databaseEndpoint) fail('machine_pilot_database_mismatch', 503);
    return policy;
  }

  function assertMachineCurrent(policy, allowInactive = false) {
    if (canonical(machinePolicy({ allowInactive })) !== canonical(policy)) fail('machine_pilot_unavailable', 503);
  }

  async function assertMachineDatabase(client, policy) {
    try {
      const { rows: [row] } = await client.query(
        'SELECT current_database() AS database_name, system_identifier::text FROM pg_catalog.pg_control_system()',
      );
      if (row && sha256(canonical([machineDatabaseEndpoint, row.system_identifier, row.database_name])) === policy.databaseIdentity) return;
    } catch {
      // A role that cannot read the identity may not use this pilot.
    }
    fail('machine_pilot_database_mismatch', 503);
  }

  async function verifyMachineTitleDatabase({ allowInactive = false } = {}) {
    const policy = machinePolicy({ allowInactive });
    await transaction(async client => {
      await assertMachineDatabase(client, policy);
      assertMachineCurrent(policy, allowInactive);
    }, true);
    assertMachineCurrent(policy, allowInactive);
    return policy;
  }

  async function admitMachineTitle(input, { loadConfiguration, assertCurrent = () => {} } = {}) {
    const policy = machinePolicy();
    if (!machineTitleScope(input) || !matchesMachinePilotScope(input, policy)
      || input.operation !== 'initialize' || input.sourceEventId !== policy.sourceEventId
      || !Array.isArray(input.tasks) || input.tasks.length !== 1 || input.tasks[0]?.taskKey !== MACHINE_TITLE_TASK
      || typeof loadConfiguration !== 'function' || typeof assertCurrent !== 'function') fail('invalid_prompt_job_admission', 400);
    const command = {
      ...machinePilotScope(policy),
      operation: 'initialize', sourceEventId: policy.sourceEventId, idempotencyKey: guid(input.idempotencyKey),
      tasks: [{ taskKey: MACHINE_TITLE_TASK }],
    };
    const machine = { policy, assertCurrent };
    const existing = await admitJob(command, null, machine, true);
    assertCurrent();
    assertMachineCurrent(policy);
    if (existing) return existing;
    let configuration;
    try { configuration = await loadConfiguration(); }
    catch (error) {
      // Another request may have admitted this job while this caller's source
      // was loading. Recover that receipt before reporting a mutable-source error.
      const replay = await admitJob(command, null, machine, true);
      assertCurrent();
      assertMachineCurrent(policy);
      if (replay) return replay;
      throw error;
    }
    assertCurrent();
    assertMachineCurrent(policy);
    const result = await admitJob(command, null, { ...machine, configuration });
    assertCurrent();
    assertMachineCurrent(policy);
    return result;
  }

  async function requireMachineTask(client, job, task) {
    const policy = machinePolicy();
    if (!machineTitleScope(machineJobScope(job)) || !matchesMachineJob(job, policy)
      || task.task_key !== MACHINE_TITLE_TASK || task.destination_field !== policyDestinationField(policy)
      || task.prompt_hash !== policy.promptHash || task.profile_hash !== policy.profileHash) {
      fail('machine_pilot_unavailable', 503);
    }
    await assertMachineDatabase(client, policy);
    const config = await getContent(client, job.id, task.configuration_content_id, task.configuration_hash, { expectedKind: 'configuration' });
    if (!config || config.policyHash !== sha256(canonical(policy)) || config.runSource !== 'PowerAutomate Test'
      || !scopeMatches(config.scope, job)) fail('machine_pilot_unavailable', 503);
    validateMachineConfiguration({ promptRow: config.promptRow, profile: config.profile, manifest: config.manifest }, policy);
    if (task.destination_field !== authorizedTitleDestination(config.promptRow, policy)) fail('prompt_job_content_integrity');
    assertMachineCurrent(policy);
    return { policy, config };
  }

  async function admit(input) {
    return admitJob(input, null);
  }

  async function admitSandboxRecommendation(input) {
    const trial = readRecommendationsTrialPolicy();
    if (!matchesRecommendationsTrialScope(input, trial) || input.principalKey !== trial.principalKey
      || input.idempotencyKey !== trial.idempotencyKey || input.operation !== 'generate-draft'
      || input.sourceEventId != null || !Array.isArray(input.tasks) || input.tasks.length !== 1
      || input.tasks[0]?.taskKey !== EXPERTISE_TASK_KEY) fail('invalid_prompt_job_admission', 400);
    return admitJob(input, trial);
  }

  async function admitJob(input, trial, machine = null, probeOnly = false) {
    const proposal = !trial && !machine && validateAdmission(input);
    const { environment, principalKey, authorizationScope, operation, tasks, sourceEventId = null } = input;
    const requestId = guid(input.requestId);
    const idempotencyKey = guid(input.idempotencyKey);
    const taskKeys = tasks.map(task => task.taskKey).sort();
    const hash = trial ? recommendationsTrialCommandHash(trial)
      : sha256(canonical({ requestId, authorizationScope, operation, sourceEventId, taskKeys }));
    return transaction(async client => {
      if (machine) {
        machine.assertCurrent();
        assertMachineCurrent(machine.policy);
        await assertMachineDatabase(client, machine.policy);
      }
      if (proposal || trial || machine) {
        // The cohort spans deployments and principals. Take its lock before the
        // same per-Request advisory key that claim() uses.
        const cohortLock = trial ? ['expertise-recommendations-sandbox-singleton'] : ['prompt-job-cohort', authorizationScope];
        for (const lock of [cohortLock, [environment, requestId]]) {
          await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [JSON.stringify(lock)]);
        }
      }
      const find = async () => (await client.query(
        'SELECT * FROM prompt_jobs WHERE environment = $1 AND principal_key = $2 AND idempotency_key = $3 FOR SHARE',
        [environment, principalKey, idempotencyKey],
      )).rows[0];
      const replay = async job => {
        if (job.payload_hash !== hash) fail('prompt_job_idempotency_key_reused');
        return { ...(await view(client, job)), replayed: true };
      };
      if (trial) {
        if (canonical(readRecommendationsTrialPolicy()) !== canonical(trial)) fail('invalid_prompt_job_admission', 400);
        await assertTrialDatabase(client, trial.databaseIdentity);
      }
      const previous = await find();
      if (previous) {
        if (machine && !matchesMachineJob(previous, machine.policy)) fail('prompt_job_idempotency_key_reused');
        return replay(previous);
      }
      if (proposal || machine) {
        const { rowCount } = await client.query('SELECT id FROM prompt_jobs WHERE authorization_scope = $1 LIMIT 1', [authorizationScope]);
        if (rowCount) fail('prompt_job_trial_limit', machine ? 429 : 409);
      }
      if (probeOnly) return null;
      if (trial) await assertSandboxTrialAdmission(client, trial);
      let admission = input;
      if (machine) {
        const { policy, configuration } = machine;
        validateMachineConfiguration(configuration, policy);
        const now = Date.now();
        admission = {
          ...input, sourceExpiresAt: new Date(now + DAY_MS), resultExpiresAt: new Date(now + 7 * DAY_MS),
          tasks: [{ taskKey: MACHINE_TITLE_TASK, configuration: {
            ...JSON.parse(canonical(configuration)), scope: { environment, requestId, authorizationScope },
            runSource: 'PowerAutomate Test', policyHash: sha256(canonical(policy)),
          } }],
        };
      }
      const { source, result, frozen } = validateNewJob(admission, requestId, trial);
      if (machine) {
        machine.assertCurrent();
        assertMachineCurrent(machine.policy);
      }
      if (trial && canonical(readRecommendationsTrialPolicy()) !== canonical(trial)) fail('invalid_prompt_job_admission', 400);
      const { rows: [job] } = await client.query(
        `INSERT INTO prompt_jobs (environment, principal_key, authorization_scope, request_id, idempotency_key, payload_hash,
           operation, source_event_id, source_expires_at, result_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (environment, principal_key, idempotency_key) DO NOTHING RETURNING *`,
        [environment, principalKey, authorizationScope, requestId, idempotencyKey, hash, operation, sourceEventId, source, result],
      );
      if (!job) return replay(await find());

      // Stable field order prevents inverted slot acquisition across jobs.
      const ordered = frozen.sort((a, b) => (a.destinationField ?? a.taskKey).localeCompare(b.destinationField ?? b.taskKey));
      for (const task of ordered) {
        // Delayed audit delivery still verifies the frozen prompt identity.
        const configuration = await putContent(client, job.id, 'configuration', task.configuration, result);
        const { rows: [row] } = await client.query(
          `INSERT INTO prompt_job_tasks (job_id, task_key, destination_field, prompt_hash, profile_hash, model,
             configuration_content_id, configuration_hash, writeback_state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [job.id, task.taskKey, operation === 'initialize' ? task.destinationField : null, task.promptHash,
            task.profileHash, task.model, configuration.id, configuration.sha256,
            operation === 'initialize' ? 'pending' : 'not_requested'],
        );
        if (operation === 'initialize') {
          const slot = await client.query(
            `INSERT INTO prompt_job_initializations (job_id, task_id, environment, request_id, destination_field)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (environment, request_id, destination_field) WHERE released_at IS NULL DO NOTHING RETURNING id`,
            [job.id, row.id, environment, requestId, task.destinationField],
          );
          if (!slot.rowCount) fail('prompt_job_initialization_reserved');
        }
      }
      const receipt = await view(client, job);
      if (machine) {
        machine.assertCurrent();
        assertMachineCurrent(machine.policy);
      }
      return { ...receipt, replayed: false };
    });
  }

  async function readJob({ jobId, environment, principalKey }) {
    return transaction(async client => {
      const { rows: [job] } = await client.query(
        'SELECT * FROM prompt_jobs WHERE id = $1 AND environment = $2 AND principal_key = $3',
        [guid(jobId), environment, principalKey],
      );
      return job ? view(client, job) : null;
    }, true);
  }

  // Caller reauthorizes the Request. These internal views carry no content and
  // need an explicit safe projection before they become an HTTP response.
  async function listJobs({ limit = 5, ...scope }) {
    const identity = readScope(scope);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) fail('invalid_prompt_job_list_limit', 400);
    return transaction(async client => {
      const { rows } = await client.query(
        `SELECT * FROM prompt_jobs
         WHERE environment = $1 AND principal_key = $2 AND authorization_scope = $3 AND request_id = $4
         ORDER BY created_at DESC, id DESC LIMIT $5`, [...identity, limit],
      );
      const jobs = [];
      for (const job of rows) jobs.push(await view(client, job));
      return jobs;
    }, true);
  }

  async function readTaskResults({ jobId, ...scope }, structured) {
    const identity = readScope(scope);
    return transaction(async client => {
      const { rows: [job] } = await client.query(
        `SELECT id, version, result_expires_at FROM prompt_jobs
         WHERE environment = $1 AND principal_key = $2 AND authorization_scope = $3 AND request_id = $4 AND id = $5`,
        [...identity, guid(jobId)],
      );
      if (!job) return null;
      const { rows } = await client.query(
        `SELECT id, task_key, result_content_id, result_hash FROM prompt_job_tasks
         WHERE job_id = $1 AND state = 'validated' ORDER BY task_key`, [job.id],
      );
      const results = [];
      for (const task of rows) {
        const capability = getTaskCapability(task.task_key);
        if (!capability) fail('prompt_job_content_integrity');
        if (Boolean(capability.resultContract) !== structured) continue;
        const value = await getContent(client, job.id, task.result_content_id, task.result_hash, {
          expectedKind: 'result', expiresAt: job.result_expires_at,
        });
        const taskIdentity = { taskId: task.id, taskKey: task.task_key };
        if (value === null) {
          results.push({ ...taskIdentity, status: 'expired' });
          continue;
        }
        try { validateTaskResult(task.task_key, value); }
        catch { fail('prompt_job_content_integrity'); }
        results.push({ ...taskIdentity, status: 'available', ...(structured ? value : { text: value }) });
      }
      return { jobId: job.id, version: Number(job.version), expiresAt: job.result_expires_at, results };
    }, true);
  }

  function readValidatedResults(input) {
    return readTaskResults(input, false);
  }

  // Owner-scoped internal view. A staff result facade must separately authorize
  // and prove current inputs before serving the structured result to a client.
  async function readValidatedRecommendations(input) {
    if (!isExpertiseFixtureScope(input)) return null;
    return readTaskResults(input, true);
  }

  async function readValidatedSandboxRecommendations(input) {
    if (!isExpertiseSandboxReadScope(input)) return null;
    return readTaskResults(input, true);
  }

  /** Metadata and optional retained freshness proof, scoped to one machine draft. */
  async function readRecommendationStateFor({ jobId, ...scope }, { includeProof = false } = {}, sandbox) {
    if (!(sandbox ? isExpertiseSandboxReadScope(scope) : isExpertiseMachineScope(scope))) return null;
    const identity = readScope(scope);
    return transaction(async client => {
      const { rows: [row] } = await client.query(
        `SELECT j.id, j.request_id, j.version, j.result_expires_at, clock_timestamp() AS observed_at,
                t.id AS task_id, t.state, t.profile_hash, t.prompt_hash, t.model, t.configuration_content_id, t.configuration_hash, t.result_hash,
                cfg.expires_at AS configuration_expires_at, res.expires_at AS content_expires_at
         FROM prompt_jobs j JOIN prompt_job_tasks t ON t.job_id = j.id
         LEFT JOIN prompt_job_content cfg ON cfg.id = t.configuration_content_id AND cfg.job_id = j.id
         LEFT JOIN prompt_job_content res ON res.id = t.result_content_id AND res.job_id = j.id
         WHERE j.environment = $1 AND j.principal_key = $2 AND j.authorization_scope = $3 AND j.request_id = $4 AND j.id = $5
           AND j.operation = 'generate-draft' AND t.task_key = $6 AND t.destination_field IS NULL AND t.writeback_state = 'not_requested'
           AND NOT EXISTS (SELECT 1 FROM prompt_job_tasks other WHERE other.job_id = j.id AND other.id <> t.id)`,
        [...identity, guid(jobId), EXPERTISE_TASK_KEY],
      );
      if (!row) return null;
      const receipt = {
        jobId: row.id, requestId: row.request_id, taskId: row.task_id, state: row.state, version: Number(row.version),
        expiresAt: new Date(row.result_expires_at).toISOString(), observedAt: new Date(row.observed_at).getTime(),
        resultExpiresAt: row.content_expires_at ? new Date(row.content_expires_at).getTime() : null,
        configurationExpiresAt: row.configuration_expires_at ? new Date(row.configuration_expires_at).getTime() : null,
        configurationHash: row.configuration_hash, resultHash: row.result_hash,
      };
      if (!includeProof || receipt.state !== 'validated' || receipt.resultExpiresAt === null || receipt.resultExpiresAt <= receipt.observedAt
        || receipt.configurationExpiresAt === null || receipt.configurationExpiresAt <= receipt.observedAt
        || Date.parse(receipt.expiresAt) <= receipt.observedAt) return receipt;
      let configuration;
      try {
        configuration = await getContent(client, row.id, row.configuration_content_id, row.configuration_hash, {
          expectedKind: 'configuration', expiresAt: row.result_expires_at,
        });
      } catch (error) {
        if (error?.code !== 'prompt_job_content_integrity') throw error;
        return receipt;
      }
      const validProof = sandbox ? isSandboxRecommendationSourceProof : isRecommendationSourceProof;
      const roles = configuration?.profile?.documentRoles;
      if (!validProof(configuration?.sourceProof) || !SHA256.test(configuration?.rosterHash || '')
        || !Array.isArray(roles) || (sandbox && (roles.length !== 1 || roles[0] !== 'proposal'))) return receipt;
      if (sandbox) {
        try {
          const { profile, promptRow } = configuration;
          const { spec } = validateTaskCapability(promptRow, null, { definitionOnly: true });
          exact(configuration.scope, ['environment', 'authorizationScope', 'requestId'], 'sandbox recommendations scope');
          if (!scopeMatches(configuration.scope, { environment: scope.environment, request_id: row.request_id, authorization_scope: scope.authorizationScope })
            || promptRow.wmkf_ai_promptname !== EXPERTISE_TASK_KEY || promptRow.wmkf_ai_model !== row.model
            || sha256(canonical(promptRow)) !== row.prompt_hash || spec.profile.sha256 !== row.profile_hash
            || spec.profile.key !== profile.key || spec.profile.revision !== profile.revision || hashProfile(profile) !== row.profile_hash) return receipt;
        } catch { return receipt; }
      }
      return { ...receipt, proof: {
        source: configuration.sourceProof, rosterHash: configuration.rosterHash, documentRoles: configuration.profile.documentRoles,
      } };
    }, true);
  }

  function readRecommendationState(input, options) {
    return readRecommendationStateFor(input, options, false);
  }

  function readSandboxRecommendationState(input, options) {
    return readRecommendationStateFor(input, options, true);
  }

  async function findRunnableJob(scope) {
    const identity = readScope(scope);
    return transaction(async client => {
      const { rows: [job] } = await client.query(
        `SELECT j.id FROM prompt_jobs j
         WHERE j.environment = $1 AND j.principal_key = $2 AND j.authorization_scope = $3 AND j.request_id = $4
           AND j.operation = 'generate-draft'
           AND (j.lease_token IS NULL OR j.lease_expires_at <= clock_timestamp())
           AND NOT EXISTS (
             SELECT 1 FROM prompt_job_tasks t LEFT JOIN prompt_job_attempts a ON a.task_id = t.id
             WHERE t.job_id = j.id AND (t.state = 'unknown' OR a.audit_state IN ('failed', 'unknown'))
           )
           AND EXISTS (
             SELECT 1 FROM prompt_job_tasks t LEFT JOIN prompt_job_attempts a ON a.task_id = t.id
             WHERE t.job_id = j.id AND (t.state IN ('queued', 'response_saved') OR a.audit_state = 'pending'
               OR (j.lease_token IS NOT NULL AND (t.state = 'dispatching' OR a.audit_state = 'dispatching')))
           )
         ORDER BY j.created_at, j.id LIMIT 1`, identity,
      );
      return job || null;
    }, true);
  }

  async function claim({ jobId, leaseMs = 30_000 }) {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 300_000) fail('invalid_prompt_job_lease', 400);
    return transaction(async client => {
      const { rows: [job] } = await client.query(
        'SELECT * FROM prompt_jobs WHERE id = $1', [guid(jobId)],
      );
      if (!job) return null;
      const scope = [job.environment, job.request_id];
      const { rows: [lock] } = await client.query(
        'SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS acquired', [JSON.stringify(scope)],
      );
      if (!lock.acquired) return null;

      const { rows: active } = await client.query(
        `SELECT id FROM prompt_jobs WHERE environment = $1 AND request_id = $2 AND lease_token IS NOT NULL
         FOR UPDATE SKIP LOCKED`, scope,
      );
      for (const held of active) {
        const { rows: [lease] } = await client.query(
          'SELECT lease_expires_at > clock_timestamp() AS live FROM prompt_jobs WHERE id = $1', [held.id],
        );
        if (lease.live) return null;
        await clearLease(client, held.id);
      }
      const { rows: [blocked] } = await client.query(
        `SELECT id FROM prompt_jobs j WHERE environment = $1 AND request_id = $2
         AND (lease_token IS NOT NULL OR (id <> $3 AND (
           EXISTS (SELECT 1 FROM prompt_job_tasks t WHERE t.job_id = j.id AND t.state = 'unknown')
           OR EXISTS (SELECT 1 FROM prompt_job_publications p WHERE p.job_id = j.id AND p.state = 'unknown')
         ))) LIMIT 1`, [...scope, job.id],
      );
      if (blocked) return null;
      const leaseToken = randomUUID();
      const { rows: [claimed] } = await client.query(
        `UPDATE prompt_jobs SET lease_token = $2, lease_expires_at = clock_timestamp() + $3 * interval '1 millisecond'
         WHERE id = $1 RETURNING *`, [job.id, leaseToken, leaseMs],
      );
      return { ...(await view(client, claimed)), leaseToken, lease_expires_at: claimed.lease_expires_at };
    });
  }

  async function releaseClaim({ jobId, leaseToken }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      await clearLease(client, job.id);
      return true;
    });
  }

  async function saveSnapshot({ jobId, leaseToken, snapshot }) {
    const { hash } = encode(snapshot, 'snapshot');
    return withLease(jobId, leaseToken, async (client, job) => {
      if (job.snapshot_content_id) {
        if (job.snapshot_hash !== hash) fail('prompt_job_snapshot_frozen');
        return (await view(client, job)).job;
      }
      if (job.source_expires_at <= new Date()) fail('prompt_job_source_expired');
      const { rows } = await client.query('SELECT task_key, destination_field, prompt_hash, profile_hash, configuration_content_id, configuration_hash FROM prompt_job_tasks WHERE job_id = $1', [job.id]);
      if (!scopeMatches(snapshot?.scope, job) || !rows.length || rows.some(row => row.profile_hash !== snapshot.profileHash)) {
        fail('invalid_prompt_job_snapshot', 400);
      }
      const title = rows.find(row => row.task_key === MACHINE_TITLE_TASK);
      const expertise = rows.find(row => row.task_key === EXPERTISE_TASK_KEY);
      if (title) {
        const { config } = await requireMachineTask(client, job, title);
        if (rows.length !== 1 || !machineSnapshotMatches(snapshot, config.manifest)) fail('invalid_prompt_job_snapshot', 400);
      } else if (expertise) {
        if (job.operation !== 'generate-draft' || rows.length !== 1 || snapshot.version !== 2) fail('invalid_prompt_job_snapshot', 400);
        const config = await getContent(client, job.id, expertise.configuration_content_id, expertise.configuration_hash, { expectedKind: 'configuration' });
        if (!config || snapshot.rosterSnapshot?.manifest?.rosterHash !== config.rosterHash) {
          fail('invalid_prompt_job_snapshot', 400);
        }
        if (Object.hasOwn(config, 'sourceProof')) {
          try {
            const proof = recommendationSnapshotSourceProof(config.profile.documentRoles, snapshot.documents,
              isSandboxRecommendationSourceProof(config.sourceProof) ? config.sourceProof.targetHost : undefined);
            if (canonical(proof) !== canonical(config.sourceProof)) throw new Error('recommendations source proof mismatch');
          } catch { fail('invalid_prompt_job_snapshot', 400); }
        }
      } else if (snapshot.version === 2 || Object.hasOwn(snapshot, 'rosterSnapshot')) {
        fail('invalid_prompt_job_snapshot', 400);
      }
      const content = await putContent(client, job.id, 'snapshot', snapshot, job.source_expires_at);
      await client.query('UPDATE prompt_jobs SET snapshot_content_id = $2, snapshot_hash = $3 WHERE id = $1',
        [job.id, content.id, content.sha256]);
      return touch(client, job.id);
    });
  }

  async function readContent({ jobId, leaseToken, contentId, expectedHash }) {
    if (contentId == null) return null;
    if (typeof expectedHash !== 'string' || !SHA256.test(expectedHash)) fail('invalid_prompt_job_content_hash', 400);
    return withLease(jobId, leaseToken, (client, job) => getContent(client, job.id, guid(contentId), expectedHash));
  }

  async function captureTarget({ jobId, leaseToken, etag, fields }) {
    if (typeof etag !== 'string' || etag.length > 200 || !ETAG.test(etag) || !fields || typeof fields !== 'object' || Array.isArray(fields)) {
      fail('invalid_prompt_job_target', 400);
    }
    return withLease(jobId, leaseToken, async (client, job) => {
      if (job.operation !== 'initialize') fail('invalid_prompt_job_operation');
      if (job.target_etag !== null) fail('prompt_job_target_frozen');
      // A Request ETag covers every field. Preserve the earlier baseline's
      // opportunity to publish across worker ticks, even for disjoint fields.
      const { rows: [{ pending }] } = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM prompt_jobs other JOIN prompt_job_tasks t ON t.job_id = other.id
           WHERE other.id <> $1 AND other.environment = $2 AND other.request_id = $3
             AND other.operation = 'initialize' AND other.target_etag IS NOT NULL AND t.writeback_state = 'pending'
         ) AS pending`, [job.id, job.environment, job.request_id],
      );
      if (pending) fail('prompt_job_request_publication_pending');
      const { rows: slots } = await client.query(
        'SELECT * FROM prompt_job_initializations WHERE job_id = $1 AND released_at IS NULL', [job.id],
      );
      if (slots.length !== Object.keys(fields).length || slots.some(({ destination_field: field }) =>
        !Object.hasOwn(fields, field) || typeof fields[field]?.blank !== 'boolean' || !SHA256.test(fields[field]?.sha256 || ''))) {
        fail('invalid_prompt_job_target', 400);
      }
      for (const slot of slots) {
        const observed = fields[slot.destination_field];
        await client.query(
          'UPDATE prompt_job_initializations SET initially_blank = $2, initial_content_hash = $3 WHERE id = $1',
          [slot.id, observed.blank, observed.sha256],
        );
        if (!observed.blank) await client.query(
          `UPDATE prompt_job_tasks SET state = 'failed_pre_dispatch', writeback_state = 'blocked',
           error_code = 'protected_staff_content' WHERE id = $1 AND state = 'queued'`, [slot.task_id],
        );
      }
      await client.query('UPDATE prompt_jobs SET target_etag = $2 WHERE id = $1', [job.id, etag]);
      return touch(client, job.id);
    });
  }

  async function markDispatching({ jobId, leaseToken, taskId }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      const { rows: [task] } = await client.query(
        `SELECT t.* FROM prompt_job_tasks t WHERE t.job_id = $1 AND t.id = $2 AND t.state = 'queued'
         AND NOT EXISTS (SELECT 1 FROM prompt_job_tasks peer WHERE peer.job_id = $1 AND peer.state IN ('dispatching', 'unknown'))
         AND EXISTS (SELECT 1 FROM prompt_job_content c WHERE c.job_id = $1 AND c.id = t.configuration_content_id
                     AND c.expires_at > clock_timestamp())
         AND EXISTS (SELECT 1 FROM prompt_job_content c WHERE c.job_id = $1 AND c.id = $3
                     AND c.expires_at > clock_timestamp())
         AND ($4 = 'generate-draft' OR ($5::text IS NOT NULL AND EXISTS (
           SELECT 1 FROM prompt_job_initializations i WHERE i.task_id = t.id
           AND i.initially_blank AND i.released_at IS NULL
         )))`, [job.id, guid(taskId), job.snapshot_content_id, job.operation, job.target_etag],
      );
      if (!task) return null;
      const machine = task.task_key === MACHINE_TITLE_TASK ? await requireMachineTask(client, job, task) : null;
      if (machine) {
        const { policy, config } = machine;
        const snapshot = await getContent(client, job.id, job.snapshot_content_id, job.snapshot_hash, { expectedKind: 'snapshot' });
        if (!machineSnapshotMatches(snapshot, config.manifest)) fail('invalid_prompt_job_snapshot', 400);
        assertMachineCurrent(policy);
      }
      if (task.task_key === EXPERTISE_TASK_KEY && job.environment !== 'test') {
        const policy = readRecommendationsTrialPolicy();
        if (!matchesRecommendationsTrialScope({ environment: job.environment, requestId: job.request_id,
          authorizationScope: job.authorization_scope }, policy) || job.principal_key !== policy.principalKey
          || job.idempotency_key !== policy.idempotencyKey || job.payload_hash !== recommendationsTrialCommandHash(policy)
          || task.prompt_hash !== policy.promptHash
          || task.profile_hash !== policy.profileHash) return null;
        await assertTrialDatabase(client, policy.databaseIdentity);
        if (canonical(readRecommendationsTrialPolicy()) !== canonical(policy)) return null;
      }
      const { rows: [attempt] } = await client.query(
        "INSERT INTO prompt_job_attempts (task_id, state) VALUES ($1, 'dispatching') RETURNING *", [task.id],
      );
      await client.query("UPDATE prompt_job_tasks SET state = 'dispatching' WHERE id = $1", [task.id]);
      await touch(client, job.id);
      if (machine) assertMachineCurrent(machine.policy);
      return attempt;
    });
  }

  async function findAttempt(client, job, taskId, attemptId, state) {
    const { rows: [attempt] } = await client.query(
      `SELECT a.*, t.task_key FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id = a.task_id
       WHERE t.job_id = $1 AND t.id = $2 AND a.id = $3 AND t.state = $4 AND a.state = $4`,
      [job.id, guid(taskId), guid(attemptId), state],
    );
    return attempt || null;
  }

  async function saveResponse({ jobId, leaseToken, taskId, attemptId, response }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      const before = await findAttempt(client, job, taskId, attemptId, 'dispatching');
      if (!before) return null;
      if (!response || typeof response !== 'object' || Array.isArray(response)
        || (before.task_key === EXPERTISE_TASK_KEY && (response.version !== 2 || !SHA256.test(response.binding || '')))) {
        fail('invalid_prompt_job_response', 400);
      }
      const content = await putContent(client, job.id, 'response', response, job.source_expires_at);
      const usage = Object.fromEntries(['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']
        .filter(key => Number.isSafeInteger(response.response?.usage?.[key]) && response.response.usage[key] >= 0)
        .map(key => [key, response.response.usage[key]]));
      const { rows: [attempt] } = await client.query(
        `UPDATE prompt_job_attempts SET state = 'response_saved', response_content_id = $2, response_hash = $3,
         usage = $4::jsonb, usage_complete = $5 WHERE id = $1 RETURNING *`,
        [attemptId, content.id, content.sha256, Object.keys(usage).length ? JSON.stringify(usage) : null,
          response.response?.usageComplete === true && Object.keys(usage).length === 4],
      );
      await client.query("UPDATE prompt_job_tasks SET state = 'response_saved' WHERE id = $1", [taskId]);
      await touch(client, job.id);
      return attempt;
    });
  }

  async function saveValidated({ jobId, leaseToken, taskId, attemptId, result, deferredAudit }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      const before = await findAttempt(client, job, taskId, attemptId, 'response_saved');
      if (!before) return null;
      const response = await getContent(client, job.id, before.response_content_id, before.response_hash, { expectedKind: 'response' });
      if (!response) fail('prompt_job_response_expired');
      try { validateTaskResult(before.task_key, result); }
      catch { fail('invalid_prompt_job_result', 400); }
      if ((before.task_key === EXPERTISE_TASK_KEY && (job.operation !== 'generate-draft' || response.version !== 2))
        || !deferredAudit || typeof deferredAudit !== 'object') {
        fail('invalid_prompt_job_result', 400);
      }
      const content = await putContent(client, job.id, 'result', result, job.result_expires_at);
      const audit = await putContent(client, job.id, 'audit', deferredAudit, job.result_expires_at);
      await client.query(
        `UPDATE prompt_job_attempts SET state = 'validated', audit_state = 'pending', audit_content_id = $2, audit_hash = $3
         WHERE id = $1`, [attemptId, audit.id, audit.sha256],
      );
      const { rows: [task] } = await client.query(
        "UPDATE prompt_job_tasks SET state = 'validated', result_content_id = $2, result_hash = $3 WHERE id = $1 RETURNING *",
        [taskId, content.id, content.sha256],
      );
      await touch(client, job.id);
      return task;
    });
  }

  async function markAttemptFailed({ jobId, leaseToken, taskId, attemptId = null, outcome, errorCode, deferredAudit = null }) {
    const dispatchAudit = deferredAudit !== null && (
      (outcome === 'failed_pre_dispatch' && errorCode === 'provider_rejected')
      || (outcome === 'unknown' && errorCode === 'provider_outcome_unknown')
    );
    if (!['unknown', 'failed_pre_dispatch', 'failed_validation', 'expired'].includes(outcome) || !ERROR_CODE.test(errorCode || '')
      || ((outcome === 'failed_validation' || dispatchAudit)
        && (!deferredAudit || typeof deferredAudit !== 'object' || attemptId === null))
      || (outcome !== 'failed_validation' && deferredAudit !== null && !dispatchAudit)) {
      fail('invalid_prompt_job_failure', 400);
    }
    const before = attemptId === null ? 'queued'
      : ['unknown', 'failed_pre_dispatch'].includes(outcome) ? 'dispatching' : 'response_saved';
    if (attemptId === null && !['failed_pre_dispatch', 'expired'].includes(outcome)) fail('invalid_prompt_job_failure', 400);
    return withLease(jobId, leaseToken, async (client, job) => {
      if (attemptId === null) {
        const { rows } = await client.query(
          "SELECT id FROM prompt_job_tasks WHERE job_id = $1 AND id = $2 AND state = 'queued'", [job.id, guid(taskId)],
        );
        if (!rows.length) return null;
      } else {
        const attempt = await findAttempt(client, job, taskId, attemptId, before);
        if (!attempt) return null;
        if (dispatchAudit) {
          const trial = readRecommendationsTrialPolicy();
          if (trial?.predecessorJobId !== RECOMMENDATIONS_TRIAL_THIRD_JOB_ID || attempt.task_key !== EXPERTISE_TASK_KEY
            || !matchesRecommendationsTrialScope({ environment: job.environment, requestId: job.request_id,
              authorizationScope: job.authorization_scope }, trial) || job.principal_key !== trial.principalKey
            || job.idempotency_key !== trial.idempotencyKey || job.payload_hash !== recommendationsTrialCommandHash(trial)) {
            fail('invalid_prompt_job_failure', 400);
          }
        }
      }
      if (attemptId !== null) {
        const audit = deferredAudit ? await putContent(client, job.id, 'audit', deferredAudit, job.result_expires_at) : null;
        await client.query(
          `UPDATE prompt_job_attempts SET state = $2, error_code = $3, audit_content_id = $4, audit_hash = $5, audit_state = $6
           WHERE id = $1`, [attemptId, outcome, errorCode, audit?.id ?? null, audit?.sha256 ?? null, audit ? 'pending' : 'none'],
        );
      }
      const { rows: [task] } = await client.query(
        `UPDATE prompt_job_tasks SET state = $2, error_code = $3,
           writeback_state = CASE WHEN writeback_state = 'pending' THEN $4 ELSE writeback_state END
         WHERE id = $1 RETURNING *`,
        [taskId, outcome, errorCode, outcome === 'unknown' ? 'pending' : outcome === 'expired' ? 'expired' : 'blocked'],
      );
      // Release is a synthetic-test exception, never the default for a new task.
      // Summary and other non-synthetic reservations survive known failure/expiry;
      // this does not enable their admission or publication.
      if (outcome !== 'unknown' && job.environment === 'test'
        && getTaskCapability(task.task_key)?.kind === 'synthetic') {
        await releaseInitialization(client, job.id, task.id);
      }
      await touch(client, job.id);
      return task;
    });
  }

  async function updateAudit({ jobId, leaseToken, taskId, attemptId }, before, after) {
    return withLease(jobId, leaseToken, async (client, job) => {
      const { rows: [attempt] } = await client.query(
        `UPDATE prompt_job_attempts a SET audit_state = $4 FROM prompt_job_tasks t
         WHERE a.id = $1 AND a.task_id = t.id AND t.id = $2 AND t.job_id = $3
           AND a.audit_state = $5
           AND ($4 <> 'dispatching' OR EXISTS (SELECT 1 FROM prompt_job_content c
             WHERE c.id = a.audit_content_id AND c.job_id = $3 AND c.expires_at > clock_timestamp()))
         RETURNING a.*`, [guid(attemptId), guid(taskId), job.id, after, before],
      );
      if (attempt) await touch(client, job.id);
      return attempt || null;
    });
  }

  function markAuditDispatching(fence) {
    return updateAudit(fence, 'pending', 'dispatching');
  }

  function markAudit({ outcome, ...fence }) {
    if (!['delivered', 'failed', 'unknown'].includes(outcome)) fail('invalid_prompt_job_audit_outcome', 400);
    return updateAudit(fence, 'dispatching', outcome);
  }

  async function freezePublication({ jobId, leaseToken }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      if (job.operation !== 'initialize' || !job.target_etag) return null;
      const { tasks, attempts, publication } = await view(client, job);
      const title = tasks.find(task => task.task_key === MACHINE_TITLE_TASK);
      if (title && tasks.length !== 1) fail('prompt_job_content_integrity');
      const machine = title ? await requireMachineTask(client, job, title) : null;
      if (publication && publication.state !== 'ready') return publication;
      if (tasks.some(task => ['queued', 'dispatching', 'response_saved', 'unknown'].includes(task.state))) return null;
      if (attempts.some(attempt => !['none', 'delivered'].includes(attempt.audit_state))) return null;
      if (publication) return publication;
      const { rows: candidates } = await client.query(
        `SELECT t.*, i.id AS initialization_id FROM prompt_job_tasks t JOIN prompt_job_initializations i ON i.task_id = t.id
         WHERE t.job_id = $1 AND t.state = 'validated' AND t.writeback_state = 'pending'
           AND i.initially_blank AND i.released_at IS NULL ORDER BY t.destination_field`, [job.id],
      );
      if (!candidates.length) return null;
      const fields = {};
      for (const task of candidates) {
        const capability = getTaskCapability(task.task_key);
        if ((capability?.kind !== 'synthetic' && task.task_key !== MACHINE_TITLE_TASK) || (machine ? authorizedTitleDestination(machine.config.promptRow, machine.policy) : capability.destinationField) !== task.destination_field) fail('prompt_job_content_integrity');
        const result = await getContent(client, job.id, task.result_content_id, task.result_hash, { expectedKind: 'result' });
        if (result === null) fail('prompt_job_result_expired');
        try { validateTaskResult(task.task_key, result); }
        catch { fail('prompt_job_content_integrity'); }
        fields[task.destination_field] = result;
      }
      if (machine) assertMachineCurrent(machine.policy);
      const payload = await putContent(client, job.id, 'publication', fields, job.result_expires_at);
      const { rows: [row] } = await client.query(
        `INSERT INTO prompt_job_publications (job_id, expected_etag, payload_content_id, payload_hash, task_ids, initialization_ids)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [job.id, job.target_etag, payload.id, payload.sha256, candidates.map(task => task.id),
          candidates.map(task => task.initialization_id)],
      );
      await touch(client, job.id);
      if (machine) assertMachineCurrent(machine.policy);
      return row;
    });
  }

  async function markPublicationDispatched({ jobId, leaseToken, operationId }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      let machine;
      if (machineTitleScope(machineJobScope(job))) {
        const { rows: [title] } = await client.query(
          'SELECT * FROM prompt_job_tasks WHERE job_id = $1 AND task_key = $2', [job.id, MACHINE_TITLE_TASK],
        );
        if (!title) fail('prompt_job_content_integrity');
        machine = await requireMachineTask(client, job, title);
      }
      const { rows: [row] } = await client.query(
        `UPDATE prompt_job_publications p SET state = 'dispatching'
         WHERE id = $1 AND job_id = $2 AND state = 'ready'
           AND EXISTS (SELECT 1 FROM prompt_job_content c WHERE c.job_id = $2 AND c.id = p.payload_content_id
                       AND c.expires_at > clock_timestamp())
           AND NOT EXISTS (SELECT 1 FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id = a.task_id
                           WHERE t.job_id = $2 AND a.audit_state NOT IN ('none', 'delivered'))
         RETURNING p.*`, [guid(operationId), job.id],
      );
      if (row) await touch(client, job.id);
      if (machine) assertMachineCurrent(machine.policy);
      return row || null;
    });
  }

  async function finishPublication({ jobId, leaseToken, operationId, outcome }) {
    if (!['applied', 'conflict', 'unknown', 'expired'].includes(outcome)) fail('invalid_prompt_job_writeback_outcome', 400);
    return withLease(jobId, leaseToken, async (client, job) => {
      const { rows: [row] } = await client.query(
        'SELECT * FROM prompt_job_publications WHERE id = $1 AND job_id = $2 AND state = $3',
        [guid(operationId), job.id, outcome === 'expired' ? 'ready' : 'dispatching'],
      );
      if (!row) return null;
      const publication = await publicationOutcome(client, row, outcome);
      await touch(client, job.id);
      return publication;
    });
  }

  async function expireSandboxRecommendationContent({ jobId, databaseIdentity, limit = 100, ...scope }) {
    if (!isExpertiseSandboxReadScope(scope)) fail('invalid_prompt_job_read_scope', 400);
    const identity = readScope(scope);
    const id = guid(jobId);
    return transaction(async client => {
      await assertTrialDatabase(client, databaseIdentity);
      return deleteExpiredContent(client, limit, identity, id);
    });
  }

  async function expireContent({ limit = 100, scope } = {}) {
    return deleteExpiredContent(pool, limit, scope === undefined ? [null, null, null, null] : readScope(scope ?? {}), null);
  }

  async function deleteExpiredContent(client, limit, identity, jobId) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_prompt_job_expiry_limit', 400);
    const { rowCount } = await client.query(
      `DELETE FROM prompt_job_content WHERE id IN (
         SELECT content.id FROM prompt_job_content content WHERE content.expires_at <= clock_timestamp()
           AND ($6::uuid IS NULL OR (content.job_id = $6 AND EXISTS (
             SELECT 1 FROM prompt_job_tasks t WHERE t.job_id = $6 AND t.task_key = $7
           )))
           AND ($2::text IS NULL OR EXISTS (
             SELECT 1 FROM prompt_jobs j WHERE j.id = content.job_id AND j.environment = $2
               AND j.principal_key = $3 AND j.authorization_scope = $4 AND j.request_id = $5
           ))
         ORDER BY content.expires_at, content.id LIMIT $1 FOR UPDATE SKIP LOCKED
       )`, [limit, ...identity, jobId, EXPERTISE_TASK_KEY],
    );
    return rowCount;
  }

  return {
    admit, admitMachineTitle, verifyMachineTitleDatabase, admitSandboxRecommendation, verifySandboxRecommendationDatabase, readJob, listJobs, readValidatedResults, readValidatedRecommendations, readRecommendationState, readValidatedSandboxRecommendations, readSandboxRecommendationState, findRunnableJob, claim, releaseClaim, saveSnapshot, readContent, captureTarget,
    markDispatching, saveResponse, saveValidated, markAttemptFailed, markAuditDispatching, markAudit,
    freezePublication, markPublicationDispatched, finishPublication, expireContent, expireSandboxRecommendationContent,
  };
}
