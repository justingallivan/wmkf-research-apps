const mockSql = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (strings, ...values) => mockSql(strings.join('?'), values) }));

import {
  captureZoomImportFiles, getZoomImportForJob, claimZoomImport, markZoomImportStarted, markZoomImportFailed, takeOverExpiredAsStarted,
  takeOverExpiredAsFailed, releaseStartedImportWithEndedJob, getActiveZoomImport, listZoomImportsForRequest, sanitizeFailureCode, IMPORT_LEASE_SECONDS, FALLBACK_FAILURE_CODE, findJobForImport,
} from '../../lib/services/meeting-tracker-recordings/import-store.js';

const id = '11111111-1111-4111-8111-111111111111';
const lease = '22222222-2222-4222-8222-222222222222';
beforeEach(() => { mockSql.mockReset(); mockSql.mockResolvedValue({ rows: [{ id }] }); });

test('the lease outlives the 300 second route limit', () => {
  expect(IMPORT_LEASE_SECONDS).toBeGreaterThan(300);
});

test('claim inserts an importing row with a fresh lease and conflicts only on the active partial index', async () => {
  const row = await claimZoomImport({ id, requestId: 'r', siteVisitActivityId: 's', actorProfileId: 4,
    meetingUuid: 'u', hostId: 'h', meetingStart: '2026-10-01T00:00:00Z', includesZoomTranscript: true });
  expect(row).toEqual({ id });
  const [text, values] = mockSql.mock.calls[0];
  expect(text).toContain("'importing'");
  expect(text).toContain("ON CONFLICT (request_id, zoom_meeting_uuid) WHERE state IN ('importing', 'started') DO NOTHING");
  expect(values).toContain(IMPORT_LEASE_SECONDS);
  expect(values.filter(v => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)).length).toBeGreaterThanOrEqual(2);
});

test('claim returns null when the unique index suppressed the insert', async () => {
  mockSql.mockResolvedValue({ rows: [] });
  expect(await claimZoomImport({ requestId: 'r', siteVisitActivityId: 's', actorProfileId: 4, meetingUuid: 'u',
    hostId: 'h', meetingStart: 'x', includesZoomTranscript: false })).toBeNull();
});

test('final updates match id, lease token and importing state, and clear the lease', async () => {
  await markZoomImportStarted({ id, leaseToken: lease, jobId: 'job' });
  await markZoomImportFailed({ id, leaseToken: lease, failureCode: 'zoom_not_found' });
  for (const [text, values] of mockSql.mock.calls) {
    expect(text).toContain('WHERE id = ? AND lease_token = ? AND state = \'importing\'');
    expect(text).toContain('lease_token = NULL');
    expect(text).toContain('lease_expires_at = NULL');
    expect(values).toContain(lease);
  }
});

test('a lost lease updates nothing and returns null', async () => {
  mockSql.mockResolvedValue({ rows: [] });
  expect(await markZoomImportStarted({ id, leaseToken: lease, jobId: 'j' })).toBeNull();
  expect(await markZoomImportFailed({ id, leaseToken: lease, failureCode: 'x' })).toBeNull();
});

test('takeover updates are conditional on the lease still being expired', async () => {
  await takeOverExpiredAsStarted({ id, jobId: 'j' });
  await takeOverExpiredAsFailed({ id, failureCode: 'zoom_import_lease_expired' });
  for (const [text] of mockSql.mock.calls) {
    expect(text).toContain("state = 'importing' AND lease_expires_at <= NOW()");
  }
});

test('failure codes outside the table CHECK collapse to the fallback', () => {
  expect(sanitizeFailureCode('zoom_not_found')).toBe('zoom_not_found');
  for (const bad of ['Has Space', 'UPPER', '', 'a'.repeat(81), 'https://zoom.us/x', null, undefined, 5]) {
    expect(sanitizeFailureCode(bad)).toBe(FALLBACK_FAILURE_CODE);
  }
});

test('the job lookup uses the owner and the import id as idempotency key', async () => {
  await findJobForImport({ actorProfileId: 4, importId: id });
  const [text, values] = mockSql.mock.calls[0];
  expect(text).toContain('owner_profile_id = ? AND idempotency_key = ?');
  expect(values).toEqual([4, id]);
});

test('release is conditional on the row still being started with the same job id (NULL-safe)', async () => {
  await releaseStartedImportWithEndedJob({ id, jobId: null });
  const [text, values] = mockSql.mock.calls[0];
  expect(text).toContain("WHERE id = ? AND state = 'started' AND (transcription_job_id IS NOT DISTINCT FROM ?)");
  expect(text).toContain("'zoom_import_job_ended'");
  expect(values).toEqual([id, null]);
});

test('the active and list reads join the job status', async () => {
  await getActiveZoomImport({ requestId: 'r', meetingUuid: 'u' });
  await listZoomImportsForRequest({ requestId: 'r' });
  for (const [text] of mockSql.mock.calls) expect(text).toMatch(/LEFT JOIN transcription_jobs j ON j\.id = r\.transcription_job_id/);
  for (const [text] of mockSql.mock.calls) expect(text).toContain('j.status AS job_status');
});


test('file capture is write-once under the unexpired import lease and binds the job', async () => {
  const capture = { version: 1, audioOnlyFileCount: 1, transcriptFile: null,
    audioFile: { fileId: 'audio', recordingType: 'audio_only', bytes: 1,
      recordingStart: '2026-10-09T00:00:00Z', recordingEnd: '2026-10-09T01:00:00Z', sha256: 'a'.repeat(64) } };
  await captureZoomImportFiles({ id, leaseToken: lease, jobId: id, capture });
  expect(mockSql.mock.calls[0][0]).toContain('lease_expires_at > NOW() AND selected_recording_files IS NULL');
  expect(mockSql.mock.calls[0][0]).toContain('transcription_job_id IS NULL OR transcription_job_id = ?');
  mockSql.mockResolvedValue({ rows: [] });
  expect(await captureZoomImportFiles({ id, leaseToken: lease, jobId: id, capture })).toBeNull();
});

test('origin lookup scopes both request and visit and rejects competing imports', async () => {
  await getZoomImportForJob({ jobId: id, requestId: id, siteVisitActivityId: lease });
  expect(mockSql.mock.calls[0][0]).toContain('r.request_id = ? AND r.site_visit_activity_id = ?');
  expect(mockSql.mock.calls[0][0]).toContain('r.id = j.idempotency_key AND r.actor_profile_id = j.owner_profile_id');
  mockSql.mockResolvedValue({ rows: [{ id }, { id: lease }] });
  await expect(getZoomImportForJob({ jobId: id, requestId: id, siteVisitActivityId: lease })).rejects.toThrow('ambiguous_zoom_source');
});
