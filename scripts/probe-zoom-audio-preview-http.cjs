#!/usr/bin/env node
'use strict';
/** PR 513 owner-approved recording acceptance. Operator inputs stay outside Git.
 * Usage: node scripts/probe-zoom-audio-preview-http.cjs <mode> <operator-json> <deployment-json>
 * Modes: session, list, import, job, download, cleanup, cron.
 * cron requires an explicitly empty real NOTIFICATION_EMAIL_FROM configuration.
 * Uses an expiring, test-secret-only signed staff session; route auth, fresh DB
 * identity/app checks, Origin, service validation, Zoom, Blob and provider code remain live.
 * Does not test the Azure browser login flow. Import sends one fixed approved occurrence.
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { encode } = require('next-auth/jwt');
const { Client } = require('pg');
const REQUEST = '4236c2b3-b053-f111-bec7-6045bd015cb0';
const RECORDING = 'W2F2ANe/Rua0wZ5D4ykdbA==';
const DATABASE = 'audio_pr513_acceptance_20261019';
const HOST = 'ep-aged-dew-b7gtigyy-pooler.c-13.us-east-1.aws.neon.tech';
function summarizeJob(job) {
  if (!job) return null;
  return Object.fromEntries(['id', 'status', 'version', 'declared_bytes', 'verified_bytes', 'audio_duration_ms', 'ready_at', 'expires_at', 'zoomTranscriptAttached', 'cleanupPending', 'contentAccessAllowed'].map(key => [key, job[key]]));
}
(async () => {
  const [mode, operatorFile, deploymentFile] = process.argv.slice(2);
  if (!['session', 'list', 'import', 'job', 'download', 'cleanup', 'cron'].includes(mode)) throw Error('invalid_mode');
  const operator = JSON.parse(fs.readFileSync(operatorFile, 'utf8'));
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
  if (deployment.target !== 'preview' || deployment.readyState !== 'READY'
    || deployment.projectId !== 'prj_56SJKzNer1aV38kKVoP8tl3X0lf3'
    || deployment.meta?.githubCommitSha !== '1dc8f3d1b75e8dc517f7cb42db65abddb430d362') throw Error('deployment_identity_mismatch');
  const values = operator.values;
  if (mode === 'cron' && values.NOTIFICATION_EMAIL_FROM !== '') throw Error('notification_sender_must_be_disabled');
  const db = new URL(values.POSTGRES_URL);
  if (db.hostname !== HOST || db.pathname !== `/${DATABASE}` || db.searchParams.has('host')) throw Error('database_identity_mismatch');
  const client = new Client({ connectionString: values.POSTGRES_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  let actor; let job;
  try {
    await client.query('BEGIN READ ONLY');
    const identity = await client.query('SELECT azure_id,azure_email FROM user_profiles WHERE is_active=true');
    if (identity.rowCount !== 1 || identity.rows[0].azure_id !== '893369cc-1925-40ec-bbc6-6f12b0684a31') throw Error('actor_identity_mismatch');
    actor = identity.rows[0];
    const jobs = await client.query('SELECT id,version FROM transcription_jobs ORDER BY created_at');
    if (jobs.rowCount > 1) throw Error('unexpected_extra_jobs');
    job = jobs.rows[0];
    if (mode === 'import' && job) throw Error('import_already_attempted');
  } finally { await client.query('ROLLBACK'); await client.end(); }
  if (['job', 'download', 'cleanup'].includes(mode) && !job) throw Error('job_missing');
  const base = `/api/meeting-tracker/visits/${REQUEST}`;
  const route = { session: '/api/auth/session', list: `${base}/zoom-recordings?days=30`, import: `${base}/zoom-imports`,
    job: `${base}/transcriptions/${job?.id}`, download: `${base}/transcriptions/${job?.id}/download?format=txt`,
    cleanup: `${base}/transcriptions/${job?.id}`, cron: '/api/cron/drain-transcriptions' }[mode];
  const method = ['import', 'cron'].includes(mode) ? 'POST' : mode === 'cleanup' ? 'DELETE' : 'GET';
  const headerFile = `${operatorFile}.${mode}.headers`;
  const outputFile = `${operatorFile}.${mode}.response`;
  const session = await encode({ secret: values.NEXTAUTH_SECRET, maxAge: 3600,
    token: { azureId: actor.azure_id, azureEmail: actor.azure_email, userType: 'staff', lastActivity: Date.now() } });
  fs.writeFileSync(headerFile, mode === 'cron' ? `Authorization: Bearer ${values.CRON_SECRET}\n`
    : `Cookie: __Secure-next-auth.session-token=${session}\nOrigin: ${values.NEXTAUTH_URL}\nContent-Type: application/json\n`, { mode: 0o600 });
  if (mode === 'import') fs.writeFileSync(`${operatorFile}.import-attempted`, new Date().toISOString(), { flag: 'wx', mode: 0o600 });
  try {
    const args = ['curl', route, '--deployment', `https://${deployment.url}`, '--', '--request', method,
      '--header', `@${headerFile}`, '--max-time', '290', '--silent', '--show-error', '--output', outputFile, '--write-out', '%{http_code}'];
    if (mode === 'import') args.push('--data', JSON.stringify({ meetingUuid: RECORDING, nonSensitiveAcknowledged: true }));
    if (mode === 'cleanup') args.push('--data', JSON.stringify({ expectedVersion: job.version }));
    fs.writeFileSync(outputFile, '', { mode: 0o600 });
    const started = Date.now();
    const result = spawnSync('vercel', args, { encoding: 'utf8', timeout: 300000 });
    const bytes = fs.existsSync(outputFile) ? fs.readFileSync(outputFile) : Buffer.alloc(0);
    if (fs.existsSync(outputFile)) fs.chmodSync(outputFile, 0o600);
    let body; try { body = JSON.parse(bytes); } catch { body = null; }
    const report = { mode, httpStatus: result.stdout?.trim(), elapsedMs: Date.now() - started,
      clientExitCode: result.status, responseBytes: bytes.length };
    if (mode === 'download' && report.httpStatus === '200') Object.assign(report, { sha256: crypto.createHash('sha256').update(bytes).digest('hex'), lines: bytes.toString('utf8').split('\n').length });
    else if (mode === 'session') Object.assign(report, { authenticated: Boolean(body?.user?.profileId), profileId: body?.user?.profileId });
    else if (mode === 'list') Object.assign(report, { available: body?.available, meetings: body?.meetings?.filter(row => row.meetingUuid === RECORDING) });
    else if (mode === 'import') Object.assign(report, { import: body?.import, job: summarizeJob(body?.job) });
    else if (mode === 'job') {
      const utterances = body?.content?.utterances || [];
      Object.assign(report, { keys: body && Object.keys(body), job: summarizeJob(body?.job), transcript: {
        utterances: utterances.length, speakers: new Set(utterances.map(row => row.speaker)).size,
        textCharacters: utterances.reduce((n, row) => n + (row.text?.length || 0), 0),
        firstStartMs: utterances[0]?.start, lastEndMs: utterances.at(-1)?.end,
        validTimestamps: utterances.every(row => Number.isFinite(row.start) && Number.isFinite(row.end) && row.start >= 0 && row.end >= row.start && row.end <= Number(body.job.audio_duration_ms) + 1000),
        lastSpeechNearEnd: utterances.length > 0 && Number(body.job.audio_duration_ms) - utterances.at(-1).end < 10000,
      } });
    }
    else Object.assign(report, { body: body?.job ? { job: summarizeJob(body.job) } : body });
    if (body?.error) report.error = body.error;
    if (body?.code) report.code = body.code;
    fs.writeFileSync(`${operatorFile}.${mode}.report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (result.status !== 0 || !/^2\d\d$/.test(report.httpStatus)) process.exitCode = 1;
  } finally { fs.rmSync(headerFile, { force: true }); }
})().catch(error => { console.error(JSON.stringify({ ok: false, code: error.code || (/^[a-z_]+$/.test(error.message) ? error.message : 'operator_failed') })); process.exitCode = 1; });
