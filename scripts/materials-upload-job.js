#!/usr/bin/env node
/** Inspect or resolve one durable applicant materials job on a loopback Postgres instance. */
import pg from 'pg';

function usage() {
  console.error('Usage: node scripts/materials-upload-job.js --database-url postgres://...@127.0.0.1:PORT/DB --job-id UUID [--action inspect|cancel|retry]');
  process.exitCode = 2;
}

function argsOf(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) return null;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) return null;
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
}

const args = argsOf(process.argv.slice(2));
const connectionString = args?.['database-url'];
const jobId = args?.['job-id'];
const action = args?.action || 'inspect';
if (!args || !connectionString || !jobId || !['inspect', 'cancel', 'retry'].includes(action)
  || !/^[0-9a-f-]{36}$/i.test(jobId)) {
  usage();
} else {
  let parsedUrl;
  try { parsedUrl = new URL(connectionString); } catch { parsedUrl = null; }
  if (!parsedUrl || !['localhost', '127.0.0.1', '::1'].includes(parsedUrl.hostname)) {
    console.error('Refusing to connect: this operator tool accepts loopback Postgres URLs only.');
    process.exitCode = 2;
  } else {
    const client = new pg.Client({ connectionString, ssl: false });
    try {
      await client.connect();
      if (action === 'inspect') {
        const result = await client.query(
          `SELECT j.id, j.status, j.slot, j.attempt_count, j.deadline_at, j.next_attempt_at,
                  j.locked_until, j.error_code, j.created_at, j.updated_at,
                  s.status AS staging_status, s.filename, s.expires_at,
                  (s.candidate_result IS NOT NULL) AS has_candidate,
                  (j.scan_checkpoint IS NOT NULL) AS has_clean_scan_checkpoint
             FROM materials_upload_jobs j
             JOIN portal_upload_staging s ON s.id = j.staging_id
            WHERE j.id = $1`, [jobId],
        );
        if (!result.rows[0]) throw new Error('Job not found.');
        console.log(JSON.stringify(result.rows[0], null, 2));
      } else {
        await client.query('BEGIN');
        const selected = await client.query(
          `SELECT j.*, s.status AS staging_status
             FROM materials_upload_jobs j
             JOIN portal_upload_staging s ON s.id = j.staging_id AND s.background_job_id = j.id
            WHERE j.id = $1 FOR UPDATE OF j, s`, [jobId],
        );
        const job = selected.rows[0];
        if (!job || job.status !== 'needs_attention' || (job.locked_until && new Date(job.locked_until) > new Date())) {
          throw new Error('Job is not an unleased needs_attention job.');
        }
        if (job.staging_status === 'consumed') throw new Error('A durable receipt is already committed; the job cannot be cancelled or retried.');
        if (action === 'retry') {
          if (job.staging_status === 'consumed') throw new Error('Consumed staging has a durable receipt and cannot be retried.');
          if (Number(job.attempt_count) >= 8) throw new Error('The automatic attempt limit has been reached.');
          await client.query(
            `UPDATE materials_upload_jobs SET status='queued', next_attempt_at=NOW(),
                    deadline_at=NOW() + INTERVAL '2 hours', error_code=NULL,
                    completed_at=NULL, updated_at=NOW() WHERE id=$1`, [jobId],
          );
          await client.query(
            `UPDATE portal_upload_staging SET status='pending', lease_token=NULL,
                    lease_expires_at=NULL, updated_at=NOW()
              WHERE id=$1 AND background_job_id=$2 AND status <> 'consumed'`, [job.staging_id, job.id],
          );
        } else {
          await client.query(
            `UPDATE materials_upload_jobs SET status='cancelled', completed_at=NOW(),
                    lease_token=NULL, locked_until=NULL, error_code='operator_cancelled', updated_at=NOW()
              WHERE id=$1`, [jobId],
          );
          await client.query(
            `UPDATE portal_upload_staging SET status=CASE WHEN status='consumed' THEN status ELSE 'rejected' END,
                    result_code=CASE WHEN status='consumed' THEN result_code ELSE 'cancelled' END,
                    expires_at=CASE WHEN status='consumed' THEN expires_at ELSE NOW() + INTERVAL '7 days' END,
                    lease_token=NULL, lease_expires_at=NULL, background_job_id=NULL, updated_at=NOW()
              WHERE id=$1 AND background_job_id=$2`, [job.staging_id, job.id],
          );
        }
        await client.query('COMMIT');
        console.log(JSON.stringify({ jobId, action, status: action === 'retry' ? 'queued' : 'cancelled' }));
      }
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(error?.message || String(error));
      process.exitCode = 1;
    } finally {
      await client.end().catch(() => {});
    }
  }
}
