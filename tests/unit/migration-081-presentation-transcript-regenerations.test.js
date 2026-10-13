/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/081_presentation_transcript_regenerations.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));
const sql = migration.replace(/\s+/g, ' ');

test('081 creates presentation_transcript_regenerations with both actors, the artifact expectation and the state set', () => {
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS presentation_transcript_regenerations (');
  expect(sql).toContain('actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id)');
  expect(sql).toContain('acting_user_system_id UUID NOT NULL');
  expect(sql).toContain('transcript_artifact_id UUID NOT NULL');
  expect(sql).toContain("transcript_fingerprint TEXT NOT NULL CHECK (transcript_fingerprint ~ '^[0-9a-f]{64}$')");
  expect(sql).toContain("state TEXT NOT NULL CHECK (state IN ('pending','running','done','failed','superseded'))");
  expect(sql).toContain('attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3)');
});

test('081 failure_code has the same format CHECK as 080 and is required when failed', () => {
  expect(sql).toContain("failure_code TEXT CHECK (failure_code IS NULL OR failure_code ~ '^[a-z0-9_]{1,80}$')");
  expect(sql).toContain("(state <> 'failed' OR failure_code IS NOT NULL) AND (failure_code IS NULL OR state IN ('failed','superseded'))");
});

test.each(['lease_shape', 'running_leased', 'idle_unleased', 'failed_shape'])('081 declares the presentation_transcript_regenerations_%s constraint', (name) => {
  expect(sql).toContain(`CONSTRAINT presentation_transcript_regenerations_${name} CHECK (`);
});

test('081 carries one pending and one running row per request, plus a work index', () => {
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_transcript_regenerations_pending ON presentation_transcript_regenerations (request_id) WHERE state = 'pending'");
  expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_presentation_transcript_regenerations_running ON presentation_transcript_regenerations (request_id) WHERE state = 'running'");
  expect(sql).toContain("idx_presentation_transcript_regenerations_work ON presentation_transcript_regenerations (state, next_attempt_at, lease_expires_at) WHERE state IN ('pending','running')");
});

test('081 stores no URL, token-of-user, name, email or transcript text columns', () => {
  expect(sql).not.toMatch(/\b(url|topic|email|name|content|text_body)\b\s+(TEXT|UUID)/i);
});

test('081 touches only presentation_transcript_regenerations', () => {
  const statements = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--')).join(' ')
    .split(';').map((part) => part.trim()).filter(Boolean);
  expect(statements.filter((s) => s.startsWith('ALTER TABLE'))).toHaveLength(0);
  expect(statements.every((s) => /presentation_transcript_regenerations/.test(s.split('(')[0]))).toBe(true);
});

test('081 is tracked by the manifest after 080, once', () => {
  expect(manifest.files.indexOf('081_presentation_transcript_regenerations.sql'))
    .toBeGreaterThan(manifest.files.indexOf('080_presentation_video_splits.sql'));
  expect(manifest.files.filter((file) => file.startsWith('081_'))).toHaveLength(1);
});
