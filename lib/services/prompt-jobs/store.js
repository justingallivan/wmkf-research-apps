/**
 * Shared Executor trial ledger. Callers supply an isolated PostgreSQL pool and
 * establish authorization before using this server-side store. All external
 * work runs outside transactions; every checkpoint uses the live job lease.
 */
import { createHash, randomUUID } from 'node:crypto';
import { isGuid } from '../../utils/guid.js';
import { ServiceHttpError } from '../service-http-error.js';
import { canonical, hashProfile, MAX_PROFILE_RESPONSE_BYTES, MAX_PROFILE_RESULT_BYTES, MAX_PROFILE_SNAPSHOT_BYTES } from './profile.js';
import { validateSyntheticTask } from './capabilities.js';

const SHA256 = /^[a-f0-9]{64}$/;
const ERROR_CODE = /^[a-z][a-z0-9_]{0,79}$/;
const IDENTITY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/;
const ETAG = /^(?:W\/)?"[^"\r\n]+"$/;
const DAY_MS = 86_400_000;
const FIXTURE_FIELDS = Object.freeze({
  'synthetic.executive-summary': 'fixture_summary',
  'synthetic.methodology': 'fixture_methodology',
});
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

async function getContent(client, jobId, id, expectedHash) {
  const { rows: [row] } = await client.query(
    `SELECT payload, sha256, size_bytes FROM prompt_job_content
     WHERE job_id = $1 AND id = $2 AND expires_at > clock_timestamp()`, [jobId, id],
  );
  if (!row) return null;
  if (row.sha256 !== expectedHash
    || row.sha256 !== sha256(row.payload) || row.size_bytes !== Buffer.byteLength(row.payload)) {
    fail('prompt_job_content_integrity');
  }
  return JSON.parse(row.payload);
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

function validateAdmission({ environment, principalKey, authorizationScope, operation, sourceEventId, tasks }) {
  if (environment !== 'test' || !isIdentity(principalKey) || !isIdentity(authorizationScope)
    || !['initialize', 'generate-draft'].includes(operation)
    || (sourceEventId != null && !isIdentity(sourceEventId))
    || (operation === 'initialize' && !sourceEventId)
    || !Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8
    || tasks.some(task => typeof task?.taskKey !== 'string' || !Object.hasOwn(FIXTURE_FIELDS, task.taskKey))
    || new Set(tasks.map(task => task.taskKey)).size !== tasks.length) {
    fail('invalid_prompt_job_admission', 400);
  }
}

function scopeMatches(scope, { environment, request_id: requestId, authorization_scope: authorizationScope }) {
  return scope?.environment === environment && scope.requestId === requestId && scope.authorizationScope === authorizationScope;
}

function validateNewJob(input, requestId) {
  const { environment, authorizationScope, tasks, sourceExpiresAt, resultExpiresAt } = input;
  const source = new Date(sourceExpiresAt);
  const result = new Date(resultExpiresAt);
  const now = Date.now();
  if (!(source.getTime() > now && result.getTime() >= source.getTime()
    && source.getTime() <= now + 7 * DAY_MS && result.getTime() <= now + 30 * DAY_MS)) {
    fail('invalid_prompt_job_configuration', 400);
  }
  const frozen = tasks.map(task => {
    const { taskKey, configuration } = task;
    const { promptRow, profile, scope } = configuration || {};
    const destinationField = FIXTURE_FIELDS[taskKey];
    if (!scopeMatches(scope, { environment, request_id: requestId, authorization_scope: authorizationScope })
      || promptRow?.wmkf_ai_promptname !== taskKey
      || (task.destinationField != null && task.destinationField !== destinationField)) {
      fail('invalid_prompt_job_configuration', 400);
    }
    let profileHash;
    let promptHash;
    let spec;
    try {
      profileHash = hashProfile(profile);
      promptHash = sha256(canonical(promptRow));
      ({ spec } = validateSyntheticTask(promptRow, scope));
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

export function createPromptJobStore(pool) {
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

  async function admit(input) {
    validateAdmission(input);
    const { environment, principalKey, authorizationScope, operation, tasks, sourceEventId = null } = input;
    const requestId = guid(input.requestId);
    const idempotencyKey = guid(input.idempotencyKey);
    const taskKeys = tasks.map(task => task.taskKey).sort();
    const hash = sha256(canonical({ requestId, authorizationScope, operation, sourceEventId, taskKeys }));
    return transaction(async client => {
      const find = async () => (await client.query(
        'SELECT * FROM prompt_jobs WHERE environment = $1 AND principal_key = $2 AND idempotency_key = $3 FOR SHARE',
        [environment, principalKey, idempotencyKey],
      )).rows[0];
      const replay = async job => {
        if (job.payload_hash !== hash) fail('prompt_job_idempotency_key_reused');
        return { ...(await view(client, job)), replayed: true };
      };
      const previous = await find();
      if (previous) return replay(previous);
      const { source, result, frozen } = validateNewJob(input, requestId);
      const { rows: [job] } = await client.query(
        `INSERT INTO prompt_jobs (environment, principal_key, authorization_scope, request_id, idempotency_key, payload_hash,
           operation, source_event_id, source_expires_at, result_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (environment, principal_key, idempotency_key) DO NOTHING RETURNING *`,
        [environment, principalKey, authorizationScope, requestId, idempotencyKey, hash, operation, sourceEventId, source, result],
      );
      if (!job) return replay(await find());

      // Stable field order prevents inverted slot acquisition across jobs.
      const ordered = frozen.sort((a, b) => a.destinationField.localeCompare(b.destinationField));
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
      return { ...(await view(client, job)), replayed: false };
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
      const { rows } = await client.query('SELECT profile_hash FROM prompt_job_tasks WHERE job_id = $1', [job.id]);
      if (!scopeMatches(snapshot?.scope, job) || !rows.length || rows.some(row => row.profile_hash !== snapshot.profileHash)) {
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
      const { rows: [attempt] } = await client.query(
        "INSERT INTO prompt_job_attempts (task_id, state) VALUES ($1, 'dispatching') RETURNING *", [task.id],
      );
      await client.query("UPDATE prompt_job_tasks SET state = 'dispatching' WHERE id = $1", [task.id]);
      await touch(client, job.id);
      return attempt;
    });
  }

  async function findAttempt(client, job, taskId, attemptId, state) {
    const { rows: [attempt] } = await client.query(
      `SELECT a.* FROM prompt_job_attempts a JOIN prompt_job_tasks t ON t.id = a.task_id
       WHERE t.job_id = $1 AND t.id = $2 AND a.id = $3 AND t.state = $4 AND a.state = $4`,
      [job.id, guid(taskId), guid(attemptId), state],
    );
    return attempt || null;
  }

  async function saveResponse({ jobId, leaseToken, taskId, attemptId, response }) {
    return withLease(jobId, leaseToken, async (client, job) => {
      if (!await findAttempt(client, job, taskId, attemptId, 'dispatching')) return null;
      if (!response || typeof response !== 'object' || Array.isArray(response)) fail('invalid_prompt_job_response', 400);
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
      if (!await getContent(client, job.id, before.response_content_id, before.response_hash)) fail('prompt_job_response_expired');
      if (typeof result !== 'string' || !result.trim() || !deferredAudit || typeof deferredAudit !== 'object') {
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
    if (!['unknown', 'failed_pre_dispatch', 'failed_validation', 'expired'].includes(outcome) || !ERROR_CODE.test(errorCode || '')
      || (outcome === 'failed_validation' && (!deferredAudit || typeof deferredAudit !== 'object'))
      || (outcome !== 'failed_validation' && deferredAudit !== null)) {
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
      } else if (!await findAttempt(client, job, taskId, attemptId, before)) {
        return null;
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
      if (outcome !== 'unknown') await releaseInitialization(client, job.id, task.id);
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
        const result = await getContent(client, job.id, task.result_content_id, task.result_hash);
        if (result === null) fail('prompt_job_result_expired');
        fields[task.destination_field] = result;
      }
      const payload = await putContent(client, job.id, 'publication', fields, job.result_expires_at);
      const { rows: [row] } = await client.query(
        `INSERT INTO prompt_job_publications (job_id, expected_etag, payload_content_id, payload_hash, task_ids, initialization_ids)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [job.id, job.target_etag, payload.id, payload.sha256, candidates.map(task => task.id),
          candidates.map(task => task.initialization_id)],
      );
      await touch(client, job.id);
      return row;
    });
  }

  async function markPublicationDispatched({ jobId, leaseToken, operationId }) {
    return withLease(jobId, leaseToken, async (client, job) => {
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

  async function expireContent({ limit = 100 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_prompt_job_expiry_limit', 400);
    const { rowCount } = await pool.query(
      `DELETE FROM prompt_job_content WHERE id IN (
         SELECT id FROM prompt_job_content WHERE expires_at <= clock_timestamp()
         ORDER BY expires_at, id LIMIT $1 FOR UPDATE SKIP LOCKED
       )`, [limit],
    );
    return rowCount;
  }

  return {
    admit, readJob, claim, releaseClaim, saveSnapshot, readContent, captureTarget,
    markDispatching, saveResponse, saveValidated, markAttemptFailed, markAuditDispatching, markAudit,
    freezePublication, markPublicationDispatched, finishPublication, expireContent,
  };
}
