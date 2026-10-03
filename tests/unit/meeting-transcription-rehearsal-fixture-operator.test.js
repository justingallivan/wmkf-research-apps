/** @jest-environment node */
import { projectMeetingTranscriptionJob } from '../../lib/services/transcription-pilot/runtime';
jest.mock('@vercel/blob', () => ({ put: jest.fn(), get: jest.fn(), del: jest.fn() }));
const blob = require('@vercel/blob');
const { argsOf, INSERT_SQL, MARKER, preflight, seed, transcriptHash } = require('../../scripts/meeting-transcription-rehearsal-fixture');
const fixture = require('../../lib/services/meeting-tracker-transcription/rehearsal-fixture');
const transcriptBytes = Buffer.from(JSON.stringify(fixture.REHEARSAL_TRANSCRIPT), 'utf8');

test('operator defaults to readonly and mutations need explicit execute and teardown fencing attestation', () => {
  expect(argsOf(['--env-file', '/tmp/preview.env']).action).toBe('inspect');
  expect(() => argsOf(['--seed', '--env-file', '/tmp/preview.env'])).toThrow('explicit_execute_required');
  expect(argsOf(['--seed', '--execute', '--env-file', '/tmp/preview.env']).action).toBe('seed');
  expect(() => argsOf(['--teardown', '--execute', '--env-file', '/tmp/preview.env']))
    .toThrow('access_disabled_attestation_required');
  expect(argsOf(['--teardown', '--execute', '--access-disabled', '--env-file', '/tmp/preview.env']).action).toBe('teardown');
});

test('ready-row SQL uses exact synthetic identities, fixed output pin, hash, and marker', () => {
  expect(INSERT_SQL).toContain('output_cleanup_pathname');
  expect(INSERT_SQL).toContain('provider_id_conflict');
  expect(INSERT_SQL).toContain('provider_id_conflict, cleanup_requested_at,\n          content_purged_at, input_cleanup_pathname, upload_valid_until');
  expect(MARKER).toBe('meeting-tracker-speaker-rehearsal-v1');
  expect(transcriptHash).toMatch(/^[0-9a-f]{64}$/);
  expect(fixture.REHEARSAL_OUTPUT_PATH).toContain(fixture.REHEARSAL_JOB_ID);
});

test('preflight inserts only inside an explicitly rolled-back transaction and exercises the real projector', async () => {
  const statements = [];
  const client = { query: jest.fn(async (text) => {
    statements.push(text);
    if (text.includes('current_database')) return { rows: [{ db: 'neondb', app: 'test' }] };
    if (text.includes('SELECT id FROM public.transcription_jobs')) return { rows: [] };
    if (text.includes('transcription_workflow_dispatches')) return { rows: [] };
    if (text.startsWith('INSERT')) return { rows: [{
      id: fixture.REHEARSAL_JOB_ID, status: 'ready', version: 1,
      created_at: new Date(), updated_at: new Date(), ready_at: new Date(),
      expires_at: new Date(Date.now() + 7 * 86400_000), receipt_expires_at: new Date(Date.now() + 30 * 86400_000),
      output_pathname: fixture.REHEARSAL_OUTPUT_PATH, output_sha256: transcriptHash,
      options_snapshot: { rehearsal_fixture: MARKER }, speaker_names: { A: '', B: '', C: '' },
      provider_id_conflict: false,
      cleanup_requested_at: null, content_purged_at: null,
      input_cleanup_pathname: null, upload_valid_until: null,
    }] };
    return { rows: [] };
  }) };
  const result = await preflight(client, projectMeetingTranscriptionJob);
  expect(result.preflightRolledBack).toBe(true);
  expect(result.projectionVerified).toBe(true);
  expect(result.projectedFlags).toEqual({ contentDeletionObserved: false, lateUploadWatchPending: false });
  expect(statements[0]).toBe('BEGIN');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements).not.toContain('COMMIT');
});

