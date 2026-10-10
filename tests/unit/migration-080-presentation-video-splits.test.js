/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/080_presentation_video_splits.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));
const sql = migration.replace(/\s+/g, ' ');

test('080 creates presentation_video_splits linked to the source copy and actor profile', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS presentation_video_splits (');
  expect(sql).toContain('source_copy_id UUID NOT NULL REFERENCES zoom_video_copies(id)');
  expect(sql).toContain('actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id)');
  expect(sql).toContain("state TEXT NOT NULL CHECK (state IN ('queued','cutting','uploading','review','registering','approved','failed','cancelled','superseded'))");
  expect(sql).toContain("jsonb_typeof(lineage) = 'object' AND pg_column_size(lineage) <= 16384");
});

test.each([
  'lease_shape', 'failed_shape', 'terminal_unleased', 'approval_claim_shape', 'output_shape', 'approved_shape',
  'cleaned_shape', 'output_item_shape',
])('080 declares the presentation_video_splits_%s constraint', (name) => {
  expect(sql).toContain(`CONSTRAINT presentation_video_splits_${name} CHECK (`);
});

test('080 failed shape lets only failed or superseded rows carry a failure code', () => {
  expect(sql).toContain("(state <> 'failed' OR failure_code IS NOT NULL) AND (failure_code IS NULL OR state IN ('failed','superseded'))");
});

test('080 carries the processing, awaiting, work, cleanup and recency indexes', () => {
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_video_splits_processing ON presentation_video_splits (request_id) WHERE state IN ('queued','cutting','uploading')");
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_video_splits_awaiting ON presentation_video_splits (request_id) WHERE state IN ('review','registering')");
  expect(sql).toContain('idx_presentation_video_splits_work ON presentation_video_splits (state, next_attempt_at, lease_expires_at)');
  expect(sql).toContain('idx_presentation_video_splits_cleanup ON presentation_video_splits (next_cleanup_at) WHERE sandbox_name IS NOT NULL AND sandbox_cleaned_at IS NULL');
  expect(sql).toContain('idx_presentation_video_splits_request_recent ON presentation_video_splits (request_id, created_at DESC)');
});

test('080 stores no URL, token, topic or email text columns (the upload URL is ciphertext only)', () => {
  expect(sql).not.toMatch(/\b(upload_url|url|token|topic|email)\b\s+(TEXT|UUID)/i);
  expect(sql).toContain('upload_url_ciphertext TEXT');
});

test('080 touches only presentation_video_splits', () => {
  const statements = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--')).join(' ')
    .split(';').map((part) => part.trim()).filter(Boolean);
  expect(statements.filter((s) => s.startsWith('ALTER TABLE'))).toHaveLength(0);
  expect(statements.every((s) => /presentation_video_splits/.test(s.split('(')[0]))).toBe(true);
});

test('080 is tracked by the manifest after 079, once', () => {
  expect(manifest.files.indexOf('080_presentation_video_splits.sql'))
    .toBeGreaterThan(manifest.files.indexOf('079_zoom_video_copy_recording_times.sql'));
  expect(manifest.files.filter((file) => file.startsWith('080_'))).toHaveLength(1);
});
