/** Request-scoped, sandbox-isolated queue for one automatic screen per semifinalist. */
import { randomUUID } from 'node:crypto';
import { sql as appSql } from '@vercel/postgres';
import { getJ27IntegritySimulationSql } from './j27-integrity-simulation';
import { getById, findByIds } from '../../dataverse/adapters/grant-request';
import { linkedCycleCode, linkedCycleExpand } from '../../dataverse/adapters/operations-grant-cycle';
import { eqGuid } from '../../dataverse/core/odata';
import { isDataverseRecordNotFound } from '../../dataverse/core/errors';
import { isGuid } from '../../utils/guid';
import { j27IntegrityTarget, isJ27IntegritySimulationRequest } from '../../utils/j27-integrity-readiness';
import { SEMI_FINALIST_STATUS } from '../../../shared/config/j27FirstCut';

const sql = (strings, ...values) => (getJ27IntegritySimulationSql() || appSql)(strings, ...values);

const candidates = `wmkf_phaseistatus eq ${SEMI_FINALIST_STATUS.yes} or wmkf_phaseistatus eq 100000003`;

export async function isJ27SandboxFactoryRequest({ target, requestId, runId }) {
  const { rows } = await sql`
    SELECT 1 FROM test_request_runs
    WHERE run_id = ${runId} AND destination_request_id = ${requestId}
      AND destination_environment = 'sandbox' AND destination_dataverse_host = ${target}
      AND status = 'ready'
  `;
  return rows.length > 0;
}

export async function queueJ27IntegrityScreen({ target, requestId, profileId, version }) {
  // Reserve before the Dataverse PATCH. A delayed worker will check the
  // actual status after the save service confirms its own conditional write.
  const simulation = isJ27IntegritySimulationRequest(requestId);
  const { rows } = await sql`
    INSERT INTO j27_integrity_jobs (
      target_host, request_id, actor_profile_id, expected_version, state, available_at
    ) VALUES (
      ${target}, ${requestId}, ${profileId}, ${version}, 'queued', NOW() + INTERVAL '10 seconds'
    )
    ON CONFLICT (target_host, request_id) DO UPDATE
      SET actor_profile_id = EXCLUDED.actor_profile_id, expected_version = EXCLUDED.expected_version,
          state = 'queued', available_at = EXCLUDED.available_at, confirmed_at = NULL, failure_code = NULL, updated_at = NOW()
      WHERE NOT ${simulation}::boolean AND (j27_integrity_jobs.state = 'skipped'
        OR (j27_integrity_jobs.state IN ('queued', 'failed')
          AND j27_integrity_jobs.expected_version <> EXCLUDED.expected_version))
    RETURNING request_id
  `;
  if (rows.length) return true;
  if (simulation) return false;
  // A start that failed after the row was reserved can be retried with the
  // same ETag. In-flight and completed screens never need another dispatch.
  const existing = await sql`
    SELECT state FROM j27_integrity_jobs WHERE target_host = ${target} AND request_id = ${requestId}
  `;
  return existing.rows[0]?.state === 'queued';
}

export async function confirmJ27IntegritySchedule({ target, requestId, version }) {
  const { rows } = await sql`
    UPDATE j27_integrity_jobs SET confirmed_at = NOW(), updated_at = NOW()
    WHERE target_host = ${target} AND request_id = ${requestId}
      AND expected_version = ${version} AND state = 'queued'
    RETURNING request_id
  `;
  return rows.length > 0;
}

export async function readJ27IntegrityAttempt(target, requestId, version) {
  const { rows } = await sql`
    SELECT state FROM j27_integrity_jobs
    WHERE target_host = ${target} AND request_id = ${requestId} AND expected_version = ${version}
  `;
  return rows[0]?.state || null;
}

export async function claimJ27IntegrityScreen(target, requestId, version) {
  const token = randomUUID();
  const { rows } = await sql`
    UPDATE j27_integrity_jobs
    SET state = 'running', lease_token = ${token}, lease_until = NOW() + INTERVAL '6 minutes', updated_at = NOW()
    WHERE target_host = ${target} AND request_id = ${requestId}
      AND expected_version = ${version} AND state = 'queued' AND confirmed_at IS NOT NULL
      AND available_at <= NOW() AND available_at > NOW() - INTERVAL '15 minutes'
    RETURNING *
  `;
  return rows[0] || null;
}

export async function expireJ27IntegrityClaim(target, requestId, version) {
  // A worker can die after invoking a paid provider. Preserve the uncertain
  // outcome for staff to inspect rather than automatically repeating spend.
  await sql`
    UPDATE j27_integrity_jobs
    SET state = 'failed', failure_code = 'screen_completion_unconfirmed',
        lease_token = NULL, lease_until = NULL, updated_at = NOW()
    WHERE target_host = ${target} AND request_id = ${requestId} AND expected_version = ${version}
      AND ((state = 'running' AND lease_until <= NOW()) OR (state = 'queued' AND available_at <= NOW() - INTERVAL '1 minute'))
  `;
}