test.each([
  ['missing cleanup_requested_at', (row) => { delete row.cleanup_requested_at; }],
  ['missing content_purged_at', (row) => { delete row.content_purged_at; }],
  ['missing input_cleanup_pathname', (row) => { delete row.input_cleanup_pathname; }],
  ['missing upload_valid_until', (row) => { delete row.upload_valid_until; }],
  ['populated cleanup_requested_at', (row) => { row.cleanup_requested_at = new Date(); }],
  ['populated content_purged_at', (row) => { row.content_purged_at = new Date(); }],
  ['populated input_cleanup_pathname', (row) => { row.input_cleanup_pathname = 'transcription-pilot/fixture/input.m4a'; }],
  ['populated upload_valid_until', (row) => { row.upload_valid_until = new Date(); }],
])('preflight rejects %s and rolls the transaction back', async (_label, mutateRow) => {
  const row = {
    id: fixture.REHEARSAL_JOB_ID, owner_profile_id: fixture.REHEARSAL_OWNER_PROFILE_ID,
    request_id: fixture.REHEARSAL_REQUEST_ID, site_visit_activity_id: fixture.REHEARSAL_SITE_VISIT_ACTIVITY_ID,
    status: 'ready', version: 1, created_at: new Date(), updated_at: new Date(), ready_at: new Date(),
    expires_at: new Date(Date.now() + 7 * 86400_000), receipt_expires_at: new Date(Date.now() + 30 * 86400_000),
    output_pathname: fixture.REHEARSAL_OUTPUT_PATH, output_sha256: transcriptHash,
    options_snapshot: { rehearsal_fixture: MARKER }, speaker_names: { A: '', B: '', C: '' },
    provider_id_conflict: false, cleanup_requested_at: null, content_purged_at: null,
    input_cleanup_pathname: null, upload_valid_until: null,
  };
  mutateRow(row);
  const statements = [];
  const client = { query: jest.fn(async (text) => {
    statements.push(text);
    if (text.includes('current_database')) return { rows: [{ db: 'neondb', app: 'test' }] };
    if (text.includes('SELECT id FROM public.transcription_jobs')) return { rows: [] };
    if (text.includes('transcription_workflow_dispatches')) return { rows: [] };
    if (text.startsWith('INSERT')) return { rows: [row] };
    return { rows: [] };
  }) };

  await expect(preflight(client, projectMeetingTranscriptionJob)).rejects.toThrow('preflight_projection_failed');
  expect(statements[0]).toBe('BEGIN');
  expect(statements.at(-1)).toBe('ROLLBACK');
  expect(statements).not.toContain('COMMIT');
});

test('ambiguous commit retry verifies and reuses only the exact private Blob; it never deletes it', async () => {
  const identity = { id: 1, azure_id: '893369cc-1925-40ec-bbc6-6f12b0684a31', is_active: true, needs_linking: false };
  const client = { query: jest.fn(async (text) => {
    if (text.includes('SELECT id, azure_id')) return { rows: [identity] };
    if (text.includes('SELECT * FROM public.transcription_jobs')) return { rows: [] };
    if (text.includes('SELECT id FROM public.transcription_jobs')) return { rows: [] };
    if (text.includes('transcription_workflow_dispatches')) return { rows: [] };
    if (text.startsWith('INSERT')) return { rows: [{ output_sha256: transcriptHash }] };
    if (text === 'COMMIT' && client.query.commitShouldFail) throw new Error('commit_connection_lost');
    return { rows: [] };
  }) };
  const env = { UPLOADS_BLOB_RW_TOKEN: 'vercel_blob_rw_G5ZrBn1kcxzaBkyI_fixture-token' };
  blob.get.mockResolvedValueOnce(null).mockImplementation(async () => ({
    statusCode: 200,
    stream: new ReadableStream({ start(controller) { controller.enqueue(transcriptBytes); controller.close(); } }),
  }));
  blob.put.mockResolvedValue({ pathname: fixture.REHEARSAL_OUTPUT_PATH });
  client.query.commitShouldFail = true;
  await expect(seed(client, env)).rejects.toThrow('commit_connection_lost');
  expect(blob.del).not.toHaveBeenCalled();

  client.query.commitShouldFail = false;
  const retry = await seed(client, env);
  expect(retry.seeded).toBe(true);
  expect(blob.put).toHaveBeenCalledTimes(1);
  expect(blob.del).not.toHaveBeenCalled();
});
