const mockSql = jest.fn();
jest.mock('@vercel/postgres', () => ({ sql: (strings, ...values) => mockSql(strings.join('?'), values) }));

import {
  claimZoomImport, markZoomImportStarted, markZoomImportFailed, takeOverExpiredAsStarted,
  takeOverExpiredAsFailed, sanitizeFailureCode, IMPORT_LEASE_SECONDS, FALLBACK_FAILURE_CODE, findJobForImport,
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
