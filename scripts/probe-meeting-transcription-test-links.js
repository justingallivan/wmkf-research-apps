#!/usr/bin/env node
'use strict';

// Read-only count of currently usable recipient links for the authorized
// sandbox request in the dedicated Meeting Tracker test Neon database.
const fs = require('node:fs');
const dotenv = require('dotenv');
const {
  createClientConfig,
  readTargetEnvFromObject,
} = require('./seed-meeting-transcription-test-identity');

const REQUEST_ID = '4236c2b3-b053-f111-bec7-6045bd015cb0';

async function main() {
  const envPath = process.argv[2];
  if (!envPath || process.argv.length !== 3) {
    throw new Error('explicit_preview_env_file_required');
  }

  const env = dotenv.parse(fs.readFileSync(envPath));
  const url = readTargetEnvFromObject(env);
  const { Client } = require('pg');
  const client = new Client({
    ...createClientConfig(url),
    application_name: 'meeting-transcription-test-links-readonly-probe',
  });

  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const result = await client.query(
      `SELECT
         (SELECT COUNT(*)::integer
            FROM public.presentation_material_links
           WHERE request_id = $1::uuid
             AND revoked_at IS NULL
             AND expires_at > NOW()) AS active_presentation_material_links,
         (SELECT COUNT(*)::integer
            FROM public.deliberation_briefing_links
           WHERE request_id = $1::uuid
             AND revoked_at IS NULL
             AND expires_at > NOW()) AS active_deliberation_briefing_links`,
      [REQUEST_ID],
    );
    await client.query('ROLLBACK');
    process.stdout.write(`${JSON.stringify({
      scope: 'dedicated-meeting-transcription-test-preview-neon',
      requestId: REQUEST_ID,
      ...result.rows[0],
    })}\n`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    process.stderr.write(`meeting_transcription_test_links_probe_failed:${safeErrorCode(error)}\n`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

function safeErrorCode(error) {
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.code || '')) return error.code;
  if (/^[a-z0-9_:-]{1,100}$/i.test(error?.message || '')) return error.message;
  return 'unexpected_error';
}

main().catch((error) => {
  process.stderr.write(`meeting_transcription_test_links_probe_failed:${safeErrorCode(error)}\n`);
  process.exitCode = 1;
});
