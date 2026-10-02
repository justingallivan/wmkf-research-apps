#!/usr/bin/env node
/** Inspect or resolve one durable applicant materials job on a loopback Postgres instance. */
import pg from 'pg';
import { resolveMaterialsUploadJob } from '../lib/services/site-visit-materials/background-job-store.js';

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

function isLoopbackPostgresUrl(value) {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
    return ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && ['localhost', '127.0.0.1', '::1'].includes(hostname)
      && ![...parsed.searchParams.keys()].some((key) => ['host', 'hostaddr', 'service'].includes(key.toLowerCase()));
  } catch {
    return false;
  }
}

async function inspectJob(connectionString, jobId) {
  const client = new pg.Client({ connectionString, ssl: false });
  try {
    await client.connect();
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
  } finally {
    await client.end();
  }
}

async function resolveJob(connectionString, jobId, action) {
  const result = await resolveMaterialsUploadJob({
    jobId,
    action,
    connectionFactory: async () => {
      const client = new pg.Client({ connectionString, ssl: false });
      await client.connect();
      return client;
    },
  });
  console.log(JSON.stringify({ jobId, action, status: result.status, attemptCount: result.attempt_count }));
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const connectionString = args?.['database-url'];
  const jobId = args?.['job-id'];
  const action = args?.action || 'inspect';
  if (!args || !connectionString || !jobId || !['inspect', 'cancel', 'retry'].includes(action)
    || !/^[0-9a-f-]{36}$/i.test(jobId)) {
    usage();
    return;
  }
  if (!isLoopbackPostgresUrl(connectionString)) {
    console.error('Refusing to connect: this operator tool accepts loopback Postgres URLs only.');
    process.exitCode = 2;
    return;
  }

  if (action === 'inspect') await inspectJob(connectionString, jobId);
  else await resolveJob(connectionString, jobId, action);
}

try {
  await main();
} catch (error) {
  console.error(error?.code || error?.message || String(error));
  process.exitCode = 1;
}
