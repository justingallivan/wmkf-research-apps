jest.mock('@vercel/blob', () => ({ del: jest.fn(), get: jest.fn(), put: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({ generateClientTokenFromReadWriteToken: jest.fn() }));
import { createTranscriptionPilotStore } from '../../lib/services/transcription-pilot/store.js';

const JOB = '33333333-3333-4333-8333-333333333333';
const REQUEST = '11111111-1111-4111-8111-111111111111';
const VISIT = '55555555-5555-4555-8555-555555555555';
const squash = text => text.replace(/\s+/g, ' ');
function setup(rows = [{ id: JOB }]) {
  const database = { query: jest.fn(async () => ({ rows })), transaction: jest.fn() };
  return { database, store: createTranscriptionPilotStore(database) };
}

test('retire fences on owner, status uploading and no earlier cleanup request, and bumps the version', async () => {
  const { database, store } = setup();
  const row = await store.retireMeetingUploadingJob({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 9 });
  expect(row).toEqual({ id: JOB });
  const [text, values] = database.query.mock.calls[0];
  const sql = squash(text);
  expect(sql).toContain('SET cleanup_requested_at = NOW(), expires_at = LEAST(expires_at, NOW())');
  expect(sql).toContain('version = version + 1');
  expect(sql).toContain("AND owner_profile_id = $4 AND status = 'uploading' AND cleanup_requested_at IS NULL");
  expect(values).toEqual([JOB, REQUEST, VISIT, 9]);
});

test('retire returns null (no write) when the row is no longer uploading', async () => {
  const { store } = setup([]);
  expect(await store.retireMeetingUploadingJob({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 9 })).toBeNull();
});

test('retire rejects a missing owner and non-id inputs', async () => {
  const { database, store } = setup();
  await expect(store.retireMeetingUploadingJob({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 0 })).rejects.toThrow();
  await expect(store.retireMeetingUploadingJob({ jobId: 'x', requestId: REQUEST, siteVisitActivityId: VISIT, ownerProfileId: 9 })).rejects.toThrow();
  expect(database.query).not.toHaveBeenCalled();
});

test('a retired row cannot be queued: queueMeetingJob requires uploading, no cleanup request and an unexpired window', async () => {
  const { database, store } = setup();
  await store.queueMeetingJob({ jobId: JOB, requestId: REQUEST, siteVisitActivityId: VISIT, actorProfileId: 9, expectedVersion: 2,
    acknowledgementAt: new Date(), verifiedContentType: 'audio/mp4', verifiedBytes: 5, durationMs: 1000, sha256: 'a'.repeat(64) });
  const sql = squash(database.query.mock.calls[0][0]);
  expect(sql).toContain("AND status = 'uploading' AND cleanup_requested_at IS NULL AND expires_at > NOW()");
});

test('the cleanup sweep selects a row with a cleanup request and no completed local cleanup', async () => {
  const { database, store } = setup([]);
  await store.claimNextCleanupJob({});
  expect(squash(database.query.mock.calls[0][0])).toContain('(cleanup_requested_at IS NOT NULL AND local_cleanup_completed_at IS NULL)');
});
