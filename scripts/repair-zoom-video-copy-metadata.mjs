#!/usr/bin/env node
/**
 * Verify one finalized Zoom copy against Zoom and SharePoint. Dry run by default.
 * Writes only missing timestamps/hash when --apply is supplied; never resets a transcript or copy state.
 * node --import ./scripts/lib/use-extensionless.mjs scripts/repair-zoom-video-copy-metadata.mjs
 *   --env-file <file> --request <GUID> --copy <GUID> [--apply]
 */
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import pg from 'pg';
import { needsVideoCopyVerification, verifiedVideoCopyMetadata } from '../lib/services/meeting-tracker-recordings/video-copy-verification.js';

const { values } = parseArgs({ options: {
  'env-file': { type: 'string' }, request: { type: 'string' }, copy: { type: 'string' }, apply: { type: 'boolean', default: false },
} });
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!values['env-file'] || !guid.test(values.request || '') || !guid.test(values.copy || '')) {
  throw new Error('Explicit --env-file, --request GUID and --copy GUID are required.');
}
Object.assign(process.env, dotenv.parse(fs.readFileSync(values['env-file'])));
const { getMeetingRecordings } = await import('../lib/services/meeting-tracker-recordings/zoom-client.js');
const { GraphService } = await import('../lib/services/graph-service.js');
const { createZoomVideoCopyStore } = await import('../lib/services/meeting-tracker-recordings/video-copy-store.js');
const client = new pg.Client({ connectionString: process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL,
  connectionTimeoutMillis: 10_000, statement_timeout: 10_000 });
try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const store = createZoomVideoCopyStore({ query: (text, params) => client.query(text, params),
    transaction: () => { throw new Error('Unexpected transaction'); } });
  const row = await store.getZoomVideoCopySnapshot({ id: values.copy });
  await client.query('ROLLBACK');
  if (!row || row.request_id.toLowerCase() !== values.request.toLowerCase()) throw new Error('copy_request_mismatch');
  const [meeting, item] = await Promise.all([
    getMeetingRecordings(row.zoom_meeting_uuid),
    GraphService.getFileMetadataById(row.sharepoint_drive_id, row.sharepoint_item_id, { timeoutMs: 10_000 }),
  ]);
  const metadata = verifiedVideoCopyMetadata(row, meeting, item);
  const needed = needsVideoCopyVerification(row);
  console.log(JSON.stringify({ copyId: row.id, requestId: row.request_id, verified: true, repairNeeded: needed,
    bytes: Number(row.declared_size), recordingStart: metadata.recordingStart, recordingEnd: metadata.recordingEnd,
    sameContentVersion: Boolean(row.candidate_version_id && row.candidate_version_id === item.versionId),
    apply: values.apply }));
  if (needed && values.apply) {
    if (!await store.repairCopiedZoomVideoMetadata({ row, ...metadata })) throw new Error('copy_changed_retry_verification');
    const after = await store.getZoomVideoCopySnapshot({ id: row.id });
    if (needsVideoCopyVerification(after)) throw new Error('repair_readback_failed');
    console.log(JSON.stringify({ repaired: true, copyId: after.id, state: after.state,
      recordingStart: after.recording_start, recordingEnd: after.recording_end, hasHash: Boolean(after.sharepoint_quickxor_hash) }));
  }
} catch (error) {
  // Provider errors can carry response bodies/URLs. Do not print those or raw error messages.
  console.error(JSON.stringify({ failed: true, code: /^[a-z0-9_]{1,80}$/.test(error?.message || '') ? error.message : 'verification_or_repair_failed' }));
  process.exitCode = 1;
} finally {
  await client.end();
}