export async function finishJ27IntegrityClaim(job, state, failureCode = null) {
  await sql`
    UPDATE j27_integrity_jobs
    SET state = ${state}, failure_code = ${failureCode},
        lease_token = NULL, lease_until = NULL, updated_at = NOW()
    WHERE target_host = ${job.target_host} AND request_id = ${job.request_id}
      AND lease_token = ${job.lease_token} AND lease_until > NOW()
  `;
}

export async function confirmJ27IntegrityEligibility(job) {
  const request = await getById(job.request_id, {
    select: 'akoya_requestid,wmkf_phaseistatus,wmkf_istestrequest,wmkf_testcreationrunid',
    expand: linkedCycleExpand(),
  }).catch(error => {
    if (isDataverseRecordNotFound(error)) return null;
    throw error;
  });
  if (!request || linkedCycleCode(request) !== 'J27'
    || ![SEMI_FINALIST_STATUS.yes, 100000003].includes(request.wmkf_phaseistatus)) return false;
  if (isJ27IntegritySimulationRequest(job.request_id)) return true;
  if (request.wmkf_istestrequest !== true || !isGuid(request.wmkf_testcreationrunid)) return false;
  return isJ27SandboxFactoryRequest({
    target: job.target_host, requestId: job.request_id, runId: request.wmkf_testcreationrunid,
  });
}

export async function saveJ27IntegrityRun(job, { screenedPeople, results, matchCount }) {
  const flagged = results.some(result => result?.hasConcerns === true || Number(result?.matchCount) > 0);
  // Fence the paid result to the worker lease and save both records atomically.
  // A failure before this transaction commits cannot create a partial history row.
  const { rows } = await sql`
    WITH claim AS (
      SELECT target_host, request_id, actor_profile_id FROM j27_integrity_jobs
      WHERE target_host = ${job.target_host} AND request_id = ${job.request_id}
        AND lease_token = ${job.lease_token} AND lease_until > NOW()
      FOR UPDATE
    ), saved AS (
      INSERT INTO integrity_screenings (
        user_profile_id, screening_type, screened_names, results, match_count, status, request_id
      )
      SELECT actor_profile_id, 'workbench', ${JSON.stringify(screenedPeople)}::jsonb,
        ${JSON.stringify(results)}::jsonb, ${matchCount}, 'pending', request_id FROM claim
      RETURNING id, created_at, screened_names, results, match_count, status
    ), completed AS (
      UPDATE j27_integrity_jobs AS job
      SET state = 'completed', screening_id = saved.id, flagged = ${flagged},
          lease_token = NULL, lease_until = NULL, updated_at = NOW()
      FROM claim, saved
      WHERE job.target_host = claim.target_host AND job.request_id = claim.request_id
      RETURNING job.screening_id
    )
    SELECT saved.* FROM saved JOIN completed ON completed.screening_id = saved.id
  `;
  return rows[0] || null;
}

export async function readJ27IntegrityJob(requestId) {
  const target = j27IntegrityTarget();
  if (!target) return null;
  const { rows } = await sql`
    SELECT CASE
      WHEN state = 'running' AND lease_until <= NOW() THEN 'failed'
      WHEN state = 'queued' AND available_at <= NOW() - INTERVAL '15 minutes' THEN 'failed'
      ELSE state END AS state
    FROM j27_integrity_jobs WHERE target_host = ${target} AND request_id = ${requestId}
  `;
  return rows[0]?.state || null;
}

export async function listJ27IntegrityAlerts(leadPdId) {
  const target = j27IntegrityTarget();
  if (!target || !isGuid(leadPdId)) return [];
  // Recheck ownership in Dataverse so a reassignment follows the current lead
  // PD. Acknowledged or superseded screens don't remain as inbox alerts.
  const { rows } = await sql`
    SELECT job.request_id FROM j27_integrity_jobs AS job
    JOIN integrity_screenings AS screened ON screened.id = job.screening_id
    WHERE job.target_host = ${target} AND job.state = 'completed' AND job.flagged
      AND NOT EXISTS (
        SELECT 1 FROM integrity_screening_reviews AS review WHERE review.screening_id = job.screening_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM integrity_screenings AS newer
        WHERE newer.request_id = job.request_id
          AND (newer.created_at, newer.id) > (screened.created_at, screened.id)
      )
    ORDER BY job.updated_at DESC
  `;
  const alerts = [];
  for (let offset = 0; offset < rows.length; offset += 25) {
    const ids = rows.slice(offset, offset + 25).map(row => row.request_id);
    const { records } = await findByIds(ids, {
      select: 'akoya_requestid,akoya_requestnum,akoya_title,wmkf_istestrequest,wmkf_testcreationrunid',
      expand: linkedCycleExpand(),
      filter: `${eqGuid('_wmkf_programdirector_value', leadPdId)} and (${candidates})`,
    });
    for (const request of records) {
      if (linkedCycleCode(request) !== 'J27' || (!isJ27IntegritySimulationRequest(request.akoya_requestid)
        && (request.wmkf_istestrequest !== true || !isGuid(request.wmkf_testcreationrunid)))) continue;
      alerts.push({ requestId: request.akoya_requestid, number: request.akoya_requestnum, title: request.akoya_title });
    }
  }
  return alerts;
}
