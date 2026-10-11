/** @jest-environment node */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(ROOT, 'lib/db/migrations/075_summary_drafts_discussion_kind.sql'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations-manifest.json'), 'utf8'));

test('075 re-declares the drafts artifact-type constraint with 100000010 added and 100000007 kept', () => {
  const name = 'meeting_transcript_summary_drafts_artifact_type_check';
  expect(migration).toContain(`DROP CONSTRAINT IF EXISTS ${name}`);
  expect(migration).toContain(`ADD CONSTRAINT ${name}\n    CHECK (artifact_type IN (100000007, 100000010));`);
});

test('075 changes only that constraint', () => {
  const statements = migration.split('\n').filter((line) => line.trim() && !line.startsWith('--')).join(' ')
    .split(';').map((part) => part.trim()).filter(Boolean);
  expect(statements).toHaveLength(2);
  expect(statements.every((statement) => statement.startsWith('ALTER TABLE meeting_transcript_summary_drafts'))).toBe(true);
});

test('075 is tracked by the manifest after 074', () => {
  expect(manifest.files.indexOf('075_summary_drafts_discussion_kind.sql'))
    .toBeGreaterThan(manifest.files.indexOf('074_zoom_recording_imports.sql'));
});
