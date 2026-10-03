/** Database orchestration shared by the materials upload CLI and its tests. */
import { resolveMaterialsUploadJob } from './background-job-store.js';
import { assertMaterialsOperatorDatabaseIdentity } from './materials-upload-operator-target.js';

const JOB_SELECT = `SELECT j.id, j.status, j.slot, j.attempt_count, j.deadline_at, j.next_attempt_at,
                           j.locked_until, j.error_code, j.created_at, j.updated_at,
                           s.status AS staging_status, s.filename, s.expires_at,
                           (s.candidate_result IS NOT NULL) AS has_candidate,
                           (j.scan_checkpoint IS NOT NULL) AS has_clean_scan_checkpoint
                      FROM materials_upload_jobs j
                      JOIN portal_upload_staging s ON s.id = j.staging_id
                     WHERE j.id = $1`;

/** Read one job; production calls are read-only and verify identity on-session. */
export async function inspectMaterialsUploadJob({
  clientConfig,
  jobId,
  production = false,
  expectedDatabase = null,
  createClient,
}) {
  const client = createClient(clientConfig);
  let readOnlyTransaction = false;
  try {
    await client.connect();
    if (production) {
      await client.query('BEGIN READ ONLY');
      readOnlyTransaction = true;
      await assertMaterialsOperatorDatabaseIdentity(client, expectedDatabase);
    }
    const result = await client.query(JOB_SELECT, [jobId]);
    if (!result.rows[0]) throw Object.assign(new Error('job_not_found'), { code: 'job_not_found' });
    if (readOnlyTransaction) {
      await client.query('COMMIT');
      readOnlyTransaction = false;
    }
    return result.rows[0];
  } catch (error) {
    if (readOnlyTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

/** Resolve through the guarded store, with production identity checked inside its transaction. */
export async function resolveMaterialsUploadJobFromOperator({
  clientConfig,
  jobId,
  action,
  production = false,
  expectedDatabase = null,
  createClient,
  resolveJob = resolveMaterialsUploadJob,
}) {
  return resolveJob({
    jobId,
    action,
    connectionFactory: async () => {
      const client = createClient(clientConfig);
      await client.connect();
      return client;
    },
    transactionPreflight: production
      ? (client) => assertMaterialsOperatorDatabaseIdentity(client, expectedDatabase)
      : undefined,
  });
}
