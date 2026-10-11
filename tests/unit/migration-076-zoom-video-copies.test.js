/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/076_zoom_video_copies.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));
const sql = migration.replace(/\s+/g, ' ');

test('076 adds the intent origin column defaulting to browser with a closed CHECK', () => {
  expect(sql).toContain('ALTER TABLE presentation_material_uploads ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT \'browser\'');
  expect(sql).toContain('CONSTRAINT presentation_material_uploads_origin_check CHECK (origin IN (\'browser\', \'zoom_copy\'))');
});

test('076 creates the inert zoom_video_copies table linked one-to-one to its intent', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS zoom_video_copies (');
  expect(sql).toContain('upload_id UUID NOT NULL UNIQUE REFERENCES presentation_material_uploads(id)');
  expect(sql).toContain('CONSTRAINT zoom_video_copies_intent_id CHECK (upload_id = id)');
  expect(sql).toContain("state TEXT NOT NULL CHECK (state IN ('queued','copying','registering','copied','failed','cancelled'))");
  expect(sql).toContain('declared_size BIGINT NOT NULL CHECK (declared_size > 0 AND declared_size <= 2000000000)');
});

test.each([
  'zoom_video_copies_lease_shape',
  'zoom_video_copies_winner_shape',
  'zoom_video_copies_item_shape',
  'zoom_video_copies_failed_shape',
  'zoom_video_copies_terminal_unleased',
  'zoom_video_copies_registering_shape',
  'zoom_video_copies_copied_shape',
])('076 declares the %s constraint', (name) => {
  expect(sql).toContain(`CONSTRAINT ${name} CHECK (`);
});

test('076 carries the active-request, copied-file, work and recency indexes', () => {
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_active_request ON zoom_video_copies (request_id) WHERE state IN ('queued','copying','registering')");
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_zoom_video_copies_copied_file ON zoom_video_copies (request_id, zoom_file_id) WHERE state = 'copied'");
  expect(sql).toContain('idx_zoom_video_copies_work ON zoom_video_copies (state, next_attempt_at, lease_expires_at)');
  expect(sql).toContain('idx_zoom_video_copies_request_recent ON zoom_video_copies (request_id, created_at DESC)');
});

test('076 stores no URL, token, topic or email columns', () => {
  expect(sql).not.toMatch(/\b(upload_url|url|token|topic|email)\b\s+(TEXT|UUID)/i);
  expect(sql).toContain('zoom_host_email_sha256 CHAR(64)');
});

test('076 touches only presentation_material_uploads and zoom_video_copies', () => {
  const statements = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--')).join(' ')
    .split(';').map((part) => part.trim()).filter(Boolean);
  expect(statements.filter((s) => s.startsWith('ALTER TABLE'))).toHaveLength(1);
  expect(statements.every((s) => /presentation_material_uploads|zoom_video_copies/.test(s.split('(')[0]))).toBe(true);
});

test('076 is tracked by the manifest after 075, once', () => {
  expect(manifest.files.indexOf('076_zoom_video_copies.sql'))
    .toBeGreaterThan(manifest.files.indexOf('075_summary_drafts_discussion_kind.sql'));
  expect(manifest.files.filter((file) => file.startsWith('076_'))).toHaveLength(1);
});
