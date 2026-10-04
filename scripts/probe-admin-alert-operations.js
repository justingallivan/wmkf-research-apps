#!/usr/bin/env node
'use strict';
/** Read-only, content-free operations probe for the three admin-alert workflows.
 * Usage: node scripts/probe-admin-alert-operations.js /absolute/path/to/scoped.env
 * Reads Postgres aggregates only; never contacts Dataverse or mutates alerts/jobs.
 */
const fs = require('node:fs');
const dotenv = require('dotenv');
const { Client } = require('pg');
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('An explicit environment file is required');
  const env = dotenv.parse(fs.readFileSync(file));
  const connectionString = env.POSTGRES_URL_NON_POOLING || env.POSTGRES_URL;
  if (!connectionString || connectionString === '[SENSITIVE]') throw new Error('A usable Postgres URL is required');
  const client = new Client({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    const queries = {
      alerts: `SELECT alert_type, severity, status, title, created_at, resolved_at FROM system_alerts WHERE alert_type IN ('transcription_cron_incomplete','pricing_drift','model_registry_unreviewed_live_models') ORDER BY created_at DESC LIMIT 20`,
      transcription: `SELECT status, COUNT(*)::int AS jobs, COUNT(*) FILTER (WHERE cleanup_requested_at IS NOT NULL AND local_cleanup_completed_at IS NULL)::int AS local_cleanup_pending, COUNT(*) FILTER (WHERE input_cleanup_pathname IS NOT NULL AND audio_deleted_at IS NOT NULL)::int AS deleted_audio_with_retained_watch, COUNT(*) FILTER (WHERE provider_transcript_id IS NOT NULL AND provider_cleanup_completed_at IS NULL)::int AS provider_cleanup_pending, COUNT(*) FILTER (WHERE expires_at <= NOW() AND content_purged_at IS NULL)::int AS expired_content_pending, COUNT(*) FILTER (WHERE lease_token IS NOT NULL AND lease_expires_at <= NOW())::int AS expired_leases FROM transcription_jobs GROUP BY status ORDER BY status`,
      cleanup: `SELECT status, sanitized_error_code, audio_deleted_at IS NOT NULL AS audio_deletion_observed, input_cleanup_pathname IS NOT NULL AS input_watch_retained, output_cleanup_pathname IS NOT NULL AS output_cleanup_pending, diagnostic_cleanup_pathname IS NOT NULL AS diagnostic_cleanup_pending, provider_cleanup_completed_at IS NOT NULL AS provider_cleanup_complete, content_purged_at IS NOT NULL AS content_purged, local_cleanup_completed_at IS NOT NULL AS local_cleanup_complete, upload_valid_until IS NOT NULL AS upload_capability_issued, upload_valid_until > NOW() AS upload_window_open FROM transcription_jobs WHERE cleanup_requested_at IS NOT NULL ORDER BY updated_at DESC LIMIT 20`,
      maintenance: `SELECT job_name, status, started_at, completed_at, records_processed FROM maintenance_runs WHERE job_name IN ('pricing-refresh','pricing-canary') ORDER BY started_at DESC LIMIT 6`,
      factoryArtifacts: `SELECT status, started_at, completed_at, details->'factoryArtifacts' AS factory_artifacts FROM maintenance_runs WHERE job_name = 'daily-maintenance' ORDER BY started_at DESC LIMIT 4`,
      pricing: `SELECT model, token_type, token_count, anthropic_cost_cents, local_cents_per_mtok, derived_cents_per_mtok, delta_pct, flagged FROM model_pricing_audit WHERE run_date = (SELECT MAX(run_date) FROM model_pricing_audit) ORDER BY model, token_type LIMIT 40`,
    };
    const report = { checkedAt: new Date().toISOString(), readOnly: true };
    for (const [key, query] of Object.entries(queries)) report[key] = (await client.query(query)).rows;
    await client.query('ROLLBACK');
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
}
if (require.main === module) main().catch(error => { console.error('Operations probe failed:', error.code || error.name); process.exitCode = 1; });
